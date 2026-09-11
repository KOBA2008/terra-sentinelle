import { useEffect, useState } from 'react'
import { Badge, Button, GlassPanel } from './glass'
import { ConfidenceMeter } from './ConfidenceMeter'
import { formatAge, formatDate } from '../lib/format'
import { SEVERITY_LABELS, STATUS_COLORS, STATUS_LABELS, severityColor } from '../lib/severity'
import { isUncertain, uncertaintyReason } from '../lib/uncertainty'
import type { Feature, FrictionProps, FrictionStatus } from '../types'

interface Props {
  feature: Feature<FrictionProps>
  agent: string
  busy?: boolean
  onValidate: (status: Exclude<FrictionStatus, 'pending'>, note: string) => void
  onClose?: () => void
  onZoom?: () => void
  compact?: boolean
}

function Field({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-[0.13em] text-dim">{label}</div>
      <div className={`mt-0.5 truncate text-[13px] text-ink ${mono ? 'font-mono' : ''}`} title={value}>
        {value}
      </div>
    </div>
  )
}

/** Fiche de détection : tout ce qui permet de juger la détection, source et statut compris. */
export function DetectionSheet({ feature, agent, busy, onValidate, onClose, onZoom, compact }: Props) {
  const p = feature.properties
  const [note, setNote] = useState('')
  const uncertain = isUncertain(p)

  useEffect(() => {
    setNote('')
  }, [p.id])

  return (
    <GlassPanel className="fade-up flex max-h-full flex-col overflow-hidden rounded-[26px]">
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{
                background: severityColor(p.severity),
                boxShadow: `0 0 14px color-mix(in srgb, ${severityColor(p.severity)} 40%, transparent)`,
              }}
            />
            <span className="font-mono text-[13px] text-ink">{p.id}</span>
          </div>
          <h2 className="mt-1 font-display text-[19px] font-semibold leading-tight text-ink">
            Gravité {p.severity} : {SEVERITY_LABELS[p.severity]}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {onZoom && (
            <button onClick={onZoom} className="glass-btn px-2.5 py-1.5 text-[11px]" title="Centrer la carte">
              Centrer
            </button>
          )}
          {onClose && (
            <button onClick={onClose} className="glass-btn px-2.5 py-1.5 text-[11px]" aria-label="Fermer la fiche">
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge color={STATUS_COLORS[p.status]} dot>
            {STATUS_LABELS[p.status]}
          </Badge>
          <Badge>{p.corridor_segment_id}</Badge>
          <Badge tone="sand">{p.source}</Badge>
          {uncertain && (
            <Badge tone="amber" dot>
              donnée incertaine
            </Badge>
          )}
        </div>

        <div className="mt-4">
          <ConfidenceMeter value={p.confidence} />
        </div>

        {uncertain && (
          <div className="glass-inset mt-3 flex gap-2.5 p-3">
            <span className="mt-[2px] text-amber-ink">◌</span>
            <p className="text-[12px] leading-relaxed text-dim">
              <span className="text-amber-ink">{uncertaintyReason(p)}.</span> Cette zone est tracée en pointillés sur la
              carte tant qu'une observation de terrain n'est pas venue la lever.
            </p>
          </div>
        )}

        <div className={`mt-4 grid gap-3 ${compact ? 'grid-cols-2' : 'grid-cols-2'}`}>
          <Field label="Surface" value={`${p.area_ha} ha`} />
          <Field label="Détectée le" value={`${formatDate(p.detected_on)}`} />
          <Field label="Ancienneté" value={formatAge(p.detected_on)} />
          <Field label="Capteur source" value={p.source} />
          <Field label="Version du modèle" value={p.model_version} />
          <Field label="Tronçon" value={p.corridor_segment_id} />
        </div>

        <p className="mt-4 text-[12.5px] leading-relaxed text-dim">{p.note}</p>

        <label className="mt-4 block">
          <span className="text-[10px] uppercase tracking-[0.13em] text-dim">Observation de l'agent</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Ce qui a été constaté sur place…"
            className="field mt-1.5 w-full resize-none px-3 py-2 text-[13px]"
          />
        </label>
      </div>

      <div className="border-t border-line px-4 py-3">
        <div className="grid grid-cols-3 gap-2">
          <Button variant="accent" disabled={busy} onClick={() => onValidate('confirmed', note)}>
            Confirmer
          </Button>
          <Button variant="amber" disabled={busy} onClick={() => onValidate('corrected', note)}>
            Corriger
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => onValidate('invalidated', note)}>
            Invalider
          </Button>
        </div>
        <p className="mt-2.5 font-mono text-[10px] leading-relaxed text-dim">
          Agent : {agent} · POST /friction/{p.id}/validate
        </p>
      </div>
    </GlassPanel>
  )
}
