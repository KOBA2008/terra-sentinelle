import { Badge, GlassPanel } from './glass'
import { ConfidenceMeter } from './ConfidenceMeter'
import { pct } from '../lib/format'
import type { Feature, PredictionProps } from '../types'

const CULTIVATED = ['AnnualCrop', 'PermanentCrop']

interface Props {
  feature: Feature<PredictionProps>
  onClose?: () => void
  onZoom?: () => void
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-[0.13em] text-dim">{label}</div>
      <div className="mt-0.5 truncate font-mono text-[13px] text-ink" title={value}>
        {value}
      </div>
    </div>
  )
}

/**
 * Fiche d'une cellule PRÉDITE. Volontairement dépourvue de boutons de
 * validation : ce n'est pas une détection confirmée, c'est une sortie de
 * modèle que l'agent doit encore aller vérifier.
 */
export function PredictionSheet({ feature, onClose, onZoom }: Props) {
  const p = feature.properties
  const cultivated = p.p_cultivated >= 0.5
  const known = CULTIVATED.includes(p.predicted_class)

  return (
    <GlassPanel className="fade-up flex max-h-full flex-col overflow-hidden rounded-[26px]">
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-3 w-4 shrink-0 rounded-[3px] border border-dashed"
              style={{
                borderColor: 'var(--sand-ink)',
                background:
                  'repeating-linear-gradient(45deg, color-mix(in srgb, var(--sand-ink) 70%, transparent) 0 2px, transparent 2px 5px)',
              }}
            />
            <span className="truncate font-mono text-[12.5px] text-ink">{p.id}</span>
          </div>
          <h2 className="mt-1 font-display text-[17px] font-semibold leading-tight text-ink sm:text-[19px]">
            Cellule prédite : {cultivated ? 'mise en culture probable' : 'non cultivée'}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {onZoom && (
            <button
              onClick={onZoom}
              className="glass-btn grid h-11 min-w-[44px] place-items-center px-2.5 text-[11px]"
              title="Centrer la carte"
            >
              Centrer
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="glass-btn grid h-11 w-11 place-items-center text-[13px]"
              aria-label="Fermer la fiche"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="amber" dot>
            non validée localement
          </Badge>
          <Badge tone="sand">sortie de modèle</Badge>
          {p.offline_snapshot && <Badge tone="neutral">instantané hors ligne</Badge>}
        </div>

        <div className="glass-inset mt-3 p-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] uppercase tracking-[0.12em] text-dim">p(cultivé)</span>
            <span className="font-mono text-[24px] leading-none text-ink">
              {p.p_cultivated.toFixed(3)}
            </span>
          </div>
          <div className="mt-2 h-[6px] overflow-hidden rounded-full bg-surf-2">
            <div
              className="spring h-full rounded-full"
              style={{
                width: `${Math.round(p.p_cultivated * 100)}%`,
                background: 'var(--sand-ink)',
              }}
            />
          </div>
        </div>

        <div className="mt-3">
          <ConfidenceMeter value={p.confidence} label="Confiance du classifieur" />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="Classe prédite" value={p.predicted_class} />
          <Field label="Décision binaire" value={cultivated ? 'cultivé' : 'non cultivé'} />
          <Field label="Tuile" value={`${p.tile.z}/${p.tile.x}/${p.tile.y}`} />
          <Field label="Probabilité" value={pct(p.p_cultivated)} />
        </div>

        <div className="glass-inset mt-4 flex gap-2.5 p-3">
          <span aria-hidden className="mt-[2px] text-amber-ink">
            ◌
          </span>
          <p className="text-[12px] leading-relaxed text-dim">
            <span className="text-amber-ink">Cette cellule n'est pas validée localement.</span> Le classifieur a
            été entraîné sur de l'imagerie européenne (EuroSAT) : sa sortie sur le Bénin est une hypothèse à
            vérifier, pas une friction confirmée. Seul le passage de l'agent communal la transforme en détection
            validée.
            {known ? '' : " La classe prédite n'appartient pas aux classes cultivées."}
          </p>
        </div>
      </div>

      <div className="border-t border-line px-4 py-3">
        <p className="font-mono text-[10px] leading-relaxed text-dim">
          GET /api/commune/…/predictions · source {p.source}
          {p.model_version ? ` · ${p.model_version}` : ''}
        </p>
      </div>
    </GlassPanel>
  )
}
