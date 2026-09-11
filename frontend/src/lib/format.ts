const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

export function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${formatDate(iso)} · ${hh}:${mm}`
}

export function daysSince(iso: string, now = new Date()): number {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return Number.POSITIVE_INFINITY
  return Math.floor((now.getTime() - d.getTime()) / 86_400_000)
}

export function formatAge(iso: string): string {
  const d = daysSince(iso)
  if (!Number.isFinite(d)) return 'date inconnue'
  if (d <= 0) return "aujourd'hui"
  if (d === 1) return 'hier'
  if (d < 60) return `il y a ${d} j`
  return `il y a ${Math.round(d / 30)} mois`
}

export const pct = (v: number) => `${Math.round(v * 100)} %`
export const num = (v: number, d = 1) => v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })
export const int = (v: number) => v.toLocaleString('fr-FR')
