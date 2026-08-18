"""Read-only research helper: locate playervalues.ini in FIFA 22 CAS blocks."""
import ctypes
import struct
import sys
import zlib
from pathlib import Path

GAME = Path(r"D:\SteamLibrary\steamapps\common\FIFA 22")
DLL = GAME / "oo2core_8_win64.dll"
MARKERS = (b"[RATINGRANGE]", b"RATING_1_VAL", b"GK_AGE_MOD")

oodle_dll = ctypes.WinDLL(str(DLL))
decompress = oodle_dll.OodleLZ_Decompress
decompress.restype = ctypes.c_longlong
decompress.argtypes = [ctypes.c_void_p, ctypes.c_longlong, ctypes.c_void_p, ctypes.c_longlong,
                       ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_void_p, ctypes.c_longlong,
                       ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_longlong, ctypes.c_int]

def oodle(payload: bytes, size: int) -> bytes:
    raw = ctypes.create_string_buffer(size)
    count = decompress(payload, len(payload), raw, size, 1, 0, 0, None, 0, None, None, None, 0, 3)
    if count != size:
        raise ValueError
    return raw.raw[:size]

def scan(path: Path) -> bool:
    size = path.stat().st_size
    with path.open("rb") as source:
        position = 0
        failures = 0
        while position + 8 <= size:
            source.seek(position)
            header = source.read(8)
            raw_size = struct.unpack_from(">I", header)[0]
            code = struct.unpack_from(">H", header, 4)[0]
            kind = (code >> 8) & 0xFF
            compressed_size = ((code & 0x0F) << 16) | struct.unpack_from(">H", header, 6)[0]
            if raw_size == 0 or raw_size > 0x40000 or compressed_size == 0 or compressed_size > 0x80000:
                position += 1
                failures += 1
                if failures > 100_000:
                    break
                continue
            payload_size = compressed_size
            payload = source.read(payload_size)
            try:
                block = payload[:raw_size] if kind == 0 else zlib.decompress(payload) if kind == 2 else oodle(payload, raw_size)
            except Exception:
                position += 1
                failures += 1
                continue
            failures = 0
            if any(marker in block for marker in MARKERS):
                print(f"FOUND {path} block={position} size={len(block)}")
                print(block.decode("utf-8", "replace"))
                return True
            position += 8 + payload_size
    return False

for argument in sys.argv[1:]:
    candidate = Path(argument)
    print(f"Scanning {candidate}")
    if scan(candidate):
        break
