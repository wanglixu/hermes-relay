'use client'

import { Check, SendHorizontal } from 'lucide-react'
import { motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Clarify, ClarifyQuestion } from '@/lib/api'
import { explainApproval } from '@/lib/approval-explain'
import { cn } from '@/lib/cn'

const GHOST =
  'inline-flex items-center gap-1.5 rounded-ctl border border-line bg-transparent px-3.5 py-2 text-[13px] text-ink transition-colors hover:border-accent-text hover:bg-raised'
const PRIMARY =
  'inline-flex items-center gap-1.5 rounded-ctl border-0 bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-on-accent transition-colors hover:bg-accent/86'

export type Approval = {
  request_id: string
  command: string
  description: string
  timeout_sec?: number
  deadline?: number
}

/** 需要你点头才继续的一步：先说清这条命令要做什么、做下去会有什么风险，
 *  命令原文折叠在后面（看得懂说明就够了，想核对细节再展开），四个选择。 */
/** 这一步还剩几秒。有绝对到期时刻就用它；只给了时限时按「收到事件那刻」起算兜底。 */
function useCountdown(data: Approval): number | null {
  const mountedAt = useRef(Date.now() / 1000)
  const left = useCallback(() => {
    if (!data.deadline && !data.timeout_sec) return null
    const base = data.deadline ?? mountedAt.current + (data.timeout_sec ?? 0)
    return Math.max(0, base - Date.now() / 1000)
  }, [data.deadline, data.timeout_sec])
  const [sec, setSec] = useState(left)
  useEffect(() => {
    setSec(left())
    if (left() === null) return
    const t = setInterval(() => setSec(left()), 500)
    return () => clearInterval(t)
  }, [left])
  return sec
}

function fmtLeft(sec: number): string {
  const s = Math.ceil(sec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function ApprovalCard({
  data,
  onDecide,
}: {
  data: Approval
  onDecide: (choice: 'once' | 'session' | 'always' | 'deny') => void
}) {
  const ex = useMemo(() => explainApproval(data.description), [data.description])
  // 命令原文默认摊开：要你点头的东西，不该先藏起来等你去找
  const [showCommand, setShowCommand] = useState(true)
  const left = useCountdown(data)
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="rounded-card border border-line bg-panel px-[18px] py-4"
    >
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div className="font-read text-[16px] font-semibold">需要你确认才能继续</div>
        {left !== null && (
          <div
            className={cn(
              'flex-none font-mono text-[12.5px] tabular-nums',
              left <= 60 ? 'text-danger-text' : 'text-muted',
            )}
          >
            {left > 0 ? `还剩 ${fmtLeft(left)}` : '已超时'}
          </div>
        )}
      </div>
      <div className="mb-2.5 space-y-2.5 rounded-ctl border border-line bg-page px-3.5 py-3">
        <div>
          <div className="mb-1 text-[12.5px] tracking-wide text-muted">这条命令要做什么</div>
          <div className="text-[13.5px] leading-relaxed text-ink">{ex.goal}</div>
        </div>
        <div>
          <div className="mb-1 text-[12.5px] tracking-wide text-muted">风险</div>
          <div
            className={cn(
              'text-[13.5px] leading-relaxed',
              ex.danger >= 2 ? 'text-danger-text' : 'text-ink-2',
            )}
          >
            {ex.risk}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setShowCommand((v) => !v)}
        className="mb-3 text-[12.5px] text-accent-text transition-colors hover:underline"
      >
        {showCommand ? '收起命令原文' : '查看命令原文'}
      </button>
      {showCommand && (
        <pre className="mb-3.5 overflow-x-auto rounded-ctl border border-line bg-page px-3 py-2.5 font-mono text-[12.5px] whitespace-pre-wrap text-ink-2 [overflow-wrap:anywhere]">
          {data.command}
        </pre>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button className={GHOST} onClick={() => onDecide('deny')}>
          拒绝
        </button>
        <button className={GHOST} onClick={() => onDecide('session')}>
          本会话都允许
        </button>
        <button className={GHOST} onClick={() => onDecide('always')}>
          以后都允许
        </button>
        <button className={PRIMARY} onClick={() => onDecide('once')}>
          允许这一次
        </button>
      </div>
    </motion.div>
  )
}

/** Hermes 给第一个选项加的推荐后缀；展示时去掉、用「推荐」小标签代替，提交时也要去掉。 */
const RECOMMENDED = '(Recommended)'
function plainChoice(c: string): string {
  const t = c.trim()
  return t.toLowerCase().endsWith(RECOMMENDED.toLowerCase())
    ? t.slice(0, -RECOMMENDED.length).trim()
    : t
}
function isRecommended(c: string): boolean {
  return c.trim().toLowerCase().endsWith(RECOMMENDED.toLowerCase())
}

/** 模型反过来问用户（原生 clarify）：一张卡片，每题选一个/多选/自己填，一次提交回去。
 *  提交格式跟 Hermes 工具侧的契约一致：单个问题发答案原文；批量问题发 {"answers":{qid:答案}} 的 JSON；
 *  多选题的答案是 JSON 数组串（工具侧 _clean_answer 会解析）。 */
// 每个问题都固定给一个跳过项：答不了的时候要能往下走，不用被迫选一个
const SKIP = '跳过该问题'

export function ClarifyCard({
  data,
  onSubmit,
}: {
  data: Clarify
  onSubmit: (response: string) => void
}) {
  const [picked, setPicked] = useState<Record<string, string[]>>({}) // qid → 选中的选项（已去掉推荐后缀）
  const [typed, setTyped] = useState<Record<string, string>>({}) // qid → 自己填的字
  // 多选的问题直接把「自己填」的输入框摊开（单选仍然收着，点「其他」才出来）
  const multiCount = (data?.questions || []).filter((q) => q.multi_select).length
  const allMulti = multiCount === (data?.questions || []).length && (data?.questions || []).length > 0
  // 一次只摆一个问题：几道题全铺开会把输入框顶出屏幕，答完这题再出下一题
  const [rawStep, setStep] = useState(0)
  // 同一张卡上题数不会变，但换下一张卡时实例是复用的，旧 step 可能越界 → 夹一下
  const step = Math.min(rawStep, Math.max(0, (data?.questions || []).length - 1))
  const last = step >= (data?.questions || []).length - 1
  const [showOther, setShowOther] = useState<Record<string, boolean>>(() =>
    Object.fromEntries((data?.questions || []).filter((q) => q.multi_select).map((q) => [q.qid, true])),
  )

  const valueOf = useCallback(
    (q: ClarifyQuestion): string => {
      const sel = picked[q.qid] ?? []
      const text = (typed[q.qid] ?? '').trim()
      if (q.multi_select) {
        const all = text ? [...sel, text] : sel
        return all.length ? JSON.stringify(all) : ''
      }
      return text || sel[0] || ''
    },
    [picked, typed],
  )

  const answers = useMemo(() => data.questions.map(valueOf), [data.questions, valueOf])
  const ready = answers.every((a) => a !== '')
  const curReady = valueOf(data.questions[step]) !== ''

  const submit = useCallback(() => {
    if (!answers.every((a) => a !== '')) return
    if (!data.batch && data.questions.length === 1) return onSubmit(valueOf(data.questions[0]))
    const map: Record<string, string> = {}
    data.questions.forEach((q, i) => (map[q.qid] = answers[i]))
    onSubmit(JSON.stringify({ answers: map }))
  }, [answers, data.batch, data.questions, onSubmit, valueOf])

  const toggle = (q: ClarifyQuestion, label: string) => {
    const skip = label === SKIP
    setPicked((p) => {
      const cur = p[q.qid] ?? []
      // 跳过跟别的选项不并存：挑了跳过就把它自己顶上，挑别的就把跳过摘掉
      if (skip) return { ...p, [q.qid]: cur.includes(SKIP) ? [] : [SKIP] }
      const rest = cur.filter((x) => x !== SKIP)
      if (!q.multi_select) return { ...p, [q.qid]: rest[0] === label ? [] : [label] }
      return {
        ...p,
        [q.qid]: rest.includes(label) ? rest.filter((x) => x !== label) : [...rest, label],
      }
    })
    if (skip) setTyped((t) => ({ ...t, [q.qid]: '' }))
  }

  return (
    <motion.div
      key={data.clarify_id}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="max-h-[min(58vh,520px)] overflow-y-auto rounded-card border border-line bg-panel px-5 pt-[18px] pb-4"
    >
      <div className="mb-3 font-read text-[16px] font-semibold tracking-[0.01em]">
        {data.questions.length > 1 ? `需要你回答 ${data.questions.length} 个问题` : '需要你回答'}
        {allMulti && (
          <span className="ml-2 align-[2px] rounded-ctl border border-line-strong px-[5px] py-[1px] font-ui text-[10.5px] font-normal tracking-normal text-muted">
            可多选
          </span>
        )}
        {data.questions.length > 1 && (
          <span className="ml-2 font-ui text-[12px] font-normal tracking-normal text-muted">
            第 {step + 1} / {data.questions.length} 题
          </span>
        )}
      </div>
      {data.questions.slice(step, step + 1).map((q, qi0) => {
        const qi = step + qi0
        const sel = picked[q.qid] ?? []
        return (
          <div
            key={q.qid}
            className={cn(qi0 > 0 && 'mt-4 border-t border-line pt-4')}
          >
            <div className="mb-2.5 text-[14.5px] leading-[1.7]">
              {data.questions.length > 1 && (
                <span className="mr-1.5 inline-block min-w-[15px] font-mono text-[12.5px] text-muted">
                  {qi + 1}
                </span>
              )}
              {q.question}
              {q.multi_select && !allMulti && (
                <span className="ml-2 align-[2px] rounded-ctl border border-line-strong px-[5px] py-[1px] font-ui text-[10.5px] text-muted">
                  可多选
                </span>
              )}
            </div>
            {(q.choices ?? []).map((raw) => {
              const label = plainChoice(raw)
              const on = sel.includes(label)
              return (
                <button
                  key={raw}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(q, label)}
                  className={cn(
                    'mb-1.5 flex w-full cursor-pointer items-center gap-2.5 rounded-ctl border border-line-strong bg-transparent px-3 py-[11px] text-left text-[13.5px] font-medium leading-normal text-ink-2 transition-colors hover:border-accent-text hover:bg-raised hover:text-ink',
                    on && 'border-accent-text bg-accent/14 text-ink',
                  )}
                >
                  <span className="min-w-0 flex-1">{label}</span>
                  {isRecommended(raw) && (
                    <span className="flex-none rounded-ctl border border-line-strong px-[5px] font-mono text-[10.5px] text-muted">
                      推荐
                    </span>
                  )}
                  <span aria-hidden="true" className="inline-flex size-3.5 flex-none items-center justify-center text-accent-text">
                    {on ? <Check size={13} strokeWidth={3} /> : null}
                  </span>
                </button>
              )
            })}
            <button
              type="button"
              aria-pressed={sel.includes(SKIP)}
              onClick={() => toggle(q, SKIP)}
              className={cn(
                'mb-1.5 flex w-full cursor-pointer items-center gap-2.5 rounded-ctl border border-dashed border-line-strong bg-transparent px-3 py-[11px] text-left text-[13.5px] font-medium leading-normal text-muted transition-colors hover:border-accent-text hover:bg-raised hover:text-ink-2',
                sel.includes(SKIP) && 'border-solid border-accent-text bg-accent/14 text-ink',
              )}
            >
              <span className="min-w-0 flex-1">跳过该问题</span>
              <span aria-hidden="true" className="inline-flex size-3.5 flex-none items-center justify-center text-accent-text">
                {sel.includes(SKIP) ? <Check size={13} strokeWidth={3} /> : null}
              </span>
            </button>
            {q.choices?.length && !showOther[q.qid] && !typed[q.qid] ? (
              <button
                type="button"
                className="mt-0.5 cursor-pointer border-none bg-transparent px-0 py-0.5 text-[12.5px] text-muted underline underline-offset-[3px] hover:text-ink-2"
                onClick={() => setShowOther((s) => ({ ...s, [q.qid]: true }))}
              >
                其他（自己填）
              </button>
            ) : null}
            {!q.choices?.length || showOther[q.qid] || typed[q.qid] ? (
              <input
                className="mt-2 h-9 w-full rounded-ctl border border-line bg-page px-3 font-ui text-[13.5px] text-ink focus:border-accent-text focus:outline-none"
                value={typed[q.qid] ?? ''}
                placeholder={q.choices?.length ? '自己写的答案…' : '输入你的回答…'}
                onChange={(e) => {
                  const v = e.target.value
                  setTyped((t) => ({ ...t, [q.qid]: v }))
                  if (v.trim())
                    setPicked((p) => ({ ...p, [q.qid]: (p[q.qid] ?? []).filter((x) => x !== SKIP) }))
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    // 一次只摆一题：回车先推进到下一题，最后一题才提交
                    if (last) submit()
                    else if (curReady) setStep((s) => s + 1)
                  }
                }}
              />
            ) : null}
          </div>
        )
      })}
      <div className="mt-4 flex items-center justify-between gap-3">
        {step > 0 ? (
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            className="cursor-pointer border-none bg-transparent px-0 py-0.5 text-[12.5px] text-muted underline underline-offset-[3px] hover:text-ink-2"
          >
            上一题
          </button>
        ) : (
          <span />
        )}
        {last ? (
          <button
            onClick={submit}
            disabled={!ready}
            className="inline-flex h-8 flex-none items-center gap-1.5 rounded-ctl border border-accent-text/45 bg-transparent px-3.5 text-[12.5px] font-medium text-accent-text transition-colors hover:border-accent-text hover:bg-accent/14 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <SendHorizontal size={13} strokeWidth={2.5} />
            发送
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setStep((s) => s + 1)}
            disabled={!curReady}
            className="inline-flex h-8 flex-none items-center gap-1.5 rounded-ctl border border-accent-text/45 bg-transparent px-3.5 text-[12.5px] font-medium text-accent-text transition-colors hover:border-accent-text hover:bg-accent/14 disabled:cursor-not-allowed disabled:opacity-45"
          >
            下一题
          </button>
        )}
      </div>
    </motion.div>
  )
}
