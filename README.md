# Terra Sentinelle

**Veille satellitaire des couloirs de transhumance du nord et du centre du Bénin.**

Les couloirs de transhumance ont été délimités une fois. Les champs, eux, changent chaque saison.
Terra Sentinelle transforme une carte statique en système de veille actualisé : un modèle de
classification identifie sur imagerie Sentinel-2 les zones potentiellement mises en culture à
l'intérieur ou à proximité de l'emprise des couloirs, puis génère avant chaque saison une **carte de
friction** indiquant les portions potentiellement contraintes, avec un niveau de gravité et de
confiance. Les agents communaux confirment, corrigent ou invalident ces détections depuis le terrain,
y compris hors connexion. Le comité communal de transhumance dispose alors d'une situation actualisée
pour décider d'un maintien, d'un ajustement ou d'un contournement du parcours.

Projet réalisé pour le hackathon **Deep Learning IndabaX Bénin 2026**, défi *Résilience climatique*.

**Démonstration en ligne :** https://terra-sentinelle-5hp8hl4hs-koba-davids-projects.vercel.app
*(le déploiement public fonctionne sans backend, sur données embarquées)*

---

## Couverture

**5 départements, 33 communes** du nord et du centre du Bénin : Alibori (6), Atacora (9),
Borgou (8), Donga (4), Collines (6). Réseau de couloirs de 1 585 km.
Commune de référence pour la démonstration détaillée : **Banikoara** (Alibori).

---

## Démarrage rapide

```bash
git clone git@github.com:KOBA2008/terra-sentinelle.git
cd terra-sentinelle
```

### Backend (FastAPI)

```bash
cd backend
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
./.venv/bin/python seed.py            # genere les donnees des 33 communes
./.venv/bin/uvicorn main:app --port 8000
```

### Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev -- --port 5173
```

> Le port **5173** est le seul autorisé en CORS par le backend. Sur un autre port, l'application
> bascule silencieusement sur ses données embarquées.

### Tout lancer d'un coup

```bash
./start.sh            # backend + frontend + navigateur
./start.sh --reset    # regenere les donnees de demonstration avant de demarrer
./stop.sh             # arrete les deux serveurs
```

`start.sh` affiche le nombre de communes chargées et le nombre de détections en attente de
vérification : si ce compteur est à zéro, l'écran « mode terrain » n'aura rien à montrer.

---

## Le modèle

Un classifieur d'occupation du sol est **réellement entraîné** par `backend/train_model.py`.

| | |
|---|---|
| Jeu d'entraînement | EuroSAT (RGB), imagerie Sentinel-2 étiquetée, 27 000 vignettes 64×64, 10 classes |
| Tâche | binaire *cultivé / non cultivé* (+ sortie multi-classes à 10 classes) |
| Algorithme | `sklearn.HistGradientBoostingClassifier` |
| Caractéristiques | statistiques par canal, ExG, GRVI, mesures de texture (35 dimensions) |
| Split | 21 600 train / 5 400 test, stratifié, graine fixée |

**Métriques mesurées sur le jeu de test tenu à l'écart**

| Accuracy | Précision | Rappel | F1 | ROC-AUC |
|---|---|---|---|---|
| 0,9528 | 0,902 | 0,8618 | 0,8815 | 0,9866 |

Multi-classes (10 classes) : accuracy 0,8883 · F1 macro 0,8821

Pas de deep learning : aucun GPU n'est requis, et l'entraînement complet tient en quelques minutes
sur un portable.

### Entraîner soi-même

```bash
cd backend
./.venv/bin/python train_model.py     # telecharge EuroSAT (~227 Mo) puis entraine
```

Le jeu de données n'est pas versionné ; le modèle sérialisé et sa carte de métadonnées le sont
(`backend/data/model/`).

### Inférence

Le modèle est appliqué à de vraies tuiles Sentinel-2 du nord du Bénin, servies sans authentification
par EOX s2cloudless. Les tuiles sont mises en cache sur disque (`backend/data/tiles/`, versionné) :
l'inférence fonctionne donc **hors connexion**. L'inférence est bornée à une grille 8×8 par commune.

> Le modèle est entraîné sur de l'imagerie européenne et appliqué au Bénin. Les métriques ci-dessus
> décrivent sa performance sur EuroSAT, pas au Bénin. Toute prédiction béninoise est une sortie de
> modèle non validée localement : c'est précisément ce que l'agent communal va vérifier sur le terrain.

---

## Architecture

```
terra-sentinelle/
├── backend/           FastAPI + shapely + networkx + scikit-learn
│   ├── main.py            API HTTP
│   ├── registry.py        lecture de communes.json, adjacence, reseau de couloirs
│   ├── seed.py            generation des donnees des 33 communes
│   ├── routing.py         surface de cout et calcul d'itineraires
│   ├── train_model.py     entrainement du classifieur
│   ├── predict.py         inference sur tuiles Sentinel-2
│   └── data/
│       ├── communes.json      SOURCE DE VERITE : les 33 communes (editable)
│       ├── model/             modele serialise + carte de metadonnees
│       └── tiles/             cache de tuiles Sentinel-2
├── frontend/          React 18 + Vite + TypeScript + Tailwind + MapLibre GL
├── start.sh  stop.sh  scripts de demarrage
└── SPEC.md            specification partagee (contrat d'API, palette, regles)
```

### Écrans

| Écran | Rôle |
|---|---|
| Région | les 33 communes, frictions agrégées, réseau inter-communal |
| Carte | couloir, zones de friction, couches activables une à une |
| Modèle | carte du modèle, métriques réelles, prédiction sur la commune |
| Terrain | file de vérification hors connexion, synchronisation différée |
| Comité | trois itinéraires alternatifs, décision, diffusion vocale en fulfulde |
| Chiffres | statistiques de la commune ou de la région |

### API

Base : `http://localhost:8000/api`

| Endpoint | Description |
|---|---|
| `GET /region`, `/communes`, `/departments` | vue régionale et agrégats |
| `GET /region/corridors` | réseau inter-communal simplifié |
| `GET /commune/{id}` · `/corridor` · `/layers/{kind}` | détail d'une commune |
| `GET /friction?commune={id}&status={s}` | zones de friction |
| `POST /friction/{id}/validate` | confirmer / corriger / invalider |
| `POST /observations` | synchronisation d'un lot collecté hors ligne (idempotent) |
| `GET /routes?commune={id}&from=&to=` | trois itinéraires alternatifs |
| `GET /model` | carte du modèle et métriques mesurées |
| `POST /predict/tile` · `GET /commune/{id}/predictions` | inférence |
| `GET /decisions` · `POST /decisions` | décisions du comité |

Le contrat complet est décrit dans [`SPEC.md`](SPEC.md).

---

## Fonctionnement hors connexion

L'application est conçue pour une démonstration sans réseau fiable :

- si l'API ne répond pas, elle bascule sur des données embarquées ;
- si les tuiles de fond de carte ne chargent pas, le GeoJSON s'affiche sur un fond généré en CSS ;
- le mode terrain conserve les observations localement et les rejoue à la reconnexion ;
- les tuiles Sentinel-2 nécessaires à l'inférence sont versionnées dans le dépôt.

---

## Données

| Source | Usage |
|---|---|
| Sentinel-2 (Copernicus) | imagerie optique 10 m |
| Sentinel-1 | radar, traverse la couverture nuageuse |
| EOX s2cloudless | tuiles Sentinel-2 servies sans authentification |
| EuroSAT | jeu d'entraînement étiqueté |
| Dynamic World V1, ESA WorldCover v200 | occupation du sol de référence |
| OpenStreetMap (Geofabrik) | fond de carte et voirie |
| Limites administratives (HDX) | découpage départemental et communal |
| OIM TTT-DTM | suivi des mouvements de transhumance |

**Sur les données du dépôt.** Les couloirs, villages, points d'eau, pâturages et parcelles sont
générés par `seed.py` : ce sont des données de démonstration, destinées à éprouver le produit de
décision. Il n'existe pas de jeu ouvert de polygones de couloirs de transhumance pour le Bénin ;
l'emprise utilisée est une reconstitution de l'équipe et n'a pas de valeur officielle. Les tuiles
satellitaires et le modèle, eux, sont réels.

La liste des communes se corrige directement dans `backend/data/communes.json`, sans toucher au code.

---

## Choix techniques

- **MapLibre GL** plutôt que Mapbox : aucune clé d'API à fournir.
- **SQLite et fichiers GeoJSON** plutôt que PostGIS : le backend démarre en trente secondes.
- **Gradient boosting** plutôt qu'un réseau de neurones : pas de GPU, entraînement court, résultat explicable.
- **Calcul d'itinéraire borné** à une commune ou deux communes adjacentes : une grille de coût sur
  cinq départements serait inutilisable.
- **Thème clair et sombre**, toutes les couleurs en variables CSS, aucune valeur codée en dur.

---

## Licence et équipe

Projet développé par **KOBA David** pour le hackathon Deep Learning IndabaX Bénin 2026.
