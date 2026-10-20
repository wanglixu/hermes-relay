/* ═══════════════════════════════════════════════════════════════════
   Hermes Relay — 静态演示站脚本
   一份纯前端假数据 + 一套回放引擎：不需要后端就能看到
   「思考 → 工具 → 正文」的流式过程、审批 / 反问卡片、折叠、耗时与 tok/s。
   真实项目里这些数据来自 SSE（server.py + agent_bridge.py），这里按同样的
   数据结构（parts: reason / tool / text）回放。
   ═══════════════════════════════════════════════════════════════════ */

const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel))

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ───────────────────────────── 图标 ───────────────────────────── */

const P = {
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  kanban:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 7v7M12 7v4M16 7v9"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  box: '<path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  ellipsis: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  paperclip:
    '<path d="M21 12.5 12.6 21a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7-7"/>',
  send: '<path d="M3 11.5 21 3l-8.5 18-2.2-7.3z"/>',
  square: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  retry: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  quote: '<path d="M7 7h4v4a4 4 0 0 1-4 4"/><path d="M15 7h4v4a4 4 0 0 1-4 4"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>',
}

function icon(name, size = 16, stroke = 1.9) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`
}

/* 折叠行的箭头（与真实项目同一个 path，10px） */
const CHEV = `<svg class="chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2.2 6.5 5 3.5 7.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`

/* ─────────────────────────── Markdown ─────────────────────────── */

const KEYWORDS = new Set(
  ('const let var function return if else for of in while class new async await import from export default ' +
    'try catch throw typeof interface type def print None True False self not and or with as pass lambda ' +
    'true false null undefined').split(' '),
)

/** 极简高亮：注释 / 字符串 / 关键字 / 数字。真实项目用 Shiki 双主题上色。 */
function highlight(code, lang) {
  const src = esc(code)
  const re =
    /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|(&quot;(?:[^&]|&(?!quot;))*&quot;|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b[A-Za-z_][A-Za-z0-9_]*\b)|(\b\d+(?:\.\d+)?\b)/g
  return src.replace(re, (m, comment, str, word, num) => {
    if (comment) return `<span class="tok-c">${comment}</span>`
    if (str) return `<span class="tok-s">${str}</span>`
    if (word && KEYWORDS.has(word)) return `<span class="tok-k">${word}</span>`
    if (num) return `<span class="tok-n">${num}</span>`
    return m
  })
}

const FILE_RE =
  /((?:[\w.@~-]+\/)*[\w.-]+\.(?:tsx|ts|jsx|js|mjs|cjs|py|md|json|ya?ml|css|sh|go|rs|sql|toml|conf|service))(?::\d+)?/g

function inline(text) {
  const slots = []
  const keep = (html) => `\u0000${slots.push(html) - 1}\u0000`
  let s = text
  s = s.replace(/`([^`]+)`/g, (_, c) => keep(`<code>${esc(c)}</code>`))
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) =>
    keep(`<a href="${esc(u)}" target="_blank" rel="noreferrer">${esc(t)}</a>`),
  )
  s = s.replace(/\*\*([^*]+)\*\*/g, (_, t) => keep(`<strong>${esc(t)}</strong>`))
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, (_, pre, t) => pre + keep(`<em>${esc(t)}</em>`))
  s = esc(s)
  // 文件路径 → 可点的预览
  s = s.replace(FILE_RE, (m) => keep(`<span class="file-path" data-path="${esc(m)}">${esc(m)}</span>`))
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)])
  return s
}

/** 块级 Markdown：标题 / 段落 / 列表 / 代码 / 表格 / 引用 / 分隔线 */
function md(src) {
  const lines = String(src ?? '').replace(/\r\n/g, '\n').split('\n')
  const out = []
  let i = 0
  let para = []

  const flush = () => {
    if (!para.length) return
    out.push(`<p>${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`)
    para = []
  }

  while (i < lines.length) {
    const line = lines[i]

    // 代码围栏
    const fence = line.match(/^```(\w*)\s*$/)
    if (fence) {
      flush()
      const lang = fence[1] || ''
      const buf = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++])
      i++
      out.push(`<pre><code>${highlight(buf.join('\n'), lang)}</code></pre>`)
      continue
    }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      flush()
      const lv = Math.min(3, h[1].length)
      out.push(`<h${lv}>${inline(h[2])}</h${lv}>`)
      i++
      continue
    }

    // 分隔线
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      flush()
      out.push('<hr>')
      i++
      continue
    }

    // 引用
    if (/^>\s?/.test(line)) {
      flush()
      const buf = []
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''))
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`)
      continue
    }

    // 表格
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      flush()
      const cells = (l) =>
        l
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim())
      const head = cells(lines[i])
      i += 2
      const rows = []
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) rows.push(cells(lines[i++]))
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`,
      )
      continue
    }

    // 列表（含嵌套一层）
    const ul = line.match(/^(\s*)[-*+]\s+(.*)$/)
    const ol = line.match(/^(\s*)\d+[.)]\s+(.*)$/)
    if (ul || ol) {
      flush()
      const ordered = !!ol
      const items = []
      while (i < lines.length) {
        const m1 = lines[i].match(/^(\s*)[-*+]\s+(.*)$/)
        const m2 = lines[i].match(/^(\s*)\d+[.)]\s+(.*)$/)
        if (!m1 && !m2) break
        const m = m1 || m2
        items.push({ indent: m[1].length, text: m[2] })
        i++
      }
      const render = (start, depth) => {
        const tag = ordered && depth === 0 ? 'ol' : 'ul'
        let html = `<${tag}>`
        for (let k = start; k < items.length; k++) {
          const it = items[k]
          if (it.indent < depth) break
          html += `<li>${inline(it.text)}`
          const next = items[k + 1]
          if (next && next.indent > it.indent) {
            const sub = render(k + 1, next.indent)
            html += sub.html
            k = sub.end
          }
          html += '</li>'
        }
        return { html: html + `</${tag}>`, end: items.length - 1 }
      }
      out.push(render(0, 0).html)
      continue
    }

    if (!line.trim()) {
      flush()
      i++
      continue
    }

    para.push(line)
    i++
  }
  flush()
  return out.join('')
}

/* ─────────────────────── 格式化小工具 ─────────────────────── */

/** 数字说人话：一万以上用「万」（真实项目 context-ring 的 fmt 同一口径） */
const fmtK = (n) => {
  if (!n) return '0'
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿'
  if (n >= 1e4) return (n / 1e4).toFixed(n >= 1e6 ? 0 : 1) + '万'
  return String(n)
}

function fmtDur(sec, digits = 1) {
  const s = Math.max(0, Number(sec) || 0)
  if (s < 60) return `${s.toFixed(digits)}秒`
  if (s < 3600) {
    const m = Math.floor(s / 60)
    const rest = s - m * 60
    return `${m}分${rest < 10 ? rest.toFixed(digits) : Math.round(rest)}秒`
  }
  const h = Math.floor(s / 3600)
  return `${h}时${Math.round((s - h * 3600) / 60)}分`
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.top = '-1000px'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

/* ─────────────────────── 演示数据 ─────────────────────── */

const NOW = Date.now()
const ts = (minsAgo) => new Date(NOW - minsAgo * 60000)
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
const mmdd = (d) => `${d.getMonth() + 1}/${d.getDate()}`

const IMG_RECEIPT =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="460" viewBox="0 0 360 460">
      <rect width="360" height="460" fill="#f4f1e8"/>
      <rect x="28" y="24" width="304" height="412" fill="#fffdf6" stroke="#e2ddd0"/>
      <g fill="#cfc9ba" font-family="monospace" font-size="13">
        <text x="56" y="70" font-size="17" fill="#8c5a3b">SUPERMARKET</text>
        <text x="56" y="96">2026-10-18  19:24</text>
        <text x="56" y="126">牛乳            ¥ 218</text>
        <text x="56" y="150">卵 10個         ¥ 298</text>
        <text x="56" y="174">食パン          ¥ 178</text>
        <text x="56" y="198">野菜セット      ¥ 398</text>
        <text x="56" y="222">洗剤            ¥ 248</text>
        <text x="56" y="258" fill="#2d2d2a">合計            ¥ 1,340</text>
        <text x="56" y="286">(内消費税 ¥ 121)</text>
      </g>
      <rect x="56" y="320" width="248" height="1" fill="#e2ddd0"/>
      <g fill="#cfc9ba" font-family="monospace" font-size="12">
        <text x="56" y="346">PayPay  残高決済</text>
        <text x="56" y="368">承認番号 8842-1190</text>
      </g>
      <rect x="228" y="380" width="76" height="30" fill="none" stroke="#b8a894"/>
      <text x="240" y="400" font-family="monospace" font-size="11" fill="#b8a894">PAID</text>
    </svg>`,
  )

const CHATS = [
  {
    id: 'c1',
    title: '折叠动效与 tok/s 口径',
    group: '今天',
    when: hhmm(ts(38)),
    messages: [
      {
        role: 'user',
        text: '回复里的思考块和工具调用，为什么答完要收成一行？顺便说下 tok/s 到底怎么算的。',
      },
      {
        role: 'assistant',
        parts: [
          {
            kind: 'reason',
            text: '用户问两件事：一是答完后「思考 / 工具」为什么收成一行胶囊，二是 tok/s 的口径。前者要解释折叠为什么会把答案淹掉，后者要区分「生成中」和答完后的两个数——这两者分母不同，混着说会被追问。先看一遍实现，再回答。',
          },
          { kind: 'tool', name: 'read_file', brief: 'web/components/chat/messages.tsx', args: '{"path": "web/components/chat/messages.tsx", "limit": 120}', result: '（已读取 731 行）LeadingChain / intoGroups / Tail 三个函数与折叠逻辑都在这里。' },
          { kind: 'tool', name: 'terminal', brief: 'grep -n “tok/s” hooks/use-turn-stream.ts', args: '{"command": "grep -n \\"tps\\\\|片段\\" web/hooks/use-turn-stream.ts", "workdir": "/srv/hermes-relay"}', result: '41: const tps = chunks / genSeconds\n88: // 实时值只按本轮收到的片段数估，不乘历史比例' },
          {
            kind: 'text',
            text: `## 为什么要收成一行

思考动辄几千字，直接铺开会把回答整个淹掉。答完之后把「思考行 / 工具行」按顺序打包成**一颗胶囊**，只报数量；点开还是原来的内容，位置也没变：

- 收起用 \`height\` 过渡（120–150ms ease-out），不用 \`display: none\` —— 布局缓存留着，30 个块也只要约 5ms
- 展开时同帧改 \`scrollTop\`，块不会「往上跳」
- 正文不参与折叠，按原顺序照旧铺开

\`\`\`js
// 高度与滚动补偿在同一帧里写，避免逐帧过冲
box.scrollTop -= startTop - el.getBoundingClientRect().top
\`\`\`

### tok/s 的两个口径

| 位置 | 算法 | 说明 |
| --- | --- | --- |
| 生成中 | 片段数 ÷ 收字秒数 | 前面带 \`≈\`，就是真实解码速度 |
| 答完后 | \`out_tokens ÷ gen_seconds\` | 分子含工具参数的 token，读数偏高 |

细节都在 web/components/chat/messages.tsx 里。实测对账：纯文字 767 个片段 = \`usage\` 的 768 completion_tokens，所以**1 片段 ≈ 1 token**；偏高的是定稿值，因为工具参数不走流式回调，分母里没有对应的时间。

> 一句话：生成中看趋势，答完后看成本，两个数不要互相校准。`,
          },
        ],
        elapsed: 72.4,
        ttft: 0.86,
        out_tokens: 4390,
        gen_seconds: 70.8,
      },
    ],
    script: [
      {
        k: 'reason',
        text: '用户问两件事：一是答完后「思考 / 工具」为什么收成一行胶囊，二是 tok/s 的口径。前者要解释折叠为什么会把答案淹掉，后者要区分「生成中」和答完后的两个数——这两者分母不同，混着说会被追问。先看一遍实现，再回答。',
      },
      { k: 'tool', name: 'read_file', brief: 'web/components/chat/messages.tsx', args: '{"path": "web/components/chat/messages.tsx", "limit": 120}', result: '（已读取 731 行）LeadingChain / intoGroups / Tail 三个函数与折叠逻辑都在这里。' },
      { k: 'tool', name: 'terminal', brief: 'grep -n “tok/s” hooks/use-turn-stream.ts', args: '{"command": "grep -n \\"tps\\\\|片段\\" web/hooks/use-turn-stream.ts", "workdir": "/srv/hermes-relay"}', result: '41: const tps = chunks / genSeconds\n88: // 实时值只按本轮收到的片段数估，不乘历史比例' },
      {
        k: 'text',
        text: `## 为什么要收成一行

思考动辄几千字，直接铺开会把回答整个淹掉。答完之后把「思考行 / 工具行」按顺序打包成**一颗胶囊**，只报数量；点开还是原来的内容，位置也没变：

- 收起用 \`height\` 过渡（120–150ms ease-out），不用 \`display: none\` —— 布局缓存留着，30 个块也只要约 5ms
- 展开时同帧改 \`scrollTop\`，块不会「往上跳」
- 正文不参与折叠，按原顺序照旧铺开

\`\`\`js
// 高度与滚动补偿在同一帧里写，避免逐帧过冲
box.scrollTop -= startTop - el.getBoundingClientRect().top
\`\`\`

### tok/s 的两个口径

| 位置 | 算法 | 说明 |
| --- | --- | --- |
| 生成中 | 片段数 ÷ 收字秒数 | 前面带 \`≈\`，就是真实解码速度 |
| 答完后 | \`out_tokens ÷ gen_seconds\` | 分子含工具参数的 token，读数偏高 |

细节都在 web/components/chat/messages.tsx 里。实测对账：纯文字 767 个片段 = \`usage\` 的 768 completion_tokens，所以**1 片段 ≈ 1 token**；偏高的是定稿值，因为工具参数不走流式回调，分母里没有对应的时间。

> 一句话：生成中看趋势，答完后看成本，两个数不要互相校准。`,
      },
    ],
    stats: { elapsed: 72.4, ttft: 0.86, out_tokens: 4390, gen_seconds: 70.8 },
  },

  {
    id: 'c2',
    title: '网关日志按密钥筛选',
    group: '今天',
    when: hhmm(ts(155)),
    messages: [
      { role: 'user', text: '管理后台的请求日志，能按密钥筛选吗？现在只能看全部。' },
      {
        role: 'assistant',
        parts: [
          {
            kind: 'reason',
            text: '这是给自建网关加一个筛选维度。先确认日志里有没有记录 key，再决定是前端过滤还是后端过滤——日志是 JSONL，按行扫一遍就能同时产出统计，不必专门建索引。',
          },
          { kind: 'tool', name: 'read_file', brief: 'main.go（日志结构与统计聚合）', args: '{"path": "main.go", "limit": 200}' },
          {
            kind: 'text',
            text: `可以。日志每条都带 \`key_id\`，所以**按密钥筛选只是多一个维度的聚合**，不需要改写入格式。

1. 后端：读日志时按 \`key_id\` 分组，一次扫描同时产出「每小时请求数」「每日 token 数」和「按密钥汇总」
2. 前端：表格上方加一个下拉，选中后 URL 带上 \`?key=\`，刷新不会丢筛选
3. 空态：该密钥还没有请求时显示「这段时间没有记录」，而不是空表格

\`\`\`go
type Bucket struct {
    Hour   int            \`json:"hour"\`
    Reqs   int            \`json:"reqs"\`
    Tokens map[string]int \`json:"tokens"\` // key_id → token 数
}
\`\`\`

验证方式：拿生产日志的副本跑一遍聚合，把「各密钥之和」和「总条数」对账；再在页面上切换两个密钥，确认请求条数跟 \`grep -c\` 的结果一致。`,
          },
        ],
        elapsed: 41.2,
        ttft: 1.24,
        out_tokens: 1830,
        gen_seconds: 39.6,
      },
    ],
    script: [
      {
        k: 'reason',
        text: '这是给自建网关加一个筛选维度。先确认日志里有没有记录 key，再决定是前端过滤还是后端过滤——日志是 JSONL，按行扫一遍就能同时产出统计，不必专门建索引。',
      },
      { k: 'tool', name: 'read_file', brief: 'main.go（日志结构与统计聚合）', args: '{"path": "main.go", "limit": 200}' },
      {
        k: 'text',
        text: `可以。日志每条都带 \`key_id\`，所以**按密钥筛选只是多一个维度的聚合**，不需要改写入格式。

1. 后端：读日志时按 \`key_id\` 分组，一次扫描同时产出「每小时请求数」「每日 token 数」和「按密钥汇总」
2. 前端：表格上方加一个下拉，选中后 URL 带上 \`?key=\`，刷新不会丢筛选
3. 空态：该密钥还没有请求时显示「这段时间没有记录」，而不是空表格

\`\`\`go
type Bucket struct {
    Hour   int            \`json:"hour"\`
    Reqs   int            \`json:"reqs"\`
    Tokens map[string]int \`json:"tokens"\` // key_id → token 数
}
\`\`\`

验证方式：拿生产日志的副本跑一遍聚合，把「各密钥之和」和「总条数」对账；再在页面上切换两个密钥，确认请求条数跟 \`grep -c\` 的结果一致。`,
      },
    ],
    stats: { elapsed: 41.2, ttft: 1.24, out_tokens: 1830, gen_seconds: 39.6 },
  },

  {
    id: 'c3',
    title: '磁盘告警排查',
    group: '昨天',
    when: mmdd(ts(60 * 26)),
    agents: [
      { state: 'ok', goal: '找出 /var 里增长最快的目录', seconds: 12 },
      { state: 'ok', goal: '核对 journald 的保留策略', seconds: 8 },
      { state: 'run', goal: '评估清理脚本的影响范围', seconds: null },
    ],
    messages: [
      { role: 'user', text: '服务器又提示磁盘快满了，帮我看看是哪块长的，别动生产数据。' },
      {
        role: 'assistant',
        parts: [
          {
            kind: 'reason',
            text: '先量再动。只看总量没意义，要按目录找出增长点；然后判断是日志、备份还是镜像缓存。清理方案先不动手，因为删文件不可逆，需要用户点头。',
          },
          { kind: 'tool', name: 'terminal', brief: 'df -h / && du -xh --max-depth=1 /var | sort -h', args: '{"command": "df -h / | tail -1 && du -xh --max-depth=1 /var 2>/dev/null | sort -h | tail -6"}', result: 'Filesystem  Size Used Avail Use%\n/dev/sda1    98G  91G  6.6G  94%\n\n18G  /var/log\n4.1G /var/lib/docker\n1.8G /var/backups' },
          {
            kind: 'text',
            text: `## 结论

**\`/var/log\` 吃掉了 18G**，其中 \`journald\` 占了 12G —— 没有设置上限，一直按天累积。

### 建议按这个顺序处理

- 先给 journald 设上限：\`SystemMaxUse=1G\`，它会自己回收，不用手动删
- 再看 \`/var/log/app/*.log\`：有 4.3G 是三个月前的构建日志，可以清
- \`docker\` 的 4.1G 里有 2.7G 是悬空镜像，\`docker image prune\` 就能回收

> 清理脚本需要你确认后才会执行，我不会擅自动生产目录。`,
          },
        ],
        elapsed: 58.9,
        ttft: 2.1,
        out_tokens: 2980,
        gen_seconds: 56.4,
      },
    ],
    script: [
      {
        k: 'reason',
        text: '先量再动。只看总量没意义，要按目录找出增长点；然后判断是日志、备份还是镜像缓存。清理方案先不动手，因为删文件不可逆，需要用户点头。',
      },
      { k: 'tool', name: 'terminal', brief: 'df -h / && du -xh --max-depth=1 /var', args: '{"command": "df -h / | tail -1 && du -xh --max-depth=1 /var 2>/dev/null | sort -h | tail -6"}', result: 'Filesystem  Size Used Avail Use%\n/dev/sda1    98G  91G  6.6G  94%\n\n18G  /var/log\n4.1G /var/lib/docker\n1.8G /var/backups' },
      {
        k: 'approval',
        command: "find /var/log/app -name '*.log' -mtime +90 -delete",
        goal: '删掉 /var/log/app 下 90 天以前的旧构建日志，大约 4.3G。',
        risk: '文件会被直接删除，不进回收站，删了找不回来。影响范围仅 /var/log/app 下的 .log 文件。',
        danger: true,
        denyText: '好，先不动生产目录。需要的话你可以自己跑上面那条命令，或者改成移到 /var/backups 再观察一周。',
      },
      {
        k: 'text',
        text: `清理完成，根分区从 **94%** 降到 **61%**：

| 项目 | 回收 | 方式 |
| --- | --- | --- |
| journald | 11.2G | 设上限后自动回收 |
| 旧构建日志 | 4.3G | 按 90 天清理 |
| 悬空镜像 | 2.7G | \`docker image prune -f\` |

后续不用再手动清 —— journald 现在自己封顶了，超过 1G 会自动轮转。`,
      },
    ],
    stats: { elapsed: 58.9, ttft: 2.1, out_tokens: 2980, gen_seconds: 56.4 },
  },

  {
    id: 'c4',
    title: '这张收据帮我记一笔',
    group: '本周',
    when: mmdd(ts(60 * 24 * 3)),
    image: true,
    messages: [
      {
        role: 'user',
        text: '刚买的东西，帮我记进账本，分类你看着办。',
        image: IMG_RECEIPT,
      },
      {
        role: 'assistant',
        parts: [
          {
            kind: 'reason',
            text: '收据上是五件日用品和食品，总额 1,340 日元，含税 121。按记账 App 的分类规则，食品和日用品应该拆开或归到「日用」。金额和日期都能读到，但分类有多种合理选择，先给一个默认，再让用户确认。',
          },
          { kind: 'tool', name: 'read_image', brief: '识别收据金额与日期', args: '{"path": "uploads/c4/receipt-1932.jpg"}' },
          {
            kind: 'text',
            text: `识别到一笔支出：

- 金额：**¥1,340**（含税 ¥121）
- 日期：2026-10-18 19:24
- 商家类型：超市（食品 + 日用品）

我按「日用」先记了。如果要拆成「食品 / 日用」两笔，告诉我比例就行。`,
          },
        ],
        elapsed: 22.6,
        ttft: 1.05,
        out_tokens: 960,
        gen_seconds: 21.4,
      },
    ],
    script: [
      {
        k: 'reason',
        text: '收据上是五件日用品和食品，总额 1,340 日元，含税 121。按记账 App 的分类规则，食品和日用品应该拆开或归到「日用」。金额和日期都能读到，但分类有多种合理选择，先给一个默认，再让用户确认。',
      },
      { k: 'tool', name: 'read_image', brief: '识别收据金额与日期', args: '{"path": "uploads/c4/receipt-1932.jpg"}' },
      {
        k: 'text',
        text: `识别到一笔支出：

- 金额：**¥1,340**（含税 ¥121）
- 日期：2026-10-18 19:24
- 商家类型：超市（食品 + 日用品）

我按「日用」先记了。如果要拆成「食品 / 日用」两笔，告诉我比例就行。`,
      },
      {
        k: 'clarify',
        question: '这笔 1,340 日元记到哪个分类？',
        choices: [
          { label: '日用（超市）', recommended: true },
          { label: '食品' },
          { label: '拆成食品 + 日用' },
        ],
      },
    ],
    stats: { elapsed: 22.6, ttft: 1.05, out_tokens: 960, gen_seconds: 21.4 },
  },

  {
    id: 'c5',
    title: '苏州还是广州',
    group: '更早',
    when: mmdd(ts(60 * 24 * 12)),
    messages: [
      { role: 'user', text: '几年后回国，苏州和广州选哪个？主要看落户难度和 IT 岗位。' },
      {
        role: 'assistant',
        parts: [
          {
            kind: 'text',
            text: `两个城市的取舍不在「哪个更好」，而在**你的时间线和落户方式**。

### 硬门槛对比

| 维度 | 苏州 | 广州 |
| --- | --- | --- |
| 落户方式 | 人才引进（学历 / 职称 / 社保） | 学历入户 + 积分入户 |
| 门槛倾向 | 看学历与单位资质 | 看社保年限与年龄 |
| IT 岗位密度 | 制造业信息化、外企研发 | 互联网、游戏、跨境电商 |
| 生活成本 | 中等，房租压力小 | 偏高，但岗位溢价也高 |

### 如果是我会这样判断

1. 先确认学历能不能直接走人才引进 —— 这决定要不要攒社保年限
2. 岗位方向：做后端 / 数据选广州，做工业软件、汽车电子选苏州
3. 房子 20 万首付在苏州的可选面明显更宽，广州要往增城、从化看

> 结论：**优先看 offer 落在哪边**，落户政策随时会调，但一份三年期的岗位决定你这三年的收入曲线。`,
          },
        ],
        elapsed: 63.7,
        ttft: 1.62,
        out_tokens: 2410,
        gen_seconds: 61.2,
      },
    ],
    script: [
      {
        k: 'text',
        text: `两个城市的取舍不在「哪个更好」，而在**你的时间线和落户方式**。

| 维度 | 苏州 | 广州 |
| --- | --- | --- |
| 落户方式 | 人才引进 | 学历 / 积分入户 |
| IT 岗位密度 | 制造业信息化、外企研发 | 互联网、游戏、跨境电商 |
| 生活成本 | 中等 | 偏高 |

> 结论：优先看 offer 落在哪边。`,
      },
    ],
    stats: { elapsed: 63.7, ttft: 1.62, out_tokens: 2410, gen_seconds: 61.2 },
  },
]

const FALLBACK_SCRIPT = [
  {
    k: 'reason',
    text: '这是演示站里的预设回复：真实项目在这一步会把消息发给后端、由 agent 边生成边通过 SSE 回传。这里用同样的数据结构回放，所以折叠、耗时、流式光标的行为跟线上一致。',
  },
  {
    k: 'tool',
    name: 'search_files',
    brief: '在项目里找相关实现',
    args: '{"pattern": "fold-body|animateFold", "path": "web/"}',
    result: 'web/components/chat/messages.tsx:48\nweb/app/globals.css:212',
  },
  {
    k: 'text',
    text: `收到。这是一个**静态演示**，没有真实模型在后面，但我把这一轮的样子完整演了一遍：

1. 一段思考（折叠成一行，点开能看全文）
2. 一次工具调用（工具名 + 参数，点开有参数和结果）
3. 一段正文（Markdown：标题、列表、代码、表格都支持）

> 想继续看回复效果，可以点左下角的「重放这轮回复」，或者换一个侧栏里的会话看审批卡片和反问卡片。`,
  },
]

/* ─────────────────────── 状态 ─────────────────────── */

const state = {
  chats: structuredClone(CHATS),
  current: 'c1',
  query: '',
  searchOpen: false,
  stream: null, // { chatId, parts, chars, startedAt }
  turn: null, // { cancelled, resolveApproval, resolveClarify }
  card: null, // { kind:'approval'|'clarify', data }
  models: {
    channel: 'cline-pass',
    model: 'deepseek-v4.1-flash',
    effort: 'medium',
    efforts: [
      { value: 'none', label: '关', hint: '不思考，最快' },
      { value: 'low', label: '低', hint: 'low' },
      { value: 'medium', label: '中', hint: 'medium' },
      { value: 'high', label: '高', hint: 'high' },
      { value: 'max', label: '最高', hint: 'max，最慢' },
    ],
    list: [
      { channel: 'cline-pass', id: 'deepseek-v4.1-flash', ctx: '1M', note: '当前' },
      { channel: 'cline-pass', id: 'deepseek-v4.1-pro', ctx: '1M' },
      { channel: 'anthropic', id: 'claude-opus-4.6', ctx: '200k' },
      { channel: 'openai', id: 'gpt-5.5', ctx: '400k' },
    ],
  },
  context: { used: 131072, window: 1048576, cache: 0.88, turns: 12 },
  openKeys: new Set(),
  replaying: false,
}

const chat = (id = state.current) => state.chats.find((c) => c.id === id)
const effortLabel = (v) => state.models.efforts.find((e) => e.value === v)?.label ?? v

/* ─────────────────────── 侧栏 ─────────────────────── */

const GROUP_ORDER = ['今天', '昨天', '本周', '更早']

function renderSidebar() {
  const nav = $('#chatList')
  const q = state.query.trim()
  const list = q
    ? state.chats.filter((c) => (c.title || '').includes(q))
    : state.chats

  if (!list.length) {
    nav.innerHTML = `<p class="side-empty">${q ? `没找到带「${esc(q)}」的会话。` : '还没有对话，点上面「新建聊天」开始。'}</p>`
    return
  }

  const groups = new Map()
  for (const c of list) {
    if (!groups.has(c.group)) groups.set(c.group, [])
    groups.get(c.group).push(c)
  }

  nav.innerHTML = GROUP_ORDER.filter((g) => groups.has(g))
    .map(
      (g) => `<div>
        <div class="group-label">${g}</div>
        ${groups
          .get(g)
          .map(
            (c) => `<div class="chat-item" data-id="${c.id}" data-active="${c.id === state.current}">
              <div class="name" title="${esc(c.title)}">${esc(c.title)}</div>
              <span class="when">${esc(c.when)}</span>
              <button class="dots" aria-label="会话操作：${esc(c.title)}" aria-expanded="false">${icon('ellipsis', 16, 2.4)}</button>
            </div>
            ${
              c.agents
                ? `<details class="agents">
                    <summary><span class="caret">▸</span>${c.agents.length} 个子代理</summary>
                    <ul>${c.agents
                      .map(
                        (a) => `<li>
                          <span class="state ${a.state}">${a.state === 'ok' ? '完成' : '跑着'}</span>
                          <span class="goal" title="${esc(a.goal)}">${esc(a.goal)}</span>
                          ${a.seconds != null ? `<span class="sec">${a.seconds}s</span>` : ''}
                        </li>`,
                      )
                      .join('')}</ul>
                  </details>`
                : ''
            }
          </div>`,
          )
          .join('')}
      </div>`,
    )
    .join('')
}

function bindSidebar() {
  const nav = $('#chatList')
  nav.addEventListener('click', (e) => {
    const dots = e.target.closest('.dots')
    if (dots) {
      e.stopPropagation()
      const item = dots.closest('.chat-item')
      openChatMenu(item.dataset.id, dots)
      return
    }
    const item = e.target.closest('.chat-item')
    if (!item) return
    if (state.stream) stopTurn()
    state.current = item.dataset.id
    renderAll()
    if (window.innerWidth <= 900) toggleSidebar(false)
  })
}

let menuEl = null
function closeChatMenu() {
  menuEl?.remove()
  menuEl = null
  $$('.dots[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'))
}

function openChatMenu(id, anchor) {
  closeChatMenu()
  const bar = anchor.getBoundingClientRect()
  menuEl = document.createElement('div')
  menuEl.className = 'ctx-menu'
  menuEl.innerHTML = `<button data-act="rename">重命名</button><button data-act="delete" class="danger">删除</button>`
  document.body.appendChild(menuEl)
  const w = menuEl.offsetWidth
  menuEl.style.top = `${Math.round(bar.bottom + 2)}px`
  menuEl.style.left = `${Math.round(bar.right - w)}px`
  anchor.setAttribute('aria-expanded', 'true')

  menuEl.addEventListener('click', (e) => {
    const act = e.target.dataset.act
    closeChatMenu()
    const c = chat(id)
    if (!c) return
    if (act === 'rename') {
      openModal({
        title: '重命名会话',
        body: '会话标题会写进 Hermes 的会话库，网页、命令行、聊天客户端都会看到同一个名字。',
        input: c.title,
        confirm: '保存',
        onConfirm: (v) => {
          if (v.trim()) c.title = v.trim()
          renderSidebar()
          renderTopbar()
        },
      })
    } else if (act === 'delete') {
      openModal({
        title: '删除这个会话？',
        body: '记录会从 Hermes 会话库里物理删除，删了找不回来。',
        confirm: '删除',
        danger: true,
        onConfirm: () => {
          state.chats = state.chats.filter((x) => x.id !== id)
          if (state.current === id) state.current = state.chats[0]?.id ?? null
          renderAll()
        },
      })
    }
  })
}

document.addEventListener('mousedown', (e) => {
  if (menuEl && !menuEl.contains(e.target)) closeChatMenu()
})

/* ─────────────────────── 顶栏 ─────────────────────── */

function renderTopbar() {
  const c = chat()
  $('#chatTitle').textContent = c?.title || '新对话'
  $('#replayBtn').style.display = c?.messages?.length ? '' : 'none'
  const status = $('#linkStatus')
  status.dataset.link = state.stream ? 'live' : 'idle'
  $('#linkText').textContent = state.stream ? '接收中' : '运行中'
}

/* ─────────────────────── 消息渲染 ─────────────────────── */

const DOT = (cls) => `<span class="dot ${cls}"></span>`

function keyOf(msgIdx, partIdx) {
  return `${state.current}:${msgIdx}:${partIdx}`
}

function thinkBlock(part, msgIdx, partIdx, live) {
  const open = state.openKeys.has(keyOf(msgIdx, partIdx))
  const flat = String(part.text || '').replace(/\s+/g, ' ').trim()
  if (!flat) return ''
  const shown = flat.length > 220 ? flat.slice(0, 220) + ' …' : flat
  return `<div class="think-row fold" data-open="${open}">
    <button class="fold-head" aria-expanded="${open}" data-fold="${msgIdx}:${partIdx}">
      ${DOT('think')}
      <span class="label">思考</span>
      <span class="peek">${esc(shown)}</span>
      ${CHEV}
    </button>
    <div class="fold-inner">
      <div class="think-body">${esc(part.text)}</div>
    </div>
  </div>`
}

function toolBlock(part, msgIdx, partIdx) {
  const mutate = /terminal|bash|write|patch|edit|delete|rm|exec|run/i.test(part.name)
  const open = state.openKeys.has(keyOf(msgIdx, partIdx))
  const hasBody = part.args || part.result
  const summary = `<span class="name">${esc(part.name)}</span>${
    part.brief ? `<span class="brief">${esc(part.brief)}</span>` : ''
  }`

  if (!hasBody) {
    return `<div class="tool-row single">
      <div class="fold-head">${DOT(mutate ? 'accent' : 'muted')}${summary}</div>
    </div>`
  }

  return `<div class="tool-row ${mutate ? 'mutate' : ''} fold" data-open="${open}">
    <button class="fold-head" aria-expanded="${open}" data-fold="${msgIdx}:${partIdx}">
      ${DOT(mutate ? 'accent' : 'muted')}${summary}${CHEV}
    </button>
    <div class="fold-inner">
      <div class="tool-body">
        ${
          part.args
            ? `<div class="sec-label"><i></i>参数</div><pre>${esc(part.args)}</pre>`
            : ''
        }
        ${
          part.result
            ? `<div class="sec-label"><i></i>结果</div><pre>${esc(part.result)}</pre>`
            : ''
        }
      </div>
    </div>
  </div>`
}

function chainChip(parts, msgIdx, chainIdx) {
  const open = state.openKeys.has(`chain:${msgIdx}:${chainIdx}`)
  const thinks = parts.filter((p) => p.kind === 'reason').length
  const tools = parts.filter((p) => p.kind === 'tool').length
  const bits = []
  if (thinks) bits.push(`思考 <span class="count">${thinks}</span> 段`)
  if (tools) bits.push(`工具 <span class="count">${tools}</span> 次`)
  return `<div class="fold" data-open="${open}">
    <button class="chain-toggle" aria-expanded="${open}" data-chain="${msgIdx}:${chainIdx}">
      ${DOT('accent-text')}
      <span>${bits.join('<span class="sep"> · </span>')}</span>
      ${CHEV}
    </button>
    <div class="fold-inner">
      <div class="chain-body">${parts
        .map((p, i) =>
          p.kind === 'reason' ? thinkBlock(p, msgIdx, `c${chainIdx}-${i}`) : toolBlock(p, msgIdx, `c${chainIdx}-${i}`),
        )
        .join('')}</div>
    </div>
  </div>`
}

function intoGroups(parts) {
  const out = []
  for (const p of parts) {
    const last = out[out.length - 1]
    if (last && last[0].kind !== 'text' === (p.kind !== 'text')) last.push(p)
    else out.push([p])
  }
  return out
}

function renderParts(parts, msgIdx, live) {
  const lastTextIdx = parts.reduce((acc, p, i) => (p.kind === 'text' ? i : acc), -1)
  return parts
    .map((p, i) => {
      if (p.kind === 'reason') return thinkBlock(p, msgIdx, i, live)
      if (p.kind === 'tool') return toolBlock(p, msgIdx, i)
      return `<div class="prose-relay"><div class="${live && i === lastTextIdx ? 'stream-tail' : ''}">${md(p.text)}</div></div>`
    })
    .join('')
}

function renderAssistantParts(parts, msgIdx) {
  return intoGroups(parts)
    .map((g, i) => (g[0].kind !== 'text' && g.length >= 2 ? chainChip(g, msgIdx, i) : renderParts(g, msgIdx, false)))
    .join('')
}

const plainText = (parts) => parts.filter((p) => p.kind === 'text').map((p) => p.text).join('\n\n').trim()

function tailHtml(msg, liveTps) {
  const bits = []
  if (msg.elapsed) bits.push(fmtDur(msg.elapsed))
  if (msg.ttft) bits.push(`首字 ${fmtDur(msg.ttft, 2)}`)
  const tps = liveTps ?? (msg.out_tokens && msg.gen_seconds ? msg.out_tokens / msg.gen_seconds : null)
  return `<div class="tail">
    <button class="copy" aria-label="复制">${icon('copy', 12)}<span>复制</span></button>
    <button class="regen" aria-label="重新生成">${icon('retry', 12)}<span>重新生成</span></button>
    ${bits.length ? `<span class="sep">·</span><span class="durs">${bits.join(' <span class="sep">·</span> ')}</span>` : ''}
    ${
      tps != null
        ? `<span class="tps ${liveTps != null ? 'live' : ''}"><i></i>${liveTps != null ? '≈ ' : ''}${
            tps < 1 ? '＜1' : Math.round(tps)
          } tok/s</span>`
        : ''
    }
  </div>`
}

function renderMessage(msg, msgIdx) {
  if (msg.role === 'user') {
    return `<div class="msg-row user" data-msg="${msgIdx}">
      <div class="bubble">
        ${msg.image ? `<img class="thumb" src="${msg.image}" alt="上传的图片" data-zoom="1">` : ''}
        <div class="prose-relay">${md(msg.text)}</div>
      </div>
    </div>`
  }
  if (msg.role === 'notice') {
    return `<div class="msg-row"><div class="system-notice" style="margin:0"><i></i>${esc(msg.text)}</div></div>`
  }
  if (msg.role === 'error') {
    return `<div class="msg-row"><div class="error-box">${esc(msg.text)}</div></div>`
  }
  return `<div class="msg-row" data-msg="${msgIdx}">
    <div class="prose-relay">
      ${renderAssistantParts(msg.parts, msgIdx)}
      ${
        msg.stopped
          ? `<div class="tail">${icon('copy', 12)}<span>已被你停止（这半截没有存进历史）</span></div>`
          : tailHtml(msg)
      }
    </div>
  </div>`
}

function emptyState() {
  const suggestions = [
    '解释一下这个报错',
    '把这段代码重构成小函数',
    '帮我查一下日本电气代行的最新公告',
    '把这段话改得更像人写的',
  ]
  return `<div class="empty">
    <div class="mark"><span>R</span></div>
    <h2>随时告诉我你的想法</h2>
    <p>提问、分析代码、检索资料，或输入 <code>/</code> 查看可用技能</p>
    <div class="chips">${suggestions.map((s) => `<button data-suggest="${esc(s)}">${esc(s)}</button>`).join('')}</div>
    <button class="shuffle">${icon('refresh', 12)}<span>换一批</span></button>
  </div>`
}

/* ─────────────────────── 渲染主流程 ─────────────────────── */

function renderStream() {
  const box = $('#stream')
  const col = $('#streamCol')
  const c = chat()
  const msgs = c?.messages ?? []
  const stream = state.stream && state.stream.chatId === state.current ? state.stream : null

  if (!msgs.length && !stream) {
    col.innerHTML = emptyState()
  } else {
    col.innerHTML =
      msgs.map((m, i) => renderMessage(m, i)).join('') +
      (stream ? renderStreaming(stream) : '')
  }

  renderCards()
  syncFade()
  box.scrollTop = box.scrollHeight
}

function renderStreaming(stream) {
  const parts = stream.parts
  const elapsed = (Date.now() - stream.startedAt) / 1000
  const tps = stream.chars ? (stream.chars / Math.max(0.4, elapsed)) / 1.6 : null
  return `<div class="msg-row">
    <div class="prose-relay">
      ${parts.length ? renderParts(parts, 'live', true) : `<span class="typing"><i></i><i></i><i></i></span>`}
      ${parts.some((p) => p.kind === 'text') ? `<div class="tail"><span class="tps live"><i></i>≈ ${Math.round(tps || 0)} tok/s</span></div>` : ''}
    </div>
  </div>`
}

function syncFade() {
  const box = $('#stream')
  const top = box.scrollTop
  const bottom = box.scrollHeight - box.clientHeight - box.scrollTop
  box.style.setProperty('--fade-top', top > 6 ? '28px' : '0px')
  box.style.setProperty('--fade-bottom', bottom > 6 ? '28px' : '0px')
}

function renderCards() {
  const slot = $('#cardSlot')
  const card = state.card
  if (!card) {
    slot.innerHTML = ''
    return
  }
  if (card.kind === 'approval') {
    slot.innerHTML = `<div class="approval-card" role="dialog" aria-label="需要你确认才能继续">
      <div class="head">
        <h3>需要你确认才能继续</h3>
        <div class="left${card.left <= 60 ? ' urgent' : ''}">还剩 ${Math.floor(card.left / 60)}:${String(card.left % 60).padStart(2, '0')}</div>
      </div>
      <div class="facts">
        <div><div class="k">这条命令要做什么</div><div class="v">${esc(card.data.goal)}</div></div>
        <div><div class="k">风险</div><div class="v risk" data-danger="${!!card.data.danger}">${esc(card.data.risk)}</div></div>
      </div>
      <button class="cmd-toggle">${card.showCmd ? '收起命令原文' : '查看命令原文'}</button>
      ${card.showCmd ? `<pre>${esc(card.data.command)}</pre>` : ''}
      <div class="actions">
        <button class="btn-ghost" data-decide="deny">拒绝</button>
        <button class="btn-ghost" data-decide="session">本会话都允许</button>
        <button class="btn-ghost" data-decide="always">以后都允许</button>
        <button class="btn-primary" data-decide="once">允许这一次</button>
      </div>
    </div>`
  } else {
    slot.innerHTML = `<div class="clarify-card" role="dialog" aria-label="需要你回答">
      <h3>需要你回答<span class="sub">第 1 / 1 题</span></h3>
      <div class="q">${esc(card.data.question)}</div>
      ${card.data.choices
        .map(
          (ch, i) => `<button class="choice" aria-pressed="${card.picked === i}" data-choice="${i}">
            <span class="label">${esc(ch.label)}</span>
            ${ch.recommended ? '<span class="rec">推荐</span>' : ''}
            <span class="tick">${card.picked === i ? icon('check', 13, 3) : ''}</span>
          </button>`,
        )
        .join('')}
      <button class="choice skip" aria-pressed="${card.picked === 'skip'}" data-choice="skip">
        <span class="label">跳过该问题</span>
        <span class="tick">${card.picked === 'skip' ? icon('check', 13, 3) : ''}</span>
      </button>
      <div class="foot">
        <span></span>
        <button class="btn-line" ${card.picked == null ? 'disabled' : ''} data-submit="1">${icon('send', 13, 2.5)}发送</button>
      </div>
    </div>`
  }
}

function renderAll() {
  renderSidebar()
  renderTopbar()
  renderStream()
  syncComposer()
}

/* ─────────────────────── 折叠交互 ─────────────────────── */

/** 折叠动画：高度与滚动补偿在同一帧里写（真实项目 animateFold 的同一套做法）。
 *  只改 height 不做 scrollTop 补偿的话，贴底容器里的块会看起来「向上弹」。 */
function animateFold(wrap, open) {
  const inner = wrap.querySelector(':scope > .fold-inner')
  if (!inner) return
  const box = $('#stream')
  const from = inner.getBoundingClientRect().height
  const anchorTop = wrap.getBoundingClientRect().top
  wrap.dataset.open = String(open)
  inner.style.height = from + 'px'
  const to = open ? inner.scrollHeight : 0
  const start = performance.now()
  const DUR = 150
  const step = (now) => {
    const p = Math.min(1, (now - start) / DUR)
    const eased = 1 - Math.pow(1 - p, 3)
    inner.style.height = `${from + (to - from) * eased}px`
    // 同帧补偿滚动：块本身不动，下面的内容被推开/收回
    box.scrollTop += wrap.getBoundingClientRect().top - anchorTop
    if (p < 1) requestAnimationFrame(step)
    else inner.style.height = open ? '' : '0px'
    syncFade()
  }
  requestAnimationFrame(step)
}

document.addEventListener('click', (e) => {
  const foldBtn = e.target.closest('[data-fold]')
  if (foldBtn) {
    const k = foldBtn.dataset.fold
    const wrap = foldBtn.closest('.fold')
    const open = wrap.dataset.open === 'true'
    foldBtn.setAttribute('aria-expanded', String(!open))
    if (!open) state.openKeys.add(keyOf(...k.split(':')))
    else state.openKeys.delete(keyOf(...k.split(':')))
    animateFold(wrap, !open)
    return
  }
  const chainBtn = e.target.closest('[data-chain]')
  if (chainBtn) {
    const k = chainBtn.dataset.chain
    const wrap = chainBtn.closest('.fold')
    const open = wrap.dataset.open === 'true'
    chainBtn.setAttribute('aria-expanded', String(!open))
    const key = `chain:${k}`
    if (!open) state.openKeys.add(key)
    else state.openKeys.delete(key)
    animateFold(wrap, !open)
    return
  }

  // 复制 / 重新生成
  const copyBtn = e.target.closest('.tail .copy')
  if (copyBtn) {
    const row = copyBtn.closest('.msg-row')
    const idx = Number(row.dataset.msg)
    const msg = chat()?.messages[idx]
    const text = msg ? plainText(msg.parts || []) : row.innerText
    copyText(text).then((ok) => {
      if (!ok) return
      copyBtn.classList.add('copied')
      copyBtn.innerHTML = `${icon('check', 12, 2.5)}<span>已复制</span>`
      setTimeout(() => {
        copyBtn.classList.remove('copied')
        copyBtn.innerHTML = `${icon('copy', 12)}<span>复制</span>`
      }, 1500)
    })
    return
  }
  const regen = e.target.closest('.tail .regen')
  if (regen) {
    replay()
    return
  }

  // 审批卡
  const decide = e.target.closest('[data-decide]')
  if (decide && state.turn?.resolveApproval) {
    const choice = decide.dataset.decide
    const fn = state.turn.resolveApproval
    state.turn.resolveApproval = null
    fn(choice)
    return
  }
  const cmdToggle = e.target.closest('.cmd-toggle')
  if (cmdToggle && state.card?.kind === 'approval') {
    state.card.showCmd = !state.card.showCmd
    renderCards()
    return
  }

  // 反问卡
  const choice = e.target.closest('[data-choice]')
  if (choice && state.card?.kind === 'clarify') {
    state.card.picked = choice.dataset.choice === 'skip' ? 'skip' : Number(choice.dataset.choice)
    renderCards()
    return
  }
  const submit = e.target.closest('[data-submit]')
  if (submit && state.card?.kind === 'clarify' && state.card.picked != null && state.turn?.resolveClarify) {
    const picked =
      state.card.picked === 'skip' ? '跳过该问题' : state.card.data.choices[state.card.picked].label
    const fn = state.turn.resolveClarify
    state.turn.resolveClarify = null
    state.card = null
    renderCards()
    fn(picked)
    return
  }

  // 建议 chips
  const sug = e.target.closest('[data-suggest]')
  if (sug) {
    $('#input').value = sug.dataset.suggest
    syncComposer()
    $('#input').focus()
    return
  }
  const shuffle = e.target.closest('.shuffle')
  if (shuffle) {
    const chips = $$('#streamCol .chips button')
    const texts = chips.map((b) => b.textContent)
    texts.push(texts.shift())
    chips.forEach((b, i) => (b.textContent = texts[i]))
    return
  }

  // 图片放大
  const zoom = e.target.closest('[data-zoom]')
  if (zoom) {
    $('#lightbox').dataset.open = 'true'
    $('#lightboxImg').src = zoom.src
    return
  }
  if (e.target.id === 'lightbox') {
    $('#lightbox').dataset.open = 'false'
    return
  }

  // 文件路径预览
  const fp = e.target.closest('.file-path')
  if (fp) {
    openPreview(fp.dataset.path)
    return
  }

  // 气泡外点击关闭浮层
  if (!e.target.closest('#modelTrigger') && !e.target.closest('#modelPop')) closeModelPop()
  if (!e.target.closest('.ring') && !e.target.closest('#ringPanel')) closeRing()
})

/* ─────────────────────── 流式回放引擎 ─────────────────────── */

/** useScript=true 用会话自带的演示脚本（「重放」按钮），
 *  false 用通用回复（自己输入的新消息，避免答非所问）。 */
function startStream(useScript = true) {
  const c = chat()
  if (!c) return Promise.resolve()
  const turn = { cancelled: false, resolveApproval: null, resolveClarify: null, resolveStop: null }
  state.turn = turn
  state.stream = { chatId: c.id, parts: [], chars: 0, startedAt: Date.now() }

  const script = useScript && c.script && c.script.length ? c.script : FALLBACK_SCRIPT
  renderAll()
  let denied = false
  let denyText = ''

  return (async () => {
    for (const step of script) {
      if (turn.cancelled) break

      if (step.k === 'reason') {
        const part = { kind: 'reason', text: '' }
        state.stream.parts.push(part)
        for (let i = 0; i < step.text.length; i += 3) {
          if (turn.cancelled) break
          part.text = step.text.slice(0, i + 3)
          state.stream.chars = state.stream.parts.reduce((n, p) => n + (p.text?.length || 0), 0)
          renderStream()
          await sleep(16)
        }
        part.text = step.text
        continue
      }

      if (step.k === 'tool') {
        const part = { kind: 'tool', name: step.name, brief: step.brief }
        state.stream.parts.push(part)
        renderStream()
        await sleep(420)
        part.args = step.args
        renderStream()
        await sleep(260)
        part.result = step.result
        renderStream()
        await sleep(160)
        continue
      }

      if (step.k === 'approval') {
        state.card = { kind: 'approval', data: step, showCmd: true, left: 300 }
        renderCards()
        const timer = setInterval(() => {
          if (!state.card) return clearInterval(timer)
          state.card.left = Math.max(0, state.card.left - 1)
          const el = $('#cardSlot .approval-card .left')
          if (el) {
            el.textContent = state.card.left > 0 ? `还剩 ${Math.floor(state.card.left / 60)}:${String(state.card.left % 60).padStart(2, '0')}` : '已超时'
            el.classList.toggle('urgent', state.card.left <= 60)
          }
        }, 1000)
        const choice = await new Promise((res) => (turn.resolveApproval = res))
        clearInterval(timer)
        state.card = null
        renderCards()
        if (choice === 'deny') {
          denied = true
          denyText = step.denyText || '已按你的选择停止，没有动生产环境。'
          break
        }
        continue
      }

      if (step.k === 'clarify') {
        state.card = { kind: 'clarify', data: step, picked: null }
        renderCards()
        const answer = await new Promise((res) => (turn.resolveClarify = res))
        state.card = null
        renderCards()
        const part = { kind: 'text', text: '' }
        state.stream.parts.push(part)
        const reply = `好，记到「${answer}」。这一笔已入库，月报里的分类会立刻更新。`
        for (let i = 0; i < reply.length; i += 2) {
          if (turn.cancelled) break
          part.text = reply.slice(0, i + 2)
          renderStream()
          await sleep(18)
        }
        part.text = reply
        continue
      }

      // 正文
      const part = { kind: 'text', text: '' }
      state.stream.parts.push(part)
      for (let i = 0; i < step.text.length; i += 2) {
        if (turn.cancelled) break
        part.text = step.text.slice(0, i + 2)
        state.stream.chars = state.stream.parts.reduce((n, p) => n + (p.text?.length || 0), 0)
        renderStream()
        await sleep(18)
      }
      part.text = step.text
      await sleep(120)
    }

    const parts = state.stream.parts
    const elapsed = (Date.now() - state.stream.startedAt) / 1000
    const chars = parts.reduce((n, p) => n + (p.text?.length || 0), 0)
    const stopped = turn.cancelled || (!parts.length && !denied)

    if (denied) {
      parts.push({ kind: 'text', text: denyText })
    }
    if (parts.length) {
      c.messages.push({
        role: 'assistant',
        parts: parts.map((p) => ({ ...p })),
        elapsed: Math.round(elapsed * 10) / 10,
        ttft: 0.9,
        out_tokens: Math.round(chars / 1.7),
        gen_seconds: Math.max(0.6, Math.round((elapsed - 1) * 10) / 10),
        stopped,
      })
    }
    state.stream = null
    state.turn = null
    state.card = null
    renderAll()
  })()
}

function stopTurn() {
  if (!state.turn) return
  state.turn.cancelled = true
  if (state.turn.resolveApproval) {
    const fn = state.turn.resolveApproval
    state.turn.resolveApproval = null
    fn('deny')
  }
  if (state.turn.resolveClarify) {
    const fn = state.turn.resolveClarify
    state.turn.resolveClarify = null
    fn('跳过该问题')
  }
  state.card = null
  renderCards()
}

/** 重放当前会话最后一条提问：把脚本演一遍 */
async function replay() {
  if (state.replaying) return
  const c = chat()
  if (!c) return
  if (state.stream) stopTurn()
  // 去掉最后一轮助手回复，保留提问
  let lastUser = -1
  c.messages.forEach((m, i) => {
    if (m.role === 'user') lastUser = i
  })
  if (lastUser >= 0) c.messages = c.messages.slice(0, lastUser + 1)
  state.replaying = true
  try {
    await startStream(true)
  } finally {
    state.replaying = false
  }
}

/* ─────────────────────── 输入区 ─────────────────────── */

function syncComposer() {
  const box = $('#composerBox')
  const input = $('#input')
  const busy = !!state.stream
  box.classList.toggle('multiline', input.value.includes('\n') || input.scrollHeight > 54)
  input.style.height = 'auto'
  input.style.height = Math.min(220, input.scrollHeight) + 'px'

  $('#sendBtn').style.display = busy ? 'none' : ''
  $('#busyActions').style.display = busy ? 'flex' : 'none'
  $('#sendBtn').disabled = !input.value.trim()
  $('#steerBtn').classList.toggle('steer', !!input.value.trim())
  $('#steerBtn').disabled = !input.value.trim()

  $('#cacheHit').textContent = `缓存命中 ${state.context.cache === null ? '无数据' : Math.round(state.context.cache * 100) + '%'}`
  $('#modelChannel').textContent = state.models.channel
  $('#modelName').textContent = state.models.model
  $('#modelEffort').textContent = effortLabel(state.models.effort)

  const pct = Math.min(100, (state.context.used / state.context.window) * 100)
  const circ = 2 * Math.PI * 9
  $('#ringArc').setAttribute('stroke-dasharray', `${(circ * pct) / 100} ${circ}`)
  $('#ringPanel .bar i').style.width = pct + '%'
  $('#ringPct').textContent = String(Math.round(pct))
  $('#ringUsed').textContent = `${fmtK(state.context.used)} / ${fmtK(state.context.window)}（${pct.toFixed(0)}%）`
  $('#ringCache').textContent = state.context.cache === null ? '无数据' : Math.round(state.context.cache * 100) + '%'
}

function sendMessage() {
  const input = $('#input')
  const text = input.value.trim()
  if (!text || state.stream) return
  const c = chat()
  if (!c) return
  c.messages.push({ role: 'user', text })
  input.value = ''
  syncComposer()
  startStream(false)
}

$('#input').addEventListener('input', syncComposer)
$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    if (state.stream) {
      if (!state.stream.parts.length) return
      // 插话：真实项目会 steer 到正在跑的那一轮
      const note = { role: 'notice', text: `插话已发送：${$('#input').value.trim() || '（空）'}` }
      chat().messages.push(note)
      $('#input').value = ''
      syncComposer()
      renderStream()
    } else {
      sendMessage()
    }
  }
})
$('#sendBtn').addEventListener('click', sendMessage)
$('#stopBtn').addEventListener('click', stopTurn)
$('#steerBtn').addEventListener('click', () => {
  if (!state.stream) return
  const text = $('#input').value.trim()
  if (!text) return
  chat().messages.push({ role: 'notice', text: `插话已发送：${text}` })
  $('#input').value = ''
  syncComposer()
  renderStream()
})
$('#newChat').addEventListener('click', () => {
  if (state.stream) stopTurn()
  const id = 'c' + (Date.now() % 100000)
  state.chats.unshift({ id, title: '新对话', group: '今天', when: hhmm(new Date()), messages: [], script: null })
  state.current = id
  renderAll()
  $('#input').focus()
})
$('#attachBtn').addEventListener('click', () => {
  chat()?.messages.push({ role: 'notice', text: '演示站不上传文件：真实项目会把附件落到 uploads/<会话>/，图片直接贴进气泡。' })
  renderStream()
})

/* 上下文圆环 */
function closeRing() {
  $('#ringPanel').dataset.open = 'false'
}
$('#ringBtn').addEventListener('click', (e) => {
  e.stopPropagation()
  const panel = $('#ringPanel')
  panel.dataset.open = panel.dataset.open === 'true' ? 'false' : 'true'
})
$('#compressBtn').addEventListener('click', async (e) => {
  e.stopPropagation()
  closeRing()
  const c = chat()
  if (!c) return
  c.messages.push({ role: 'notice', text: '正在压缩上下文…' })
  renderStream()
  await sleep(1400)
  c.messages.pop()
  const before = state.context.used
  state.context.used = Math.round(before * 0.28)
  c.messages.push({
    role: 'notice',
    text: `上下文已压缩（${fmtK(before)} → ${fmtK(state.context.used)} tokens，耗时 38.5秒）`,
  })
  syncComposer()
  renderStream()
})

/* 模型面板 */
function closeModelPop() {
  $('#modelPop').dataset.open = 'false'
}
function renderModelPop() {
  const m = state.models
  $('#modelPop').innerHTML = `
    <div class="pop-head"><span class="t">选择渠道</span><button class="x" data-close-pop="1">关闭</button></div>
    <div class="pop-body">
      ${m.list
        .map(
          (it) => `<button class="pop-item ${it.channel === m.channel && it.id === m.model ? 'active' : ''}" data-pick-model="${esc(it.id)}" data-pick-channel="${esc(it.channel)}">
            <span class="nm">${esc(it.id)}</span>
            <span class="meta">${esc(it.channel)} · ${esc(it.ctx)}</span>
            ${it.channel === m.channel && it.id === m.model ? icon('check', 13, 2.5) : ''}
          </button>`,
        )
        .join('')}
      <div class="pop-sep"></div>
      <button class="pop-row" data-add-channel="1"><span class="grow">添加渠道 / 模型</span><span class="hint">›</span></button>
      <div class="pop-sep"></div>
      <div class="pop-title">思考强度</div>
      <div class="effort-grid">
        ${m.efforts
          .map(
            (e) => `<button data-effort="${e.value}" aria-pressed="${e.value === m.effort}" title="${esc(e.hint)}">${e.label}</button>`,
          )
          .join('')}
      </div>
      <div class="pop-title" style="padding-bottom:8px">模型与强度是每轮读一次，下一轮生效，不改命令行和微信的配置。</div>
    </div>`
}
$('#modelTrigger').addEventListener('click', (e) => {
  e.stopPropagation()
  closeRing()
  const pop = $('#modelPop')
  const open = pop.dataset.open === 'true'
  if (!open) renderModelPop()
  pop.dataset.open = open ? 'false' : 'true'
  pop.style.right = '40px'
  pop.style.bottom = 'calc(100% + 6px)'
})
$('#modelPop').addEventListener('click', (e) => {
  const close = e.target.closest('[data-close-pop]')
  if (close) return closeModelPop()
  const model = e.target.closest('[data-pick-model]')
  if (model) {
    state.models.model = model.dataset.pickModel
    state.models.channel = model.dataset.pickChannel
    syncComposer()
    renderModelPop()
    return
  }
  const eff = e.target.closest('[data-effort]')
  if (eff) {
    state.models.effort = eff.dataset.effort
    syncComposer()
    renderModelPop()
    return
  }
  const add = e.target.closest('[data-add-channel]')
  if (add) {
    closeModelPop()
    openModal({
      title: '添加渠道',
      body: '演示站不写配置。真实项目在这里填「渠道名称 + 接口地址 + 密钥」，保存后会从该接口拉回全部模型，写进 relay 自己的 models.json（不动命令行配置）。',
      confirm: '知道了',
      readonly: true,
      onConfirm: () => {},
    })
  }
})

/* 文件预览 */
const FILES = {
  'web/components/chat/messages.tsx': `'use client'

/** 一条回复里的正文（不带思考和工具），复制按钮复制的就是它。 */
function plainText(parts: Part[]): string {
  return parts
    .map((p) => (p.kind === 'text' ? p.text : ''))
    .filter((t) => t.trim())
    .join('\\n\\n')
    .trim()
}

/** 把片段按「正文」和「思考/工具」切成交替的几串。 */
function intoGroups(parts: Part[]): Part[][] {
  const out: Part[][] = []
  for (const p of parts) {
    const last = out[out.length - 1]
    if (last && (last[0].kind !== 'text') === (p.kind !== 'text')) last.push(p)
    else out.push([p])
  }
  return out
}`,
  'web/hooks/use-turn-stream.ts': `// 一次只允许一个：闸门用同步 ref，state 在同一 tick 内还是旧值
const sendingRef = useRef(false)
const turnStartRef = useRef(0)

const STOP_GUARD_MS = 900

function stop() {
  if (Date.now() - turnStartRef.current < STOP_GUARD_MS) return
  void fetch(\`/api/chats/\${sid}/interrupt\`, { method: 'POST' })
}

// 实时 tok/s：只按本轮收到的片段数估，不乘历史比例
const tps = chunks / Math.max(0.4, genSeconds)`,
  'main.go': `type Bucket struct {
    Hour   int            \`json:"hour"\`
    Reqs   int            \`json:"reqs"\`
    Tokens map[string]int \`json:"tokens"\` // key_id → token 数
}

func aggregate(rows []LogRow) map[int]*Bucket {
    out := map[int]*Bucket{}
    for _, r := range rows {
        b := out[r.Hour]
        if b == nil {
            b = &Bucket{Hour: r.Hour, Tokens: map[string]int{}}
            out[r.Hour] = b
        }
        b.Reqs++
        b.Tokens[r.KeyID] += r.CompletionTokens
    }
    return out
}`,
}

function openPreview(path) {
  let el = $('#preview')
  const body = FILES[path] || `// ${path}\n//\n// 演示站只内置了三个示例文件的片段；真实项目里这个预览栏读的是服务器上的实际文件。`
  el.innerHTML = `<div class="head">
      ${icon('file', 14)}
      <span class="path" title="${esc(path)}">${esc(path)}</span>
      <button data-close-preview="1" aria-label="关闭预览">${icon('x', 15)}</button>
    </div>
    <pre>${highlight(body, path.endsWith('.go') ? 'go' : 'ts')}</pre>`
  el.hidden = false
  $('#sidebar').closest('.shell').dataset.preview = '1'
  el.querySelector('[data-close-preview]').addEventListener('click', () => {
    el.hidden = true
    delete $('#sidebar').closest('.shell').dataset.preview
  })
}

/* 通用弹层 */
function openModal({ title, body, input, confirm = '确定', danger = false, readonly = false, onConfirm }) {
  const modal = $('#modal')
  modal.hidden = false
  modal.innerHTML = `<div class="box">
    <h4>${esc(title)}</h4>
    <p>${esc(body)}</p>
    ${input !== undefined ? `<input value="${esc(input)}" ${readonly ? 'readonly' : ''}>` : ''}
    <div class="actions">
      <button class="btn-ghost" data-cancel="1">取消</button>
      <button class="${danger ? 'btn-danger' : 'btn-primary'}" data-ok="1">${esc(confirm)}</button>
    </div>
  </div>`
  const close = () => {
    modal.hidden = true
    modal.innerHTML = ''
    modal.onclick = null
  }
  // 用 onclick 而不是 addEventListener：弹层元素是复用的，监听器会越堆越多、重复触发确认
  modal.onclick = (e) => {
    if (e.target === modal || e.target.closest('[data-cancel]')) close()
    if (e.target.closest('[data-ok]')) {
      const v = modal.querySelector('input')?.value
      close()
      onConfirm?.(v)
    }
  }
  modal.querySelector('input')?.focus()
}

/* 侧栏搜索 / 新建 */
$('#searchToggle').addEventListener('click', () => {
  state.searchOpen = !state.searchOpen
  $('#searchWrap').hidden = !state.searchOpen
  $('#searchToggle').dataset.on = String(state.searchOpen)
  if (state.searchOpen) $('#searchInput').focus()
  else {
    state.query = ''
    renderSidebar()
  }
})
$('#searchInput').addEventListener('input', (e) => {
  state.query = e.target.value
  renderSidebar()
})
$('#searchInput').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    state.query = ''
    state.searchOpen = false
    $('#searchWrap').hidden = true
    $('#searchToggle').dataset.on = 'false'
    renderSidebar()
  }
})

/* 移动端侧栏 */
function toggleSidebar(open) {
  $('#sidebar').dataset.open = String(open)
  $('#scrim').dataset.open = String(open)
}
$('#hamburger').addEventListener('click', () => toggleSidebar(true))
$('#scrim').addEventListener('click', () => toggleSidebar(false))

/* 滚动渐隐 */
$('#stream').addEventListener('scroll', syncFade)

/* 演示按钮 */
$('#replayBtn').addEventListener('click', replay)

/* 键盘：⌘/Ctrl + Enter 发送（演示站额外方便） */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeChatMenu()
    closeModelPop()
    closeRing()
    $('#lightbox').dataset.open = 'false'
  }
})

/* 活动栏：图标与真实项目一致（聊天 / 任务看板 / 后台进程 / 定时任务 / 产物沙箱 + 设置） */
function renderChrome() {
  const tabs = [
    { id: 'chat', label: '聊天', icon: 'chat' },
    { id: 'kanban', label: '任务看板', icon: 'kanban' },
    { id: 'processes', label: '后台进程', icon: 'cpu' },
    { id: 'cron', label: '定时任务', icon: 'clock' },
    { id: 'artifacts', label: '产物沙箱', icon: 'box' },
  ]
  $('#activity').innerHTML = `
    <div class="seal" title="Hermes Relay"><span>R</span></div>
    <nav aria-label="应用视图切换">
      ${tabs
        .map(
          (t) => `<button class="tab" data-tab="${t.id}" aria-label="${t.label}" ${
            t.id === 'chat' ? 'aria-current="page"' : ''
          }>${icon(t.icon, 19, t.id === 'chat' ? 2.2 : 1.8)}</button>`,
        )
        .join('')}
    </nav>
    <div class="bottom">
      <button class="tab" data-settings="1" aria-label="设置">${icon('settings', 19, 1.8)}</button>
    </div>`

  $('#searchToggle').innerHTML = icon('search', 15, 2.2)
  $('#newChat').innerHTML = `${icon('plus', 15, 2.4)}<span>新建聊天</span>`
  $('#hamburger').innerHTML = icon('list', 20)
  $('#attachBtn').innerHTML = icon('paperclip', 18, 2)
  $('#sendBtn').innerHTML = icon('send', 18, 2)
}

/* 活动栏点击：只有「聊天」有内容，其余给一句说明 */
$('#activity').addEventListener('click', (e) => {
  const settings = e.target.closest('[data-settings]')
  if (settings) {
    openModal({
      title: '设置',
      body: '演示站没有设置面板。真实项目里这里有记忆、档案、人格三份内容和外观选项，写入的是 Hermes 自己的配置与 state.db。',
      confirm: '知道了',
    })
    return
  }
  const btn = e.target.closest('.tab[data-tab]')
  if (!btn) return
  const tab = btn.dataset.tab
  if (tab !== 'chat') {
    openModal({
      title: btn.getAttribute('aria-label'),
      body: '演示站只包含聊天视图。真实项目里还有任务看板、后台进程、定时任务和产物沙箱四个视图，共用同一份会话与运行时。',
      confirm: '知道了',
    })
    return
  }
  $$('.tab[data-tab]').forEach((b) => b.removeAttribute('aria-current'))
  btn.setAttribute('aria-current', 'page')
})

/* 初始化 */
function init() {
  renderChrome()
  renderSidebar()
  bindSidebar()
  renderTopbar()
  renderStream()
  syncComposer()
  if (window.innerWidth <= 900) $('#sidebar').dataset.open = 'false'
}
init()
