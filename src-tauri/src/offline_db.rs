//! Read-only decoder for the embedded databases in FIFA career saves.
//!
//! This module deliberately has no write/pack support. Callers should pass a
//! database block extracted from a temporary copy of a save file.

use std::collections::HashMap;

const DATABASE_HEADER: &[u8; 8] = b"DB\0\x08\0\0\0\0";
const TABLE_HEADER_SIZE: usize = 36;
const FIELD_DEFINITION_SIZE: usize = 16;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct FieldDefinition {
    pub field_type: u32,
    pub bit_offset: u32,
    pub short_name: String,
    pub bit_depth: u32,
}

#[derive(Debug)]
pub(crate) struct Table<'a> {
    pub short_name: String,
    pub valid_records: usize,
    pub record_size: usize,
    pub fields: Vec<FieldDefinition>,
    records: &'a [u8],
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum FieldValue {
    String(String),
    Integer(u64),
    FloatBits(u32),
}

fn u16_at(bytes: &[u8], offset: usize) -> Result<u16, String> {
    let raw: [u8; 2] = bytes.get(offset..offset + 2).ok_or("Truncated 16-bit database field")?.try_into().unwrap();
    Ok(u16::from_le_bytes(raw))
}

fn u32_at(bytes: &[u8], offset: usize) -> Result<u32, String> {
    let raw: [u8; 4] = bytes.get(offset..offset + 4).ok_or("Truncated 32-bit database field")?.try_into().unwrap();
    Ok(u32::from_le_bytes(raw))
}

fn short_name(bytes: &[u8], offset: usize) -> Result<String, String> {
    let raw = bytes.get(offset..offset + 4).ok_or("Truncated database short name")?;
    if !raw.iter().all(u8::is_ascii) { return Err("Invalid non-ASCII database short name".into()); }
    Ok(String::from_utf8_lossy(raw).into_owned())
}

fn table_locations(database: &[u8]) -> Result<HashMap<String, usize>, String> {
    if database.get(..8) != Some(DATABASE_HEADER) { return Err("Invalid database header".into()); }
    let declared_size = u32_at(database, 8)? as usize;
    if declared_size != database.len() { return Err("Database block size mismatch".into()); }
    let table_count = u32_at(database, 16)? as usize;
    let entries_start = 24usize;
    let entries_size = table_count.checked_mul(8).ok_or("Table directory overflow")?;
    let entries_end = entries_start.checked_add(entries_size).ok_or("Table directory overflow")?;
    let tables_start = entries_end.checked_add(4).ok_or("Table directory overflow")?;
    if tables_start > database.len() { return Err("Truncated table directory".into()); }

    let mut locations = HashMap::with_capacity(table_count);
    for index in 0..table_count {
        let entry = entries_start + index * 8;
        let name = short_name(database, entry)?;
        let relative = u32_at(database, entry + 4)? as usize;
        let absolute = tables_start.checked_add(relative).ok_or("Table offset overflow")?;
        if absolute > database.len().saturating_sub(TABLE_HEADER_SIZE) {
            return Err(format!("Table {name} points beyond the database block"));
        }
        locations.insert(name, absolute);
    }
    Ok(locations)
}

pub(crate) fn open_table<'a>(database: &'a [u8], wanted: &str) -> Result<Option<Table<'a>>, String> {
    let locations = table_locations(database)?;
    let Some(&start) = locations.get(wanted) else { return Ok(None); };
    let record_size = u32_at(database, start + 4)? as usize;
    let valid_records = u16_at(database, start + 18)? as usize;
    let field_count = *database.get(start + 24).ok_or("Truncated table field count")? as usize;
    if record_size == 0 && valid_records != 0 { return Err(format!("Table {wanted} has zero-sized records")); }

    let definitions_start = start + TABLE_HEADER_SIZE;
    let definitions_size = field_count.checked_mul(FIELD_DEFINITION_SIZE).ok_or("Field directory overflow")?;
    let records_start = definitions_start.checked_add(definitions_size).ok_or("Field directory overflow")?;
    let records_size = valid_records.checked_mul(record_size).ok_or("Record data overflow")?;
    let records_end = records_start.checked_add(records_size).ok_or("Record data overflow")?;
    let records = database.get(records_start..records_end).ok_or_else(|| format!("Table {wanted} record data is truncated"))?;

    let mut fields = Vec::with_capacity(field_count);
    for index in 0..field_count {
        let field = definitions_start + index * FIELD_DEFINITION_SIZE;
        let definition = FieldDefinition {
            field_type: u32_at(database, field)?,
            bit_offset: u32_at(database, field + 4)?,
            short_name: short_name(database, field + 8)?,
            bit_depth: u32_at(database, field + 12)?,
        };
        let field_end = definition.bit_offset.checked_add(definition.bit_depth).ok_or("Field bit range overflow")? as usize;
        if field_end > record_size.saturating_mul(8) {
            return Err(format!("Field {} extends beyond {wanted}'s record", definition.short_name));
        }
        fields.push(definition);
    }
    fields.sort_by_key(|field| field.bit_offset);

    Ok(Some(Table { short_name: wanted.to_owned(), valid_records, record_size, fields, records }))
}

impl Table<'_> {
    fn record(&self, index: usize) -> Result<&[u8], String> {
        if index >= self.valid_records { return Err(format!("Record {index} is outside table {}", self.short_name)); }
        let start = index.checked_mul(self.record_size).ok_or("Record offset overflow")?;
        Ok(&self.records[start..start + self.record_size])
    }

    pub(crate) fn field(&self, short_name: &str) -> Option<&FieldDefinition> {
        self.fields.iter().find(|field| field.short_name == short_name)
    }

    pub(crate) fn value(&self, record_index: usize, field: &FieldDefinition) -> Result<FieldValue, String> {
        let record = self.record(record_index)?;
        match field.field_type {
            0 => {
                if field.bit_offset % 8 != 0 || field.bit_depth % 8 != 0 {
                    return Err(format!("String field {} is not byte-aligned", field.short_name));
                }
                let start = (field.bit_offset / 8) as usize;
                let end = start + (field.bit_depth / 8) as usize;
                let raw = &record[start..end];
                let length = raw.iter().position(|byte| *byte == 0).unwrap_or(raw.len());
                Ok(FieldValue::String(String::from_utf8_lossy(&raw[..length]).into_owned()))
            }
            3 => {
                if field.bit_depth > 64 { return Err(format!("Integer field {} is wider than 64 bits", field.short_name)); }
                let mut value = 0u64;
                for bit in 0..field.bit_depth as usize {
                    let absolute = field.bit_offset as usize + bit;
                    let set = (record[absolute / 8] >> (absolute % 8)) & 1;
                    value |= u64::from(set) << bit;
                }
                Ok(FieldValue::Integer(value))
            }
            4 => {
                if field.bit_depth != 32 || field.bit_offset % 8 != 0 {
                    return Err(format!("Float field {} has an unsupported layout", field.short_name));
                }
                let start = (field.bit_offset / 8) as usize;
                Ok(FieldValue::FloatBits(u32::from_le_bytes(record[start..start + 4].try_into().unwrap())))
            }
            kind => Err(format!("Unsupported field type {kind} for {}", field.short_name)),
        }
    }

    pub(crate) fn integer(&self, record_index: usize, field_short_name: &str, range_low: i64) -> Result<i64, String> {
        let field = self.field(field_short_name).ok_or_else(|| format!("Table {} has no field {field_short_name}", self.short_name))?;
        let FieldValue::Integer(raw) = self.value(record_index, field)? else {
            return Err(format!("Field {field_short_name} is not an integer"));
        };
        i64::try_from(raw).map_err(|_| "Decoded integer is too large".to_string())?.checked_add(range_low).ok_or("Decoded integer overflow".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_lsb_first_integer_across_bytes() {
        let table = Table {
            short_name: "test".into(),
            valid_records: 1,
            record_size: 2,
            fields: vec![FieldDefinition { field_type: 3, bit_offset: 5, short_name: "bits".into(), bit_depth: 8 }],
            records: &[0b1010_0000, 0b0001_0101],
        };
        assert_eq!(table.integer(0, "bits", -3).unwrap(), 170);
    }
}
