# Terra Sentinelle — backend

API du prototype présenté au hackathon Deep Learning **IndabaX Bénin 2026**
(équipe KOBA David). Le contrat d'API est celui de `../SPEC.md`, **section 8**,
implémenté à l'identique sous le préfixe `/api`.

Couverture : **5 départements / 33 communes** du nord et du centre du Bénin
(SPEC section 5), à **deux échelles** — une vue régionale (les 33 communes, le
réseau de couloirs, les frictions agrégées) et une vue communale (le détail,
la validation terrain, le calcul d'itinéraire). **Banikoara** porte le jeu de
données détaillé ; les 32 autres communes sont générées à plus faible densité.

> **Honnêteté obligatoire (SPEC section 9).**
> Toutes les données servies par cette API sont **synthétiques** (`synthetic: true`).
> L'emprise du couloir est **reconstituée par l'équipe, non officielle** (`official: false`).
> Les métriques du modèle sont des **valeurs de démonstration** (`demo_values: true`) :
> aucun entraînement réel n'a eu lieu.
> **Terra Sentinelle ne prédit pas les conflits et ne délivre aucune autorisation de passage.**

---

## Installation

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

Pas de PostGIS, pas de Docker, pas de service externe : stockage en fichiers
GeoJSON + SQLite. Démarrage à froid mesuré < 5 s sur un portable.

## Démarrage

```bash
python seed.py && uvicorn main:app --reload
```

- `seed.py` régénère `data/communes/<id>/*.geojson`, les deux fichiers régionaux
  (`data/region.json`, `data/region_corridors.geojson`) et **réinitialise**
  `data/terra.sqlite` (validations, observations, décisions). Il est déterministe
  (`seed = 20260911`) : deux exécutions donnent exactement les mêmes données, et
  Banikoara donne exactement le jeu de la version mono-commune.
  **Il ne régénère pas `data/communes.json`** : ce fichier est une *entrée*,
  éditable à la main (voir plus bas).
- L'API écoute sur `http://localhost:8000`, base **`/api`**, doc interactive sur
  `http://localhost:8000/docs`.
- CORS ouvert sur `http://localhost:5173` (frontend Vite).
- Au démarrage, la grille de coût et le graphe sont préchauffés en tâche de fond
  (~0,3 s) pour que le premier appel à `/api/routes` soit déjà rapide.

Variables d'environnement utiles :

| Variable | Défaut | Effet |
|---|---|---|
| `TS_GRID_RES_M` | `200` | résolution nominale de la grille de coût (m). Baisser affine le tracé et ralentit le calcul |
| `TS_GRID_MAX_CELLS` | `80000` | plafond de cellules d'une grille. Au-delà, la maille est relâchée automatiquement — c'est ce qui borne le temps de calcul d'un itinéraire inter-communes |

## Couverture géographique — une seule source de vérité

La liste des communes vit **uniquement** dans **`data/communes.json`**. Aucune
commune n'est codée en dur dans le Python : pour corriger un nom, un centre ou une
emprise, on édite ce fichier et on relance `python seed.py`.

```json
{"id":"banikoara","name":"Banikoara","department":"Alibori","department_id":"alibori",
 "center":[2.438,11.298],"bbox":[2.2,11.05,2.72,11.55]}
```

| Département | Communes |
|---|---|
| **Alibori** (6) | Banikoara *(référence)*, Gogounou, Kandi, Karimama, Malanville, Ségbana |
| **Atacora** (9) | Boukoumbé, Cobly, Kérou, Kouandé, Matéri, Natitingou, Péhunco, Tanguiéta, Toucountouna |
| **Borgou** (8) | Bembèrèkè, Kalalé, N'Dali, Nikki, Parakou, Pèrèrè, Sinendé, Tchaourou |
| **Donga** (4) | Bassila, Copargo, Djougou, Ouaké |
| **Collines** (6) | Bantè, Dassa-Zoumè, Glazoué, Ouèssè, Savalou, Savè |

> ⚠️ Centres et emprises **approximatifs**, saisis à la main pour la démonstration.
> Ce ne sont pas des limites administratives officielles (source à intégrer : HDX).
> **À faire vérifier par David avant le pitch.**

L'identifiant canonique est le **slug** (`banikoara`, `dassa-zoume`). Par tolérance,
l'API accepte aussi les écritures `BJ-AL-BANIKOARA`, `Banikoara`, `BANIKOARA` et
renvoie toujours le slug.

Tout le reste est **dérivé** de ce fichier, sans table en dur (`registry.py`) :
projection locale de chaque commune, **adjacence** (emprises qui se recouvrent) et
**réseau de couloirs** orienté nord → sud. Chaque commune se raccorde à sa voisine
du nord **au même point** : la continuation principale part de l'extrémité sud du
tronçon amont, les autres partent d'un point situé *sur* ce tronçon (jonction en T).
Les 30 raccordements du réseau se touchent donc exactement — c'est vérifié après
chaque seed.

## Fichiers

| Fichier | Rôle |
|---|---|
| `data/communes.json` | **entrée éditable** : les 33 communes (id, nom, département, centre, bbox) |
| `registry.py` | seul lecteur de `communes.json` ; adjacence, réseau, projections |
| `seed.py` | générateur de données de démonstration (synthétiques), 33 communes |
| `geo.py` | projections locales lon/lat ↔ mètres (`Proj`), helpers GeoJSON |
| `store.py` | lecture des GeoJSON par commune, agrégats régionaux, SQLite |
| `routing.py` | grille de coût **bornée**, graphe networkx, A\*, 3 alternatives |
| `main.py` | application FastAPI, tous les endpoints de la SPEC §8 |
| `docs/pipeline.md` | chaîne satellite : **ce qui tourne** vs **ce qui est prévu** |
| `docs/ee_crop_detection.js` | squelette Earth Engine commenté (non exécuté) |

### Arborescence des données générées

```
data/
  communes.json               entrée (éditée à la main, jamais régénérée)
  region.json                 agrégats précalculés : communes, départements, index
  region_corridors.geojson    réseau inter-communal SIMPLIFIÉ (vue large)
  communes/<id>/commune.json  corridor.geojson  villages.geojson
                              water_points.geojson  pastures.geojson
                              parcels.geojson  friction.geojson
  terra.sqlite                validations, observations, décisions
```

## Données générées

**Banikoara — commune de référence (jeu détaillé, inchangé depuis la version
mono-commune).**

| Couche | Volume | Remarque |
|---|---|---|
| couloir | axe 57,1 km + emprise 100 m, 8 segments `SEG-01…SEG-08` | **reconstitué, non officiel** |
| villages | 17 | positions tirées au sort, toponymes plausibles |
| points d'eau | 7 (dont saisonniers) | `seasonal`, `accessible` |
| pâturages | 5 | |
| parcelles | 32, de 0,55 à 5,05 ha | 6 chevauchant l'emprise, 13 à son contact |
| frictions | 10 (dont 2 `pending`) | **dérivées des recouvrements réellement calculés** parcelle × emprise |

**Les 32 autres communes** reçoivent un jeu plus léger mais construit exactement de
la même façon : un tronçon de couloir raccordé au réseau, 4 segments, 4 à 7 villages,
2 à 4 points d'eau, 1 à 3 pâturages, 11 à 18 parcelles, **2 à 8 zones de friction**.
Leurs villages portent des noms *dérivés du nom de la commune* (`Kandi-Centre`,
`Kandi Nord`…) : aucun toponyme n'est inventé puis présenté comme réel.

| Département | Communes | Couloirs | Frictions | Villages | Parcelles |
|---|---:|---:|---:|---:|---:|
| Alibori | 6 | 415,8 km | 39 | 43 | 102 |
| Atacora | 9 | 342,1 km | 37 | 51 | 119 |
| Borgou | 8 | 371,7 km | 42 | 46 | 114 |
| Donga | 4 | 202,0 km | 18 | 21 | 57 |
| Collines | 6 | 253,4 km | 21 | 37 | 91 |
| **Total** | **33** | **1 585,0 km** | **157** (dont **84 `pending`**) | **198** | **483** |

Les **84 détections `pending`** réparties sur les 33 communes sont ce qui alimente
la démonstration du **mode terrain** (l'agent confirme / corrige / invalide).
`seed.py` échoue explicitement s'il n'en produit aucune.

Toutes les propriétés portent `synthetic: true` et `official: false`, et chaque
objet porte sa commune (`commune`, `commune_name`, `department`).

---

## Endpoints

| Endpoint | Rôle |
|---|---|
| `GET /api/region` | en-tête de la vue régionale |
| `GET /api/region/corridors` | réseau inter-communal **simplifié** |
| `GET /api/communes[?department=]` | les 33 communes + agrégats |
| `GET /api/departments` | les 5 départements + agrégats |
| `GET /api/commune/{id}` | fiche d'une commune |
| `GET /api/commune/{id}/corridor` | couloir d'une commune (axe + emprise + segments) |
| `GET /api/commune/{id}/layers/{kind}` | `villages \| water_points \| pastures \| parcels` |
| `GET /api/friction[?season=&commune=&status=]` | frictions ; **sans `commune`, toutes les communes** |
| `POST /api/friction/{id}/validate` | validation terrain |
| `GET /api/routes?commune=&from=&to=` | itinéraires (intra-commune ou communes adjacentes) |
| `POST /api/observations` | synchronisation hors ligne |
| `GET`/`POST /api/decisions` | décisions du comité |
| `GET /api/stats[?commune=]` | chiffres ; **sans `commune`, toute la région** |

**Règle de compatibilité (SPEC §8).** Les anciennes routes **sans identifiant**
restent servies comme **alias de Banikoara** — rien de ce qui existait ne casse :

| Alias historique | Équivalent |
|---|---|
| `GET /api/commune` | `GET /api/commune/banikoara` |
| `GET /api/corridor` | `GET /api/commune/banikoara/corridor` |
| `GET /api/layers/{kind}` | `GET /api/commune/banikoara/layers/{kind}` |
| `GET /api/routes?from=&to=` | commune déduite des coordonnées |

---

### `GET /api/region`
```json
{"name":"Nord & Centre Benin","country":"Benin",
 "bbox":[0.906,7.56,3.964,12.295],"center":[2.435,9.9275],
 "commune_count":33,"department_count":5,"corridor_km_total":1585.0,
 "reference_commune":"banikoara","friction_total":157,"village_total":198,
 "parcel_total":483,"water_point_total":93,"pasture_total":77,
 "departments":[{"id":"alibori","name":"Alibori","commune_count":6}, "..."],
 "synthetic":true,"official":false}
```

### `GET /api/communes`
Les 33 communes avec leurs agrégats. **Précalculés au seed** : seul le décompte par
statut est réajusté avec les validations terrain, ce qui tient la réponse à
**≈ 4 ms**. `?department=alibori` (ou `BJ-AL`, ou `Alibori`) filtre.
```json
[{"id":"banikoara","name":"Banikoara","department":"Alibori","department_id":"alibori",
  "center":[2.438,11.298],"bbox":[2.2,11.05,2.72,11.55],"reference":true,
  "friction_count":10,"max_severity":5,
  "last_pass":{"date":"2026-02-16","sensor":"sentinel-1","cloud_pct":31,"synthetic":true},
  "status_counts":{"pending":2,"confirmed":6,"corrected":1,"invalidated":1},
  "corridor_km":57.13,"segment_count":8,"village_count":17,"water_point_count":7,
  "pasture_count":5,"parcel_count":32,"parcels_in_corridor":6,
  "friction_area_ha":29.97,"synthetic":true,"official":false}]
```

### `GET /api/departments`
```json
[{"id":"alibori","name":"Alibori","commune_count":6,
  "commune_ids":["banikoara","gogounou","kandi","karimama","malanville","segbana"],
  "friction_count":39,"max_severity":5,"corridor_km":415.8,
  "village_count":43,"parcel_count":102,"bbox":[2.2,10.628,3.964,12.295],
  "pending":18,"confirmed":15}]
```

### `GET /api/region/corridors`
Le réseau inter-communal, **simplifié pour la vue large** : 33 `LineString`,
650 points ramenés à 135 (Douglas-Peucker, tolérance 0,008° ≈ 900 m), coordonnées
à 4 décimales, **12 Ko**, réponse **≈ 2 ms**. Les extrémités sont préservées :
les tronçons restent raccordés à l'écran.
Pour le tracé précis d'une commune : `GET /api/commune/{id}/corridor`.
```json
{"type":"FeatureCollection","simplified":true,"tolerance_deg":0.008,
 "points_original":650,"points_kept":135,
 "features":[{"type":"Feature","geometry":{"type":"LineString","coordinates":"..."},
   "properties":{"id":"COR-BANIKOARA-01","name":"Couloir de transhumance Banikoara Nord-Sud",
     "kind":"axis","commune":"banikoara","commune_name":"Banikoara",
     "department":"Alibori","length_km":57.13,"synthetic":true,"official":false}}]}
```

### `GET /api/commune/{id}`
```json
{"id":"banikoara","name":"Banikoara","department":"Alibori","department_id":"alibori",
 "center":[2.438,11.298],"bbox":[2.2,11.05,2.72,11.55],
 "country":"Benin","reference":true,"synthetic":true,"official":false,
 "note":"Donnees de demonstration synthetiques. L'emprise du couloir est reconstituee..."}
```
`404` si la commune est inconnue, avec renvoi vers `GET /api/communes`.

### `GET /api/commune/{id}/corridor`
FeatureCollection de **2 features** : le `LineString` de l'axe, le `Polygon` de
l'emprise. La liste des segments est exposée en membre étranger `segments`.
```json
{"type":"FeatureCollection","features":[
  {"type":"Feature","geometry":{"type":"LineString","coordinates":[[2.468721,11.088], "..."]},
   "properties":{"id":"COR-BANIKOARA-01","name":"Couloir de transhumance Banikoara Nord-Sud",
     "kind":"axis","width_m":100,
     "source":"Reconstitution equipe Terra Sentinelle (OSM + OIM TTT-DTM + terrain)",
     "delimited_on":"2015-06-30","official":false,"synthetic":true,"length_km":57.13,
     "segment_ids":["SEG-01","...","SEG-08"]}},
  {"type":"Feature","geometry":{"type":"Polygon","coordinates":"..."},
   "properties":{"id":"COR-BANIKOARA-01-EMPRISE","kind":"emprise","width_m":100,
     "official":false,"synthetic":true,"area_ha":1142.6}}],
 "segments":[{"id":"SEG-01","corridor_id":"COR-BANIKOARA-01","from_km":0.0,"to_km":7.14}, "..."],
 "meta":{"synthetic":true,"official":false,"generator":"seed.py","seed":20260911}}
```

### `GET /api/commune/{id}/layers/{kind}` — `villages | water_points | pastures | parcels`
```json
{"type":"FeatureCollection","features":[
 {"type":"Feature","geometry":{"type":"Point","coordinates":[2.537,11.408]},
  "properties":{"id":"VIL-01","name":"Founougo","kind":"village","population":3200,
    "has_market":false,"distance_corridor_m":8319,
    "source":"OpenStreetMap (positions synthetiques)","confidence":0.81,
    "synthetic":true,"official":false}}]}
```
Un `kind` inconnu renvoie **404** avec la liste des valeurs admises.
Exemple de parcelle :
```json
{"id":"PARC-001","crop":"riz pluvial","area_ha":4.09,"cultivated":true,
 "season":"2025-2026","in_corridor":false,"overlap_ha":0.0,"distance_corridor_m":93,
 "detected_on":"2026-02-03","source":"sentinel-2","model_version":"ts-demo-0.3.0",
 "confidence":0.71,"synthetic":true,"official":false}
```

### `GET /api/friction?season=2026&commune={id}&status=pending`
FeatureCollection de zones de friction. Le `status` renvoyé est **toujours le
dernier statut journalisé en base** s'il existe, sinon celui de la détection.

- **sans `commune`** → les **157** frictions des 33 communes (≈ 46 ms, 270 Ko) ;
- **avec `commune`** → celles de la commune seule (≈ 4 ms) ;
- `status=pending` (ou une liste `pending,corrected`) filtre — c'est la file du
  mode terrain ;
- chaque feature porte sa `commune`, et les identifiants sont globaux :
  `FRIC-001…FRIC-010` pour la commune de référence, `FRIC-<COMMUNE>-NNN` ailleurs
  (idem `VIL-`, `EAU-`, `PAT-`, `PARC-`, `SEG-`).
```json
{"type":"FeatureCollection","season":2026,"features":[
 {"type":"Feature","geometry":{"type":"Polygon","coordinates":"..."},
  "properties":{"id":"FRIC-001","severity":5,"confidence":0.5,"area_ha":4.12,
   "detected_on":"2025-12-20","source":"sentinel-2","model_version":"ts-demo-0.3.0",
   "status":"confirmed","corridor_segment_id":"SEG-04",
   "note":"Mise en culture (coton) detectee dans l'emprise sur 2.31 ha (parcelle PARC-004). A verifier au sol.",
   "parcel_id":"PARC-004","kind":"recouvrement","season":2026,
   "synthetic":true,"official":false,
   "validated_by":"Moussa Gounou","validated_at":"2026-03-02T08:14:00Z",
   "validation_channel":"offline-sync"}}]}
```

### `POST /api/friction/{id}/validate`
```bash
curl -X POST http://localhost:8000/api/friction/FRIC-002/validate \
  -H 'Content-Type: application/json' \
  -d '{"status":"confirmed","note":"Champ de coton verifie sur place","agent":"Moussa Gounou"}'
```
Renvoie la feature mise à jour ; l'historique complet (qui / quand / quoi) est
ajouté dans `properties.validation_history`.
```json
{"type":"Feature","geometry":{"...":"..."},
 "properties":{"id":"FRIC-002","status":"confirmed","severity":5,"confidence":0.78,
  "validated_by":"Moussa Gounou","validated_at":"2026-09-11T20:13:11Z",
  "validation_history":[{"friction_id":"FRIC-002","status":"confirmed",
    "note":"Champ de coton verifie sur place","agent":"Moussa Gounou",
    "channel":"api","created_at":"2026-09-11T20:13:11Z"}]}}
```
`404` si l'identifiant est inconnu, `422` si le statut n'est pas dans
`pending|confirmed|corrected|invalidated`.
Une validation **modifie immédiatement la surface de coût** du moteur d'itinéraire
(une friction `invalidated` cesse de pénaliser le passage).

### `GET /api/routes?commune={id}&from=<lon,lat>&to=<lon,lat>`
```bash
curl 'http://localhost:8000/api/routes?commune=banikoara&from=2.452,11.09&to=2.43,11.52'
```
`commune` est facultatif : sans lui, la commune est **déduite des coordonnées**
(l'ancienne forme de l'appel continue donc de fonctionner).

> **Périmètre borné — contrainte dure (SPEC §5).** Le calcul reste
> **intra-commune ou entre deux communes adjacentes**. Une demande entre deux
> communes non adjacentes est **refusée en ~1 ms** avec un message explicite,
> plutôt que calculée sur les 5 départements :
> ```json
> {"detail":"itineraire refuse : Banikoara (banikoara) et Dassa-Zoume (dassa-zoume) ne sont pas des communes adjacentes. Le calcul d'itineraire reste intra-commune ou entre deux communes voisines (SPEC section 5) : mailler tout le nord et le centre du Benin d'un coup serait inutilisable. Voisines de Banikoara : gogounou, kandi, karimama, kerou."}
> ```
> Un point hors des 33 communes renvoie lui aussi `400`, avec la bbox couverte.
```json
{"from":[2.452,11.09],"to":[2.43,11.52],
 "communes":["banikoara"],"commune":"banikoara","scope":"intra-commune",
 "computed_in_ms":962.0,
 "grid":{"resolution_m":200.0,"rows":277,"cols":284,"nodes":78668,"edges":312991},
 "alternatives":[
  {"id":"ALT-A","label":"Trace de moindre cout",
   "geometry":{"type":"LineString","coordinates":[[2.4527,11.0905], "..."]},
   "distance_km":61.16,"cost":24.5,
   "constraints":[
     "suit l'emprise validee du couloir sur 92 % du trajet",
     "s'ecarte de 1,6 km du couloir valide",
     "ne traverse aucune parcelle cultivee detectee",
     "frole 7 parcelles cultivees a moins de 100 m",
     "dont 2 parcelles de confiance faible (< 0,6) : a verifier au sol",
     "passe au contact de 10 zones de friction (dont 7 confirmees au sol, gravite max 5/5)",
     "dessert 3 points d'eau accessibles a moins de 1,5 km (dont 1 saisonnier)",
     "traverse 2 zones de paturage"],
   "uncertain_segments":[[54,61]],
   "data_used":["emprise du couloir reconstituee (non officielle)",
     "parcelles detectees (Sentinel-2 / Sentinel-1, synthetiques)",
     "zones de friction validees terrain","points d'eau (accessibilite declaree)",
     "zones de paturage",
     "grille de cout Terra Sentinelle (200 m, ponderee par la confiance de chaque objet)"],
   "mean_confidence":0.69,"recommended":true},
  {"id":"ALT-B","label":"Ajustement local (evite les portions contraintes)","distance_km":62.24,"cost":25.2, "...":"..."},
  {"id":"ALT-C","label":"Contournement (s'ecarte de l'emprise)","distance_km":49.72,"cost":44.6, "...":"..."}],
 "synthetic":true,"official":false,
 "disclaimer":"Itineraire calcule sur des donnees de demonstration synthetiques..."}
```
`uncertain_segments` = couples `[index_début, index_fin]` **dans le tableau de
coordonnées de la géométrie renvoyée** : portions dont les données sous-jacentes
ont une confiance < 0,6. À tracer en pointillés.
`400` si un point est hors de la zone couverte, si les communes ne sont pas
adjacentes, ou si un paramètre est mal formé.
Pour un couple de communes, `scope` vaut `"inter-communes adjacentes"` et la
grille est automatiquement relâchée (250 à 400 m selon l'étendue) pour tenir le
temps de réponse.

### `POST /api/observations` — synchronisation hors ligne
```bash
curl -X POST http://localhost:8000/api/observations -H 'Content-Type: application/json' -d '{
 "device":"tecno-spark-moussa","agent":"Moussa Gounou","batch":[
  {"client_id":"obs-2026-03-02-001","friction_id":"FRIC-001","status":"confirmed",
   "note":"Champ de coton en place, passage reduit a 30 m",
   "observed_at":"2026-03-02T08:14:00Z",
   "geometry":{"type":"Point","coordinates":[2.4811,11.3126]}}]}'
```
```json
{"accepted":4,"rejected":3,"synced_at":"2026-09-11T20:13:46Z",
 "new":4,"duplicates":0,
 "accepted_ids":["obs-2026-03-02-001","..."],"duplicate_ids":[],
 "rejected_details":[
   {"index":4,"client_id":null,"reason":"client_id manquant"},
   {"index":5,"client_id":"obs-2026-03-02-006",
    "reason":"statut invalide 'peut-etre' ; admis : pending|confirmed|corrected|invalidated"},
   {"index":6,"client_id":"obs-2026-03-02-007","reason":"zone de friction inconnue : FRIC-404"}],
 "validations_applied":3}
```
**Idempotence.** La déduplication se fait sur `client_id` (ou `id`), y compris à
l'intérieur d'un même lot. Rejouer le lot renvoie le même succès sans rien créer :
`accepted` reste identique, `new` passe à `0` et `duplicates` monte. Une
observation portant `friction_id` + `status` déclenche aussi la validation
correspondante, journalisée avec `channel = "offline-sync"`.

### `GET /api/decisions`
```json
[{"id":"DEC-003","corridor_segment_id":"SEG-06","decision":"contournement",
  "committee":"Comite communal de transhumance de Banikoara",
  "note":"Zone contestee entre eleveurs et exploitants : contournement par l'est valide en seance.",
  "decided_on":"2026-02-25",
  "broadcast":{"lang":"ff","duration_s":61,
    "transcript_fr":"Le comite communal decide un contournement du segment SEG-06 par l'est. ...",
    "audio_url":null,"synthetic":true}}]
```

### `POST /api/decisions`
```bash
curl -X POST http://localhost:8000/api/decisions -H 'Content-Type: application/json' \
 -d '{"corridor_segment_id":"SEG-07","decision":"ajustement",
      "committee":"Comite communal de transhumance de Banikoara",
      "note":"Friction FRIC-002 confirmee au sol : passage decale de 250 m a l est"}'
```
```json
{"id":"DEC-004","corridor_segment_id":"SEG-07","decision":"ajustement",
 "committee":"Comite communal de transhumance de Banikoara",
 "note":"Friction FRIC-002 confirmee au sol : passage decale de 250 m a l est",
 "decided_on":"2026-09-11",
 "broadcast":{"lang":"ff","duration_s":32,
  "transcript_fr":"Le comite communal ajuste le passage sur le segment SEG-07. Le trace est modifie localement pour eviter les champs confirmes. Friction FRIC-002 confirmee au sol : passage decale de 250 m a l est. Les representants des eleveurs sont pries d'en informer les campements avant le depart.",
  "audio_url":null,"synthetic":true,
  "note":"Synthese vocale fulfulde non branchee dans le prototype : seul le texte a diffuser est produit."}}
```
Le transcript français est généré ; **aucune synthèse vocale fulfulde n'est
branchée** dans le prototype (`audio_url: null`).

Le comité peut décider sur **n'importe laquelle des 33 communes** : les segments de
la commune de référence gardent leurs identifiants courts (`SEG-01…SEG-08`),
ailleurs ils suivent le motif `SEG-<COMMUNE>-NN` (`SEG-KANDI-02`). `404` si le
segment n'existe nulle part, avec le motif rappelé dans le message.

### `GET /api/stats?commune={id}`
Tous les compteurs sont **calculés sur les données servies**. Seul le bloc `model`
contient des valeurs de démonstration, explicitement marquées.
**Sans `commune`**, les chiffres portent sur les 33 communes et un bloc
`by_department` est ajouté ; **avec `commune`**, sur cette commune seule.
Les volumes viennent des agrégats précalculés au seed, seules les frictions
(statut à jour) sont parcourues : ≈ 19 ms pour toute la région.
```json
{"scope":{"commune":null,"communes":33,"departments":5,
  "label":"33 communes / 5 departements (nord & centre Benin)"},
 "friction_total":157,"confirmed":39,"pending":84,"invalidated":18,"corrected":16,
 "km_corridor":1585.0,
 "last_pass":{"date":"2026-02-16","sensor":"sentinel-1","cloud_pct":31,"synthetic":true},
 "model":{"f1":0.81,"precision":0.78,"recall":0.84,
   "tested_on":"valeurs de demonstration — aucun entrainement reel ; cible : parcelles annotees a la main sur composite Sentinel-2 median (saison 2025-2026, commune de Banikoara)",
   "version":"ts-demo-0.3.0","demo_values":true},
 "demo_values":true,
 "coverage":{"parcels_total":483,"parcels_in_corridor":98,"parcels_area_ha":1411.2,
   "villages":198,"water_points":93,"water_points_seasonal":44,"pastures":77,
   "corridor_segments":136,"communes":33},
 "by_department":[{"id":"alibori","name":"Alibori","commune_count":6,
   "friction_count":39,"max_severity":5,"pending":18,"corridor_km":415.8}, "..."],
 "friction_area_ha":29.97,"mean_confidence":0.65,"low_confidence":5,
 "severity_histogram":{"1":0,"2":3,"3":3,"4":2,"5":2},
 "by_source":{"sentinel-2":4,"sentinel-1":4,"terrain":2},
 "field_validations":4,"observations_synced":4,"decisions":4,
 "synthetic":true,"official":false,"disclaimer":"..."}
```

### Compléments hors contrat (le frontend peut les ignorer)
- `GET /api/health` — état du serveur, couverture, périmètre de la grille en cache
- `GET /api/validations?friction_id=FRIC-002` — journal des validations
- `GET /api/observations` — observations synchronisées
- `GET /` — index des endpoints

---

## Moteur d'itinéraire

0. **Périmètre borné (contrainte dure).** La grille couvre **une commune**, ou
   **deux communes adjacentes** — jamais la région : à 200 m, les 5 départements
   feraient ~9 millions de cellules. L'adjacence est dérivée des emprises de
   `communes.json` ; une demande hors périmètre est refusée, pas calculée.
1. **Grille de coût** sur la bbox du périmètre, 200 m par défaut
   (Banikoara : 277 × 284 = 78 668 cellules — inchangé). Au-delà de
   `TS_GRID_MAX_CELLS` (80 000), la maille est **relâchée automatiquement** :
   aucun des 86 couples de communes adjacentes ne dépasse ce plafond, donc aucun
   ne dépasse le temps de calcul d'une commune seule. 100 m reste possible via
   `TS_GRID_RES_M=100`, au prix du temps de calcul.
   Les grilles et les graphes des 3 derniers périmètres sont gardés en cache
   (un graphe networkx de 80 000 nœuds est volumineux : on n'en garde pas plus).
2. **Surface de coût** (`routing.py`) :
   - coût **très élevé** : parcelles cultivées, frictions confirmées, abords
     immédiats des villages et frictions graves confirmées (interdites de fait) ;
   - coût **réduit** : emprise validée du couloir (0,35), pâturages (0,65),
     abords des points d'eau accessibles (× 0,85) ;
   - coût **moyen** ailleurs (1,0) ;
   - **chaque pénalité est multipliée par la confiance de l'objet** : une détection
     à 0,45 de confiance pèse deux fois moins qu'une détection confirmée au sol.
     Une friction `invalidated` par un agent ne pèse plus rien.
3. **Plus court chemin** : graphe 8-connexe networkx, A\* avec heuristique
   admissible (coût minimal de la grille × distance à vol d'oiseau).
4. **3 alternatives distinctes**, correspondant aux trois décisions possibles du
   comité : tracé de moindre coût, **ajustement local** (on renchérit uniquement
   les cellules contraintes du tracé précédent), **contournement** (on renchérit
   tout le tracé précédent, sur un voisinage plus large).

**Temps mesurés** (portable, 3 alternatives, bout en bout via HTTP) :

| Requête | Temps |
|---|---|
| `?commune=banikoara` (grille 200 m, 78 668 cellules) | **1,07 – 1,16 s** |
| `?commune=natitingou` | 0,52 s |
| `?commune=tchaourou` (la plus vaste) | 1,15 s |
| Banikoara ↔ Karimama (couple, 350 m) | 1,16 s à froid, 0,90 s à chaud |
| Bantè ↔ Tchaourou (couple le plus étendu, 400 m) | 1,43 s à froid, 1,21 s à chaud |
| communes non adjacentes → refus `400` | 0,0014 s |

Sous la limite de 2 s dans tous les cas, sans régression sur la commune de
référence.

**Limites assumées** : une cellule de 200 m est plus large que l'emprise de 100 m
du couloir, on tolère donc une demi-cellule d'écart pour accorder le bonus
« dans l'emprise » ; les coûts sont des choix d'ingénierie documentés, pas un
modèle calibré.

## Chaîne satellite

Voir **[`docs/pipeline.md`](docs/pipeline.md)** : composite médian Sentinel-2 avec
masquage nuages (la saison de culture est la saison des pluies), complément
Sentinel-1 en saison humide, Dynamic World V1 comme a priori, adaptation locale
parce que les cartes globales sous-performent sur l'agriculture subsaharienne.
Le squelette Earth Engine correspondant est dans
[`docs/ee_crop_detection.js`](docs/ee_crop_detection.js) — **il n'est pas exécuté
par le prototype**.
