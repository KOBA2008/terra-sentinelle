import type { HTMLAttributes, ReactNode } from 'react'

interface Props extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  /** Variante visuelle : panneau flottant, surface douce, ou creux. */
  tone?: 'panel' | 'soft' | 'inset'
  className?: string
}

const TONES = {
  panel: 'glass',
  soft: 'glass-soft',
  inset: 'glass-inset',
} as const

export function GlassPanel({ children, tone = 'panel', className = '', ...rest }: Props) {
  return (
    <div className={`${TONES[tone]} ${className}`} {...rest}>
      {children}
    </div>
  )
}
