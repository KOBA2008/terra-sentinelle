import { setThemeChoice, THEME_LABELS, type ThemeChoice } from '../lib/theme'
import { useResolvedTheme, useThemeChoice } from '../lib/hooks'

const ORDER: ThemeChoice[] = ['light', 'dark', 'system']

function Icon({ id }: { id: ThemeChoice }) {
  if (id === 'light')
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="4.4" stroke="currentColor" strokeWidth="1.7" />
        <path
          d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    )
  if (id === 'dark')
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M20.5 14.3A8.6 8.6 0 0 1 9.7 3.5a8.6 8.6 0 1 0 10.8 10.8Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
      </svg>
    )
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="2.8" y="4.5" width="18.4" height="12.4" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8.5 20.5h7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Sélecteur clair / sombre / système.
 * Le défaut est la préférence système ; le choix persiste en localStorage
 * et s'applique immédiatement, sans rechargement.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const choice = useThemeChoice()
  const resolved = useResolvedTheme()
  return (
    <div
      className={`glass flex items-center gap-0.5 rounded-[14px] p-[3px] ${className}`}
      role="group"
      aria-label="Thème de l'interface"
    >
      {ORDER.map((id) => {
        const active = choice === id
        return (
          <button
            key={id}
            onClick={() => setThemeChoice(id)}
            aria-pressed={active}
            title={
              id === 'system'
                ? `Suivre le système (actuellement ${resolved === 'dark' ? 'sombre' : 'clair'})`
                : `Thème ${THEME_LABELS[id].toLowerCase()}`
            }
            className={`spring grid h-[26px] w-[28px] place-items-center rounded-[11px] ${
              active ? 'bg-surf-3 text-ink shadow-[inset_0_1px_0_var(--glass-brd)]' : 'text-dim hover:text-ink'
            }`}
          >
            <Icon id={id} />
            <span className="sr-only">{THEME_LABELS[id]}</span>
          </button>
        )
      })}
    </div>
  )
}
