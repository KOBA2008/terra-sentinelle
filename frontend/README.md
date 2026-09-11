# Terra Sentinelle — interface

Veille des couloirs de transhumance du **nord et du centre du Bénin** :
5 départements, 33 communes, deux échelles de lecture.
React 18 + Vite + TypeScript + Tailwind + MapLibre GL JS.

> **Terra Sentinelle ne prédit pas les conflits et ne délivre aucune autorisation de passage.**
> Données de démonstration synthétiques · emprise de couloir reconstituée, non officielle.

---

## Démarrer

```bash
npm install
npm run dev -- --port 5173   # 5173 est le seul port autorisé en CORS par le backend
npm run build                # tsc -b && vite build
npm run preview
```

Backend (facultatif — l'interface fonctionne sans lui) :

```bash
cd ../backend && ./.venv/bin/uvicorn main:app --port 8000
```

Base d'API configurable : `VITE_API_BASE` (défaut `http://localhost:8000/api`).

---

## Thème clair / sombre

Sélecteur **clair / sombre / système** dans l'en-tête, à droite (trois icônes :
soleil, lune, écran). Le défaut est la préférence système (`prefers-color-scheme`),
le choix est mémorisé dans `localStorage` (`terra-sentinelle.theme.v1`) et s'applique
immédiatement, sans rechargement. Un petit script dans `index.html` pose l'attribut
avant la première peinture : pas de flash de couleurs au chargement.

**Le thème clair est le thème de référence** — Terra Sentinelle est un outil de bureau
consulté en réunion de comité, souvent en plein jour. Le sombre sert au terrain.

| Fichier | Rôle |
| --- | --- |
| `src/index.css` | les deux palettes, en variables CSS (`:root`, `@media (prefers-color-scheme: dark)`, `:root[data-theme="dark"]`) |
| `src/lib/theme.ts` | état du choix, persistance, application de `data-theme` |
| `src/lib/tokens.ts` | lecture des jetons en JavaScript (peintures MapLibre, styles en ligne) |
| `src/components/ThemeToggle.tsx` | le sélecteur |
| `tailwind.config.js` | expose les jetons en triplets RVB pour garder `bg-accent/15`, `text-ink/90`… |

**Aucune couleur n'est codée en dur dans un composant.** Contrôle :

```bash
grep -rn "#[0-9a-fA-F]\{6\}" src/ --include=*.tsx --include=*.ts   # ne doit rien renvoyer
```

(`src/lib/tokens.ts` contient volontairement les valeurs de repli, utilisées uniquement
si le CSS n'est pas encore appliqué ; `src/index.css` porte les palettes elles-mêmes.)

### Le verre en thème clair

Du verre blanc translucide sur fond clair disparaît si l'on compte sur une bordure.
En clair, le relief vient donc de **l'ombre portée** (`--glass-shadow`, trois niveaux
plus un filet sombre à 4 %) et d'une **bordure blanche lumineuse** — jamais d'une bordure
sombre. En sombre, on garde le verre clair translucide, la bordure claire et le reflet
spéculaire sur l'arête haute. Blur 24 px, rayons 18–28 px, `cubic-bezier(.22,1,.36,1)`
dans les deux cas.

Le fond de carte suit le thème (recoloration du style OpenFreeMap avec les jetons actifs),
y compris le **fond CSS de repli** quand les tuiles ne chargent pas.

Contraste : `--text-dim` vise WCAG AA sur verre dans les deux thèmes (≈ 5,4:1 en clair,
≈ 6,6:1 en sombre). Les couleurs sémantiques ont une variante « encre »
(`--accent-ink`, `--amber-ink`, `--red-ink`, `--sand-ink`) pour le petit texte,
là où l'aplat vif ne passerait pas en clair.

---

## Naviguer : région ↔ commune

L'application a deux échelles, reflétées dans l'adresse :

| Adresse | Vue |
| --- | --- |
| `#/region` | **vue régionale** — point d'entrée : les 33 communes, le réseau de couloirs inter-communal, les frictions agrégées |
| `#/commune/<id>/<écran>` | **vue communale** — `carte`, `terrain`, `comite`, `tableau`, `apropos` |

- **Entrer dans une commune** : cliquer une ligne du panneau « Communes », cliquer une
  pastille sur la carte régionale, ou le bouton **« Ouvrir Banikoara — commune de
  démonstration »** (Banikoara porte le jeu de données le plus riche, accessible en un clic).
- **Remonter** : le fil d'Ariane « Région › *Commune* » en haut à gauche, ou le logo.
- **Changer de commune sans repasser par la région** : cliquer le nom de la commune dans
  le fil d'Ariane — un sélecteur s'ouvre, avec recherche et regroupement par département.
- Le panneau régional se trie par gravité, nombre de frictions, date du dernier passage
  satellite ou nom, et se filtre par département.
- Les anciens liens (`#carte`, `#tableau`…) ouvrent Banikoara, ils ne sont pas cassés.

---

## Modes dégradés (à préserver)

1. **API injoignable** → bascule automatique sur les fixtures embarquées, signalée par le
   badge « données locales ». Banikoara utilise les JSON détaillés de `src/mock/` ; les
   32 autres communes sont générées par `src/mock/synth.ts`, de manière **déterministe**
   (graine dérivée de l'identifiant) : la même commune donne toujours la même carte.
2. **Tuiles indisponibles** → style MapLibre vide + fond dégradé CSS thématisé + graticule
   local. La carte n'est jamais vide, les couches GeoJSON restent lisibles.
3. **WebGL absent** → message explicite, les frictions restent consultables dans le panneau.
4. **Hors connexion** → les validations partent dans une file `localStorage`, rejouée par
   `POST /observations` au retour du réseau. Interrupteur « Simuler la perte de réseau »
   dans le mode terrain, pour la démonstration.

La mention d'honnêteté est affichée en permanence, dans les deux thèmes, sur toutes les
vues ; l'incertitude s'affiche en pointillés avec la date de dernière observation ; la
phrase de refus figure sur chaque écran.

---

## API consommée

Base `http://localhost:8000/api` (voir SPEC § 8).

```
GET /communes · /departments · /region · /region/corridors
GET /commune/{id} · /commune/{id}/corridor · /commune/{id}/layers/{kind}
GET /friction?season=2026&commune={id}      POST /friction/{id}/validate
GET /routes?commune={id}&from=…&to=…        POST /observations
GET /decisions?commune={id}                 POST /decisions
GET /stats?commune={id}
```

Les identifiants de commune sont les slugs servis par `/api/communes`
(`banikoara`, `kandi`, `dassa-zoume`…) ; les fixtures locales utilisent les mêmes.
Le calcul d'itinéraire reste **intra-commune ou entre communes adjacentes**.

---

## Structure

```
src/
  App.tsx                routage à deux échelles
  api/client.ts          appels + bascule fixtures
  components/
    AppShell.tsx         en-tête, fil d'Ariane, sélecteur de thème, navigation
    CommuneSwitcher.tsx  fil d'Ariane + sélecteur de commune
    ThemeToggle.tsx      clair / sombre / système
    glass/               GlassPanel, Button, Badge
    map/                 MapView, style.ts (fond thématisé), layers.ts (peintures)
  lib/
    theme.ts tokens.ts   thème et jetons de couleur
    route.ts             #/region ↔ #/commune/<id>/<écran>
    appData.ts           données d'une commune
    regionData.ts        données régionales
    severity.ts uncertainty.ts geo.ts offlineQueue.ts network.ts store.ts format.ts
  mock/
    communes.json        les 33 communes + le réseau de couloirs (fixture régionale)
    synth.ts             générateur déterministe des communes non détaillées
    *.json               jeu détaillé de Banikoara
  screens/
    RegionScreen.tsx     vue régionale
    FrictionMapScreen.tsx FieldScreen.tsx CommitteeScreen.tsx DashboardScreen.tsx AboutScreen.tsx
```

## Vérifications

```bash
npm run build                                    # doit passer
grep -rn "#[0-9a-fA-F]\{6\}" src/ --include=*.tsx --include=*.ts   # aucune couleur en dur
```

Points à retester après toute modification : les deux thèmes et la bascule ; le mode
terrain à 390 px de large ; la carte sans réseau ; la file hors ligne.
