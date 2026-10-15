# Hermes Relay

**A thin web shell for [Hermes Agent](https://hermes-agent.nousresearch.com/docs).**

It does not reimplement the agent and does not keep a second copy of your data. Model calls, tool execution, the approval gate, skills, memory, the session store and context compaction all come straight from Hermes itself. This project does exactly three things: push a Hermes turn to the browser over SSE, translate browser actions back into Hermes calls, and add the few screens Hermes does not ship with (a workbench and model/channel management).

Backend: 7 Python files, ~4,000 lines, **standard library only**. Frontend: Next.js 16 + Tailwind v4, ~9,000 lines of TS/TSX.

> Requirement: a working Hermes Agent install on the same machine. The backend does not call Hermes over HTTP — it constructs `AIAgent` **inside the same process** using Hermes' own Python interpreter. That is the core design (it is what makes tool-approval blocking, clarifying questions and in-process callbacks possible), not a dependency you can route around.

## Why it is a good starting point for your own build

- **Same-process, no extra hop.** `server.py` → `agent_bridge.py` → `AIAgent` all live in one process. Tool callbacks, approval blocking and clarify round-trips are bridged right there, with no gateway HTTP in between.
- **Zero third-party Python dependencies.** The backend must run inside Hermes' own venv (it imports Hermes' runtime), and installing packages there would disturb Hermes' dependency tree and get wiped on upgrade. So the backend sticks to `ThreadingHTTPServer` + SSE, and keeps working across Hermes upgrades.
- **No parallel data store.** Sessions, config, skills and memory are read from Hermes' own files (`~/.hermes/state.db`, `config.yaml`, `skills/`, `memories/`). A chat you start in the web UI can be resumed with `hermes --resume`, and CLI/Telegram sessions show up in the sidebar.
- **One module per feature, with a template to copy.** To add a new view, write a module like `workbench_api.py` (plain stdlib functions), register a couple of routes in `server.py`, add a component under `web/components/workbench/`, and one entry in `TABS` in `activity-bar.tsx`. That is the whole recipe.
- **Clear frontend layering.** `web/components/{chat,workbench,layout,ui}`; colours, spacing and fonts all come from the tokens in `design-system/`. No hard-coded colours in components.
- **Docs written for AI collaborators.** `AGENTS.md` (red lines and workflow) and `PRODUCT.md` (product intent). This project has been built by AI agents all along — hand the repo to one and it can keep going.

## Features

**Chat**

- SSE streaming: assistant text and reasoning as separate streams, tool calls and results, token rate, lifecycle status
- Approval cards: when the agent wants to run a command or write a file, you get a confirm card (once / this session / always / deny) — the same gate Hermes uses
- Clarifying questions: shown one at a time, multi-select and skip supported
- Steer a running turn, or interrupt it
- Attachments and native vision: images go to the model as native multimodal input; click to open a full-screen lightbox
- Markdown rendering with syntax highlighting (shiki), copy/retry, long-reply folding, stick-to-bottom

**Sessions**

- Shared with CLI / Telegram: list, search, paging, rename, delete
- Windowing with "load earlier" paging; after a refresh it re-attaches to a turn that is still running (SSE replay)
- Subagents spawned by a session are shown on it

**Context**

- Usage ring: tokens used come from Hermes' own authoritative counters, and the window / compaction threshold are **asked of Hermes itself** rather than guessed
- Cache hit rate: Hermes' own formula, scoped to the current model
- Manual compaction (optionally with a focus hint)

**Models and channels**

- Switch model and reasoning effort (five levels) from the UI; takes effect per turn, no restart
- Add a channel: give an endpoint + key, it lists every model that endpoint serves and saves them all at once; single-model entry still works
- Remove models / channels (in-use ones are protected)
- These only write Relay's own `models.json` — Hermes' global `config.yaml` is untouched, so CLI and Telegram are unaffected

**Workbench (four views)**

- Task board: a SQLite-backed kanban (`~/.hermes/kanban.db`) with CRUD and status filtering
- Processes: process list with resource usage, plus Hermes' own process state
- Cron: reads Hermes' cron (`~/.hermes/cron/jobs.json`), toggle jobs and run one immediately
- Artifacts: lists files in the workspace directory (default `~/workspace`) so you can see what the agent produced

**Settings**

- Memory files: view/edit `memory`, `user` and `soul`, with automatic backups (last 20 kept)
- Appearance: warm-paper palette and self-hosted fonts (split by `unicode-range`)

**Skills**: type `/` in the composer to get the skill list (read from Hermes' skills directory)

## Architecture

```
browser ──SSE──▶ server.py ──▶ agent_bridge.py ──▶ AIAgent (same process)
                    │                                  ▲
                    ├──▶ sessions.py ──▶ Hermes state.db
                    └──▶ workbench_api.py ──▶ kanban.db / cron / processes / artifacts
```

nginx splits by path: `/api/` to the backend (8788), pages and frontend assets (`/`, `/_next/static/`) to the frontend (3220).

| File | What it does |
| --- | --- |
| `server.py` | stdlib HTTP server: routing, SSE, attachment upload, static fallback |
| `agent_bridge.py` | resolve model/channel → build AIAgent → run one turn → turn callbacks into events; approval / clarify bridge, mid-turn steering |
| `sessions.py` | session list / history / create / rename / delete (reads and writes Hermes' own DB), display window, image records |
| `context.py` | context usage (window / threshold / cache hit) and the skill list |
| `compress.py` | manual context compaction |
| `workbench_api.py` | workbench: board / processes / cron / artifacts |
| `models.py` | models and channels chosen in the UI (stored in `models.json`) |
| `web/` | Next.js 16 (App Router) + Tailwind v4, standalone build |
| `design-system/hermes-relay/MASTER.md` | UI design system (colours / fonts / spacing) — read it before touching the UI |
| `deploy/` | systemd units + reference nginx site config |

Runtime data lives in `~/.hermes/hermes-relay/`: `uploads/` (attachments and `index.json`), `models.json`, `metrics.json` (time-to-first-token / duration / output tokens), `partials.json`, `compactions.json`, `memory-backups/`.

## Getting it running

Prerequisites: a working Hermes Agent, Node 20.9+ (Next.js 16), nginx, and `7z` (used to generate fonts: `apt install p7zip-full`).

```bash
# 1. clone (any path; /opt/hermes-relay used here)
git clone https://github.com/<your-account>/hermes-relay /opt/hermes-relay && cd /opt/hermes-relay

# 2. generate the self-hosted fonts (font files are not in the repo; ~15 min)
web/scripts/fetch-fonts.sh

# 3. build the frontend: output lands in web/.next/standalone — that is what production runs
cd web && npm ci && npm run build
cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/   # standalone does not include static assets

# 4. try the backend (must use Hermes' own Python)
cd /opt/hermes-relay && /usr/local/lib/hermes-agent/venv/bin/python server.py
curl -s http://127.0.0.1:8788/api/health     # expect {"ok": true}

# 5. install as systemd services (adjust paths in the two unit files first)
sudo cp deploy/hermes-relay.service deploy/hermes-relay-web.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now hermes-relay hermes-relay-web

# 6. nginx: copy deploy/nginx-relay.conf into sites-available, set server_name and cert paths, reload
```

See [`.env.example`](.env.example) for environment variables — **all optional**, sensible defaults otherwise (listen on `127.0.0.1:8788`, use Hermes' own `~/.hermes/state.db`, workbench looks at `~/workspace`).

> **The backend must run on Hermes' own Python** (default `/usr/local/lib/hermes-agent/venv/bin/python`, override with `HERMES_AGENT_DIR`), not the system python3 — it imports Hermes' runtime in-process.

## API

Backend HTTP API (port 8788):

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/health` | liveness |
| GET | `/api/config` | currently resolved model / provider |
| GET | `/api/models` | available models and channels, current selection, effort levels |
| GET | `/api/skills` | skill list (powers the `/` menu) |
| GET | `/api/chats?limit=&offset=&q=` | session list (search via `q`; 50 per page, pageable) |
| POST | `/api/chats` | create a session → `{id}` (lazy: nothing is written until the first message) |
| GET | `/api/chats/<id>?turns=&before=` | session detail + display window (paged "load earlier") |
| GET | `/api/chats/<id>/stream?after=N` | SSE replay (re-attach to a running turn after refresh) |
| GET | `/api/chats/<id>/context` | context usage (window / threshold / cache hit) |
| POST | `/api/chats/<id>/turn` | **send a message, streamed over SSE** (body `{text, attachments:[{path,mime}]}`) |
| POST | `/api/chats/<id>/interrupt` | interrupt the current turn |
| POST | `/api/chats/<id>/steer` | steer mid-turn (body `{text}`) |
| POST | `/api/chats/<id>/compress` | manual compaction (body `{focus?}`, synchronous) |
| PATCH | `/api/chats/<id>` | rename (body `{title}`) |
| DELETE | `/api/chats/<id>` | delete (physical, irreversible) |
| POST | `/api/approvals` | answer an approval (body `{session_id, request_id, choice}`, choice = `once/session/always/deny`) |
| POST | `/api/clarify` | answer a clarifying question (body `{session_id, clarify_id, response}`) |
| POST | `/api/upload?session=&name=` | upload an attachment (raw bytes) → `{path,name,mime}` |
| GET | `/api/uploads/<session>/<file>` | fetch an uploaded image |
| POST | `/api/models/select` | switch current model / effort (body `{key?, effort?}`) |
| POST | `/api/models/test` | probe endpoint + key and list its models (body `{base_url, api_key, model_id?}`) |
| POST | `/api/models/add` | add one custom model (body `{name, base_url, api_key, model_id, context_length?}`) |
| POST | `/api/models/remove` | remove a UI-added model (body `{key}`) |
| POST | `/api/channels/add` | add a channel (body `{name, base_url, api_key}`; lists its models) |
| POST | `/api/channels/sync` | re-sync a channel's model list (body `{id}`) |
| POST | `/api/channels/remove` | remove a channel (body `{id}`) |
| GET | `/api/kanban/tasks?status=` | board tasks |
| POST | `/api/kanban/tasks` | create a task |
| PATCH | `/api/kanban/tasks/<id>` | update a task |
| DELETE | `/api/kanban/tasks/<id>` | delete a task |
| GET | `/api/cron/jobs` | cron jobs (read from Hermes) |
| POST | `/api/cron/toggle` | enable/disable a job (body `{id, enabled}`) |
| POST | `/api/cron/run` | run a job now (body `{id}`) |
| GET | `/api/system/processes` | process list with resource usage |
| GET | `/api/system/logs?file=&lines=` | tail a log (default `agent.log`, 150 lines) |
| GET | `/api/artifacts/files` | files in the workspace directory |
| POST | `/api/admin/restart` | restart the backend after the current turn finishes (no body) |

SSE event types: `delta` (text), `reasoning` (thinking), `tool_start` / `tool_end` / `tool`, `status` (lifecycle), `approval`, `clarify` / `clarify_end`, `error`, `done` (with usage), `eof` (end of turn).

The frontend (3220) also serves three read-only local endpoints that read from disk directly instead of going through the backend: `/local-api/memory` (memory files and backups), `/local-api/file` (file preview), `/local-api/hermes-status` (is Hermes' gateway up).

## Building on it

**Frontend**

```bash
cd web
npm run dev                    # dev server on 127.0.0.1:3220
bash scripts/dev-restart.sh    # build + copy into standalone + restart for local testing
```

> **Editing source without building changes nothing**: production runs the `web/.next/standalone` output, so run `dev-restart.sh` (or your own CI) after edits. Static asset filenames carry a content hash; if you put a CDN in front, make sure HTML is served `no-store`.

**Backend**

Restart to apply changes. **Do not use a timer, and do not `systemctl restart` from inside a session hosted by Relay** — the unit's `KillMode=control-group` will kill the executor along with the service. The right way is `POST /api/admin/restart`: it drops a marker file and restarts itself after the current turn's answer has been fully delivered (after `eof`).

**Adding a new view**

1. Backend: create `my_api.py` (plain stdlib functions) and add routes in `_api_get` / `do_POST` in `server.py`.
2. Frontend: create `web/components/workbench/my-view.tsx` and add a fetch helper in `web/lib/api.ts`.
3. Navigation: add an entry to `TABS` in `web/components/layout/activity-bar.tsx` and wire the view up in `web/app/page.tsx`.

**Styling**: colours, spacing and fonts come from the tokens in `design-system/hermes-relay/MASTER.md`. Change the CSS variables there rather than hard-coding colours in components.

## Deliberate design decisions (don't break these)

1. **No FastAPI.** The process must run inside Hermes' own Python environment; installing packages there would disturb Hermes' dependency tree and get wiped on upgrade. `ThreadingHTTPServer` + SSE is plenty.
2. **Don't hammer the agent.** The browser never polls; everything is pushed over SSE. Session lists and history are read straight from SQLite. One message runs the agent once. Titles are not generated by the model.
3. **Streaming performance.** Tokens are accumulated in a `useRef` and flushed to React state every 80 ms; message components are memoised so only the streaming one re-renders. Don't change this to one `setState` per token.
4. **Stick to bottom.** Auto-scroll only when the user was already at the bottom; scrolling up releases it (`stick` ref).
5. **The approval gate is not optional.** When the agent wants to run a command it blocks its own thread. The web UI shows a card → `POST /api/approvals` → the block is released. This is security-relevant.
6. **Never guess window or usage numbers.** Context window, compaction threshold and cache hit rate are all asked of Hermes' own resolver functions instead of keeping a private model table — otherwise they drift apart on every Hermes upgrade.

## Known limitations

- **One turn at a time per session** (Hermes' cross-process turn lease). If the same session is running in another frontend (CLI / upstream webui / Telegram), a new turn here waits on that lock and the UI just spins.
- **The default model and channel are resolved once at process start and cached**, so changing Hermes' `config.yaml` needs a backend restart. (Models/channels you add in the UI live in `models.json` and apply per turn without a restart.)
- **The sidebar lists every `webui / cli / telegram / discord / slack / api_server` session** in Hermes — the price of a shared history. To narrow it, edit `LISTED_SOURCES` in `sessions.py`.
- **Attachments are stored as files, not in the message body**: images you sent are restored on refresh from the backend's upload records (matched by timestamp ±120 s). They display, but attachments themselves are not editable and the association relies on timestamps.
- **Chrome desktop first.** Some animations use newer Chrome features (`@starting-style` etc.); Safari/Firefox degrade gracefully.
- **Session deletion is physical and irreversible.** Unless the DB has been `VACUUM`ed, deleted content can still be recovered from free pages (see the recovery script).
- **No authentication.** It assumes it only listens on loopback, or that something else sits in front of it (the reference nginx config shows an optional `auth_request` setup).

## Verification scripts

```bash
# one plain text turn (runs the agent directly, no server)
/usr/local/lib/hermes-agent/venv/bin/python scripts/smoke_turn.py "reply with exactly: ok"

# native vision: builds a left-red/right-blue image and checks the model sees it
/usr/local/lib/hermes-agent/venv/bin/python scripts/smoke_image.py

# streaming cadence (time to first token, gaps)
/usr/local/lib/hermes-agent/venv/bin/python scripts/probe_stream.py

# backend API regression (cross-site guard, parameter validation)
/usr/local/lib/hermes-agent/venv/bin/python scripts/verify_hardening.py

# offline regression for context usage / window / cache-hit math (no model calls)
/usr/local/lib/hermes-agent/venv/bin/python scripts/test_context_fixes.py

# recover a deleted session (copy the DB first)
/usr/local/lib/hermes-agent/venv/bin/python scripts/recover_deleted_session.py --db <db-copy> --sid <session-id> --markdown x.md
```

## Deployment notes

- **Fonts**: Source Sans 3 / Noto Sans SC / Sarasa Mono SC are self-hosted and split by `unicode-range`; **the files are not committed**. A fresh checkout must run `web/scripts/fetch-fonts.sh` before building, or `next build` fails looking for them.
- **Path routing**: `/api/` → backend 8788 with `proxy_buffering off` (otherwise SSE output is buffered and looks like it arrives in one lump); `/` and `/_next/static/` → frontend 3220.
- **Auth**: this project does not authenticate. The optional `auth_request` block in the reference config points at a self-hosted cookie gateway — delete it if you don't need it.
- **Caching**: HTML and `/api/` must be `private, no-store` or UI changes won't show up; content-hashed `/_next/static/` can be cached aggressively.
- **Cloudflare (optional)**: don't let it cache HTML, and let nginx trust its real IP ranges (the reference config has `set_real_ip_from`).
- **Restarting the backend**: use `POST /api/admin/restart`, not `systemctl restart` (see above).

## License

[MIT](LICENSE)
