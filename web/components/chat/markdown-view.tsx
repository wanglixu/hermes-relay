'use client'

import { memo, useEffect, useRef } from 'react'
import { decorate, rehighlight, renderMarkdown } from '@/lib/markdown'

/** 正在流式输出时：为最后一个文本节点末尾加上渐隐遮罩（方案 1：mask-image） */
function applyFadeToLastText(root: HTMLElement, len = 16) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let lastNode: Text | null = null
  let curr: Node | null
  while ((curr = walker.nextNode())) {
    if (curr.textContent && curr.textContent.trim().length > 0) {
      lastNode = curr as Text
    }
  }
  if (!lastNode || !lastNode.textContent) return
  const full = lastNode.textContent
  if (full.length <= 4) {
    const span = document.createElement('span')
    span.className = 'stream-fade-tail'
    span.textContent = full
    lastNode.replaceWith(span)
    return
  }
  const splitPos = Math.max(0, full.length - len)
  const solid = full.slice(0, splitPos)
  const fade = full.slice(splitPos)

  const span = document.createElement('span')
  span.className = 'stream-fade-tail'
  span.textContent = fade

  const frag = document.createDocumentFragment()
  if (solid) frag.appendChild(document.createTextNode(solid))
  frag.appendChild(span)
  lastNode.replaceWith(frag)
}

/** 一段 Markdown。
 *  live=false：完整渲染历史消息或已定稿消息（零延迟、零额外计算）。
 *  live=true：启用 RAF 帧缓冲平滑打字机（Smooth Typing Buffer），
 *  将网络突发到达的字符平滑匀速向前推进，末尾配合 mask-image 渐隐，彻底告别一段一段蹦字。 */
export const Markdown = memo(function Markdown({ text, live }: { text: string; live: boolean }) {
  const settledRef = useRef<HTMLDivElement>(null)
  const tailRef = useRef<HTMLSpanElement>(null)
  const cache = useRef('')

  const targetTextRef = useRef(text)
  targetTextRef.current = text

  const displayedLenRef = useRef(live ? 0 : text.length)
  const rafIdRef = useRef<number | null>(null)

  // 渲染指定长度的已推进文本
  const renderCurrent = (currentText: string, isLive: boolean) => {
    const cut = isLive ? currentText.lastIndexOf('\n\n') : -1
    const settled = cut >= 0 ? currentText.slice(0, cut) : isLive ? '' : currentText
    const tail = cut >= 0 ? currentText.slice(cut) : isLive ? currentText : ''

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
      el.innerHTML = tail ? renderMarkdown(tail.replace(/(\*{1,3}|_{1,2}|`{1,3})\s*$/, '')) : ''
      if (isLive && tail) {
        applyFadeToLastText(el, 16)
      }
    }

    // 打字机换行撑高容器时，若用户处于贴底吸底状态，视口平滑跟进
    if (isLive && el) {
      const scrollBox = el.closest('.overflow-y-auto') as HTMLElement | null
      if (scrollBox) {
        const dist = scrollBox.scrollHeight - (scrollBox.scrollTop + scrollBox.clientHeight)
        if (dist <= 90) {
          scrollBox.scrollTop = scrollBox.scrollHeight
        }
      }
    }
  }

  // 非流式（定稿回合或历史消息）：随 text 变化同步更新，不走任何 RAF 循环
  useEffect(() => {
    if (!live) {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
      displayedLenRef.current = text.length
      renderCurrent(text, false)
      if (tailRef.current) {
        tailRef.current.innerHTML = ''
        tailRef.current.removeAttribute('data-src')
      }
    }
  }, [text, live])

  // 流式状态（live = true）：启动 RAF 均匀消费队列平滑吐字
  useEffect(() => {
    if (!live) return

    const tick = () => {
      const target = targetTextRef.current
      const currentLen = displayedLenRef.current

      if (currentLen < target.length) {
        const diff = target.length - currentLen
        let step = 1
        if (diff > 80) step = Math.ceil(diff / 6)
        else if (diff > 30) step = 3
        else if (diff > 12) step = 2
        else step = 1

        const nextLen = Math.min(target.length, currentLen + step)
        displayedLenRef.current = nextLen
        renderCurrent(target.slice(0, nextLen), true)
      }

      rafIdRef.current = requestAnimationFrame(tick)
    }

    rafIdRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    }
  }, [live])

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
