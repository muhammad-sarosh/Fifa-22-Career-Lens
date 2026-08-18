from pathlib import Path

from capstone import CS_ARCH_X86, CS_MODE_64, Cs

root = Path(__file__).resolve().parents[1]
data = (root / "diagnostics" / "gtn-range-code.bin").read_bytes()
base_text = (root / "diagnostics" / "gtn-range-code-base.txt").read_text().splitlines()
base = int(base_text[0], 16)
match = int(base_text[1].split("=", 1)[1], 16)

decoder = Cs(CS_ARCH_X86, CS_MODE_64)
decoder.detail = False
for instruction in decoder.disasm(data, base):
    if match - 0x500 <= instruction.address <= match + 0x300:
        marker = "  <MATCH>" if instruction.address == match else ""
        print(f"0x{instruction.address:016X}: {instruction.mnemonic:8} {instruction.op_str}{marker}")
