import { Badge } from './glass'
import { formatAge, formatDate } from '../lib/format'
import { SEVERITY_LABELS, STATUS_COLORS, STATUS_LABELS, severityColor } from '../lib/severity'
import { isUncertain, uncertaintyReason } from '../lib/uncertainty'
import type { Feature, FrictionProps } from '../types'

interface Props {
  features: Feature<FrictionProps>[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function FrictionList({ features, selectedId, onSelect }: Props) {
  return (
    <ul className="flex flex-col gap-2">
      {features.map((f) => {
        const p = f.properties
        const uncertain = isUncertain(p)
        const active = selectedId === p.id
        return (
          <li key={p.id}>
            <button
              onClick={() => onSelect(p.id)}
              className={`spring w-full rounded-[18px] border p-3 text-left ${
                active
                  ? 'border-line-strong bg-surf-3'
                  : 'border-line bg-surf hover:border-line-strong hover:bg-surf-2'
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  className="mt-[3px] h-9 w-[3px] shrink-0 rounded-full"
                  style={{
                    background: severityColor(p.severity),
                    opacity: p.status === 'invalidated' ? 0.35 : 1,
                    ...(uncertain
                      ? {
                          background: `repeating-linear-gradient(to bottom, ${severityColor(p.severity)} 0 4px, transparent 4px 7px)`,
                        }
                      : {}),
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-[12px] text-ink">{p.id}</span>
                    <span className="font-mono text-[11px] text-dim">{p.area_ha} ha</span>
                  </div>
                  <div className="mt-0.5 text-[13px] font-medium text-ink">
                    Gravité {p.severity} · {SEVERITY_LABELS[p.severity]}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge color={STATUS_COLORS[p.status]}>{STATUS_LABELS[p.status]}</Badge>
                    <Badge>{p.corridor_segment_id}</Badge>
                    {uncertain && (
                      <Badge tone="amber" title={uncertaintyReason(p) ?? undefined}>
                        incertain
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1.5 font-mono text-[10.5px] text-dim">
                    {p.source} · {formatDate(p.detected_on)} · {formatAge(p.detected_on)}
                  </div>
                </div>
              </div>
            </button>
          </li>
        )
      })}
      {features.length === 0 && (
        <li className="rounded-[18px] border border-line bg-surf p-4 text-[13px] text-dim">
          Aucune zone de friction pour ce filtre.
        </li>
      )}
    </ul>
  )
}
