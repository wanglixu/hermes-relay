'use client'

import { useEffect, useRef, useState } from 'react'
import { notify } from '@/components/ui/toast'
import {
  api,
  runRegenerate,
  runStream,
  runTurn,
  type Attachment,
  type Clarify,
  type Compaction,
  type ContextStats,
  type Msg,
  type Part,
  type TurnEvent,
} from '@/lib/api'

export type Approval = {
  request_id: string
  command: string
  description: string
  /** Hermes 给这一步的时限（approvals.timeout，默认 300 秒） */
  timeout_sec?: number
  /** 绝对到期时刻（epoch 秒）；有它倒计时才算得准 */
  deadline?: number
}
export type Stream = { items: Part[]; approval: Approval | null; clarify: Clarify | null }

const EMPTY_STREAM: Stream = { items: [], approval: null, clarify: null }

// 发出这一轮后的误触保护窗口（毫秒）。
// 发送键与「停止」在同一个位置：点了发送，按钮区下一帧就换成「插话 / 停止」，
// 手指连点的第二下会直接落在那颗「停止」上，把刚发出的一轮打断（用户 2026-10-20 反馈）。
// 这段时间内的停止请求一律忽略 —— 真正想停的人会在这一轮开始几百毫秒之后才点。
const STOP_GUARD_MS = 900

// ── 标签页提醒 ──
// 有卡片在等你、或一轮刚跑完，而你正看着别的标签页时：标题和站点图标一起闪，切回来就停。
// 只改标题太容易被忽略（标签文字本来就小），所以再叠一个亮红圆图标；300ms 一次（用户实测 450ms 还不够明显）。
const ALERT_ICON = (() => {
  if (typeof document === 'undefined') return ''
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  if (!g) return ''
  g.fillStyle = '#e5341f'
  g.beginPath()
  g.arc(32, 32, 30, 0, Math.PI * 2)
  g.fill()
  return c.toDataURL('image/png')
})()

let blinkTimer: number | null = null
let blinkText = '回复完成'

function setFavicon(href: string) {
  let link = document.querySelector<HTMLLinkElement>("link[rel='icon']")
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.href = href
}

function stopBlink() {
  if (blinkTimer === null) return
  window.clearInterval(blinkTimer)
  blinkTimer = null
  document.title = 'Hermes Relay'
  setFavicon('/favicon.svg')
}

/** 把标签页闪起来；msg 是闪动时标题里那句短话 */
function startBlink(msg = '回复完成') {
  blinkText = msg
  if (blinkTimer !== null) return
  let on = false
  const tick = () => {
    on = !on
    document.title = on ? `● ${blinkText}` : 'Hermes Relay'
    setFavicon(on ? ALERT_ICON : '/favicon.svg')
  }
  tick()
  blinkTimer = window.setInterval(tick, 300)
  window.addEventListener('focus', stopBlink, { once: true })
}

/** 一段窗口 = 一次 API 调用里「从第一个字到最后一个字」；跨段之间是首字等待或跑工具，不算 */
type GenMeter = {
  first: number | null // 当前这段窗口的第一个字
  last: number | null // 当前这段窗口的最后一个字
  closed: number // 已经收掉的各段时长之和（秒）
  tokens: number // 数到的 token（按片段数，见 onEvent 里的说明）
}

/** 到现在为止「真正在收字」的秒数：已收掉的各段 + 正在进行这一段已经走了多久 */
function genElapsed(g: GenMeter): number {
  const cur = g.first !== null && g.last !== null ? (g.last - g.first) / 1000 : 0
  return g.closed + cur
}

/**
 * 实时 token 数 = 收到的流式片段个数（这条渠道实测 1 个片段 ≈ 1.25 个 token，
 * 按片段数算约偏低 20%，但绝不再漂）。
 *
 * 别改回"用上一轮的 out_tokens ÷ 上一轮片段数"去校准：后端报的 token 数里包含
 * **工具调用的参数**（命令、改代码的 patch 等），那部分不以流式片段的形式发给页面，
 * 所以那个比值天生偏大、且随工具调用多少而变；存进 localStorage 后还会长期偏高，
 * 实时值能飙到真实速度的三倍（实测 438 tok/s vs 真实 ~150）。2026-10-13 改掉。
 */

/**
 * 一轮对话的流式状态机：13 种事件、接上一轮、断开不重连、打断保留半截、
 * reset 重来、停止 / 插话 / 审批 / 询问 / 上下文压缩都在这里。
 * 只搬逻辑，行为照旧（见 web/README）。
 */
export function useTurnStream(opts: {
  current: string | null
  messages: Msg[]
  setCurrent: (id: string | null) => void
  setMessages: React.Dispatch<React.SetStateAction<Msg[]>>
  setCtx: (c: ContextStats | null) => void
  loadChat: (id: string, keepWindow?: boolean) => Promise<void>
  loadChats: () => Promise<import('@/lib/api').Chat[]>
}) {
  const { current, setCurrent, setMessages, setCtx, loadChat, loadChats } = opts

  const [stream, setStream] = useState<Stream | null>(null)
  // 顶栏状态点用：idle 没在收、live 这条流式连接开着、down 连接自己断了（不是你主动断开）
  const [link, setLink] = useState<'idle' | 'live' | 'down'>('idle')
  // 生成速度（tok/s）：生成中按收到的流式片段数估（见 TOK_TITLE），跑完换成这一轮的真实值
  const [rate, setRate] = useState<{ tps: number; live: boolean } | null>(null)
  // 这一轮里插的话（乐观显示；真正的送达点在下一批工具结果之后）
  const [steers, setSteers] = useState<string[]>([])
  // 手动压缩上下文的状态（前台阻塞式，几十秒）
  const [compress, setCompress] = useState<{ running: boolean; msg: string } | null>(null)
  // 压缩期间用户发的消息：先排这里，压完自动发
  const [queued, setQueued] = useState<{ text: string; attachments: Attachment[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const genRef = useRef<GenMeter | null>(null)
  const finalRef = useRef(false) // 这一轮已经定稿（done 到了）：定稿后不许实时估算再覆盖它
  const compressRunning = useRef(false)
  const queuedRef = useRef<{ text: string; attachments: Attachment[] } | null>(null)
  const abort = useRef<AbortController | null>(null)
  // 发送的同步闸门：下面 stream 是 React 状态，同一个 tick 里还是旧值 ——
  // 连点两次发送键（或按住回车）时两次都读到 null，会真的发两条（实测 2 个 /turn）。
  const sendingRef = useRef(false)
  // 这一轮是什么时候发出的：发送后按钮区会立刻从「发送」换成「插话 / 停止」，
  // 而「停止」正好落在原来发送键的位置上 —— 连点第二下就会把刚发出的一轮打断。
  // 所以发出后的短时间内忽略 stop()（见 STOP_GUARD_MS 注释）。
  const turnStartRef = useRef(0)
  // 打断时服务端不会落库，先把已经生成的那半截攥住，回头补到页面上
  const partial = useRef<Part[] | null>(null)
  /** 用户没往上翻才自动跟到底（贴底锚定的容器里 scrollTop = 0 就是最底部） */
  const stick = useRef(true)

  const currentRef = useRef<string | null>(null)
  currentRef.current = current

  // ── 弹出审批卡 / 选项卡时，人若在别的标签页，也把标签闪起来（一轮跑完同理由 hook 尾部触发） ──
  const asking = !!stream?.approval || !!stream?.clarify
  const wasAsking = useRef(false)
  useEffect(() => {
    if (asking && !wasAsking.current && document.hidden) {
      startBlink(stream?.approval ? '有一件事要你点头' : '有一题要你回答')
    }
    wasAsking.current = asking
  }, [asking])

  useEffect(() => {
    const onVis = () => {
      if (!document.hidden) stopBlink()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  // 生成中每 0.5 秒重算一次速度。口径跟后端完全一致：
  // 一次 API 调用 = 一段「窗口」（这次调用的第一个字到最后一个字），
  // 首字之前的排队等待、两次调用之间跑工具的时间都不进分母。
  // 注意：这个定时器只能挂一次。依赖 [stream] 的话每个 delta 都会重挂一次。
  useEffect(() => {
    const timer = window.setInterval(() => {
      const g = genRef.current
      if (!g || finalRef.current) return
      const sec = genElapsed(g)
      // 开头太短时算出来的只是噪声，先不显示
      if (sec < 0.6 || g.tokens < 30) return
      setRate({ tps: g.tokens / sec, live: true })
    }, 500)
    return () => window.clearInterval(timer)
  }, [])

  // 打开历史会话时不再算「最近一条的速度」：每一条回复末尾自己算自己的
  // （后端把 out_tokens / gen_seconds 挂在每个回合的最后一条助手消息上，见 sessions.py）。

  function onEvent(ev: TurnEvent) {
    // 工具事件 = 这次调用已经出完字了、该跑工具了：把这一段窗口收掉（工具时间不进分母）
    if (ev.type === 'tool_start' || ev.type === 'tool_end') {
      const g = genRef.current
      if (g && g.first !== null && g.last !== null) {
        g.closed += (g.last - g.first) / 1000
        g.first = g.last = null
      }
    }
    // 正文和思考各自"续在最后一段上"，中间被工具调用打断就新起一段——
    // 这样界面上看到的就是真实的时间线：文字 → 工具 → 思考 → 文字。
    if (ev.type === 'delta' || ev.type === 'reasoning') {
      const now = performance.now()
      const g = genRef.current ?? { first: null, last: null, closed: 0, tokens: 0 }
      if (g.first === null) {
        g.first = g.last = now
      } else {
        g.last = now
      }
      // 实时 token 数 = 收到的流式片段个数（这条渠道实测 1 片段 ≈ 1.25 个 token，见文件上方那段说明）
      g.tokens += 1
      genRef.current = g
    }
    if (ev.type === 'delta') {
      setStream((s) => {
        if (!s) return s
        const last = s.items[s.items.length - 1]
        if (last && last.kind === 'text') {
          const items = s.items.slice(0, -1)
          items.push({ kind: 'text', text: last.text + ev.text })
          return { ...s, items }
        }
        return { ...s, items: [...s.items, { kind: 'text', text: ev.text }] }
      })
    } else if (ev.type === 'reasoning') {
      setStream((s) => {
        if (!s) return s
        const last = s.items[s.items.length - 1]
        if (last && last.kind === 'reason') {
          const items = s.items.slice(0, -1)
          items.push({ kind: 'reason', text: last.text + ev.text })
          return { ...s, items }
        }
        return { ...s, items: [...s.items, { kind: 'reason', text: ev.text }] }
      })
    } else if (ev.type === 'tool_start' || ev.type === 'tool') {
      if (!ev.name || ev.name === 'reasoning.available') return
      setStream((s) =>
        s ? { ...s, items: [...s.items, { kind: 'tool', name: ev.name, brief: ev.brief, args: ev.args }] } : s,
      )
    } else if (ev.type === 'tool_end') {
      setStream((s) => {
        if (!s) return s
        const items = [...s.items]
        for (let i = items.length - 1; i >= 0; i--) {
          const it = items[i]
          if (it.kind === 'tool' && !it.done && it.name === ev.name) {
            items[i] = { ...it, done: true, result: ev.result || it.result }
            break
          }
        }
        return { ...s, items }
      })
    } else if (ev.type === 'reset') {
      // 断点之前的回放太长被服务端丢了：清掉已渲染的，重新按补发的内容来
      setStream((s) => (s ? { ...s, items: [] } : s))
    } else if (ev.type === 'approval') {
      setStream((s) => (s ? { ...s, approval: ev } : s))
    } else if (ev.type === 'clarify') {
      setStream((s) => (s ? { ...s, clarify: ev } : s))
    } else if (ev.type === 'clarify_end') {
      // 答完（或超时/被停）就收掉卡片。回放事件流时也是这条把它收掉的。
      setStream((s) =>
        s ? { ...s, clarify: s.clarify?.clarify_id === ev.clarify_id ? null : s.clarify } : s,
      )
    } else if (ev.type === 'done') {
      // 真实速度：这一轮输出 token ÷ 真正在收字的秒数（首字等待、跑工具的时间都不算）
      if (ev.out_tokens && ev.gen_seconds) {
        finalRef.current = true
        setRate({ tps: ev.out_tokens / ev.gen_seconds, live: false })
        genRef.current = null
      }
    } else if (ev.type === 'error') {
      setError(ev.message)
    } else if (
      ev.type === 'status' &&
      /❌|non-retryable|aborted|traceback/i.test(`${ev.kind} ${ev.text}`)
    ) {
      // 只把硬失败当错误显示。⚠ 开头的辅助告警（比如自动起标题失败）不该阻塞你。
      setError(ev.text)
    }
  }

  /** 接上正在跑的那一轮：先把断线期间错过的内容补出来，再继续实时收。 */
  async function attach(id: string) {
    const ac = new AbortController()
    abort.current = ac
    // 接上一轮之前先把速度清掉：否则会短暂显示上一轮遗留的数字
    setRate(null)
    genRef.current = { first: null, last: null, closed: 0, tokens: 0 }
    finalRef.current = false
    setStream({ ...EMPTY_STREAM })
    stick.current = true
    setLink('live')
    try {
      await runStream(id, 0, onEvent, ac.signal)
      setLink('idle')
    } catch (err) {
      if (!ac.signal.aborted) {
        setLink('down')
        setError(`接上这一轮失败：${String(err)}`)
      }
    } finally {
      abort.current = null
      setStream(null)
      if (currentRef.current === id) await loadChat(id, true).catch(() => notify('这一轮结束后刷新会话内容失败，切走再切回可重载'))
      await loadChats()
      if (document.hidden) startBlink()
    }
  }

  /** 断开当前这一轮的连接（那一轮在后台照跑，只是这个页面不再跟着看） */
  function detach() {
    abort.current?.abort()
    abort.current = null
    setStream(null)
    setError(null)
    setLink('idle')
  }

  /** 换会话时清掉上一轮残留在页面上的东西（不动后台那一轮） */
  function reset() {
    setStream(null)
    setError(null)
    setSteers([])
    stick.current = true
  }

  async function send(text: string, attachments: Attachment[]) {
    if (stream) return
    if (sendingRef.current) return
    // 压缩期间不让新的一轮进来（会跟压缩抢同一份历史）：先排着，压完自动发
    // （这个分支直接 return，不走下面的 finally —— 上锁必须放在它后面）
    if (compressRunning.current) {
      queuedRef.current = { text, attachments }
      setQueued({ text, attachments })
      return
    }
    sendingRef.current = true
    turnStartRef.current = Date.now()
    let sid = currentRef.current
    setError(null)
    setSteers([])
    setRate(null)
    // 实时计时器归零：窗口在收到第一个字时才开（首字之前的等待不算生成时间）
    genRef.current = { first: null, last: null, closed: 0, tokens: 0 }
    finalRef.current = false
    try {
      if (!sid) {
        const created = await api.newChat()
        sid = created.id
        setCurrent(sid)
      }
      // 本地先把用户消息摆上去。图直接用服务端地址（附件在选图那一刻就传完了），
      // 这样刷新页面之后这条消息里的图也还在。
      const previews = attachments.map(
        (a) =>
          `/api/uploads/${encodeURIComponent(sid as string)}/${encodeURIComponent(a.path.split('/').pop() || '')}`,
      )
      setMessages((m) => [...m, { role: 'user', text, images: previews, ts: Date.now() / 1000 }])
      stick.current = true
      setStream({ ...EMPTY_STREAM })
      setLink('live')

      // 附件已经在输入框那边上传好了（那样刷新页面才不会丢图）
      const ac = new AbortController()
      abort.current = ac
      try {
        await runTurn(sid, text, attachments, onEvent, ac.signal)
        setLink('idle')
      } catch (err) {
        if (!ac.signal.aborted) {
          setLink('down')
          // 断线不重试：直接把状态摆出来，让你自己决定刷新还是重发
          const m = String(err)
          setError(
            /还有一轮在跑/.test(m)
              ? '这个会话上一轮还在生成，等它跑完、或者点「停止」再发。'
              : /failed to fetch|networkerror|load failed|network|err_/i.test(m)
                ? '网络连接中断，这一轮的回复可能没跑完。页面已经重新从数据库读了内容，可以直接再发一条继续。'
                : `出错了：${m}`,
          )
        }
      }
    } catch (err) {
      setError(`请求失败：${String(err)}`)
    } finally {
      sendingRef.current = false
      abort.current = null
      const held = partial.current
      partial.current = null
      setStream(null)
      if (sid) await loadChat(sid, true).catch(() => notify('这一轮结束后刷新会话内容失败，切走再切回可重载'))
      // 被打断的那一轮数据库里没有记录，把已经生成的半截接在最后，别让画面白等
      if (held && held.length) {
        setMessages((m) =>
          m.length && m[m.length - 1].role === 'assistant'
            ? m
            : [...m, { role: 'assistant', parts: held, stopped: true, ts: Date.now() / 1000 }],
        )
      }
      await loadChats()
      if (document.hidden) startBlink()
    }
  }

  /** 重新生成最后一轮：回滚上一轮问答，以原提问在当前视图直接原地重跑（不重复新增用户消息） */
  async function regenerate() {
    if (stream) return
    if (sendingRef.current) return
    if (compressRunning.current) return
    const sid = currentRef.current
    if (!sid) return

    sendingRef.current = true
    turnStartRef.current = Date.now()
    setError(null)
    setSteers([])
    setRate(null)
    genRef.current = { first: null, last: null, closed: 0, tokens: 0 }
    finalRef.current = false

    // 界面上把最后这条助手回复去掉（等待新流式结果原地生成），绝不添加重复的用户消息！
    setMessages((m) => (m.length && m[m.length - 1].role === 'assistant' ? m.slice(0, -1) : m))
    stick.current = true
    setStream({ ...EMPTY_STREAM })
    setLink('live')

    const ac = new AbortController()
    abort.current = ac
    try {
      await runRegenerate(sid, onEvent, ac.signal)
      setLink('idle')
    } catch (err) {
      if (!ac.signal.aborted) {
        setLink('down')
        setError(`重新生成失败：${String(err)}`)
      }
    } finally {
      sendingRef.current = false
      abort.current = null
      const held = partial.current
      partial.current = null
      setStream(null)
      if (sid) await loadChat(sid, true).catch(() => notify('这一轮结束后刷新会话内容失败，切走再切回可重载'))
      if (held && held.length) {
        setMessages((m) =>
          m.length && m[m.length - 1].role === 'assistant'
            ? m
            : [...m, { role: 'assistant', parts: held, stopped: true, ts: Date.now() / 1000 }],
        )
      }
      await loadChats()
      if (document.hidden) startBlink()
    }
  }

  async function stop() {
    const sid = currentRef.current
    if (!sid) return
    // 连点发送键的余波：刚发出这一轮（< STOP_GUARD_MS）时忽略停止请求
    if (Date.now() - turnStartRef.current < STOP_GUARD_MS) return
    partial.current = stream?.items ?? null
    abort.current?.abort()
    await api.interrupt(sid).catch(() => notify('停止请求没送到，这一轮还在跑'))
  }

  /** 生成中插话：把这句话交给正在跑的那一轮（不打断）。失败就退回让用户重发，不吞字。 */
  async function steer(text: string) {
    const sid = currentRef.current
    if (!sid || !text.trim()) return
    setSteers((s) => [...s, text])
    try {
      const r = await api.steer(sid, text)
      if (!r.ok) {
        setSteers((s) => s.slice(0, -1))
        setError('这句话没插进去（这一轮可能刚好结束了），重新发一次就行。')
      }
    } catch (e) {
      setSteers((s) => s.slice(0, -1))
      setError(`插话失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function decide(choice: 'once' | 'session' | 'always' | 'deny') {
    const ap = stream?.approval
    const sid = currentRef.current
    if (!ap || !sid) return
    try {
      await api.approve(sid, ap.request_id, choice)
    } catch {
      // 失败就保留卡片：清掉卡片等于让用户以为已经批准，实际模型还在等
      notify('审批没送出去，请再点一次')
      return
    }
    setStream((s) => (s ? { ...s, approval: null } : s))
  }

  /** 回答模型问的问题：把答案递回去，agent 线程接着往下跑。 */
  async function answerClarify(response: string) {
    const c = stream?.clarify
    const sid = currentRef.current
    if (!c || !sid) return
    try {
      await api.clarify(sid, c.clarify_id, response)
    } catch {
      notify('回答没送出去，请再试一次')
      return
    }
    setStream((s) => (s ? { ...s, clarify: null } : s))
  }

  /** 压缩上下文：前台阻塞式（服务端同步压完才返回，几十秒）。这期间用户发的消息先排队。 */
  async function compressCtx() {
    const sid = currentRef.current
    if (!sid || compressRunning.current) return
    compressRunning.current = true
    setCompress({ running: true, msg: '正在压缩上下文，大概 30~60 秒…' })
    try {
      const r = await api.compress(sid)
      if (!r.ok) {
        setCompress({ running: false, msg: r.error || '压缩失败' })
      } else {
        // 压完了不在界面上报数：上下文圆环自己会回落，就是最直接的反馈
        setCompress(null)
        setCtx(await api.context(sid).catch(() => null))
        await loadChat(sid, true).catch(() => notify('压缩完了但刷新会话内容失败'))
      }
    } catch (e) {
      setCompress({
        running: false,
        msg: `压缩请求失败：${e instanceof Error ? e.message : String(e)}`,
      })
    } finally {
      compressRunning.current = false
      // 压缩期间排队的消息，现在发出去
      const q = queuedRef.current
      queuedRef.current = null
      setQueued(null)
      if (q) await send(q.text, q.attachments)
    }
  }

  return {
    stream,
    link,
    rate,
    steers,
    compress,
    queued,
    error,
    stick,
    setError,
    setStream,
    setSteers,
    attach,
    detach,
    reset,
    send,
    regenerate,
    stop,
    steer,
    decide,
    answerClarify,
    compressCtx,
  }
}
