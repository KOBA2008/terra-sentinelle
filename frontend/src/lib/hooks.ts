import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { isDemoOffline, isOnline, subscribeNetwork } from './network'
import { getLastError, getOrigin, subscribeOrigin, type DataOrigin } from './store'
import { getObservations, subscribeQueue } from './offlineQueue'
import { getResolvedTheme, getThemeChoice, subscribeTheme, type ResolvedTheme, type ThemeChoice } from './theme'
import { readTokens, type Tokens } from './tokens'
import type { Observation } from '../types'

/** Choix de thème courant (clair / sombre / système). */
export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribeTheme, getThemeChoice, () => 'system' as ThemeChoice)
}

/** Thème réellement appliqué une fois la préférence système résolue. */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribeTheme, getResolvedTheme, () => 'light' as ResolvedTheme)
}

/** Jetons de couleur du thème actif, pour les couleurs pilotées en JavaScript. */
export function useTokens(): Tokens {
  return useSyncExternalStore(subscribeTheme, readTokens, readTokens)
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeNetwork, isOnline, () => true)
}

export function useDemoOffline(): boolean {
  return useSyncExternalStore(subscribeNetwork, isDemoOffline, () => false)
}

export function useDataOrigin(): { origin: DataOrigin; error: string | null } {
  const origin = useSyncExternalStore(subscribeOrigin, getOrigin, () => 'local' as DataOrigin)
  const error = useSyncExternalStore(subscribeOrigin, getLastError, () => null)
  return { origin, error }
}

export function useObservations(): Observation[] {
  const empty = useRef<Observation[]>([])
  return useSyncExternalStore(subscribeQueue, getObservations, () => empty.current)
}

type AsyncState<T> = { data: T | null; loading: boolean; error: string | null }

/** Charge une ressource une fois ; ne rejette jamais (le client bascule en local). */
export function useResource<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ data: null, loading: true, error: null })
  const [tick, setTick] = useState(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true }))
    loaderRef.current()
      .then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((e: unknown) =>
        alive && setState({ data: null, loading: false, error: e instanceof Error ? e.message : 'erreur' }),
      )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { ...state, reload }
}
