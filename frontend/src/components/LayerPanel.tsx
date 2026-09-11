import { GlassPanel } from './glass'
import { SEVERITY_COLORS, SEVERITY_LABELS } from '../lib/severity'
import type { LayerVisibility } from './map/MapView'

/** Les pastilles reprennent les variables de thème utilisées par la carte. */
const TOGGLES: { key: keyof LayerVisibility; label: string; swatch: string; dashed?: boolean }[] = [
  { key: 'corridor', label: 'Couloir + emprise', swatch: 'var(--map-axis)' },
  { key: 'friction', label: 'Zones de friction', swatch: 'var(--sev-5)' },
  { key: 'predictions', label: 'Prédiction du modèle', swatch: 'rgb(var(--sand-rgb))', dashed: true },
  { key: 'villages', label: 'Villages', swatch: 'var(--map-node)' },
  { key: 'water_points', label: "Points d'eau", swatch: 'rgb(var(--water-rgb))' },
  { key: 'pastures', label: 'Zones de pâturage', swatch: 'rgb(var(--accent-rgb))', dashed: true },
  { key: 'parcels', label: 'Parcelles détectées', swatch: 'rgb(var(--sand-rgb))' },
]

interface Props {
  visibility: LayerVisibility
  onToggle: (key: keyof LayerVisibility) => void
  basemap: boolean | null
  className?: string
}

export function LayerPanel({ visibility, onToggle, basemap, className = '' }: Props) {
  return (
    <GlassPanel className={`w-[228px] rounded-[22px] p-3.5 ${className}`}>
      <div className="text-[10px] uppercase tracking-[0.14em] text-dim">Couches</div>
      <ul className="mt-2 flex flex-col gap-0.5">
        {TOGGLES.map((t) => (
          <li key={t.key}>
            <button
              onClick={() => onToggle(t.key)}
              className="spring flex w-full items-center gap-2.5 rounded-[11px] px-1.5 py-1.5 text-left hover:bg-surf-2"
              aria-pressed={visibility[t.key]}
            >
              <span
                className="h-[3px] w-4 shrink-0 rounded-full"
                style={{
                  background: t.dashed
                    ? `repeating-linear-gradient(to right, ${t.swatch} 0 3px, transparent 3px 6px)`
                    : t.swatch,
                  opacity: visibility[t.key] ? 1 : 0.25,
                }}
              />
              <span className={`flex-1 text-[12px] ${visibility[t.key] ? 'text-ink' : 'text-dim/70'}`}>{t.label}</span>
              <span className={`text-[10px] ${visibility[t.key] ? 'text-accent-ink' : 'text-dim/60'}`}>
                {visibility[t.key] ? '●' : '○'}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 border-t border-line pt-3">
        <div className="text-[10px] uppercase tracking-[0.14em] text-dim">Gravité</div>
        <div className="mt-2 flex items-center gap-1">
          {([1, 2, 3, 4, 5] as const).map((s) => (
            <div key={s} className="flex-1" title={`${s} : ${SEVERITY_LABELS[s]}`}>
              <div className="h-1.5 rounded-full" style={{ background: SEVERITY_COLORS[s] }} />
              <div className="mt-1 text-center font-mono text-[9.5px] text-dim">{s}</div>
            </div>
          ))}
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <span
            className="h-[3px] w-4 shrink-0 rounded-full"
            style={{
              background: 'repeating-linear-gradient(to right, var(--amber-ink) 0 3px, transparent 3px 6px)',
            }}
          />
          <span className="text-[11px] leading-tight text-dim">Pointillés : donnée ancienne ou peu fiable</span>
        </div>
      </div>

      <div className="mt-3 border-t border-line pt-2.5 font-mono text-[9.5px] leading-relaxed text-dim">
        {basemap === false
          ? 'Fond de carte : secours local (aucune tuile réseau)'
          : basemap === true
            ? 'Fond : OpenFreeMap · OpenStreetMap'
            : 'Fond de carte : résolution…'}
      </div>
    </GlassPanel>
  )
}
