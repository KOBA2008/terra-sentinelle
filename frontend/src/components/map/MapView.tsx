import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type Map as MlMap } from 'maplibre-gl'
import { graticule, resolveStyle } from './style'
import { buildLayers, HATCH_IMAGE, LAYER_GROUPS, SRC } from './layers'
import { isUncertain } from '../../lib/uncertainty'
import { EMPTY_FC, splitRoute, type BBox } from '../../lib/geo'
import { useTokens } from '../../lib/hooks'
import type { Tokens } from '../../lib/tokens'
import type {
  CorridorCollection,
  FeatureCollection,
  FrictionCollection,
  PredictionCollection,
  RouteAlternative,
} from '../../types'

export interface LayerVisibility {
  corridor: boolean
  friction: boolean
  /** Cellules prédites par le modèle : jamais confondues avec les frictions. */
  predictions: boolean
  villages: boolean
  water_points: boolean
  pastures: boolean
  parcels: boolean
}

export interface MapViewProps {
  center: [number, number]
  bbox: BBox
  corridor?: CorridorCollection | null
  friction?: FrictionCollection | null
  villages?: FeatureCollection | null
  water?: FeatureCollection | null
  pastures?: FeatureCollection | null
  parcels?: FeatureCollection | null
  /** Sorties de modèle non validées : hachurées, contour pointillé. */
  predictions?: PredictionCollection | null
  selectedPredictionId?: string | null
  onSelectPrediction?: (id: string) => void
  /** Vue régionale : pastilles des communes et réseau inter-communal. */
  communes?: FeatureCollection | null
  network?: FeatureCollection | null
  selectedCommuneId?: string | null
  onSelectCommune?: (id: string) => void
  visibility?: Partial<LayerVisibility>
  selectedId?: string | null
  onSelect?: (id: string) => void
  routes?: RouteAlternative[]
  activeRouteId?: string | null
  focus?: BBox | null
  zoom?: number
  className?: string
  /** Remonte l'état du fond de carte (réseau ou secours CSS). */
  onBasemapChange?: (available: boolean) => void
}

const DEFAULT_VISIBILITY: LayerVisibility = {
  corridor: true,
  friction: true,
  predictions: false,
  villages: true,
  water_points: true,
  pastures: true,
  parcels: false,
}

/**
 * Motif de hachures 45°, généré à la couleur du thème : MapLibre n'accepte pas
 * de var() CSS, l'image est donc reconstruite à chaque bascule de thème.
 */
function hatchImage(color: string, size = 8): ImageData | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.clearRect(0, 0, size, size)
  ctx.strokeStyle = color
  ctx.lineWidth = 1.7
  ctx.lineCap = 'square'
  ctx.beginPath()
  ctx.moveTo(-size, size)
  ctx.lineTo(size, -size)
  ctx.moveTo(0, size * 2)
  ctx.lineTo(size * 2, 0)
  ctx.stroke()
  try {
    return ctx.getImageData(0, 0, size, size)
  } catch {
    return null
  }
}

const routeColor = (t: Tokens, id: string) =>
  id === 'ALT-A' ? t.red : id === 'ALT-B' ? t.amber : id === 'ALT-C' ? t.accent : t.dim

export function MapView({
  center,
  bbox,
  corridor,
  friction,
  villages,
  water,
  pastures,
  parcels,
  predictions,
  selectedPredictionId,
  onSelectPrediction,
  communes,
  network,
  selectedCommuneId,
  onSelectCommune,
  visibility,
  selectedId,
  onSelect,
  routes,
  activeRouteId,
  focus,
  zoom = 9.2,
  className = '',
  onBasemapChange,
}: MapViewProps) {
  const t = useTokens()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MlMap | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const selectRef = useRef(onSelect)
  selectRef.current = onSelect
  const selectCommuneRef = useRef(onSelectCommune)
  selectCommuneRef.current = onSelectCommune
  const selectPredRef = useRef(onSelectPrediction)
  selectPredRef.current = onSelectPrediction

  const [ready, setReady] = useState(false)
  const [basemap, setBasemap] = useState<boolean | null>(null)
  const [failed, setFailed] = useState(false)

  const vis = { ...DEFAULT_VISIBILITY, ...visibility }

  /** Les frictions reçoivent un marqueur d'incertitude utilisé par le style. */
  const frictionData = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!friction) return EMPTY_FC
    return {
      type: 'FeatureCollection',
      features: friction.features.map((f) => ({
        type: 'Feature' as const,
        id: undefined,
        geometry: f.geometry as unknown as GeoJSON.Geometry,
        properties: { ...f.properties, uncertain: isUncertain(f.properties) ? 1 : 0 },
      })),
    }
  }, [friction])

  const routeData = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!routes?.length) return EMPTY_FC
    const features = routes.flatMap((r) =>
      splitRoute(r).features.map((f) => ({
        ...f,
        properties: {
          ...f.properties,
          color: routeColor(t, r.id),
          active: activeRouteId === r.id ? 1 : 0,
        },
      })),
    )
    return { type: 'FeatureCollection', features }
  }, [routes, activeRouteId, t])

  const predictionData = (predictions ?? EMPTY_FC) as unknown as GeoJSON.FeatureCollection

  const corridorData = (corridor ?? EMPTY_FC) as unknown as GeoJSON.FeatureCollection

  // --- Création de la carte (recréée à chaque bascule de thème) ---
  useEffect(() => {
    let cancelled = false
    let map: MlMap | null = null

    resolveStyle(t).then(({ style, basemap: hasBasemap }) => {
      if (cancelled || !containerRef.current) return
      setBasemap(hasBasemap)
      onBasemapChange?.(hasBasemap)
      try {
        map = new maplibregl.Map({
          container: containerRef.current,
          style,
          center,
          zoom,
          attributionControl: { compact: true },
          maxZoom: 15,
          dragRotate: false,
        })
      } catch {
        // WebGL indisponible : le fond dégradé et les panneaux restent utilisables.
        setFailed(true)
        return
      }
      mapRef.current = map
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
      map.on('error', () => {
        /* tuiles indisponibles : les couches GeoJSON restent affichées */
      })
      map.on('load', () => {
        if (cancelled || !map) return
        const add = (id: string, data: GeoJSON.FeatureCollection) =>
          map!.addSource(id, { type: 'geojson', data })

        const span = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1])
        add(SRC.graticule, hasBasemap ? EMPTY_FC : graticule(bbox, span > 2 ? 0.5 : 0.1))
        add(SRC.predictions, EMPTY_FC)
        add(SRC.parcels, EMPTY_FC)
        add(SRC.pastures, EMPTY_FC)
        add(SRC.extent, EMPTY_FC)
        add(SRC.network, EMPTY_FC)
        add(SRC.axis, EMPTY_FC)
        add(SRC.routes, EMPTY_FC)
        add(SRC.friction, EMPTY_FC)
        add(SRC.water, EMPTY_FC)
        add(SRC.villages, EMPTY_FC)
        add(SRC.communes, EMPTY_FC)
        const hatch = hatchImage(t.sandInk)
        if (hatch && !map.hasImage(HATCH_IMAGE)) map.addImage(HATCH_IMAGE, hatch)
        buildLayers(t).forEach((l) => map!.addLayer(l))

        map.on('click', 'ts-friction-fill', (e) => {
          const id = e.features?.[0]?.properties?.id
          if (typeof id === 'string') selectRef.current?.(id)
        })
        map.on('click', 'ts-pred-tone', (e) => {
          const id = e.features?.[0]?.properties?.id
          if (typeof id === 'string') selectPredRef.current?.(id)
        })
        map.on('click', 'ts-communes-circle', (e) => {
          const id = e.features?.[0]?.properties?.id
          if (typeof id === 'string') selectCommuneRef.current?.(id)
        })
        ;['ts-friction-fill', 'ts-communes-circle', 'ts-pred-tone'].forEach((layer) => {
          map!.on('mouseenter', layer, () => {
            map!.getCanvas().style.cursor = 'pointer'
          })
          map!.on('mouseleave', layer, () => {
            map!.getCanvas().style.cursor = ''
          })
        })
        setReady(true)
      })
    })

    return () => {
      cancelled = true
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []
      mapRef.current?.remove()
      mapRef.current = null
      setReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.theme])

  // --- Données ---
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const setData = (id: string, data: GeoJSON.FeatureCollection) => {
      const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined
      src?.setData(data)
    }
    setData(SRC.predictions, predictionData)
    setData(SRC.extent, corridorData)
    setData(SRC.axis, corridorData)
    setData(SRC.friction, frictionData)
    setData(SRC.routes, routeData)
    setData(SRC.parcels, (parcels ?? EMPTY_FC) as unknown as GeoJSON.FeatureCollection)
    setData(SRC.pastures, (pastures ?? EMPTY_FC) as unknown as GeoJSON.FeatureCollection)
    setData(SRC.water, (water ?? EMPTY_FC) as unknown as GeoJSON.FeatureCollection)
    setData(SRC.villages, (villages ?? EMPTY_FC) as unknown as GeoJSON.FeatureCollection)
    setData(SRC.network, (network ?? EMPTY_FC) as unknown as GeoJSON.FeatureCollection)
    setData(SRC.communes, (communes ?? EMPTY_FC) as unknown as GeoJSON.FeatureCollection)
  }, [
    ready,
    corridorData,
    frictionData,
    routeData,
    predictionData,
    parcels,
    pastures,
    water,
    villages,
    network,
    communes,
  ])

  // --- Étiquettes en DOM (aucune police de glyphes requise) ---
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []

    const label = (
      coords: [number, number],
      text: string,
      strong: boolean,
      offsetY: number,
    ) => {
      const el = document.createElement('div')
      const span = document.createElement('span')
      span.textContent = text
      span.style.cssText = [
        'font-family:Inter,system-ui,sans-serif',
        `font-size:${strong ? '12px' : '10.5px'}`,
        `font-weight:${strong ? '600' : '500'}`,
        `color:${t.map.label}`,
        `text-shadow:0 1px 2px ${t.map.labelHalo},0 0 6px ${t.map.labelHalo},0 0 10px ${t.map.labelHalo}`,
        'display:block',
        `transform:translateY(${offsetY}px)`,
        'pointer-events:none',
        'white-space:nowrap',
        'letter-spacing:.01em',
      ].join(';')
      el.style.pointerEvents = 'none'
      el.appendChild(span)
      markersRef.current.push(
        new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(coords).addTo(map),
      )
    }

    if (communes) {
      communes.features.forEach((f) => {
        if (f.geometry.type !== 'Point') return
        const p = f.properties as { name?: string; demo?: number }
        label(f.geometry.coordinates as [number, number], String(p.name ?? ''), p.demo === 1, -16)
      })
      return
    }
    if (!villages || !vis.villages) return
    villages.features.forEach((f) => {
      if (f.geometry.type !== 'Point') return
      const p = f.properties as { name?: string; rank?: string }
      label(f.geometry.coordinates as [number, number], String(p.name ?? ''), p.rank === 'chef-lieu', -13)
    })
  }, [ready, villages, communes, vis.villages, t])

  // --- Visibilité des couches ---
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    Object.entries(LAYER_GROUPS).forEach(([group, ids]) => {
      if (group === 'network' || group === 'communes') return
      const on = vis[group as keyof LayerVisibility] !== false
      ids.forEach((id) => {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
      })
    })
  }, [
    ready,
    vis.corridor,
    vis.friction,
    vis.predictions,
    vis.villages,
    vis.water_points,
    vis.pastures,
    vis.parcels,
  ])

  // --- Sélection ---
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    if (map.getLayer('ts-friction-selected')) {
      map.setFilter('ts-friction-selected', ['==', ['get', 'id'], selectedId ?? '__none__'])
    }
    if (map.getLayer('ts-communes-selected')) {
      map.setFilter('ts-communes-selected', ['==', ['get', 'id'], selectedCommuneId ?? '__none__'])
    }
    if (map.getLayer('ts-pred-selected')) {
      map.setFilter('ts-pred-selected', ['==', ['get', 'id'], selectedPredictionId ?? '__none__'])
    }
  }, [ready, selectedId, selectedCommuneId, selectedPredictionId])

  // --- Cadrage ---
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !focus) return
    map.fitBounds(
      [
        [focus[0], focus[1]],
        [focus[2], focus[3]],
      ],
      { padding: { top: 80, bottom: 80, left: 80, right: 80 }, duration: 900, maxZoom: 13.5 },
    )
  }, [ready, focus])

  return (
    <div
      className={`relative h-full w-full overflow-hidden ${basemap === false || failed ? 'map-fallback' : 'bg-base'} ${className}`}
    >
      <div ref={containerRef} className="absolute inset-0" />
      {basemap === null && !failed && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-dim">chargement du fond…</span>
        </div>
      )}
      {failed && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center">
          <span className="max-w-[36ch] font-mono text-[11px] leading-relaxed text-dim">
            Rendu cartographique indisponible sur cet appareil (WebGL). Les frictions restent consultables dans
            le panneau latéral.
          </span>
        </div>
      )}
    </div>
  )
}
