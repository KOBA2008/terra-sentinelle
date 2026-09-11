import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'neutral' | 'accent' | 'amber' | 'danger' | 'ghost'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  variant?: Variant
  full?: boolean
}

const VARIANTS: Record<Variant, string> = {
  neutral: 'glass-btn',
  accent: 'glass-btn !border-accent/45 text-accent-ink hover:!bg-accent/15',
  amber: 'glass-btn !border-amber/45 text-amber-ink hover:!bg-amber/15',
  danger: 'glass-btn !border-danger/45 text-red-ink hover:!bg-danger/15',
  ghost: 'border border-transparent text-dim hover:text-ink hover:bg-surf-2 rounded-[14px]',
}

export function Button({ children, variant = 'neutral', full, className = '', ...rest }: Props) {
  return (
    <button
      className={`px-3.5 py-2 text-[13px] font-medium ${VARIANTS[variant]} ${full ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
