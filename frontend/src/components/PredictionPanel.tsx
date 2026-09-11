import { Badge, Button, GlassPanel } from './glass'
import { formatDateTime } from '../lib/format'
import type { PredictionCollection } from '../types'

/** Dégradé d'opacité : la même rampe que la couche cartographique. */
const RAMP = [0.02, 0.16, 0.29, 0.42]

interface Props {
  predictions: PredictionCollection | null
  predicting: boolean
  predictedAt: string | null
  visible: boolean
  onToggleVisible: () => void
  onRun: () => void
  communeName: string
  compact?: boolean
  className?: string
}

/** Pastille d'échantillon : hachures (prédiction) ou aplat (validé). */
function Swatch({ hatched }: { hatched: boolean }) {
  return (
    <span
      className="mt-[2px] block h-4 w-6 shrink-0 rounded-[5px] border"
      style={
        hatched
          ? {
              borderStyle: 'dashed',
              borderColor: 'var(--sand-ink)',
              background:
                'repeating-linear-gradient(45deg, color-mix(in srgb, var(--sand-ink) 70%, transparent) 0 2px, transparent 2px 5px)',
            }
          : {
              borderStyle: 'solid',
              borderColor: 'var(--sev-5)',
              background: 'color-mix(in srgb, var(--sev-5) 34%, transparent)',
            }
      }
    />
  )
}

/**
 * Commande et légende de la prédiction.
 * La légende est ici non par décor : une cellule prédite et une friction
 * confirmée par un agent ne sont PAS le même objet, et l'interface doit le dire.
 */
export function PredictionPanel({
  predictions,
  predicting,
  predictedAt,
  visible,
  onToggleVisible,
  onRun,
  communeName,
  compact = false,
  className = '',
}: Props) {
  const cells = predictions?.features ?? []
  const offline = cells.some((f) => f.properties.offline_snapshot)
  const cultivated = cells.filter((f) => f.properties.p_cultivated >= 0.5).length

  return (
    <GlassPanel className={`${compact ? 'rounded-[18px] p-3' : 'w-[252px] rounded-[22px] p-3.5'} ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.14em] text-dim">Prédiction du modèle</div>
        {offline && (
          <Badge tone="amber" title="Aucune API : grille embarquée, non calculée sur l'image">
            hors ligne
          </Badge>
        )}
      </div>

      <Button
        variant="accent"
        full
        onClick={onRun}
        disabled={predicting}
        className="mt-2.5 min-h-[44px]"
        title={`POST /api/commune/.../predict : ${communeName}`}
      >
        {predicting ? 'Inférence en cours…' : 'Lancer la prédiction'}
      </Button>

      <div className="mt-2 font-mono text-[10.5px] leading-relaxed text-dim">
        {cells.length ? (
          <>
            {cells.length} cellules · {cultivated} au-dessus de 0,50
            <br />
            {predictedAt ? formatDateTime(predictedAt) : 'grille chargée'}
          </>
        ) : (
          'aucune cellule calculée'
        )}
      </div>

      {!!cells.length && (
        <button
          onClick={onToggleVisible}
          className="spring mt-2 flex min-h-[44px] w-full items-center justify-between rounded-[12px] border border-line px-2.5 text-left text-[12px] text-ink hover:bg-surf-2"
          aria-pressed={visible}
        >
          <span>Afficher sur la carte</span>
          <span className={visible ? 'text-accent-ink' : 'text-dim'}>{visible ? '●' : '○'}</span>
        </button>
      )}

      <div className="mt-3 border-t border-line pt-2.5">
        <div className="text-[10px] uppercase tracking-[0.14em] text-dim">Deux objets différents</div>
        <ul className="mt-2 flex flex-col gap-2">
          <li className="flex gap-2">
            <Swatch hatched />
            <span className="text-[11.5px] leading-snug text-dim">
              <span className="text-ink">Hachures + pointillés</span> : cellule prédite, non validée localement
            </span>
          </li>
          <li className="flex gap-2">
            <Swatch hatched={false} />
            <span className="text-[11.5px] leading-snug text-dim">
              <span className="text-ink">Aplat plein</span> : friction confirmée par un agent sur le terrain
            </span>
          </li>
        </ul>
      </div>

      <div className="mt-3 border-t border-line pt-2.5">
        <div className="text-[10px] uppercase tracking-[0.14em] text-dim">p(cultivé)</div>
        <div className="mt-2 flex items-center gap-1">
          {RAMP.map((o, i) => (
            <div key={o} className="flex-1">
              <div
                className="h-2.5 rounded-[3px] border border-dashed"
                style={{
                  borderColor: 'var(--sand-ink)',
                  background: `color-mix(in srgb, rgb(var(--sand-rgb)) ${Math.round(o * 100)}%, transparent)`,
                }}
              />
              <div className="mt-1 text-center font-mono text-[9.5px] text-dim">
                {['0', '0,5', '0,75', '1'][i]}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-snug text-dim">
          L'opacité suit la probabilité de mise en culture, pas la gravité.
        </p>
      </div>
    </GlassPanel>
  )
}
