import type { ReactNode } from 'react'

interface Props {
  title: string
  /** Compteur ou libellé court affiché à droite du titre. */
  meta?: ReactNode
  open: boolean
  onToggle: () => void
  children: ReactNode
  /** Hauteur maximale du contenu déplié : la carte garde toujours la majorité de l'écran. */
  maxHeight?: string
  className?: string
}

/**
 * Feuille inférieure rétractable : écrans cartographiques sur téléphone.
 * Un panneau flottant mange la carte sur un petit écran : ici la carte garde
 * plus de la moitié de la hauteur, et la feuille se replie sur sa poignée.
 */
export function BottomSheet({
  title,
  meta,
  open,
  onToggle,
  children,
  maxHeight = '48vh',
  className = '',
}: Props) {
  return (
    <div className={`glass flex flex-col overflow-hidden rounded-t-[24px] rounded-b-none ${className}`}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="spring flex min-h-[52px] w-full shrink-0 flex-col items-stretch px-4 pb-2 pt-2 text-left"
      >
        <span className="mx-auto mb-2 block h-1 w-10 shrink-0 rounded-full bg-surf-3" aria-hidden />
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate font-display text-[14.5px] font-semibold text-ink">{title}</span>
          <span className="flex shrink-0 items-center gap-2 font-mono text-[12px] text-dim">
            {meta}
            <span aria-hidden className="text-[11px]">
              {open ? '▾' : '▴'}
            </span>
          </span>
        </span>
      </button>
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        style={{ maxHeight: open ? maxHeight : 0 }}
        aria-hidden={!open}
      >
        {children}
      </div>
    </div>
  )
}
