# 静态演示站（GitHub Pages）

线上地址：**https://wanglixu.github.io/hermes-relay/**

它不是另写的一套界面，而是 **`web/` 这份前端源码的静态导出**（`output: 'export'`），
只把数据源换成浏览器里的假后端。所以折叠动画、Markdown、设置弹层、工作台四个视图，
跑的都是线上那份代码 —— 演示站和真实站点之间不存在「两套渲染」。

## 三个文件

| 文件 | 作用 |
| --- | --- |
| `demo-mock.ts` | 假后端：拦截 `/api/**` 与 `/local-api/**`，返回真实接口的**数据结构**；`/turn` 返回一条真 SSE（`ReadableStream`），事件顺序与 `server.py` + `agent_bridge.py` 一致。演示内容（会话、任务、定时、进程、产物、记忆文件）全在这个文件里。 |
| `apply_patches.py` | 把 `web/` 的副本改成可静态导出的形态：`next.config.ts` 换 `export` + `basePath`、layout 里手写的字体/图标 href 补前缀、`page.tsx` 引入 mock、删掉装不下的 route handler（`app/local-api`）与 32MB 的更纱黑体。任何一条匹配失败会直接报错。 |
| `build-demo.sh` | 一键：复制源码 → 打补丁 → `next build` → 产物写进 `docs/`。 |

## 重建

```bash
cd web && npm ci && bash scripts/fetch-fonts.sh   # 首次：依赖 + 字体
cd .. && bash demo/build-demo.sh                   # 导出到 docs/
```

本机预览（模拟 Pages 的子路径）：

```bash
mkdir -p /tmp/pages && ln -sfn "$PWD/docs" /tmp/pages/hermes-relay
python3 -m http.server 8901 --directory /tmp/pages
# 打开 http://127.0.0.1:8901/hermes-relay/
```

## 改演示内容

只改 `demo-mock.ts`，然后重新跑 `build-demo.sh`。几个约定：

- 会话的 `last_active` 用「今天」的时间戳，页面打开会自动落在最新的那条对话上。
- 想演审批 / 反问，把脚本放进 `buildTurnScript()` 里对应会话的分支（`c3` 审批、`c4` 反问）；
  `approval` / `clarify` 事件会真的挂住，直到前端 POST `/api/approvals` 或 `/api/clarify` 才继续。
- 一条回复的内容要同时出现在两个地方：SSE 脚本（流式过程）和 `collectParts()` 折叠出的
  `parts`（答完之后前端会重新拉一次会话详情，不落库就会「刷新就没」）。
- 会话预置消息里的 `parts` 与流式事件用的是同一组 `kind`：`reason` / `tool` / `text`。

## 已知差异（都是刻意的）

- **没有真实模型**：所有回复是脚本；`/turn` 的 `done` 事件里 usage 是编的。
- **等宽字体**：演示站不带更纱黑体（32MB），代码与数字退回系统等宽；拉丁与思源黑体照常自托管。
- **`/local-api`**：真实项目里由 Next 的 route handler 读本机磁盘（记忆文件、文件预览），
  演示站改成内存里的假内容（可编辑、可保存，刷新即还原）。
- **不落库**：改名 / 删除 / 新建会话只改内存，刷新即还原。
