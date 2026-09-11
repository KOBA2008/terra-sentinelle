import { isOnline } from '../lib/network'
import { setOrigin } from '../lib/store'
import type {
  Commune,
  CommuneSummary,
  CorridorCollection,
  Decision,
  DecisionKind,
  Department,
  FeatureCollection,
  Feature,
  FieldTask,
  FrictionCollection,
  FrictionProps,
  FrictionStatus,
  LayerKind,
  ModelCard,
  Observation,
  PredictionCollection,
  Region,
  RegionCorridorProps,
  RoutesResponse,
  Stats,
} from '../types'

import communeMock from '../mock/commune.json'
import corridorMock from '../mock/corridor.json'
import villagesMock from '../mock/villages.json'
import waterMock from '../mock/water_points.json'
import pasturesMock from '../mock/pastures.json'
import parcelsMock from '../mock/parcels.json'
import frictionMock from '../mock/friction.json'
import routesMock from '../mock/routes.json'
import decisionsMock from '../mock/decisions.json'
import statsMock from '../mock/stats.json'
import fieldQueueMock from '../mock/field_queue.json'
import modelMock from '../mock/model.json'
import * as synth from '../mock/synth'
import * as predict from '../mock/predict'

export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:8000/api'

/** Commune portant le jeu de données détaillé ; les autres sont générées. */
export const DEMO_COMMUNE_ID = synth.DEMO_COMMUNE_ID

const TIMEOUT_MS = 2500

/** Copie profonde des fixtures : elles sont mutées localement (validation hors ligne). */
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

const LAYER_MOCKS: Record<LayerKind, unknown> = {
  villages: villagesMock,
  water_points: waterMock,
  pastures: pasturesMock,
  parcels: parcelsMock,
}

const isDemo = (id: string) => id === DEMO_COMMUNE_ID

/**
 * Appelle l'API si elle répond ; sinon bascule sur la fixture locale.
 * L'application reste entièrement utilisable sans backend.
 */
async function request<T>(path: string, fallback: () => T, init?: RequestInit): Promise<T> {
  if (!isOnline()) {
    setOrigin('local', 'réseau coupé')
    return clone(fallback())
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as T
    setOrigin('api')
    return data
  } catch (err) {
    setOrigin('local', err instanceof Error ? err.message : 'API injoignable')
    return clone(fallback())
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------------------------------------ vue régionale */

export const getCommunes = () => request<CommuneSummary[]>('/communes', () => synth.communeSummaries())

export const getDepartments = () => request<Department[]>('/departments', () => synth.departments())

export const getRegion = () => request<Region>('/region', () => synth.region())

export const getRegionCorridors = () =>
  request<FeatureCollection<RegionCorridorProps>>('/region/corridors', () => synth.regionCorridors())

/* ------------------------------------------------------------ vue communale */

export const getCommune = (id: string) =>
  request<Commune>(`/commune/${id}`, () =>
    isDemo(id) ? (communeMock as Commune) : (synth.communeOf(id) ?? (communeMock as Commune)),
  )

export const getCorridor = (id: string) =>
  request<CorridorCollection>(`/commune/${id}/corridor`, () =>
    isDemo(id) ? (corridorMock as unknown as CorridorCollection) : synth.corridor(id),
  )

const LAYER_SYNTH: Record<LayerKind, (id: string) => FeatureCollection> = {
  villages: synth.villages,
  water_points: synth.waterPoints,
  pastures: synth.pastures,
  parcels: synth.parcels,
}

export const getLayer = (id: string, kind: LayerKind) =>
  request<FeatureCollection>(`/commune/${id}/layers/${kind}`, () =>
    isDemo(id) ? (LAYER_MOCKS[kind] as FeatureCollection) : LAYER_SYNTH[kind](id),
  )

const frictionFallback = (id: string): FrictionCollection =>
  isDemo(id) ? (frictionMock as unknown as FrictionCollection) : synth.friction(id)

export const getFriction = (id: string, season = 2026) =>
  request<FrictionCollection>(`/friction?season=${season}&commune=${id}`, () => frictionFallback(id))

export const getRoutes = (id: string, from: [number, number], to: [number, number]) =>
  request<RoutesResponse>(`/routes?commune=${id}&from=${from.join(',')}&to=${to.join(',')}`, () =>
    isDemo(id) ? (routesMock as unknown as RoutesResponse) : synth.routes(id),
  )

export const getDecisions = (id: string) =>
  request<Decision[]>(`/decisions?commune=${id}`, () =>
    isDemo(id) ? (decisionsMock as unknown as Decision[]) : synth.decisions(id),
  )

export const getStats = (id: string) =>
  request<Stats>(`/stats?commune=${id}`, () => (isDemo(id) ? (statsMock as Stats) : synth.stats(id)))

/** File d'attente terrain : dérivée des détections en attente. */
export const getFieldQueue = (id: string) =>
  request<FieldTask[]>(`/friction?season=2026&commune=${id}&status=pending`, () =>
    isDemo(id) ? (fieldQueueMock as unknown as FieldTask[]) : [],
  )

export async function validateFriction(
  communeId: string,
  id: string,
  body: { status: FrictionStatus; note: string; agent: string },
): Promise<Feature<FrictionProps>> {
  const collection = frictionFallback(communeId)
  const local = collection.features.find((f) => f.properties.id === id)
  const fallback = clone(local ?? (collection.features[0] as unknown)) as Feature<FrictionProps>
  fallback.properties = { ...fallback.properties, status: body.status, note: body.note || fallback.properties.note }
  return request<Feature<FrictionProps>>(`/friction/${id}/validate`, () => fallback, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function postObservations(
  batch: Observation[],
): Promise<{ accepted: number; rejected: number; synced_at: string }> {
  return request(
    '/observations',
    () => ({ accepted: batch.length, rejected: 0, synced_at: new Date().toISOString() }),
    { method: 'POST', body: JSON.stringify({ batch }) },
  )
}

export async function postDecision(body: {
  corridor_segment_id: string
  decision: DecisionKind
  committee: string
  note: string
}): Promise<Decision> {
  const fallback = (): Decision => ({
    id: `DEC-LOCAL-${Date.now().toString().slice(-5)}`,
    corridor_segment_id: body.corridor_segment_id,
    decision: body.decision,
    committee: body.committee,
    decided_on: new Date().toISOString().slice(0, 10),
    note: body.note,
    broadcast: {
      lang: 'ff',
      duration_s: 36,
      transcript_fr: buildTranscript(body.corridor_segment_id, body.decision, body.committee),
    },
  })
  return request<Decision>('/decisions', fallback, { method: 'POST', body: JSON.stringify(body) })
}

export function buildTranscript(segment: string, decision: DecisionKind, committee: string): string {
  const head = `Avis du ${committee.charAt(0).toLowerCase()}${committee.slice(1)}.`
  const tail = 'Ce message est un avis de passage, il ne remplace aucune autorisation.'
  const body: Record<DecisionKind, string> = {
    maintien: `Sur le tronçon ${segment}, le tracé habituel est maintenu. Les portions mises en culture ont été vérifiées et ne bloquent pas le passage.`,
    ajustement: `Sur le tronçon ${segment}, le passage est ajusté localement pour contourner les parcelles mises en culture. Les balises seront posées avant le début de la descente.`,
    contournement: `Sur le tronçon ${segment}, le passage habituel n'est plus praticable. Un itinéraire de contournement est retenu, avec une étape supplémentaire et un point d'eau signalé.`,
  }
  return `${head} ${body[decision]} ${tail}`
}

/* ------------------------------------------------------------------ modèle */

/**
 * Carte du modèle réellement entraîné (GET /api/model).
 * Sans backend, on sert l'instantané hors ligne : le fichier porte lui-même
 * `offline_snapshot: true`, l'écran Modèle l'affiche comme tel.
 */
export const getModel = () => request<ModelCard>('/model', () => modelMock as unknown as ModelCard)

const predictionFallback = (id: string): PredictionCollection => predict.predictions(id)

/** Cellules déjà prédites pour la commune (sorties de modèle, non validées). */
export const getPredictions = (id: string) =>
  request<PredictionCollection>(`/commune/${id}/predictions`, () => predictionFallback(id))

/**
 * Relance l'inférence bornée sur la commune (POST), puis renvoie les cellules.
 * Le backend peut répondre soit la collection, soit un résumé : les deux
 * formes sont acceptées, la collection est relue au besoin.
 */
export async function runPrediction(id: string): Promise<PredictionCollection> {
  const res = await request<unknown>(`/commune/${id}/predict`, () => predictionFallback(id), {
    method: 'POST',
    body: JSON.stringify({}),
  })
  const asCollection = (v: unknown): PredictionCollection | null => {
    if (!v || typeof v !== 'object') return null
    const o = v as Record<string, unknown>
    if (Array.isArray(o.features)) return v as PredictionCollection
    if (o.predictions && typeof o.predictions === 'object') return asCollection(o.predictions)
    if (o.result && typeof o.result === 'object') return asCollection(o.result)
    return null
  }
  return asCollection(res) ?? (await getPredictions(id))
}
