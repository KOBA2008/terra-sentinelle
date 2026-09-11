export const HONESTY_TEXT =
  'Démonstration : données synthétiques, emprise de couloir reconstituée (non officielle)'

export const REFUSAL_TEXT =
  'Terra Sentinelle ne prédit pas les conflits et ne délivre aucune autorisation de passage.'

/** Mention d'honnêteté affichée en permanence, dans les deux thèmes, sur toutes les vues. */
export function HonestyBar({ className = '' }: { className?: string }) {
  return (
    <div
      title={HONESTY_TEXT}
      className={`glass flex max-w-full items-center gap-1.5 rounded-full !border-amber/40 px-2.5 py-1 text-[11px] font-medium leading-none text-amber-ink ${className}`}
      style={{ background: 'color-mix(in srgb, var(--amber-ink) 12%, var(--glass))' }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
      <span className="hidden truncate lg:inline">{HONESTY_TEXT}</span>
      <span className="truncate lg:hidden">Démonstration : données synthétiques</span>
    </div>
  )
}
