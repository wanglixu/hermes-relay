'use client'

import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'

/** 基础按钮：形状与配色全部走令牌 + 变体，不在用到处写颜色。 */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-ctl transition-colors duration-150 disabled:opacity-45 disabled:cursor-not-allowed',
  {
    variants: {
      variant: {
        solid: 'bg-accent text-on-accent hover:bg-accent/85',
        ghost: 'text-accent-text border border-accent-text/40 hover:bg-accent/12',
        quiet: 'text-ink-2 hover:bg-raised hover:text-ink',
        danger: 'text-danger border border-danger/40 hover:bg-danger/12',
      },
      size: {
        sm: 'h-7 px-2.5 text-xs',
        md: 'h-8 px-3 text-[12.5px]',
        icon: 'size-7 p-0',
      },
    },
    defaultVariants: { variant: 'quiet', size: 'md' },
  },
)

export type ButtonProps = React.ComponentProps<'button'> & VariantProps<typeof buttonVariants>

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
