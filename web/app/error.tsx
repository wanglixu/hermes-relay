'use client'

import { AlertTriangle, RotateCw } from 'lucide-react'

/** 页面渲染出错时的兜底：没有这个文件，任何一次组件抛异常都是整页白屏。
 *  这里只给一句人话 + 一个重试按钮（reset 会重新挂载这一段），不做自动上报。 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-page px-6 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-danger/10 text-danger">
        <AlertTriangle size={20} />
      </span>
      <div>
        <h2 className="m-0 font-title text-[15px] font-semibold text-ink">界面渲染出错了</h2>
        <p className="mt-1.5 mb-0 max-w-[420px] text-[12.5px] leading-[1.6] text-muted">
          页面自己崩了，会话记录没有丢，重新加载一次通常就好。一直不行的话把下面这行发给我：
        </p>
        <code className="mt-2 block rounded-md border border-line bg-raised px-2.5 py-1.5 font-mono text-[11px] break-all text-ink-2">
          {error?.message || '未知错误'}
        </code>
      </div>
      <button
        type="button"
        onClick={reset}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-line-strong bg-panel px-3 py-1.5 text-[12.5px] text-ink transition-colors hover:border-accent-text hover:text-accent-text"
      >
        <RotateCw size={13} /> 重新加载
      </button>
    </div>
  )
}
