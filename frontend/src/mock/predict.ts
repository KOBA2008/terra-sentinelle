/**
 * Mode dégradé : grille de prédiction embarquée.
 *
 * Le déploiement public n'a pas de backend : sans API, l'écran de prédiction
 * doit rester démontrable. Les cellules produites ici sont un INSTANTANÉ HORS
 * LIGNE, déterministe (graine dérivée de l'identifiant de commune et du numéro
 * de tuile) : ce ne sont pas des sorties de modèle calculées sur l'image.
 * L'interface le signale (`offline_snapshot`), exactement comme elle signale
 * qu'une prédiction n'est jamais une friction validée.
 *
 * Les tuiles portent en revanche de VRAIS numéros WMTS (z/x/y en Web Mercator)
 * sur l'emprise réelle de la commune : ce sont celles que le backend interroge.
 */
import type { Commune, PredictionCollection, PredictionProps } from '../types'
import * as synth from './synth'

/** Niveau de tuile retenu pour l'inférence (SPEC §10 : grille bornée 8×8). */
export const PREDICT_ZOOM = 13
export const PREDICT_GRID = 8

/** Classes EuroSAT retenues comme sortie multi-classes. */
const CULTIVATED = ['AnnualCrop', 'PermanentCrop']
const OTHER = ['HerbaceousVegetation', 'Pasture', 'Forest', 'River', 'Residential', 'Highway']

const lonToX = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z)
const latToY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z)
}
const xToLon = (x: number, z: number) => (x / 2 ** z) * 360 - 180
const yToLat = (y: number, z: number) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

function rngOf(seed: string) {
  let a = 2166136261
  for (let i = 0; i < seed.length; i++) a = Math.imul(a ^ seed.charCodeAt(i), 16777619)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const round = (v: number, d = 5) => Number(v.toFixed(d))

/** Grille de tuiles réelles couvrant le centre de la commune. */
export function predictions(communeId: string, commune?: Commune | null): PredictionCollection {
  const c = commune ?? synth.communeOf(communeId)
  const center = c?.center ?? [2.438, 11.298]
  const half = Math.floor(PREDICT_GRID / 2)
  const cx = lonToX(center[0], PREDICT_ZOOM)
  const cy = latToY(center[1], PREDICT_ZOOM)

  const features: PredictionCollection['features'] = []
  for (let dy = 0; dy < PREDICT_GRID; dy++) {
    for (let dx = 0; dx < PREDICT_GRID; dx++) {
      const x = cx - half + dx
      const y = cy - half + dy
      const r = rngOf(`${communeId}/${PREDICT_ZOOM}/${x}/${y}`)
      // Structure spatiale douce : les zones cultivées se tiennent, elles ne
      // sont pas dispersées au hasard sur toute la grille.
      const wave = (Math.sin(dx * 0.9 + dy * 0.5) + Math.cos(dy * 1.1 - dx * 0.3)) / 4 + 0.5
      const p = Math.min(0.98, Math.max(0.02, wave * 0.72 + r() * 0.3))
      const cultivated = p >= 0.5
      const cls = cultivated ? CULTIVATED[Math.floor(r() * CULTIVATED.length)] : OTHER[Math.floor(r() * OTHER.length)]
      const w = xToLon(x, PREDICT_ZOOM)
      const e = xToLon(x + 1, PREDICT_ZOOM)
      const n = yToLat(y, PREDICT_ZOOM)
      const s = yToLat(y + 1, PREDICT_ZOOM)
      const props: PredictionProps = {
        id: `PRED-${PREDICT_ZOOM}-${x}-${y}`,
        p_cultivated: Math.round(p * 1000) / 1000,
        predicted_class: cls,
        confidence: Math.round(Math.max(p, 1 - p) * 1000) / 1000,
        tile: { z: PREDICT_ZOOM, x, y },
        validated: false,
        source: 'model',
        offline_snapshot: true,
      }
      features.push({
        type: 'Feature',
        id: props.id,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [round(w), round(s)],
              [round(e), round(s)],
              [round(e), round(n)],
              [round(w), round(n)],
              [round(w), round(s)],
            ],
          ],
        },
        properties: props,
      })
    }
  }
  return { type: 'FeatureCollection', features }
}
