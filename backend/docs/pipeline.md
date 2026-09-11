# Chaîne satellite Terra Sentinelle — ce qui tourne, ce qui est prévu

> **Lisez d'abord ceci.** Ce document sépare volontairement deux choses que les
> démonstrations de hackathon confondent souvent : le **prototype réellement
> exécuté** et la **chaîne de production visée**. Rien de ce qui est décrit dans la
> partie « prévu » n'est branché dans ce dépôt.

---

## 1. Ce qui tourne aujourd'hui dans ce prototype

| Étage | État | Détail |
|---|---|---|
| Acquisition satellite | **non branché** | aucune image n'est téléchargée ni traitée par le backend |
| Classification « mis en culture » | **non branché** | aucun modèle n'est entraîné ni chargé |
| Génération des parcelles | **simulé** | `seed.py` génère 25-40 polygones de 0,5 à 6 ha, avec `confidence`, `detected_on`, `source` et `model_version` — tous marqués `synthetic: true` |
| Croisement avec l'emprise du couloir | **réel** | intersections calculées avec shapely ; les zones de friction dérivent effectivement des recouvrements géométriques |
| Carte de friction (gravité / confiance / statut) | **réel sur données simulées** | règles explicites, pas de modèle |
| Validation terrain + synchronisation hors ligne | **réel** | SQLite, journal (qui / quand / quoi), déduplication par identifiant client |
| Moteur d'itinéraire (grille de coût, A\*, alternatives) | **réel** | `routing.py`, networkx, ~1 s pour 3 alternatives |
| Métriques du modèle exposées par `GET /api/stats` | **valeurs de démonstration** | champ `demo_values: true` ; aucun entraînement n'a eu lieu |
| Message vocal en fulfulde | **texte seulement** | le transcript à diffuser est produit ; aucune synthèse vocale n'est appelée |

**Conséquence à assumer devant le jury :** la contribution du prototype n'est pas
un classifieur d'occupation du sol. C'est le **croisement** entre une détection
de mise en culture et l'emprise d'un couloir, la **traçabilité** de chaque donnée
(source, date, confiance, statut de validation) et le **produit de décision**
remis au comité communal.

---

## 2. Chaîne visée en production

### 2.1 Le piège à regarder en face

Dans le nord du Bénin, la **saison de culture est la saison des pluies**. C'est
exactement la période où l'on veut observer la mise en culture, et exactement la
période où le ciel est couvert. Une image Sentinel-2 isolée est donc presque
inutilisable entre juin et octobre.

**Parade retenue :**

1. **Composite médian Sentinel-2** sur une fenêtre glissante (30 à 60 jours), avec
   masquage des nuages et de leurs ombres. La médiane pixel à pixel élimine les
   valeurs aberrantes laissées par un masque imparfait.
   - masquage : bande `MSK_CLDPRB` de la collection `COPERNICUS/S2_SR_HARMONIZED`,
     complétée par `COPERNICUS/S2_CLOUD_PROBABILITY` (plus fiable que QA60) et par
     une projection géométrique des ombres à partir de l'azimut solaire.
2. **Complément Sentinel-1 (radar) en saison humide.** Le radar traverse les
   nuages : c'est le seul capteur qui garantit une observation en plein
   hivernage. Les rapports de polarisation VV/VH et leur évolution temporelle
   séparent raisonnablement un sol cultivé d'une savane arbustive.
3. **Fusion** : Sentinel-2 quand le composite est suffisamment peuplé
   (`n_scenes_valides >= 3` sur la fenêtre), Sentinel-1 sinon, la source retenue
   étant écrite dans le champ `source` de chaque détection — l'utilisateur doit
   pouvoir savoir *avec quoi* la détection a été faite.

### 2.2 A priori d'occupation du sol

**Dynamic World V1** (`GOOGLE/DYNAMICWORLD/V1`, 10 m, quasi temps réel) fournit une
probabilité par classe, dont `crops`. On l'utilise comme **a priori**, pas comme
vérité :

- il donne une carte de départ immédiate, sans annotation ;
- il est déjà temporellement dense, donc utilisable en veille saisonnière.

### 2.3 Pourquoi une adaptation locale est indispensable

Les cartes d'occupation du sol globales **sous-performent sur l'agriculture
subsaharienne** : parcelles petites (souvent < 1 ha, sous la taille utile du pixel
10 m une fois les bords retirés), **cultures associées** (coton + maïs + niébé sur
la même parcelle), champs sans limites nettes, jachères courtes difficiles à
distinguer d'une mise en culture. Une classe `crops` globale confond
régulièrement jachère, savane pâturée et champ réel.

La démarche visée est donc :

1. partir de Dynamic World comme a priori ;
2. **annoter localement** un jeu de référence sur la commune de Banikoara
   (photo-interprétation sur composite Sentinel-2 + points GPS collectés par les
   agents communaux lors des tournées de validation — ces points existent déjà
   dans le produit, ils deviennent des étiquettes) ;
3. entraîner un classifieur local léger (gradient boosting sur séries
   temporelles d'indices, puis éventuellement un petit U-Net temporel) ;
4. **mesurer l'écart** entre l'a priori global et le modèle local, et publier cet
   écart. C'est un résultat en soi, y compris s'il est modeste.

### 2.4 Variables d'entrée envisagées

- Sentinel-2 : B2, B3, B4, B8, B11, B12 + NDVI, NDWI, NDTI, EVI
- statistiques temporelles sur la saison : médiane, écart-type, amplitude,
  date du maximum de NDVI (un champ a un pic marqué, la savane beaucoup moins)
- Sentinel-1 : VV, VH, VH/VV, écart-type temporel
- Dynamic World : probabilités `crops`, `grass`, `shrub_and_scrub`, `trees`

### 2.5 Sortie attendue, et ce qu'on refuse d'en faire

La sortie est un raster de probabilité « mis en culture », vectorisé en polygones,
**intersecté avec l'emprise du couloir**, puis converti en zones de friction avec
`severity` (surface et position du recouvrement) et `confidence` (probabilité du
modèle, atténuée par l'âge de l'image et le taux de nuages).

Ce que la chaîne ne produira jamais : une prédiction de conflit, une autorisation
de passage, ou une décision automatique. **Terra Sentinelle ne prédit pas les
conflits et ne délivre aucune autorisation de passage.**

### 2.6 Validation

- vérité terrain = validations des agents communaux (`POST /api/friction/{id}/validate`
  et `POST /api/observations`), qui sont déjà journalisées avec l'auteur et la date ;
- métriques reportées : précision, rappel, F1 **par classe et par saison**, plus la
  surface de désaccord en hectares — un jury et un comité communal comprennent des
  hectares mieux qu'un F1 ;
- tant qu'aucun entraînement n'a eu lieu, `GET /api/stats` renvoie `demo_values: true`.
  Ce champ ne doit pas disparaître avant qu'un vrai entraînement existe.

---

## 3. Script Earth Engine correspondant

Squelette commenté : [`ee_crop_detection.js`](./ee_crop_detection.js).

Il n'est **pas exécuté** par le prototype. Pour le lancer il faut un compte Earth
Engine et le coller dans l'éditeur de code (`https://code.earthengine.google.com`).
Il produit, pour une saison donnée, un masque « mis en culture » restreint à une
zone tampon autour de l'emprise du couloir, et l'exporte en GeoJSON — format
directement consommable par `seed.py` en remplacement des parcelles synthétiques.

---

## 4. Limites de données, listées franchement

- **Aucun jeu ouvert de polygones de couloirs de transhumance du Bénin.** L'emprise
  utilisée ici est **reconstituée** par l'équipe et n'a aucune valeur officielle.
- Le **PFR / e-Foncier de l'ANDF** (~460 000 parcelles, 24 arrondissements de
  12 communes) existe mais n'est pas ouvert : il n'est donc pas utilisable ici.
- L'**OIM TTT-DTM** suit les mouvements de transhumance sous forme de **points**, pas
  de polygones : utile pour recaler un axe, insuffisant pour délimiter une emprise.
- **ESA WorldCover v200** (10 m, 11 classes dont cropland) est annuel : trop lent
  pour une veille saisonnière, utile en contrôle croisé.
- Les positions des villages et des points d'eau du prototype sont **synthétiques**
  et ne doivent servir à aucune navigation réelle.
