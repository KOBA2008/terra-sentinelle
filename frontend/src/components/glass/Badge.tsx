import type { ReactNode } from 'react'

export type Tone = 'neutral' | 'accent' | 'amber' | 'danger' | 'sand' | 'water'

/** Chaque ton pointe vers une variable CSS : la pastille suit le thème. */
const TONE_COLORS: Record<Tone, string> = {
  neutral: 'rgb(var(--dim-rgb))',
  accent: 'var(--accent-ink)',
  amber: 'var(--amber-ink)',
  danger: 'var(--red-ink)',
  sand: 'var(--sand-ink)',
  water: 'rgb(var(--water-rgb))',
}

interface Props {
  children: ReactNode
  /** Ton sémantique (préféré). */
  tone?: Tone
  /** Couleur explicite issue du thème : ex. severityColor() qui renvoie var(--sev-N). */
  color?: string
  className?: string
  dot?: boolean
  title?: string
}

/** Pastille discrète : statut, source, origine des données. */
export function Badge({ children, tone = 'neutral', color, className = '', dot = false, title }: Props) {
  const c = color ?? TONE_COLORS[tone]
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11px] font-medium leading-none ${className}`}
      style={{
        color: c,
        borderColor: `color-mix(in srgb, ${c} 38%, transparent)`,
        background: `color-mix(in srgb, ${c} 11%, transparent)`,
      }}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />}
      {children}
    </span>
  )
}
