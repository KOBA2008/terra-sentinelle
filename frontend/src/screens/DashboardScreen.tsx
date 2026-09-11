import { useMemo } from 'react'
import { Badge, GlassPanel } from '../components/glass'
import { formatDate, int, num, pct } from '../lib/format'
import { SEVERITY_COLORS, SEVERITY_LABELS } from '../lib/severity'
import type { AppData } from '../lib/appData'
import type { Severity } from '../types'

function Metric({
  label,
  value,
  unit,
  color = 'rgb(var(--text-rgb))',
  hint,
  badge,
}: {
  label: string
  value: string
  unit?: string
  color?: string
  hint?: string
  badge?: string
}) {
  return (
    <GlassPanel className="rounded-[22px] p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.14em] text-dim">{label}</div>
        {badge && <Badge tone="amber">{badge}</Badge>}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="font-mono text-[30px] font-medium leading-none tracking-tight" style={{ color }}>
          {value}
        </span>
        {unit && <span className="font-mono text-[12px] text-dim">{unit}</span>}
      </div>
      {hint && <div className="mt-1.5 text-[11.5px] leading-snug text-dim">{hint}</div>}
    </GlassPanel>
  )
}

export function DashboardScreen({ data }: { data: AppData }) {
  const { stats, friction, corridor, commune } = data

  const live = useMemo(() => {
    const feats = friction?.features ?? []
    const by = (s: string) => feats.filter((f) => f.properties.status === s).length
    const bySeverity = ([1, 2, 3, 4, 5] as Severity[]).map((s) => ({
      s,
      n: feats.filter((f) => f.properties.severity === s).length,
    }))
    return {
      total: feats.length,
      confirmed: by('confirmed'),
      pending: by('pending'),
      invalidated: by('invalidated'),
      corrected: by('corrected'),
      area: feats.reduce((a, f) => a + f.properties.area_ha, 0),
      bySeverity,
      max: Math.max(1, ...bySeverity.map((b) => b.n)),
    }
  }, [friction])

  const km =
    stats?.km_corridor ??
    (corridor?.features.find((f) => f.properties.kind === 'axis')?.properties.length_km ?? 0)

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1060px] px-3 pb-[104px] pt-[136px] md:px-6 md:pb-10 md:pt-[124px]">
        <h1 className="font-display text-[22px] font-semibold leading-tight text-ink">Tableau de bord</h1>
        <p className="mt-1 max-w-[62ch] text-[12.5px] leading-relaxed text-dim">
          Situation du couloir de {commune?.name ?? 'la commune'}
          {commune?.department ? ` (${commune.department})` : ''}, saison 2026. Les chiffres de détection évoluent
          avec les validations faites depuis le mode terrain.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Metric label="Couloir suivi" value={num(km)} unit="km" hint="Emprise reconstituée, non officielle" />
          <Metric label="Frictions détectées" value={int(live.total)} hint={`${num(live.area)} ha cumulés`} />
          <Metric
            label="Confirmées terrain"
            value={int(live.confirmed)}
            color="var(--red-ink)"
            hint="Vérifiées par l'agent communal"
          />
          <Metric
            label="En attente"
            value={int(live.pending)}
            color="var(--amber-ink)"
            hint="À vérifier avant la saison"
          />
        </div>

        <div className="mt-2.5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Metric
            label="Corrigées"
            value={int(live.corrected)}
            color="var(--sand-ink)"
            hint="Emprise ajustée sur le terrain"
          />
          <Metric
            label="Invalidées"
            value={int(live.invalidated)}
            color="rgb(var(--dim-rgb))"
            hint="Détection écartée après contrôle"
          />
          <Metric
            label="Dernier passage satellite"
            value={stats ? formatDate(stats.last_pass.date) : '-'}
            hint={stats ? `${stats.last_pass.sensor} · ${stats.last_pass.cloud_pct} % de nuages` : undefined}
          />
          <Metric
            label="Taux de couverture nuageuse"
            value={stats ? String(stats.last_pass.cloud_pct) : '-'}
            unit="%"
            color="var(--amber-ink)"
            hint="Saison des pluies : relais par Sentinel-1"
          />
        </div>

        <div className="mt-3 grid gap-2.5 lg:grid-cols-[1.1fr_1fr]">
          <GlassPanel className="rounded-[24px] p-4">
            <h2 className="font-display text-[15px] font-semibold text-ink">Répartition par gravité</h2>
            <ul className="mt-3 flex flex-col gap-2.5">
              {live.bySeverity.map(({ s, n }) => (
                <li key={s} className="flex items-center gap-3">
                  <span className="w-[92px] shrink-0 text-[11.5px] text-dim">
                    <span className="font-mono text-ink">{s}</span> · {SEVERITY_LABELS[s]}
                  </span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-surf-2">
                    <span
                      className="spring block h-full rounded-full"
                      style={{ width: `${(n / live.max) * 100}%`, background: SEVERITY_COLORS[s] }}
                    />
                  </span>
                  <span className="w-6 shrink-0 text-right font-mono text-[12px] text-ink">{n}</span>
                </li>
              ))}
            </ul>
          </GlassPanel>

          <GlassPanel className="rounded-[24px] p-4">
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-display text-[15px] font-semibold text-ink">Métriques du modèle</h2>
              <Badge tone="amber">entraîné sur l'Europe</Badge>
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-dim">
              Métriques réelles, mesurées sur le jeu de test EuroSAT tenu à l'écart (imagerie Sentinel-2
              européenne). Elles ne décrivent pas la performance au Bénin : toute prédiction béninoise est une
              sortie de modèle non validée localement, à vérifier sur le terrain.
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {(
                [
                  ['F1', stats?.model.f1],
                  ['Précision', stats?.model.precision],
                  ['Rappel', stats?.model.recall],
                ] as [string, number | undefined][]
              ).map(([label, v]) => (
                <div key={label} className="glass-inset p-3">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-dim">{label}</div>
                  <div className="mt-1 font-mono text-[22px] leading-none text-ink">
                    {v === undefined ? '-' : v.toFixed(2)}
                  </div>
                  <div className="mt-1 font-mono text-[9px] text-amber-ink">démo</div>
                </div>
              ))}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-y-2 border-t border-line pt-3 text-[11.5px]">
              <dt className="text-dim">Modèle</dt>
              <dd className="text-right font-mono text-ink">{stats?.model.name ?? 'ts-crop-s2-v0.4-demo'}</dd>
              <dt className="text-dim">Évalué le</dt>
              <dd
                className="truncate text-right font-mono text-ink"
                title={stats?.model.tested_on ?? undefined}
              >
                {stats ? formatDate(stats.model.tested_on) : '-'}
              </dd>
              <dt className="text-dim">Part de détections incertaines</dt>
              <dd className="text-right font-mono text-ink">
                {live.total ? pct((live.total - live.confirmed - live.corrected) / live.total) : '-'}
              </dd>
            </dl>
          </GlassPanel>
        </div>

      </div>
    </div>
  )
}
