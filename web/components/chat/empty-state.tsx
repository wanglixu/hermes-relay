'use client'

import { RotateCw } from 'lucide-react'

/** 空会话时的欢迎区：标题 + 快捷建议 + 「换一批」。
 *  从 app/page.tsx 搬出来（2026-10-19），那一个文件七百多行，
 *  这块只有三个输入（建议列表、点一条、换一批），搬走不影响聊天逻辑。
 */
export function EmptyState({
  suggestions,
  onPick,
  onShuffle,
}: {
  suggestions: string[]
  onPick: (prompt: string) => void
  onShuffle: () => void
}) {
  return (
                <div className="flex flex-1 flex-col items-center justify-center py-16 text-center select-none">
                  <div className="mb-3.5 grid size-11 place-items-center rounded-2xl border border-line bg-panel shadow-[0_2px_8px_rgba(45,45,42,0.04)]">
                    <span className="font-title text-[18px] font-semibold text-accent-text">R</span>
                  </div>
                  <h2 className="font-title text-[17px] font-medium tracking-tight text-ink">
                    随时告诉我你的想法
                  </h2>
                  <p className="mt-1.5 max-w-[420px] font-read text-[13.5px] leading-relaxed text-muted">
                    提问、分析代码、检索资料，或输入 <span className="font-mono text-[12.5px] text-accent-text">/</span> 查看可用技能
                  </p>
                  <div className="mt-6 flex flex-col items-center gap-3">
                    <div className="flex flex-wrap items-center justify-center gap-2 max-w-[680px]">
                      {suggestions.map((prompt) => (
                        <button
                          key={prompt}
                          type="button"
                          onClick={() => onPick(prompt)}
                          className="cursor-pointer rounded-full border border-line-strong/60 bg-input px-3.5 py-1.5 font-ui text-[12px] text-ink-2 shadow-[0_1px_2px_rgba(45,45,42,0.03)] transition-all hover:border-accent/50 hover:bg-raised hover:text-ink active:scale-[0.99]"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      title="换一批建议"
                      onClick={onShuffle}
                      className="group inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line/70 bg-page/80 px-3 py-1 font-ui text-[11.5px] text-muted shadow-[0_1px_2px_rgba(45,45,42,0.02)] transition-all hover:border-accent/40 hover:bg-raised hover:text-ink active:scale-[0.98]"
                    >
                      <RotateCw className="size-3 text-muted/80 transition-transform duration-300 group-hover:rotate-180 group-active:rotate-360 group-hover:text-accent-text" />
                      <span>换一批</span>
                    </button>
                  </div>
                </div>
  )
}
