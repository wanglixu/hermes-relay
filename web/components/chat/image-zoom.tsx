'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

let open: ((src: string) => void) | null = null

/** 点一下图片 → 全屏放大看（灯箱）。任何组件都能调，不用传 props。 */
export function zoomImage(src: string) {
  open?.(src)
}

export function ImageZoom() {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    open = setSrc
    return () => {
      open = null
    }
  }, [])

  // 放大时锁住页面滚动：否则滚轮会带着底下的聊天记录一起滚
  useEffect(() => {
    if (!src) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [src])

  // Esc 关闭
  useEffect(() => {
    if (!src) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSrc(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [src])

  if (!src) return null

  return (
    <div
      // fixed 钉在最上层；点空白处（点背景）即关闭；淡入
      className="zoom-layer fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center overscroll-none bg-black/80 p-4 backdrop-blur-sm"
      onClick={() => setSrc(null)}
      title="点击空白处或按 Esc 关闭"
    >
      {/* 关闭按钮：点它不触发背景的关闭（stopPropagation） */}
      <button
        type="button"
        className="absolute top-4 right-4 flex size-10 cursor-pointer items-center justify-center rounded-full border-0 bg-white/10 p-0 text-white transition-colors hover:bg-white/20"
        aria-label="关闭"
        title="关闭预览"
        onClick={(e) => {
          e.stopPropagation()
          setSrc(null)
        }}
      >
        <X size={22} />
      </button>

      {/* 大图：点图片本身不关闭，方便细看；从中心轻微放大弹出 */}
      <img
        src={src}
        alt="放大查看"
        onClick={(e) => e.stopPropagation()}
        className="zoom-figure max-h-[90vh] max-w-full cursor-default rounded-lg object-contain shadow-2xl select-none"
      />
    </div>
  )
}
