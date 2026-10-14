'use client'

import { Check, SendHorizontal } from 'lucide-react'
import { motion } from 'motion/react'
import { useCallback, useMemo, useState } from 'react'
import type { Clarify, ClarifyQuestion } from '@/lib/api'
import { explainApproval } from '@/lib/approval-explain'
import { cn } from '@/lib/cn'

const GHOST =
  'inline-flex items-center gap-1.5 rounded-ctl border border-line bg-transparent px-3.5 py-2 text-[13px] text-ink transition-colors hover:border-accent-text hover:bg-raised'
const PRIMARY =
  'inline-flex items-center gap-1.5 rounded-ctl border-0 bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-on-accent transition-colors hover:bg-accent/86'

export type Approval = { request_id: string; command: string; description: string }

/** 需要你点头才继续的一步：先说清这条命令要做什么、做下去会有什么风险，
 *  命令原文折叠在后面（看得懂说明就够了，想核对细节再展开），四个选择。 */
export function ApprovalCard({
  data,
  onDecide,
}: {
  data: Approval
  onDecide: (choice: 'once' | 'session' | 'always' | 'deny') => void
}) {
  const ex = useMemo(() => explainApproval(data.description), [data.description])
  const [showCommand, setShowCommand] = useState(false)
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="rounded-card border border-line bg-panel px-[18px] py-4"
    >
      <div className="mb-2 font-read text-[16px] font-semibold">需要你确认才能继续</div>
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
export function ClarifyCard({
  data,
  onSubmit,
}: {
  data: Clarify
  onSubmit: (response: string) => void
}) {
  const [picked, setPicked] = useState<Record<string, string[]>>({}) // qid → 选中的选项（已去掉推荐后缀）
  const [typed, setTyped] = useState<Record<string, string>>({}) // qid → 自己填的字
  const [showOther, setShowOther] = useState<Record<string, boolean>>({})

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

  const submit = useCallback(() => {
    if (!answers.every((a) => a !== '')) return
    if (!data.batch && data.questions.length === 1) return onSubmit(valueOf(data.questions[0]))
    const map: Record<string, string> = {}
    data.questions.forEach((q, i) => (map[q.qid] = answers[i]))
    onSubmit(JSON.stringify({ answers: map }))
  }, [answers, data.batch, data.questions, onSubmit, valueOf])

  const toggle = (q: ClarifyQuestion, label: string) => {
    setPicked((p) => {
      const cur = p[q.qid] ?? []
      if (!q.multi_select) return { ...p, [q.qid]: cur[0] === label ? [] : [label] }
      return {
        ...p,
        [q.qid]: cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label],
      }
    })
  }

  return (
    <motion.div
      key={data.clarify_id}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="rounded-card border border-line bg-panel px-5 pt-[18px] pb-4"
    >
      <div className="mb-3 font-read text-[16px] font-semibold tracking-[0.01em]">
        {data.questions.length > 1 ? `需要你回答 ${data.questions.length} 个问题` : '需要你回答'}
      </div>
      {data.questions.map((q, qi) => {
        const sel = picked[q.qid] ?? []
        return (
          <div
            key={q.qid}
            className={cn(
              qi > 0 && 'mt-4 border-t border-line pt-4',
            )}
          >
            <div className="mb-2.5 text-[14.5px] leading-[1.7]">
              {data.questions.length > 1 && (
                <span className="mr-1.5 inline-block min-w-[15px] font-mono text-[12.5px] text-muted">
                  {qi + 1}
                </span>
              )}
              {q.question}
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
                    'mb-1.5 flex w-full cursor-pointer items-center gap-2.5 rounded-ctl border border-line bg-transparent px-3 py-[11px] text-left text-[13.5px] leading-normal text-ink-2 transition-colors hover:border-line-strong hover:bg-raised hover:text-ink',
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
                onChange={(e) => setTyped((t) => ({ ...t, [q.qid]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    submit()
                  }
                }}
              />
            ) : null}
            {q.multi_select && <div className="mt-1 text-[12.5px] text-muted">可多选</div>}
          </div>
        )
      })}
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-[12.5px] text-muted">
          这一轮在等你，回答后模型继续。超时会自动跳过。
        </span>
        <button
          onClick={submit}
          disabled={!ready}
          className="inline-flex h-8 flex-none items-center gap-1.5 rounded-ctl border border-accent-text/45 bg-transparent px-3.5 text-[12.5px] font-medium text-accent-text transition-colors hover:border-accent-text hover:bg-accent/14 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <SendHorizontal size={13} strokeWidth={2.5} />
          发送
        </button>
      </div>
    </motion.div>
  )
}
