'use client'

import { FileText, Paperclip, SendHorizontal, Square, X } from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
} from 'react'
import { api, type Attachment, type ContextStats, type ModelsPayload, type Skill } from '@/lib/api'
import { cn } from '@/lib/cn'
import { zoomImage } from './image-zoom'
import { ModelPicker } from './model-picker'

/** 待发附件。url 是预览地址；path 由上传结果填回来（刷新后靠它把图找回来）。 */
type Pending = {
  name: string
  mime: string
  url: string
  /** 本地 blob 地址：上传完 url 会换成服务端地址，预览仍旧用这个（点开瞬时出图，不用回后端拿） */
  localUrl?: string
  path?: string
  ready?: Promise<string>
}

const DRAFT_PREFIX = 'hermes-draft:'

/** 还没建会话时先往这个目录传，发出去之后服务端找不到会回退到这里（见 server.py 的 _serve_upload） */
export function uploadDir(sessionId: string | null) {
  return sessionId || 'draft'
}

function serverUrl(sessionId: string | null, path: string) {
  const name = path.split('/').pop() || ''
  return `/api/uploads/${encodeURIComponent(uploadDir(sessionId))}/${encodeURIComponent(name)}`
}

type Draft = { text: string; files: { name: string; mime: string; path: string }[] }

/** 一万以上改用「万」，中文里比 k/M 好读 */
function fmt(n: number): string {
  if (!n) return '0'
  if (n >= 1e8) return (n / 1e8).toFixed(1) + ' 亿'
  if (n >= 1e4) return (n / 1e4).toFixed(n >= 1e6 ? 0 : 1) + ' 万'
  return String(n)
}

function loadDraft(key: string, sessionId: string | null): { text: string; files: Pending[] } {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return { text: '', files: [] }
    const d = JSON.parse(raw) as Draft
    const files: Pending[] = (d.files || [])
      .filter((f) => f && f.path)
      .map((f) => ({
        name: f.name || 'image',
        mime: f.mime || 'image/*',
        path: f.path,
        url: serverUrl(sessionId, f.path),
        ready: Promise.resolve(f.path),
      }))
    return { text: typeof d.text === 'string' ? d.text : '', files }
  } catch {
    return { text: '', files: [] }
  }
}

function saveDraft(key: string, text: string, files: Pending[]) {
  try {
    const done = files.filter((f) => f.path)
    if (!text && done.length === 0) {
      localStorage.removeItem(key)
      return
    }
    const d: Draft = {
      text,
      files: done.map((f) => ({ name: f.name, mime: f.mime, path: f.path as string })),
    }
    localStorage.setItem(key, JSON.stringify(d))
  } catch {
    /* 存不下就算了，不打断输入 */
  }
}

/** 上下文圆环：一圈代表窗口，实心弧是已用。点一下浮层常驻（点别处收起），鼠标悬停也能看 */
function ContextRing({
  stats,
  onCompress,
  compress,
  busy,
}: {
  stats: ContextStats | null
  onCompress: () => void
  compress: { running: boolean; msg: string } | null
  busy: boolean
}) {
  const pct = stats ? Math.max(0, Math.min(100, stats.percent)) : 0
  const r = 9
  const circ = 2 * Math.PI * r
  const [pinned, setPinned] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // 点开之后点页面别处就收起来
  useEffect(() => {
    if (!pinned) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setPinned(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPinned(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [pinned])

  if (!stats) return null
  return (
    <div className="group relative flex size-9 flex-none items-center justify-center" ref={wrapRef}>
      <div
        className="relative grid size-[26px] cursor-default place-items-center rounded-full"
        tabIndex={0}
        role="button"
        aria-expanded={pinned}
        aria-label={`上下文已用 ${pct.toFixed(0)}%，点开看详情`}
        onClick={() => setPinned((p) => !p)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setPinned((p) => !p)
          }
        }}
      >
        <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
          <circle cx="13" cy="13" r={r} fill="none" stroke="var(--color-line)" strokeWidth="2.6" />
          <circle
            cx="13"
            cy="13"
            r={r}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeDasharray={`${(circ * pct) / 100} ${circ}`}
            transform="rotate(-90 13 13)"
          />
        </svg>
        <span className="absolute inset-0 grid place-items-center font-mono text-[9.5px] tabular-nums text-ink-2">
          {pct < 1 ? pct.toFixed(1) : Math.round(pct)}
        </span>
      </div>
      <div
        role="tooltip"
        className={cn(
          'invisible absolute right-[-4px] bottom-[calc(100%+10px)] z-30 w-[304px] rounded-card border border-line-strong bg-raised px-3 py-2.5 font-ui text-[12.5px] leading-[1.65] text-ink-2 opacity-0 shadow-[0_12px_32px_rgb(0_0_0/0.5)] transition-[opacity,transform] translate-y-1',
          'before:absolute before:inset-x-0 before:-bottom-2.5 before:h-2.5 before:content-[""]',
          'group-hover:visible group-hover:translate-y-0 group-hover:opacity-100',
          pinned && 'visible translate-y-0 opacity-100',
        )}
      >
        <div className="mb-1 font-semibold text-ink">上下文窗口</div>
        <div>
          已用 {pct.toFixed(1)}%（还剩 {(100 - pct).toFixed(1)}%）
        </div>
        <div>
          {fmt(stats.used)} / {fmt(stats.window)} tokens
          <span className="text-muted">
            （{stats.used_source === 'anchor'
              ? 'Hermes 记的上次请求用量 + 之后新增消息'
              : `按当前 ${stats.messages} 条消息估算`}）
          </span>
        </div>
        {stats.window > 0 && stats.window_source === 'manual' && (
          <div className="text-muted">窗口是你添加这个模型时填的那个</div>
        )}
        {stats.window > 0 && stats.window_source === 'native' && (
          <div className="text-muted">
            窗口按 Hermes 自己的解析取 —— 跟它实际压缩用的、命令行 /model 显示的是同一个数
          </div>
        )}
        {stats.window === 0 && (
          <div className="text-muted">
            这个模型没记窗口大小，百分比和压缩阈值显示不出来；可以在「添加模型」里手填一个
          </div>
        )}
        {stats.compress_enabled && (
          <div>
            自动压缩阈值 {Math.round(stats.compress_threshold * 100)}%（{fmt(stats.compress_at)}）
          </div>
        )}
        <div>
          缓存命中{' '}
          {stats.cache_hit_rate === null
            ? '无数据（上游没返回缓存字段）'
            : `${(stats.cache_hit_rate * 100).toFixed(0)}%`}
          （读取 {fmt(stats.cache_read)} ／ 写入 {fmt(stats.cache_write)}）
        </div>
        {stats.cache_scope === 'model' && (stats.cache_other_models?.length ?? 0) > 0 ? (
          <div className="text-muted">
            只算 {stats.model}；本会话还用过 {stats.cache_other_models?.join('、')}
            ，换模型后缓存要重新积累
          </div>
        ) : null}
        <div className="text-muted">
          {stats.model} ｜ 本会话累计 {stats.calls} 次调用
        </div>
        <div className="mt-2 flex items-center gap-2 border-t border-line pt-2">
          <button
            className="flex-none cursor-pointer rounded-card border border-line-strong bg-transparent px-[9px] py-[3px] font-ui text-[12.5px] text-ink-2 transition-colors hover:border-accent-text hover:text-accent-text disabled:cursor-default disabled:opacity-45"
            onClick={onCompress}
            disabled={busy || !!compress?.running}
            title={
              busy
                ? '这一轮还在跑，压缩会和它抢同一份历史，等它结束再压'
                : '等价于 CLI 里的 /compress：把历史换成「摘要 + 最近的尾巴」'
            }
          >
            {compress?.running ? '压缩中…' : busy ? '等这一轮跑完' : '压缩上下文'}
          </button>
          {compress?.msg && (
            <span className="text-[12.5px] leading-[1.4] whitespace-normal text-muted">
              {compress.msg}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export function Composer({
  sessionId,
  busy,
  clarifyPending,
  context,
  skills,
  models,
  onModelsChanged,
  onSend,
  onStop,
  onSteer,
  onCompress,
  compress,
}: {
  sessionId: string | null
  busy: boolean
  clarifyPending?: boolean
  context: ContextStats | null
  skills: Skill[]
  /** 页面上可选的模型 / 思考强度（未加载完是 null，那时右下角先不显示） */
  models: ModelsPayload | null
  onModelsChanged: () => void
  onSend: (text: string, attachments: Attachment[]) => void
  onStop: () => void
  onSteer: (text: string) => void
  onCompress: () => void
  compress: { running: boolean; msg: string } | null
}) {
  const storageKey = DRAFT_PREFIX + (sessionId || 'new')
  // 组件按会话重挂载（外面给了 key），所以初始化时读一次草稿就够了
  const initial = useRef(loadDraft(storageKey, sessionId)).current
  const [text, setText] = useState(initial.text)
  const [files, setFiles] = useState<Pending[]>(initial.files)
  const [dragging, setDragging] = useState(false) // 有文件被拖到输入区上方
  // 「插话」只有在真的能插的时候才亮起来（空输入框时它是灰的，但仍占着位置不跳）
  const canSteer = !clarifyPending && !!text.trim()
  const [menu, setMenu] = useState<{ start: number; query: string; index: number } | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // 还没发出去的输入（文字 + 图）随时存一份，刷新页面能接着写
  useEffect(() => {
    saveDraft(storageKey, text, files)
  }, [storageKey, text, files])

  const [multiline, setMultiline] = useState(false)

  // 输入框跟着内容长，最高 40vh
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const h = Math.min(ta.scrollHeight, window.innerHeight * 0.4)
    ta.style.height = h + 'px'
    setMultiline(h > 42 || text.includes('\n'))
  }, [text])

  /** 光标前刚打的那个 /词 —— 就是技能菜单的触发条件 */
  function detectMenu(value: string, caret: number) {
    const before = value.slice(0, caret)
    const m = /(^|[\s\u3000])\/([A-Za-z0-9_.-]*)$/.exec(before)
    if (!m) return null
    return { start: caret - m[2].length - 1, query: m[2] }
  }

  const matches = useMemo(() => {
    if (!menu) return []
    const q = menu.query.trim().toLowerCase()
    // 分档：名字以关键词开头 > 名字里包含 > 描述里包含；同一档内按最近使用时间排
    const rank = (s: Skill) => {
      if (!q) return 0
      const n = s.name.toLowerCase()
      if (n.startsWith(q)) return 0
      if (n.includes(q)) return 1
      if (s.description.toLowerCase().includes(q)) return 2
      return 3
    }
    const hit = skills.filter((s) => rank(s) < 3)
    hit.sort(
      (a, b) => rank(a) - rank(b) || (b.last_used || 0) - (a.last_used || 0) || a.name.localeCompare(b.name),
    )
    return hit.slice(0, 8)
  }, [menu, skills])

  function syncMenu(value: string, caret: number | null) {
    const found = caret === null ? null : detectMenu(value, caret)
    if (!found) {
      setMenu(null)
      return
    }
    setMenu({ ...found, index: 0 })
  }

  function applySkill(name: string) {
    const ta = taRef.current
    const caret = ta ? ta.selectionStart : text.length
    const start = menu ? menu.start : caret
    const next = text.slice(0, start) + '/' + name + ' ' + text.slice(caret)
    setText(next)
    setMenu(null)
    requestAnimationFrame(() => {
      const pos = start + name.length + 2
      ta?.focus()
      ta?.setSelectionRange(pos, pos)
    })
  }

  function addFiles(list: File[] | FileList | null) {
    if (!list) return
    const next: Pending[] = []
    for (const f of Array.from(list)) {
      // 图片和非图片都收：图片走多模态直接给模型看；非图片只把服务端路径写进正文，让 agent 自己去读
      const local = URL.createObjectURL(f)
      const item: Pending = { name: f.name, mime: f.type, url: local, localUrl: local }
      // 选/贴进来就立刻上传：这样刷新页面之后还能靠服务端的文件把图找回来
      item.ready = api
        .upload(uploadDir(sessionId), f)
        .then((a) => {
          item.path = a.path
          item.name = a.name
          item.mime = a.mime
          item.url = serverUrl(sessionId, a.path)
          setFiles((prev) => prev.map((x) => (x === item ? { ...x } : x)))
          return a.path
        })
        .catch(() => '')
      next.push(item)
    }
    if (next.length) setFiles((prev) => [...prev, ...next])
  }

  function pick(list: FileList | null) {
    addFiles(list)
    if (fileRef.current) fileRef.current.value = ''
  }

  /** 直接 Ctrl/Cmd+V 贴图：从剪贴板里捞图片文件，其余内容照常进输入框 */
  function onPaste(e: ReactClipboardEvent<HTMLDivElement>) {
    const items = e.clipboardData?.items
    if (!items) return
    const imgs: File[] = []
    for (const it of Array.from(items)) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile()
        if (f) imgs.push(f)
      }
    }
    if (imgs.length) {
      e.preventDefault()
      addFiles(imgs)
    }
  }

  const sendLock = useRef(false)

  async function send() {
    // 同步闸门：点发送键和按回车都走这里，同一瞬间来两次时 busy/text 都还是旧值
    if (sendLock.current) return
    sendLock.current = true
    try {
      await sendOnce()
    } finally {
      sendLock.current = false
    }
  }

  async function sendOnce() {
    const t = text.trim()
    // 正在生成时，发送键变成「插话」：不打断这一轮，只把这段文字递进去。
    // 只支持纯文字——图片没法骑在插话上（Hermes CLI 里也是这么降级的）。
    if (busy) {
      if (!t) return
      onSteer(t)
      setText('')
      setFiles([])
      setMenu(null)
      try {
        localStorage.removeItem(storageKey)
      } catch {
        /* 无所谓 */
      }
      return
    }
    if (!t && files.length === 0) return
    const attachments: Attachment[] = []
    const extraPaths: string[] = [] // 非图片：模型看不到内容，改成把服务端路径递给它
    for (const f of files) {
      const path = f.path || (f.ready ? await f.ready : '')
      if (!path) continue
      attachments.push({ path, name: f.name, mime: f.mime })
      if (!f.mime.startsWith('image/')) extraPaths.push(path)
    }
    const body = extraPaths.length
      ? `${t}\n\n（上传的文件，请自己读取：${extraPaths.join('、')}）`.trim()
      : t
    onSend(body, attachments)
    setText('')
    setFiles([])
    setMenu(null)
    try {
      localStorage.removeItem(storageKey)
    } catch {
      /* 无所谓 */
    }
  }

  return (
    <div
      className="relative mx-auto w-full max-w-read flex-none px-10 pt-0 pb-2 max-[900px]:px-5"
      onPaste={onPaste}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types || []).includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        void addFiles(e.dataTransfer.files)
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-x-10 inset-y-3 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent-text bg-panel/85 text-[13px] font-medium text-accent-text">
          松手就把文件加进来
        </div>
      )}
      {files.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {files.map((f, i) =>
            f.mime.startsWith('image/') ? (
              <div className="relative size-[62px]" key={i}>
                {/* 还没发出去也能点开看大图，跟正文里的图共用同一个灯箱 */}
                <button
                  type="button"
                  onClick={() => zoomImage(f.localUrl ?? f.url)}
                  aria-label={`预览 ${f.name}`}
                  title="点开看大图"
                  className="block size-full cursor-zoom-in border-0 bg-transparent p-0"
                >
                  <img
                    src={f.localUrl ?? f.url}
                    alt={f.name}
                    className="size-full rounded-ctl border border-line object-cover"
                  />
                </button>
                <button
                  className="absolute -top-2 -right-2 size-5 justify-center rounded-full border border-line bg-panel p-0 text-muted hover:text-ink"
                  aria-label={`移除 ${f.name}`}
                  onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}
                >
                  <X size={12} className="mx-auto" />
                </button>
              </div>
            ) : (
              // 非图片没有可看的缩略图，给一个文件名小条
              <div
                className="relative flex h-[62px] max-w-[240px] items-center gap-2 rounded-ctl border border-line bg-raised py-2 pr-7 pl-3"
                key={i}
              >
                <FileText size={15} className="flex-none text-muted" />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">{f.name}</span>
                <button
                  className="absolute -top-2 -right-2 size-5 rounded-full border border-line bg-panel p-0 text-muted hover:text-ink"
                  aria-label={`移除 ${f.name}`}
                  onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}
                >
                  <X size={12} className="mx-auto" />
                </button>
              </div>
            ),
          )}
        </div>
      )}
      {menu && matches.length > 0 && (
        <div
          role="listbox"
          aria-label="技能"
          className="absolute inset-x-0 bottom-[calc(100%-8px)] z-20 max-h-[46vh] overflow-y-auto rounded-card border border-line-strong bg-raised p-1 shadow-[0_12px_32px_rgb(0_0_0/0.5)]"
        >
          <div className="px-2 pt-[5px] pb-1.5 font-ui text-[12.5px] text-muted">
            技能{menu.query ? `：匹配 “${menu.query}”` : ''}　↑↓ 选择 · Enter 确定 · Esc 取消
          </div>
          {matches.map((s, i) => (
            <button
              key={s.name}
              role="option"
              aria-selected={i === menu.index}
              className={cn(
                'grid w-full cursor-pointer grid-cols-[auto_auto_minmax(0,1fr)] items-baseline gap-2 rounded-ctl border-0 bg-transparent px-2 py-1.5 text-left font-ui text-[12.5px] text-ink-2',
                i === menu.index && 'bg-accent/16 text-ink',
              )}
              onMouseEnter={() => setMenu((m) => (m ? { ...m, index: i } : m))}
              onMouseDown={(e) => {
                e.preventDefault()
                applySkill(s.name)
              }}
            >
              <span className="font-mono whitespace-nowrap text-accent-text">/{s.name}</span>
              {s.category && <span className="text-[12.5px] whitespace-nowrap text-muted">{s.category}</span>}
              <span className="truncate text-muted">{s.description}</span>
            </button>
          ))}
        </div>
      )}
      <div className={cn('composer-box', multiline && 'composer-box-multiline')}>
        <button
          className="icon-btn cursor-pointer rounded-full bg-raised text-ink-2 transition-colors hover:bg-line hover:text-ink"
          aria-label="添加图片"
          onClick={() => fileRef.current?.click()}
        >
          <Paperclip size={18} strokeWidth={2} />
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => pick(e.target.files)}
        />
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          disabled={clarifyPending}
          placeholder={
            clarifyPending ? '先回答上面的问题（回答完就能接着打字）' : '说点什么…'
          }
          className="max-h-[40dvh] flex-1 resize-none border-0 bg-transparent px-0.5 pt-[7px] pb-[3px] font-read text-[16px] leading-[1.6] text-ink outline-none [&::placeholder]:font-ui [&::placeholder]:text-muted"
          onChange={(e) => {
            setText(e.target.value)
            syncMenu(e.target.value, e.target.selectionStart)
          }}
          onKeyUp={(e) => {
            // 方向键移动光标后也要重算菜单位置
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
              syncMenu(text, e.currentTarget.selectionStart)
            }
          }}
          onBlur={() => setMenu(null)}
          onKeyDown={(e) => {
            if (menu && matches.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setMenu({ ...menu, index: (menu.index + 1) % matches.length })
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setMenu({ ...menu, index: (menu.index - 1 + matches.length) % matches.length })
                return
              }
              if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing) {
                e.preventDefault()
                applySkill(matches[menu.index].name)
                return
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setMenu(null)
                return
              }
            }
            // e.repeat：按住回车不放时系统会连发 keydown，别当多次发送
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !e.repeat) {
              e.preventDefault()
              send()
            }
          }}
        />
        <ContextRing stats={context} onCompress={onCompress} compress={compress} busy={busy} />
        {busy ? (
          <>
            <button
              className={cn(
                'inline-flex h-9 flex-none items-center gap-1.5 rounded-full border px-3.5 text-[12.5px] transition-colors',
                canSteer
                  ? 'cursor-pointer border-accent-text text-accent-text hover:bg-accent-text/10'
                  : 'cursor-default border-line text-ink-2/55',
              )}
              onClick={send}
              disabled={!canSteer}
              title={
                canSteer
                  ? '不打断这一轮，把这句话递到模型下一步看得到的地方'
                  : '先在上面写点什么，再插话'
              }
            >
              <SendHorizontal size={14} strokeWidth={2.5} />
              插话
            </button>
            <button
              className="inline-flex h-9 flex-none cursor-pointer items-center gap-1.5 rounded-full border border-danger/35 bg-transparent px-3.5 text-[12.5px] text-danger transition-colors hover:border-danger/60 hover:bg-danger/10"
              onClick={onStop}
              aria-label="停止"
            >
              <Square size={12} fill="currentColor" />
              停止
            </button>
          </>
        ) : (
          <button
            className="icon-btn cursor-pointer rounded-full border-0 bg-accent text-on-accent hover:bg-[color-mix(in_srgb,var(--color-accent)_86%,#ffffff)] disabled:cursor-not-allowed disabled:opacity-45"
            aria-label="发送"
            onClick={send}
            disabled={!text.trim() && files.length === 0}
          >
            <SendHorizontal size={18} strokeWidth={2} />
          </button>
        )}
      </div>
      {/* 输入框下面那一行：左边是缓存命中 / 压缩提示，右边是模型 / 思考强度。
          2026-10-13：缓存命中与压缩提示原来在输入框**上方**的状态条里，按用户要求移到这一行，
          上方那条状态条整个去掉了。 */}
      <div className="mt-2 flex items-center justify-between gap-3 px-2">
        <span className="flex min-w-0 items-center gap-2.5 font-mono text-[12.5px] leading-[1.35] tabular-nums text-muted">
          {context ? (
            <span
              title={
                (context.cache_hit_rate === null
                  ? `缓存：上游没返回缓存字段，命中率算不出来；读 ${context.cache_read.toLocaleString()} ／ 写 ${context.cache_write.toLocaleString()} tokens`
                  : `缓存命中率：读 ${context.cache_read.toLocaleString()} ／ 写 ${context.cache_write.toLocaleString()} tokens`) +
                `；本会话累计 ${context.calls} 次调用` +
                (context.cache_scope === 'model' && context.cache_other_models?.length
                  ? `\n只算 ${context.model}（本会话还用过 ${context.cache_other_models.join('、')}）`
                  : '')
              }
            >
              缓存命中 {context.cache_hit_rate === null ? '无数据' : `${Math.round(context.cache_hit_rate * 100)}%`}
            </span>
          ) : null}
          {compress?.msg ? (
            <span className={cn('truncate', compress.running ? 'text-accent-text' : undefined)}>
              {compress.msg}
            </span>
          ) : null}
        </span>
        <ModelPicker payload={models} onChanged={onModelsChanged} />
      </div>
    </div>
  )
}
