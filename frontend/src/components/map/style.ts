import type { StyleSpecification } from 'maplibre-gl'
import { isOnline } from '../../lib/network'
import type { Tokens } from '../../lib/tokens'

/** Tuiles vectorielles libres, sans clé d'API. Deux styles : clair et sombre. */
export const TILE_STYLES = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/positron',
} as const

const STYLE_TIMEOUT_MS = 3000

/**
 * Style de secours : aucune source réseau.
 * Le canvas reste transparent, le dégradé CSS du conteneur : lui aussi thématisé :  * fait office de fond, et seules nos couches GeoJSON sont dessinées.
 * La carte n'est jamais vide.
 */
export const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  name: 'terra-sentinelle-hors-ligne',
  sources: {},
  layers: [],
}

/**
 * Recolore le fond (positron) avec les jetons du thème actif.
 * Clair : lavis très doux, le fond ne doit pas concurrencer les frictions.
 * Sombre : fond profond, traits clairs.
 */
function retint(style: StyleSpecification, t: Tokens): StyleSpecification {
  const out = JSON.parse(JSON.stringify(style)) as StyleSpecification
  const dark = t.theme === 'dark'
  out.layers = out.layers.map((layer) => {
    const id = layer.id.toLowerCase()
    const l = layer as unknown as { type: string; paint?: Record<string, unknown> }
    l.paint = l.paint ?? {}
    const isWater = id.includes('water') || id.includes('river') || id.includes('lake')
    const isGreen = id.includes('wood') || id.includes('forest') || id.includes('park') || id.includes('grass')
    if (l.type === 'background') {
      l.paint['background-color'] = t.map.bg
    } else if (l.type === 'fill') {
      l.paint['fill-color'] = isWater
        ? t.alpha('water', dark ? 0.18 : 0.16)
        : id.includes('build')
          ? t.alpha('text', dark ? 0.06 : 0.05)
          : isGreen
            ? t.alpha('accent', dark ? 0.08 : 0.09)
            : t.alpha('text', dark ? 0.04 : 0.035)
      l.paint['fill-outline-color'] = t.alpha('text', dark ? 0.05 : 0.06)
      if ('fill-opacity' in l.paint) delete l.paint['fill-opacity']
    } else if (l.type === 'line') {
      const major = id.includes('motorway') || id.includes('trunk') || id.includes('primary')
      l.paint['line-color'] = isWater
        ? t.alpha('water', 0.35)
        : major
          ? t.alpha('text', dark ? 0.2 : 0.18)
          : t.alpha('text', dark ? 0.09 : 0.1)
    } else if (l.type === 'symbol') {
      l.paint['text-color'] = t.dim
      l.paint['text-halo-color'] = t.map.labelHalo
      l.paint['text-halo-width'] = 1.2
      l.paint['icon-opacity'] = 0.5
    }
    return layer
  })
  return out
}

export interface ResolvedStyle {
  style: StyleSpecification
  /** true si le fond de carte réseau est disponible. */
  basemap: boolean
}

/**
 * Tente de charger les tuiles libres ; retombe sur le fond dégradé si
 * le réseau est absent, lent ou bloqué.
 */
export async function resolveStyle(tokens: Tokens): Promise<ResolvedStyle> {
  if (!isOnline()) return { style: FALLBACK_STYLE, basemap: false }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), STYLE_TIMEOUT_MS)
  try {
    const res = await fetch(TILE_STYLES[tokens.theme], { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const raw = (await res.json()) as StyleSpecification
    if (!raw.layers || !raw.sources) throw new Error('style invalide')
    return { style: retint(raw, tokens), basemap: true }
  } catch {
    return { style: FALLBACK_STYLE, basemap: false }
  } finally {
    clearTimeout(timer)
  }
}

/** Graticule local (0,1°) : donne une lecture de l'échelle quand il n'y a pas de fond. */
export function graticule(bbox: [number, number, number, number], step = 0.1) {
  const [w, s, e, n] = bbox
  const features: GeoJSON.Feature[] = []
  for (let lon = Math.ceil(w / step) * step; lon <= e; lon += step) {
    features.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [[Number(lon.toFixed(3)), s], [Number(lon.toFixed(3)), n]] },
    })
  }
  for (let lat = Math.ceil(s / step) * step; lat <= n; lat += step) {
    features.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [[w, Number(lat.toFixed(3))], [e, Number(lat.toFixed(3))]] },
    })
  }
  return { type: 'FeatureCollection', features } as GeoJSON.FeatureCollection
}
