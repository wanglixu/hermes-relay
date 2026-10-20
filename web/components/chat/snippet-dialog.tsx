'use client'

import { Trash2, X } from 'lucide-react'
import { formatBytes, type PastedSnippet } from '@/lib/composer-draft'

/** 粘贴进来的长文本的查看 / 编辑弹窗。原来写在 composer.tsx 的 JSX 里，拆出来让那边短一截。 */
export function SnippetDialog({
  snippet,
  onChange,
  onDelete,
  onClose,
}: {
  snippet: PastedSnippet | null
  onChange: (next: PastedSnippet) => void
  onDelete: () => void
  onClose: () => void
}) {
  if (!snippet) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in-0 duration-150"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[85vh] w-full max-w-[680px] flex-col rounded-2xl border border-line-strong bg-raised shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题栏 */}
        <div className="flex items-start justify-between border-b border-line px-5 pt-4 pb-3">
          <div>
            <h3 className="font-ui text-[17px] font-semibold text-ink">已粘贴的内容</h3>
            <p className="mt-0.5 font-ui text-[12px] text-muted">
              {formatBytes(snippet.bytes)} · {snippet.lines} 行 · 格式可能与原始来源不一致
            </p>
          </div>
          <button
            type="button"
            className="cursor-pointer rounded-lg p-1.5 text-muted transition-colors hover:bg-panel hover:text-ink"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>

        {/* 内容编辑区 */}
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <textarea
            value={snippet.content}
            onChange={(e) => {
              const val = e.target.value
              onChange({
                ...snippet,
                content: val,
                lines: val.split(/\r?\n/).length,
                bytes: new Blob([val]).size,
              })
            }}
            className="max-h-[52vh] min-h-[280px] w-full flex-1 resize-none overflow-y-auto rounded-xl border border-line bg-panel p-3.5 font-mono text-[13px] leading-[1.6] text-ink focus:border-accent-text focus:outline-none"
            placeholder="粘贴的长文本内容..."
            spellCheck={false}
          />
        </div>

        {/* 底部按钮栏 */}
        <div className="flex items-center justify-between rounded-b-2xl border-t border-line bg-panel/30 px-5 py-3">
          <button
            type="button"
            className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-muted transition-colors hover:text-danger"
            onClick={onDelete}
          >
            <Trash2 size={13} />
            <span>删除该内容</span>
          </button>
          <button
            type="button"
            className="cursor-pointer rounded-ctl bg-accent px-4 py-1.5 text-[13px] font-medium text-on-accent transition-colors hover:bg-[color-mix(in_srgb,var(--color-accent)_86%,#ffffff)]"
            onClick={onClose}
          >
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
