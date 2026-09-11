import { useCallback, useEffect, useState } from 'react'
import {
  getCommune,
  getCorridor,
  getFriction,
  getLayer,
  getModel,
  getPredictions,
  getStats,
  runPrediction,
  validateFriction,
} from '../api/client'
import { enqueue, markSynced } from './offlineQueue'
import { isOnline } from './network'
import { useResource } from './hooks'
import type {
  Commune,
  CorridorCollection,
  FeatureCollection,
  FrictionCollection,
  FrictionStatus,
  ModelCard,
  PredictionCollection,
  Stats,
} from '../types'

export const AGENT = 'Moussa Gounou'

export interface AppData {
  communeId: string
  commune: Commune | null
  corridor: CorridorCollection | null
  friction: FrictionCollection | null
  villages: FeatureCollection | null
  water: FeatureCollection | null
  pastures: FeatureCollection | null
  parcels: FeatureCollection | null
  stats: Stats | null
  /** Cellules prédites par le modèle : sorties NON validées localement. */
  predictions: PredictionCollection | null
  predicting: boolean
  predictedAt: string | null
  runPredict: () => Promise<void>
  loading: boolean
  busyId: string | null
  agent: string
  validate: (id: string, status: Exclude<FrictionStatus, 'pending'>, note: string) => Promise<void>
}

/** Carte du modèle réel (GET /api/model) : partagée par tous les écrans. */
export function useModelCard(): { model: ModelCard | null; loading: boolean } {
  const res = useResource(getModel, [])
  return { model: res.data, loading: res.loading }
}

/**
 * Charge l'ensemble des couches de la commune courante et garde l'état des
 * validations pour que tous les écrans partagent la même situation.
 * Un changement de commune recharge tout.
 */
export function useAppData(communeId: string): AppData {
  const communeRes = useResource(() => getCommune(communeId), [communeId])
  const corridorRes = useResource(() => getCorridor(communeId), [communeId])
  const frictionRes = useResource(() => getFriction(communeId, 2026), [communeId])
  const villagesRes = useResource(() => getLayer(communeId, 'villages'), [communeId])
  const waterRes = useResource(() => getLayer(communeId, 'water_points'), [communeId])
  const pasturesRes = useResource(() => getLayer(communeId, 'pastures'), [communeId])
  const parcelsRes = useResource(() => getLayer(communeId, 'parcels'), [communeId])
  const statsRes = useResource(() => getStats(communeId), [communeId])

  const [friction, setFriction] = useState<FrictionCollection | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [predictions, setPredictions] = useState<PredictionCollection | null>(null)
  const [predicting, setPredicting] = useState(false)
  const [predictedAt, setPredictedAt] = useState<string | null>(null)

  useEffect(() => {
    setFriction(null)
    setPredictions(null)
    setPredictedAt(null)
  }, [communeId])

  // Cellules déjà calculées : chargées sans relancer d'inférence.
  useEffect(() => {
    let alive = true
    getPredictions(communeId).then((fc) => {
      if (alive && fc?.features?.length) setPredictions(fc)
    })
    return () => {
      alive = false
    }
  }, [communeId])

  const runPredict = useCallback(async () => {
    setPredicting(true)
    try {
      const fc = await runPrediction(communeId)
      setPredictions(fc)
      setPredictedAt(new Date().toISOString())
    } finally {
      setPredicting(false)
    }
  }, [communeId])

  useEffect(() => {
    if (frictionRes.data) setFriction(frictionRes.data)
  }, [frictionRes.data])

  const validate = useCallback(
    async (id: string, status: Exclude<FrictionStatus, 'pending'>, note: string) => {
      setBusyId(id)
      const online = isOnline()
      // Trace locale systématique : elle alimente le journal et la file de synchronisation.
      const obs = enqueue({ friction_id: id, status, note, agent: AGENT, offline: !online })
      try {
        const updated = await validateFriction(communeId, id, { status, note, agent: AGENT })
        if (online) markSynced([obs.id])
        setFriction((prev) =>
          prev
            ? {
                ...prev,
                features: prev.features.map((f) =>
                  f.properties.id === id
                    ? { ...f, properties: { ...f.properties, ...updated.properties, status } }
                    : f,
                ),
              }
            : prev,
        )
      } finally {
        setBusyId(null)
      }
    },
    [communeId],
  )

  return {
    communeId,
    commune: communeRes.data,
    corridor: corridorRes.data,
    friction,
    villages: villagesRes.data,
    water: waterRes.data,
    pastures: pasturesRes.data,
    parcels: parcelsRes.data,
    stats: statsRes.data,
    predictions,
    predicting,
    predictedAt,
    runPredict,
    loading: communeRes.loading || frictionRes.loading,
    busyId,
    agent: AGENT,
    validate,
  }
}
