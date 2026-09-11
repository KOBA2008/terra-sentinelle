import type { LayerSpecification } from 'maplibre-gl'
import type { Tokens } from '../../lib/tokens'

export const SRC = {
  graticule: 'ts-graticule',
  extent: 'ts-corridor-extent',
  axis: 'ts-corridor-axis',
  friction: 'ts-friction',
  parcels: 'ts-parcels',
  pastures: 'ts-pastures',
  water: 'ts-water',
  villages: 'ts-villages',
  routes: 'ts-routes',
  network: 'ts-region-network',
  communes: 'ts-communes',
  predictions: 'ts-predictions',
} as const

/** Motif hachuré des cellules prédites : construit en JavaScript (voir MapView). */
export const HATCH_IMAGE = 'ts-hatch'

/**
 * MapLibre ne résout pas les var() CSS : les peintures sont construites à partir
 * des jetons du thème actif et reconstruites à chaque bascule.
 */
export function severityExpression(t: Tokens): unknown[] {
  return [
    'match',
    ['get', 'severity'],
    1, t.severity[0],
    2, t.severity[1],
    3, t.severity[2],
    4, t.severity[3],
    5, t.severity[4],
    t.dim,
  ]
}

/** Ordre de dessin : du sol vers l'information. */
export function buildLayers(t: Tokens): LayerSpecification[] {
  const sev = severityExpression(t) as never
  return [
    {
      id: 'ts-graticule',
      type: 'line',
      source: SRC.graticule,
      paint: { 'line-color': t.map.graticule, 'line-width': 1 },
    },
    /* --- Cellules PRÉDITES (sorties de modèle, non validées) ---
       Traitement volontairement différent des frictions validées : hachures et
       contour pointillé, jamais un aplat. L'opacité suit p_cultivated. */
    {
      id: 'ts-pred-tone',
      type: 'fill',
      source: SRC.predictions,
      paint: {
        'fill-color': t.sand,
        'fill-opacity': [
          'interpolate',
          ['linear'],
          ['get', 'p_cultivated'],
          0, 0.02,
          0.5, 0.16,
          1, 0.42,
        ],
      },
    },
    {
      id: 'ts-pred-hatch',
      type: 'fill',
      source: SRC.predictions,
      paint: {
        'fill-pattern': HATCH_IMAGE,
        'fill-opacity': [
          'interpolate',
          ['linear'],
          ['get', 'p_cultivated'],
          0, 0.05,
          0.5, 0.4,
          1, 0.9,
        ],
      },
    },
    {
      id: 'ts-pred-line',
      type: 'line',
      source: SRC.predictions,
      paint: {
        'line-color': t.sandInk,
        'line-width': 1,
        'line-opacity': 0.55,
        'line-dasharray': [1.5, 1.5],
      },
    },
    {
      id: 'ts-pred-selected',
      type: 'line',
      source: SRC.predictions,
      filter: ['==', ['get', 'id'], '__none__'],
      paint: { 'line-color': t.map.node, 'line-width': 2.4, 'line-opacity': 0.9, 'line-dasharray': [2, 1.2] },
    },
    {
      id: 'ts-parcels-fill',
      type: 'fill',
      source: SRC.parcels,
      paint: { 'fill-color': t.sand, 'fill-opacity': 0.16 },
    },
    {
      id: 'ts-parcels-line',
      type: 'line',
      source: SRC.parcels,
      paint: { 'line-color': t.sand, 'line-opacity': 0.5, 'line-width': 1 },
    },
    {
      id: 'ts-pastures-fill',
      type: 'fill',
      source: SRC.pastures,
      paint: { 'fill-color': t.accent, 'fill-opacity': 0.12 },
    },
    {
      id: 'ts-pastures-line',
      type: 'line',
      source: SRC.pastures,
      paint: { 'line-color': t.accent, 'line-opacity': 0.5, 'line-width': 1.2, 'line-dasharray': [3, 2] },
    },
    {
      id: 'ts-extent-fill',
      type: 'fill',
      source: SRC.extent,
      filter: ['==', ['get', 'kind'], 'extent'],
      paint: { 'fill-color': t.map.extentFill },
    },
    {
      id: 'ts-extent-line',
      type: 'line',
      source: SRC.extent,
      filter: ['==', ['get', 'kind'], 'extent'],
      paint: { 'line-color': t.map.extentLine, 'line-width': 1, 'line-dasharray': [2, 2] },
    },
    {
      id: 'ts-network-casing',
      type: 'line',
      source: SRC.network,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': t.map.casing,
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 5, 10, 11],
        'line-opacity': 0.8,
      },
    },
    {
      id: 'ts-network-line',
      type: 'line',
      source: SRC.network,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': t.map.axis,
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.6, 10, 4],
        'line-opacity': 0.8,
        'line-dasharray': [4, 2],
      },
    },
    {
      id: 'ts-axis-casing',
      type: 'line',
      source: SRC.axis,
      filter: ['==', ['get', 'kind'], 'axis'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': t.map.casing,
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 7, 14, 16],
        'line-opacity': 0.85,
      },
    },
    {
      id: 'ts-axis-line',
      type: 'line',
      source: SRC.axis,
      filter: ['==', ['get', 'kind'], 'axis'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': t.map.axis,
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.2, 14, 6],
        'line-opacity': 0.9,
      },
    },
    {
      id: 'ts-routes-casing',
      type: 'line',
      source: SRC.routes,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': t.map.casing, 'line-width': 8, 'line-opacity': 0.6 },
    },
    {
      id: 'ts-routes-line',
      type: 'line',
      source: SRC.routes,
      filter: ['==', ['get', 'uncertain'], 0],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['case', ['==', ['get', 'active'], 1], 4.5, 2.5],
        'line-opacity': ['case', ['==', ['get', 'active'], 1], 1, 0.45],
      },
    },
    {
      id: 'ts-routes-line-uncertain',
      type: 'line',
      source: SRC.routes,
      filter: ['==', ['get', 'uncertain'], 1],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['case', ['==', ['get', 'active'], 1], 4.5, 2.5],
        'line-opacity': ['case', ['==', ['get', 'active'], 1], 0.95, 0.4],
        'line-dasharray': [1.8, 1.4],
      },
    },
    {
      id: 'ts-friction-fill',
      type: 'fill',
      source: SRC.friction,
      paint: {
        'fill-color': sev,
        'fill-opacity': [
          'case',
          ['==', ['get', 'status'], 'invalidated'], 0.08,
          ['==', ['get', 'uncertain'], 1], 0.18,
          0.34,
        ],
      },
    },
    {
      id: 'ts-friction-line',
      type: 'line',
      source: SRC.friction,
      filter: ['==', ['get', 'uncertain'], 0],
      paint: { 'line-color': sev, 'line-width': 1.8, 'line-opacity': 0.95 },
    },
    {
      id: 'ts-friction-line-uncertain',
      type: 'line',
      source: SRC.friction,
      filter: ['==', ['get', 'uncertain'], 1],
      paint: { 'line-color': sev, 'line-width': 1.8, 'line-opacity': 0.95, 'line-dasharray': [2, 2] },
    },
    {
      id: 'ts-friction-selected',
      type: 'line',
      source: SRC.friction,
      filter: ['==', ['get', 'id'], '__none__'],
      paint: { 'line-color': t.map.node, 'line-width': 3, 'line-opacity': 0.9 },
    },
    {
      id: 'ts-water',
      type: 'circle',
      source: SRC.water,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 3.5, 14, 8],
        'circle-color': t.water,
        'circle-opacity': 0.9,
        'circle-stroke-color': t.map.casing,
        'circle-stroke-width': 1.5,
      },
    },
    {
      id: 'ts-villages',
      type: 'circle',
      source: SRC.villages,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 3.5, 14, 7],
        'circle-color': t.map.node,
        'circle-opacity': 0.9,
        'circle-stroke-color': t.map.casing,
        'circle-stroke-width': 1.5,
      },
    },
    /* --- Vue régionale : une pastille par commune --- */
    {
      id: 'ts-communes-halo',
      type: 'circle',
      source: SRC.communes,
      filter: ['==', ['get', 'demo'], 1],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 16, 9, 34],
        'circle-color': t.accent,
        'circle-opacity': 0.14,
        'circle-stroke-color': t.accent,
        'circle-stroke-width': 1,
        'circle-stroke-opacity': 0.6,
      },
    },
    {
      id: 'ts-communes-circle',
      type: 'circle',
      source: SRC.communes,
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          5, ['interpolate', ['linear'], ['get', 'friction_count'], 0, 4, 10, 11],
          9, ['interpolate', ['linear'], ['get', 'friction_count'], 0, 8, 10, 22],
        ],
        'circle-color': ['match', ['get', 'max_severity'], 1, t.severity[0], 2, t.severity[1], 3, t.severity[2], 4, t.severity[3], 5, t.severity[4], t.dim],
        'circle-opacity': 0.62,
        'circle-stroke-color': t.map.casing,
        'circle-stroke-width': 1.5,
      },
    },
    {
      id: 'ts-communes-selected',
      type: 'circle',
      source: SRC.communes,
      filter: ['==', ['get', 'id'], '__none__'],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 12, 9, 28],
        'circle-color': 'transparent',
        'circle-stroke-color': t.map.node,
        'circle-stroke-width': 2,
      },
    },
  ]
}

export const ROUTE_LAYERS = ['ts-routes-casing', 'ts-routes-line', 'ts-routes-line-uncertain']

export const PREDICTION_LAYERS = ['ts-pred-tone', 'ts-pred-hatch', 'ts-pred-line', 'ts-pred-selected']

export const LAYER_GROUPS: Record<string, string[]> = {
  predictions: PREDICTION_LAYERS,
  parcels: ['ts-parcels-fill', 'ts-parcels-line'],
  pastures: ['ts-pastures-fill', 'ts-pastures-line'],
  corridor: ['ts-extent-fill', 'ts-extent-line', 'ts-axis-casing', 'ts-axis-line'],
  friction: ['ts-friction-fill', 'ts-friction-line', 'ts-friction-line-uncertain', 'ts-friction-selected'],
  water_points: ['ts-water'],
  villages: ['ts-villages'],
  network: ['ts-network-casing', 'ts-network-line'],
  communes: ['ts-communes-halo', 'ts-communes-circle', 'ts-communes-selected'],
}
