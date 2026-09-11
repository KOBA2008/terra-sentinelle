import { Badge } from './glass'
import { useDataOrigin, useObservations, useOnline } from '../lib/hooks'

/** Indique si l'écran est alimenté par l'API ou par les fixtures locales. */
export function OriginBadge() {
  const { origin, error } = useDataOrigin()
  if (origin === 'api') {
    return (
      <Badge tone="accent" dot title="Données servies par l'API Terra Sentinelle">
        API en ligne
      </Badge>
    )
  }
  return (
    <Badge tone="neutral" dot title={`API injoignable${error ? ` (${error})` : ''} : fixtures embarquées`}>
      données locales
    </Badge>
  )
}

export function NetworkBadge() {
  const online = useOnline()
  const pending = useObservations().filter((o) => !o.synced).length
  return (
    <Badge tone={online ? 'accent' : 'amber'} dot>
      {online ? 'réseau' : 'hors connexion'}
      {pending > 0 && <span className="font-mono">· {pending}</span>}
    </Badge>
  )
}
