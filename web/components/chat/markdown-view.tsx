'use client'

import { memo, useEffect, useRef } from 'react'
import { decorate, rehighlight, renderMarkdown } from '@/lib/markdown'

/** 一段 Markdown。live=true 表示它是最后一段、还在长：
 *  已用空行定型的部分才做 Markdown 解析，尾部按纯文本逐帧追加。 */
export const Markdown = memo(function Markdown({ text, live }: { text: string; live: boolean }) {
  const settledRef = useRef<HTMLDivElement>(null)
  const tailRef = useRef<HTMLSpanElement>(null)
  const cache = useRef('')

  useEffect(() => {
    const cut = live ? text.lastIndexOf('\n\n') : -1
    const settled = cut >= 0 ? text.slice(0, cut) : live ? '' : text
    const tail = cut >= 0 ? text.slice(cut) : live ? text : ''

    if (settled !== cache.current) {
      cache.current = settled
      if (settledRef.current) {
        settledRef.current.innerHTML = settled ? renderMarkdown(settled) : ''
        decorate(settledRef.current)
      }
    }
    const el = tailRef.current
    if (el && el.dataset.src !== tail) {
      el.dataset.src = tail
      // 尾部也走 Markdown 渲染，但只重排这一段（代价很小）：
      // 否则最后一段里的 ** 加粗、代码块、列表会一直显示成原始符号，
      // 直到出现空行才"变脸"，看着像闪烁。
      // 末尾还没闭合的 ** / ` / _ 先藏起来，等闭合了再显示。
      el.innerHTML = tail ? renderMarkdown(tail.replace(/(\*{1,3}|_{1,2}|`{1,3})\s*$/, '')) : ''
    }
  }, [text, live])

  // 换配色之后重算代码高亮：语法颜色是写进 inline style 的，不重算就还是旧配色的
  useEffect(() => {
    const onTheme = () => rehighlight(settledRef.current)
    window.addEventListener('relay:theme', onTheme)
    return () => window.removeEventListener('relay:theme', onTheme)
  }, [])

  return (
    <>
      <div ref={settledRef} />
      <span className="stream-tail" ref={tailRef} />
    </>
  )
})
