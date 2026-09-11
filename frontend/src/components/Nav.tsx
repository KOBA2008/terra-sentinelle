export type ScreenId = 'carte' | 'modele' | 'terrain' | 'comite' | 'tableau' | 'apropos'

export const SCREENS: { id: ScreenId; label: string; short: string }[] = [
  { id: 'carte', label: 'Carte de friction', short: 'Carte' },
  { id: 'modele', label: 'Modèle', short: 'Modèle' },
  { id: 'terrain', label: 'Mode terrain', short: 'Terrain' },
  { id: 'comite', label: 'Comité', short: 'Comité' },
  { id: 'tableau', label: 'Tableau de bord', short: 'Chiffres' },
  { id: 'apropos', label: 'À propos', short: 'Infos' },
]

interface Props {
  current: ScreenId
  onChange: (id: ScreenId) => void
  variant?: 'top' | 'bottom'
}

export function Nav({ current, onChange, variant = 'top' }: Props) {
  const isBottom = variant === 'bottom'
  return (
    <nav
      className={`glass flex items-center gap-1 p-1 ${isBottom ? 'w-full justify-between rounded-[22px]' : 'rounded-[18px]'}`}
      aria-label="Navigation principale"
    >
      {SCREENS.map((s) => {
        const active = current === s.id
        return (
          <button
            key={s.id}
            onClick={() => onChange(s.id)}
            aria-current={active ? 'page' : undefined}
            className={`spring rounded-[14px] px-3 py-1.5 text-[12.5px] font-medium ${
              isBottom ? 'flex-1' : ''
            } ${active ? 'bg-surf-3 text-ink shadow-[inset_0_1px_0_var(--glass-brd)]' : 'text-dim hover:text-ink'}`}
          >
            <span className={isBottom ? '' : 'hidden xl:inline'}>{isBottom ? s.short : s.label}</span>
            {!isBottom && <span className="xl:hidden">{s.short}</span>}
          </button>
        )
      })}
    </nav>
  )
}
