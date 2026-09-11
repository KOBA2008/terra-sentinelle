import { useEffect, useMemo, useState } from 'react'
import { MapView } from '../components/map/MapView'
import { Badge, Button, GlassPanel } from '../components/glass'
import { VoiceBroadcastCard } from '../components/VoiceBroadcastCard'
import { getDecisions, getRoutes, postDecision } from '../api/client'
import { useResource, useTokens } from '../lib/hooks'
import { geometryBBox, padBBox, type BBox } from '../lib/geo'
import { formatDate, num } from '../lib/format'
import type { Tokens } from '../lib/tokens'
import type { AppData } from '../lib/appData'
import type { Decision, DecisionKind, RouteAlternative } from '../types'

const routeColor = (t: Tokens, id: string) =>
  id === 'ALT-A' ? t.red : id === 'ALT-B' ? t.amber : id === 'ALT-C' ? t.accent : t.dim

const DECISIONS: { id: DecisionKind; label: string; hint: string; variant: 'accent' | 'amber' | 'danger' }[] = [
  { id: 'maintien', label: 'Maintien', hint: 'le tracé historique est conservé', variant: 'accent' },
  { id: 'ajustement', label: 'Ajustement', hint: 'décalage local de l’axe', variant: 'amber' },
  { id: 'contournement', label: 'Contournement', hint: 'itinéraire de remplacement', variant: 'danger' },
]

function RouteCard({
  route,
  active,
  onSelect,
}: {
  route: RouteAlternative
  active: boolean
  onSelect: () => void
}) {
  const t = useTokens()
  const color = routeColor(t, route.id)
  return (
    <button
      onClick={onSelect}
      className={`spring w-full rounded-[20px] border p-3.5 text-left ${
        active ? 'border-line-strong bg-surf-3' : 'border-line bg-surf hover:border-line-strong'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="h-[3px] w-6 rounded-full" style={{ background: color }} />
          <span className="font-mono text-[11.5px] text-ink">{route.id}</span>
        </div>
        <span className="font-mono text-[13px] text-ink">{num(route.distance_km)} km</span>
      </div>
      <div className="mt-1.5 text-[13.5px] font-medium leading-snug text-ink">{route.label}</div>

      <div className="mt-2.5">
        <div className="text-[10px] uppercase tracking-[0.13em] text-dim">Contraintes rencontrées</div>
        <ul className="mt-1 flex flex-col gap-1">
          {route.constraints.map((c) => (
            <li key={c} className="flex gap-1.5 text-[11.5px] leading-snug text-dim">
              <span style={{ color }}>-</span>
              <span>{c}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-2.5">
        <div className="text-[10px] uppercase tracking-[0.13em] text-dim">Données utilisées</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {route.data_used.map((d) => (
            <Badge key={d}>{d}</Badge>
          ))}
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-2 border-t border-line pt-2.5">
        <span
          className="h-[3px] w-6 shrink-0 rounded-full"
          style={{ background: `repeating-linear-gradient(to right, ${color} 0 3px, transparent 3px 6px)` }}
        />
        <span className="text-[11px] leading-snug text-dim">
          {route.uncertain_segments.length} tronçon(s) en pointillés : donnée incomplète ou ancienne
        </span>
      </div>
    </button>
  )
}

export function CommitteeScreen({ data }: { data: AppData }) {
  const { communeId, commune, corridor, friction } = data

  /** Extrémités du calcul : deux points de l'axe de la commune (jamais inter-départemental). */
  const endpoints = useMemo<[[number, number], [number, number]]>(() => {
    const axis = corridor?.features.find((f) => f.properties.kind === 'axis')
    if (axis && axis.geometry.type === 'LineString') {
      const c = axis.geometry.coordinates
      return [c[Math.floor(c.length * 0.2)] ?? c[0], c[Math.floor(c.length * 0.8)] ?? c[c.length - 1]]
    }
    const center = commune?.center ?? [2.438, 11.298]
    return [
      [center[0] - 0.05, center[1] - 0.05],
      [center[0] + 0.05, center[1] + 0.05],
    ]
  }, [corridor, commune])

  const routesRes = useResource(
    () => getRoutes(communeId, endpoints[0], endpoints[1]),
    [communeId, endpoints[0][0], endpoints[1][0]],
  )
  const decisionsRes = useResource(() => getDecisions(communeId), [communeId])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [decision, setDecision] = useState<Decision | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const committee = `Comité communal de transhumance de ${commune?.name ?? '-'}`
  const routes = routesRes.data?.alternatives ?? []
  const segment = routesRes.data?.corridor_segment_id ?? 'SEG-05'

  useEffect(() => {
    if (routes.length && !routes.some((r) => r.id === activeId)) setActiveId(routes[0].id)
  }, [routes, activeId])

  useEffect(() => {
    setDecision(null)
  }, [communeId])

  const focus = useMemo<BBox | null>(() => {
    if (!routes.length) return null
    const b = geometryBBox(routes[0].geometry)
    routes.slice(1).forEach((r) => {
      const o = geometryBBox(r.geometry)
      b[0] = Math.min(b[0], o[0])
      b[1] = Math.min(b[1], o[1])
      b[2] = Math.max(b[2], o[2])
      b[3] = Math.max(b[3], o[3])
    })
    return padBBox(b, 0.25)
  }, [routes])

  const segFrictions = (friction?.features ?? []).filter((f) => f.properties.corridor_segment_id === segment)

  const decide = async (kind: DecisionKind) => {
    setBusy(true)
    try {
      const d = await postDecision({ corridor_segment_id: segment, decision: kind, committee, note })
      setDecision(d)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative h-full w-full">
      <div className="absolute inset-0 hidden lg:block">
        <MapView
          center={commune?.center ?? [2.438, 11.298]}
          bbox={(commune?.bbox ?? [2.2, 11.05, 2.72, 11.55]) as BBox}
          corridor={corridor}
          friction={friction}
          routes={routes}
          activeRouteId={activeId}
          focus={focus}
          visibility={{ villages: false, water_points: false, pastures: false, parcels: false }}
          zoom={10.4}
        />
      </div>

      <div className="h-full w-full overflow-y-auto lg:pointer-events-none">
        <div className="mx-auto w-full max-w-[560px] px-3 pb-[104px] pt-[136px] md:pb-6 md:pt-[124px] lg:pointer-events-auto lg:ml-4 lg:mr-auto lg:max-w-[460px]">
          <GlassPanel className="rounded-[26px] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="font-display text-[19px] font-semibold leading-tight text-ink">
                  Comité communal : tronçon {segment}
                </h1>
                <p className="mt-1 text-[12px] leading-relaxed text-dim">
                  {committee}. Examen d'une portion sensible : {segFrictions.length} détection(s) rattachée(s),
                  trois itinéraires possibles.
                </p>
              </div>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {segFrictions.map((f) => (
                <Badge key={f.properties.id} tone="danger">
                  {f.properties.id} · gravité {f.properties.severity}
                </Badge>
              ))}
              {segFrictions.length === 0 && <Badge>aucune friction rattachée</Badge>}
            </div>
            <p className="mt-2.5 text-[11px] leading-snug text-dim">
              Le calcul reste intra-commune (ou entre communes adjacentes) : aucune grille de coût n'est
              construite sur les cinq départements.
            </p>
          </GlassPanel>

          <div className="mt-3 flex flex-col gap-2">
            {routes.map((r) => (
              <RouteCard key={r.id} route={r} active={activeId === r.id} onSelect={() => setActiveId(r.id)} />
            ))}
            {routesRes.loading && (
              <div className="rounded-[20px] border border-line bg-surf p-4 text-[13px] text-dim">
                Chargement des itinéraires…
              </div>
            )}
          </div>

          <GlassPanel className="mt-3 rounded-[24px] p-4">
            <h2 className="font-display text-[15px] font-semibold text-ink">Décision du comité</h2>
            <p className="mt-1 text-[11.5px] leading-relaxed text-dim">
              La décision est humaine et collégiale. Terra Sentinelle fournit l'état du terrain, il ne choisit pas.
            </p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Motif de la décision, engagements pris…"
              className="field mt-2.5 w-full resize-none px-3 py-2 text-[13px]"
            />
            <div className="mt-2.5 grid grid-cols-3 gap-2">
              {DECISIONS.map((d) => (
                <Button key={d.id} variant={d.variant} disabled={busy} onClick={() => decide(d.id)} title={d.hint}>
                  {d.label}
                </Button>
              ))}
            </div>
            <p className="mt-2.5 font-mono text-[10px] text-dim">POST /decisions · {committee}</p>
          </GlassPanel>

          {decision && (
            <div className="mt-3">
              <VoiceBroadcastCard decision={decision} />
            </div>
          )}

          <div className="mt-3">
            <h2 className="font-display text-[14px] font-semibold text-ink">Décisions déjà prises</h2>
            <ul className="mt-2 flex flex-col gap-1.5">
              {(decisionsRes.data ?? []).map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-2 rounded-[16px] border border-line bg-surf px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-[11.5px] text-ink">
                      {d.id} · {d.corridor_segment_id}
                    </div>
                    <div className="mt-0.5 text-[11px] text-dim">{formatDate(d.decided_on)}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge
                      tone={d.decision === 'maintien' ? 'accent' : d.decision === 'ajustement' ? 'amber' : 'danger'}
                    >
                      {d.decision}
                    </Badge>
                    <button onClick={() => setDecision(d)} className="glass-btn px-2 py-1 text-[10.5px]">
                      message
                    </button>
                  </div>
                </li>
              ))}
              {(decisionsRes.data ?? []).length === 0 && (
                <li className="rounded-[16px] border border-line bg-surf px-3 py-3 text-[12.5px] text-dim">
                  Aucune décision enregistrée pour cette commune.
                </li>
              )}
            </ul>
          </div>

        </div>
      </div>
    </div>
  )
}
