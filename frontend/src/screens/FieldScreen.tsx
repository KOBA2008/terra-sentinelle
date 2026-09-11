import { useMemo, useState } from 'react'
import { Badge, Button, GlassPanel } from '../components/glass'
import { DetectionSheet } from '../components/DetectionSheet'
import { postObservations } from '../api/client'
import { clearSynced, getPending, markSynced } from '../lib/offlineQueue'
import { setDemoOffline } from '../lib/network'
import { useDemoOffline, useObservations, useOnline } from '../lib/hooks'
import { formatDate, formatDateTime } from '../lib/format'
import { SEVERITY_LABELS, STATUS_COLORS, STATUS_LABELS, severityColor } from '../lib/severity'
import { isUncertain } from '../lib/uncertainty'
import type { AppData } from '../lib/appData'

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex w-full items-center justify-between gap-3 rounded-[14px] px-1 py-1 text-left"
    >
      <span className="text-[12.5px] text-ink">{label}</span>
      <span
        className="spring relative h-[26px] w-[46px] shrink-0 rounded-full border"
        style={{
          background: on ? 'color-mix(in srgb, var(--amber-ink) 26%, transparent)' : 'var(--surf-2)',
          borderColor: on ? 'color-mix(in srgb, var(--amber-ink) 55%, transparent)' : 'var(--line-strong)',
        }}
      >
        <span
          className="spring absolute top-[2px] h-[20px] w-[20px] rounded-full"
          style={{ left: on ? 22 : 2, background: on ? 'var(--amber-ink)' : 'rgb(var(--dim-rgb))' }}
        />
      </span>
    </button>
  )
}

export function FieldScreen({ data }: { data: AppData }) {
  const { commune, friction, validate, busyId, agent } = data
  const online = useOnline()
  const demoOffline = useDemoOffline()
  const observations = useObservations()
  const [openId, setOpenId] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  const queue = useMemo(
    () =>
      (friction?.features ?? [])
        .filter((f) => f.properties.status === 'pending')
        .sort((a, b) => b.properties.severity - a.properties.severity),
    [friction],
  )

  const pending = observations.filter((o) => !o.synced)
  const open = friction?.features.find((f) => f.properties.id === openId) ?? null

  const sync = async () => {
    const batch = getPending()
    if (!batch.length || !online) return
    setSyncing(true)
    setSyncMsg(null)
    try {
      const res = await postObservations(batch)
      markSynced(batch.map((o) => o.id))
      setSyncMsg(`${res.accepted} observation(s) transmises · ${formatDateTime(res.synced_at)}`)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[430px] px-3 pb-[104px] pt-[136px] md:pb-8 md:pt-[124px]">
        <h1 className="font-display text-[21px] font-semibold leading-tight text-ink">Mode terrain</h1>
        <p className="mt-1 text-[12.5px] leading-relaxed text-dim">
          {agent}, agent d'élevage : mairie de {commune?.name ?? 'la commune'}
          {commune?.department ? ` (${commune.department})` : ''}. Les vérifications faites hors réseau sont
          conservées sur l'appareil puis rejouées à la reconnexion.
        </p>

        {/* État réseau */}
        <GlassPanel className="mt-3 rounded-[22px] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{
                  background: online ? 'var(--accent-ink)' : 'var(--amber-ink)',
                  boxShadow: `0 0 12px color-mix(in srgb, ${
                    online ? 'var(--accent-ink)' : 'var(--amber-ink)'
                  } 40%, transparent)`,
                }}
              />
              <span className="text-[13px] font-medium text-ink">{online ? 'Réseau disponible' : 'Hors connexion'}</span>
            </div>
            <Badge tone={pending.length ? 'amber' : 'neutral'}>
              <span className="font-mono">{pending.length}</span> en attente
            </Badge>
          </div>
          <p className="mt-1.5 text-[11.5px] leading-snug text-dim">
            File locale : <span className="font-mono">localStorage</span> ·{' '}
            <span className="font-mono">{observations.length}</span> enregistrement(s) conservé(s).
          </p>
          <div className="mt-2.5 border-t border-line pt-2.5">
            <Switch on={demoOffline} onChange={setDemoOffline} label="Simuler la perte de réseau (démo)" />
          </div>
          <div className="mt-2.5 flex gap-2">
            <Button variant="accent" full disabled={!online || !pending.length || syncing} onClick={sync}>
              {syncing ? 'Synchronisation…' : `Synchroniser (${pending.length})`}
            </Button>
            {observations.some((o) => o.synced) && (
              <Button variant="ghost" onClick={clearSynced} title="Vider les enregistrements déjà transmis">
                Purger
              </Button>
            )}
          </div>
          {syncMsg && <p className="mt-2 font-mono text-[10.5px] text-accent-ink">{syncMsg}</p>}
          {!online && pending.length > 0 && (
            <p className="mt-2 text-[11px] leading-snug text-amber-ink">
              {pending.length} observation(s) seront transmises dès le retour du réseau.
            </p>
          )}
        </GlassPanel>

        {/* Fiche ouverte */}
        {open && (
          <div className="mt-3">
            <DetectionSheet
              feature={open}
              agent={agent}
              compact
              busy={busyId === open.properties.id}
              onValidate={(status, note) => {
                void validate(open.properties.id, status, note)
                setOpenId(null)
              }}
              onClose={() => setOpenId(null)}
            />
          </div>
        )}

        {/* File d'attente */}
        <div className="mt-4 flex items-baseline justify-between">
          <h2 className="font-display text-[14px] font-semibold text-ink">À vérifier sur place</h2>
          <span className="font-mono text-[12px] text-dim">{queue.length}</span>
        </div>
        <ul className="mt-2 flex flex-col gap-2">
          {queue.map((f) => {
            const p = f.properties
            return (
              <li key={p.id}>
                <button
                  onClick={() => setOpenId(p.id === openId ? null : p.id)}
                  className="spring w-full rounded-[20px] border border-line bg-surf p-3.5 text-left hover:border-line-strong hover:bg-surf-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[12px] text-ink">{p.id}</span>
                    <Badge color={severityColor(p.severity)} dot>
                      Gravité {p.severity}
                    </Badge>
                  </div>
                  <div className="mt-1.5 text-[13.5px] font-medium leading-snug text-ink">
                    {SEVERITY_LABELS[p.severity]} · {p.area_ha} ha · {p.corridor_segment_id}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-dim">{p.note}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge>{p.source}</Badge>
                    <Badge>{formatDate(p.detected_on)}</Badge>
                    {isUncertain(p) && (
                      <Badge tone="amber" dot>
                        incertain
                      </Badge>
                    )}
                  </div>
                </button>
              </li>
            )
          })}
          {queue.length === 0 && (
            <li className="rounded-[20px] border border-line bg-surf p-4 text-[13px] text-dim">
              Aucune détection en attente : la tournée est à jour.
            </li>
          )}
        </ul>

        {/* Journal */}
        <h2 className="mt-5 font-display text-[14px] font-semibold text-ink">Journal des observations</h2>
        <ul className="mt-2 flex flex-col gap-1.5">
          {observations.map((o) => (
            <li
              key={o.id}
              className="flex items-center justify-between gap-2 rounded-[16px] border border-line bg-surf px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="font-mono text-[11.5px] text-ink">{o.friction_id}</div>
                <div className="mt-0.5 font-mono text-[10px] text-dim">{formatDateTime(o.recorded_at)}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Badge color={STATUS_COLORS[o.status]}>{STATUS_LABELS[o.status]}</Badge>
                <Badge tone={o.synced ? 'accent' : 'amber'} dot>
                  {o.synced ? 'transmis' : o.offline ? 'hors ligne' : 'en attente'}
                </Badge>
              </div>
            </li>
          ))}
          {observations.length === 0 && (
            <li className="rounded-[16px] border border-line bg-surf px-3 py-3 text-[12.5px] text-dim">
              Aucune observation enregistrée sur cet appareil.
            </li>
          )}
        </ul>

        <p className="mt-5 font-mono text-[10px] leading-relaxed text-dim">
          POST /observations?commune={data.communeId} · batch rejoué à la reconnexion
        </p>
      </div>
    </div>
  )
}
