import { useMemo } from 'react'
import { Badge, GlassPanel } from '../components/glass'
import { DomainGapNotice } from '../components/DomainGapNotice'
import { formatDate, int, pct } from '../lib/format'
import { useModelCard } from '../lib/appData'
import type { AppData } from '../lib/appData'
import type { ClassMetrics, ModelCard } from '../types'

/* ------------------------------------------------------------- normalisation
   Le backend peut décrire les métriques par classe comme un objet ou comme une
   liste, et la matrice de confusion nue ou étiquetée. Les deux formes sont
   acceptées : l'écran ne doit pas casser sur un détail de sérialisation. */

type Row = ClassMetrics & { name: string }

function perClassRows(model: ModelCard | null): Row[] {
  const pc = model?.metrics?.per_class
  if (!pc) return []
  if (Array.isArray(pc)) return pc.map((r) => ({ ...r, name: r.class }))
  return Object.entries(pc).map(([name, m]) => ({ name, ...m }))
}

function confusionOf(model: ModelCard | null): { labels: string[]; matrix: number[][] } | null {
  const c = model?.metrics?.confusion
  if (!c) return null
  const matrix = Array.isArray(c) ? c : c.matrix
  if (!Array.isArray(matrix) || !matrix.length) return null
  const fromField = Array.isArray(c) ? undefined : c.labels
  const labels =
    fromField ??
    model?.metrics?.labels ??
    (model?.trained_on?.classes?.length === matrix.length ? model.trained_on.classes : undefined) ??
    matrix.map((_, i) => `classe ${i}`)
  return { labels, matrix }
}

/* ------------------------------------------------------------------ blocs */

function Score({ label, value, hint }: { label: string; value: number | undefined; hint: string }) {
  return (
    <GlassPanel className="rounded-[20px] p-3.5 sm:p-4">
      <div className="text-[10px] uppercase tracking-[0.14em] text-dim">{label}</div>
      <div className="mt-2 font-mono text-[26px] font-medium leading-none tracking-tight text-ink sm:text-[30px]">
        {value === undefined ? '-' : value.toFixed(3)}
      </div>
      <div className="mt-1.5 text-[12px] leading-snug text-dim">{hint}</div>
    </GlassPanel>
  )
}

function Row2({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="py-1.5 text-[12px] text-dim">{label}</dt>
      <dd className="min-w-0 break-words py-1.5 text-right font-mono text-[12px] text-ink">{children}</dd>
    </>
  )
}

export function ModelScreen({ data }: { data: AppData }) {
  const { model, loading } = useModelCard()
  const rows = useMemo(() => perClassRows(model), [model])
  const confusion = useMemo(() => confusionOf(model), [model])
  const offline = model?.offline_snapshot === true
  const measured = !!model && model.real !== false

  const total = confusion?.matrix.flat().reduce((a, b) => a + b, 0) ?? 0
  const maxCell = Math.max(1, ...(confusion?.matrix.flat() ?? [1]))

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1060px] px-4 pb-[104px] pt-[150px] sm:px-5 md:px-6 md:pb-10 md:pt-[124px]">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-[20px] font-semibold leading-tight text-ink sm:text-[22px]">
            Modèle de classification
          </h1>
          {measured && <Badge tone="accent">métriques mesurées</Badge>}
          <Badge tone={offline ? 'amber' : 'accent'} dot>
            {offline ? 'instantané hors ligne' : 'API en ligne'}
          </Badge>
        </div>
        <p className="mt-1.5 max-w-[64ch] text-[12.5px] leading-relaxed text-dim">
          Le classifieur qui produit les cellules « potentiellement mises en culture ». Ce qui est affiché ici est
          mesuré sur un jeu de test tenu à l'écart : pas une illustration de format.
        </p>

        {/* L'écart de domaine passe AVANT les chiffres : il conditionne leur lecture. */}
        <div className="mt-4">
          <DomainGapNotice text={model?.domain_gap} dataset={model?.trained_on?.dataset} />
        </div>

        {loading && !model && (
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-dim">chargement de la fiche…</p>
        )}

        {model && !measured && (
          <GlassPanel className="mt-3 rounded-[22px] p-4">
            <p className="text-[12.5px] leading-relaxed text-dim">
              Aucune métrique n'est reproduite dans l'instantané hors ligne : rien n'est inventé ici. Démarrez
              l'API (<span className="font-mono text-ink">GET /api/model</span>) pour afficher les valeurs mesurées
              sur le jeu de test.
            </p>
          </GlassPanel>
        )}

        {/* --- Métriques réelles --- */}
        {measured && (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              <Score label="Exactitude" value={model.metrics.accuracy} hint="Jeu de test EuroSAT tenu à l'écart" />
              <Score label="Précision" value={model.metrics.precision} hint="Part de justes parmi les « cultivé »" />
              <Score label="Rappel" value={model.metrics.recall} hint="Part des cultivés effectivement trouvés" />
              <Score label="F1" value={model.metrics.f1} hint="Moyenne harmonique précision / rappel" />
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-dim">
              Mesuré sur {int(model.trained_on?.n_test ?? 0)} tuiles de test, jamais vues à l'entraînement, graine{' '}
              <span className="font-mono text-ink">{model.seed}</span>.
            </p>
          </>
        )}

        <div className="mt-3 grid gap-2.5 lg:grid-cols-[1fr_1.05fr]">
          {/* --- Carte du modèle --- */}
          <GlassPanel className="rounded-[24px] p-4">
            <h2 className="font-display text-[15px] font-semibold text-ink">Carte du modèle</h2>
            <dl className="mt-2 grid grid-cols-[minmax(88px,auto)_1fr] gap-x-3 divide-y divide-line [&>dd]:border-t [&>dd]:border-line [&>dt]:border-t [&>dt]:border-line">
              <Row2 label="Nom">{model?.name ?? '-'}</Row2>
              <Row2 label="Version">{model?.version ?? '-'}</Row2>
              <Row2 label="Tâche">
                <span className="font-sans">{model?.task ?? '-'}</span>
              </Row2>
              <Row2 label="Jeu d'entraînement">{model?.trained_on?.dataset ?? '-'}</Row2>
              <Row2 label="Source">
                <span className="break-all text-[11px]">{model?.trained_on?.source ?? '-'}</span>
              </Row2>
              <Row2 label="Taille train">{model ? int(model.trained_on?.n_train ?? 0) : '-'}</Row2>
              <Row2 label="Taille test">{model ? int(model.trained_on?.n_test ?? 0) : '-'}</Row2>
              <Row2 label="Graine">{model?.seed ?? '-'}</Row2>
              <Row2 label="Entraîné le">{model?.trained_at ? formatDate(model.trained_at) : '-'}</Row2>
              <Row2 label="Commune ouverte">{data.communeId}</Row2>
            </dl>
            {!!model?.trained_on?.classes?.length && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="text-[10px] uppercase tracking-[0.14em] text-dim">Classes</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {model.trained_on.classes.map((c) => (
                    <Badge key={c}>{c}</Badge>
                  ))}
                </div>
              </div>
            )}
            {!!model?.features?.length && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="text-[10px] uppercase tracking-[0.14em] text-dim">Caractéristiques</div>
                <ul className="mt-1.5 flex flex-col gap-1 text-[12px] leading-snug text-dim">
                  {model.features.map((f) => (
                    <li key={f}>- {f}</li>
                  ))}
                </ul>
              </div>
            )}
          </GlassPanel>

          {/* --- Par classe --- */}
          <GlassPanel className="rounded-[24px] p-4">
            <h2 className="font-display text-[15px] font-semibold text-ink">Métriques par classe</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-dim">
              Mesures sur le test EuroSAT. Une classe mal séparée en Europe le sera au moins autant au Bénin.
            </p>
            {rows.length ? (
              <div className="-mx-1 mt-3 overflow-x-auto px-1">
                <table className="w-full min-w-[340px] border-collapse text-[12px]">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-[0.12em] text-dim">
                      <th className="pb-2 pr-2 font-medium">Classe</th>
                      <th className="pb-2 px-2 text-right font-medium">Préc.</th>
                      <th className="pb-2 px-2 text-right font-medium">Rappel</th>
                      <th className="pb-2 px-2 text-right font-medium">F1</th>
                      <th className="pb-2 pl-2 text-right font-medium">n</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.name} className="border-t border-line">
                        <td className="py-1.5 pr-2 text-ink">{r.name}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-ink">{r.precision?.toFixed(3) ?? '-'}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-ink">{r.recall?.toFixed(3) ?? '-'}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-ink">{r.f1?.toFixed(3) ?? '-'}</td>
                        <td className="py-1.5 pl-2 text-right font-mono text-dim">
                          {r.support === undefined ? '-' : int(r.support)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-3 text-[12px] text-dim">Aucun détail par classe publié par l'API.</p>
            )}
          </GlassPanel>
        </div>

        {/* --- Matrice de confusion --- */}
        {confusion && (
          <GlassPanel className="mt-2.5 rounded-[24px] p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-[15px] font-semibold text-ink">Matrice de confusion</h2>
              <span className="font-mono text-[11px] text-dim">{int(total)} tuiles de test</span>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-dim">
              Lignes : vérité de terrain EuroSAT. Colonnes : classe prédite. La diagonale est le juste.
            </p>
            <div className="-mx-1 mt-3 overflow-x-auto px-1 pb-1">
              <table className="border-collapse text-[11px]">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-raise/80 px-2 py-1.5 text-left text-[10px] uppercase tracking-[0.12em] text-dim backdrop-blur">
                      réel \ prédit
                    </th>
                    {confusion.labels.map((l) => (
                      <th key={l} className="px-2 py-1.5 text-right font-mono text-[10.5px] font-medium text-dim">
                        {l}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {confusion.matrix.map((line, i) => (
                    <tr key={confusion.labels[i] ?? i}>
                      <th className="sticky left-0 z-10 whitespace-nowrap bg-raise/80 px-2 py-1.5 text-left text-[11px] font-medium text-ink backdrop-blur">
                        {confusion.labels[i] ?? i}
                      </th>
                      {line.map((v, j) => (
                        <td
                          key={j}
                          className="px-2 py-1.5 text-right font-mono text-[11.5px] text-ink"
                          style={{
                            background:
                              v === 0
                                ? 'transparent'
                                : `color-mix(in srgb, ${
                                    i === j ? 'var(--accent-ink)' : 'var(--red-ink)'
                                  } ${Math.round((v / maxCell) * 60)}%, transparent)`,
                          }}
                          title={`${confusion.labels[i] ?? i} → ${confusion.labels[j] ?? j} : ${v}`}
                        >
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-dim">
              Les confusions hors diagonale sont teintées : elles disent où le modèle se trompe, y compris entre
              cultures et végétation herbacée : exactement l'ambiguïté attendue sur les petites parcelles.
            </p>
          </GlassPanel>
        )}

        {/* --- Ce que ça vaut au Bénin --- */}
        <GlassPanel className="mt-2.5 rounded-[24px] p-4">
          <h2 className="font-display text-[15px] font-semibold text-ink">Ce que ces chiffres ne disent pas</h2>
          <ul className="mt-2 flex flex-col gap-2 text-[12.5px] leading-relaxed text-dim">
            <li>
              : Ils sont mesurés en <span className="text-ink">Europe</span>. Aucune mesure n'existe sur le Bénin :
              il n'y a pas ici de jeu annoté local.
            </li>
            <li>
              : Une cellule prédite sur le Bénin est une{' '}
              <span className="text-ink">sortie de modèle non validée</span>. Elle devient une friction confirmée
              seulement après passage de l'agent communal.
            </li>
            <li>
              : Les cartes d'occupation du sol globales sous-performent sur l'agriculture subsaharienne : petites
              parcelles, cultures associées, sols nus saisonniers.
            </li>
            <li>
              · La part des détections encore incertaines de la commune ouverte :{' '}
              <span className="font-mono text-ink">
                {data.friction?.features.length
                  ? pct(
                      data.friction.features.filter((f) => f.properties.status === 'pending').length /
                        data.friction.features.length,
                    )
                  : '-'}
              </span>
              .
            </li>
          </ul>
        </GlassPanel>

      </div>
    </div>
  )
}
