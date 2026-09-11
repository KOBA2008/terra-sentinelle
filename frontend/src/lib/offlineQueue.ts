import type { FrictionStatus, Observation } from '../types'

const KEY = 'terra-sentinelle.observations.v1'
type Listener = () => void
const listeners = new Set<Listener>()

let cache: Observation[] | null = null

function read(): Observation[] {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(KEY)
    cache = raw ? (JSON.parse(raw) as Observation[]) : []
  } catch {
    cache = []
  }
  return cache
}

function write(next: Observation[]) {
  cache = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* stockage indisponible : la file reste en mémoire pour la session */
  }
  listeners.forEach((l) => l())
}

export const getObservations = () => read()
export const getPending = () => read().filter((o) => !o.synced)

export function subscribeQueue(cb: Listener) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function enqueue(input: {
  friction_id: string
  status: Exclude<FrictionStatus, 'pending'>
  note: string
  agent: string
  offline: boolean
}): Observation {
  const obs: Observation = {
    id: `OBS-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`,
    friction_id: input.friction_id,
    status: input.status,
    note: input.note,
    agent: input.agent,
    recorded_at: new Date().toISOString(),
    synced: false,
    offline: input.offline,
  }
  write([obs, ...read().filter((o) => !(o.friction_id === obs.friction_id && !o.synced))])
  return obs
}

export function markSynced(ids: string[]) {
  const set = new Set(ids)
  write(read().map((o) => (set.has(o.id) ? { ...o, synced: true } : o)))
}

export function clearSynced() {
  write(read().filter((o) => !o.synced))
}

export function clearAll() {
  write([])
}
