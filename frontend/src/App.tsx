import { useCallback, useEffect, useState } from 'react'
import { AppShell } from './components/AppShell'
import { RegionScreen } from './screens/RegionScreen'
import { FrictionMapScreen } from './screens/FrictionMapScreen'
import { FieldScreen } from './screens/FieldScreen'
import { CommitteeScreen } from './screens/CommitteeScreen'
import { DashboardScreen } from './screens/DashboardScreen'
import { AboutScreen } from './screens/AboutScreen'
import { ModelScreen } from './screens/ModelScreen'
import { useAppData } from './lib/appData'
import { useRegionData } from './lib/regionData'
import { parseHash, toHash, type Route } from './lib/route'
import { DEMO_COMMUNE_ID } from './api/client'

/** Vue communale : montée seulement quand une commune est ouverte. */
function CommuneApp({ route }: { route: Extract<Route, { level: 'commune' }> }) {
  const data = useAppData(route.communeId)
  switch (route.screen) {
    case 'terrain':
      return <FieldScreen data={data} />
    case 'comite':
      return <CommitteeScreen data={data} />
    case 'tableau':
      return <DashboardScreen data={data} />
    case 'modele':
      return <ModelScreen data={data} />
    case 'apropos':
      return <AboutScreen data={data} />
    default:
      return <FrictionMapScreen data={data} />
  }
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))
  const region = useRegionData()

  useEffect(() => {
    const next = toHash(route)
    if (window.location.hash !== next) window.location.hash = next
  }, [route])

  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const navigate = useCallback((next: Route) => setRoute(next), [])

  const communeName =
    route.level === 'commune'
      ? region.communes.find((c) => c.id === route.communeId)?.name ?? route.communeId
      : null
  const communeDept =
    route.level === 'commune'
      ? region.communes.find((c) => c.id === route.communeId)?.department ?? ''
      : ''

  const subtitle =
    route.level === 'region'
      ? `${region.region?.name ?? 'Nord & Centre Bénin'} · ${region.communes.length || 33} communes · saison 2026`
      : `${communeName} · ${communeDept} · saison 2026`

  return (
    <AppShell route={route} onNavigate={navigate} subtitle={subtitle}>
      {route.level === 'region' ? (
        <RegionScreen
          data={region}
          onEnterCommune={(id) => navigate({ level: 'commune', communeId: id || DEMO_COMMUNE_ID, screen: 'carte' })}
        />
      ) : (
        <CommuneApp key={route.communeId} route={route} />
      )}
    </AppShell>
  )
}
