import { useEffect, useMemo, useRef, useState } from 'react'
import { getCommunes } from '../api/client'
import { useResource } from '../lib/hooks'
import { severityColor } from '../lib/severity'
import type { CommuneSummary } from '../types'

interface Props {
  communeId: string
  onPick: (id: string) => void
  onRegion: () => void
}

/**
 * Fil d'Ariane + sélecteur de commune.
 * On remonte à la vue régionale d'un clic, on change de commune sans repasser
 * par la carte d'ensemble.
 */
export function CommuneSwitcher({ communeId, onPick, onRegion }: Props) {
  const { data } = useResource(getCommunes)
  const communes = useMemo<CommuneSummary[]>(() => data ?? [], [data])
  const current = communes.find((c) => c.id === communeId)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const groups = useMemo(() => {
    const norm = (s: string) => s.toLocaleLowerCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const q = norm(query.trim())
    const list = q ? communes.filter((c) => norm(c.name).includes(q) || norm(c.department).includes(q)) : communes
    const map = new Map<string, CommuneSummary[]>()
    list.forEach((c) => map.set(c.department, [...(map.get(c.department) ?? []), c]))
    return [...map.entries()]
  }, [communes, query])

  return (
    <div className="relative min-w-0" ref={boxRef}>
      <div className="flex min-w-0 items-center gap-1 text-[10px] font-medium uppercase tracking-[0.14em]">
        <button
          onClick={onRegion}
          className="spring shrink-0 rounded-md px-1 py-0.5 font-mono text-dim hover:bg-surf-2 hover:text-ink"
          title="Revenir à la vue régionale"
        >
          Région
        </button>
        <span aria-hidden className="text-dim/60">
          ›
        </span>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="listbox"
          className="spring flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 font-mono text-ink hover:bg-surf-2"
          title="Changer de commune"
        >
          <span className="truncate">{current?.name ?? 'Commune'}</span>
          <span aria-hidden className="text-dim">
            ▾
          </span>
        </button>
      </div>

      {open && (
        <div className="glass fade-up absolute left-0 top-[calc(100%+10px)] z-50 max-h-[62vh] w-[280px] overflow-hidden rounded-[20px]">
          <div className="border-b border-line p-2.5">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Chercher une commune…"
              className="field w-full px-3 py-2 text-[13px]"
            />
          </div>
          <div className="max-h-[46vh] overflow-y-auto p-2" role="listbox">
            {groups.map(([dept, list]) => (
              <div key={dept} className="mb-1.5">
                <div className="px-2 py-1 text-[9.5px] uppercase tracking-[0.16em] text-dim">{dept}</div>
                {list.map((c) => (
                  <button
                    key={c.id}
                    role="option"
                    aria-selected={c.id === communeId}
                    onClick={() => {
                      onPick(c.id)
                      setOpen(false)
                      setQuery('')
                    }}
                    className={`spring flex w-full items-center gap-2 rounded-[12px] px-2 py-1.5 text-left ${
                      c.id === communeId ? 'bg-surf-3 text-ink' : 'text-ink hover:bg-surf-2'
                    }`}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: c.max_severity ? severityColor(c.max_severity) : 'rgb(var(--dim-rgb))' }}
                    />
                    <span className="flex-1 truncate text-[12.5px]">{c.name}</span>
                    <span className="font-mono text-[11px] text-dim">{c.friction_count}</span>
                  </button>
                ))}
              </div>
            ))}
            {groups.length === 0 && (
              <p className="px-2 py-3 text-[12px] text-dim">Aucune commune ne correspond.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
