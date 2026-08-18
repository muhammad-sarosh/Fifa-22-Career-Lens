"""Build Career Lens' compact FIFA 22 name caches from an extracted game DB.

The input is a fifa_ng_db database extracted from the user's own FIFA install.
This development helper is never used to open or modify a career save.
"""

from __future__ import annotations

import argparse
import struct
from pathlib import Path

DB_SIGNATURE = b"DB\x00\x08\x00\x00\x00\x00"


def u16(data: bytes, offset: int) -> int:
    return struct.unpack_from("<H", data, offset)[0]


def u32(data: bytes, offset: int) -> int:
    return struct.unpack_from("<I", data, offset)[0]


def table(data: bytes, wanted: bytes):
    if data[:8] != DB_SIGNATURE or u32(data, 8) != len(data):
        raise ValueError("invalid fifa_ng_db input")
    count = u32(data, 16)
    tables_start = 24 + count * 8 + 4
    for index in range(count):
        entry = 24 + index * 8
        if data[entry : entry + 4] != wanted:
            continue
        start = tables_start + u32(data, entry + 4)
        record_size = u32(data, start + 4)
        valid_records = u16(data, start + 18)
        field_count = data[start + 24]
        fields = {}
        definitions = start + 36
        for field_index in range(field_count):
            field = definitions + field_index * 16
            fields[data[field + 8 : field + 12]] = (
                u32(data, field), u32(data, field + 4), u32(data, field + 12)
            )
        records = definitions + field_count * 16
        return record_size, valid_records, fields, records
    raise KeyError(wanted.decode("ascii"))


def bits(data: bytes, record: int, bit_offset: int, depth: int) -> int:
    value = 0
    for bit in range(depth):
        absolute = record + bit_offset + bit
        value |= ((data[absolute // 8] >> (absolute % 8)) & 1) << bit
    return value


def global_names(data: bytes) -> dict[int, str]:
    record_size, count, fields, records = table(data, b"BGwe")
    _, id_offset, id_depth = fields[b"FuiB"]
    name_type, name_offset, _ = fields[b"vIys"]
    # Type 13 is an external string heap reference. Its schema depth is the
    # maximum decoded string size; the packed record stores a 32-bit offset.
    if name_type != 13:
        raise ValueError("unexpected global-name offset layout")
    name_depth = 32
    ids, offsets = [], []
    for index in range(count):
        record = (records + index * record_size) * 8
        ids.append(bits(data, record, id_offset, id_depth))
        offsets.append(bits(data, record, name_offset, name_depth))
    valid = [(name_id, offset) for name_id, offset in zip(ids, offsets) if offset != 0xFFFFFFFF]
    records_end = records + record_size * count
    min_offset = min(offset for _, offset in valid)
    tree = [u16(data, records_end + index * 2) for index in range(min_offset // 2)]

    def decode(offset: int) -> str:
        start = records_end + offset
        length = data[start]
        output = bytearray()
        node = 0
        bit_position = 0
        byte_index = start + 1
        while len(output) < length:
            direction = (data[byte_index] >> (7 - bit_position)) & 1
            bit_position += 1
            if bit_position == 8:
                bit_position = 0
                byte_index += 1
            child = tree[2 * node + direction]
            if child < 0x100:
                node = child
            else:
                output.append(child >> 8)
                node = 0
        try:
            text = output.decode("utf-8")
        except UnicodeDecodeError:
            text = output.decode("cp1252", "replace")
        return text.replace("\t", " ").replace("\r", " ").replace("\n", " ")

    return {name_id: decode(offset) for name_id, offset in valid}


def global_teams(data: bytes) -> dict[int, str]:
    record_size, count, fields, records = table(data, b"lyxL")
    _, id_offset, id_depth = fields[b"mCXg"]
    _, name_offset, name_depth = fields[b"AUsv"]
    if name_offset % 8 or name_depth % 8:
        raise ValueError("unexpected team-name layout")
    result = {}
    for index in range(count):
        record_start = records + index * record_size
        team_id = bits(data, record_start * 8, id_offset, id_depth) + 1
        raw = data[
            record_start + name_offset // 8 :
            record_start + (name_offset + name_depth) // 8
        ]
        encoded = raw.split(b"\x00", 1)[0]
        try:
            name = encoded.decode("utf-8").strip()
        except UnicodeDecodeError:
            name = encoded.decode("cp1252", "replace").strip()
        if name and not name.startswith("*"):
            result[team_id] = name.replace("\t", " ").replace("\r", " ").replace("\n", " ")
    return result


def write_tsv(path: Path, values: dict[int, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(f"{key}\t{value}\n" for key, value in sorted(values.items())), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("database", type=Path)
    parser.add_argument("--out", type=Path, default=Path("src-tauri/resources"))
    args = parser.parse_args()
    data = args.database.read_bytes()
    names = global_names(data)
    teams = global_teams(data)
    write_tsv(args.out / "fifa22_names.tsv", names)
    write_tsv(args.out / "fifa22_teams.tsv", teams)
    print(f"wrote {len(names):,} names and {len(teams):,} teams to {args.out}")


if __name__ == "__main__":
    main()
