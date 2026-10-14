"""冒烟测试：起一轮真实对话，把事件打出来。用 hermes 自带 python 跑：
    /usr/local/lib/hermes-agent/venv/bin/python scripts/smoke_turn.py "你好"
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import agent_bridge  # noqa: E402
import sessions  # noqa: E402

text = sys.argv[1] if len(sys.argv) > 1 else "只回复两个字：收到"
sid = agent_bridge.new_session_id()
print(f"新会话 {sid}")
sessions.create_chat(sid, title="冒烟测试")

t0 = time.time()
turn = agent_bridge.start_turn(sid, text)
shown = {"delta": 0}
while True:
    ev = turn.q.get(timeout=180)
    kind = ev.get("type")
    if kind == "delta":
        shown["delta"] += 1
        if shown["delta"] <= 3:
            print(f"[字] {ev['text'][:60]!r}")
    elif kind == "eof":
        break
    else:
        print(f"[{kind}] {str({k: v for k, v in ev.items() if k != 'type'})[:220]}")

print(f"\n耗时 {time.time() - t0:.1f}s，文字增量 {shown['delta']} 段")
msgs = sessions.display_messages(sid)
print(f"落库消息 {len(msgs)} 条：")
for m in msgs:
    print(f"  {m['role']}: {m['text'][:120]!r}")
print("历史条数（喂给 agent 的）:", len(sessions.history(sid)))
