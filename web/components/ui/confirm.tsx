'use client'

import { AlertTriangle } from 'lucide-react'
import { useEffect, useState } from 'react'

/** 站内确认框：替掉 `window.confirm`。
 *
 *  为什么不用原生 confirm：它是浏览器进程画的灰白系统框，和暖纸设计不是一套；
 *  而且原生框会阻塞整个页面（生成中的逐字、动画全部停住）。
 *
 *  用法（任意组件里，不用传递 props）：
 *    if (!(await confirmAction({ title: '删除这个会话？', body: '记录会从会话库里删掉。', danger: true }))) return
 *  宿主 <ConfirmHost /> 挂在 app/page.tsx 顶层，一个页面挂一次就够。
 */

export type ConfirmRequest = {
  title?: string
  body?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

type Pending = ConfirmRequest & { resolve: (v: boolean) => void; id: number }

let seq = 0
let queue: Pending[] = []
let current: Pending | null = null
const listeners = new Set<(cur: Pending | null) => void>()

function emit() {
  for (const l of listeners) l(current)
}

function pump() {
  current = queue.shift() ?? null
  emit()
}

/** 打开一个确认框，等用户点。返回 true = 确认，false = 取消 / Esc / 点遮罩。 */
export function confirmAction(req: ConfirmRequest | string): Promise<boolean> {
  const opts: ConfirmRequest = typeof req === 'string' ? { body: req } : req
  return new Promise<boolean>((resolve) => {
    if (!listeners.size) {
      // 宿主没挂（例如某个孤立组件被单独渲染）：退回原生框，别让确认环节整个消失
      resolve(window.confirm([opts.title, opts.body].filter(Boolean).join('\n')))
      return
    }
    queue.push({ ...opts, id: ++seq, resolve })
    if (!current) pump()
  })
}

function settle(value: boolean) {
  const item = current
  if (!item) return
  current = null
  item.resolve(value)
  emit()
  if (queue.length) window.setTimeout(pump, 0)
}

export function ConfirmHost() {
  const [cur, setCur] = useState<Pending | null>(null)
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const l = (next: Pending | null) => {
      setCur(next)
      if (next) {
        setMounted(true)
        // 先以收起态挂载、隔一帧再打开，否则 `.pop-modal` 没有起点、没有入场动画
        requestAnimationFrame(() => setOpen(true))
      } else {
        setOpen(false)
      }
    }
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        settle(false)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        settle(true)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  if (!mounted) return null

  return (
    <div
      data-open={open && cur ? 'true' : undefined}
      className="pop-scrim fixed inset-0 z-[60] items-center justify-center bg-black/45 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) settle(false)
      }}
    >
      <div
        data-open={open && cur ? 'true' : undefined}
        role="alertdialog"
        aria-modal="true"
        aria-label={cur?.title || '请确认'}
        className="pop-modal paper-lift w-[420px] max-w-[calc(100vw-48px)] flex-col gap-3 rounded-[9px] border border-line-strong bg-panel p-4"
      >
        <div className="flex items-start gap-2.5">
          {cur?.danger && (
            <span className="mt-0.5 flex size-7 flex-none items-center justify-center rounded-full bg-danger/10 text-danger">
              <AlertTriangle size={14} />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="m-0 font-title text-[13.5px] font-semibold text-ink">{cur?.title || '请确认'}</h2>
            {cur?.body && (
              <p className="mt-1.5 mb-0 text-[12.5px] leading-[1.6] whitespace-pre-line text-ink-2">{cur.body}</p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => settle(false)}
            className="cursor-pointer rounded-md border border-line-strong bg-transparent px-3 py-1.5 text-[12.5px] text-ink-2 transition-colors hover:bg-raised hover:text-ink"
          >
            {cur?.cancelText || '取消'}
          </button>
          <button
            type="button"
            onClick={() => settle(true)}
            className={
              cur?.danger
                ? 'cursor-pointer rounded-md bg-danger px-3 py-1.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90'
                : 'cursor-pointer rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-on-accent transition-opacity hover:opacity-90'
            }
          >
            {cur?.confirmText || '确定'}
          </button>
        </div>
      </div>
    </div>
  )
}
