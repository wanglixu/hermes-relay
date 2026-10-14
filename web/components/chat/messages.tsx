'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { Check, Copy, RotateCcw } from 'lucide-react'
import type { Msg, Part, ToolPart } from '@/lib/api'
import { cn } from '@/lib/cn'
import { Markdown } from './markdown-view'
import { zoomImage } from './image-zoom'

/** 折叠行末尾的箭头：折叠指右、展开指下 */
function Chevron({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'ml-1.5 size-[5px] flex-none self-center rotate-[-45deg] border-r border-b border-muted transition-transform',
        className,
      )}
    />
  )
}

/** 行首的小圆点 */
function Dot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('size-[5px] flex-none -translate-y-[2px] rounded-full', className)}
    />
  )
}

const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3)
/** 折叠动画的时长随距离走，让三种折叠块「看起来速度一致」。
 *  之前固定 220ms：内容少的块（思考详情）一闪而过；内容多的块（「思考 N 段」展开一大串）
 *  同样在 220ms 里冲完，每帧位移过大、看着像一跳一跳。
 *  现在按下距离给时长，每帧的位移量大致恒定。要整体调快就调大 FOLD_PX_PER_MS。 */
// 2026-10-13：这两个值一度被设成 0（排查抖动时用「时长归零」做二分判断），排查完忘了恢复 ——
// 结果三种折叠块全成了「一帧到位」的硬切（实测展开时高度 0 → 384 只用掉一帧，而且那帧 62.5ms）。
// 现按用户口径恢复成 120–150ms：小块固定 120；长内容按 2.6px/ms 算、上限 150（384px ≈ 148ms）。
const FOLD_MS_MIN = 120
const FOLD_MS_MAX = 150
const FOLD_PX_PER_MS = 2.6
const foldMs = (dist: number) => Math.min(FOLD_MS_MAX, Math.max(FOLD_MS_MIN, dist / FOLD_PX_PER_MS))
const foldTokens = new WeakMap<HTMLElement, number>()

/** 折叠动画：内容高度和滚动补偿在**同一帧**里一起写。
 *  为什么不用 CSS 过渡 + 事后修正：CSS 过渡的当前值在 rAF 里读不到（总是慢一帧），
 *  事后修正会逐帧过冲、欠冲，整个页面的内容跟着上下抖（实测被点元素的 top 会来回摆）。
 *  这里按缓动曲线自己算高度，补偿量正好等于高度增量，两者天然同步。
 *  host = 被点的那个元素（用来把它的位置钉住），body = 内容容器。 */
function animateFold(host: HTMLElement, body: HTMLElement, open: boolean) {
  const box = host.closest('.msg-stream') as HTMLElement | null
  const st0 = box ? box.scrollTop : 0
  const from = body.getBoundingClientRect().height
  const to = open ? body.scrollHeight : 0
  const span = to - from
  const dur = foldMs(Math.abs(span))

  const token = (foldTokens.get(host) ?? 0) + 1
  foldTokens.set(host, token)
  let t0 = -1

  const step = (t: number) => {
    if (foldTokens.get(host) !== token) return
    if (t0 < 0) t0 = t
    const p = dur > 0 ? Math.min(1, Math.max(0, (t - t0) / dur)) : 1
    if (p < 1) {
      // 高度取整到整数像素：内容高度和滚动位置的舍入口径不同，
      // 每帧残留的零点几像素会累积成可见的抖动（实测 0.9px 锯齿）。
      const h = Math.round(from + span * easeOutCubic(p))
      body.style.height = `${h}px`
      // 消息流是反向排列的：内容长高多少，这个块就往上跑多少，等量补回去
      if (box) box.scrollTop = st0 - (h - from)
      requestAnimationFrame(step)
      return
    }
    body.style.height = open ? 'auto' : '0px'
    if (box) box.scrollTop = st0 - (body.getBoundingClientRect().height - from)
  }
  requestAnimationFrame(step)
}

/** 思考片段：只占一行——开头那段文字 + 省略号，点开才展开全文。
 *  思考动辄几千字，直接铺开会把回答整个淹掉。 */
function ThinkBlock({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDetailsElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (ref.current) ref.current.textContent = text
  }, [text])
  const flat = text.replace(/\s+/g, ' ').trim()
  // 空白思考（库里就有上千条 reasoning 字段是空的）不该在界面上留下一个空框
  if (!flat) return null
  const shown = flat.length > 220 ? flat.slice(0, 220) + ' …' : flat
  const toggle = () => {
    const next = !open
    setOpen(next)
    if (hostRef.current && bodyRef.current) animateFold(hostRef.current, bodyRef.current, next)
  }
  return (
    <details ref={hostRef} open={open} className="group mb-0.5">
      <summary
        className="flex cursor-pointer list-none items-baseline gap-2 text-[12.5px] leading-[1.4] transition-colors hover:text-ink-2 [&::-webkit-details-marker]:hidden"
        onClick={(e) => {
          e.preventDefault()
          e.currentTarget.focus({ preventScroll: true })
          toggle()
        }}
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
        <Chevron className={open ? 'rotate-45' : undefined} />
      </summary>
      <div ref={bodyRef} className="fold-body">
        <div
          ref={ref}
          className="mt-1 ml-[13px] max-h-[40vh] overflow-y-auto rounded-r-card border border-line border-t-0 border-l-think-line bg-panel px-4 py-3 font-read text-[15px] leading-[1.8] whitespace-pre-wrap text-ink-2"
        />
      </div>
    </details>
  )
}

/** 工具调用：一行摘要（工具名 + 命令/路径），点开看完整参数和结果。 */
function ToolBlock({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false)
  const hostRef = useRef<HTMLDetailsElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const toggle = () => {
    const next = !open
    setOpen(next)
    if (hostRef.current && bodyRef.current) animateFold(hostRef.current, bodyRef.current, next)
  }
  const body = (
    <>
      {part.args ? (
        <>
          <div className="mb-1 font-ui text-[12.5px] tracking-[0.08em] uppercase text-muted">
            参数
          </div>
          <pre className="mb-2.5 max-h-[40vh] overflow-auto border-0 bg-transparent p-0 font-mono text-[12.5px] leading-[1.6] whitespace-pre-wrap text-ink-2 [overflow-wrap:anywhere]">
            {part.args}
          </pre>
        </>
      ) : null}
      {part.result ? (
        <>
          <div className="mb-1 font-ui text-[12.5px] tracking-[0.08em] uppercase text-muted">
            结果
          </div>
          <pre className="mb-2.5 max-h-[40vh] overflow-auto border-0 bg-transparent p-0 font-mono text-[12.5px] leading-[1.6] whitespace-pre-wrap text-ink-2 [overflow-wrap:anywhere]">
            {part.result}
          </pre>
        </>
      ) : null}
    </>
  )
  const summary = (
    <>
      <span className="flex-none whitespace-nowrap text-ink-2">{part.name}</span>
      {part.brief ? <span className="min-w-0 flex-1 truncate opacity-80">{part.brief}</span> : null}
    </>
  )

  // 没有参数也没有结果：就是一行摘要，不用折叠
  if (!part.args && !part.result) {
    return (
      <div className="flex flex-col gap-0.5 pl-6">
        <div className="flex min-w-0 items-baseline gap-2 whitespace-nowrap font-mono text-[12.5px] leading-[1.4] text-muted">
          <Dot className="bg-accent-text" />
          {summary}
        </div>
      </div>
    )
  }
  return (
    <details ref={hostRef} open={open} className="group mb-0.5 pl-6">
      <summary
        className="flex cursor-pointer list-none items-baseline gap-2 whitespace-nowrap font-mono text-[12.5px] leading-[1.4] text-muted transition-colors hover:text-ink-2 [&::-webkit-details-marker]:hidden"
        onClick={(e) => {
          e.preventDefault()
          e.currentTarget.focus({ preventScroll: true })
          toggle()
        }}
      >
        <Dot className="bg-accent-text" />
        {summary}
        <Chevron className={open ? 'rotate-45' : undefined} />
      </summary>
      <div ref={bodyRef} className="fold-body">
        <div className="mt-1 mb-2 ml-[13px] rounded-card border border-line-strong bg-panel px-3 pt-2.5 pb-0">
          {body}
        </div>
      </div>
    </details>
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

/** 生成速度这一格的说明：鼠标停上去才展开，措辞跟后端口径对齐。 */
const TOK_TITLE =
  '生成速度（tok/s）= 这条回复真实输出的 token ÷ 真正在收字的秒数' +
  '（首字之前的等待、跑工具的时间都不算）。生成中的 ≈ 是在数收到的流式片段（1 个片段约 1 个 token，' +
  '比定稿值略低一点），答完换成这一轮的真实值；' +
  '改动之前跑的旧回合没记生成时长，就不显示这个数。'

/** 一条回复自己的速度。tps 为 null 就什么都不渲染（老回合没埋点）。 */
function TokRate({ tps, live }: { tps: number | null; live?: boolean }) {
  if (tps == null) return null
  return (
    <span
      className={live ? 'text-accent-text' : undefined}
      title={TOK_TITLE}
    >
      {`${live ? '≈ ' : ''}${tps < 1 ? '＜1' : Math.round(tps)} tok/s`}
    </span>
  )
}

/** 一条回复末尾那一行小字：耗时统计 + 这条回复自己的速度。
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
  if (ttft) bits.push(`首字${fmtDur(ttft, 2)}`)
  const tps = liveTps ?? (outTokens && genSeconds ? outTokens / genSeconds : null)
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])

  return (
    <div className="mt-2 flex items-center gap-2 font-mono text-[11px] leading-none tabular-nums text-faint">
      {text ? (
        <button
          type="button"
          aria-label="复制这条回复"
          title={copied ? '已复制' : '复制这条回复'}
          onClick={() => {
            void copyPlain(text).then((ok) => {
              if (!ok) return
              setCopied(true)
              if (timer.current) window.clearTimeout(timer.current)
              timer.current = window.setTimeout(() => setCopied(false), 1500)
            })
          }}
          className="inline-flex size-6 flex-none cursor-pointer items-center justify-center rounded-ctl text-muted transition-colors hover:bg-raised hover:text-ink-2"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      ) : null}
      {onRegenerate ? (
        <button
          type="button"
          aria-label="重新生成这条回复"
          title="重新生成（把上一条提问原样再发一次）"
          onClick={onRegenerate}
          className="inline-flex cursor-pointer items-center rounded-ctl px-1.5 py-[3px] transition-colors hover:bg-raised hover:text-ink-2"
        >
          <RotateCcw size={12} />
        </button>
      ) : null}
      {bits.length > 0 && <span>{bits.join(' · ')}</span>}
      <TokRate tps={tps} live={liveTps != null} />
    </div>
  )
}

/** 回复里每一串「思考行/工具行」：答完之后整体收成一行（方案 A · 只报数量）。
 *  哪一串由调用方切好再传进来（见 `intoGroups`）；正文行不进来。 */
function LeadingChain({ lead }: { lead: Part[] }) {
  const [open, setOpen] = useState(false)
  // 展开过一次就保持挂载（收起时只是 height: 0），不再条件卸载：
  // 条件卸载会让浏览器每次开合都重新创建整棵子树并重新布局（实测一次开合约 95–100ms 的主线程长任务）。
  const [mounted, setMounted] = useState(false)
  const hostRef = useRef<HTMLButtonElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const toggle = () => {
    const next = !open
    setOpen(next)
    if (!mounted && next) {
      // 首次展开：内容还没挂到 DOM 上，量不到高度 —— 先把内容挂上，等 React 更新完（下一帧）再动。
      setMounted(true)
      requestAnimationFrame(() => {
        if (hostRef.current && bodyRef.current) animateFold(hostRef.current, bodyRef.current, true)
      })
      return
    }
    // 之后（含首次之后的收起）与思考块 / 工具块完全一致：同一帧里同步起动画。
    // 之前这里无条件晚一帧，导致这一行和另外两种折叠块的手感／起播时机不一样。
    if (hostRef.current && bodyRef.current) animateFold(hostRef.current, bodyRef.current, next)
  }
  const thinks = lead.filter((p) => p.kind === 'reason').length
  const tools = lead.filter((p) => p.kind === 'tool').length

  const item = (first: boolean, name: string, n: number, unit: string) => (
    <span key={name}>
      {!first && <span className="text-line-strong"> · </span>}
      {name} <span className="font-mono tabular-nums text-ink-2">{n}</span> {unit}
    </span>
  )

  return (
    <>
      <button
        ref={hostRef}
        type="button"
        className="fold-toggle mb-0.5 flex w-full cursor-pointer items-baseline gap-2 border-0 bg-transparent p-0 text-left font-ui text-[12.5px] leading-[1.4] text-muted transition-colors hover:text-ink-2"
        aria-expanded={open}
        onClick={(e) => {
          e.currentTarget.focus({ preventScroll: true })
          toggle()
        }}
      >
        <Dot className="bg-think" />
        {thinks > 0 && item(true, '思考', thinks, '段')}
        {tools > 0 && item(thinks === 0, '工具', tools, '次')}
        <Chevron className={open ? 'rotate-45' : undefined} />
      </button>
      {mounted && (
        // 收起态交给 .fold-body（height: 0 + overflow: hidden）：内容留在渲染树里，布局缓存不丢。
        <div ref={bodyRef} className="fold-body">
          <Parts parts={lead} live={false} />
        </div>
      )}
    </>
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
        {msg.stopped ? (
          <div className="mt-2 flex items-center gap-2 font-mono text-[11px] leading-none tabular-nums text-faint">
            {plain ? (
              <button
                type="button"
                aria-label="复制这条回复"
                title="复制这条回复"
                onClick={() => void copyPlain(plain)}
                className="inline-flex size-6 flex-none cursor-pointer items-center justify-center rounded-ctl text-muted transition-colors hover:bg-raised hover:text-ink-2"
              >
                <Copy size={14} />
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
            <div className="whitespace-pre-wrap">{text}</div>
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
