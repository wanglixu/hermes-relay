#!/usr/bin/env python3
"""hermes-relay 服务端：Python 标准库 HTTP + SSE，进程内调 Hermes agent。

必须用 Hermes 自带的 Python 启动：
    /usr/local/lib/hermes-agent/venv/bin/python server.py

设计要点（对应需求第 5 条）：浏览器不轮询，全部更新走 SSE 单向推；
一条消息只跑一次 agent；会话列表和历史直接读 SQLite，不叫 agent。
"""
from __future__ import annotations

import json
import mimetypes
import os
import re
import sys
import threading
import time
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import agent_bridge  # noqa: E402
import compress  # noqa: E402
import context as chat_context  # noqa: E402
import models  # noqa: E402
import sessions  # noqa: E402
import workbench_api  # noqa: E402

STATIC_DIR = Path(os.environ.get("HERMES_RELAY_STATIC", ROOT / "static")).expanduser()
UPLOAD_DIR = Path(os.environ.get("HERMES_RELAY_UPLOADS", "~/.hermes/hermes-relay/uploads")).expanduser()
HOST = os.environ.get("HERMES_RELAY_HOST", "127.0.0.1")
PORT = int(os.environ.get("HERMES_RELAY_PORT", "8788"))
MAX_BODY = 64 * 1024 * 1024          # 上传（图片/文件）上限
MAX_JSON_BODY = 1 * 1024 * 1024      # JSON 接口上限，正常请求都是几 KB
SAFE_NAME = re.compile(r"[^A-Za-z0-9._\u4e00-\u9fff-]")


class _HttpError(Exception):
    """带状态码的请求错误：在 do_* 里统一翻译成 JSON 响应。"""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _json(handler: BaseHTTPRequestHandler, obj, status: int = 200) -> None:
    body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "hermes-relay/0.1"

    # ── 工具 ────────────────────────────────────────────────
    def log_message(self, fmt, *args):  # 少刷屏，只留错误
        if str(args[1] if len(args) > 1 else "").startswith(("4", "5")):
            sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def _body(self) -> bytes:
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return b""
        if n > MAX_BODY:
            raise _HttpError(413, "请求体超过上限")
        return self.rfile.read(n)

    def _json_body(self) -> dict:
        """读 JSON 请求体。带 body 时必须是 application/json，否则 415。

        这条和 Origin 校验一起用：跨站表单只能发 form/text/plain 这类 Content-Type，
        发不出 application/json（会被浏览器预检拦下），所以能挡掉一批 CSRF。
        """
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if n > MAX_JSON_BODY:
            raise _HttpError(413, "JSON 请求体超过 1MB")
        raw = self._body()
        if not raw:
            return {}
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ctype != "application/json":
            raise _HttpError(415, f"这个接口要求 Content-Type: application/json（收到 {ctype or '空'}）")
        try:
            obj = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise _HttpError(400, f"JSON 解析失败：{exc}") from exc
        if not isinstance(obj, dict):
            raise _HttpError(400, "JSON 顶层必须是对象")
        return obj

    def _same_origin(self) -> bool:
        """浏览器请求必须和本站同源。没有 Origin 的（curl、脚本、服务间调用）放行。"""
        origin = self.headers.get("Origin")
        if not origin:
            return True
        host = self.headers.get("X-Forwarded-Host") or self.headers.get("Host") or ""
        netloc = urllib.parse.urlparse(origin).netloc
        if not netloc:
            return False
        # 只比主机名，忽略端口差异（本地开发 3220 → 8788 也放行）
        return netloc.split(":")[0].lower() == host.split(":")[0].lower()

    def _guard(self) -> bool:
        """写操作的统一前置检查。不通过就已经回过 403，调用方直接 return。"""
        if not self._same_origin():
            _json(self, {"error": "跨站请求被拒绝（Origin 与本站不一致）"}, 403)
            return False
        return True

    def _safe_attachments(self, items) -> list:
        """附件路径必须落在上传目录里。挡掉 {"path": "/etc/passwd"} 这类往里塞的路径。"""
        root = UPLOAD_DIR.resolve()
        out: list = []
        for a in items if isinstance(items, list) else []:
            if not isinstance(a, dict):
                continue
            raw = str(a.get("path") or "").strip()
            if not raw:
                continue
            try:
                p = Path(raw).expanduser().resolve()
                p.relative_to(root)
            except (OSError, ValueError):
                sys.stderr.write(f"[relay] 丢弃越界的附件路径：{raw}\n")
                continue
            if not p.is_file():
                continue
            out.append({**a, "path": str(p)})
        return out

    def _parts(self):
        return [urllib.parse.unquote(p) for p in urllib.parse.urlparse(self.path).path.split("/") if p]

    # ── GET ─────────────────────────────────────────────────
    def do_GET(self):
        parts = self._parts()
        try:
            if parts[:1] == ["api"]:
                return self._api_get(parts[1:])
            return self._static(self.path)
        except Exception:
            traceback.print_exc()
            return _json(self, {"error": "internal error"}, 500)

    def _api_get(self, parts: list[str]):
        if len(parts) == 3 and parts[0] == "chats" and parts[2] == "stream":
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            try:
                after = int((q.get("after") or ["0"])[0] or 0)
            except ValueError:
                after = 0
            return self._attach(parts[1], after)
        if len(parts) == 3 and parts[0] == "uploads":
            return self._serve_upload(parts[1], parts[2])
        if parts == ["health"]:
            return _json(self, {"ok": True, "pid": os.getpid()})
        if parts == ["skills"]:
            return _json(self, {"skills": chat_context.list_skills()})
        if len(parts) == 3 and parts[0] == "chats" and parts[2] == "context":
            # 优先按该会话库里记录的实际模型算，新会话或无记录才退回当前页面选中的模型
            rt = models.active_runtime()
            return _json(self, chat_context.context_stats(
                parts[1], model=str(rt.get("model") or ""), provider=str(rt.get("provider") or ""),
                base_url=str(rt.get("base_url") or ""),
            ))
        if parts == ["models"]:
            try:
                listing = models.list_models()
                rt = agent_bridge.resolve_runtime() or {}
                return _json(self, {
                    "models": listing["models"],
                    "custom": listing["custom"],
                    "channels": listing.get("channels") or [],
                    "current": models.current(),
                    "efforts": models.EFFORTS,
                    "default_effort": listing.get("default_effort") or "high",
                    # 没在页面上选过时，显示的是 Hermes 配置里的默认模型
                    "default_model": rt.get("model") or "",
                    "default_provider": rt.get("provider") or "",
                })
            except Exception as exc:
                return _json(self, {"error": str(exc)}, 500)
        if parts == ["config"]:
            try:
                rt = agent_bridge.resolve_runtime()
                return _json(self, {
                    "model": rt.get("model") or "",
                    "provider": rt.get("provider") or "",
                })
            except Exception as exc:
                return _json(self, {"model": "", "provider": "", "error": str(exc)})
        if parts == ["chats"]:
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            try:
                limit = int(q.get("limit", ["50"])[0])
                offset = int(q.get("offset", ["0"])[0])
            except (TypeError, ValueError):
                return _json(self, {"error": "limit / offset 必须是整数"}, 400)
            if not 1 <= limit <= 500 or offset < 0:
                return _json(self, {"error": "limit 取 1~500，offset 不能是负数"}, 400)
            chats = sessions.list_chats(
                limit=limit,
                offset=offset,
                q=(q.get("q", [""])[0] or None),
            )
            # 每个会话挂上它派出去的子代理（列表页一次查完，不做 N+1）
            dels = chat_context.delegations([c["id"] for c in chats])
            for c in chats:
                c["agents"] = dels.get(c["id"], [])
            return _json(self, {"chats": chats})
        if len(parts) == 2 and parts[0] == "chats":
            chat = sessions.get_chat(parts[1])
            if not chat:
                # 懒创建：刚点「新对话」拿到的草稿 id 还没落库，而前端切到它时仍会来读一次详情，
                # 这里给一个空会话而不是 404（前端不用为草稿单独走一条分支）。
                chat = {"id": parts[1], "title": "", "source": sessions.SOURCE, "model": "",
                        "message_count": 0, "started_at": 0}
            # 展示窗口：?turns=3 只给最近 3 个回合，?before=N 再往前翻 N 个回合。
            # 不带参数就是整份历史（老客户端/排查问题时用）。
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            raw_turns = (q.get("turns", [""])[0] or "").strip()
            turns = int(raw_turns) if raw_turns.isdigit() else None
            before = int((q.get("before", ["0"])[0] or "0")) if (q.get("before", ["0"])[0] or "0").isdigit() else 0
            window, has_more, got = sessions.slice_turns(sessions.display_messages(parts[1]), turns, before)
            chat["messages"] = window
            chat["has_more"] = has_more
            chat["turns"] = got
            # 压缩记录：会话级的，不挂在某条消息上；前端把它渲染在整条时间线的最下面
            try:
                import compress as chat_compress

                chat["compactions"] = chat_compress.records(parts[1])
            except Exception:
                chat["compactions"] = []
            # 有一轮还在跑？前端据此决定要不要接上（不用另外发一次请求问）
            chat["live"] = agent_bridge.is_live(parts[1])
            return _json(self, chat)
        if parts == ["kanban", "tasks"]:
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            status = (q.get("status") or [None])[0]
            return _json(self, {"tasks": workbench_api.list_kanban_tasks(status)})
        if parts == ["cron", "jobs"]:
            return _json(self, {"jobs": workbench_api.list_cron_jobs()})
        if parts == ["system", "processes"]:
            return _json(self, workbench_api.get_system_processes())
        if parts == ["system", "logs"]:
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            fname = (q.get("file") or ["agent.log"])[0]
            try:
                lines = int((q.get("lines") or ["150"])[0])
            except ValueError:
                lines = 150
            return _json(self, workbench_api.get_system_logs(fname, lines))
        if parts == ["artifacts", "files"]:
            return _json(self, {"files": workbench_api.list_artifact_files()})
        return _json(self, {"error": "not found"}, 404)

    # ── POST ────────────────────────────────────────────────
    def do_POST(self):
        parts = self._parts()
        if not self._guard():
            return
        try:
            if parts[:1] != ["api"]:
                return _json(self, {"error": "not found"}, 404)
            if parts[1:] == ["models", "select"]:
                body = self._json_body()
                raw_key, raw_effort = body.get("key"), body.get("effort")
                try:
                    cur = models.set_current(
                        # 只改一个字段时另一个传 None（不动），空串才是「清掉」
                        key=(raw_key.strip() if isinstance(raw_key, str) else None),
                        effort=(raw_effort.strip() if isinstance(raw_effort, str) else None),
                    )
                except ValueError as exc:
                    return _json(self, {"error": str(exc)}, 400)
                return _json(self, {"ok": True, "current": cur})
            if parts[1:] == ["models", "test"]:
                body = self._json_body()
                base_url = (body.get("base_url") or "").strip()
                api_key = (body.get("api_key") or "").strip()
                model_id = (body.get("model_id") or "").strip()
                # 先问模型清单：这一步不消耗额度。额度不够发对话时，用户仍然能看到有哪些模型可选。
                listing = models.list_endpoint_models(base_url, api_key)
                if not listing.get("ok"):
                    # 接口不提供清单，退回真发一次小请求来判断地址和密钥对不对
                    return _json(self, models.test_endpoint(base_url, api_key, model_id))
                ids = listing["models"]
                if model_id and model_id not in ids:
                    return _json(self, {
                        "ok": False,
                        "models": ids,
                        "error": f"这个接口不提供「{model_id}」。下面是它实际提供的 {len(ids)} 个模型，点一个填进去。",
                    })
                return _json(self, {"ok": True, "model": model_id, "models": ids})
            if parts[1:] == ["models", "add"]:
                body = self._json_body()
                try:
                    item = models.add_custom(
                        name=(body.get("name") or "").strip(),
                        base_url=(body.get("base_url") or "").strip(),
                        api_key=(body.get("api_key") or "").strip(),
                        model_id=(body.get("model_id") or "").strip(),
                        context_length=body.get("context_length"),
                    )
                except ValueError as exc:
                    # 校验失败也用 200 + ok:false，前端统一按「结果」处理，不用解析 HTTP 错误体
                    return _json(self, {"ok": False, "error": str(exc)})
                return _json(self, {"ok": True, "model": item})
            if parts[1:] == ["models", "remove"]:
                body = self._json_body()
                key = (body.get("key") or "").strip()
                if not key.startswith("custom:"):
                    return _json(self, {"ok": False, "error": "只能删页面上自己加的模型"})
                return _json(self, {"ok": models.remove_custom(key)})
            if parts[1:] == ["channels", "add"]:
                body = self._json_body()
                try:
                    ch = models.add_channel(
                        name=body.get("name") or "",
                        base_url=body.get("base_url") or "",
                        api_key=body.get("api_key") or "",
                    )
                except ValueError as exc:
                    return _json(self, {"ok": False, "error": str(exc)})
                return _json(self, {"ok": True, "channel": ch})
            if parts[1:] == ["channels", "sync"]:
                body = self._json_body()
                try:
                    ch = models.sync_channel((body.get("id") or "").strip())
                except ValueError as exc:
                    return _json(self, {"ok": False, "error": str(exc)})
                return _json(self, {"ok": True, "channel": ch})
            if parts[1:] == ["channels", "remove"]:
                body = self._json_body()
                return _json(self, {"ok": models.remove_channel((body.get("id") or "").strip())})
            if parts[1:] == ["chats"]:
                body = self._json_body()
                sid = agent_bridge.new_session_id()
                # 懒创建：这里**不落库**。会话在第一次发消息（_turn）或改名时才写进库里 ——
                # 点了「新对话」却没说话的草稿就不会在侧栏积成一条条「未命名对话」。
                title = (body.get("title") or "").strip()
                if title:
                    # 明确带标题建会话的调用方，按老行为立刻落库
                    sessions.create_chat(sid, title=title)
                return _json(self, {"id": sid}, 201)
            if len(parts) == 4 and parts[1] == "chats" and parts[3] == "turn":
                return self._turn(parts[2])
            if len(parts) == 4 and parts[1] == "chats" and parts[3] == "interrupt":
                turn = agent_bridge.live_turn(parts[2])
                return _json(self, {"interrupted": bool(turn and turn.interrupt())})
            if len(parts) == 4 and parts[1] == "chats" and parts[3] == "steer":
                body = self._json_body()
                text = (body.get("text") or "").strip()
                if not text:
                    return _json(self, {"ok": False, "reason": "empty"}, 400)
                ok = agent_bridge.steer_turn(parts[2], text)
                return _json(self, {"ok": bool(ok), "reason": "" if ok else "no_live_turn"})
            if len(parts) == 4 and parts[1] == "chats" and parts[3] == "compress":
                if agent_bridge.live_turn(parts[2]):
                    # 正在跑的回答会跟压缩抢同一份历史，等这轮完再压
                    return _json(self, {"ok": False, "error": "这一轮还在跑，等它结束再压"}, 409)
                body = self._json_body()
                focus = (body.get("focus") or "").strip() or None
                # 同步压：这个 HTTP 请求会一直挂到压完（30~60 秒）。
                # nginx 那边 proxy_read_timeout 是 3600s，挂得住；前端在此期间把新消息排队。
                return _json(self, compress.run(parts[2], focus))
            if parts[1:] == ["admin", "restart"]:
                # 改了需要重启的后端代码时用这个：只放一个标记，
                # 等服务把当前这一轮答案完整吐完（eof 之后）再自己重启，不用掐表等。
                flag = Path.home() / ".hermes/hermes-relay/restart.pending"
                flag.parent.mkdir(parents=True, exist_ok=True)
                flag.write_text(str(time.time()))
                return _json(self, {"ok": True, "note": "这一轮答案发完就自动重启"})
            if parts[1:] == ["approvals"]:
                body = self._json_body()
                n = agent_bridge.resolve_approval(
                    body.get("session_id") or "", body.get("choice") or "deny",
                    request_id=body.get("request_id"),
                )
                return _json(self, {"resolved": n})
            if parts[1:] == ["clarify"]:
                # 模型反过来问用户：浏览器提交答案，解除 agent 线程的阻塞。
                body = self._json_body()
                ok = agent_bridge.resolve_clarify(
                    body.get("session_id") or "",
                    body.get("clarify_id") or "",
                    body.get("response") or "",
                )
                return _json(self, {"resolved": bool(ok)})
            if parts[1:] == ["upload"]:
                return self._upload()
            if parts[1:] == ["kanban", "tasks"]:
                body = self._json_body()
                task = workbench_api.create_kanban_task(body)
                return _json(self, {"ok": True, "task": task})
            if parts[1:] == ["cron", "toggle"]:
                body = self._json_body()
                ok = workbench_api.toggle_cron_job(body.get("id"), bool(body.get("enabled")))
                return _json(self, {"ok": ok})
            if parts[1:] == ["cron", "run"]:
                body = self._json_body()
                res = workbench_api.run_cron_job_now(body.get("id"))
                return _json(self, res)
        except _HttpError as exc:
            return _json(self, {"error": exc.message}, exc.status)
        except Exception as exc:
            traceback.print_exc()
            return _json(self, {"error": f"{type(exc).__name__}: {exc}"}, 500)
        return _json(self, {"error": "not found"}, 404)

    def do_PATCH(self):
        parts = self._parts()
        if not self._guard():
            return
        try:
            if len(parts) == 3 and parts[0] == "api" and parts[1] == "chats":
                body = self._json_body()
                title = (body.get("title") or "").strip()
                try:
                    # 草稿会话改名 = 明确要留下它，先落库
                    sessions.ensure_chat(parts[2])
                    sessions.rename_chat(parts[2], title[:120])
                except Exception as exc:
                    return _json(self, {"error": str(exc)}, 400)
                return _json(self, {"ok": True})
            if len(parts) == 4 and parts[0] == "api" and parts[1] == "kanban" and parts[2] == "tasks":
                body = self._json_body()
                task = workbench_api.update_kanban_task(parts[3], body)
                return _json(self, {"ok": bool(task), "task": task})
        except _HttpError as exc:
            return _json(self, {"error": exc.message}, exc.status)
        except Exception as exc:
            traceback.print_exc()
            return _json(self, {"error": f"{type(exc).__name__}: {exc}"}, 500)
        return _json(self, {"error": "not found"}, 404)

    def do_DELETE(self):
        parts = self._parts()
        if not self._guard():
            return
        try:
            if len(parts) == 3 and parts[0] == "api" and parts[1] == "chats":
                try:
                    # 草稿会话（还没落库）删除 = 什么都不用做
                    if sessions.chat_exists(parts[2]):
                        sessions.delete_chat(parts[2])
                except Exception as exc:
                    return _json(self, {"error": str(exc)}, 400)
                return _json(self, {"ok": True})
            if len(parts) == 4 and parts[0] == "api" and parts[1] == "kanban" and parts[2] == "tasks":
                ok = workbench_api.delete_kanban_task(parts[3])
                return _json(self, {"ok": ok})
        except _HttpError as exc:
            return _json(self, {"error": exc.message}, exc.status)
        except Exception as exc:
            traceback.print_exc()
            return _json(self, {"error": f"{type(exc).__name__}: {exc}"}, 500)
        return _json(self, {"error": "not found"}, 404)

    # ── 一轮对话：SSE ────────────────────────────────────────
    def _sse_start(self) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.send_header("X-Accel-Buffering", "no")  # 让 nginx 别攒着
        self.end_headers()
        self.close_connection = True

    def _sse_send(self, ev: dict) -> bool:
        try:
            self.wfile.write(b"data: " + json.dumps(ev, ensure_ascii=False).encode("utf-8") + b"\n\n")
            self.wfile.flush()
            return True
        except Exception:
            return False

    def _sse_pump(self, turn, after: int = 0) -> None:
        """把这一轮的事件推给浏览器：先补发错过的，再跟着实时走。

        每条连接有自己的一条队列，所以同一个轮次可以同时被多个页面/标签页跟着看；
        浏览器关掉连接只是 unsubscribe，轮次本身照跑。
        """
        q, replay, truncated = turn.subscribe(after)
        try:
            self._sse_start()
            if truncated:  # 事件太多、断点之前的已经丢了 → 让前端整段重读
                if not self._sse_send({"type": "reset"}):
                    return
            for ev in replay:
                if not self._sse_send(ev):
                    return
                if ev.get("type") == "eof":
                    return
            if q is None:  # 已经跑完的轮次：回放完就收尾
                return
            while True:
                try:
                    ev = q.get(timeout=20)
                except Exception:
                    try:  # 空转就发个心跳注释，别让中间层掐掉连接
                        self.wfile.write(b": ping\n\n")
                        self.wfile.flush()
                    except Exception:
                        return
                    continue
                if not self._sse_send(ev):
                    return
                if ev.get("type") == "eof":
                    return
        finally:
            turn.unsubscribe(q)

    def _attach(self, session_id: str, after: int):
        """接上正在跑（或刚跑完）的那一轮。没有就直接回一个 eof，前端读库就行。"""
        turn = agent_bridge.live_turn(session_id) or agent_bridge.recent_turn(session_id)
        if turn is None:
            self._sse_start()
            self._sse_send({"type": "eof"})
            return
        self._sse_pump(turn, after)

    def _turn(self, session_id: str):
        body = self._json_body()
        # 懒创建：草稿会话（点「新对话」拿到的 id）在第一条消息发出时才真正落库。
        sessions.ensure_chat(session_id)
        text = (body.get("text") or "").strip()
        attachments = self._safe_attachments(body.get("attachments") or [])
        # 压缩是同步跑的，期间库里的历史正在被重写，这时候别放新的一轮进来。
        # （正常情况下前端会把这期间的消息排队，这里是兜底。）
        if compress.is_busy():
            return _json(self, {"error": "上下文正在压缩，这条消息稍后会自动发出"}, 409)
        # 输入框里用 `/技能名` 开头 = 点名要用这个技能。
        # 照 hermes-webui 的做法（static/messages.js 的 _forcedSkillDirectivePending）：
        # 技能内容套一层信封拼在正文前面，**用户原话完整留在末尾**；界面显示时由前端把信封剥掉
        # （static/sessions.js 的 _stripForcedSkillEnvelope），所以历史里看着还是你打的那句话。
        # 小技能整段贴（本机中位数 7KB），大技能（只有 6 个超 20KB）贴不动，退回提示并要求先读。
        agent_text = text
        m = re.match(r"^/([A-Za-z0-9_.\-]{2,64})(?:[\s\u3000]+(.*))?$", text, re.S)
        if m:
            sk = chat_context.skill_by_name(m.group(1))
            if sk:
                directive = (
                    f"[USER OVERRIDE] You MUST follow the skill '{sk['name']}' content "
                    f"provided below before responding to the next message."
                )
                body = chat_context.skill_body(sk)
                if body:
                    agent_text = (
                        f"{directive}\n\n"
                        f"[FORCED SKILL CONTEXT: {sk['name']}]\n{body}\n[/FORCED SKILL CONTEXT]\n\n"
                        f"{text}"
                    )
                else:
                    agent_text = (
                        f"{directive}\n\n"
                        f"[FORCED SKILL CONTEXT: {sk['name']}]\n"
                        f"(这个技能的说明太长，没有直接贴出；动手前必须先用 skill_view 读 {sk['path']})\n"
                        f"[/FORCED SKILL CONTEXT]\n\n{text}"
                    )
        if not sessions.get_chat(session_id):
            return _json(self, {"error": "session not found"}, 404)
        if attachments:
            # 先记下"这些图属于第几条提问"（服务端不存附件，刷新后靠它把图挂回去）
            try:
                # 只记图片：上传索引是给「刷新后把图挂回消息」用的，
                # 非图片附件（文本/PDF）本来就不该在消息里当图渲染
                pics = [
                    Path(a.get("path", "")).name
                    for a in attachments
                    if a.get("path") and str(a.get("mime") or "").startswith("image/")
                ]
                if pics:
                    sessions.record_uploads(session_id, pics)
            except Exception:
                traceback.print_exc()
        try:
            turn = agent_bridge.start_turn(session_id, agent_text, attachments, persist_text=text)
        except RuntimeError as exc:
            return _json(self, {"error": str(exc)}, 409)
        self._sse_pump(turn, 0)

    # ── 传图 ────────────────────────────────────────────────
    def _serve_upload(self, session_id: str, name: str):
        """把上传的图发回去（刷新后消息里还能看到图）。

        新会话的草稿图会先传进 draft 目录（那时还没有会话 id），发送后转正到会话目录
        是不可能的——所以这里找不到就在 draft 里再找一次。
        """
        sid = SAFE_NAME.sub("", session_id)[:64]
        safe = SAFE_NAME.sub("_", Path(name).name)[:120]
        root = UPLOAD_DIR.resolve()
        target = (root / sid / safe).resolve()
        if not str(target).startswith(str(root)) or not target.is_file():
            target = (root / "draft" / safe).resolve()
        if not str(target).startswith(str(root)) or not target.is_file():
            return _json(self, {"error": "not found"}, 404)
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if not ctype.startswith("image/"):
            # 只回放图片：上传目录里就算混进 .html/.svg，也不会被当页面执行
            return _json(self, {"error": "上传目录只回放图片"}, 415)
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "private, max-age=86400")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "sandbox")
        self.end_headers()
        self.wfile.write(data)

    def _upload(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        sid = SAFE_NAME.sub("", (q.get("session") or [""])[0])[:32]
        raw_name = (q.get("name") or ["image.png"])[0]
        name = SAFE_NAME.sub("_", Path(raw_name).name)[:80] or "image.png"
        data = self._body()
        if not data:
            return _json(self, {"error": "empty file"}, 400)
        target_dir = UPLOAD_DIR / (sid or "misc")
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / f"{int(time.time() * 1000)}-{name}"
        target.write_bytes(data)
        mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
        return _json(self, {"path": str(target), "name": name, "mime": mime, "size": len(data)})

    # ── 静态文件 ─────────────────────────────────────────────
    def _static(self, path: str):
        rel = urllib.parse.unquote(urllib.parse.urlparse(path).path).lstrip("/") or "index.html"
        target = (STATIC_DIR / rel).resolve()
        if not str(target).startswith(str(STATIC_DIR.resolve())):  # 防目录穿越
            return _json(self, {"error": "forbidden"}, 403)
        if not target.is_file():
            target = STATIC_DIR / "index.html"  # SPA 回退
        if not target.is_file():
            return _json(self, {"error": "前端还没构建：cd web && npm run build"}, 404)
        data = target.read_bytes()
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if ctype.startswith("text/") or ctype.endswith("javascript") or ctype.endswith("json") else ""))
        self.send_header("Content-Length", str(len(data)))
        if target.name == "index.html":
            self.send_header("Cache-Control", "no-store")
        else:
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        self.end_headers()
        self.wfile.write(data)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    srv = Server((HOST, PORT), Handler)
    print(f"hermes-relay 起来了：http://{HOST}:{PORT}   (pid {os.getpid()})", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()
