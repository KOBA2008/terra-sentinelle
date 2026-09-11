import { pct } from '../lib/format'
import { LOW_CONFIDENCE } from '../lib/uncertainty'

/** Barre de confiance : le seuil d'incertitude est matérialisé, il ne se cache pas. */
export function ConfidenceMeter({ value, label = 'Confiance' }: { value: number; label?: string }) {
  const low = value < LOW_CONFIDENCE
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-[0.12em] text-dim">{label}</span>
        <span className={`font-mono text-[13px] font-medium ${low ? 'text-amber-ink' : 'text-ink'}`}>
          {pct(value)}
        </span>
      </div>
      <div className="relative h-[6px] overflow-hidden rounded-full bg-surf-2">
        <div
          className="spring h-full rounded-full"
          style={{ width: `${Math.round(value * 100)}%`, background: low ? 'var(--amber-ink)' : 'var(--accent-ink)' }}
        />
        <div
          className="absolute top-0 h-full w-px bg-ink/40"
          style={{ left: `${LOW_CONFIDENCE * 100}%` }}
          title={`Seuil d'incertitude : ${pct(LOW_CONFIDENCE)}`}
        />
      </div>
    </div>
  )
}
