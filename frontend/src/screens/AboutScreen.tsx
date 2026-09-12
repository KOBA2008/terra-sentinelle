import { GlassPanel } from '../components/glass'
import { API_BASE } from '../api/client'
import { useDataOrigin, useResolvedTheme } from '../lib/hooks'
import type { AppData } from '../lib/appData'

const PITCH = `Dans le nord du Bénin, les couloirs de transhumance ont été délimités, mais les cartes deviennent rapidement obsolètes à mesure que l'occupation du sol évolue au fil des saisons agricoles. Terra Sentinelle transforme ces cartes statiques en un système de veille actualisé. À partir d'images satellitaires Sentinel-2, un modèle de classification identifie les zones potentiellement mises en culture à l'intérieur ou à proximité de l'emprise des couloirs, puis génère avant chaque saison de transhumance une carte de friction indiquant les portions potentiellement contraintes, avec un niveau de gravité et de confiance. Les agents communaux peuvent confirmer, corriger ou invalider ces détections depuis le terrain, y compris hors connexion. Le comité communal de transhumance dispose alors d'une situation actualisée pour examiner les portions sensibles, décider d'un maintien, d'un ajustement ou d'un contournement du parcours, puis diffuser sa décision aux représentants des éleveurs sous forme de message vocal en fulfulde. Chaque donnée conserve sa source, sa date de collecte, son niveau de confiance et son statut de validation, tandis que les zones incertaines restent explicitement signalées. Terra Sentinelle actualise la connaissance du territoire afin que la décision humaine soit prise en amont, sur la base d'informations récentes, traçables et vérifiables.`

const SOURCES: [string, string][] = [
  ['Sentinel-2 (optique 10 m)', 'Copernicus / Earth Engine : libre'],
  ['Sentinel-1 (radar)', 'traverse les nuages : saison humide'],
  ['Dynamic World V1', 'occupation du sol 10 m, classe « crops »'],
  ['ESA WorldCover v200', '10 m, 11 classes dont cropland'],
  ['OpenStreetMap Bénin', 'Geofabrik'],
  ['Limites administratives', 'HDX'],
  ['OIM TTT-DTM', 'suivi des mouvements de transhumance (points)'],
]


function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <GlassPanel className="rounded-[24px] p-4">
      <h2 className="font-display text-[15px] font-semibold text-ink">{title}</h2>
      <div className="mt-2">{children}</div>
    </GlassPanel>
  )
}

export function AboutScreen({ data }: { data: AppData }) {
  const { origin, error } = useDataOrigin()
  const theme = useResolvedTheme()
  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[820px] px-3 pb-[104px] pt-[136px] md:px-6 md:pb-10 md:pt-[124px]">
        <h1 className="font-display text-[22px] font-semibold leading-tight text-ink">À propos de Terra Sentinelle</h1>
        <p className="mt-2 max-w-[58ch] font-display text-[15px] leading-relaxed text-ink">
          « Les couloirs de transhumance ont été délimités une fois. Les champs, eux, changent chaque saison. Le
          conflit ne naît pas d'une carte absente, il naît d'une carte périmée. »
        </p>

        
        <div className="mt-3 grid gap-2.5 lg:grid-cols-2">
          <Section title="Couverture géographique">
            <p className="text-[12.5px] leading-relaxed text-dim">
              Le projet couvre <span className="text-ink">5 départements et 33 communes</span> du nord et du
              centre du Bénin : Alibori (6), Atacora (9), Borgou (8), Donga (4) et Collines (6). L'interface
              travaille à deux échelles : une <span className="text-ink">vue régionale</span> : réseau de couloirs
              inter-communal et frictions agrégées par commune : et une{' '}
              <span className="text-ink">vue communale</span>, où se font la validation terrain et le calcul
              d'itinéraire.
            </p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-dim">
              <span className="text-ink">Banikoara</span> (Alibori) reste la commune de référence : elle porte le
              jeu de données le plus riche, les autres sont générées à plus faible densité. Le calcul d'itinéraire
              reste intra-commune ou entre communes adjacentes : aucune grille de coût n'est construite sur les
              cinq départements d'un coup.
            </p>
          </Section>

          <Section title="Ce que fait le système">
            <p className="text-[12.5px] leading-relaxed text-dim">{PITCH}</p>
          </Section>

          <div className="flex flex-col gap-2.5">
            <Section title="Utilisateur principal">
              <p className="text-[12.5px] leading-relaxed text-dim">
                <span className="text-ink">Moussa Gounou</span>, agent d'élevage de la mairie de Banikoara (Alibori).
                Avant la saison, il reçoit une carte de friction listant les portions du couloir devenues cultivées.
                Il vérifie sur le terrain, hors réseau, confirme ou invalide depuis son téléphone. Au retour du
                réseau, tout se synchronise. Le comité communal arbitre le lendemain.
              </p>
              <p className="mt-2 text-[12px] leading-relaxed text-dim">
                Utilisateurs secondaires : le comité communal de transhumance (web) ; les représentants d'éleveurs,
                destinataires du message vocal en fulfulde.
              </p>
            </Section>

            <Section title="Données sources">
              <ul className="flex flex-col gap-1.5">
                {SOURCES.map(([name, detail]) => (
                  <li key={name} className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                    <span className="text-ink">{name}</span>
                    <span className="text-dim">- {detail}</span>
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        </div>

        <div className="mt-2.5 grid gap-2.5">
          
          <Section title="Comportement du prototype">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[12px]">
              <dt className="text-dim">API</dt>
              <dd className="font-mono text-ink">{API_BASE}</dd>
              <dt className="text-dim">Origine actuelle</dt>
              <dd className="font-mono text-ink">
                {origin === 'api' ? 'API en ligne' : `fixtures locales${error ? ` (${error})` : ''}`}
              </dd>
              <dt className="text-dim">Fond de carte</dt>
              <dd className="font-mono text-ink">OpenFreeMap (sans clé) → secours dégradé CSS</dd>
              <dt className="text-dim">Hors connexion</dt>
              <dd className="font-mono text-ink">localStorage → POST /observations</dd>
              <dt className="text-dim">Commune ouverte</dt>
              <dd className="font-mono text-ink">{data.communeId}</dd>
              <dt className="text-dim">Thème appliqué</dt>
              <dd className="font-mono text-ink">{theme === 'dark' ? 'sombre' : 'clair'}</dd>
            </dl>
            <p className="mt-2.5 text-[12px] leading-relaxed text-dim">
              Si le backend ne répond pas, l'interface bascule sur des fixtures embarquées et l'affiche
              (« données locales »). Si les tuiles vectorielles ne se chargent pas, la carte est dessinée sur un
              fond dégradé local : les couches GeoJSON restent lisibles, la carte n'est jamais vide.
            </p>
          </Section>
        </div>

        <footer className="mt-5 border-t border-line pt-4">
          <p className="mt-1.5 font-mono text-[10.5px] leading-relaxed text-dim">
            Terra Sentinelle · Hackathon Deep Learning IndabaX Bénin 2026 · Équipe TechMakers · défi Résilience
            climatique
          </p>
        </footer>
      </div>
    </div>
  )
}
