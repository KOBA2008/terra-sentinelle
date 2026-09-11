/** Petit store d'origine des données : API en ligne ou fixtures locales. */
export type DataOrigin = 'api' | 'local'

type Listener = () => void

let origin: DataOrigin = 'local'
let lastError: string | null = null
const listeners = new Set<Listener>()

export const getOrigin = () => origin
export const getLastError = () => lastError

export function setOrigin(next: DataOrigin, error: string | null = null) {
  if (origin === next && lastError === error) return
  origin = next
  lastError = error
  listeners.forEach((l) => l())
}

export function subscribeOrigin(cb: Listener) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
