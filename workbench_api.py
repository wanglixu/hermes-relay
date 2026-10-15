"""Hermes Relay 工作台与扩展功能核心模块 (workbench_api.py)

提供：
1. 任务看板与进度跟踪器（Kanban & Todo-List 可视化）
2. 后台进程与控制台视窗（Process & Daemon Monitor）
3. 定时任务调度器（Cronjob Dashboard）
4. 产物沙箱与文件检索（Live Artifacts Sandbox）

全部使用 Python 标准库，保持零额外第三方依赖。
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

HOME = Path.home()
# 与其它模块同一套约定：HERMES_HOME 可覆盖，默认 ~/.hermes
HERMES_DIR = Path(os.environ.get("HERMES_HOME", "~/.hermes")).expanduser()
KANBAN_DB = HERMES_DIR / "kanban.db"
CRON_DIR = HERMES_DIR / "cron"
CRON_JOBS_FILE = CRON_DIR / "jobs.json"
CRON_EXEC_DB = CRON_DIR / "executions.db"
LOGS_DIR = HERMES_DIR / "logs"
# 产物沙箱看的目录：默认 ~/workspace，可用 HERMES_RELAY_WORKSPACE 指定
WORKSPACE_DIR = Path(os.environ.get("HERMES_RELAY_WORKSPACE", "~/workspace")).expanduser()


# ─────────────────────────────────────────────────────────────
# 1. 任务看板 (Kanban & Todo-List)
# ─────────────────────────────────────────────────────────────

def _get_kanban_conn():
    if not KANBAN_DB.exists():
        KANBAN_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(KANBAN_DB)
    conn.row_factory = sqlite3.Row
    return conn


def list_kanban_tasks(status: Optional[str] = None) -> List[Dict[str, Any]]:
    """读取 Kanban 数据库中的所有任务"""
    if not KANBAN_DB.exists():
        return []
    try:
        with _get_kanban_conn() as conn:
            cur = conn.cursor()
            if status:
                cur.execute(
                    "SELECT id, title, body, assignee, status, priority, created_at, started_at, completed_at, workspace_kind, consecutive_failures, last_failure_error FROM tasks WHERE status = ? ORDER BY priority DESC, created_at DESC",
                    (status,),
                )
            else:
                cur.execute(
                    "SELECT id, title, body, assignee, status, priority, created_at, started_at, completed_at, workspace_kind, consecutive_failures, last_failure_error FROM tasks ORDER BY priority DESC, created_at DESC"
                )
            rows = cur.fetchall()
            return [dict(r) for r in rows]
    except Exception as exc:
        print(f"[workbench_api] list_kanban_tasks error: {exc}")
        return []


def create_kanban_task(data: Dict[str, Any]) -> Dict[str, Any]:
    """创建新任务卡片并落库"""
    task_id = str(uuid.uuid4().hex[:12])
    title = str(data.get("title") or "未命名任务").strip()
    body = str(data.get("body") or "").strip()
    assignee = str(data.get("assignee") or "").strip()
    status = str(data.get("status") or "todo").strip()
    if status not in {"triage", "todo", "ready", "running", "blocked", "done"}:
        status = "todo"
    priority = int(data.get("priority") or 0)
    now = int(time.time())

    with _get_kanban_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO tasks (
                id, title, body, assignee, status, priority, created_at, workspace_kind, consecutive_failures, goal_mode, block_recurrences
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'scratch', 0, 0, 0)""",
            (task_id, title, body, assignee, status, priority, now),
        )
        conn.commit()

    return {
        "id": task_id,
        "title": title,
        "body": body,
        "assignee": assignee,
        "status": status,
        "priority": priority,
        "created_at": now,
        "started_at": None,
        "completed_at": None,
        "workspace_kind": "scratch",
        "consecutive_failures": 0,
        "last_failure_error": None,
    }


def update_kanban_task(task_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """更新任务状态、字段"""
    valid_keys = {"title", "body", "assignee", "status", "priority"}
    fields = []
    values = []
    now = int(time.time())

    for k, v in updates.items():
        if k in valid_keys:
            fields.append(f"{k} = ?")
            values.append(v)
            if k == "status":
                if v == "running":
                    fields.append("started_at = COALESCE(started_at, ?)")
                    values.append(now)
                elif v == "done":
                    fields.append("completed_at = ?")
                    values.append(now)

    if not fields:
        return None

    values.append(task_id)
    with _get_kanban_conn() as conn:
        cur = conn.cursor()
        cur.execute(f"UPDATE tasks SET {', '.join(fields)} WHERE id = ?", values)
        conn.commit()
        cur.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))
        row = cur.fetchone()
        return dict(row) if row else None


def delete_kanban_task(task_id: str) -> bool:
    """删除指定任务"""
    with _get_kanban_conn() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        conn.commit()
        return cur.rowcount > 0


# ─────────────────────────────────────────────────────────────
# 2. 定时任务调度器 (Cronjob Dashboard)
# ─────────────────────────────────────────────────────────────

def list_cron_jobs() -> List[Dict[str, Any]]:
    """获取所有定时任务及关联的最近执行历史"""
    if not CRON_JOBS_FILE.exists():
        return []
    try:
        with open(CRON_JOBS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            jobs = data.get("jobs", [])
    except Exception as exc:
        print(f"[workbench_api] read jobs.json error: {exc}")
        return []

    # 查最近执行记录
    exec_map = {}
    if CRON_EXEC_DB.exists():
        try:
            with sqlite3.connect(CRON_EXEC_DB) as conn:
                conn.row_factory = sqlite3.Row
                cur = conn.cursor()
                cur.execute(
                    """SELECT id, job_id, status, started_at, finished_at, error
                       FROM executions ORDER BY rowid DESC LIMIT 50"""
                )
                for r in cur.fetchall():
                    jid = r["job_id"]
                    if jid not in exec_map:
                        exec_map[jid] = dict(r)
        except Exception as exc:
            print(f"[workbench_api] executions.db read error: {exc}")

    results = []
    for j in jobs:
        jid = j.get("id")
        item = dict(j)
        if jid in exec_map:
            item["recent_execution"] = exec_map[jid]
        results.append(item)
    return results


def toggle_cron_job(job_id: str, enabled: bool) -> bool:
    """切换定时任务开启/禁用"""
    if not CRON_JOBS_FILE.exists():
        return False
    try:
        with open(CRON_JOBS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        jobs = data.get("jobs", [])
        found = False
        for j in jobs:
            if j.get("id") == job_id:
                j["enabled"] = enabled
                j["state"] = "scheduled" if enabled else "paused"
                if not enabled:
                    j["paused_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
                else:
                    j["paused_at"] = None
                found = True
                break
        if not found:
            return False
        data["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        # 原子写入
        tmp_file = CRON_JOBS_FILE.with_suffix(".tmp")
        with open(tmp_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        tmp_file.replace(CRON_JOBS_FILE)
        return True
    except Exception as exc:
        print(f"[workbench_api] toggle_cron_job error: {exc}")
        return False


def run_cron_job_now(job_id: str) -> Dict[str, Any]:
    """立即触发执行一次定时任务"""
    jobs = list_cron_jobs()
    target = next((j for j in jobs if j.get("id") == job_id), None)
    if not target:
        return {"ok": False, "error": "Job not found"}

    script = target.get("script")
    prompt = target.get("prompt")
    # 如果有本地脚本在 ~/.hermes/scripts/ 或当前路径，异步或后台运行
    if script:
        script_path = HERMES_DIR / "scripts" / script
        if not script_path.exists():
            script_path = HOME / script
        if script_path.exists():
            try:
                subprocess.Popen(
                    ["/bin/bash", str(script_path)],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                return {"ok": True, "dispatched": "script", "script": script}
            except Exception as exc:
                return {"ok": False, "error": f"Failed to execute script: {exc}"}

    return {"ok": True, "dispatched": "signal", "note": f"任务已触发：{target.get('name')}"}


# ─────────────────────────────────────────────────────────────
# 3. 后台进程与控制台视窗 (Process & Daemon Monitor)
# ─────────────────────────────────────────────────────────────

def get_system_processes() -> Dict[str, Any]:
    """获取系统关键后台进程与资源使用"""
    # 读系统 load 与 内存
    loadavg = [0.0, 0.0, 0.0]
    try:
        with open("/proc/loadavg", "r") as f:
            parts = f.read().split()
            loadavg = [float(parts[0]), float(parts[1]), float(parts[2])]
    except Exception:
        pass

    mem_total_mb = 0
    mem_avail_mb = 0
    try:
        with open("/proc/meminfo", "r") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    mem_total_mb = int(line.split()[1]) // 1024
                elif line.startswith("MemAvailable:"):
                    mem_avail_mb = int(line.split()[1]) // 1024
    except Exception:
        pass

    # 查进程列表
    procs = []
    try:
        out = subprocess.check_output(
            ["ps", "-eo", "pid,ppid,user,%cpu,%mem,etime,command", "--sort=-%cpu"],
            text=True,
            timeout=3,
        )
        lines = out.strip().split("\n")
        header = lines[0] if lines else ""
        for line in lines[1:]:
            parts = line.split(None, 6)
            if len(parts) < 7:
                continue
            pid, ppid, user, cpu, mem, elapsed, cmd = parts
            # 过滤出有意义的应用级进程与相关服务
            is_hermes = "hermes" in cmd.lower()
            is_relay = "relay" in cmd.lower()
            is_web = "next" in cmd.lower() or "node" in cmd.lower()
            is_python = "python" in cmd.lower()

            if is_hermes or is_relay or is_web or is_python or float(cpu or 0) > 0.5 or float(mem or 0) > 1.0:
                p_type = "hermes" if (is_hermes or is_relay) else "web" if is_web else "system"
                name = cmd.split()[0].split("/")[-1]
                if "hermes_cli" in cmd:
                    name = "hermes-gateway"
                elif "server.py" in cmd and "hermes-relay" in cmd:
                    name = "hermes-relay-server"
                elif "hermes-webui" in cmd:
                    name = "hermes-webui"
                elif "next-server" in cmd:
                    name = "next-server-web"

                procs.append({
                    "pid": int(pid),
                    "ppid": int(ppid),
                    "user": user,
                    "cpu": float(cpu),
                    "mem": float(mem),
                    "elapsed": elapsed,
                    "command": cmd[:200],
                    "name": name,
                    "type": p_type,
                })
    except Exception as exc:
        print(f"[workbench_api] ps command error: {exc}")

    # 读取 ~/.hermes/processes.json 里面的任务进程
    hermes_managed = []
    hermes_proc_file = HERMES_DIR / "processes.json"
    if hermes_proc_file.exists():
        try:
            with open(hermes_proc_file, "r") as f:
                hermes_managed = json.load(f)
        except Exception:
            pass

    return {
        "loadavg": loadavg,
        "memory": {
            "total_mb": mem_total_mb,
            "available_mb": mem_avail_mb,
            "used_mb": max(0, mem_total_mb - mem_avail_mb),
            "used_percent": round((mem_total_mb - mem_avail_mb) / max(1, mem_total_mb) * 100, 1),
        },
        "processes": procs[:40],
        "hermes_managed": hermes_managed,
    }


def get_system_logs(file_name: str = "agent.log", lines: int = 150) -> Dict[str, Any]:
    """获取 Hermes 实时日志内容"""
    allowed_logs = {"agent.log", "errors.log", "gateway.log", "gui.log", "update.log"}
    if file_name not in allowed_logs:
        file_name = "agent.log"

    log_path = LOGS_DIR / file_name
    if not log_path.exists():
        return {"ok": False, "error": f"Log file {file_name} not found", "lines": []}

    try:
        out = subprocess.check_output(
            ["tail", "-n", str(min(lines, 500)), str(log_path)],
            text=True,
            timeout=3,
        )
        return {
            "ok": True,
            "file": file_name,
            "lines": out.splitlines(),
            "mtime": log_path.stat().st_mtime,
            "size": log_path.stat().st_size,
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc), "lines": []}


# ─────────────────────────────────────────────────────────────
# 4. 产物沙箱与文件扫描 (Live Artifacts Sandbox)
# ─────────────────────────────────────────────────────────────

def list_artifact_files() -> List[Dict[str, Any]]:
    """扫描工作区与 Hermes 目录中的产物文件 (HTML, MD, SVG, PY, SH, JSON 等)"""
    scan_roots = [
        WORKSPACE_DIR / "hermes-relay",
        WORKSPACE_DIR,
        HERMES_DIR / "sandboxes",
        HERMES_DIR / "plans",
    ]

    EXT_KIND = {
        "html": "html",
        "htm": "html",
        "svg": "svg",
        "md": "markdown",
        "markdown": "markdown",
        "json": "code",
        "py": "code",
        "sh": "code",
        "ts": "code",
        "tsx": "code",
        "js": "code",
        "css": "code",
        "txt": "text",
    }

    files = []
    seen = set()

    for root in scan_roots:
        if not root.exists():
            continue
        for r, dirs, filenames in os.walk(root):
            # 忽略常见冗余目录
            dirs[:] = [d for d in dirs if not d.startswith(".") and d not in {"node_modules", ".git", "__pycache__", "dist", ".next"}]
            for fname in filenames:
                ext = fname.split(".")[-1].lower() if "." in fname else ""
                if ext in EXT_KIND:
                    fpath = Path(r) / fname
                    if str(fpath) in seen:
                        continue
                    seen.add(str(fpath))
                    try:
                        st = fpath.stat()
                        files.append({
                            "path": str(fpath),
                            "name": fname,
                            "ext": ext,
                            "kind": EXT_KIND[ext],
                            "size": st.st_size,
                            "mtime": st.st_mtime,
                            "is_html": ext in {"html", "htm"},
                            "is_svg": ext == "svg",
                            "is_markdown": ext in {"md", "markdown"},
                        })
                    except Exception:
                        pass

    # 按修改时间倒序排列
    files.sort(key=lambda x: x.get("mtime", 0), reverse=True)
    return files[:120]
