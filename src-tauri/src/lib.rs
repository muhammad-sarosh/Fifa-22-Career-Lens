use serde::Serialize;
mod offline_db;
mod offline_source;
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const DATABASE_HEADER: &[u8; 8] = b"DB\0\x08\0\0\0\0";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CareerSave {
    name: String,
    display_name: String,
    path: String,
    size: u64,
    modified_unix_ms: u128,
    is_autosave: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PickedCareer {
    save: CareerSave,
    csv: String,
}

fn career_display_name(path: &Path, fallback: &str) -> String {
    let Ok(mut file) = File::open(path) else { return fallback.to_owned(); };
    let mut header = [0u8; 96];
    let Ok(read) = file.read(&mut header) else { return fallback.to_owned(); };
    if read <= 18 || header.get(..8) != Some(b"FBCHUNKS") { return fallback.to_owned(); }
    let end = header[18..read].iter().position(|byte| *byte == 0).map(|offset| 18 + offset).unwrap_or(read);
    let label = String::from_utf8_lossy(&header[18..end]).trim().to_owned();
    if label.is_empty() || label.chars().any(char::is_control) { fallback.to_owned() } else { label }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveProbe {
    source_name: String,
    source_size: u64,
    database_sizes: Vec<u32>,
    database_tables: Vec<Vec<TableProbe>>,
    decoded_players: usize,
    decoded_player_fields: usize,
    decoded_team_links: usize,
    decoded_first_player_id: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TableProbe {
    short_name: String,
    valid_records: u16,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerRevealRecord {
    player_id: u32,
    source: u16,
    progress: u16,
    flags: u32,
    date: u32,
    extra: u32,
    list_state: Option<u32>,
}

struct RevealContext {
    records: Vec<PlayerRevealRecord>,
    seed_multiplier: u32,
    range_radii: [u32; 5],
    current_date: u32,
}

fn player_is_scouting(record: &PlayerRevealRecord) -> bool {
    record.list_state == Some(2) || record.source != u16::MAX
}

fn player_is_shortlisted(record: &PlayerRevealRecord) -> bool {
    record.list_state == Some(1)
        || (record.source != u16::MAX && (record.progress == 16 || record.flags == 204))
}

fn revealed_player_scope(record: &PlayerRevealRecord) -> &'static str {
    if player_is_shortlisted(record) { "Shortlist" }
    else if player_is_scouting(record) { "Scouting" }
    else { "Player search" }
}

#[cfg(any())]
mod fifa_memory {
    use super::{PlayerRevealRecord, RevealContext};
    use std::{collections::HashMap, ffi::OsString, mem::{size_of, size_of_val}, os::windows::ffi::OsStringExt};
    use windows_sys::Win32::{
        Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE},
        System::{
            Diagnostics::{
                Debug::ReadProcessMemory,
                ToolHelp::{
                    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
                    TH32CS_SNAPPROCESS,
                },
            },
            Memory::{VirtualQueryEx, MEMORY_BASIC_INFORMATION, MEM_COMMIT, PAGE_GUARD, PAGE_NOACCESS},
            ProcessStatus::{K32EnumProcessModules, K32GetModuleInformation, MODULEINFO},
            Threading::{OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ},
        },
    };

    const SIGNATURE: [Option<u8>; 19] = [
        Some(0x4C), Some(0x89), Some(0x3D), None, None, None, None,
        Some(0x48), Some(0x89), Some(0x3D), None, None, None, None,
        Some(0xEB), Some(0x03), Some(0x48), Some(0x8B), Some(0xC3),
    ];

    struct OwnedHandle(HANDLE);
    impl Drop for OwnedHandle {
        fn drop(&mut self) { unsafe { CloseHandle(self.0); } }
    }

    fn wide_name(value: &[u16]) -> String {
        let end = value.iter().position(|character| *character == 0).unwrap_or(value.len());
        OsString::from_wide(&value[..end]).to_string_lossy().into_owned()
    }

    fn fifa_process_id() -> Result<u32, String> {
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if snapshot == INVALID_HANDLE_VALUE {
            return Err(format!("Cannot enumerate processes: {}", std::io::Error::last_os_error()));
        }
        let snapshot = OwnedHandle(snapshot);
        let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
        entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        let mut ok = unsafe { Process32FirstW(snapshot.0, &mut entry) } != 0;
        while ok {
            if wide_name(&entry.szExeFile).eq_ignore_ascii_case("FIFA22.exe") { return Ok(entry.th32ProcessID); }
            ok = unsafe { Process32NextW(snapshot.0, &mut entry) } != 0;
        }
        Err("FIFA 22 is not running".into())
    }

    fn fifa_module(handle: HANDLE) -> Result<(u64, usize), String> {
        let mut modules = [std::ptr::null_mut(); 256];
        let mut needed = 0u32;
        let ok = unsafe {
            K32EnumProcessModules(
                handle,
                modules.as_mut_ptr(),
                size_of_val(&modules) as u32,
                &mut needed,
            )
        } != 0;
        if !ok || needed < size_of::<isize>() as u32 {
            return Err(format!("Cannot enumerate FIFA modules read-only: {}", std::io::Error::last_os_error()));
        }
        let module = modules[0];
        let mut info: MODULEINFO = unsafe { std::mem::zeroed() };
        let ok = unsafe { K32GetModuleInformation(handle, module, &mut info, size_of::<MODULEINFO>() as u32) } != 0;
        if !ok { return Err(format!("Cannot inspect FIFA22.exe module: {}", std::io::Error::last_os_error())); }
        Ok((info.lpBaseOfDll as usize as u64, info.SizeOfImage as usize))
    }

    fn read(handle: HANDLE, address: u64, size: usize) -> Result<Vec<u8>, String> {
        let mut bytes = vec![0u8; size];
        let mut read = 0usize;
        let ok = unsafe {
            ReadProcessMemory(handle, address as *const _, bytes.as_mut_ptr().cast(), size, &mut read)
        } != 0;
        if !ok || read != size { return Err(format!("Cannot read FIFA memory at 0x{address:X}")); }
        Ok(bytes)
    }

    fn u16_at(bytes: &[u8], offset: usize) -> Result<u16, String> {
        Ok(u16::from_le_bytes(bytes.get(offset..offset + 2).ok_or("Truncated FIFA module header")?.try_into().unwrap()))
    }
    fn u32_at(bytes: &[u8], offset: usize) -> Result<u32, String> {
        Ok(u32::from_le_bytes(bytes.get(offset..offset + 4).ok_or("Truncated FIFA memory")?.try_into().unwrap()))
    }
    fn u64_at(bytes: &[u8], offset: usize) -> Result<u64, String> {
        Ok(u64::from_le_bytes(bytes.get(offset..offset + 8).ok_or("Truncated FIFA memory")?.try_into().unwrap()))
    }
    fn read_u64(handle: HANDLE, address: u64) -> Result<u64, String> { u64_at(&read(handle, address, 8)?, 0) }

    fn scan_list_states(handle: HANDLE, compact_begin: u64, records: &[PlayerRevealRecord]) -> HashMap<u32, u32> {
        let expected = records.iter().map(|record| {
            (record.player_id, (u32::from(record.source), record.date, record.flags))
        }).collect::<HashMap<_, _>>();
        let mut states = HashMap::new();
        let scan_start = compact_begin.saturating_sub(16 * 1024 * 1024).max(0x1_0000);
        let scan_end = compact_begin.saturating_add(16 * 1024 * 1024);
        let mut address = scan_start;
        while address < scan_end {
            let mut info: MEMORY_BASIC_INFORMATION = unsafe { std::mem::zeroed() };
            let queried = unsafe {
                VirtualQueryEx(handle, address as *const _, &mut info, size_of::<MEMORY_BASIC_INFORMATION>())
            };
            if queried == 0 { break; }
            let base = info.BaseAddress as usize as u64;
            let region_end = base.saturating_add(info.RegionSize as u64);
            let read_start = base.max(scan_start);
            let read_end = region_end.min(scan_end);
            if info.State == MEM_COMMIT && info.Protect & (PAGE_GUARD | PAGE_NOACCESS) == 0 && read_end > read_start {
                if let Ok(bytes) = read(handle, read_start, (read_end - read_start) as usize) {
                    let first = ((4 - (read_start % 4)) % 4) as usize;
                    for offset in (first..bytes.len().saturating_sub(19)).step_by(4) {
                        let player_id = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap());
                        let Some((source, date, flags)) = expected.get(&player_id) else { continue; };
                        let candidate_source = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap());
                        let state = u32::from_le_bytes(bytes[offset + 8..offset + 12].try_into().unwrap());
                        let candidate_date = u32::from_le_bytes(bytes[offset + 12..offset + 16].try_into().unwrap());
                        let candidate_flags = u32::from_le_bytes(bytes[offset + 16..offset + 20].try_into().unwrap());
                        if candidate_source == *source
                            && matches!(state, 0 | 1 | 2 | u32::MAX)
                            && candidate_date == *date
                            && candidate_flags == *flags
                        {
                            states.entry(player_id).and_modify(|current| {
                                if state == 1 || (*current != 1 && state == 2) { *current = state; }
                            }).or_insert(state);
                        }
                    }
                }
            }
            if region_end <= address { break; }
            address = region_end;
        }
        states
    }

    fn signature_offset(bytes: &[u8]) -> Option<usize> {
        bytes.windows(SIGNATURE.len()).position(|window| {
            SIGNATURE.iter().zip(window).all(|(expected, actual)| expected.is_none_or(|value| value == *actual))
        })
    }

    fn scan_section(handle: HANDLE, start: u64, size: usize) -> Option<u64> {
        const CHUNK: usize = 4 * 1024 * 1024;
        let mut offset = 0usize;
        let mut tail = Vec::new();
        while offset < size {
            let count = CHUNK.min(size - offset);
            let Ok(chunk) = read(handle, start + offset as u64, count) else {
                offset = offset.saturating_add(0x1000);
                tail.clear();
                continue;
            };
            let tail_len = tail.len();
            tail.extend_from_slice(&chunk);
            if let Some(found) = signature_offset(&tail) {
                return Some(start + offset as u64 - tail_len as u64 + found as u64);
            }
            let keep = (SIGNATURE.len() - 1).min(tail.len());
            tail = tail[tail.len() - keep..].to_vec();
            offset += count;
        }
        None
    }

    #[cfg(test)]
    fn scan_exact(handle: HANDLE, start: u64, size: usize, pattern: &[u8]) -> Option<u64> {
        const CHUNK: usize = 4 * 1024 * 1024;
        let mut offset = 0usize;
        let mut tail = Vec::new();
        while offset < size {
            let count = CHUNK.min(size - offset);
            let Ok(chunk) = read(handle, start + offset as u64, count) else {
                offset += 0x1000;
                tail.clear();
                continue;
            };
            let tail_len = tail.len();
            tail.extend_from_slice(&chunk);
            if let Some(found) = tail.windows(pattern.len()).position(|window| window == pattern) {
                return Some(start + offset as u64 - tail_len as u64 + found as u64);
            }
            let keep = pattern.len().saturating_sub(1).min(tail.len());
            tail = tail[tail.len() - keep..].to_vec();
            offset += count;
        }
        None
    }

    pub(super) fn context() -> Result<RevealContext, String> {
        let process_id = fifa_process_id()?;
        let raw_handle = unsafe { OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, process_id) };
        if raw_handle.is_null() { return Err("Cannot open FIFA 22 with read-only permissions".into()); }
        let handle = OwnedHandle(raw_handle);
        let (module_base, module_size) = fifa_module(handle.0)?;

        let header = read(handle.0, module_base, 0x1000)?;
        let pe = u32_at(&header, 0x3C)? as usize;
        if header.get(pe..pe + 4) != Some(b"PE\0\0") { return Err("Invalid FIFA22.exe module header".into()); }
        let section_count = u16_at(&header, pe + 6)? as usize;
        let optional_size = u16_at(&header, pe + 20)? as usize;
        let section_table = pe + 24 + optional_size;
        let needed = section_table + section_count * 40;
        let headers = if needed <= header.len() { header } else { read(handle.0, module_base, needed)? };

        let mut signature = None;
        for index in 0..section_count {
            let section = section_table + index * 40;
            let virtual_size = u32_at(&headers, section + 8)? as usize;
            let virtual_address = u32_at(&headers, section + 12)? as u64;
            let characteristics = u32_at(&headers, section + 36)?;
            if characteristics & 0x2000_0000 == 0 || virtual_address as usize >= module_size { continue; }
            let bounded_size = virtual_size.min(module_size - virtual_address as usize);
            if let Some(found) = scan_section(handle.0, module_base + virtual_address, bounded_size) {
                signature = Some(found);
                break;
            }
        }
        let signature = signature.ok_or("FIFA mode-manager signature was not found")?;
        let instruction = read(handle.0, signature, SIGNATURE.len())?;
        let displacement = i32::from_le_bytes(instruction[3..7].try_into().unwrap()) as i64;
        let global_slot = (signature as i64 + 7 + displacement) as u64;
        let mode_managers = read_u64(handle.0, global_slot)?;
        let reveal_wrapper = read_u64(handle.0, mode_managers + 0x8F8)?;
        if reveal_wrapper == 0 { return Err("Load a Manager Career in FIFA 22 first".into()); }
        let reveal_manager = read_u64(handle.0, reveal_wrapper)?;
        if reveal_manager == 0 { return Err("Load a Manager Career in FIFA 22 first".into()); }

        let manager = read(handle.0, reveal_manager, 0x790)?;
        let begin = u64_at(&manager, 0x778)?;
        let end = u64_at(&manager, 0x780)?;
        let capacity = u64_at(&manager, 0x788)?;
        if begin == 0 || end < begin || capacity < end { return Err("Invalid FIFA reveal-record container".into()); }
        let byte_len = usize::try_from(end - begin).map_err(|_| "Reveal-record container is too large")?;
        if byte_len > 4 * 1024 * 1024 || byte_len % 20 != 0 { return Err("Unexpected FIFA reveal-record layout".into()); }
        let bytes = read(handle.0, begin, byte_len)?;
        let mut result = Vec::with_capacity(byte_len / 20);
        for record in bytes.chunks_exact(20) {
            let packed = u32_at(record, 4)?;
            result.push(PlayerRevealRecord {
                player_id: u32_at(record, 0)?,
                source: packed as u16,
                progress: (packed >> 16) as u16,
                flags: u32_at(record, 8)?,
                date: u32_at(record, 12)?,
                extra: u32_at(record, 16)?,
                list_state: None,
            });
        }
        let states = scan_list_states(handle.0, begin, &result);
        for record in &mut result { record.list_state = states.get(&record.player_id).copied(); }
        Ok(RevealContext {
            records: result,
            seed_multiplier: u32_at(&manager, 0x760)?,
            range_radii: [
                u32_at(&manager, 0x14C)?,
                u32_at(&manager, 0x150)?,
                u32_at(&manager, 0x154)?,
                u32_at(&manager, 0x158)?,
                u32_at(&manager, 0x15C)?,
            ],
        })
    }

    pub fn records() -> Result<Vec<PlayerRevealRecord>, String> {
        Ok(context()?.records)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn matches_signature_wildcards() {
            let mut bytes = vec![0x90; 40];
            for (index, value) in SIGNATURE.iter().enumerate() { bytes[7 + index] = value.unwrap_or(0xAA); }
            assert_eq!(signature_offset(&bytes), Some(7));
        }

        #[test]
        #[ignore = "requires FIFA 22 with a Manager Career loaded; process is opened read-only"]
        fn reads_running_career_reveal_records() {
            let records = records().expect("read-only FIFA reveal probe failed");
            assert!(!records.is_empty());
            assert!(records.iter().any(|record| record.player_id == 256903));
            println!("reveal_records={}", records.len());
            let mut groups = std::collections::BTreeMap::new();
            for record in &records {
                *groups.entry((record.source, record.progress, record.list_state)).or_insert(0usize) += 1;
            }
            println!("reveal_groups={groups:?}");
            for record in records.iter().filter(|record| [229354, 256903, 262083].contains(&record.player_id)) {
                println!("target={record:?}");
            }
        }

        #[test]
        #[ignore = "requires FIFA 22; dumps only read-only executable bytes for range-algorithm analysis"]
        fn dumps_gtn_range_code() {
            let process_id = fifa_process_id().unwrap();
            let raw_handle = unsafe { OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, process_id) };
            assert!(!raw_handle.is_null());
            let handle = OwnedHandle(raw_handle);
            let (module_base, module_size) = fifa_module(handle.0).unwrap();
            let header = read(handle.0, module_base, 0x1000).unwrap();
            let pe = u32_at(&header, 0x3C).unwrap() as usize;
            let section_count = u16_at(&header, pe + 6).unwrap() as usize;
            let optional_size = u16_at(&header, pe + 20).unwrap() as usize;
            let section_table = pe + 24 + optional_size;
            let mut found = None;
            for index in 0..section_count {
                let section = section_table + index * 40;
                let virtual_size = u32_at(&header, section + 8).unwrap() as usize;
                let virtual_address = u32_at(&header, section + 12).unwrap() as u64;
                let characteristics = u32_at(&header, section + 36).unwrap();
                if characteristics & 0x2000_0000 == 0 || virtual_address as usize >= module_size { continue; }
                if let Some(address) = scan_exact(handle.0, module_base + virtual_address, virtual_size.min(module_size - virtual_address as usize), &[0x8B, 0x8D, 0x9C, 0x02, 0x00, 0x00, 0x39]) { found = Some(address); break; }
            }
            let match_address = found.expect("GTN range signature not found");
            let dump_start = match_address - 0x6000;
            let bytes = read(handle.0, dump_start, 0x8000).unwrap();
            std::fs::write("../diagnostics/gtn-range-code.bin", bytes).unwrap();
            std::fs::write("../diagnostics/gtn-range-code-base.txt", format!("0x{dump_start:X}\nmatch=0x{match_address:X}\n")).unwrap();
            println!("base=0x{dump_start:X} match=0x{match_address:X}");
        }

        #[test]
        #[ignore = "requires FIFA 22; dumps only the read-only report-builder executable bytes"]
        fn dumps_report_builder_code() {
            let process_id = fifa_process_id().unwrap();
            let raw_handle = unsafe { OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, process_id) };
            assert!(!raw_handle.is_null());
            let handle = OwnedHandle(raw_handle);
            let (module_base, _) = fifa_module(handle.0).unwrap();
            let start = module_base + 0x634_8000;
            std::fs::write("../diagnostics/report-builder-code.bin", read(handle.0, start, 0x9000).unwrap()).unwrap();
            std::fs::write("../diagnostics/report-builder-code-base.txt", format!("0x{start:X}\ntarget=0x{:X}\n", module_base + 0x634_8CE0)).unwrap();
        }

        #[test]
        #[ignore = "requires FIFA 22; dumps only the read-only RNG executable bytes"]
        fn dumps_report_rng_code() {
            let process_id = fifa_process_id().unwrap();
            let raw_handle = unsafe { OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, process_id) };
            assert!(!raw_handle.is_null());
            let handle = OwnedHandle(raw_handle);
            let (module_base, _) = fifa_module(handle.0).unwrap();
            let start = module_base + 0x579_4000;
            std::fs::write("../diagnostics/report-rng-code.bin", read(handle.0, start, 0x1800).unwrap()).unwrap();
            std::fs::write("../diagnostics/report-rng-code-base.txt", format!("0x{start:X}\nseed=0x{:X}\nnext=0x{:X}\n", module_base + 0x579_4920, module_base + 0x579_4C70)).unwrap();

            let core_start = module_base + 0x0DD_0800;
            std::fs::write("../diagnostics/report-rng-core.bin", read(handle.0, core_start, 0x1800).unwrap()).unwrap();
            std::fs::write("../diagnostics/report-rng-core-base.txt", format!("0x{core_start:X}\ntarget=0x{:X}\n", module_base + 0x0DD_11E0)).unwrap();
        }

        #[test]
        #[ignore = "requires FIFA 22; reads only the scouting-range configuration"]
        fn reads_report_range_configuration() {
            let process_id = fifa_process_id().unwrap();
            let raw_handle = unsafe { OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, process_id) };
            assert!(!raw_handle.is_null());
            let handle = OwnedHandle(raw_handle);
            let (module_base, module_size) = fifa_module(handle.0).unwrap();
            let header = read(handle.0, module_base, 0x1000).unwrap();
            let pe = u32_at(&header, 0x3C).unwrap() as usize;
            let section_count = u16_at(&header, pe + 6).unwrap() as usize;
            let optional_size = u16_at(&header, pe + 20).unwrap() as usize;
            let section_table = pe + 24 + optional_size;
            let mut signature = None;
            for index in 0..section_count {
                let section = section_table + index * 40;
                let virtual_size = u32_at(&header, section + 8).unwrap() as usize;
                let virtual_address = u32_at(&header, section + 12).unwrap() as u64;
                let characteristics = u32_at(&header, section + 36).unwrap();
                if characteristics & 0x2000_0000 == 0 || virtual_address as usize >= module_size { continue; }
                if let Some(found) = scan_section(handle.0, module_base + virtual_address, virtual_size.min(module_size - virtual_address as usize)) {
                    signature = Some(found);
                    break;
                }
            }
            let signature = signature.unwrap();
            let instruction = read(handle.0, signature, SIGNATURE.len()).unwrap();
            let displacement = i32::from_le_bytes(instruction[3..7].try_into().unwrap()) as i64;
            let mode_managers = read_u64(handle.0, (signature as i64 + 7 + displacement) as u64).unwrap();
            let wrapper = read_u64(handle.0, mode_managers + 0x8F8).unwrap();
            let manager_address = read_u64(handle.0, wrapper).unwrap();
            let manager = read(handle.0, manager_address, 0x790).unwrap();
            let values = (0x130..=0x1d0).step_by(4).map(|offset| (offset, u32_at(&manager, offset).unwrap())).collect::<Vec<_>>();
            println!("manager=0x{manager_address:X} seed_multiplier={} values={values:X?}", u32_at(&manager, 0x760).unwrap());
        }

        #[test]
        #[ignore = "session-specific read-only report-object analysis"]
        fn dumps_ramos_report_object() {
            let process_id = fifa_process_id().unwrap();
            let raw_handle = unsafe { OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, process_id) };
            assert!(!raw_handle.is_null());
            let handle = OwnedHandle(raw_handle);
            let player_occurrence = 0x000000005BF429D0u64;
            let player = u32_at(&read(handle.0, player_occurrence, 4).unwrap(), 0).unwrap();
            assert_eq!(player, 256903, "session object moved");
            let base = player_occurrence - 0x400;
            std::fs::write("../diagnostics/ramos-report-object.bin", read(handle.0, base, 0x1000).unwrap()).unwrap();
            std::fs::write("../diagnostics/ramos-report-object-base.txt", format!("0x{base:X}\nplayer=0x{player_occurrence:X}\n")).unwrap();
        }

        #[test]
        #[ignore = "explicit read-only scan for FIFA's already-rendered scouting bounds"]
        fn finds_rendered_ramos_range_arrays() {
            let expected = [(77u32,87u32),(76,86),(73,83),(78,88),(79,89),(82,92),(63,73),(60,70),(55,65),(70,80),(67,77),(62,72),(65,75),(75,85),(34,44),(56,66),(58,68)];
            let process_id = fifa_process_id().unwrap();
            let raw_handle = unsafe { OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, process_id) };
            assert!(!raw_handle.is_null());
            let handle = OwnedHandle(raw_handle);
            let mut address = 0x5000_0000u64;
            let mut findings = Vec::new();
            while address < 0x7000_0000 {
                let mut info: MEMORY_BASIC_INFORMATION = unsafe { std::mem::zeroed() };
                let queried = unsafe { VirtualQueryEx(handle.0, address as *const _, &mut info, size_of::<MEMORY_BASIC_INFORMATION>()) };
                if queried == 0 { break; }
                let base = info.BaseAddress as usize as u64;
                let next = base.saturating_add(info.RegionSize as u64);
                if info.State == MEM_COMMIT && info.Protect & (PAGE_GUARD | PAGE_NOACCESS) == 0 {
                    let mut offset = 0usize;
                    while offset < info.RegionSize {
                        let count = (4 * 1024 * 1024 + 34 * 16).min(info.RegionSize - offset);
                        if let Ok(bytes) = read(handle.0, base + offset as u64, count) {
                            let mut checked = std::collections::HashSet::new();
                            for bounds in (8..bytes.len().saturating_sub(8)).step_by(4) {
                                let minimum = u32::from_le_bytes(bytes[bounds..bounds + 4].try_into().unwrap());
                                let maximum = u32::from_le_bytes(bytes[bounds + 4..bounds + 8].try_into().unwrap());
                                if !expected.contains(&(minimum, maximum)) { continue; }
                                let record = bounds - 8;
                                for position in 0usize..34 {
                                    let Some(start) = record.checked_sub(position * 16) else { continue; };
                                    if start + 34 * 16 > bytes.len() || !checked.insert(start) { continue; }
                                    let mut valid = 0usize;
                                    let mut matched = 0usize;
                                    for index in 0..34 {
                                        let item = start + index * 16;
                                        let attribute = u32::from_le_bytes(bytes[item..item + 4].try_into().unwrap());
                                        let state = u32::from_le_bytes(bytes[item + 4..item + 8].try_into().unwrap());
                                        let low = u32::from_le_bytes(bytes[item + 8..item + 12].try_into().unwrap());
                                        let high = u32::from_le_bytes(bytes[item + 12..item + 16].try_into().unwrap());
                                        if attribute < 128 && state <= 7 && low <= high && high <= 99 { valid += 1; }
                                        if expected.contains(&(low, high)) { matched += 1; }
                                    }
                                    if valid >= 30 && matched >= 8 { findings.push(base + offset as u64 + start as u64); }
                                }
                            }
                        }
                        offset = offset.saturating_add(4 * 1024 * 1024);
                    }
                }
                if next <= address { break; }
                address = next;
            }
            println!("findings={findings:X?}");
            assert!(!findings.is_empty());
        }
    }
}

fn fifa_settings_dir() -> Option<PathBuf> {
    let profile = std::env::var_os("USERPROFILE")?;
    Some(PathBuf::from(profile).join("Documents").join("FIFA 22").join("settings"))
}

#[tauri::command]
fn list_career_saves() -> Vec<CareerSave> {
    let Some(settings_dir) = fifa_settings_dir() else { return Vec::new(); };

    let Ok(entries) = fs::read_dir(settings_dir) else {
        return Vec::new();
    };
    let mut saves: Vec<CareerSave> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with("Career") { return None; }
            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() { return None; }
            let modified_unix_ms = metadata.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_millis();
            let path = entry.path();
            Some(CareerSave {
                is_autosave: name.ends_with('A'),
                display_name: career_display_name(&path, &name),
                path: path.to_string_lossy().into_owned(),
                name,
                size: metadata.len(),
                modified_unix_ms,
            })
        })
        .collect();
    saves.sort_by(|a, b| b.modified_unix_ms.cmp(&a.modified_unix_ms));
    saves
}

fn valid_career_name(name: &str) -> bool {
    name.starts_with("Career")
        && !name.contains(['/', '\\'])
        && name.chars().all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-')
}

fn scan_database_sizes(bytes: &[u8]) -> Result<Vec<u32>, String> {
    let mut sizes = Vec::new();
    let mut cursor = 0usize;

    while cursor + DATABASE_HEADER.len() <= bytes.len() {
        let Some(relative) = bytes[cursor..].windows(DATABASE_HEADER.len()).position(|window| window == DATABASE_HEADER) else { break; };
        let offset = cursor + relative;
        let size_offset = offset + DATABASE_HEADER.len();
        if size_offset + 4 > bytes.len() { return Err("Truncated database size field".into()); }
        let size = u32::from_le_bytes(bytes[size_offset..size_offset + 4].try_into().unwrap());
        if size < 12 { return Err("Invalid embedded database size".into()); }
        let end = offset.checked_add(size as usize).ok_or("Database size overflow")?;
        if end > bytes.len() { return Err("Embedded database extends beyond the copied save".into()); }
        sizes.push(size);
        cursor = end;
    }

    if sizes.is_empty() { return Err("No FIFA database blocks were found in the copied save".into()); }
    Ok(sizes)
}

fn read_u32_le(bytes: &[u8], offset: usize) -> Result<u32, String> {
    let raw: [u8; 4] = bytes.get(offset..offset + 4).ok_or("Truncated 32-bit database field")?.try_into().unwrap();
    Ok(u32::from_le_bytes(raw))
}

fn table_directory(database: &[u8]) -> Result<Vec<TableProbe>, String> {
    if database.get(..8) != Some(DATABASE_HEADER) { return Err("Invalid database header".into()); }
    let declared_size = read_u32_le(database, 8)? as usize;
    if declared_size != database.len() { return Err("Database block size mismatch".into()); }
    let table_count = read_u32_le(database, 16)? as usize;
    let entries_start = 24usize;
    let entries_end = entries_start.checked_add(table_count.checked_mul(8).ok_or("Table directory overflow")?).ok_or("Table directory overflow")?;
    if entries_end + 4 > database.len() { return Err("Truncated table directory".into()); }
    let tables_start = entries_end + 4;
    let mut result = Vec::with_capacity(table_count);

    for index in 0..table_count {
        let entry = entries_start + index * 8;
        let name_bytes = &database[entry..entry + 4];
        let short_name = String::from_utf8_lossy(name_bytes).into_owned();
        let relative_offset = read_u32_le(database, entry + 4)? as usize;
        let table = tables_start.checked_add(relative_offset).ok_or("Table offset overflow")?;
        let count_bytes: [u8; 2] = database.get(table + 18..table + 20).ok_or("Truncated table header")?.try_into().unwrap();
        result.push(TableProbe { short_name, valid_records: u16::from_le_bytes(count_bytes) });
    }
    Ok(result)
}

fn database_blocks<'a>(bytes: &'a [u8], sizes: &[u32]) -> Result<Vec<&'a [u8]>, String> {
    let mut blocks = Vec::with_capacity(sizes.len());
    let mut cursor = 0usize;
    for size in sizes {
        let relative = bytes[cursor..].windows(DATABASE_HEADER.len()).position(|window| window == DATABASE_HEADER).ok_or("Database block disappeared")?;
        let offset = cursor + relative;
        let end = offset.checked_add(*size as usize).ok_or("Database size overflow")?;
        blocks.push(bytes.get(offset..end).ok_or("Truncated database block")?);
        cursor = end;
    }
    Ok(blocks)
}

fn copy_read_only(source: &Path, destination: &Path) -> io::Result<u64> {
    let mut input = OpenOptions::new().read(true).write(false).open(source)?;
    let mut output = OpenOptions::new().create_new(true).write(true).open(destination)?;
    let copied = io::copy(&mut input, &mut output)?;
    output.flush()?;
    output.sync_all()?;
    Ok(copied)
}

fn parse_csv_row(line: &str) -> Result<Vec<String>, String> {
    let mut fields = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut characters = line.trim_end_matches('\r').chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '"' if quoted && characters.peek() == Some(&'"') => { field.push('"'); characters.next(); }
            '"' => quoted = !quoted,
            ',' if !quoted => { fields.push(std::mem::take(&mut field)); }
            _ => field.push(character),
        }
    }
    if quoted { return Err("The player source contains an unterminated CSV quote".into()); }
    fields.push(field);
    Ok(fields)
}

fn csv_field(value: &str) -> String {
    if value.contains([',', '"', '\r', '\n']) { format!("\"{}\"", value.replace('"', "\"\"")) } else { value.to_owned() }
}

// FIFA builds scouting ranges in this internal attribute-enum order.  The Live
// The UI uses a friendlier display order, so range RNG must
// be consumed through this list and then written back to the matching columns.
#[cfg(windows)]
const FIFA_ATTRIBUTE_ORDER: [&str; 34] = [
    "acceleration", "sprintspeed", "agility", "balance", "jumping", "stamina",
    "strength", "reactions", "aggression", "composure", "interceptions",
    "attackingposition", "vision", "ballcontrol", "crossing", "dribbling",
    "finishing", "freekickaccuracy", "headingaccuracy", "longpassing",
    "shortpassing", "marking", "shotpower", "longshots", "standingtackle",
    "slidingtackle", "volleys", "curve", "penalties", "gkdiving", "gkhandling",
    "gkkicking", "gkreflexes", "gkpositioning",
];

#[cfg(windows)]
fn fifa_random_below_99(state: &mut u32) -> u32 {
    loop {
        let product = u64::from(*state).wrapping_mul(0x41C6_4E6D).wrapping_add(0x3039);
        *state = product as u32;
        let sample = (product >> 16) as u32;
        let remainder = sample % 99;
        if sample.wrapping_add(98).wrapping_sub(remainder) >= sample { return remainder; }
    }
}

#[cfg(windows)]
fn scouting_states(exact: &[Option<u32>], positions: &str, knowledge: u32) -> Vec<u32> {
    let goalkeeper = positions.split('/').any(|position| position.trim() == "GK");
    let relevant_range = if goalkeeper { 29..34 } else { 0..29 };
    let mut ranked = relevant_range.filter(|index| exact.get(*index).is_some_and(Option::is_some)).collect::<Vec<_>>();
    ranked.sort_by(|left, right| exact[*right].cmp(&exact[*left]).then_with(|| left.cmp(right)));
    let count = ranked.len() as u32;
    let mut states = vec![1u32; exact.len()];
    if count == 0 || knowledge == 0 { return states; }
    if knowledge >= count * 6 {
        for index in ranked { states[index] = 7; }
    } else if knowledge <= count {
        for index in ranked.into_iter().take(knowledge as usize) { states[index] = 2; }
    } else {
        let advanced = knowledge - count;
        let level = advanced / count;
        let remainder = (advanced % count) as usize;
        for (rank, index) in ranked.into_iter().enumerate() {
            states[index] = if rank < remainder { level + 3 } else { level + 2 };
        }
    }
    states
}

#[cfg(windows)]
fn sanitize_player_source(content: &str, context: &RevealContext) -> Result<String, String> {
    use std::collections::HashMap;
    let mut lines = content.lines();
    let header_line = lines.next().ok_or("The player source is empty")?;
    let headers = parse_csv_row(header_line)?;
    let column = |name: &str| headers.iter().position(|header| header == name).ok_or_else(|| format!("Missing player column: {name}"));
    let player_id_column = column("playerid")?;
    let scope_column = column("scope")?;
    let shortlisted_column = column("shortlisted")?;
    let scouting_column = column("scouting")?;
    let positions_column = column("positions")?;
    let knowledge_column = column("knowledge")?;
    let overall_column = column("overall")?;
    let potential_column = column("potential")?;
    let value_column = column("value")?;
    let wage_column = column("wage")?;
    let attribute_start = column("ballcontrol")?;
    let exported_attributes = headers[attribute_start..].iter().enumerate().map(|(index, name)| (attribute_start + index, name.as_str())).collect::<Vec<_>>();
    let attribute_columns = FIFA_ATTRIBUTE_ORDER.map(|name| headers.iter().position(|header| header == name));
    if context.range_radii.iter().any(|radius| *radius > 20) {
        return Err("FIFA's scouting-range configuration is not recognized".into());
    }
    let records = context.records.iter().map(|record| (record.player_id, record)).collect::<HashMap<_, _>>();
    let mut output = String::with_capacity(content.len());
    output.push_str(header_line.trim_end_matches('\r'));
    output.push('\n');
    for line in lines {
        if line.trim().is_empty() { continue; }
        let mut fields = parse_csv_row(line)?;
        if fields.len() != headers.len() { return Err("The player source contains a malformed row".into()); }
        let player_id = fields[player_id_column].parse::<u32>().map_err(|_| "The player source contains an invalid player ID")?;
        let own_squad = fields[scope_column] == "My squad";
        let youth_academy = fields[scope_column] == "Youth academy";
        if !own_squad && !youth_academy {
            let calculated_overall = fields[overall_column].clone();
            let calculated_value = fields[value_column].clone();
            fields[overall_column].clear();
            fields[potential_column].clear();
            fields[value_column].clear();
            fields[wage_column].clear();
            if let Some(record) = records.get(&player_id) {
                fields[scope_column] = revealed_player_scope(record).into();
                fields[shortlisted_column] = player_is_shortlisted(record).to_string();
                fields[scouting_column] = player_is_scouting(record).to_string();
                let exact = attribute_columns.iter().map(|column| column.and_then(|index| fields[index].parse::<u32>().ok())).collect::<Vec<_>>();
                let states = scouting_states(&exact, &fields[positions_column], record.flags);
                let mut random_state = context.seed_multiplier.wrapping_mul(player_id);
                let mut visible = 0usize;
                let mut all_exact = true;
                for (attribute_index, field_index) in attribute_columns.iter().enumerate() {
                    let random = fifa_random_below_99(&mut random_state);
                    let state = states[attribute_index];
                    let Some(field_index) = *field_index else { continue; };
                    let Some(rating) = exact[attribute_index] else { fields[field_index].clear(); continue; };
                    if state >= 7 {
                        fields[field_index] = rating.to_string();
                        visible += 1;
                    } else if state >= 2 {
                        let radius = context.range_radii[(state - 2) as usize];
                        let span = radius * 2 + 1;
                        let offset = (u64::from(span) * u64::from(random) / 99) as i32;
                        let minimum = (rating as i32 + offset - (radius * 2) as i32).clamp(1, 99);
                        let maximum = (rating as i32 + offset).clamp(1, 99);
                        fields[field_index] = format!("{minimum}-{maximum}");
                        visible += 1;
                        all_exact = false;
                    } else {
                        fields[field_index].clear();
                    }
                }
                fields[knowledge_column] = if visible == 0 { "Unknown" } else if all_exact { "Exact" } else { "Ranged" }.into();
                if visible > 0 && all_exact {
                    fields[overall_column] = calculated_overall;
                    fields[value_column] = calculated_value;
                }
            } else {
                fields[scope_column] = "Other".into();
                fields[knowledge_column] = "Unknown".into();
                for &(index, _) in &exported_attributes { fields[index].clear(); }
            }
        }
        output.push_str(&fields.iter().map(|field| csv_field(field)).collect::<Vec<_>>().join(","));
        output.push('\n');
    }
    Ok(output)
}

#[tauri::command]
fn probe_career_save(save_name: String) -> Result<SaveProbe, String> {
    if !valid_career_name(&save_name) { return Err("Invalid career filename".into()); }
    let settings_dir = fifa_settings_dir().ok_or("Windows profile directory is unavailable")?;
    let source = settings_dir.join(&save_name);
    let before = fs::metadata(&source).map_err(|error| format!("Cannot read save metadata: {error}"))?;
    if !before.is_file() { return Err("Career save is not a file".into()); }

    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "System clock error")?.as_nanos();
    let copy_dir = std::env::temp_dir().join("career-lens-readonly");
    fs::create_dir_all(&copy_dir).map_err(|error| format!("Cannot create temporary directory: {error}"))?;
    let copy_path = copy_dir.join(format!("{save_name}.{nonce}.copy"));

    let result = (|| {
        let copied = copy_read_only(&source, &copy_path).map_err(|error| format!("Cannot create read-only working copy: {error}"))?;
        let after = fs::metadata(&source).map_err(|error| format!("Cannot recheck save metadata: {error}"))?;
        let before_modified = before.modified().ok();
        let after_modified = after.modified().ok();
        if copied != before.len() || after.len() != before.len() || before_modified != after_modified {
            return Err("FIFA changed the save while it was being copied; save again and retry".into());
        }

        let mut bytes = Vec::with_capacity(copied as usize);
        File::open(&copy_path).and_then(|mut file| file.read_to_end(&mut bytes)).map_err(|error| format!("Cannot read working copy: {error}"))?;
        let database_sizes = scan_database_sizes(&bytes)?;
        let blocks = database_blocks(&bytes, &database_sizes)?;
        let database_tables = blocks.iter().copied().map(table_directory).collect::<Result<Vec<_>, _>>()?;
        let mut decoded_players = 0usize;
        let mut decoded_player_fields = 0usize;
        let mut decoded_team_links = 0usize;
        let mut decoded_first_player_id = None;
        for database in blocks {
            if let Some(players) = offline_db::open_table(database, "CZUM")? {
                decoded_players = players.valid_records;
                decoded_player_fields = players.fields.len();
                if players.valid_records > 0 {
                    decoded_first_player_id = Some(players.integer(0, "ykFq", 0)?);
                }
            }
            if let Some(links) = offline_db::open_table(database, "RrqT")? {
                decoded_team_links = links.valid_records;
            }
        }
        Ok(SaveProbe {
            source_name: save_name.clone(), source_size: copied, database_sizes, database_tables,
            decoded_players, decoded_player_fields, decoded_team_links, decoded_first_player_id,
        })
    })();

    // This path is generated inside Career Lens's own temp directory and never points at a FIFA save.
    let _ = fs::remove_file(&copy_path);
    result
}

fn read_offline_career_path(source: &Path) -> Result<String, String> {
    let save_name = source.file_name().and_then(|name| name.to_str()).ok_or("Invalid career filename")?.to_owned();
    if !valid_career_name(&save_name) { return Err("Select an unmodified FIFA career file whose name starts with Career".into()); }
    let before = fs::metadata(&source).map_err(|error| format!("Cannot read save metadata: {error}"))?;
    if !before.is_file() { return Err("Career save is not a file".into()); }
    if before.len() > 100 * 1024 * 1024 { return Err("The career save is unexpectedly large".into()); }

    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "System clock error")?.as_nanos();
    let copy_dir = std::env::temp_dir().join("career-lens-readonly");
    fs::create_dir_all(&copy_dir).map_err(|error| format!("Cannot create temporary directory: {error}"))?;
    let copy_path = copy_dir.join(format!("{save_name}.{nonce}.offline.copy"));

    let result = (|| {
        let copied = copy_read_only(&source, &copy_path).map_err(|error| format!("Cannot create read-only working copy: {error}"))?;
        let after = fs::metadata(&source).map_err(|error| format!("Cannot recheck save metadata: {error}"))?;
        if copied != before.len() || after.len() != before.len() || before.modified().ok() != after.modified().ok() {
            return Err("FIFA changed the save while it was being copied; save again and retry".into());
        }

        let bytes = fs::read(&copy_path).map_err(|error| format!("Cannot read working copy: {error}"))?;
        let save_label = career_display_name(&source, &save_name);
        let (raw_csv, context) = offline_source::raw_csv_and_context(&bytes, &save_label)?;
        sanitize_player_source(&raw_csv, &context)
    })();

    // Career Lens only deletes the uniquely named copy it created in its own temp directory.
    let _ = fs::remove_file(&copy_path);
    result
}

#[tauri::command]
#[cfg(test)]
fn read_offline_career_export(save_name: String) -> Result<String, String> {
    if !valid_career_name(&save_name) { return Err("Invalid career filename".into()); }
    let source = fifa_settings_dir().ok_or("Windows profile directory is unavailable")?.join(save_name);
    read_offline_career_path(&source)
}

#[tauri::command]
fn read_career_save(path: String) -> Result<String, String> {
    read_offline_career_path(Path::new(&path))
}

#[tauri::command]
async fn pick_career_save(app: tauri::AppHandle) -> Result<Option<PickedCareer>, String> {
    use tauri_plugin_dialog::DialogExt;
    let mut dialog = app.dialog().file().set_title("Select a FIFA 22 career save");
    if let Some(settings) = fifa_settings_dir() { dialog = dialog.set_directory(settings); }
    let Some(selected) = dialog.blocking_pick_file() else { return Ok(None); };
    let path = selected.into_path().map_err(|error| format!("The selected item is not a local file: {error}"))?;
    let csv = read_offline_career_path(&path)?;
    let metadata = fs::metadata(&path).map_err(|error| format!("Cannot read save metadata: {error}"))?;
    let name = path.file_name().and_then(|name| name.to_str()).ok_or("Invalid career filename")?.to_owned();
    let modified_unix_ms = metadata.modified().ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok()).map(|duration| duration.as_millis()).unwrap_or(0);
    Ok(Some(PickedCareer {
        save: CareerSave {
            display_name: career_display_name(&path, &name), path: path.to_string_lossy().into_owned(),
            is_autosave: name.ends_with('A'), name, size: metadata.len(), modified_unix_ms,
        },
        csv,
    }))
}

#[tauri::command]
async fn save_markdown_export(
    app: tauri::AppHandle,
    contents: String,
    suggested_name: String,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    if contents.len() > 10_000_000 {
        return Err("The comparison export is unexpectedly large".into());
    }
    let safe_name = if suggested_name.to_ascii_lowercase().ends_with(".md") {
        suggested_name
    } else {
        format!("{suggested_name}.md")
    };
    let Some(selected) = app
        .dialog()
        .file()
        .set_title("Export Career Lens comparison")
        .add_filter("Markdown", &["md"])
        .set_file_name(safe_name)
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let path = selected
        .into_path()
        .map_err(|error| format!("The selected destination is not a local file: {error}"))?;
    fs::write(path, contents).map_err(|error| format!("Could not save the comparison: {error}"))?;
    Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Career-save commands only list saves, open a user-selected save, and decode verified temporary copies.
    // The only write command exports user-generated Markdown to a destination explicitly chosen by the user.
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_career_saves,
            probe_career_save,
            read_career_save,
            pick_career_save,
            save_markdown_export
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Career Lens");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database_block(size: u32) -> Vec<u8> {
        let mut block = vec![0u8; size as usize];
        block[..8].copy_from_slice(DATABASE_HEADER);
        block[8..12].copy_from_slice(&size.to_le_bytes());
        block
    }

    #[test]
    fn finds_multiple_declared_database_blocks() {
        let mut save = vec![9, 8, 7];
        save.extend(database_block(24));
        save.extend([1, 2, 3, 4]);
        save.extend(database_block(32));
        assert_eq!(scan_database_sizes(&save).unwrap(), vec![24, 32]);
    }

    #[test]
    fn reads_empty_table_directory() {
        let mut database = database_block(28);
        database[16..20].copy_from_slice(&0u32.to_le_bytes());
        assert!(table_directory(&database).unwrap().is_empty());
    }

    #[test]
    fn rejects_database_block_outside_copy() {
        let mut save = database_block(20);
        save[8..12].copy_from_slice(&200u32.to_le_bytes());
        assert!(scan_database_sizes(&save).is_err());
    }

    #[test]
    fn sanitizes_saved_visibility_before_frontend_delivery() {
        let source = "playerid,name,club,age,positions,preferredfoot,scope,shortlisted,scouting,knowledge,overall,potential,value,wage,ballcontrol,interceptions,standingtackle\n256903,Ramos,Benfica,,ST,Right,Internal,false,false,Internal,75,,,,72,30,28\n7,Own Player,Frens,,CM,Right,My squad,false,false,Exact,80,,,,81,72,70\n8,Hidden Player,Other,,CM,Right,Internal,false,false,Internal,70,,,,74,63,62\n";
        let context = RevealContext {
            records: vec![PlayerRevealRecord { player_id: 256903, source: 0, progress: 16, flags: 1, date: 20220808, extra: u32::MAX, list_state: Some(1) }],
            seed_multiplier: 12345,
            range_radii: [5, 5, 4, 3, 2],
            current_date: 20220901,
        };
        let output = sanitize_player_source(source, &context).unwrap();
        let rows = output.lines().map(|line| parse_csv_row(line).unwrap()).collect::<Vec<_>>();
        assert_eq!(rows[1][6], "Shortlist");
        assert_eq!(rows[1][7], "true");
        assert_eq!(rows[1][8], "true");
        assert_eq!(rows[1][9], "Ranged");
        assert_eq!(rows[1][10], "");
        assert!(rows[1][14].contains('-'));
        assert_eq!(rows[1][15], "");
        assert_eq!(rows[2][10], "80");
        assert_eq!(rows[3][6], "Other");
        assert_eq!(rows[3][14], "");
    }

    #[test]
    fn classifies_transfer_hub_records_from_saved_flags() {
        let record = |source, progress, flags, list_state| PlayerRevealRecord {
            player_id: 1,
            source,
            progress,
            flags,
            date: 0,
            extra: 0,
            list_state,
        };
        assert_eq!(revealed_player_scope(&record(2, 0, 204, None)), "Shortlist");
        assert_eq!(revealed_player_scope(&record(3, 16, 29, None)), "Shortlist");
        assert_eq!(revealed_player_scope(&record(1, 8, 29, None)), "Scouting");
        assert_eq!(revealed_player_scope(&record(u16::MAX, 0, 0, None)), "Player search");
        let dual = record(2, 0, 204, None);
        assert!(player_is_shortlisted(&dual));
        assert!(player_is_scouting(&dual));
    }

    #[test]
    #[ignore = "requires the user's Random FIFA 22 save; original is copied and opened read-only"]
    fn validates_random_shortlist_and_youth_academy() {
        let name = std::env::var("CAREER_LENS_TEST_SAVE").expect("CAREER_LENS_TEST_SAVE must be set");
        let output = read_offline_career_export(name).expect("offline export failed");
        let mut lines = output.lines();
        let headers = parse_csv_row(lines.next().expect("header missing")).unwrap();
        let player_name = headers.iter().position(|header| header == "name").unwrap();
        let scope = headers.iter().position(|header| header == "scope").unwrap();
        let shortlisted = headers.iter().position(|header| header == "shortlisted").unwrap();
        let scouting = headers.iter().position(|header| header == "scouting").unwrap();
        let potential = headers.iter().position(|header| header == "potential").unwrap();
        let rows = lines.map(|line| parse_csv_row(line).unwrap()).collect::<Vec<_>>();

        for expected in ["Burgzorg", "Thorstvedt", "Kovalenko", "Hove", "Hjulsager", "Marcondes", "Chaplin", "Navarro", "Amallah", "Vlap", "Maziz", "Păun"] {
            assert!(rows.iter().any(|row| {
                row[player_name].contains(expected)
                    && row[scope] == "Shortlist"
                    && row[shortlisted] == "true"
                    && row[scouting] == "true"
            }), "{expected} was not classified as both shortlisted and scouted");
        }

        let academy = rows.iter().filter(|row| row[scope] == "Youth academy").collect::<Vec<_>>();
        assert_eq!(academy.len(), 4);
        assert!(academy.iter().all(|row| row[potential].contains('-')));

    }


    #[test]
    #[cfg(any())]
    #[ignore = "requires FIFA 22 with the matching career and Live Editor source loaded; read-only"]
    fn validates_current_sanitized_live_export() {
        let output = read_live_editor_export().expect("live export sanitization failed");
        let mut rows = output.lines();
        let headers = parse_csv_row(rows.next().unwrap()).unwrap();
        let player_id = headers.iter().position(|header| header == "playerid").unwrap();
        let scope = headers.iter().position(|header| header == "scope").unwrap();
        let knowledge = headers.iter().position(|header| header == "knowledge").unwrap();
        let overall = headers.iter().position(|header| header == "overall").unwrap();
        let marking = headers.iter().position(|header| header == "marking").unwrap();
        let rows = rows.map(|line| parse_csv_row(line).unwrap()).collect::<Vec<_>>();
        let ramos = rows.iter().find(|row| row[player_id] == "256903").expect("Ramos missing from export");
        let ferati = rows.iter().find(|row| row[player_id] == "229354").expect("Ferati missing from export");
        assert!(matches!(ramos[scope].as_str(), "Shortlist" | "Player search"));
        assert_eq!(ramos[knowledge], "Ranged");
        assert!(ramos[overall].is_empty());
        assert!(ramos[marking].is_empty());
        let expected = [
            ("acceleration", "77-87"), ("sprintspeed", "76-86"),
            ("agility", "73-83"), ("balance", "78-88"), ("jumping", "79-89"),
            ("stamina", "82-92"), ("strength", "79-89"), ("reactions", "73-83"),
            ("aggression", "63-73"), ("composure", "60-70"),
            ("attackingposition", "70-80"), ("vision", "55-65"),
            ("ballcontrol", "67-77"), ("crossing", "62-72"),
            ("dribbling", "67-77"), ("finishing", "65-75"),
            ("freekickaccuracy", "34-44"), ("headingaccuracy", "75-85"),
            ("longpassing", "62-72"), ("shortpassing", "70-80"),
            ("shotpower", "64-74"), ("longshots", "70-80"),
            ("volleys", "68-78"), ("curve", "56-66"), ("penalties", "58-68"),
        ];
        for (name, range) in expected {
            let index = headers.iter().position(|header| header == name).unwrap();
            assert_eq!(ramos[index], range, "range mismatch for {name}");
        }
        for name in ["interceptions", "marking", "standingtackle", "slidingtackle"] {
            let index = headers.iter().position(|header| header == name).unwrap();
            assert!(ramos[index].is_empty(), "{name} should still be unknown");
        }
        assert_eq!(ramos[scope], "Shortlist");
        assert_eq!(ferati[scope], "Scouting");
        let marte = rows.iter().find(|row| row[player_id] == "262083").expect("Martegani missing from export");
        assert_eq!(marte[scope], "Shortlist");
        println!("validated {} sanitized players against all visible Ramos ranges; Ferati knowledge={}", output.lines().count() - 1, ferati[knowledge]);
    }

    #[test]
    #[ignore = "requires an explicitly selected local save; original is copied and opened read-only"]
    fn validates_complete_offline_export() {
        let name = std::env::var("CAREER_LENS_TEST_SAVE").expect("CAREER_LENS_TEST_SAVE must be set");
        let output = read_offline_career_export(name).expect("offline export failed");
        let mut lines = output.lines();
        let headers = parse_csv_row(lines.next().expect("header missing")).unwrap();
        let player_id = headers.iter().position(|header| header == "playerid").unwrap();
        let player_name = headers.iter().position(|header| header == "name").unwrap();
        let club = headers.iter().position(|header| header == "club").unwrap();
        let age = headers.iter().position(|header| header == "age").unwrap();
        let scope = headers.iter().position(|header| header == "scope").unwrap();
        let knowledge = headers.iter().position(|header| header == "knowledge").unwrap();
        let acceleration = headers.iter().position(|header| header == "acceleration").unwrap();
        let value = headers.iter().position(|header| header == "value").unwrap();
        let rows = lines.map(|line| parse_csv_row(line).unwrap()).collect::<Vec<_>>();
        assert!(rows.len() > 19_000);

        let ndiaye = rows.iter().find(|row| row[player_id] == "237179").expect("Ndiaye missing");
        assert_eq!(ndiaye[player_name], "Cherif Ndiaye");
        assert_eq!(ndiaye[club], "Frens FC");
        assert_eq!(ndiaye[scope], "My squad");
        assert_eq!(ndiaye[age], "26");
        assert_eq!(ndiaye[value], "6500000");
        assert_eq!(ndiaye[acceleration], "74");


        let ramos = rows.iter().find(|row| row[player_id] == "256903").expect("Ramos missing");
        assert_eq!(ramos[player_name], "Gonçalo Ramos");
        assert_eq!(ramos[club], "SL Benfica");
        assert_eq!(ramos[scope], "Shortlist");
        assert_eq!(ramos[knowledge], "Ranged");
        assert_eq!(ramos[acceleration], "77-87");

        let ferati = rows.iter().find(|row| row[player_id] == "229354").expect("Ferati missing");
        assert_eq!(ferati[scope], "Scouting");
        assert_eq!(ferati[acceleration], "78-86");
        let marte = rows.iter().find(|row| row[player_id] == "262083").expect("Martegani missing");
        assert_eq!(marte[scope], "Shortlist");
        assert_eq!(marte[acceleration], "71-81");
    }

    #[test]
    #[ignore = "requires local FIFA 22 career saves; each original is copied and opened read-only"]
    fn decodes_every_local_career_save() {
        let saves = list_career_saves();
        assert!(!saves.is_empty(), "no career saves found");
        for save in saves {
            let output = read_offline_career_export(save.name.clone())
                .unwrap_or_else(|error| panic!("{} failed: {error}", save.display_name));
            let players = output.lines().count().saturating_sub(1);
            assert!(players > 19_000, "{} decoded only {players} players", save.display_name);
            if save.name == "Career20260818054718" {
                let ndiaye = output.lines().find(|line| line.starts_with("237179,")).expect("Ndiaye missing");
                assert!(ndiaye.contains(",Frens FC,"), "generic slot label replaced the actual club name");
            }
            println!("{}: {players} players", save.display_name);
        }
    }

    #[test]
    fn restricts_names_to_career_files() {
        assert!(valid_career_name("Career20260818030101"));
        assert!(!valid_career_name("../Career20260818030101"));
        assert!(!valid_career_name("Settings20260818030101"));
    }

    #[test]
    #[ignore = "requires an explicitly selected local save; original is opened read-only"]
    fn probes_explicit_local_save_via_temporary_copy() {
        let name = std::env::var("CAREER_LENS_TEST_SAVE").expect("CAREER_LENS_TEST_SAVE must be set");
        let result = probe_career_save(name).expect("read-only probe failed");
        println!("source={} size={} databases={:?}", result.source_name, result.source_size, result.database_sizes);
        for (index, tables) in result.database_tables.iter().enumerate() {
            let populated: Vec<_> = tables.iter().filter(|table| table.valid_records > 0).map(|table| format!("{}:{}", table.short_name, table.valid_records)).collect();
            println!("database[{index}] populated={}", populated.join(","));
        }
        assert!(!result.database_sizes.is_empty());
        assert!(result.decoded_players > 19_000);
        assert!(result.decoded_player_fields > 40);
        assert!(result.decoded_team_links > 6_000);
    }

    #[test]
    #[ignore = "requires an explicitly selected local save; original is copied and opened read-only"]
    fn decodes_known_player_attributes_from_offline_save() {
        let name = std::env::var("CAREER_LENS_TEST_SAVE").expect("CAREER_LENS_TEST_SAVE must be set");
        assert!(valid_career_name(&name));
        let source = fifa_settings_dir().unwrap().join(&name);
        let copy_path = std::env::temp_dir().join("career-lens-readonly").join(format!("{name}.decoder-test.copy"));
        fs::create_dir_all(copy_path.parent().unwrap()).unwrap();
        if copy_path.exists() { fs::remove_file(&copy_path).unwrap(); }
        copy_read_only(&source, &copy_path).expect("save copy failed");
        let bytes = fs::read(&copy_path).expect("working copy read failed");
        fs::remove_file(&copy_path).ok();
        let sizes = scan_database_sizes(&bytes).unwrap();
        let blocks = database_blocks(&bytes, &sizes).unwrap();
        let players = blocks.iter().find_map(|block| offline_db::open_table(block, "CZUM").transpose()).expect("players table missing").expect("players table invalid");
        let id_field = players.field("ykFq").expect("playerid field missing").clone();
        let ndiaye = (0..players.valid_records).find(|index| {
            players.value(*index, &id_field) == Ok(offline_db::FieldValue::Integer(237_179))
        }).expect("Cherif Ndiaye missing from offline players table");
        let expected = [
            ("UERs", 1, 74), ("MgwU", 1, 78), ("nEbM", 1, 69),
            ("xJZL", 1, 77), ("SPge", 1, 74), ("NrcP", 1, 79),
        ];
        for (short_name, range_low, value) in expected {
            assert_eq!(players.integer(ndiaye, short_name, range_low).unwrap(), value, "mismatch for {short_name}");
        }
        let first_name_id = players.integer(ndiaye, "tHlO", 0).unwrap();
        let last_name_id = players.integer(ndiaye, "QCfa", 0).unwrap();
        let common_name_id = players.integer(ndiaye, "HDYx", 0).unwrap();
        assert!(players.field("WVIU").is_some(), "birthdate field missing");

        let links = blocks.iter().find_map(|block| offline_db::open_table(block, "RrqT").transpose()).expect("team links missing").expect("team links invalid");
        let linked_row = (0..links.valid_records).find(|index| links.integer(*index, "ykFq", 0) == Ok(237_179)).expect("Ndiaye team link missing");
        let team_id = links.integer(linked_row, "mCXg", 1).unwrap();
        assert_eq!(team_id, 115_486);

        let teams = blocks.iter().find_map(|block| offline_db::open_table(block, "lyxL").transpose()).expect("teams table missing").expect("teams table invalid");
        let team_row = (0..teams.valid_records).find(|index| teams.integer(*index, "mCXg", 1) == Ok(team_id)).expect("Frens FC team row missing");
        let team_name_field = teams.field("AUsv").expect("teamname field missing");
        let offline_db::FieldValue::String(team_name) = teams.value(team_row, team_name_field).unwrap() else { panic!("teamname was not a string") };
        // Created clubs store a localization token here. Career Lens can replace
        // the user's own token with the save header label ("Frens FC"); resolving
        // every stock club still requires FIFA's external localization assets.
        assert_eq!(team_name, "*TeamName_Abbr15_115486");
        assert_eq!(career_display_name(&source, &name), "Frens FC");
        println!("decoded player 237179 at row {ndiaye}, names={first_name_id}/{last_name_id}/{common_name_id}, team {team_id} ({team_name}), from {} packed records", players.valid_records);
    }

}
