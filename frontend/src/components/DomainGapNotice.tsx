import { GlassPanel } from './glass'

/** Repli si l'API n'a pas (encore) publié son texte : le fond du message ne change pas. */
export const DOMAIN_GAP_FALLBACK =
  "Le modèle est entraîné sur de l'imagerie Sentinel-2 européenne (EuroSAT) puis appliqué au nord du Bénin. " +
  "Les métriques mesurées valent pour l'Europe et non pour le Bénin : elles ne mesurent pas la performance locale."

interface Props {
  /** Texte d'avertissement fourni par le backend (`domain_gap`). */
  text?: string | null
  dataset?: string
  compact?: boolean
  className?: string
}

/**
 * Écart de domaine : élément de PREMIER PLAN, jamais une note de bas de page.
 * Entraîné en Europe, appliqué au Bénin : c'est la condition de lecture de
 * toutes les métriques affichées ailleurs dans l'application.
 */
export function DomainGapNotice({ text, dataset, compact = false, className = '' }: Props) {
  return (
    <GlassPanel
      className={`rounded-[22px] !border-amber/45 ${compact ? 'p-3.5' : 'p-4 sm:p-5'} ${className}`}
      style={{ background: 'color-mix(in srgb, var(--amber-ink) 10%, var(--glass))' }}
      role="note"
    >
      <div className="flex gap-3">
        <span
          aria-hidden
          className="mt-[3px] grid h-6 w-6 shrink-0 place-items-center rounded-full border border-amber/50 font-mono text-[13px] leading-none text-amber-ink"
        >
          !
        </span>
        <div className="min-w-0">
          <h2
            className={`font-display font-semibold leading-tight text-amber-ink ${
              compact ? 'text-[13.5px]' : 'text-[15px] sm:text-[17px]'
            }`}
          >
            Écart de domaine : entraîné en Europe, appliqué au Bénin
          </h2>
          <p className={`mt-1.5 max-w-[68ch] leading-relaxed text-ink ${compact ? 'text-[12px]' : 'text-[13px]'}`}>
            {text?.trim() || DOMAIN_GAP_FALLBACK}
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-dim">
            Provenance de l'entraînement : <span className="text-ink">{dataset || 'EuroSAT (Sentinel-2, RGB)'}</span> :             imagerie européenne étiquetée. Une prédiction affichée sur le Bénin reste une sortie de modèle{' '}
            <span className="text-amber-ink">non validée localement</span>, à vérifier par l'agent communal.
          </p>
        </div>
      </div>
    </GlassPanel>
  )
}
