import type { ReactNode } from 'react'
import { Nav, type ScreenId } from './Nav'
import { NetworkBadge, OriginBadge } from './StatusBadges'
import { ThemeToggle } from './ThemeToggle'
import { CommuneSwitcher } from './CommuneSwitcher'
import type { Route } from '../lib/route'

interface Props {
  route: Route
  onNavigate: (route: Route) => void
  /** Libellé de contexte : « Nord & Centre Bénin » ou « Commune · Département ». */
  subtitle: string
  children: ReactNode
}

function Mark() {
  return (
    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[11px] border border-accent/35 bg-accent/12">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M12 2.5 20 7v6.2c0 4.3-3.3 7.5-8 8.3-4.7-.8-8-4-8-8.3V7l8-4.5Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          className="text-accent"
        />
        <path
          d="M7.5 12.4h3l1.4-3.2 1.6 6 1.2-2.8h2"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-accent"
        />
      </svg>
    </div>
  )
}

export function AppShell({ route, onNavigate, subtitle, children }: Props) {
  const inCommune = route.level === 'commune'
  const goRegion = () => onNavigate({ level: 'region' })
  const setScreen = (screen: ScreenId) =>
    inCommune && onNavigate({ level: 'commune', communeId: route.communeId, screen })
  const pickCommune = (communeId: string) =>
    onNavigate({ level: 'commune', communeId, screen: inCommune ? route.screen : 'carte' })

  return (
    <div className="relative h-full w-full overflow-hidden bg-deep">
      <main className="absolute inset-0">{children}</main>

      {/* En-tête flottant */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-wrap items-start justify-between gap-2 p-3 md:flex-nowrap md:gap-3 md:p-4">
        <div className="glass pointer-events-auto flex min-w-0 max-w-full items-center gap-3 rounded-[20px] px-3 py-2.5 md:px-3.5">
          <button
            onClick={goRegion}
            className="spring shrink-0 rounded-[12px]"
            title="Terra Sentinelle : vue régionale"
            aria-label="Revenir à la vue régionale"
          >
            <Mark />
          </button>
          <div className="min-w-0">
            <div className="truncate font-display text-[14.5px] font-semibold leading-tight text-ink">
              Terra Sentinelle
            </div>
            {inCommune ? (
              <CommuneSwitcher communeId={route.communeId} onPick={pickCommune} onRegion={goRegion} />
            ) : (
              <div className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-dim">{subtitle}</div>
            )}
          </div>
        </div>

        {inCommune && (
          <div className="pointer-events-auto hidden md:block">
            <Nav current={route.screen} onChange={setScreen} />
          </div>
        )}

        {/* Sur mobile, la mention d'honnêteté passe sur sa propre ligne :
            elle reste lisible en entier, jamais réduite à trois mots. */}
        <div className="pointer-events-auto order-3 flex w-full min-w-0 items-center justify-end gap-1.5 sm:order-none sm:w-auto sm:flex-col sm:items-end">
          <div className="flex shrink-0 items-center gap-1.5">
            <div className="hidden sm:flex sm:items-center sm:gap-1.5">
              <NetworkBadge />
              <OriginBadge />
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Navigation mobile */}
      {inCommune && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 p-3 md:hidden">
          <div className="pointer-events-auto">
            <Nav current={route.screen} onChange={setScreen} variant="bottom" />
          </div>
        </div>
      )}
    </div>
  )
}
