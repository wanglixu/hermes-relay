import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-ctl font-mono text-[10.5px] leading-none',
  {
    variants: {
      tone: {
        muted: 'text-muted',
        accent: 'text-accent-text',
        think: 'text-think',
        danger: 'text-danger',
      },
    },
    defaultVariants: { tone: 'muted' },
  },
)

export function Badge({
  className,
  tone,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />
}
