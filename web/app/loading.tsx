import { Dots } from '@/components/ui/spinner'

/** 首屏加载时的占位：不写这个文件，切页 / 首屏就是一块纯空白，看不出是在加载还是坏了。 */
export default function Loading() {
  return (
    <div className="flex min-h-dvh items-center justify-center gap-2 bg-page text-muted">
      <Dots />
      <span className="text-[12.5px]">加载中…</span>
    </div>
  )
}
