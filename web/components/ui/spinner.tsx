import { cn } from '@/lib/cn'

/** 三个点：生成中的等待指示（关键帧在 globals.css 的 @theme 里） */
export function Dots({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)} aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <i
          key={i}
          className="size-[5px] rounded-full bg-accent-text animate-dot"
          style={{ animationDelay: `${i * 0.16}s` }}
        />
      ))}
    </span>
  )
}
