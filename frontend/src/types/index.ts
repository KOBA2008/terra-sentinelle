export type Severity = 1 | 2 | 3 | 4 | 5
export type FrictionStatus = 'pending' | 'confirmed' | 'corrected' | 'invalidated'
export type SensorSource = 'sentinel-2' | 'sentinel-1' | 'terrain'

export interface Commune {
  id: string
  name: string
  department: string
  center: [number, number]
  bbox: [number, number, number, number]
}

export interface FrictionProps {
  id: string
  severity: Severity
  confidence: number
  area_ha: number
  detected_on: string
  source: SensorSource
  model_version: string
  status: FrictionStatus
  corridor_segment_id: string
  note: string
}

export interface CorridorProps {
  id: string
  name: string
  kind: 'axis' | 'extent' | 'segment'
  width_m: number
  length_km?: number
  source: string
  delimited_on: string
  official: boolean
}

export type Geometry =
  | { type: 'Point'; coordinates: [number, number] }
  | { type: 'LineString'; coordinates: [number, number][] }
  | { type: 'Polygon'; coordinates: [number, number][][] }

export interface Feature<P = Record<string, unknown>, G = Geometry> {
  type: 'Feature'
  id?: string | number
  geometry: G
  properties: P
}

export interface FeatureCollection<P = Record<string, unknown>, G = Geometry> {
  type: 'FeatureCollection'
  features: Feature<P, G>[]
}

export type FrictionCollection = FeatureCollection<FrictionProps, { type: 'Polygon'; coordinates: [number, number][][] }>
export type CorridorCollection = FeatureCollection<CorridorProps>

export interface RouteAlternative {
  id: string
  label: string
  geometry: { type: 'LineString'; coordinates: [number, number][] }
  distance_km: number
  cost: number
  constraints: string[]
  uncertain_segments: [number, number][]
  data_used: string[]
}

export interface RoutesResponse {
  from: [number, number]
  to: [number, number]
  corridor_segment_id: string
  alternatives: RouteAlternative[]
}

export type DecisionKind = 'maintien' | 'ajustement' | 'contournement'

export interface Decision {
  id: string
  corridor_segment_id: string
  decision: DecisionKind
  committee: string
  decided_on: string
  note?: string
  broadcast: { lang: string; duration_s: number; transcript_fr: string }
}

export interface Stats {
  friction_total: number
  confirmed: number
  pending: number
  invalidated: number
  corrected?: number
  km_corridor: number
  area_friction_ha?: number
  last_pass: { date: string; sensor: string; cloud_pct: number }
  model: { f1: number; precision: number; recall: number; tested_on: string; name?: string; note?: string }
}

export interface FieldTask {
  id: string
  corridor_segment_id: string
  severity: Severity
  confidence: number
  area_ha: number
  detected_on: string
  source: SensorSource
  center: [number, number]
  nearest_village: string
  note: string
}

/** Observation produite hors connexion, en attente de synchronisation. */
export interface Observation {
  id: string
  friction_id: string
  status: Exclude<FrictionStatus, 'pending'>
  note: string
  agent: string
  recorded_at: string
  synced: boolean
  offline: boolean
}

export type LayerKind = 'villages' | 'water_points' | 'pastures' | 'parcels'

/** Résumé d'une commune pour la vue régionale. */
export interface CommuneSummary extends Commune {
  friction_count: number
  max_severity: Severity | 0
  last_pass: { date: string; sensor: string; cloud_pct: number }
}

export interface Department {
  id: string
  name: string
  commune_count: number
  friction_count: number
  max_severity: Severity | 0
}

export interface Region {
  name: string
  bbox: [number, number, number, number]
  center: [number, number]
  commune_count: number
  department_count: number
  corridor_km_total: number
}

export interface RegionCorridorProps {
  id: string
  name: string
  kind: 'network'
  communes: string[]
  length_km: number
  source: string
  official: boolean
}

/* ------------------------------------------------------------------ modèle */

/** Métriques d'une classe, telles que renvoyées par le backend. */
export interface ClassMetrics {
  precision: number
  recall: number
  f1: number
  support?: number
}

/** Matrice de confusion : soit une matrice nue, soit une matrice étiquetée. */
export type Confusion = number[][] | { labels?: string[]; matrix: number[][] }

/**
 * Carte du modèle : GET /api/model.
 * Les métriques sont MESURÉES sur le jeu de test tenu à l'écart ; la provenance
 * du jeu d'entraînement et l'écart de domaine voyagent avec elles.
 */
export interface ModelCard {
  name: string
  version: string
  task: string
  trained_on: {
    dataset: string
    source: string
    n_train: number
    n_test: number
    classes: string[]
    [k: string]: unknown
  }
  metrics: {
    accuracy: number
    precision: number
    recall: number
    f1: number
    per_class?: Record<string, ClassMetrics> | (ClassMetrics & { class: string })[]
    confusion?: Confusion
    labels?: string[]
    [k: string]: unknown
  }
  seed: number
  real: boolean
  /** Texte d'avertissement rédigé côté backend : affiché tel quel. */
  domain_gap: string
  trained_at?: string
  features?: string[]
  /** Vrai lorsque la carte provient de l'instantané embarqué (API absente). */
  offline_snapshot?: boolean
}

/** Cellule prédite par le modèle : sortie NON validée localement. */
export interface PredictionProps {
  id: string
  p_cultivated: number
  predicted_class: string
  confidence: number
  tile: { z: number; x: number; y: number }
  validated: false
  source: 'model'
  model_version?: string
  predicted_at?: string
  /** Vrai lorsque la grille provient de l'instantané embarqué (API absente). */
  offline_snapshot?: boolean
}

export type PredictionCollection = FeatureCollection<
  PredictionProps,
  { type: 'Polygon'; coordinates: [number, number][][] }
>

/** Réponse de POST /api/predict/tile. */
export interface TilePrediction {
  p_cultivated: number
  predicted_class: string
  confidence: number
  tile_url?: string
  cached?: boolean
}
