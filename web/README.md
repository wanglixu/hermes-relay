# web —— Hermes Relay 的前端

Next.js 16（App Router，standalone）+ Tailwind CSS v4 + lucide-react + Shiki + Radix 原语。
生产跑 `.next/standalone` 的产物，监听 `127.0.0.1:3220`，对外由 nginx 反代。

## 跑起来（本机自测）

```bash
npm ci                        # 首次
npm run dev                   # 开发：127.0.0.1:3220，热更新
web/scripts/dev-restart.sh    # 生产：构建 + 部署到 standalone + 重启服务
```

- 只绑 `127.0.0.1:3220`，外部访问不到。
- 会话数据来自后端共用的 `~/.hermes/state.db`，和命令行互相可见。
- **改完源码必须重新构建**：生产跑的是 `.next/standalone` 里的产物，只改源码不生效。

## `/api` 怎么走

- **生产**：nginx 的 `location /api/` 直连 Python（8788），`/` 与 `/_next/static/` 转 3220，
  SSE 不被缓冲。
- **本机自测**：`python3 scripts/local-proxy.py 3221` → `http://127.0.0.1:3221/`（`/api` → 8788，其余 → 3220）。
  只看布局也直接开 3220 也行。
- **别用 3220 验流式**：`next.config.ts` 里的 rewrites 只是兜底（直开 3220 时让 /api 通），
  那条路会把 SSE 攒住，看着像"一下子全蹦出来"。
- 自测反代里 `resp.read1()` 不能改成 `read()`：read 会等凑够字节数，
  clarify / approval 这种几百字节的小事件会被卡住，卡片永远不出现。

## 目录

```
app/            路由（layout / page）+ globals.css（@theme 令牌 + 浏览器表面 + 正文排版）
components/ui/  无业务基础件（button / card / badge / spinner）
components/chat/ Sidebar · messages（思考/工具/正文/折叠）· markdown-view · cards（审批/询问）
                 · statusbar · composer（含上下文圆环、技能菜单、附件）
hooks/          use-sessions（会话与展示窗口）· use-turn-stream（13 种 SSE 事件状态机）
lib/            api.ts（后端契约）· markdown.ts（marked + DOMPurify + Shiki）· cn.ts
```

## 设计约定

配色 / 间距 / 字体 / 动效的规矩都在 `../design-system/hermes-relay/MASTER.md`：
**组件里不要写死颜色**，一律用 `app/globals.css` 里 `@theme` 那套 `--color-*` 令牌。
