'use client'

import { AlertCircle, Check } from 'lucide-react'
import { useEffect, useState } from 'react'

/** 轻提示：接口失败 / 操作被拒时给一句人话，替掉「什么都不做」的空 catch。
 *
 *  以前这些地方是 `.catch(() => {})`，失败后界面只是「点了没反应」，
 *  模型清单、技能列表、config 加载失败根本看不出来。
 *
 *  用法（不用挂 props）：notify('模型清单没取到')、notify('已保存', 'ok')
 *  宿主 <ToastHost /> 挂在 app/page.tsx 顶层，一个页面挂一次。
 */

export type ToastKind = 'error' | 'ok'
type Item = { id: number; text: string; kind: ToastKind }

let seq = 0
let items: Item[] = []
const listeners = new Set<(list: Item[]) => void>()
let last = { text: '', at: 0 }

function emit() {
  for (const l of listeners) l(items)
}

/** 同一条消息 2 秒内只提示一次（轮询/并发请求同时失败时不刷屏）。 */
export function notify(text: string, kind: ToastKind = 'error') {
  const now = Date.now()
  if (text === last.text && now - last.at < 2000) return
  last = { text, at: now }
  const item: Item = { id: ++seq, text, kind }
  items = [...items, item].slice(-3)
  emit()
  window.setTimeout(() => {
    items = items.filter((x) => x.id !== item.id)
    emit()
  }, kind === 'error' ? 6000 : 2600)
}

export function ToastHost() {
  const [list, setList] = useState<Item[]>([])
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const l = (next: Item[]) => {
      if (next.length) setMounted(true)
      setList(next)
    }
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])

  if (!mounted || !list.length) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[70] flex flex-col items-center gap-2">
      {list.map((t) => (
        <div
          key={t.id}
          role="status"
          className="pointer-events-auto flex max-w-[calc(100vw-64px)] items-start gap-2 rounded-md border border-line-strong bg-panel/95 px-3 py-2 text-[12.5px] leading-[1.5] text-ink shadow-[0_6px_18px_-8px_rgba(45,45,42,0.35)] backdrop-blur-sm"
        >
          <span className={t.kind === 'error' ? 'mt-0.5 text-danger' : 'mt-0.5 text-ok'}>
            {t.kind === 'error' ? <AlertCircle size={13} /> : <Check size={13} />}
          </span>
          <span className="whitespace-pre-line">{t.text}</span>
        </div>
      ))}
    </div>
  )
}
