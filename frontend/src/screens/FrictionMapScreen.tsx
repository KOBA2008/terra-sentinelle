import { useEffect, useMemo, useState } from 'react'
import { MapView, type LayerVisibility } from '../components/map/MapView'
import { LayerPanel } from '../components/LayerPanel'
import { FrictionList } from '../components/FrictionList'
import { DetectionSheet } from '../components/DetectionSheet'
import { PredictionPanel } from '../components/PredictionPanel'
import { PredictionSheet } from '../components/PredictionSheet'
import { BottomSheet } from '../components/BottomSheet'
import { GlassPanel } from '../components/glass'
import { geometryBBox, padBBox, type BBox } from '../lib/geo'
import { isUncertain } from '../lib/uncertainty'
import type { AppData } from '../lib/appData'
import type { FrictionStatus } from '../types'

const FILTERS: { id: 'all' | FrictionStatus | 'uncertain'; label: string }[] = [
  { id: 'all', label: 'Toutes' },
  { id: 'pending', label: 'En attente' },
  { id: 'confirmed', label: 'Confirmées' },
  { id: 'uncertain', label: 'Incertaines' },
]

export function FrictionMapScreen({ data }: { data: AppData }) {
  const {
    commune,
    corridor,
    friction,
    villages,
    water,
    pastures,
    parcels,
    predictions,
    predicting,
    predictedAt,
    runPredict,
    validate,
    busyId,
    agent,
  } = data
  const corridorName =
    corridor?.features.find((f) => f.properties.kind === 'axis')?.properties.id ?? 'couloir communal'
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedPredId, setSelectedPredId] = useState<string | null>(null)
  const [focus, setFocus] = useState<BBox | null>(null)
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all')
  const [basemap, setBasemap] = useState<boolean | null>(null)
  const [showLayers, setShowLayers] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [visibility, setVisibility] = useState<LayerVisibility>({
    corridor: true,
    friction: true,
    predictions: false,
    villages: true,
    water_points: true,
    pastures: true,
    parcels: false,
  })

  // Dès que des cellules prédites existent, la couche s'allume : elle est
  // hachurée et légendée, elle ne peut pas être prise pour une friction validée.
  const hasPredictions = !!predictions?.features.length
  useEffect(() => {
    if (hasPredictions) setVisibility((v) => (v.predictions ? v : { ...v, predictions: true }))
  }, [hasPredictions])

  const features = useMemo(() => {
    const list = friction?.features ?? []
    const filtered = list.filter((f) => {
      if (filter === 'all') return true
      if (filter === 'uncertain') return isUncertain(f.properties)
      return f.properties.status === filter
    })
    return [...filtered].sort(
      (a, b) =>
        b.properties.severity - a.properties.severity || b.properties.confidence - a.properties.confidence,
    )
  }, [friction, filter])

  const selected = friction?.features.find((f) => f.properties.id === selectedId) ?? null
  const selectedPred = predictions?.features.find((f) => f.properties.id === selectedPredId) ?? null

  const zoomTo = (id: string) => {
    const f = friction?.features.find((x) => x.properties.id === id)
    if (f) setFocus(padBBox(geometryBBox(f.geometry), 3.2))
  }

  const zoomToPrediction = (id: string) => {
    const f = predictions?.features.find((x) => x.properties.id === id)
    if (f) setFocus(padBBox(geometryBBox(f.geometry), 1.6))
  }

  const select = (id: string) => {
    setSelectedPredId(null)
    setSelectedId(id)
    zoomTo(id)
  }

  const selectPrediction = (id: string) => {
    setSelectedId(null)
    setSelectedPredId(id)
  }

  const center = commune?.center ?? [2.438, 11.298]
  const bbox = (commune?.bbox ?? [2.2, 11.05, 2.72, 11.55]) as BBox

  const runAndShow = () => {
    setVisibility((v) => ({ ...v, predictions: true }))
    void runPredict()
  }

  const predictionPanel = (compact: boolean) => (
    <PredictionPanel
      predictions={predictions}
      predicting={predicting}
      predictedAt={predictedAt}
      visible={visibility.predictions}
      onToggleVisible={() => setVisibility((v) => ({ ...v, predictions: !v.predictions }))}
      onRun={runAndShow}
      communeName={commune?.name ?? 'la commune'}
      compact={compact}
    />
  )

  const filterRow = (
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {FILTERS.map((f) => (
        <button
          key={f.id}
          onClick={() => setFilter(f.id)}
          className={`spring shrink-0 rounded-full border px-3 py-2 text-[12px] ${
            filter === f.id
              ? 'border-line-strong bg-surf-3 text-ink'
              : 'border-line bg-surf text-dim hover:text-ink'
          }`}
        >
          {f.label}
        </button>
      ))}
    </div>
  )

  return (
    <div className="relative h-full w-full">
      <MapView
        center={center}
        bbox={bbox}
        corridor={corridor}
        friction={friction}
        villages={villages}
        water={water}
        pastures={pastures}
        parcels={parcels}
        predictions={predictions}
        selectedPredictionId={selectedPredId}
        onSelectPrediction={selectPrediction}
        visibility={visibility}
        selectedId={selectedId}
        onSelect={select}
        focus={focus}
        onBasemapChange={setBasemap}
      />

      {/* ---------------- Colonne gauche : écrans larges ---------------- */}
      <div className="pointer-events-none absolute bottom-4 left-4 top-[120px] z-20 hidden w-[252px] flex-col items-start justify-end gap-2 overflow-y-auto lg:flex">
        <div className="pointer-events-auto fade-up w-full">{predictionPanel(false)}</div>
        {showLayers && (
          <div className="pointer-events-auto fade-up">
            <LayerPanel
              visibility={visibility}
              basemap={basemap}
              onToggle={(k) => setVisibility((v) => ({ ...v, [k]: !v[k] }))}
            />
          </div>
        )}
        <button
          onClick={() => setShowLayers((s) => !s)}
          className="glass-btn pointer-events-auto min-h-[40px] px-3 py-1.5 text-[12px]"
        >
          {showLayers ? 'Masquer les couches' : 'Couches'}
        </button>
      </div>

      {/* ---------------- Liste des frictions : écrans larges ---------------- */}
      <div className="absolute bottom-4 right-4 top-[124px] z-10 hidden w-[344px] lg:block">
        <GlassPanel className="flex h-full flex-col overflow-hidden rounded-[26px]">
          <div className="border-b border-line px-4 py-3.5">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-[15px] font-semibold text-ink">Zones de friction</h2>
              <span className="font-mono text-[12px] text-dim">
                {features.length}/{friction?.features.length ?? 0}
              </span>
            </div>
            <p className="mt-1 text-[12px] leading-snug text-dim">
              Triées par gravité décroissante. {commune?.name ?? 'Commune'} · saison 2026 · {corridorName}.
            </p>
            <div className="mt-2.5">{filterRow}</div>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <FrictionList features={features} selectedId={selectedId} onSelect={select} />
          </div>
        </GlassPanel>
      </div>

      {/* ---------------- Fiche ouverte : écrans larges ---------------- */}
      {(selected || selectedPred) && (
        <div className="absolute bottom-4 left-[280px] top-[120px] z-20 hidden w-[370px] lg:block">
          {selected ? (
            <DetectionSheet
              feature={selected}
              agent={agent}
              busy={busyId === selected.properties.id}
              onValidate={(status, note) => validate(selected.properties.id, status, note)}
              onClose={() => setSelectedId(null)}
              onZoom={() => zoomTo(selected.properties.id)}
            />
          ) : selectedPred ? (
            <PredictionSheet
              feature={selectedPred}
              onClose={() => setSelectedPredId(null)}
              onZoom={() => zoomToPrediction(selectedPred.properties.id)}
            />
          ) : null}
        </div>
      )}

      {/* ---------------- Téléphone et tablette : feuille inférieure ---------------- */}
      <div className="absolute inset-x-0 bottom-[70px] z-20 md:bottom-0 lg:hidden">
        {selected ? (
          <div className="max-h-[64vh] overflow-hidden rounded-t-[24px]">
            <DetectionSheet
              feature={selected}
              agent={agent}
              compact
              busy={busyId === selected.properties.id}
              onValidate={(status, note) => validate(selected.properties.id, status, note)}
              onClose={() => setSelectedId(null)}
              onZoom={() => zoomTo(selected.properties.id)}
            />
          </div>
        ) : selectedPred ? (
          <div className="max-h-[64vh] overflow-hidden rounded-t-[24px]">
            <PredictionSheet
              feature={selectedPred}
              onClose={() => setSelectedPredId(null)}
              onZoom={() => zoomToPrediction(selectedPred.properties.id)}
            />
          </div>
        ) : (
          <BottomSheet
            title="Zones de friction"
            meta={`${features.length}/${friction?.features.length ?? 0}`}
            open={sheetOpen}
            onToggle={() => setSheetOpen((s) => !s)}
          >
            <div className="px-4 pb-4">
              <p className="text-[12px] leading-snug text-dim">
                {commune?.name ?? 'Commune'} · saison 2026 · {corridorName}
              </p>
              <div className="mt-2.5">{filterRow}</div>
              <div className="mt-2.5">{predictionPanel(true)}</div>
              <div className="mt-2.5">
                <FrictionList features={features} selectedId={selectedId} onSelect={select} />
              </div>
              <details className="mt-2.5">
                <summary className="flex min-h-[44px] cursor-pointer items-center text-[12.5px] text-ink">
                  Couches et légende
                </summary>
                <div className="mt-2">
                  <LayerPanel
                    visibility={visibility}
                    basemap={basemap}
                    onToggle={(k) => setVisibility((v) => ({ ...v, [k]: !v[k] }))}
                    className="w-full"
                  />
                </div>
              </details>
            </div>
          </BottomSheet>
        )}
      </div>
    </div>
  )
}
