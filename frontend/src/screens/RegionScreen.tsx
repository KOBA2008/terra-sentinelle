import { useMemo, useState } from 'react'
import { MapView } from '../components/map/MapView'
import { Badge, GlassPanel } from '../components/glass'
import { DEMO_COMMUNE_ID } from '../api/client'
import { communePoints } from '../mock/synth'
import { formatAge, formatDate, int } from '../lib/format'
import { SEVERITY_LABELS, severityColor } from '../lib/severity'
import { padBBox, type BBox } from '../lib/geo'
import type { RegionData } from '../lib/regionData'
import type { CommuneSummary, FeatureCollection } from '../types'

type SortKey = 'severity' | 'friction' | 'name' | 'pass'

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'severity', label: 'Gravité' },
  { id: 'friction', label: 'Frictions' },
  { id: 'pass', label: 'Dernier passage' },
  { id: 'name', label: 'Nom' },
]

function CommuneRow({
  commune,
  active,
  onEnter,
  onHover,
}: {
  commune: CommuneSummary
  active: boolean
  onEnter: () => void
  onHover: () => void
}) {
  const sev = commune.max_severity
  return (
    <li>
      <button
        onClick={onEnter}
        onMouseEnter={onHover}
        className={`spring w-full rounded-[18px] border p-3 text-left ${
          active
            ? 'border-line-strong bg-surf-3'
            : 'border-line bg-surf hover:border-line-strong hover:bg-surf-2'
        }`}
      >
        <div className="flex items-start gap-3">
          <span
            className="mt-[3px] h-8 w-[3px] shrink-0 rounded-full"
            style={{
              background: sev ? severityColor(sev) : 'rgb(var(--dim-rgb))',
            }}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[13.5px] font-medium text-ink">{commune.name}</span>
              <span className="shrink-0 font-mono text-[11px] text-dim">{commune.department}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge color={sev ? severityColor(sev) : undefined}>
                {sev ? `Gravité max ${sev} · ${SEVERITY_LABELS[sev]}` : 'aucune friction'}
              </Badge>
              <Badge>
                <span className="font-mono">{commune.friction_count}</span> friction(s)
              </Badge>
              {commune.id === DEMO_COMMUNE_ID && <Badge tone="accent">jeu détaillé</Badge>}
            </div>
            <div className="mt-1.5 font-mono text-[10.5px] text-dim">
              {commune.last_pass.sensor} · {formatDate(commune.last_pass.date)} ·{' '}
              {formatAge(commune.last_pass.date)} · {commune.last_pass.cloud_pct} % nuages
            </div>
          </div>
        </div>
      </button>
    </li>
  )
}

/**
 * Vue régionale : point d'entrée de l'application.
 * Les 33 communes du nord et du centre, le réseau de couloirs inter-communal,
 * et pour chaque commune : frictions, gravité maximale, dernier passage satellite.
 */
export function RegionScreen({
  data,
  onEnterCommune,
}: {
  data: RegionData
  onEnterCommune: (id: string) => void
}) {
  const { region, communes, departments, corridors } = data
  const [sort, setSort] = useState<SortKey>('severity')
  const [dept, setDept] = useState<string>('all')
  const [hovered, setHovered] = useState<string | null>(null)
  const [focus, setFocus] = useState<BBox | null>(null)

  const points = useMemo(() => {
    // Le back-end peut renvoyer la liste sans géométrie : on la reconstruit à partir des centres.
    if (!communes.length) return communePoints()
    return {
      type: 'FeatureCollection' as const,
      features: communes.map((c) => ({
        type: 'Feature' as const,
        id: c.id,
        geometry: { type: 'Point' as const, coordinates: c.center },
        properties: {
          id: c.id,
          name: c.name,
          department: c.department,
          friction_count: c.friction_count,
          max_severity: c.max_severity,
          demo: c.id === DEMO_COMMUNE_ID ? 1 : 0,
        },
      })),
    }
  }, [communes])

  const list = useMemo(() => {
    const filtered = dept === 'all' ? communes : communes.filter((c) => c.department === dept)
    const sorted = [...filtered]
    sorted.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, 'fr')
      if (sort === 'friction')
        return b.friction_count - a.friction_count || a.name.localeCompare(b.name, 'fr')
      if (sort === 'pass') return b.last_pass.date.localeCompare(a.last_pass.date)
      return (
        b.max_severity - a.max_severity ||
        b.friction_count - a.friction_count ||
        a.name.localeCompare(b.name, 'fr')
      )
    })
    return sorted
  }, [communes, dept, sort])

  const totals = useMemo(
    () => ({
      frictions: communes.reduce((a, c) => a + c.friction_count, 0),
      critical: communes.filter((c) => c.max_severity >= 4).length,
    }),
    [communes],
  )

  const bbox = (region?.bbox ?? [0.72, 7.45, 3.92, 12.42]) as BBox
  const center = region?.center ?? [2.05, 9.9]

  const enter = (id: string) => onEnterCommune(id)

  const zoomTo = (c: CommuneSummary) => {
    setHovered(c.id)
    setFocus(padBBox(c.bbox as BBox, 0.6))
  }

  return (
    <div className="relative h-full w-full">
      <MapView
        center={center as [number, number]}
        bbox={bbox}
        communes={points}
        network={corridors as FeatureCollection | null}
        selectedCommuneId={hovered}
        onSelectCommune={enter}
        focus={focus}
        zoom={5.9}
      />

      {/* Mobile : une colonne qui défile par-dessus la carte.
          Desktop : deux panneaux flottants, la carte reste manipulable entre les deux. */}
      <div className="absolute inset-0 z-10 overflow-y-auto md:pointer-events-none md:overflow-visible">
        <div className="px-3 pb-4 pt-[136px] md:p-0">
          {/* Synthèse régionale */}
          <div className="md:pointer-events-none md:absolute md:left-4 md:top-[112px] md:w-[330px]">
            <GlassPanel className="pointer-events-auto fade-up rounded-[24px] p-4">
              <h1 className="font-display text-[19px] font-semibold leading-tight text-ink">
                {region?.name ?? 'Nord & Centre Bénin'}
              </h1>
              <p className="mt-1 text-[12px] leading-relaxed text-dim">
                Veille des couloirs de transhumance sur {region?.department_count ?? 5} départements et{' '}
                {region?.commune_count ?? communes.length} communes. Choisissez une commune pour entrer dans
                le détail.
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[
                  ['Communes', int(region?.commune_count ?? communes.length), ''],
                  ['Frictions', int(totals.frictions), 'saison 2026'],
                  ['Couloirs', int(region?.corridor_km_total ?? 0), 'km suivis'],
                ].map(([label, value, hint]) => (
                  <div key={label} className="glass-inset p-2.5">
                    <div className="text-[9.5px] uppercase tracking-[0.12em] text-dim">{label}</div>
                    <div className="mt-1 font-mono text-[19px] leading-none text-ink">{value}</div>
                    {hint && <div className="mt-1 text-[9.5px] text-dim">{hint}</div>}
                  </div>
                ))}
              </div>
              <button
                onClick={() => enter(DEMO_COMMUNE_ID)}
                className="glass-btn spring mt-3 w-full px-3.5 py-2 text-[13px] font-medium !border-accent/45 text-accent-ink hover:!bg-accent/15"
              >
                Ouvrir Banikoara : commune de démonstration
              </button>
              <p className="mt-2 text-[11px] leading-snug text-dim">
                {totals.critical} commune(s) présentent au moins une friction de gravité élevée ou critique.
              </p>
            </GlassPanel>
          </div>

          {/* Liste des communes */}
          <div className="mt-2.5 md:absolute md:bottom-4 md:right-4 md:top-[112px] md:mt-0 md:w-[352px]">
            <GlassPanel className="pointer-events-auto flex max-h-none flex-col overflow-hidden rounded-[26px] md:h-full">
              <div className="border-b border-line px-4 py-3.5">
                <div className="flex items-baseline justify-between">
                  <h2 className="font-display text-[15px] font-semibold text-ink">Communes</h2>
                  <span className="font-mono text-[12px] text-dim">
                    {list.length}/{communes.length}
                  </span>
                </div>
                <div className="mt-2.5">
                  <label
                    className="block text-[10px] uppercase tracking-[0.13em] text-dim"
                    htmlFor="dept-filter"
                  >
                    Département
                  </label>
                  <select
                    id="dept-filter"
                    value={dept}
                    onChange={(e) => setDept(e.target.value)}
                    className="field mt-1 w-full px-2.5 py-1.5 text-[12.5px]"
                  >
                    <option value="all">Tous les départements</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.name} : {d.commune_count} communes · {d.friction_count} frictions
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {SORTS.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSort(s.id)}
                      className={`spring rounded-full border px-2.5 py-1 text-[11px] ${
                        sort === s.id
                          ? 'border-line-strong bg-surf-3 text-ink'
                          : 'border-line bg-surf text-dim hover:text-ink'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <ul className="flex-1 space-y-2 overflow-visible p-3 md:overflow-y-auto">
                {list.map((c) => (
                  <CommuneRow
                    key={c.id}
                    commune={c}
                    active={hovered === c.id}
                    onEnter={() => enter(c.id)}
                    onHover={() => zoomTo(c)}
                  />
                ))}
                {list.length === 0 && (
                  <li className="rounded-[18px] border border-line bg-surf p-4 text-[13px] text-dim">
                    Aucune commune pour ce filtre.
                  </li>
                )}
              </ul>
            </GlassPanel>
          </div>
        </div>
      </div>
    </div>
  )
}
