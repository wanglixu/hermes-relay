# Hermes Relay

**给 [Hermes Agent](https://hermes-agent.nousresearch.com/docs) 做的轻量网页外壳（thin shell）。**

它不重写 agent，也不另起一套数据：模型调用、工具执行、审批闸门、技能、记忆、会话库、上下文压缩，**全部直接用 Hermes 自己的**。这个项目只做三件事——把 Hermes 跑的一轮对话用 SSE 推到浏览器、把浏览器上的操作转回 Hermes 的接口、再补上几个 Hermes 自己没有的页面（工作台、模型与渠道管理）。

后端 7 个 Python 文件、约 4000 行，**只用标准库**；前端 Next.js 16 + Tailwind v4，约 9000 行 TS/TSX。

> 前提：本机要有一份能跑的 Hermes Agent。后端不是通过 HTTP 调 Hermes，而是用 Hermes 自带的 Python 在**同一个进程里**构造 `AIAgent`——这是核心设计（换来工具审批阻塞、模型反问、进程内回调这些只有同进程才有的能力），不是可以绕开的依赖。

## 为什么适合二次开发

- **进程内直连，不多一跳**：`server.py` → `agent_bridge.py` → `AIAgent` 都在同一个进程。工具回调、审批阻塞、clarify 反问就地在进程内桥接，没有网关 HTTP 的往返。
- **后端零第三方依赖**：必须跑在 Hermes 自己的 venv 里（要 `import` 它的运行时），往那个环境装包等于动 Hermes 的依赖树、升级还可能被冲掉。所以后端只用 `ThreadingHTTPServer` + SSE，能长期跟着 Hermes 升级走。
- **不另起数据**：会话、配置、技能、记忆都读 Hermes 自己的（`~/.hermes/state.db`、`config.yaml`、`skills/`、`memories/`）。网页里聊的会话，`hermes --resume` 能接着聊；反过来 CLI / Telegram 的会话也会出现在网页侧栏。
- **一个模块一个文件，加功能有样可抄**：想加一个新视图，照 `workbench_api.py` 的样子写一个模块（纯标准库函数），在 `server.py` 注册几条路由，前端 `web/components/workbench/` 里加一个组件、在 `activity-bar.tsx` 的 `TABS` 里加一项就完事。
- **前端分层清楚**：`web/components/{chat,workbench,layout,ui}`，配色/字体/间距全部走 `design-system/` 的令牌，不在组件里写死颜色。
- **文档是写给 AI 的**：`AGENTS.md`（红线与流程）、`PRODUCT.md`（产品意图）。这个项目本身就是一路由 AI 改出来的——把仓库丢给 AI，它能自己接着干。

## 功能

**聊天**

- SSE 流式：正文与思考分开推、工具调用与结果、token 速率、生命周期状态
- 审批卡片：agent 要执行命令/写文件时弹确认（一次性 / 本会话 / 总是 / 拒绝），与 Hermes 的审批闸门同一套
- 模型反问（clarify）：逐题呈现、可多选、可跳过
- 生成中插话（steer）、打断（interrupt）
- 附件与原生识图：图片按原生多模态直接送进模型；点开有全屏灯箱
- Markdown 渲染 + 代码高亮（shiki）、复制/重试、长回复折叠、自动吸底

**会话**

- 与 CLI / Telegram 共用同一个会话库：列表、搜索、翻页、改名、删除
- 展示窗口 + 「展开更早」分段加载；刷新后自动接上正在跑的那一轮（SSE 补发）
- 每个会话派出去的子代理（subagent）会挂在会话上显示

**上下文**

- 用量环：已用 token 取 Hermes 自己的权威计数，窗口与压缩阈值**问 Hermes 自己**（不自己猜口径）
- 缓存命中率：按 Hermes 原生公式算，只算当前模型
- 手动压缩上下文（可带关注点）

**模型与渠道**

- 页面上切换模型与思考强度（五档），每轮生效，不用重启
- 加渠道：填 endpoint + key，自动列出该渠道全部模型，一次保存；也支持单个模型
- 删除模型 / 渠道（正在用的会拦一下）
- 这些只写 relay 自己的 `models.json`，**不动 Hermes 全局 `config.yaml`**——命令行与微信/Telegram 端不受影响

**工作台（四个视图）**

- 任务看板：SQLite 落地的看板（`~/.hermes/kanban.db`），增删改查、按状态筛选
- 后台进程：进程列表与资源占用、Hermes 自己进程的状态
- 定时任务：读 Hermes 的 cron（`~/.hermes/cron/jobs.json`），开关与「立即执行」
- 产物沙箱：列出工作目录（默认 `~/workspace`）里的文件，方便看 agent 产出的东西

**设置**

- 记忆文件：看 / 改 `memory`、`user`、`soul` 三份文件，改前自动留备份（保留最近 20 份）
- 界面外观：暖纸配色与字体（自托管、按 `unicode-range` 切片）

**技能**：输入框打 `/` 出技能清单（读 Hermes 的 skills 目录）

## 架构

```
浏览器 ──SSE──▶ server.py ──▶ agent_bridge.py ──▶ AIAgent（同进程）
                    │                                  ▲
                    ├──▶ sessions.py ──▶ Hermes state.db
                    └──▶ workbench_api.py ──▶ kanban.db / cron / 进程 / 产物
```

nginx 按路径分两路：`/api/` 进后端（8788），页面与前端资源（`/`、`/_next/static/`）进前端（3220）。

| 文件 | 干什么 |
| --- | --- |
| `server.py` | 标准库 HTTP 服务：路由、SSE、附件上传、静态回退 |
| `agent_bridge.py` | 解析模型渠道 → 构造 AIAgent → 跑一轮 → 回调转事件；审批 / clarify 桥、生成中插话 |
| `sessions.py` | 会话列表 / 历史 / 新建 / 改名 / 删除（读写 Hermes 自己的库）、展示窗口、图片记录 |
| `context.py` | 上下文用量（窗口 / 阈值 / 缓存命中）与技能清单 |
| `compress.py` | 手动压缩上下文 |
| `workbench_api.py` | 工作台：看板 / 进程 / 定时任务 / 产物沙箱 |
| `models.py` | 页面上的模型与渠道（存 `models.json`） |
| `web/` | Next.js 16（App Router）+ Tailwind v4，standalone 构建 |
| `design-system/hermes-relay/MASTER.md` | UI 设计系统（配色 / 字体 / 间距），改界面前先看它 |
| `deploy/` | systemd 单元 + nginx 站点参考配置 |

运行数据在 `~/.hermes/hermes-relay/`：`uploads/`（附件与 `index.json`）、`models.json`（页面加的模型与渠道）、`metrics.json`（首字延迟 / 耗时 / 输出 token 埋点）、`partials.json`、`compactions.json`、`memory-backups/`。

## 跑起来

前置：能跑的 Hermes Agent、Node 20.9+（Next.js 16 要求）、nginx、`7z`（生成字体用，`apt install p7zip-full`）。

```bash
# 1. 拿代码（路径随你，示例用 /opt/hermes-relay）
git clone https://github.com/<你的账号>/hermes-relay /opt/hermes-relay && cd /opt/hermes-relay

# 2. 生成自托管字体（字体文件不进仓库，新环境必须先跑；约 15 分钟）
web/scripts/fetch-fonts.sh

# 3. 构建前端：产物落在 web/.next/standalone，生产跑的就是它
cd web && npm ci && npm run build
cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/   # standalone 不含静态资源，要手动拷

# 4. 试跑后端（必须用 Hermes 自带的 Python）
cd /opt/hermes-relay && /usr/local/lib/hermes-agent/venv/bin/python server.py
curl -s http://127.0.0.1:8788/api/health     # 期望 {"ok": true}

# 5. 装成 systemd 服务（先按实际路径改两个单元文件）
sudo cp deploy/hermes-relay.service deploy/hermes-relay-web.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now hermes-relay hermes-relay-web

# 6. nginx：拷 deploy/nginx-relay.conf 到 sites-available，改 server_name 和证书路径后 reload
```

环境变量见 [`.env.example`](.env.example)：**全部可选**，不设就走默认值（监听 `127.0.0.1:8788`、会话库取 Hermes 自己的 `~/.hermes/state.db`、工作台看 `~/workspace`）。

> **后端必须用 Hermes 自带的 Python**（默认 `/usr/local/lib/hermes-agent/venv/bin/python`，可用 `HERMES_AGENT_DIR` 改），不能用系统 python3——进程内要 import Hermes 的运行时。

## 接口

后端（8788）的 HTTP 接口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 存活检查 |
| GET | `/api/config` | 当前解析出的模型 / 渠道 |
| GET | `/api/models` | 可选模型与渠道清单、当前选择、思考强度档位 |
| GET | `/api/skills` | 技能清单（输入框 `/` 菜单用它） |
| GET | `/api/chats?limit=&offset=&q=` | 会话列表（`q` 搜索，默认 50 条、可翻页） |
| POST | `/api/chats` | 新建会话 → `{id}`（懒创建：不落库，发第一条消息才写进去） |
| GET | `/api/chats/<id>?turns=&before=` | 会话详情 + 展示窗口（分段加载 + 「展开更早」） |
| GET | `/api/chats/<id>/stream?after=N` | SSE 补发（刷新后接上正在跑的这轮） |
| GET | `/api/chats/<id>/context` | 上下文用量（窗口 / 阈值 / 缓存命中） |
| POST | `/api/chats/<id>/turn` | **发一条消息，SSE 流式返回**（body `{text, attachments:[{path,mime}]}`） |
| POST | `/api/chats/<id>/interrupt` | 打断当前这一轮 |
| POST | `/api/chats/<id>/steer` | 生成中插话（body `{text}`） |
| POST | `/api/chats/<id>/compress` | 手动压缩上下文（body `{focus?}`，同步返回） |
| PATCH | `/api/chats/<id>` | 改名（body `{title}`） |
| DELETE | `/api/chats/<id>` | 删除（物理删除，不可逆） |
| POST | `/api/approvals` | 审批答复（body `{session_id, request_id, choice}`，choice = `once/session/always/deny`） |
| POST | `/api/clarify` | 回答模型的反问（body `{session_id, clarify_id, response}`） |
| POST | `/api/upload?session=&name=` | 上传附件（原始字节）→ `{path,name,mime}` |
| GET | `/api/uploads/<会话>/<文件>` | 取回已上传的图片 |
| POST | `/api/models/select` | 切换当前模型 / 思考强度（body `{key?, effort?}`） |
| POST | `/api/models/test` | 测 endpoint + key，顺便列该接口提供的模型（body `{base_url, api_key, model_id?}`） |
| POST | `/api/models/add` | 加单个自定义模型（body `{name, base_url, api_key, model_id, context_length?}`） |
| POST | `/api/models/remove` | 删除页面上自己加的模型（body `{key}`） |
| POST | `/api/channels/add` | 加一个渠道（body `{name, base_url, api_key}`，自动列模型） |
| POST | `/api/channels/sync` | 重新同步渠道的模型列表（body `{id}`） |
| POST | `/api/channels/remove` | 删除渠道（body `{id}`） |
| GET | `/api/kanban/tasks?status=` | 看板任务列表 |
| POST | `/api/kanban/tasks` | 新建任务 |
| PATCH | `/api/kanban/tasks/<id>` | 更新任务（状态 / 内容） |
| DELETE | `/api/kanban/tasks/<id>` | 删除任务 |
| GET | `/api/cron/jobs` | 定时任务列表（读 Hermes 的 cron） |
| POST | `/api/cron/toggle` | 开关某个任务（body `{id, enabled}`） |
| POST | `/api/cron/run` | 立即执行（body `{id}`） |
| GET | `/api/system/processes` | 进程列表与资源占用 |
| GET | `/api/system/logs?file=&lines=` | 读日志尾部（默认 `agent.log`、150 行） |
| GET | `/api/artifacts/files` | 工作目录里的文件列表 |
| POST | `/api/admin/restart` | 让后端在答完当前这轮后自动重启（无 body） |

SSE 事件类型：`delta`（正文增量）、`reasoning`（思考增量）、`tool_start` / `tool_end` / `tool`（工具）、`status`（生命周期）、`approval`（要你授权）、`clarify` / `clarify_end`（模型反问）、`error`、`done`（带用量）、`eof`（这一轮结束）。

前端（3220）另有三个只读的本地接口，直接读盘、不绕后端：`/local-api/memory`（记忆文件与备份）、`/local-api/file`（预览文件）、`/local-api/hermes-status`（Hermes 网关是否在跑）。

## 二次开发

**改前端**

```bash
cd web
npm run dev                    # 开发服务器，127.0.0.1:3220
bash scripts/dev-restart.sh    # 构建 + 拷进 standalone + 重启本机自测
```

> **只改源码不构建等于没改**：生产跑的是 `web/.next/standalone` 的产物，改完必须跑一次 `dev-restart.sh`（或走 CI）。
> 静态资源文件名带内容哈希，正常不会拿到旧版；如果前面挂了 CDN 并且按路径缓存，记得让 HTML 走 `no-store`。

**改后端**

改完要重启才生效。**不要用定时器，也不要在 relay 托管的会话里 `systemctl restart`**——服务的 `KillMode=control-group` 会连执行者一起杀掉。正路是 `POST /api/admin/restart`：它只写一个标记文件，等服务把当前这一轮答案完整发完（`eof` 之后）再自己重启，不用掐表等。

**加一个新视图（工作台那样的）**

1. 后端：新建 `my_api.py`（纯标准库函数），在 `server.py` 的 `_api_get` / `do_POST` 里加两条路由；
2. 前端：`web/components/workbench/my-view.tsx` 写组件，`web/lib/api.ts` 加取数函数；
3. 导航：在 `web/components/layout/activity-bar.tsx` 的 `TABS` 里加一项，在 `web/app/page.tsx` 里接上这个视图。

**样式**：颜色、间距、字体全部来自 `design-system/hermes-relay/MASTER.md` 的令牌，改配色请改那里的 CSS 变量，不要在组件里写死颜色。

## 几个刻意的设计（别改坏了）

1. **不用 FastAPI**：进程内必须跑在 Hermes 自带的 Python 环境里，往那个环境装第三方包等于动 Hermes 自己的依赖树，升级还可能被冲掉。标准库 `ThreadingHTTPServer` + SSE 完全够用。
2. **不高频打扰 agent**：浏览器不轮询，所有更新靠 SSE 单向推；会话列表和历史消息直接读 SQLite；一条消息只跑一次 agent；标题不调用模型生成。
3. **流式性能**：token 先攒进 `useRef`，每 80ms 才刷一次 React state；消息组件 memo 化，只有正在输出的那条会重渲染。不要改成「每个 token 一次 setState」。
4. **自动吸底**：只有当用户本来就贴着底部时才自动滚，往上翻过就不抢滚动位置（`stick` ref）。
5. **审批不能省**：agent 要执行命令时会在自己的线程里阻塞等待。网页弹确认卡片 → `POST /api/approvals` → 解除阻塞。这是安全相关的，不是可选项。
6. **窗口与用量不自己猜**：上下文窗口、压缩阈值、缓存命中率都问 Hermes 自己的解析函数，而不是自己维护一份模型表——不然迟早跟 Hermes 的升级对不上。

## 已知限制

- **一个会话同时只能跑一轮**（Hermes 的跨进程 turn lease）。同一会话在别的入口（CLI / 上游 webui / Telegram）正跑着时，这里新开的一轮会等那边的会话锁，界面上表现为一直转圈。
- **默认模型与渠道在进程启动时解析一次并缓存**，改了 Hermes 的 `config.yaml` 要重启后端（页面上自己加的模型/渠道存在 `models.json`，每轮生效、不用重启）。
- **侧栏列的是 Hermes 里所有 `webui / cli / telegram / discord / slack / api_server` 会话**——共用历史的代价。想只看某一类，改 `sessions.py` 里的 `LISTED_SOURCES`。
- **附件只存文件、不进消息正文**：发出去的图片刷新后靠后端 uploads 记录（按时间戳 ±120 秒匹配）恢复显示，能看；但附件本身不能再编辑，关联也依赖时间戳。
- **主要面向 Chrome 桌面端**：部分动效用了 Chrome 较新的特性（`@starting-style` 等），Safari / Firefox 上会优雅退化。
- **会话删除是物理删除，不可逆**。库没被 `VACUUM` 过时，误删的内容还能从空闲页里捞回来（见下）。
- **不做登录**：默认假设它只监听回环，或者前面有别的网关（参考 nginx 配置里那段可选接法）。

## 验证脚本

```bash
# 一轮纯文字（命令行跑，不开服务）
/usr/local/lib/hermes-agent/venv/bin/python scripts/smoke_turn.py "只回复两个字：收到"

# 原生识图：现造一张左红右蓝的图，看模型认不认得出
/usr/local/lib/hermes-agent/venv/bin/python scripts/smoke_image.py

# 量流式节奏（首字延迟 / 每段间隔）；走公网时用 PROBE_BASE + RELAY_COOKIE
/usr/local/lib/hermes-agent/venv/bin/python scripts/probe_stream.py

# 后端接口回归（跨站拦截、参数校验等）
/usr/local/lib/hermes-agent/venv/bin/python scripts/verify_hardening.py

# 上下文用量/窗口/缓存命中的离线回归（不连模型，纯算）
/usr/local/lib/hermes-agent/venv/bin/python scripts/test_context_fixes.py

# 误删会话抢救（先拷库副本再跑）
/usr/local/lib/hermes-agent/venv/bin/python scripts/recover_deleted_session.py --db <库副本> --sid <会话id> --markdown x.md
```

## 部署要点

- **字体**：中英文字体（Source Sans 3 / Noto Sans SC / Sarasa Mono SC）都是自托管并按 `unicode-range` 切片，**文件本身不入库**——所以新环境构建前必须先跑 `web/scripts/fetch-fonts.sh`，否则 `next build` 会在找字体那一步失败。
- **路由分流**：`/api/` → 后端 8788 且 `proxy_buffering off`（否则 SSE 的字会被攒住、看着像「一下子全蹦出来」）；`/` 与 `/_next/static/` → 前端 3220。
- **登录/鉴权**：本项目不做登录。参考配置里那段 `auth_request`（指向自建 cookie 网关）是可选接法——不需要就整段删掉。
- **缓存**：HTML 与 `/api/` 必须 `private, no-store`，否则改了界面看不到新版；带内容哈希的 `/_next/static/` 可以放心长缓存。
- **Cloudflare（可选）**：用它的话别让它缓存 HTML，并让 nginx 信任它的真实 IP 段（参考配置里已有 `set_real_ip_from`）。
- **改完后端重启**：走 `POST /api/admin/restart`，别用 `systemctl restart`（见上）。

## 许可

[MIT](LICENSE)
