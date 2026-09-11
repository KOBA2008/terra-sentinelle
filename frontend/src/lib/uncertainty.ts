import { daysSince } from './format'
import type { FrictionProps } from '../types'

/** Seuils d'incertitude : une donnée ancienne ou peu fiable s'affiche en pointillés. */
export const STALE_DAYS = 120
export const LOW_CONFIDENCE = 0.7

export function isStale(detected_on: string): boolean {
  return daysSince(detected_on) > STALE_DAYS
}

export function isUncertain(p: Pick<FrictionProps, 'confidence' | 'detected_on'>): boolean {
  return p.confidence < LOW_CONFIDENCE || isStale(p.detected_on)
}

export function uncertaintyReason(p: Pick<FrictionProps, 'confidence' | 'detected_on'>): string | null {
  const stale = isStale(p.detected_on)
  const low = p.confidence < LOW_CONFIDENCE
  if (stale && low) return 'Observation ancienne et confiance faible'
  if (stale) return `Dernière observation il y a ${daysSince(p.detected_on)} jours`
  if (low) return `Confiance sous le seuil de ${Math.round(LOW_CONFIDENCE * 100)} %`
  return null
}
