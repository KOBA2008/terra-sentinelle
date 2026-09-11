import type { FrictionStatus, Severity } from '../types'

/**
 * Les couleurs de gravité et de statut sont des variables CSS : elles changent
 * avec le thème sans qu'aucun composant ne connaisse une valeur hexadécimale.
 * (Pour MapLibre, qui ne résout pas var(), voir lib/tokens.ts.)
 */
export const SEVERITY_COLORS: Record<Severity, string> = {
  1: 'var(--sev-1)',
  2: 'var(--sev-2)',
  3: 'var(--sev-3)',
  4: 'var(--sev-4)',
  5: 'var(--sev-5)',
}

export const SEVERITY_LABELS: Record<Severity, string> = {
  1: 'Négligeable',
  2: 'Faible',
  3: 'Moyenne',
  4: 'Élevée',
  5: 'Critique',
}

export const STATUS_LABELS: Record<FrictionStatus, string> = {
  pending: 'En attente',
  confirmed: 'Confirmée',
  corrected: 'Corrigée',
  invalidated: 'Invalidée',
}

export const STATUS_COLORS: Record<FrictionStatus, string> = {
  pending: 'var(--amber-ink)',
  confirmed: 'var(--red-ink)',
  corrected: 'var(--sand-ink)',
  invalidated: 'rgb(var(--dim-rgb))',
}

export const clampSeverity = (s: number): Severity => Math.min(5, Math.max(1, Math.round(s))) as Severity

export const severityColor = (s: number): string => SEVERITY_COLORS[clampSeverity(s)]

/** Teinte translucide dérivée d'une couleur de thème (fonctionne avec var()). */
export const tint = (color: string, percent: number) =>
  `color-mix(in srgb, ${color} ${percent}%, transparent)`
