/**
 * État réseau de l'application.
 * Combine l'état réel du navigateur et un interrupteur de démonstration
 * qui permet de simuler une perte de réseau pendant la présentation.
 */
type Listener = () => void

let demoOffline = false
let browserOnline = typeof navigator === 'undefined' ? true : navigator.onLine
const listeners = new Set<Listener>()

const emit = () => listeners.forEach((l) => l())

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    browserOnline = true
    emit()
  })
  window.addEventListener('offline', () => {
    browserOnline = false
    emit()
  })
}

export const isOnline = () => browserOnline && !demoOffline
export const isDemoOffline = () => demoOffline

export function setDemoOffline(value: boolean) {
  if (demoOffline === value) return
  demoOffline = value
  emit()
}

export function subscribeNetwork(cb: Listener) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
