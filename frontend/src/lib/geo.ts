import type { Feature, Geometry, RouteAlternative } from '../types'

export type BBox = [number, number, number, number]

function extendPoint(b: BBox, c: number[]) {
  b[0] = Math.min(b[0], c[0])
  b[1] = Math.min(b[1], c[1])
  b[2] = Math.max(b[2], c[0])
  b[3] = Math.max(b[3], c[1])
}

export function geometryBBox(g: Geometry): BBox {
  const b: BBox = [180, 90, -180, -90]
  if (g.type === 'Point') extendPoint(b, g.coordinates)
  else if (g.type === 'LineString') g.coordinates.forEach((c) => extendPoint(b, c))
  else g.coordinates.forEach((ring) => ring.forEach((c) => extendPoint(b, c)))
  return b
}

export function featureCenter(f: Feature<unknown, Geometry>): [number, number] {
  const [w, s, e, n] = geometryBBox(f.geometry)
  return [(w + e) / 2, (s + n) / 2]
}

export function padBBox(b: BBox, ratio = 0.35): BBox {
  const dx = Math.max((b[2] - b[0]) * ratio, 0.01)
  const dy = Math.max((b[3] - b[1]) * ratio, 0.01)
  return [b[0] - dx, b[1] - dy, b[2] + dx, b[3] + dy]
}

/**
 * Découpe un itinéraire en tronçons certains / incertains,
 * afin d'afficher les seconds en pointillés.
 */
export function splitRoute(route: RouteAlternative): GeoJSON.FeatureCollection {
  const coords = route.geometry.coordinates
  const uncertain = new Set<number>()
  route.uncertain_segments.forEach(([a, b]) => {
    for (let i = a; i < b; i++) uncertain.add(i)
  })
  const features: GeoJSON.Feature[] = []
  let current: number[][] = [coords[0]]
  let currentFlag = uncertain.has(0)
  for (let i = 1; i < coords.length; i++) {
    const flag = uncertain.has(i - 1)
    if (flag !== currentFlag) {
      current.push(coords[i - 1])
      features.push({
        type: 'Feature',
        properties: { route_id: route.id, uncertain: currentFlag ? 1 : 0 },
        geometry: { type: 'LineString', coordinates: current.length > 1 ? current : [current[0], coords[i - 1]] },
      })
      current = [coords[i - 1]]
      currentFlag = flag
    }
    current.push(coords[i])
  }
  if (current.length > 1) {
    features.push({
      type: 'Feature',
      properties: { route_id: route.id, uncertain: currentFlag ? 1 : 0 },
      geometry: { type: 'LineString', coordinates: current },
    })
  }
  return { type: 'FeatureCollection', features }
}

export const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
