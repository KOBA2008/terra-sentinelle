/**
 * Thème clair / sombre / système.
 * Le choix persiste en localStorage et s'applique sans rechargement :
 * il pose `data-theme` sur <html>, ce qui bascule les variables CSS.
 */
export type ThemeChoice = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const KEY = 'terra-sentinelle.theme.v1'
type Listener = () => void
const listeners = new Set<Listener>()

const media = (): MediaQueryList | null =>
  typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null

function readStored(): ThemeChoice {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  } catch {
    /* stockage indisponible : on reste sur la préférence système */
  }
  return 'system'
}

let choice: ThemeChoice = typeof window === 'undefined' ? 'system' : readStored()

export const systemTheme = (): ResolvedTheme => (media()?.matches ? 'dark' : 'light')

export const getThemeChoice = (): ThemeChoice => choice
export const getResolvedTheme = (): ResolvedTheme => (choice === 'system' ? systemTheme() : choice)

function apply() {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (choice === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', choice)
  root.style.colorScheme = getResolvedTheme()
}

export function setThemeChoice(next: ThemeChoice) {
  if (choice === next) return
  choice = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    /* le thème reste appliqué pour la session */
  }
  apply()
  listeners.forEach((l) => l())
}

export function subscribeTheme(cb: Listener) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** À appeler une fois au démarrage, avant le premier rendu. */
export function initTheme() {
  apply()
  const mq = media()
  // Un changement de préférence système doit se voir immédiatement en mode « système ».
  mq?.addEventListener?.('change', () => {
    if (choice === 'system') {
      apply()
      listeners.forEach((l) => l())
    }
  })
}

export const THEME_LABELS: Record<ThemeChoice, string> = {
  light: 'Clair',
  dark: 'Sombre',
  system: 'Système',
}
