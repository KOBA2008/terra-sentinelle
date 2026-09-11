/**
 * Lecture des jetons de couleur du thème actif.
 * Les composants qui ont besoin d'une couleur en JavaScript (peintures MapLibre,
 * styles en ligne, dégradés) la demandent ici : aucune valeur n'est écrite en dur.
 */
import { getResolvedTheme, type ResolvedTheme } from './theme'

/** Repli si le CSS n'est pas encore appliqué (premier rendu, test hors DOM). */
const FALLBACK: Record<ResolvedTheme, Record<string, string>> = {
  light: {
    '--accent-rgb': '15 157 107',
    '--amber-rgb': '176 118 10',
    '--red-rgb': '206 65 57',
    '--sand-rgb': '154 111 70',
    '--water-rgb': '30 127 168',
    '--text-rgb': '14 26 20',
    '--dim-rgb': '86 104 96',
    '--bg-rgb': '242 246 243',
    '--bg-deep-rgb': '231 237 233',
    '--bg-raise-rgb': '255 255 255',
    '--sev-1': '#0f9d6b',
    '--sev-2': '#5c9a3a',
    '--sev-3': '#b0760a',
    '--sev-4': '#c2601c',
    '--sev-5': '#ce4139',
    '--accent-ink': '#0a7a52',
    '--amber-ink': '#8a5b00',
    '--red-ink': '#b4312a',
    '--sand-ink': '#7c5735',
    '--map-bg': '#eef3ef',
    '--map-axis': '#24463a',
    '--map-casing': 'rgba(255,255,255,0.9)',
    '--map-graticule': 'rgba(14,26,20,0.07)',
    '--map-extent-fill': 'rgba(36,70,58,0.1)',
    '--map-extent-line': 'rgba(36,70,58,0.45)',
    '--map-label': '#14261e',
    '--map-label-halo': 'rgba(255,255,255,0.95)',
    '--map-node': '#24463a',
  },
  dark: {
    '--accent-rgb': '52 211 153',
    '--amber-rgb': '245 181 68',
    '--red-rgb': '240 102 95',
    '--sand-rgb': '217 180 143',
    '--water-rgb': '94 200 229',
    '--text-rgb': '233 242 237',
    '--dim-rgb': '147 167 157',
    '--bg-rgb': '12 23 18',
    '--bg-deep-rgb': '8 15 12',
    '--bg-raise-rgb': '17 32 26',
    '--sev-1': '#34d399',
    '--sev-2': '#9ad07a',
    '--sev-3': '#f5b544',
    '--sev-4': '#ee8a4e',
    '--sev-5': '#f0665f',
    '--accent-ink': '#34d399',
    '--amber-ink': '#f5b544',
    '--red-ink': '#f0665f',
    '--sand-ink': '#d9b48f',
    '--map-bg': '#0a1410',
    '--map-axis': '#e9f2ed',
    '--map-casing': 'rgba(5,11,8,0.85)',
    '--map-graticule': 'rgba(255,255,255,0.05)',
    '--map-extent-fill': 'rgba(233,242,237,0.1)',
    '--map-extent-line': 'rgba(233,242,237,0.5)',
    '--map-label': '#e9f2ed',
    '--map-label-halo': 'rgba(8,15,12,0.95)',
    '--map-node': '#e9f2ed',
  },
}

function raw(name: string, theme: ResolvedTheme): string {
  if (typeof document !== 'undefined') {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    if (v) return v
  }
  return FALLBACK[theme][name] ?? ''
}

export interface Tokens {
  theme: ResolvedTheme
  accent: string
  amber: string
  red: string
  sand: string
  water: string
  text: string
  dim: string
  bg: string
  bgRaise: string
  /** Variantes sûres pour le petit texte (contraste AA). */
  accentInk: string
  amberInk: string
  redInk: string
  sandInk: string
  severity: [string, string, string, string, string]
  map: {
    bg: string
    axis: string
    casing: string
    graticule: string
    extentFill: string
    extentLine: string
    label: string
    labelHalo: string
    node: string
  }
  /** Couleur sémantique avec opacité, ex. alpha('accent', .15). */
  alpha: (key: 'accent' | 'amber' | 'red' | 'sand' | 'water' | 'text' | 'dim', a: number) => string
}

let cache: Tokens | null = null
let cacheTheme: ResolvedTheme | null = null

export function readTokens(): Tokens {
  const theme = getResolvedTheme()
  if (cache && cacheTheme === theme) return cache
  const triplet = (n: string) => raw(n, theme)
  const rgb = (n: string) => `rgb(${triplet(n)})`
  const triplets = {
    accent: triplet('--accent-rgb'),
    amber: triplet('--amber-rgb'),
    red: triplet('--red-rgb'),
    sand: triplet('--sand-rgb'),
    water: triplet('--water-rgb'),
    text: triplet('--text-rgb'),
    dim: triplet('--dim-rgb'),
  }
  const t: Tokens = {
    theme,
    accent: rgb('--accent-rgb'),
    amber: rgb('--amber-rgb'),
    red: rgb('--red-rgb'),
    sand: rgb('--sand-rgb'),
    water: rgb('--water-rgb'),
    text: rgb('--text-rgb'),
    dim: rgb('--dim-rgb'),
    bg: rgb('--bg-rgb'),
    bgRaise: rgb('--bg-raise-rgb'),
    accentInk: raw('--accent-ink', theme),
    amberInk: raw('--amber-ink', theme),
    redInk: raw('--red-ink', theme),
    sandInk: raw('--sand-ink', theme),
    severity: [
      raw('--sev-1', theme),
      raw('--sev-2', theme),
      raw('--sev-3', theme),
      raw('--sev-4', theme),
      raw('--sev-5', theme),
    ],
    map: {
      bg: raw('--map-bg', theme),
      axis: raw('--map-axis', theme),
      casing: raw('--map-casing', theme),
      graticule: raw('--map-graticule', theme),
      extentFill: raw('--map-extent-fill', theme),
      extentLine: raw('--map-extent-line', theme),
      label: raw('--map-label', theme),
      labelHalo: raw('--map-label-halo', theme),
      node: raw('--map-node', theme),
    },
    alpha: (key, a) => `rgb(${triplets[key]} / ${a})`,
  }
  cache = t
  cacheTheme = theme
  return t
}

/** Invalide le cache : appelé à chaque bascule de thème. */
export function invalidateTokens() {
  cache = null
  cacheTheme = null
}
