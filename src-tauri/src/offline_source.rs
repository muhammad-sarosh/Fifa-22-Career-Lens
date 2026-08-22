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
    // Exact FIFA 22 RATINGRANGE bands. A band is selected by the first
    // threshold greater than or equal to the player's overall.
    const VALUES_51_TO_100: [i64; 50] = [
        50_000,68_000,80_000,92_000,108_000,122_000,140_000,174_000,192_000,210_000,
        280_000,340_000,410_000,500_000,610_000,730_000,870_000,1_030_000,1_190_000,
        1_360_000,1_600_000,2_000_000,2_600_000,3_600_000,4_800_000,6_400_000,
        9_000_000,12_000_000,15_000_000,18_000_000,22_000_000,26_000_000,31_000_000,
        36_000_000,46_000_000,58_000_000,68_000_000,78_000_000,88_000_000,
        102_000_000,112_000_000,126_000_000,142_000_000,154_000_000,170_000_000,
        184_000_000,210_000_000,224_000_000,250_000_000,400_000_000,
    ];
    match overall {
        i64::MIN..=5 => 20_000,
        6..=40 => 30_000,
        41..=50 => 40_000,
        51..=100 => VALUES_51_TO_100[(overall - 51) as usize],
        _ => VALUES_51_TO_100[VALUES_51_TO_100.len() - 1],
    }
}

fn round_market_value_ratio(numerator: i128, denominator: i128) -> i64 {
    let divisor = if numerator <= 5_000 * denominator { 50 }
        else if numerator <= 10_000 * denominator { 1_000 }
        else if numerator <= 50_000 * denominator { 5_000 }
        else if numerator <= 250_000 * denominator { 10_000 }
        else if numerator <= 1_000_000 * denominator { 25_000 }
        else if numerator <= 5_000_000 * denominator { 100_000 }
        else { 500_000 };
    let step = i128::from(divisor) * denominator;
    let remainder = numerator % step;
    let rounded = if remainder > step / 2 { numerator + step - remainder } else { numerator - remainder };
    (rounded / denominator) as i64
}

fn potential_modifier(remaining: i64) -> i64 {
    match remaining {
        i64::MIN..=0 => 0,
        1 => 10,
        2 => 17,
        3 => 25,
        4 => 33,
        5 => 42,
        6 => 50,
        7 => 100,
        8..=11 => 125,
        12..=15 => 150,
        16..=19 => 175,
        20 => 200,
        21..=25 => 250,
        26..=30 => 350,
        31..=40 => 450,
        _ => 500,
    }
}

fn age_modifier(age: u32, goalkeeper: bool) -> i64 {
    // FIFA 22 caps the valuation age for goalkeepers at 35. This behavior is
    // confirmed by every goalkeeper in the launch database, including ages 36-43.
    let age = if goalkeeper { age.min(35) } else { age };
    match age {
        0..=17 => 12,
        18 => 17,
        19 => 23,
        20 => 27,
        21..=22 => 33,
        23..=24 => 30,
        25 => 25,
        26 => 23,
        27 => 20,
        28 => 13,
        29 => 10,
        30 => 8,
        31 => -8,
        32 => -12,
        33 => -32,
        34 => -50,
        35 => -57,
        36..=40 => -67,
        41..=50 => -80,
        _ => -100,
    }
}

fn market_value_in_currency(
    overall: i64, potential: i64, age: u32, position: i64,
    currency_numerator: i64, currency_denominator: i64,
) -> i64 {
    const POSITION: [i64; 28] = [-30,0,-7,-7,-12,-12,-12,-7,-7,-10,-10,-10,5,4,4,4,5,5,5,5,7,7,7,5,7,7,7,5];
    let base = overall_base_value(overall);
    let position_percent = POSITION.get(position as usize).copied().unwrap_or(0);
    let total_percent = 100 + position_percent + potential_modifier(potential - overall)
        + age_modifier(age, position == 0);
    let numerator = i128::from(base) * i128::from(currency_numerator) * i128::from(total_percent);
    let denominator = i128::from(currency_denominator) * 100;
    let value = round_market_value_ratio(numerator, denominator);
    if value < 0 {
        ((i128::from(base) * i128::from(currency_numerator)
            / i128::from(currency_denominator) / 10) as i64).max(10_000)
    } else {
        value.max(10_000)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FifaCurrency {
    Dollars,
    Euros,
    Sterling,
}

impl FifaCurrency {
    fn from_save_code(code: i64) -> Result<Self, String> {
        match code {
            0 => Ok(Self::Dollars),
            1 => Ok(Self::Euros),
            2 => Ok(Self::Sterling),
            _ => Err(format!("FIFA save uses an unknown currency code: {code}")),
        }
    }

    fn code(self) -> &'static str {
        match self {
            Self::Dollars => "USD",
            Self::Euros => "EUR",
            Self::Sterling => "GBP",
        }
    }

    fn ratio(self) -> (i64, i64) {
        match self {
            Self::Dollars => (118, 100),
            Self::Euros => (100, 100),
            Self::Sterling => (88, 100),
        }
    }
}

fn market_value(overall: i64, potential: i64, age: u32, position: i64, currency: FifaCurrency) -> i64 {
    let (numerator, denominator) = currency.ratio();
    market_value_in_currency(overall, potential, age, position, numerator, denominator)
}

fn youth_potential_range(potential: i64, months_in_squad: i64, swing_low: i64) -> String {
    // FIFA does not store the two displayed endpoints. A newly signed academy
    // player starts with a broad band around the hidden potential. Over the
    // first six months that band moves towards the saved swing-adjusted centre
    // and settles at the six-point range shown by a fully known prospect.
    //
    // `potentialvariance` is an internal generation/narrowing state, not the
    // visible half-width. Treating it as a spread produced inverted or exact
    // ranges for newly signed players.
    let initial_minimum = if potential >= 75 {
        (potential - 8).max(75)
    } else {
        (potential - 8).max(1)
    };
    let initial_maximum = if potential >= 75 {
        94
    } else {
        (potential + 13).min(94)
    };
    let settled_centre = (potential + swing_low).clamp(1, 94);
    let settled_minimum = (settled_centre - 3).max(1);
    let settled_maximum = (settled_centre + 3).min(94);
    let progress = months_in_squad.clamp(0, 6);
    let interpolate = |start: i64, end: i64| {
        (start * (6 - progress) + end * progress + 3) / 6
    };
    let minimum = interpolate(initial_minimum, settled_minimum);
    let maximum = interpolate(initial_maximum, settled_maximum).max(minimum);
    format!("{minimum}-{maximum}")
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
    let manager_preferences = find_table(&blocks, "dqXv")?;
    let currency = FifaCurrency::from_save_code(manager_preferences.integer(0, "UtVA", 0)?)?;
    let user_team = users.integer(0, "NTyS", -1)?;

    // Career contracts contain the current weekly wage for players whose
    // contracts are persisted by the active career. This includes the user's
    // squad and can include players involved in career transactions.
    let mut wage_by_player = HashMap::new();
    if let Some(contracts) = blocks.iter().find_map(|block| offline_db::open_table(block, "DvsP").transpose()).transpose()? {
        for row in 0..contracts.valid_records {
            let player_id = contracts.integer(row, "ykFq", 0)?;
            let wage = contracts.integer(row, "cmGX", 0)?;
            if player_id > 0 && wage >= 0 { wage_by_player.insert(player_id, wage); }
        }
    }

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

    let mut youth_by_player = HashMap::new();
    if let Some(youth) = blocks.iter().find_map(|block| offline_db::open_table(block, "IOmq").transpose()).transpose()? {
        for row in 0..youth.valid_records {
            youth_by_player.insert(
                youth.integer(row, "ykFq", 0)?,
                (youth.integer(row, "Otjv", 0)?, youth.integer(row, "vYeO", -10)?),
            );
        }
    }

    let known_records = context.records.iter().map(|record| record.player_id).collect::<HashSet<_>>();
    let mut headers = vec![
        "playerid", "name", "club", "age", "positions", "preferredfoot", "scope", "shortlisted", "scouting", "knowledge",
        "overall", "potential", "value", "wage", "currency",
    ];
    headers.extend(ATTRIBUTE_FIELDS.iter().map(|(name, _)| *name));
    let mut output = format!("{}\n", headers.join(","));

    for row in 0..players.valid_records {
        let player_id = players.integer(row, "ykFq", 0)?;
        if player_id <= 0 { continue; }
        let current_team = team_by_player.get(&player_id).copied();
        let own_squad = current_team == Some(user_team);
        let youth = youth_by_player.get(&player_id).copied();
        let name = player_name(
            player_id,
            players.integer(row, "tHlO", 0)?,
            players.integer(row, "QCfa", 0)?,
            players.integer(row, "HDYx", 0)?,
            &names, &edited,
        );
        let club = if youth.is_some() {
            team_names.get(&user_team).cloned().unwrap_or_else(|| save_label.to_owned())
        } else {
            current_team.and_then(|id| team_names.get(&id).cloned()).unwrap_or_else(|| "Free Agents".into())
        };
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
        let value = if youth.is_some() { None } else { age.map(|age| market_value(overall, potential, age, primary_position, currency)) };
        let visible_potential = youth.map(|(months, swing)| youth_potential_range(potential, months, swing)).unwrap_or_default();
        let foot = match players.integer(row, "MDvm", 1)? { 1 => "Right", 2 => "Left", _ => "Unknown" };
        let scope = if youth.is_some() { "Youth academy" } else if own_squad { "My squad" } else { "Internal" };
        let knowledge = if youth.is_some() || own_squad { "Exact" } else { "Internal" };
        let mut values = vec![
            player_id.to_string(), name, club, age.map(|value| value.to_string()).unwrap_or_default(), positions.join("/"), foot.into(), scope.into(),
            "false".into(), "false".into(), knowledge.into(), overall.to_string(), visible_potential, value.map(|value| value.to_string()).unwrap_or_default(), wage_by_player.get(&player_id).map(ToString::to_string).unwrap_or_default(), currency.code().into(),
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
        assert_eq!(market_value_in_currency(74, 75, 26, 25, 100, 100), 5_000_000);
        assert_eq!(market_value_in_currency(74, 75, 26, 5, 100, 100), 4_400_000);
        assert_eq!(market_value(74, 75, 26, 25, FifaCurrency::Dollars), 6_000_000);
        assert_eq!(market_value(74, 76, 26, 25, FifaCurrency::Dollars), 6_000_000);
        assert_eq!(market_value(74, 77, 26, 25, FifaCurrency::Dollars), 6_500_000);
        assert_eq!(market_value(60, 76, 18, 18, FifaCurrency::Dollars), 725_000);
        assert_eq!(market_value(60, 80, 18, 18, FifaCurrency::Dollars), 800_000);
        assert_eq!(market_value(60, 81, 18, 18, FifaCurrency::Dollars), 925_000);
        assert_eq!(market_value(74, 75, 26, 25, FifaCurrency::Euros), 5_000_000);
        assert_eq!(market_value(74, 75, 26, 25, FifaCurrency::Sterling), 4_400_000);
        assert_eq!(FifaCurrency::from_save_code(0).unwrap(), FifaCurrency::Dollars);
        assert_eq!(FifaCurrency::from_save_code(1).unwrap(), FifaCurrency::Euros);
        assert_eq!(FifaCurrency::from_save_code(2).unwrap(), FifaCurrency::Sterling);
        assert!(FifaCurrency::from_save_code(3).is_err());
        assert_eq!(market_value_in_currency(86, 86, 36, 0, 100, 100), 7_500_000);
        assert_eq!(market_value_in_currency(79, 79, 34, 12, 100, 100), 8_000_000);
        // Visible FIFA 22 academy ranges from the same save. These cover both
        // newly signed prospects and players whose reports have fully narrowed.
        assert_eq!(youth_potential_range(82, 0, 3), "75-94");
        assert_eq!(youth_potential_range(81, 0, 4), "75-94");
        assert_eq!(youth_potential_range(86, 0, 5), "78-94");
        assert_eq!(youth_potential_range(86, 6, 1), "84-90");
        assert_eq!(youth_potential_range(89, 6, 1), "87-93");
        assert_eq!(youth_potential_range(87, 6, 1), "85-91");
    }

    #[test]
    fn matches_fifa_22_dollar_values_across_squad_profiles() {
        // These cover goalkeepers, defenders, midfielders and attackers over
        // varied ages, ratings and potential gaps. They guard the global FIFA
        // 22 dollar conversion and display rounding, not individual players.
        let cases = [
            (64, 64, 24, 14, 800_000),
            (65, 70, 19, 14, 1_200_000),
            (69, 69, 22, 3, 1_800_000),
            (67, 67, 31, 7, 875_000),
            (72, 72, 30, 12, 2_700_000),
            (71, 71, 28, 25, 2_300_000),
            (62, 74, 34, 16, 825_000),
            (58, 90, 17, 10, 1_100_000),
            (57, 60, 22, 16, 275_000),
            (66, 66, 23, 25, 1_200_000),
            (65, 65, 23, 0, 725_000),
            (56, 69, 18, 21, 400_000),
            (70, 70, 24, 5, 1_900_000),
            (75, 79, 23, 25, 9_500_000),
            (73, 76, 24, 18, 4_900_000),
            (76, 79, 23, 14, 12_000_000),
            (77, 77, 27, 25, 13_500_000),
            (78, 83, 22, 16, 25_500_000),
            (75, 75, 25, 27, 7_500_000),
            (63, 66, 21, 25, 800_000),
            (58, 68, 18, 0, 425_000),
            (75, 75, 30, 14, 6_500_000),
            (75, 75, 32, 14, 5_000_000),
            (73, 73, 29, 7, 3_200_000),
            (68, 68, 32, 5, 925_000),
            (75, 75, 33, 0, 2_200_000),
            (75, 75, 28, 5, 5_500_000),
            (71, 73, 26, 5, 2_400_000),
        ];
        for (overall, potential, age, position, expected) in cases {
            assert_eq!(market_value(overall, potential, age, position, FifaCurrency::Dollars), expected);
        }
    }
}
