import { SCREENS, type ScreenId } from '../components/Nav'
import { DEMO_COMMUNE_ID } from '../api/client'

/**
 * Deux échelles, une seule barre d'adresse :
 *   #/region                        → vue régionale (point d'entrée)
 *   #/commune/<id>/<écran>          → vue communale
 */
export type Route = { level: 'region' } | { level: 'commune'; communeId: string; screen: ScreenId }

export const DEFAULT_SCREEN: ScreenId = 'carte'

const isScreen = (v: string): v is ScreenId => SCREENS.some((s) => s.id === v)

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts[0] === 'commune' && parts[1]) {
    const screen = parts[2] && isScreen(parts[2]) ? parts[2] : DEFAULT_SCREEN
    return { level: 'commune', communeId: decodeURIComponent(parts[1]), screen }
  }
  // Compatibilité : un ancien lien #carte ou #tableau ouvre la commune de démonstration.
  if (parts.length === 1 && isScreen(parts[0])) {
    return { level: 'commune', communeId: DEMO_COMMUNE_ID, screen: parts[0] }
  }
  return { level: 'region' }
}

export function toHash(route: Route): string {
  if (route.level === 'region') return '#/region'
  return `#/commune/${encodeURIComponent(route.communeId)}/${route.screen}`
}
