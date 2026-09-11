/**
 * Fixtures régionales légères : mode dégradé.
 *
 * Banikoara porte le jeu de données détaillé (fichiers JSON voisins).
 * Les 32 autres communes sont générées ici, à plus faible densité, de manière
 * DÉTERMINISTE (graine dérivée de l'identifiant) : la même commune donne
 * toujours la même carte, d'un rechargement à l'autre et d'un poste à l'autre.
 *
 * Ces données sont synthétiques et l'emprise des couloirs est reconstituée :
 * l'interface le signale en permanence.
 */
import raw from './communes.json'
import type {
  Commune,
  CommuneSummary,
  CorridorCollection,
  Decision,
  Department,
  FeatureCollection,
  FrictionCollection,
  FrictionProps,
  Region,
  RegionCorridorProps,
  RoutesResponse,
  Severity,
  Stats,
} from '../types'

type RawCommune = { id: string; name: string; dept: string; lon: number; lat: number; r: number }
type RawChain = { id: string; name: string; stops: string[] }

const RAW = raw as {
  region: { name: string; bbox: [number, number, number, number]; center: [number, number] }
  departments: { id: string; name: string }[]
  communes: RawCommune[]
  corridor_chains: RawChain[]
}

export const DEMO_COMMUNE_ID = 'banikoara'
const SOURCE = 'Reconstitution équipe (points OIM TTT-DTM + pistes OSM) : synthétique'
const MODEL = 'ts-crop-s2-v0.4-demo'

/* ------------------------------------------------------------------ aléas */

function seedOf(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

function rngOf(seed: string) {
  let a = seedOf(seed)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T,>(r: () => number, arr: T[]): T => arr[Math.floor(r() * arr.length) % arr.length]
const between = (r: () => number, a: number, b: number) => a + r() * (b - a)
const round = (v: number, d = 5) => Number(v.toFixed(d))

const KM_PER_DEG = 111.32
const dist = (a: [number, number], b: [number, number]) =>
  Math.hypot((b[0] - a[0]) * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180), b[1] - a[1]) * KM_PER_DEG

const lineKm = (c: [number, number][]) => c.slice(1).reduce((s, p, i) => s + dist(c[i], p), 0)

/* ------------------------------------------------------- index des communes */

const byId = new Map(RAW.communes.map((c) => [c.id, c]))
const deptName = new Map(RAW.departments.map((d) => [d.id, d.name]))

export const bboxOf = (c: RawCommune): [number, number, number, number] => [
  round(c.lon - c.r, 4),
  round(c.lat - c.r * 0.86, 4),
  round(c.lon + c.r, 4),
  round(c.lat + c.r * 0.86, 4),
]

export function communeOf(id: string): Commune | null {
  const c = byId.get(id)
  if (!c) return null
  return {
    id: c.id,
    name: c.name,
    department: deptName.get(c.dept) ?? c.dept,
    center: [c.lon, c.lat],
    bbox: bboxOf(c),
  }
}

export const allCommuneIds = () => RAW.communes.map((c) => c.id)

/* ------------------------------------------------------- profil par commune */

const SENSORS = ['Sentinel-2 L2A', 'Sentinel-2 L2A', 'Sentinel-1 GRD']
const PASS_DATES = [
  '2026-01-14',
  '2026-01-21',
  '2026-01-29',
  '2026-02-03',
  '2026-02-07',
  '2026-02-11',
  '2026-02-16',
  '2026-02-19',
]

interface Profile {
  count: number
  severities: Severity[]
  last_pass: { date: string; sensor: string; cloud_pct: number }
  axis: [number, number][]
  km: number
}

const profiles = new Map<string, Profile>()

function profileOf(id: string): Profile {
  const cached = profiles.get(id)
  if (cached) return cached
  const c = byId.get(id)!
  const r = rngOf(id)
  const count = 3 + Math.floor(r() * 6)
  // Toutes les communes ne sont pas critiques : un plafond tiré par commune
  // évite une carte uniformément rouge, qui ne dirait plus rien.
  const cap = pick(r, [2, 3, 3, 3, 4, 4, 4, 5, 5])
  const severities = Array.from({ length: count }, () => (1 + Math.floor(r() * cap)) as Severity)
  const last_pass = {
    date: pick(r, PASS_DATES),
    sensor: pick(r, SENSORS),
    cloud_pct: Math.round(between(r, 4, 46)),
  }
  // Axe du couloir : traversée sud-ouest → nord-est, légèrement sinueuse.
  const n = 7
  const a: [number, number] = [c.lon - c.r * 0.85, c.lat - c.r * 0.72]
  const b: [number, number] = [c.lon + c.r * 0.85, c.lat + c.r * 0.72]
  const axis: [number, number][] = Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1)
    const wob = Math.sin(t * Math.PI) * c.r * between(r, -0.38, 0.38)
    return [round(a[0] + (b[0] - a[0]) * t + wob), round(a[1] + (b[1] - a[1]) * t - wob * 0.5)]
  })
  const p: Profile = { count, severities, last_pass, axis, km: Math.round(lineKm(axis) * 10) / 10 }
  profiles.set(id, p)
  return p
}

/* ------------------------------------------------- agrégats vue régionale */

/** Chiffres de Banikoara : ils viennent du jeu détaillé, pas du générateur. */
const DEMO_SUMMARY = {
  friction_count: 10,
  max_severity: 5 as Severity,
  last_pass: { date: '2026-02-11', sensor: 'Sentinel-2 L2A', cloud_pct: 18 },
}

export function communeSummaries(): CommuneSummary[] {
  return RAW.communes.map((c) => {
    const base = communeOf(c.id)!
    if (c.id === DEMO_COMMUNE_ID) return { ...base, ...DEMO_SUMMARY }
    const p = profileOf(c.id)
    return {
      ...base,
      friction_count: p.count,
      max_severity: (p.severities.length ? (Math.max(...p.severities) as Severity) : 0) as Severity | 0,
      last_pass: p.last_pass,
    }
  })
}

export function departments(): Department[] {
  const summaries = communeSummaries()
  return RAW.departments.map((d) => {
    const list = summaries.filter((s) => s.department === d.name)
    return {
      id: d.id,
      name: d.name,
      commune_count: list.length,
      friction_count: list.reduce((a, s) => a + s.friction_count, 0),
      max_severity: (list.length ? Math.max(...list.map((s) => s.max_severity)) : 0) as Severity | 0,
    }
  })
}

export function region(): Region {
  const corridors = regionCorridors()
  return {
    name: RAW.region.name,
    bbox: RAW.region.bbox,
    center: RAW.region.center,
    commune_count: RAW.communes.length,
    department_count: RAW.departments.length,
    corridor_km_total: Math.round(
      corridors.features.reduce((a, f) => a + (f.properties as RegionCorridorProps).length_km, 0),
    ),
  }
}

/** Réseau inter-communal simplifié : chaînes de communes reliées par leur chef-lieu. */
export function regionCorridors(): FeatureCollection<RegionCorridorProps> {
  return {
    type: 'FeatureCollection',
    features: RAW.corridor_chains.map((chain) => {
      const r = rngOf(chain.id)
      const coords: [number, number][] = []
      chain.stops.forEach((id, i) => {
        const c = byId.get(id)!
        coords.push([c.lon, c.lat])
        const next = byId.get(chain.stops[i + 1] ?? '')
        if (next) {
          // Point intermédiaire décalé : le tracé n'est pas une droite de bureau.
          const mx = (c.lon + next.lon) / 2
          const my = (c.lat + next.lat) / 2
          const dx = next.lon - c.lon
          const dy = next.lat - c.lat
          const k = between(r, -0.14, 0.14)
          coords.push([round(mx - dy * k), round(my + dx * k)])
        }
      })
      return {
        type: 'Feature' as const,
        id: chain.id,
        geometry: { type: 'LineString' as const, coordinates: coords },
        properties: {
          id: chain.id,
          name: chain.name,
          kind: 'network' as const,
          communes: chain.stops,
          length_km: Math.round(lineKm(coords)),
          source: SOURCE,
          official: false,
        },
      }
    }),
  }
}

/** Points des communes, pour la carte régionale. */
export function communePoints(): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: communeSummaries().map((s) => ({
      type: 'Feature' as const,
      id: s.id,
      geometry: { type: 'Point' as const, coordinates: s.center },
      properties: {
        id: s.id,
        name: s.name,
        department: s.department,
        friction_count: s.friction_count,
        max_severity: s.max_severity,
        last_pass: s.last_pass.date,
        demo: s.id === DEMO_COMMUNE_ID ? 1 : 0,
      },
    })),
  }
}

/* ------------------------------------------------- couches intra-communales */

/** Polygone régulier légèrement déformé, centré sur un point. */
function blob(r: () => number, center: [number, number], radius: number, sides = 9): [number, number][][] {
  const ring: [number, number][] = []
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2
    const rad = radius * between(r, 0.68, 1.22)
    ring.push([round(center[0] + Math.cos(a) * rad), round(center[1] + Math.sin(a) * rad * 0.92)])
  }
  ring.push(ring[0])
  return [ring]
}

function along(axis: [number, number][], t: number): [number, number] {
  const i = Math.min(axis.length - 2, Math.floor(t * (axis.length - 1)))
  const f = t * (axis.length - 1) - i
  return [axis[i][0] + (axis[i + 1][0] - axis[i][0]) * f, axis[i][1] + (axis[i + 1][1] - axis[i][1]) * f]
}

export function corridor(id: string): CorridorCollection {
  const c = byId.get(id)!
  const p = profileOf(id)
  const width = 180 + Math.round(rngOf(id + 'w')() * 8) * 20
  const half = width / 2 / 111320
  // Emprise : décalage perpendiculaire de part et d'autre de l'axe.
  const left: [number, number][] = []
  const right: [number, number][] = []
  p.axis.forEach((pt, i) => {
    const prev = p.axis[Math.max(0, i - 1)]
    const next = p.axis[Math.min(p.axis.length - 1, i + 1)]
    const dx = next[0] - prev[0]
    const dy = next[1] - prev[1]
    const len = Math.hypot(dx, dy) || 1
    const nx = (-dy / len) * half * 6
    const ny = (dx / len) * half * 6
    left.push([round(pt[0] + nx), round(pt[1] + ny)])
    right.unshift([round(pt[0] - nx), round(pt[1] - ny)])
  })
  const ring = [...left, ...right, left[0]]
  const cid = `COR-${c.id.split('-').pop()}-01`
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: `${cid}-extent`,
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: {
          id: cid,
          name: `Emprise reconstituée : ${c.name}`,
          kind: 'extent',
          width_m: width,
          source: SOURCE,
          delimited_on: '2019-03-14',
          official: false,
        },
      },
      {
        type: 'Feature',
        id: `${cid}-axis`,
        geometry: { type: 'LineString', coordinates: p.axis },
        properties: {
          id: cid,
          name: `Couloir central : ${c.name}`,
          kind: 'axis',
          width_m: width,
          length_km: p.km,
          source: SOURCE,
          delimited_on: '2019-03-14',
          official: false,
        },
      },
    ],
  }
}

const NOTES = [
  'Mise en culture récente sur l’emprise, parcelle de coton en extension.',
  'Emprise partiellement labourée, bordure sud encore franchissable.',
  'Champ de maïs installé en travers de l’axe, clôture de branchages.',
  'Reprise de jachère : signature ambiguë entre culture et repousse.',
  'Extension maraîchère autour d’un bas-fond, passage rétréci.',
  'Parcelle d’igname à cheval sur l’emprise, arbres repères conservés.',
  'Zone de doute : couverture nuageuse, relais radar Sentinel-1.',
]

const STATUSES: FrictionProps['status'][] = ['pending', 'pending', 'pending', 'confirmed', 'corrected', 'invalidated']

export function friction(id: string): FrictionCollection {
  const c = byId.get(id)!
  const p = profileOf(id)
  const r = rngOf(id + 'fr')
  const short = c.id.slice(0, 3).toUpperCase()
  return {
    type: 'FeatureCollection',
    features: p.severities.map((sev, i) => {
      const t = (i + 0.6) / (p.severities.length + 0.2)
      const base = along(p.axis, t)
      const center: [number, number] = [base[0] + between(r, -0.02, 0.02), base[1] + between(r, -0.02, 0.02)]
      const radius = between(r, 0.008, 0.026)
      const areaHa = Math.round(radius * 111 * radius * 111 * 3.1 * 100) / 100
      const confidence = Math.round(between(r, 0.48, 0.96) * 100) / 100
      const detected = pick(r, PASS_DATES)
      return {
        type: 'Feature' as const,
        id: `FR-2026-${short}-${String(i + 1).padStart(2, '0')}`,
        geometry: { type: 'Polygon' as const, coordinates: blob(r, center, radius) },
        properties: {
          id: `FR-2026-${short}-${String(i + 1).padStart(2, '0')}`,
          severity: sev,
          confidence,
          area_ha: Math.round(areaHa * 10) / 10,
          detected_on: confidence < 0.6 ? '2025-09-18' : detected,
          source: confidence < 0.62 ? ('sentinel-1' as const) : ('sentinel-2' as const),
          model_version: MODEL,
          status: pick(r, STATUSES),
          corridor_segment_id: `SEG-${String(Math.floor(t * 8) + 1).padStart(2, '0')}`,
          note: pick(r, NOTES),
        },
      }
    }),
  }
}

const VILLAGE_SUFFIX = ['Gando', 'Sonsoro', 'Wari', 'Kpébié', 'Tanéka', 'Guéssou', 'Gbégourou', 'Sori']

export function villages(id: string): FeatureCollection {
  const c = byId.get(id)!
  const r = rngOf(id + 'vi')
  const n = 3 + Math.floor(r() * 3)
  const features = [
    {
      type: 'Feature' as const,
      id: `${c.id}-VIL-00`,
      geometry: { type: 'Point' as const, coordinates: [c.lon, c.lat] as [number, number] },
      properties: {
        id: `${c.id}-VIL-00`,
        name: c.name,
        rank: 'chef-lieu',
        source: 'OpenStreetMap Bénin (Geofabrik) : positions de démonstration',
      },
    },
    ...Array.from({ length: n }, (_, i) => {
      const pt = along(profileOf(id).axis, (i + 1) / (n + 1))
      return {
        type: 'Feature' as const,
        id: `${c.id}-VIL-${i + 1}`,
        geometry: {
          type: 'Point' as const,
          coordinates: [round(pt[0] + between(r, -0.05, 0.05)), round(pt[1] + between(r, -0.05, 0.05))] as [
            number,
            number,
          ],
        },
        properties: {
          id: `${c.id}-VIL-${i + 1}`,
          name: `${pick(r, VILLAGE_SUFFIX)}-${c.name.slice(0, 3)}`,
          rank: 'arrondissement',
          source: 'OpenStreetMap Bénin (Geofabrik) : positions de démonstration',
        },
      }
    }),
  ]
  return { type: 'FeatureCollection', features }
}

export function waterPoints(id: string): FeatureCollection {
  const r = rngOf(id + 'wa')
  const axis = profileOf(id).axis
  const n = 2 + Math.floor(r() * 3)
  return {
    type: 'FeatureCollection',
    features: Array.from({ length: n }, (_, i) => {
      const pt = along(axis, (i + 0.4) / n)
      return {
        type: 'Feature' as const,
        id: `${id}-EAU-${i + 1}`,
        geometry: {
          type: 'Point' as const,
          coordinates: [round(pt[0] + between(r, -0.06, 0.06)), round(pt[1] + between(r, -0.06, 0.06))] as [
            number,
            number,
          ],
        },
        properties: {
          id: `${id}-EAU-${i + 1}`,
          kind: pick(r, ['retenue', 'forage', 'mare saisonnière']),
          observed_on: '2025-12-02',
          source: 'OpenStreetMap / relevés de démonstration',
        },
      }
    }),
  }
}

export function pastures(id: string): FeatureCollection {
  const r = rngOf(id + 'pa')
  const axis = profileOf(id).axis
  return {
    type: 'FeatureCollection',
    features: [0.25, 0.72].map((t, i) => {
      const pt = along(axis, t)
      const center: [number, number] = [pt[0] + between(r, -0.07, 0.07), pt[1] + between(r, -0.05, 0.05)]
      return {
        type: 'Feature' as const,
        id: `${id}-PAT-${i + 1}`,
        geometry: { type: 'Polygon' as const, coordinates: blob(r, center, between(r, 0.03, 0.06), 8) },
        properties: {
          id: `${id}-PAT-${i + 1}`,
          name: `Aire de pâture ${i + 1}`,
          source: 'ESA WorldCover v200 : reclassement de démonstration',
        },
      }
    }),
  }
}

export function parcels(id: string): FeatureCollection {
  const r = rngOf(id + 'pc')
  const axis = profileOf(id).axis
  const n = 6 + Math.floor(r() * 5)
  return {
    type: 'FeatureCollection',
    features: Array.from({ length: n }, (_, i) => {
      const pt = along(axis, (i + 0.5) / n)
      const cx = pt[0] + between(r, -0.05, 0.05)
      const cy = pt[1] + between(r, -0.04, 0.04)
      const w = between(r, 0.006, 0.014)
      const h = between(r, 0.005, 0.012)
      return {
        type: 'Feature' as const,
        id: `${id}-PAR-${i + 1}`,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            [
              [round(cx - w), round(cy - h)],
              [round(cx + w), round(cy - h * 0.7)],
              [round(cx + w * 0.9), round(cy + h)],
              [round(cx - w * 1.1), round(cy + h * 0.8)],
              [round(cx - w), round(cy - h)],
            ] as [number, number][],
          ],
        },
        properties: {
          id: `${id}-PAR-${i + 1}`,
          crop: pick(r, ['coton', 'maïs', 'igname', 'sorgho', 'arachide']),
          detected_on: pick(r, PASS_DATES),
          source: 'Dynamic World V1 : classe crops, seuil de démonstration',
        },
      }
    }),
  }
}

export function stats(id: string): Stats {
  const p = profileOf(id)
  const fc = friction(id)
  const by = (s: string) => fc.features.filter((f) => f.properties.status === s).length
  const r = rngOf(id + 'st')
  return {
    friction_total: fc.features.length,
    confirmed: by('confirmed'),
    pending: by('pending'),
    invalidated: by('invalidated'),
    corrected: by('corrected'),
    km_corridor: p.km,
    area_friction_ha: Math.round(fc.features.reduce((a, f) => a + f.properties.area_ha, 0) * 10) / 10,
    last_pass: p.last_pass,
    model: {
      f1: Math.round(between(r, 0.72, 0.86) * 100) / 100,
      precision: Math.round(between(r, 0.7, 0.85) * 100) / 100,
      recall: Math.round(between(r, 0.74, 0.9) * 100) / 100,
      tested_on: p.last_pass.date,
      name: MODEL,
      note: 'valeur de démonstration',
    },
  }
}

export function routes(id: string): RoutesResponse {
  const p = profileOf(id)
  const c = byId.get(id)!
  const r = rngOf(id + 'rt')
  const from = along(p.axis, 0.18)
  const to = along(p.axis, 0.82)
  const mk = (
    key: string,
    label: string,
    offset: number,
    constraints: string[],
    uncertain: [number, number][],
  ) => {
    const coords: [number, number][] = []
    const steps = 9
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const base = along(p.axis, 0.18 + t * 0.64)
      const bow = Math.sin(t * Math.PI) * offset
      coords.push([round(base[0] + bow), round(base[1] - bow * 0.5)])
    }
    return {
      id: key,
      label,
      geometry: { type: 'LineString' as const, coordinates: coords },
      distance_km: Math.round(lineKm(coords) * 10) / 10,
      cost: Math.round(between(r, 1.0, 2.4) * 100) / 100,
      constraints,
      uncertain_segments: uncertain,
      data_used: ['Sentinel-2 (composite médian)', 'Dynamic World V1', 'OSM pistes', 'OIM TTT-DTM'],
    }
  }
  return {
    from: [round(from[0]), round(from[1])],
    to: [round(to[0]), round(to[1])],
    corridor_segment_id: 'SEG-04',
    alternatives: [
      mk('ALT-A', `Tracé historique : ${c.name}`, 0, ['Traverse 2 zones de friction confirmées'], [[4, 6]]),
      mk('ALT-B', 'Ajustement local par l’est', 0.035, ['Rallonge le parcours', 'Longe une parcelle cultivée'], [
        [2, 3],
      ]),
      mk('ALT-C', 'Contournement par les pâtures', -0.05, ['Étape supplémentaire', 'Point d’eau à confirmer'], [
        [6, 8],
      ]),
    ],
  }
}

export function decisions(id: string): Decision[] {
  const c = byId.get(id)!
  const r = rngOf(id + 'de')
  const kind = pick(r, ['maintien', 'ajustement', 'contournement'] as const)
  return [
    {
      id: `DEC-${c.id.slice(0, 3).toUpperCase()}-01`,
      corridor_segment_id: 'SEG-03',
      decision: kind,
      committee: `Comité communal de transhumance de ${c.name}`,
      decided_on: '2026-02-24',
      note: 'Séance de démonstration : aucune valeur administrative.',
      broadcast: {
        lang: 'ff',
        duration_s: 32,
        transcript_fr: `Avis du comité communal de transhumance de ${c.name}. Sur le tronçon SEG-03, la décision retenue est : ${kind}. Ce message est un avis de passage, il ne remplace aucune autorisation.`,
      },
    },
  ]
}
