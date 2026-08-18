"""Research helper: locate FIFA's packed scouting/reveal array in a save copy."""

from __future__ import annotations

import argparse
import csv
import struct
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("save", type=Path)
    parser.add_argument("player_csv", type=Path)
    args = parser.parse_args()
    players = {int(row["playerid"]) for row in csv.DictReader(args.player_csv.open(encoding="utf-8-sig"))}
    data = args.save.read_bytes()
    signature = b"DB\x00\x08\x00\x00\x00\x00"
    cursor = 0
    database_end = 0
    while True:
        offset = data.find(signature, cursor)
        if offset < 0:
            break
        size = struct.unpack_from("<I", data, offset + 8)[0]
        database_end = max(database_end, offset + size)
        cursor = offset + size

    def valid(offset: int) -> bool:
        player_id, packed, flags, date, extra = struct.unpack_from("<IIIII", data, offset)
        source = packed & 0xFFFF
        progress = packed >> 16
        return (
            0 < player_id <= 500000
            and (source <= 16 or source == 0xFFFF)
            and progress <= 100
            and flags <= 4096
            and (date == 0 or 20080101 <= date <= 20601231)
            and extra == 0xFFFFFFFF
        )

    runs = []
    for phase in range(20):
        run_start = None
        count = 0
        for offset in range(database_end + phase, len(data) - 19, 20):
            if valid(offset):
                if run_start is None:
                    run_start = offset
                count += 1
            else:
                if count >= 3:
                    runs.append((count, run_start, offset))
                run_start, count = None, 0
        if count >= 3:
            runs.append((count, run_start, len(data)))
    for count, start, end in sorted(runs, reverse=True)[:30]:
        print(f"count={count} start={start} end={end}")
        for offset in range(start, min(end, start + 5 * 20), 20):
            player_id, packed, flags, date, extra = struct.unpack_from("<IIIII", data, offset)
            print(" ", player_id, packed & 0xFFFF, packed >> 16, flags, date, extra)


if __name__ == "__main__":
    main()
