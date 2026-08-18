from pathlib import Path
import struct

root = Path(__file__).resolve().parents[1]
data = (root / "diagnostics" / "ramos-report-object.bin").read_bytes()
base = int((root / "diagnostics" / "ramos-report-object-base.txt").read_text().splitlines()[0], 16)

for offset in range(0, len(data) - 34 * 4, 4):
    values = struct.unpack_from("<34I", data, offset)
    if len(set(values)) >= 30 and all(value < 64 for value in values):
        print(f"candidate_ids=0x{base + offset:X} offset=0x{offset:X} {values}")

needles = {
    "physical-min-screen": bytes([77, 76, 73, 78, 79, 82, 79, 73]),
    "physical-max-screen": bytes([87, 86, 83, 88, 89, 92, 89, 83]),
}
for label, needle in needles.items():
    start = 0
    while True:
        found = data.find(needle, start)
        if found < 0:
            break
        print(f"{label}=0x{base + found:X} offset=0x{found:X}")
        start = found + 1
