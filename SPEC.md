# Terra Sentinelle — Spécification partagée
Hackathon Deep Learning IndabaX Bénin 2026 · Équipe KOBA David
Défi revendiqué : **Résilience climatique** (secondaire : agriculture & sécurité alimentaire)

## 1. Pitch canonique (NE PAS REFORMULER — copier tel quel)

Dans le nord du Bénin, les couloirs de transhumance ont été délimités, mais les cartes deviennent
rapidement obsolètes à mesure que l'occupation du sol évolue au fil des saisons agricoles.
Terra Sentinelle transforme ces cartes statiques en un système de veille actualisé. À partir d'images
satellitaires Sentinel-2, un modèle de classification identifie les zones potentiellement mises en culture
à l'intérieur ou à proximité de l'emprise des couloirs, puis génère avant chaque saison de transhumance
une carte de friction indiquant les portions potentiellement contraintes, avec un niveau de gravité et de
confiance. Les agents communaux peuvent confirmer, corriger ou invalider ces détections depuis le terrain,
y compris hors connexion. Le comité communal de transhumance dispose alors d'une situation actualisée pour
examiner les portions sensibles, décider d'un maintien, d'un ajustement ou d'un contournement du parcours,
puis diffuser sa décision aux représentants des éleveurs sous forme de message vocal en fulfulde.
Chaque donnée conserve sa source, sa date de collecte, son niveau de confiance et son statut de validation,
tandis que les zones incertaines restent explicitement signalées. Terra Sentinelle ne prédit pas les conflits
et ne délivre aucune autorisation de passage : il actualise la connaissance du territoire afin que la
décision humaine soit prise en amont, sur la base d'informations récentes, traçables et vérifiables.

## 2. Phrase de cadrage (accroche, à utiliser partout)
« Les couloirs de transhumance ont été délimités une fois. Les champs, eux, changent chaque saison.
Le conflit ne naît pas d'une carte absente, il naît d'une carte périmée. »

## 3. Phrase de refus (JAMAIS l'affaiblir, JAMAIS ajouter "automatique")
« Terra Sentinelle ne prédit pas les conflits et ne délivre aucune autorisation de passage. »

## 4. Utilisateur principal (un seul, nommé)
**Moussa Gounou**, agent d'élevage de la mairie de Banikoara (Alibori).
Scénario : avant la saison, il reçoit une carte de friction listant les portions du couloir devenues
cultivées. Il va vérifier sur le terrain, hors réseau, confirme ou invalide chaque détection depuis son
téléphone. Au retour du réseau, tout se synchronise. Le comité communal arbitre le lendemain.
Utilisateurs secondaires : le comité communal de transhumance (web) ; les représentants d'éleveurs
(destinataires du message vocal en fulfulde).

## 5. Couverture géographique — NORD & CENTRE BÉNIN (élargi le 11 sept 2026)
Le projet ne se limite plus à une commune. Il couvre **5 départements / 33 communes** :

- **Alibori** (6) : Banikoara, Gogounou, Kandi, Karimama, Malanville, Ségbana
- **Atacora** (9) : Boukoumbé, Cobly, Kérou, Kouandé, Matéri, Natitingou, Péhunco, Tanguiéta, Toucountouna
- **Borgou** (8) : Bembèrèkè, Kalalé, N'Dali, Nikki, Parakou, Pèrèrè, Sinendé, Tchaourou
- **Donga** (4) : Bassila, Copargo, Djougou, Ouaké
- **Collines** (6) : Bantè, Dassa-Zoumè, Glazoué, Ouèssè, Savalou, Savè

⚠️ Cette liste doit vivre dans UN SEUL fichier de données (`backend/data/communes.json`) pour être
corrigeable sans toucher au code. Elle est à faire vérifier par David avant le pitch.

**Commune de référence pour la démo détaillée : Banikoara** (Alibori), centre 11.298 N / 2.438 E.
C'est celle qui porte le jeu de données le plus riche ; les autres sont générées à plus faible densité.

**Deux échelles dans l'interface :**
1. **Vue régionale** — les 33 communes, réseau de couloirs inter-communal, frictions agrégées par
   commune (nombre, gravité maximale, date du dernier passage satellite). Point d'entrée de l'app.
2. **Vue communale** — le détail d'une commune : couloir, frictions unitaires, parcelles, villages,
   points d'eau, pâturages. C'est là que se font la validation terrain et le calcul d'itinéraire.

⚠️ PERFORMANCE : le calcul d'itinéraire reste **intra-commune ou entre communes adjacentes**.
Ne jamais construire une grille de coût sur les 5 départements d'un coup — ce serait trop lent.
L'emprise des couloirs reste RECONSTITUÉE par l'équipe, non officielle, partout.

## 6. Données (réelles, vérifiées)
- Sentinel-2 (optique 10 m) et Sentinel-1 (radar, traverse les nuages) — Copernicus / Earth Engine, libres
- Dynamic World V1 — occupation du sol 10 m quasi temps réel, classe "crops" avec probabilités
- ESA WorldCover v200 — 10 m, 11 classes dont cropland
- OpenStreetMap Bénin — Geofabrik
- Limites administratives — HDX
- OIM TTT-DTM — suivi des mouvements de transhumance, couloir central (points, pas de polygones)
LIMITE CONNUE : aucun jeu ouvert de polygones de couloirs du Bénin. Le PFR / e-Foncier de l'ANDF existe
(~460 000 parcelles, 24 arrondissements de 12 communes) mais n'est pas ouvert.
PIÈGE TECHNIQUE : saison de culture = saison des pluies = nuages. Parade retenue : composite médian
Sentinel-2 avec masquage nuages, complété par Sentinel-1 en saison humide.
ARGUMENT CLÉ : les cartes d'occupation du sol globales sous-performent sur l'agriculture subsaharienne
(petites parcelles, cultures associées). On part de Dynamic World comme a priori, on adapte localement,
on mesure l'écart. Notre contribution n'est PAS le classifieur, c'est le croisement avec l'emprise du
couloir et le produit de décision remis au comité.

## 7. Identité visuelle — DOUBLE THÈME CLAIR / SOMBRE (changé le 11 sept 2026)
Nom : **Terra Sentinelle** (n'utiliser NULLE PART "TerraVeille" — marque abandonnée)

L'app doit proposer **les deux thèmes**, avec un sélecteur visible (clair / sombre / système).
Défaut = préférence système (`prefers-color-scheme`). Le choix persiste en localStorage.
Le thème CLAIR est le thème de référence : c'est un outil de bureau consulté en réunion de comité,
souvent en plein jour. Le sombre est là pour le terrain et le confort visuel.

Toutes les couleurs sont des variables CSS redéfinies par thème. AUCUNE couleur ne doit être
codée en dur dans un composant.

THÈME CLAIR (référence)
  --bg          #F2F6F3
  --bg-raise    #FFFFFF
  --glass       rgba(255,255,255,0.62)   + backdrop-filter: blur(24px) saturate(180%)
  --glass-brd   rgba(255,255,255,0.85)   + ombre portée douce pour détacher du fond
  --text        #0E1A14
  --text-dim    #566860
  --accent      #0F9D6B   vert — validé, couloir sûr
  --amber       #B0760A   attention / incertitude
  --red         #CE4139   friction grave
  --sand        #9A6F46   terrain, parcelles cultivées

THÈME SOMBRE
  --bg          #0C1712
  --bg-raise    #11201A
  --glass       rgba(255,255,255,0.07)   + backdrop-filter: blur(24px) saturate(180%)
  --glass-brd   rgba(255,255,255,0.16)
  --text        #E9F2ED
  --text-dim    #93A79D
  --accent      #34D399
  --amber       #F5B544
  --red         #F0665F
  --sand        #D9B48F

Polices (Google Fonts) : **Space Grotesk** (titres), **Inter** (UI), **JetBrains Mono** (chiffres).

Liquid glass dans LES DEUX thèmes :
- sombre : verre clair translucide sur fond sombre, bordure claire, reflet spéculaire sur l'arête haute
- clair : verre blanc translucide sur fond clair — le relief vient de l'OMBRE PORTÉE et d'une bordure
  blanche lumineuse, pas d'une bordure sombre. C'est le piège classique du glass en clair : sans ombre,
  les panneaux disparaissent dans le fond.
- commun : blur 20-28px, rayons squircle 22-28px, transitions cubic-bezier(.22,1,.36,1)
- Le fond de carte doit suivre le thème (style clair / style sombre).
- CONTRASTE : viser WCAG AA sur le texte dans les deux thèmes. Vérifier le texte dim sur verre.

Sobriété : outil de décision publique, pas application lifestyle. Pas de néon, pas d'excès.

## 8. Contrat d'API (frontend ET backend s'y tiennent)
Base : http://localhost:8000/api

GET  /communes                 -> [{id, name, department, center:[lon,lat], bbox, friction_count,
                                     max_severity, last_pass:{date,sensor,cloud_pct}}]  (les 33)
GET  /departments              -> [{id, name, commune_count, friction_count, max_severity}]
GET  /region                   -> {name:"Nord & Centre Bénin", bbox, commune_count, department_count,
                                   corridor_km_total, center:[lon,lat]}
GET  /region/corridors         -> FeatureCollection du réseau inter-communal (simplifié pour la vue large)
GET  /commune/{id}             -> {id, name, department, center:[lon,lat], bbox:[w,s,e,n]}
GET  /commune/{id}/corridor    -> FeatureCollection (emprise du couloir, LineString axe + Polygon emprise)
                                  properties: {id, name, width_m, source, delimited_on, official:false}
GET  /commune/{id}/layers/{kind} -> FeatureCollection ; kind ∈ villages|water_points|pastures|parcels
GET  /friction?season=2026&commune={id}  -> FeatureCollection de zones de friction
     feature.properties: {
       id, severity:1..5, confidence:0..1, area_ha, detected_on (ISO date),
       source:"sentinel-2"|"sentinel-1"|"terrain", model_version,
       status:"pending"|"confirmed"|"corrected"|"invalidated",
       corridor_segment_id, note
     }
POST /friction/{id}/validate   body {status, note, agent} -> feature mis à jour
GET  /routes?commune={id}&from=<lon,lat>&to=<lon,lat>   (intra ou inter-communes adjacentes)
     -> {alternatives:[{id, geometry(LineString), distance_km, cost, constraints:[str],
                        uncertain_segments:[[idx,idx]], data_used:[str]}]}
POST /observations             body {batch:[{...}]} -> {accepted, rejected, synced_at}  (sync hors-ligne)
GET  /decisions                -> [{id, corridor_segment_id, decision:"maintien"|"ajustement"|"contournement",
                                    committee, decided_on, broadcast:{lang:"ff", duration_s, transcript_fr}}]
POST /decisions                body {corridor_segment_id, decision, committee, note}
GET  /stats                    -> {friction_total, confirmed, pending, invalidated, km_corridor,
                                   last_pass:{date, sensor, cloud_pct}, model:{f1, precision, recall, tested_on}}

RÈGLE DE COMPATIBILITÉ : garder les anciennes routes sans {id} comme alias vers Banikoara,
afin de ne pas casser ce qui existe.

Toutes les réponses géo sont du GeoJSON valide (EPSG:4326, lon/lat).
CORS ouvert sur localhost:5173.

## 9. Honnêteté obligatoire dans TOUS les livrables
- Données de démonstration synthétiques mais plausibles → le signaler visiblement
- Emprise du couloir reconstituée, non officielle → le signaler
- Métriques du modèle = valeurs de démonstration tant qu'aucun entraînement réel n'a eu lieu → le signaler
- L'incertitude s'affiche (pointillés, niveau de confiance), elle ne se cache pas

## 10. MODÈLE RÉEL (ajouté le 11 sept 2026) — remplace les « valeurs de démonstration »

Jusqu'ici aucun modèle n'était entraîné et l'interface l'annonçait honnêtement. Ce n'est plus le cas.

**Entraînement — données RÉELLES**
- Jeu : **EuroSAT** (imagerie Sentinel-2 réelle, étiquetée, 10 classes, tuiles 64×64).
  Source : https://zenodo.org/records/7711810/files/EuroSAT_RGB.zip
- Tâche binaire : **cultivé** (AnnualCrop, PermanentCrop) vs **non cultivé** (le reste).
  Garder aussi la sortie multi-classes, elle est plus parlante en démo.
- Split train/test stratifié, **jeu de test tenu à l'écart**. Graine fixée, reproductible.
- Modèle : scikit-learn (HistGradientBoostingClassifier ou équivalent). Pas de deep learning :
  pas de GPU ici, et la pertinence prime sur la complexité inutile.
- Caractéristiques : statistiques par canal, indices de végétation dérivés du visible
  (ExG = 2G−R−B, GRVI = (G−R)/(G+R)), mesures de texture. Documenter le choix.

**Inférence — imagerie RÉELLE du nord Bénin**
- Tuiles Sentinel-2 via EOX s2cloudless, sans authentification :
  https://tiles.maps.eox.at/wmts?layer=s2cloudless-2020_3857&style=default&tilematrixset=g
  &Service=WMTS&Request=GetTile&Version=1.0.0&Format=image%2Fjpeg
  &TileMatrix={z}&TileCol={x}&TileRow={y}
- Le modèle tourne sur ces vraies tuiles, sur l'emprise réelle des communes.
- **Cache disque obligatoire** des tuiles téléchargées : la démo ne doit pas dépendre du réseau.
  Pré-télécharger et versionner le cache pour au moins Banikoara.

**HONNÊTETÉ — le point le plus important de cette section**
Le modèle est entraîné sur de l'imagerie EUROPÉENNE et appliqué au Bénin. C'est un **écart de
domaine réel et documenté** : les cartes d'occupation du sol globales sous-performent sur
l'agriculture subsaharienne (petites parcelles, cultures associées). Il faut :
- afficher les métriques RÉELLES mesurées sur le test EuroSAT, avec leur provenance ;
- dire explicitement que ces métriques valent pour l'Europe et NON pour le Bénin ;
- ne JAMAIS présenter une prédiction sur le Bénin comme validée. C'est une sortie de modèle
  non validée localement, qui doit être vérifiée par l'agent communal — ce qui est exactement
  le rôle de Moussa dans le produit.
- Retirer partout la mention « valeurs de démonstration » pour les métriques : elles deviennent
  réelles. La remplacer par la provenance et l'avertissement d'écart de domaine.

**Contrat d'API — ajouts**
GET  /model                    -> {name, version, task, trained_on:{dataset, source, n_train, n_test,
                                   classes}, metrics:{accuracy, precision, recall, f1, per_class,
                                   confusion}, seed, real:true, domain_gap:<texte d'avertissement>}
POST /predict/tile             body {z,x,y} OU {lon,lat,zoom}
                               -> {p_cultivated, predicted_class, confidence, tile_url, cached:bool}
GET  /commune/{id}/predictions -> FeatureCollection de cellules sur l'emprise réelle de la commune,
                                  properties {p_cultivated, predicted_class, confidence, tile:{z,x,y},
                                  validated:false, source:"model"}
POST /commune/{id}/predict     -> relance l'inférence (bornée, voir perf) et renvoie le résultat

**PERFORMANCE — contrainte dure**
Inférence bornée : au plus ~64 tuiles par commune (grille 8×8), tuiles mises en cache.
Une prédiction de commune doit répondre en moins de 5 s une fois le cache chaud.
Ne jamais lancer d'inférence sur les 33 communes d'un coup.

## 11. ÉTAT RÉEL DU PROJET AU 12 SEPTEMBRE 2026 (source unique pour les documents)

Les documents (deck, note de conception, pitch) doivent refléter EXACTEMENT cet état.
Tout ce qui suit a été mesuré, pas estimé.

### Ce qui est LIVRÉ et vérifié
- **Couverture** : 5 départements, 33 communes (Alibori 6, Atacora 9, Borgou 8, Donga 4,
  Collines 6). Réseau de 1 585 km. 157 zones de friction, dont 84 en attente de vérification.
- **Commune de référence** : Banikoara, 57,13 km de couloir, 8 segments, 17 villages,
  7 points d'eau, 5 zones de pâturage, 32 parcelles dont 6 dans l'emprise, 10 frictions.
- **MODÈLE RÉELLEMENT ENTRAÎNÉ** (ce n'est plus une valeur de démonstration) :
  EuroSAT RGB, imagerie Sentinel-2 réelle étiquetée, 27 000 vignettes 64x64, 10 classes.
  Split stratifié 21 600 / 5 400, jeu de test tenu à l'écart, graine fixée.
  Algorithme : sklearn HistGradientBoostingClassifier. 35 caractéristiques
  (statistiques par canal, ExG, GRVI, texture). Version ts-eurosat-1.0.0.
  **Métriques mesurées : accuracy 0,9528 | précision 0,902 | rappel 0,8618 | F1 0,8815 |
  ROC-AUC 0,9866. Multi-classes 10 classes : accuracy 0,8883, F1 macro 0,8821.**
- **Inférence sur imagerie RÉELLE du nord Bénin** : tuiles Sentinel-2 via EOX s2cloudless,
  sans authentification, mises en cache sur disque (fonctionne hors connexion).
  Grille 8x8 = 64 cellules par commune. Sur Banikoara : 7 cellules en culture permanente,
  1 en culture annuelle, 56 en végétation herbacée ; p_cultivated de 0,003 à 0,991.
- **Itinéraires** : 3 alternatives sur Banikoara en 0,94 s (60,4 / 50,7 / 54,5 km),
  grille de coût 200 m, bornée à une commune ou deux communes adjacentes.
- **API** : endpoints régionaux entre 1 et 11 ms.
- **Application web** : vue régionale, carte de friction, fiche de détection, mode terrain
  hors connexion, écran comité, tableau de bord, écran modèle.
  **Thèmes clair ET sombre** (le clair est le thème de référence).
  Responsive vérifié par capture à 360, 390, 768 et 1280 px.
  Double mode dégradé (API absente → données embarquées ; tuiles absentes → fond CSS).
- **Code source public** : https://github.com/KOBA2008/terra-sentinelle
- **Démonstration en ligne** : https://terra-sentinelle-5hp8hl4hs-koba-davids-projects.vercel.app
  (sans backend, sur données embarquées)

### Ce qui NE fonctionne PAS encore (à dire explicitement)
- Le modèle est entraîné sur de l'imagerie EUROPÉENNE et appliqué au Bénin. Les métriques
  décrivent EuroSAT, PAS le Bénin. Aucune mesure de performance locale, faute de parcelles
  annotées sur la zone. Toute prédiction béninoise est une sortie NON validée localement.
- Aucun jeu ouvert de polygones de couloirs pour le Bénin. Le PFR / e-Foncier de l'ANDF
  existe mais n'est pas ouvert. L'emprise utilisée est une reconstitution de l'équipe,
  sans valeur officielle. Couloirs, villages, points d'eau, pâturages et parcelles sont
  générés. L'imagerie satellitaire et le modèle, eux, sont réels.
- Fusion Sentinel-1 décrite et justifiée, NON implémentée (seule la voie optique tourne).
- Diffusion vocale en fulfulde maquettée, sans chaîne audio réelle.
- Coordonnées des 33 communes approximatives, à faire vérifier.
- Effet réel conditionné à l'usage par un comité : le vrai test (un comité a-t-il modifié
  une décision après avoir vu la carte ?) reste à faire.

### RÈGLE TYPOGRAPHIQUE (décidée le 11 sept 2026)
**Aucun tiret cadratin dans les documents.** Utiliser deux-points pour une explication,
point médian pour un séparateur, virgule sinon. Cette règle a déjà été appliquée au site.

### Défi revendiqué
Résilience climatique (secondaire : agriculture et sécurité alimentaire ; la diffusion
vocale en fulfulde touche aussi le défi IA et langues locales).

## 12. ÉQUIPE ET RÈGLES DE RÉDACTION (12 septembre 2026)

### Équipe : TechMakers
Le projet n'est PAS signé par une personne seule. Partout où une équipe est nommée
(page de titre du deck, page de garde des PDF, pied de page, README, bloc contact),
écrire :

**Équipe TechMakers**
- KOBA David
- GANTIN Philippe-Cadet
- ADANLAO Adéyinka Laurinda
- DJIBO Issa
- ABIALA Daniel

Remplacer toute mention « Équipe KOBA David » ou « KOBA David » seul en tant que porteur.
Respecter l'orthographe exacte des noms, accents compris.

### Formulations retirées (décision de l'équipe, déjà appliquée au site)
Ces éléments ont été retirés de l'application ; ils doivent l'être aussi des documents :
1. La mention « Démonstration : données synthétiques, emprise de couloir reconstituée
   (non officielle) » sous toutes ses formes.
2. La phrase « Terra Sentinelle ne prédit pas les conflits et ne délivre aucune
   autorisation de passage », y compris à l'intérieur du pitch canonique.
3. Le bloc « Limites connues » tel qu'il était rédigé.
4. Les mentions « valeurs de démonstration » et « aucun entraînement réel ».

Conséquence sur la SPEC : les sections 1 et 3 ne sont plus des citations obligatoires.
Le pitch canonique se termine désormais sur la phrase utile, sans la clause de refus.
La phrase de cadrage (section 2) reste, elle, inchangée et utilisable.

Ce qui RESTE dit, parce que factuel et demandé par le formulaire du hackathon :
ce qui fonctionne et ce qui ne fonctionne pas encore (SPEC section 11), notamment
l'écart de domaine du modèle, la fusion Sentinel-1 non implémentée, la diffusion vocale
maquettée. Ces éléments sont des faits techniques, pas des formules de prudence.

### Typographie
Aucun tiret cadratin nulle part. Deux-points pour une explication, point médian pour un
séparateur, virgule sinon.
