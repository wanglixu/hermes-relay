'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { Check, Copy, RotateCcw, ExternalLink } from 'lucide-react'
import type { Msg, Part, ToolPart } from '@/lib/api'
import { cn } from '@/lib/cn'
import { Markdown } from './markdown-view'
import { zoomImage } from './image-zoom'

/** 折叠行末尾的箭头：折叠指右、展开顺畅旋转指下 */
function Chevron({ open, className }: { open?: boolean; className?: string }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden="true"
      className={cn(
        'ml-1 size-[10px] flex-none text-muted transition-transform duration-180',
        open ? 'rotate-90 text-ink-2' : 'rotate-0',
        className,
      )}
    >
      <path
        d="M3.5 2.2 6.5 5 3.5 7.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 行首的小圆点 */
function Dot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('size-[5.5px] flex-none rounded-full', className)}
    />
  )
}

/** 零 JS 介入的 CSS Grid 折叠容器：利用现代浏览器硬件加速 grid-template-rows: 0fr -> 1fr 过渡。
 *  无需 JS rAF 轮询测量高度与改写 scrollTop，在正向文档流中展开时绝对静止，零抖动、零位移。 */
function FoldGrid({ open, children, className }: { open: boolean; children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn('fold-grid', className)}
      data-open={open ? 'true' : 'false'}
      aria-hidden={!open}
    >
      <div className="fold-grid-inner">
        {children}
      </div>
    </div>
  )
}

/** 思考片段：只占一行——开头那段文字 + 省略号，点开向下方展开全文。
 *  思考动辄几千字，直接铺开会把回答整个淹掉。 */
function ThinkBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const flat = text.replace(/\s+/g, ' ').trim()
  // 空白思考不该在界面上留下一个空框
  if (!flat) return null
  const shown = flat.length > 220 ? flat.slice(0, 220) + ' …' : flat

  return (
    <div className="group mb-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer list-none items-baseline gap-2 text-left text-[12.5px] leading-[1.4] transition-colors hover:text-ink-2"
      >
        <Dot className="bg-think" />
        <span className="flex-none font-ui text-[12.5px] tracking-[0.04em] whitespace-nowrap text-muted">
          思考
        </span>
        <span
          className={cn(
            'peek min-w-0 flex-1 truncate text-muted transition-opacity duration-200',
            open && 'opacity-0',
          )}
        >
          {shown}
        </span>
        <Chevron open={open} />
      </button>
      <FoldGrid open={open}>
        <div className="mt-1 ml-[13px] max-h-[40vh] overflow-y-auto rounded-r-card border border-line border-t-0 border-l-2 border-l-accent/40 bg-panel-think/60 px-4 py-3 font-read text-[14.5px] leading-[1.8] whitespace-pre-wrap text-ink-2 shadow-[0_1px_2px_rgba(45,45,42,0.02)]">
          {text}
        </div>
      </FoldGrid>
    </div>
  )
}

/** 工具调用：一行摘要（工具名 + 命令/路径），点开看完整参数和结果。 */
function ToolBlock({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false)
  // 区分只读工具 vs 会修改系统/磁盘的变更工具
  const isMutate = /terminal|bash|write|patch|edit|delete|rm|exec|run/i.test(part.name)

  const body = (
    <>
      {part.args ? (
        <>
          <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[11px] tracking-[0.06em] uppercase text-muted">
            <span className="size-1 rounded-full bg-muted/60" />
            参数
          </div>
          <pre className="mb-2.5 max-h-[40vh] overflow-auto rounded-ctl border border-line/60 bg-page/70 p-2.5 font-mono text-[12px] leading-[1.6] whitespace-pre-wrap text-ink-2 [overflow-wrap:anywhere]">
            {part.args}
          </pre>
        </>
      ) : null}
      {part.result ? (
        <>
          <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[11px] tracking-[0.06em] uppercase text-muted">
            <span className="size-1 rounded-full bg-muted/60" />
            结果
          </div>
          <pre className="mb-2.5 max-h-[40vh] overflow-auto rounded-ctl border border-line/60 bg-page/70 p-2.5 font-mono text-[12px] leading-[1.6] whitespace-pre-wrap text-ink-2 [overflow-wrap:anywhere]">
            {part.result}
          </pre>
        </>
      ) : null}
    </>
  )
  const summary = (
    <>
      <span className={cn('flex-none whitespace-nowrap font-medium', isMutate ? 'text-accent-text' : 'text-ink-2')}>
        {part.name}
      </span>
      {part.brief ? <span className="min-w-0 flex-1 truncate opacity-75">{part.brief}</span> : null}
    </>
  )

  // 没有参数也没有结果：就是一行摘要，不用折叠
  if (!part.args && !part.result) {
    return (
      <div className="tool-row flex flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2 whitespace-nowrap font-mono text-[12.5px] leading-[1.4] text-muted">
          <Dot className={isMutate ? 'bg-accent' : 'bg-muted/70'} />
          {summary}
        </div>
      </div>
    )
  }
  return (
    <div className="group mb-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer list-none items-center gap-2 whitespace-nowrap text-left font-mono text-[12.5px] leading-[1.4] text-muted transition-colors hover:text-ink-2"
      >
        <Dot className={isMutate ? 'bg-accent' : 'bg-muted/70'} />
        {summary}
        <Chevron open={open} />
      </button>
      <FoldGrid open={open}>
        <div className="mt-1.5 mb-2 rounded-card border border-line bg-panel-think/50 p-3 shadow-[0_1px_2px_rgba(45,45,42,0.02)]">
          {body}
        </div>
      </FoldGrid>
    </div>
  )
}

/** 按顺序渲染一条助手消息里的所有片段 */
function Parts({ parts, live }: { parts: Part[]; live: boolean }) {
  const lastTextIdx = parts.reduce((acc, p, i) => (p.kind === 'text' ? i : acc), -1)
  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === 'reason') return <ThinkBlock key={i} text={p.text} />
        if (p.kind === 'tool') return <ToolBlock key={i} part={p} />
        return (
          <div className="prose-relay relative" key={i}>
            <Markdown text={p.text} live={live && i === lastTextIdx} />
          </div>
        )
      })}
    </>
  )
}

/** 263000 → 263k；不到一千就原样显示 */
export function fmtK(n?: number | null): string {
  if (n == null) return '?'
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

/** 秒数说人话：不到一分钟照旧显示秒，超过就是「分 + 秒」（超过一小时是「时 + 分」） */
export function fmtDur(sec?: number | null, digits = 1): string {
  const s = Math.max(0, Number(sec) || 0)
  if (s < 60) return `${s.toFixed(digits)}秒`
  if (s < 3600) {
    const m = Math.floor(s / 60)
    const rest = s - m * 60
    // 过了整分钟就不必给小数点后面那位了：3分17秒 比 3分17.1秒 省地方也好读
    return `${m}分${rest < 10 ? rest.toFixed(digits) : Math.round(rest)}秒`
  }
  const h = Math.floor(s / 3600)
  return `${h}时${Math.round((s - h * 3600) / 60)}分`
}

/** 复制纯文本：能用剪贴板就用；页面没聚焦被拒时退回旧接口。 */
async function copyPlain(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* 掉到下面兜底 */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
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

/** 一条回复自己的速度。tps 为 null 就什么都不渲染（老回合没埋点）。 */
function TokRate({ tps, live }: { tps: number | null; live?: boolean }) {
  if (tps == null) return null
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-mono text-[11px] tabular-nums',
        live ? 'font-medium text-accent-text' : 'text-ink-2/75',
      )}
    >
      <span className={cn('size-1 rounded-full', live ? 'bg-accent animate-ping' : 'bg-current opacity-60')} />
      {`${live ? '≈ ' : ''}${tps < 1 ? '＜1' : Math.round(tps)} tok/s`}
    </span>
  )
}

/** 一条回复末尾那一行小字：复制/重试微操作 + 耗时统计 + 这条回复自己的速度。
 *  每条消息各自一份，数字也只算自己那一轮（不再有一个「全局最近一条」的显示）。 */
function Tail({
  elapsed,
  ttft,
  outTokens,
  genSeconds,
  liveTps,
  text,
  onRegenerate,
}: {
  elapsed?: number | null
  ttft?: number | null
  outTokens?: number | null
  genSeconds?: number | null
  liveTps?: number | null
  text: string
  onRegenerate?: () => void
}) {
  const bits: string[] = []
  if (elapsed) bits.push(fmtDur(elapsed))
  if (ttft) bits.push(`首字 ${fmtDur(ttft, 2)}`)
  const tps = liveTps ?? (outTokens && genSeconds ? outTokens / genSeconds : null)
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-2 font-mono text-[11.5px] leading-none tabular-nums text-muted select-none">
      {text ? (
        <button
          type="button"
          aria-label="复制"
          title={copied ? '已复制' : '复制'}
          onClick={() => {
            void copyPlain(text).then((ok) => {
              if (!ok) return
              setCopied(true)
              if (timer.current) window.clearTimeout(timer.current)
              timer.current = window.setTimeout(() => setCopied(false), 1500)
            })
          }}
          className={cn(
            'inline-flex h-[24px] cursor-pointer items-center gap-1 rounded-md px-1.5 font-ui text-[11.5px] transition-all active:scale-[0.98]',
            copied
              ? 'bg-accent/15 text-accent-text font-medium'
              : 'text-muted hover:bg-raised hover:text-ink',
          )}
        >
          {copied ? <Check size={12} strokeWidth={2.5} /> : <Copy size={12} />}
          <span>{copied ? '已复制' : '复制'}</span>
        </button>
      ) : null}
      {onRegenerate ? (
        <button
          type="button"
          aria-label="重新生成"
          title="重新生成"
          onClick={onRegenerate}
          className="inline-flex h-[24px] cursor-pointer items-center gap-1 rounded-md px-1.5 font-ui text-[11.5px] text-muted transition-all hover:bg-raised hover:text-ink active:scale-[0.98]"
        >
          <RotateCcw size={12} />
          <span>重新生成</span>
        </button>
      ) : null}

      {(text || onRegenerate) && (bits.length > 0 || tps != null) && <span className="text-line-strong">·</span>}

      {bits.length > 0 && (
        <span className="flex items-center gap-1.5 text-ink-2/75">
          {bits.map((b, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-line-strong">·</span>}
              {b}
            </span>
          ))}
        </span>
      )}
      {bits.length > 0 && tps != null && <span className="text-line-strong">·</span>}
      <TokRate tps={tps} live={liveTps != null} />
    </div>
  )
}

/** 回复里每一串「思考行/工具行」：答完之后整体收成一行（方案 A · 只报数量）。
 *  哪一串由调用方切好再传进来（见 `intoGroups`）；正文行不进来。 */
function LeadingChain({ lead }: { lead: Part[] }) {
  const [open, setOpen] = useState(false)
  const thinks = lead.filter((p) => p.kind === 'reason').length
  const tools = lead.filter((p) => p.kind === 'tool').length

  const item = (first: boolean, name: string, n: number, unit: string) => (
    <span key={name}>
      {!first && <span className="text-line-strong"> · </span>}
      {name} <span className="font-mono tabular-nums text-ink-2">{n}</span> {unit}
    </span>
  )

  return (
    <div className="mb-1">
      <button
        type="button"
        className="fold-toggle inline-flex h-[24px] cursor-pointer items-center gap-1.5 rounded-full border border-line-strong/60 bg-panel/80 px-2.5 text-left font-ui text-[12px] text-muted shadow-[0_1px_2px_rgba(45,45,42,0.02)] transition-all hover:border-accent/40 hover:bg-raised hover:text-ink active:scale-[0.99]"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Dot className="bg-accent-text" />
        <span className="inline-flex items-center gap-0.5 translate-y-[0.5px]">
          {thinks > 0 && item(true, '思考', thinks, '段')}
          {tools > 0 && item(thinks === 0, '工具', tools, '次')}
        </span>
        <Chevron open={open} />
      </button>
      <FoldGrid open={open}>
        <div className="pt-1.5 pb-0.5">
          <Parts parts={lead} live={false} />
        </div>
      </FoldGrid>
    </div>
  )
}

/** 把片段按「正文」和「思考/工具」切成交替的几串（一串非正文就是一个折叠单位）。 */
function intoGroups(parts: Part[]): Part[][] {
  const out: Part[][] = []
  for (const p of parts) {
    const last = out[out.length - 1]
    if (last && (last[0].kind !== 'text') === (p.kind !== 'text')) last.push(p)
    else out.push([p])
  }
  return out
}

/** 一条助手消息里的正文（不带思考和工具），复制按钮复制的就是它。 */
function plainText(parts: Part[]): string {
  return parts
    .map((p) => (p.kind === 'text' ? p.text : ''))
    .filter((t) => t.trim())
    .join('\n\n')
    .trim()
}

/** 回复里提到的 /apages/xxx.html：在气泡内给一行可展开的嵌入式预览。
 *  同源（/apages/），所以能直接读 iframe 文档高度做自适应；
 *  内容都是本机 am CLI 生成的静态页，不加 sandbox 限制（加了就读不到高度）。 */
const APAGES_RE = /\/apages\/[A-Za-z0-9._\-\u4e00-\u9fa5]+\.html/g

function apagesLinks(parts: Part[]): string[] {
  const out: string[] = []
  for (const p of parts) {
    if (p.kind !== 'text' || !p.text) continue
    const hits = p.text.match(APAGES_RE) || []
    for (const h of hits) if (!out.includes(h)) out.push(h)
  }
  return out
}

function PageEmbed({ src }: { src: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLIFrameElement | null>(null)
  const [h, setH] = useState(560)

  useEffect(() => {
    if (!open) return
    const f = ref.current
    if (!f) return
    let ro: ResizeObserver | null = null
    const fit = () => {
      try {
        const d = f.contentDocument
        if (!d) return
        // 嵌在气泡里时去掉页面自带的工具栏（主题切换 / 复制源稿那一行）：窄宽度下它会换行压住标题。
        // 页面与本站同源，能直接注入样式；要看完整版点行尾的外链。
        if (d.head && !d.getElementById('relay-embed-style')) {
          const s = d.createElement('style')
          s.id = 'relay-embed-style'
          s.textContent =
            '.am-toolbar,.am-head-meta{display:none!important}.am-head{padding-top:10px!important}.am-page{padding-top:6px!important}'
          d.head.appendChild(s)
        }
        const hh = Math.max(d.documentElement.scrollHeight, d.body ? d.body.scrollHeight : 0)
        if (hh > 80) setH(Math.min(hh + 2, 2600))
      } catch {
        // 跨域拿不到高度时保持默认值
      }
    }
    f.addEventListener('load', fit)
    try {
      const d = f.contentDocument
      if (d && d.documentElement) {
        ro = new ResizeObserver(fit)
        ro.observe(d.documentElement)
      }
    } catch {
      /* 同源才有 ResizeObserver */
    }
    return () => {
      f.removeEventListener('load', fit)
      ro?.disconnect()
    }
  }, [open])

  const name = decodeURIComponent((src.split('/').pop() || '页面').replace(/\.html$/, ''))

  return (
    <div className="mt-2 mb-1">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          data-apages={src}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-[12.5px] leading-[1.4] text-muted transition-colors hover:text-ink-2"
        >
          <Dot className="bg-accent-text" />
          <span className="flex-none font-ui tracking-[0.04em]">一页图解</span>
          <span className="min-w-0 flex-1 truncate opacity-75">{name}</span>
          <Chevron open={open} />
        </button>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          aria-label="新标签打开完整版"
          title="新标签打开完整版"
          className="flex size-6 flex-none items-center justify-center rounded-ctl text-muted transition-colors hover:bg-raised hover:text-ink-2"
        >
          <ExternalLink size={13} />
        </a>
      </div>
      <FoldGrid open={open}>
        <div className="mt-1.5 mb-2 overflow-hidden rounded-card border border-line bg-panel shadow-[0_1px_2px_rgba(45,45,42,0.02)]">
          {open && (
            <iframe
              ref={ref}
              src={src}
              title={name}
              loading="lazy"
              style={{ height: h }}
              className="block w-full border-0"
            />
          )}
        </div>
      </FoldGrid>
    </div>
  )
}

/** 历史里的助手消息 */
export const AssistantMessage = memo(function AssistantMessage({
  msg,
  onRegenerate,
}: {
  msg: Msg
  onRegenerate?: () => void
}) {
  const parts = msg.parts ?? []
  const plain = plainText(parts)
  return (
    <div className="flex min-w-0">
      <div className="prose-relay min-w-0 [overflow-wrap:anywhere]">
        {/* 每一串思考/工具都收成一行（只有一行的那串原样展示），正文按顺序照旧铺开 */}
        {intoGroups(parts).map((g, i) =>
          g[0].kind !== 'text' && g.length >= 2 ? (
            <LeadingChain key={i} lead={g} />
          ) : (
            <Parts key={i} parts={g} live={false} />
          ),
        )}
        {apagesLinks(parts).map((src) => (
          <PageEmbed key={src} src={src} />
        ))}
        {msg.stopped ? (
          <div className="mt-2 flex items-center gap-2 font-mono text-[11px] leading-none tabular-nums text-faint">
            {plain ? (
              <button
                type="button"
                aria-label="复制"
                title="复制"
                onClick={() => void copyPlain(plain)}
                className="inline-flex size-6 flex-none cursor-pointer items-center justify-center rounded-ctl text-muted transition-colors hover:bg-raised hover:text-ink-2"
              >
                <Copy size={14} />
              </button>
            ) : null}
            {onRegenerate ? (
              <button
                type="button"
                aria-label="重新生成"
                title="重新生成"
                onClick={onRegenerate}
                className="inline-flex h-[24px] cursor-pointer items-center gap-1 rounded-md px-1.5 font-ui text-[11.5px] text-muted transition-all hover:bg-raised hover:text-ink active:scale-[0.98]"
              >
                <RotateCcw size={12} />
                <span>重新生成</span>
              </button>
            ) : null}
            <span>已被你停止（这半截没有存进历史）</span>
          </div>
        ) : (
          <Tail
            elapsed={msg.elapsed}
            ttft={msg.ttft}
            outTokens={msg.out_tokens}
            genSeconds={msg.gen_seconds}
            text={plain}
            onRegenerate={onRegenerate}
          />
        )}
      </div>
    </div>
  )
})

/** Hermes 把上传的图片记成 `[screenshot]` 文本混在正文里。
 *  图片本身已经单独贴出来了，正文里这份标记要去掉——否则刷新页面后会看到一行 "[screenshot][screenshot]"。
 *  只在**这条消息确实带图**时才清，免得误伤用户自己打出来的这串字。 */
export function stripAttachmentMarks(text: string): string {
  return text
    .replace(/\[screenshot\]/gi, '')
    .replace(/\[image\]/gi, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 上游 hermes-webui 的做法（static/sessions.js 的 _stripForcedSkillEnvelope）：
 *  `/技能名` 发出去时会在正文前面套一层给模型看的信封（[USER OVERRIDE] + [FORCED SKILL CONTEXT]），
 *  用户原话完整留在末尾。界面上该显示的是用户自己打的那句，所以显示前把信封剥掉。 */
export function stripSkillEnvelope(text: string): string {
  // 1. 匹配 Hermes 官方单技能与多技能/Bundle 信封
  const officialSingle = /\[IMPORTANT: The user has invoked the "([^"]+)" skill[\s\S]*?The user has provided the following instruction alongside the skill invocation:\s*/
  if (officialSingle.test(text)) {
    const m = text.match(/\[IMPORTANT: The user has invoked the "([^"]+)" skill/)
    const name = m ? m[1] : ''
    const instruction = text.replace(officialSingle, '').replace(/\n\n\[Runtime note:[\s\S]*$/, '').trim()
    return instruction ? `/${name} ${instruction}` : `/${name}`
  }
  const officialMulti = /\[IMPORTANT: The user has invoked the [^,]+ skill bundle[\s\S]*?\nUser instruction:\s*([\s\S]*?)\n\n\[Loaded as part of the /
  const multiMatch = text.match(officialMulti)
  if (multiMatch) {
    const instruction = multiMatch[1].trim()
    const nameMatch = text.match(/Skills loaded: ([^\n]+)/)
    const skills = nameMatch ? nameMatch[1].split(',').map(s => `/${s.trim()}`).join(' ') : ''
    return instruction ? `${skills} ${instruction}` : skills
  }

  // 2. 兼容历史上的 relay 自定义信封
  return text
    .replace(/^\[USER OVERRIDE\][^\n]*\n*/, '')
    .replace(/\[FORCED SKILL CONTEXT:[^\]]+\][\s\S]*?\[\/FORCED SKILL CONTEXT\]\s*/g, '')
    // ponytail: 10-08 之前的旧注入格式（正文直接贴进消息、用户原话只在尾巴上），历史里还留着这种记录。
    .replace(/^\[用户点名使用技能 ([A-Za-z0-9_.\-]+)[^\]]*\]\n\n[\s\S]*?\n\n---\n\n/, '/$1\n\n')
    .trim()
}

const LONG_CHARS = 1200

/** 用户消息：纯文本（用户打的代码会被 Markdown 吃掉格式），图片直接贴出来。
 *  从别处拷来的长文默认只露前两行 + 后两行（中间折起来）——判断用纯字数，短消息不折。 */
export const UserMessage = memo(function UserMessage({
  msg,
  open = false,
  onToggle,
}: {
  msg: Msg
  open?: boolean
  onToggle?: () => void
}) {
  const hasImages = !!msg.images?.length
  const text = stripSkillEnvelope(hasImages ? stripAttachmentMarks(msg.text ?? '') : (msg.text ?? ''))
  const long = !!onToggle && text.length > LONG_CHARS
  return (
    <div className="flex min-w-0 justify-end">
      <div className="paper-lift max-w-[78%] rounded-card border border-line bg-raised px-[15px] py-[11px] text-[15px] leading-[1.7] [overflow-wrap:anywhere]">
        {hasImages ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {msg.images!.map((src, i) => (
              <span key={i} className="zoom-wrap">
                <img
                  src={src}
                  alt="上传的图片"
                  loading="lazy"
                  onClick={() => zoomImage(src)}
                  className="max-h-[220px] max-w-[220px] cursor-zoom-in rounded-ctl border border-line"
                />
              </span>
            ))}
          </div>
        ) : null}
        {text ? (
          long && !open ? (
            <>
              {/* 只切前 600 字做"前两行"，尾部只留最后 240 字：视觉一样，但不用把上万字全铺进 DOM */}
              <div className="line-clamp-2 whitespace-pre-wrap [mask-image:linear-gradient(to_bottom,#000_62%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,#000_62%,transparent_100%)]">
                {text.slice(0, 600)}
              </div>
              <button
                className="mt-1.5 flex w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent px-0 py-[3px] text-left font-mono text-[12.5px] tabular-nums text-muted transition-colors hover:text-ink-2"
                onClick={onToggle}
              >
                <span className="flex-none tracking-[0.18em]">⋯</span>
                中间省略 · 共 {text.length.toLocaleString('zh-CN')} 字 · 点开看全文
                <span
                  aria-hidden="true"
                  className="ml-0.5 size-[5px] flex-none rotate-45 self-center border-r border-b border-current"
                />
              </button>
              <div className="mt-1.5 flex h-[calc(2*1.6em)] items-end overflow-hidden [mask-image:linear-gradient(to_top,#000_62%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_top,#000_62%,transparent_100%)]">
                <div className="whitespace-pre-wrap">{text.slice(-240)}</div>
              </div>
            </>
          ) : (
            <div className="prose-relay prose-user">
              <Markdown text={text} live={false} />
            </div>
          )
        ) : null}
      </div>
    </div>
  )
})

/** 正在生成的那条（速度按收到的片段数实时估，跟答完后的位置一致：正文下面同一行） */
export const StreamingMessage = memo(function StreamingMessage({
  parts,
  liveTps,
  live,
}: {
  parts: Part[]
  liveTps?: number | null
  live?: boolean
}) {
  return (
    <div className="flex min-w-0">
      <div className="prose-relay min-w-0 [overflow-wrap:anywhere]">
        <Parts parts={parts} live />
        {parts.length === 0 && (
          <span className="inline-flex h-[22px] items-center gap-[5px]" aria-label="正在思考">
            {[0, 1, 2].map((i) => (
              <i
                key={i}
                className="size-[5px] animate-dot rounded-full bg-accent-text"
                style={{ animationDelay: `${i * 0.16}s` }}
              />
            ))}
          </span>
        )}
        {parts.length > 0 && (
          <span
            aria-hidden="true"
            className="inline-block h-[1.05em] w-0.5 animate-blink bg-accent-text align-[-0.15em]"
          />
        )}
        {liveTps != null && (
          <div className="mt-2 flex items-center gap-2 font-mono text-[11px] leading-none tabular-nums text-faint">
            <TokRate tps={liveTps} live={live} />
          </div>
        )}
      </div>
    </div>
  )
})

/** 出错提示：留在页面上直到下次发送 */
export const ErrorMessage = memo(function ErrorMessage({ text }: { text: string }) {
  return (
    <div className="flex min-w-0">
      <div
        role="alert"
        className="max-w-full rounded-ctl border border-danger/45 bg-danger/8 px-3.5 py-3 font-mono text-[12.5px] whitespace-pre-wrap text-danger-text"
      >
        {text}
      </div>
    </div>
  )
})
