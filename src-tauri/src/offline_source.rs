//! Builds a private player source directly from a temporary save copy.
//! Visibility sanitization remains in `lib.rs`.

use crate::{csv_field, database_blocks, offline_db::{self, FieldValue, Table}, read_u32_le, scan_database_sizes, PlayerRevealRecord, RevealContext};
use std::collections::{HashMap, HashSet};

const NAME_CACHE: &str = include_str!("../resources/fifa22_names.tsv");
const TEAM_CACHE: &str = include_str!("../resources/fifa22_teams.tsv");

const ATTRIBUTE_FIELDS: [(&str, &str); 34] = [
    ("ballcontrol", "MgwU"), ("dribbling", "nEbM"), ("crossing", "wGOH"),
    ("shortpassing", "vObb"), ("longpassing", "kerE"), ("finishing", "xJZL"),
    ("headingaccuracy", "aReg"), ("volleys", "Dydz"), ("curve", "YFaA"),
    ("freekickaccuracy", "VgKc"), ("penalties", "AGsE"), ("acceleration", "SPge"),
    ("sprintspeed", "NrcP"), ("agility", "RRQB"), ("balance", "onkY"),
    ("reactions", "YCnI"), ("shotpower", "ohpV"), ("jumping", "URGo"),
    ("stamina", "XjDq"), ("strength", "nmgT"), ("longshots", "CsBG"),
    ("aggression", "iTce"), ("interceptions", "wWzG"), ("attackingposition", "XsFD"),
    ("vision", "ZoOK"), ("composure", "jlQJ"), ("marking", "wxMq"),
    ("standingtackle", "CsyD"), ("slidingtackle", "PhuM"), ("gkdiving", "xrSG"),
    ("gkhandling", "GBGj"), ("gkkicking", "kqda"), ("gkpositioning", "yfhq"),
    ("gkreflexes", "eYFI"),
];

const POSITIONS: [&str; 28] = [
    "GK", "SW", "RWB", "RB", "RCB", "CB", "LCB", "LB", "LWB", "RDM", "CDM", "LDM",
    "RM", "RCM", "CM", "LCM", "LM", "RAM", "CAM", "LAM", "RF", "CF", "LF", "RW", "RS",
    "ST", "LS", "LW",
];

fn cache(input: &str) -> HashMap<i64, String> {
    input.lines().filter_map(|line| {
        let (id, value) = line.split_once('\t')?;
        Some((id.parse().ok()?, value.to_owned()))
    }).collect()
}

fn find_table<'a>(blocks: &'a [&'a [u8]], short_name: &str) -> Result<Table<'a>, String> {
    blocks.iter().find_map(|block| offline_db::open_table(block, short_name).transpose())
        .ok_or_else(|| format!("FIFA save table {short_name} is missing"))?
}

fn string(table: &Table<'_>, row: usize, short_name: &str) -> Result<String, String> {
    let field = table.field(short_name).ok_or_else(|| format!("Table {} has no field {short_name}", table.short_name))?;
    match table.value(row, field)? {
        FieldValue::String(value) => Ok(value),
        _ => Err(format!("Field {short_name} is not a string")),
    }
}

fn reveal_record(bytes: &[u8], offset: usize) -> Result<PlayerRevealRecord, String> {
    let packed = read_u32_le(bytes, offset + 4)?;
    Ok(PlayerRevealRecord {
        player_id: read_u32_le(bytes, offset)?,
        source: packed as u16,
        progress: (packed >> 16) as u16,
        flags: read_u32_le(bytes, offset + 8)?,
        date: read_u32_le(bytes, offset + 12)?,
        extra: read_u32_le(bytes, offset + 16)?,
        list_state: None,
    })
}

fn plausible_reveal(record: &PlayerRevealRecord) -> bool {
    (1..=500_000).contains(&record.player_id)
        && (record.source <= 16 || record.source == u16::MAX)
        && record.progress <= 100
        && record.flags <= 4096
        && (record.date == 0 || (20_080_101..=20_601_231).contains(&record.date))
        && record.extra == u32::MAX
}

pub(crate) fn reveal_context(bytes: &[u8], database_end: usize) -> Result<RevealContext, String> {
    let mut best: Option<(usize, usize)> = None;
    for start in database_end.saturating_add(16)..bytes.len().saturating_sub(20) {
        let count = read_u32_le(bytes, start - 4)? as usize;
        if !(10..=5000).contains(&count) { continue; }
        let Some(end) = start.checked_add(count.saturating_mul(20)) else { continue; };
        if end > bytes.len() { continue; }
        let first = reveal_record(bytes, start)?;
        let last = reveal_record(bytes, end - 20)?;
        if !plausible_reveal(&first) || !plausible_reveal(&last) { continue; }
        let mut valid = true;
        for offset in (start..end).step_by(20) {
            if !plausible_reveal(&reveal_record(bytes, offset)?) { valid = false; break; }
        }
        if valid && best.is_none_or(|(_, best_count)| count > best_count) { best = Some((start, count)); }
    }
    let (start, count) = best.ok_or("FIFA scouting records were not found in this save")?;
    let seed_multiplier = read_u32_le(bytes, start - 16)?;
    let records = (0..count).map(|index| reveal_record(bytes, start + index * 20)).collect::<Result<Vec<_>, _>>()?;
    let current_date = read_u32_le(bytes, start - 8)?;
    if !(20_080_101..=20_601_231).contains(&current_date) {
        return Err("The career date is not recognized".into());
    }
    Ok(RevealContext { records, seed_multiplier, range_radii: [5, 5, 4, 3, 2], current_date })
}

fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let year = year - i64::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let adjusted_month = i64::from(month) + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * adjusted_month + 2) / 5 + i64::from(day) - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let days = days + 719_468;
    let era = if days >= 0 { days } else { days - 146_096 } / 146_097;
    let day_of_era = days - era * 146_097;
    let year_of_era = (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    (year, month as u32, day as u32)
}

fn player_age(birth_days: i64, current_date: u32) -> Option<u32> {
    let current_year = i64::from(current_date / 10_000);
    let current_month = (current_date / 100) % 100;
    let current_day = current_date % 100;
    if !(1..=12).contains(&current_month) || !(1..=31).contains(&current_day) { return None; }
    let (birth_year, birth_month, birth_day) = civil_from_days(days_from_civil(1582, 10, 14) + birth_days);
    let before_birthday = (current_month, current_day) < (birth_month, birth_day);
    u32::try_from(current_year - birth_year - i64::from(before_birthday)).ok().filter(|age| *age <= 100)
}

fn overall_base_value(overall: i64) -> i64 {
    const VALUES: [i64; 61] = [
        15_000,15_000,15_000,15_000,15_000,15_000,15_000,15_000,15_000,15_000,
        20_000,25_000,34_000,40_000,46_000,54_000,61_000,70_000,86_000,105_000,
        140_000,170_000,205_000,250_000,305_000,365_000,435_000,515_000,605_000,710_000,
        1_200_000,1_600_000,2_100_000,2_700_000,3_800_000,4_500_000,5_200_000,6_000_000,7_000_000,8_500_000,
        10_000_000,12_000_000,15_000_000,17_500_000,21_000_000,26_000_000,30_000_000,34_000_000,40_000_000,45_000_000,
        52_000_000,60_000_000,68_000_000,75_000_000,83_000_000,90_000_000,110_000_000,120_000_000,140_000_000,150_000_000,200_000_000,
    ];
    if overall < 40 { 1_000 } else { VALUES.get((overall - 40) as usize).copied().unwrap_or(0) }
}

fn round_market_value(value: f64) -> i64 {
    let divisor = if value <= 5_000.0 { 50.0 } else if value <= 10_000.0 { 1_000.0 }
        else if value <= 50_000.0 { 5_000.0 } else if value <= 250_000.0 { 10_000.0 }
        else if value <= 1_000_000.0 { 25_000.0 } else if value <= 5_000_000.0 { 100_000.0 } else { 500_000.0 };
    let remainder = value % divisor;
    (if remainder > divisor / 2.0 { value + divisor - remainder } else { value - remainder }) as i64
}

fn market_value(overall: i64, potential: i64, age: u32, position: i64) -> i64 {
    const POSITION: [i64; 28] = [-40,-15,-18,-18,-15,-15,-15,-18,-18,-15,-15,-15,15,12,12,12,15,15,15,15,18,18,18,15,18,18,18,15];
    // FIFA 22 keeps the first three points of remaining potential in its first
    // value band. This differs from the older public curve, which assigned a
    // 20% modifier at two points and overvalued known FIFA 22 career players.
    const POTENTIAL: [i64; 17] = [0,15,15,15,30,35,40,45,55,65,75,90,100,120,160,190,235];
    const AGE: [i64; 41] = [18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,30,42,50,48,48,48,48,46,44,40,35,30,25,15,0,-25,-40,-50,-65,-65,-65,-75,-1000];
    let base = overall_base_value(overall) as f64;
    let position_factor = POSITION.get(position as usize).copied().unwrap_or(-40) as f64 / 100.0;
    let remaining = (potential - overall).max(0) as usize;
    let potential_factor = POTENTIAL.get(remaining).copied().unwrap_or(*POTENTIAL.last().unwrap()) as f64 / 100.0;
    let adjusted_age = if position == 0 && age >= 28 { age - 2 } else { age } as usize;
    let age_factor = AGE.get(adjusted_age).copied().unwrap_or(-1000) as f64 / 100.0;
    let value = round_market_value(base * (1.0 + position_factor + potential_factor + age_factor));
    if value < 0 { (base as i64 / 10).max(10_000) } else { value.max(10_000) }
}

fn player_name(
    player_id: i64, first_id: i64, last_id: i64, common_id: i64,
    names: &HashMap<i64, String>, edited: &HashMap<i64, String>,
) -> String {
    if let Some(value) = edited.get(&player_id).filter(|value| !value.trim().is_empty()) { return value.clone(); }
    if common_id > 0 {
        if let Some(value) = names.get(&common_id) { return value.clone(); }
    }
    let first = names.get(&first_id).map(String::as_str).unwrap_or("");
    let last = names.get(&last_id).map(String::as_str).unwrap_or("");
    let combined = format!("{first} {last}").trim().to_owned();
    if combined.is_empty() { format!("Player {player_id}") } else { combined }
}

fn length_prefixed_string(bytes: &[u8], offset: usize, maximum: usize) -> Option<(&str, usize)> {
    let length = read_u32_le(bytes, offset).ok()? as usize;
    if !(2..=maximum).contains(&length) { return None; }
    let start = offset.checked_add(4)?;
    let end = start.checked_add(length)?;
    let value = std::str::from_utf8(bytes.get(start..end)?).ok()?;
    if value.chars().any(char::is_control) || !value.chars().any(char::is_alphabetic) { return None; }
    Some((value, end))
}

/// Create-a-club saves keep the long name, display name, nickname, and
/// abbreviation as four adjacent length-prefixed UTF-8 strings. The database
/// team row itself contains only a localization token.
fn created_club_name(bytes: &[u8], database_end: usize) -> Option<String> {
    for offset in database_end..bytes.len().saturating_sub(24) {
        let Some((long_name, second)) = length_prefixed_string(bytes, offset, 40) else { continue; };
        let Some((display_name, third)) = length_prefixed_string(bytes, second, 40) else { continue; };
        if long_name != display_name || !long_name.contains(' ') { continue; }
        let Some((_nickname, fourth)) = length_prefixed_string(bytes, third, 40) else { continue; };
        let Some((abbreviation, _)) = length_prefixed_string(bytes, fourth, 8) else { continue; };
        if abbreviation.chars().all(|character| character.is_ascii_uppercase()) {
            return Some(long_name.to_owned());
        }
    }
    None
}

pub(crate) fn raw_csv_and_context(bytes: &[u8], save_label: &str) -> Result<(String, RevealContext), String> {
    let sizes = scan_database_sizes(bytes)?;
    let blocks = database_blocks(bytes, &sizes)?;
    let mut cursor = 0usize;
    for size in &sizes {
        let relative = bytes[cursor..].windows(8).position(|window| window == b"DB\0\x08\0\0\0\0").ok_or("Database block disappeared")?;
        cursor += relative + *size as usize;
    }
    let mut context = reveal_context(bytes, cursor)?;

    let players = find_table(&blocks, "CZUM")?;
    let links = find_table(&blocks, "RrqT")?;
    let teams = find_table(&blocks, "lyxL")?;
    let users = find_table(&blocks, "mPrV")?;
    let user_team = users.integer(0, "NTyS", -1)?;

    let mut names = cache(NAME_CACHE);
    if let Ok(dynamic_names) = find_table(&blocks, "bneD") {
        for row in 0..dynamic_names.valid_records {
            names.insert(dynamic_names.integer(row, "FuiB", 44_000)?, string(&dynamic_names, row, "vIys")?);
        }
    }
    let mut edited = HashMap::new();
    if let Ok(edited_names) = find_table(&blocks, "nQVU") {
        for row in 0..edited_names.valid_records {
            let player_id = edited_names.integer(row, "ykFq", 0)?;
            let common = string(&edited_names, row, "xnfZ")?;
            let first = string(&edited_names, row, "HdeP")?;
            let surname = string(&edited_names, row, "rREd")?;
            let value = if common.trim().is_empty() { format!("{first} {surname}").trim().to_owned() } else { common };
            edited.insert(player_id, value);
        }
    }

    let mut team_names = cache(TEAM_CACHE);
    for row in 0..teams.valid_records {
        let team_id = teams.integer(row, "mCXg", 1)?;
        let name = string(&teams, row, "AUsv")?;
        if !name.trim().is_empty() && !name.starts_with('*') { team_names.insert(team_id, name); }
    }
    team_names.insert(user_team, created_club_name(bytes, cursor).unwrap_or_else(|| save_label.to_owned()));

    let mut team_by_player = HashMap::new();
    for row in 0..links.valid_records {
        let player_id = links.integer(row, "ykFq", 0)?;
        let team_id = links.integer(row, "mCXg", 1)?;
        team_by_player.entry(player_id).or_insert(team_id);
    }

    let known_records = context.records.iter().map(|record| record.player_id).collect::<HashSet<_>>();
    let mut headers = vec![
        "playerid", "name", "club", "age", "positions", "preferredfoot", "scope", "knowledge",
        "overall", "value", "wage",
    ];
    headers.extend(ATTRIBUTE_FIELDS.iter().map(|(name, _)| *name));
    let mut output = format!("{}\n", headers.join(","));

    for row in 0..players.valid_records {
        let player_id = players.integer(row, "ykFq", 0)?;
        if player_id <= 0 { continue; }
        let current_team = team_by_player.get(&player_id).copied();
        let own_squad = current_team == Some(user_team);
        let name = player_name(
            player_id,
            players.integer(row, "tHlO", 0)?,
            players.integer(row, "QCfa", 0)?,
            players.integer(row, "HDYx", 0)?,
            &names, &edited,
        );
        let club = current_team.and_then(|id| team_names.get(&id).cloned()).unwrap_or_else(|| "Free Agents".into());
        let mut seen = HashSet::new();
        let mut positions = Vec::new();
        for (field, low) in [("wZQU", 0), ("NgVS", -1), ("OblE", -1), ("YnYz", -1)] {
            let position = players.integer(row, field, low)?;
            if let Some(label) = usize::try_from(position).ok().and_then(|index| POSITIONS.get(index)) {
                if seen.insert(*label) { positions.push(*label); }
            }
        }
        let primary_position = players.integer(row, "wZQU", 0)?;
        let age = player_age(players.integer(row, "WVIU", 0)?, context.current_date);
        let overall = players.integer(row, "UERs", 1)?;
        let potential = players.integer(row, "mpuH", 1)?;
        let value = age.map(|age| market_value(overall, potential, age, primary_position));
        let foot = match players.integer(row, "MDvm", 1)? { 1 => "Right", 2 => "Left", _ => "Unknown" };
        let scope = if own_squad { "My squad" } else { "Internal" };
        let knowledge = if own_squad { "Exact" } else { "Internal" };
        let mut values = vec![
            player_id.to_string(), name, club, age.map(|value| value.to_string()).unwrap_or_default(), positions.join("/"), foot.into(), scope.into(),
            knowledge.into(), overall.to_string(), value.map(|value| value.to_string()).unwrap_or_default(), String::new(),
        ];
        for (_, field) in ATTRIBUTE_FIELDS {
            values.push(players.integer(row, field, 1)?.to_string());
        }
        output.push_str(&values.iter().map(|value| csv_field(value)).collect::<Vec<_>>().join(","));
        output.push('\n');

        let player_id_u32 = player_id as u32;
        if !own_squad && !known_records.contains(&player_id_u32) {
            context.records.push(PlayerRevealRecord {
                player_id: player_id_u32, source: u16::MAX, progress: 0, flags: 0,
                date: 0, extra: u32::MAX, list_state: None,
            });
        }
    }
    Ok((output, context))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_name_cache_contains_reference_player() {
        let names = cache(NAME_CACHE);
        assert_eq!(names.get(&6097).map(String::as_str), Some("Cherif"));
        assert_eq!(names.get(&23171).map(String::as_str), Some("Ndiaye"));
        assert_eq!(cache(TEAM_CACHE).get(&234).map(String::as_str), Some("Benfica"));
    }

    #[test]
    fn calculates_reference_age_and_market_value() {
        assert_eq!(player_age(150_946, 20_220_901), Some(26));
        assert_eq!(market_value(74, 75, 26, 25), 6_500_000);
        assert_eq!(market_value(74, 76, 26, 25), 6_500_000);
        assert_eq!(market_value(74, 77, 26, 25), 6_500_000);
    }
}
