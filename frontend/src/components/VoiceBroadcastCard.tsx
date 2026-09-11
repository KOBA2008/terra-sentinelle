import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge, GlassPanel } from './glass'
import { formatDate } from '../lib/format'
import type { Decision } from '../types'

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/**
 * Lecteur factice : aucune synthèse vocale n'est embarquée dans le prototype.
 * La carte montre le produit de diffusion attendu, pas un audio réel.
 */
export function VoiceBroadcastCard({ decision }: { decision: Decision }) {
  const duration = decision.broadcast.duration_s
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const raf = useRef<number | null>(null)
  const last = useRef<number>(0)

  const bars = useMemo(
    () => Array.from({ length: 56 }, (_, i) => 0.25 + 0.75 * Math.abs(Math.sin(i * 1.37) * Math.cos(i * 0.41))),
    [],
  )

  useEffect(() => {
    if (!playing) return
    last.current = performance.now()
    const tick = (now: number) => {
      const dt = (now - last.current) / 1000
      last.current = now
      setT((prev) => {
        const next = prev + dt
        if (next >= duration) {
          setPlaying(false)
          return duration
        }
        return next
      })
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current)
    }
  }, [playing, duration])

  const progress = Math.min(1, t / duration)

  return (
    <GlassPanel className="fade-up rounded-[24px] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-[15px] font-semibold text-ink">Message vocal en fulfulde</h3>
          <p className="mt-0.5 text-[11.5px] text-dim">
            Diffusion aux représentants d'éleveurs · décision {decision.id} · {formatDate(decision.decided_on)}
          </p>
        </div>
        <Badge tone="amber">simulation</Badge>
      </div>

      <div className="glass-inset mt-3 flex items-center gap-3 p-3">
        <button
          onClick={() => {
            if (t >= duration) setT(0)
            setPlaying((p) => !p)
          }}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-accent/45 bg-accent/15 text-accent-ink"
          aria-label={playing ? 'Pause' : 'Lecture'}
        >
          {playing ? (
            <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor" aria-hidden>
              <rect x="0" y="0" width="4" height="14" rx="1" />
              <rect x="8" y="0" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg width="13" height="15" viewBox="0 0 13 15" fill="currentColor" aria-hidden>
              <path d="M1 1.3v12.4c0 .9 1 1.5 1.8 1L12.2 8.4c.7-.4.7-1.5 0-1.9L2.8.3C2 -.2 1 .4 1 1.3Z" />
            </svg>
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex h-9 items-center gap-[2px]">
            {bars.map((h, i) => {
              const on = i / bars.length <= progress
              return (
                <span
                  key={i}
                  className="flex-1 rounded-full"
                  style={{
                    height: `${Math.round(h * 100)}%`,
                    background: on ? 'var(--accent-ink)' : 'var(--surf-3)',
                    transition: 'background .2s linear',
                  }}
                />
              )
            })}
          </div>
          <div className="mt-1 flex justify-between font-mono text-[10px] text-dim">
            <span>{mmss(t)}</span>
            <span>ff · {mmss(duration)}</span>
          </div>
        </div>
      </div>

      <div className="mt-3">
        <div className="text-[10px] uppercase tracking-[0.13em] text-dim">Transcription française</div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink">{decision.broadcast.transcript_fr}</p>
      </div>

      <p className="mt-3 border-t border-line pt-2.5 text-[10.5px] leading-relaxed text-dim">
        Lecteur de démonstration : aucun fichier audio n'est généré ici. La synthèse vocale en fulfulde et sa
        diffusion (radio locale, groupes WhatsApp) restent à implémenter, avec relecture humaine obligatoire avant
        envoi.
      </p>
    </GlassPanel>
  )
}
