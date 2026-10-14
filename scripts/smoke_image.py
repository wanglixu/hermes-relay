"""造一张左红右蓝的测试图，再带着它跑一轮，验证原生识图。

    /usr/local/lib/hermes-agent/venv/bin/python scripts/smoke_image.py
"""
import struct
import sys
import time
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import agent_bridge  # noqa: E402
import sessions  # noqa: E402


def make_png(path: Path, w: int = 120, h: int = 80) -> Path:
    rows = []
    for _y in range(h):
        row = bytearray()
        for x in range(w):
            row += bytes((230, 30, 30)) if x < w // 2 else bytes((30, 60, 230))
        rows.append(bytes(row))
    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    blob = (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw))
            + chunk(b"IEND", b""))
    path.write_bytes(blob)
    return path


img = make_png(ROOT / "scripts" / "test-left-red-right-blue.png")
print("测试图:", img, img.stat().st_size, "字节")

sid = agent_bridge.new_session_id()
sessions.create_chat(sid, title="识图冒烟测试")
turn = agent_bridge.start_turn(
    sid,
    "这张图左右两半各是什么颜色？只回答颜色，不要解释。",
    attachments=[{"path": str(img), "mime": "image/png"}],
)

t0 = time.time()
out = []
while True:
    ev = turn.q.get(timeout=180)
    if ev["type"] == "delta":
        out.append(ev["text"])
    elif ev["type"] == "eof":
        break
    elif ev["type"] in ("tool_start", "error", "status"):
        print(f"[{ev['type']}] {str(ev)[:160]}")

print(f"\n耗时 {time.time() - t0:.1f}s")
print("模型回答:", "".join(out).strip()[:300])
