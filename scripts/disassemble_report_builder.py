from pathlib import Path
import sys

from capstone import CS_ARCH_X86, CS_MODE_64, Cs

root = Path(__file__).resolve().parents[1]
data = (root / "diagnostics" / "report-builder-code.bin").read_bytes()
meta = (root / "diagnostics" / "report-builder-code-base.txt").read_text().splitlines()
base = int(meta[0], 16)
target = int(sys.argv[1], 16) if len(sys.argv) > 1 else int(meta[1].split("=", 1)[1], 16)
offset = target - base

decoder = Cs(CS_ARCH_X86, CS_MODE_64)
for index, instruction in enumerate(decoder.disasm(data[offset:], target)):
    print(f"0x{instruction.address:016X}: {instruction.mnemonic:8} {instruction.op_str}")
    if instruction.mnemonic == "ret" or index >= 1800:
        break
