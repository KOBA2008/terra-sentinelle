/**
 * Terra Sentinelle — squelette Earth Engine (NON EXECUTE par le prototype)
 * ------------------------------------------------------------------------
 * Detection des zones potentiellement mises en culture a l'interieur et a
 * proximite de l'emprise d'un couloir de transhumance, commune de Banikoara
 * (Alibori, nord Benin).
 *
 * A coller dans https://code.earthengine.google.com (compte Earth Engine requis).
 * Le backend du prototype n'appelle PAS ce script : les parcelles servies par
 * l'API sont synthetiques (voir docs/pipeline.md, section 1).
 *
 * Sortie : un GeoJSON de polygones "mis en culture" avec une probabilite, a
 * placer dans backend/data/communes/<commune>/parcels.geojson en remplacement de
 * la sortie de seed.py (memes noms de champs : id, crop, area_ha, confidence,
 * detected_on, source, model_version, plus commune / commune_name / department).
 * Depuis l'elargissement a 5 departements / 33 communes (SPEC section 5), les
 * couches sont rangees PAR COMMUNE : une exportation par commune traitee.
 */

// =====================================================================
// 0. Zone et saison
// =====================================================================
var BBOX = ee.Geometry.Rectangle([2.20, 11.05, 2.72, 11.55]);   // SPEC section 5

// Emprise du couloir. ATTENTION : reconstituee par l'equipe, non officielle.
// En production, remplacer par l'asset valide par la mairie / le comite communal.
var corridor = ee.FeatureCollection('users/<compte>/terra_sentinelle/corridor_banikoara');
var emprise  = corridor.geometry().buffer(50);      // couloir ~100 m de large
var zoneUtile = emprise.buffer(2000);               // on regarde aussi les abords

// La saison de culture EST la saison des pluies : c'est la fenetre ou l'on veut
// observer, et c'est la fenetre la plus nuageuse de l'annee.
var SAISON_DEBUT = '2025-06-15';
var SAISON_FIN   = '2025-10-31';
var FENETRE_JOURS = 45;     // largeur du composite median glissant

// =====================================================================
// 1. Sentinel-2 : masquage nuages + composite median
// =====================================================================
// S2_CLOUD_PROBABILITY est nettement plus fiable que la bande QA60.
function masqueNuages(img) {
  var prob = ee.Image(img.get('cloud_mask')).select('probability');
  var nuage = prob.gt(40);

  // Ombres portees : on projette le nuage selon l'azimut solaire et on croise
  // avec les pixels sombres du proche infrarouge.
  var sombre = img.select('B8').lt(1500);
  var azimut = ee.Number(img.get('MEAN_SOLAR_AZIMUTH_ANGLE')).multiply(Math.PI / 180.0);
  var projection = nuage.directionalDistanceTransform(azimut, 50)
                        .reproject({crs: img.select(0).projection(), scale: 100})
                        .select('distance').mask();
  var ombre = projection.and(sombre);

  var masque = nuage.or(ombre).not();
  return img.updateMask(masque)
            .divide(10000)
            .copyProperties(img, ['system:time_start']);
}

var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
           .filterBounds(zoneUtile).filterDate(SAISON_DEBUT, SAISON_FIN);
var s2cloud = ee.ImageCollection('COPERNICUS/S2_CLOUD_PROBABILITY')
                .filterBounds(zoneUtile).filterDate(SAISON_DEBUT, SAISON_FIN);

var s2joint = ee.ImageCollection(
  ee.Join.saveFirst('cloud_mask').apply({
    primary: s2, secondary: s2cloud,
    condition: ee.Filter.equals({leftField: 'system:index', rightField: 'system:index'})
  })
).map(masqueNuages);

// Indices utiles : NDVI (vigueur), NDWI (eau/humidite), NDTI (residus de culture).
function indices(img) {
  return img.addBands(img.normalizedDifference(['B8', 'B4']).rename('NDVI'))
            .addBands(img.normalizedDifference(['B3', 'B8']).rename('NDWI'))
            .addBands(img.normalizedDifference(['B11', 'B12']).rename('NDTI'));
}
var s2idx = s2joint.map(indices);

// Composite median de saison : la mediane absorbe ce que le masque a laisse passer.
var compositeS2 = s2idx.median().clip(zoneUtile);

// Combien d'observations valides par pixel ? En dessous de 3, le composite
// optique n'est PAS fiable : on bascule sur le radar (voir etape 2).
var nValides = s2idx.select('NDVI').count().rename('n_obs');

// Statistiques temporelles : un champ presente un pic de NDVI marque,
// une savane beaucoup moins.
var ndviStats = s2idx.select('NDVI').reduce(
  ee.Reducer.stdDev().combine(ee.Reducer.minMax(), '', true));

// =====================================================================
// 2. Sentinel-1 : le capteur qui traverse les nuages
// =====================================================================
var s1 = ee.ImageCollection('COPERNICUS/S1_GRD')
  .filterBounds(zoneUtile).filterDate(SAISON_DEBUT, SAISON_FIN)
  .filter(ee.Filter.eq('instrumentMode', 'IW'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
  .select(['VV', 'VH']);

var s1med = s1.median().clip(zoneUtile);
var s1std = s1.reduce(ee.Reducer.stdDev()).clip(zoneUtile);
var ratio = s1med.select('VH').subtract(s1med.select('VV')).rename('VH_VV');

// =====================================================================
// 3. Dynamic World : a priori d'occupation du sol, PAS une verite
// =====================================================================
var dw = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
  .filterBounds(zoneUtile).filterDate(SAISON_DEBUT, SAISON_FIN)
  .select(['crops', 'grass', 'shrub_and_scrub', 'trees'])
  .mean().clip(zoneUtile);

// Les cartes globales sous-performent sur l'agriculture subsaharienne :
// petites parcelles, cultures associees, limites floues. Dynamic World sert de
// point de depart et de variable d'entree, jamais de reference.

// =====================================================================
// 4. Pile de variables
// =====================================================================
var pile = compositeS2.select(['B2','B3','B4','B8','B11','B12','NDVI','NDWI','NDTI'])
  .addBands(ndviStats)
  .addBands(s1med).addBands(s1std).addBands(ratio)
  .addBands(dw)
  .addBands(nValides);

// =====================================================================
// 5. Classifieur local
// =====================================================================
// Etiquettes : photo-interpretation locale + points GPS collectes par les agents
// communaux via Terra Sentinelle (POST /api/observations). Les validations
// terrain du produit alimentent donc directement le jeu d'entrainement.
var echantillons = ee.FeatureCollection('users/<compte>/terra_sentinelle/labels_banikoara_2025');
// champ 'classe' : 1 = mis en culture, 0 = non cultive

var train = pile.sampleRegions({
  collection: echantillons, properties: ['classe'], scale: 10, tileScale: 4
});

var modele = ee.Classifier.smileGradientTreeBoost(100)
  .setOutputMode('PROBABILITY')
  .train({features: train, classProperty: 'classe', inputProperties: pile.bandNames()});

var proba = pile.classify(modele).rename('p_culture');

// Bascule optique -> radar la ou le composite S2 est trop pauvre : on trace
// explicitement le capteur ayant servi, il finit dans le champ `source` de l'API.
var capteur = nValides.gte(3).rename('source_s2');

// =====================================================================
// 6. Vectorisation et croisement avec l'emprise
// =====================================================================
var SEUIL = 0.55;
var masqueCulture = proba.gt(SEUIL).selfMask();

var parcelles = masqueCulture.addBands(proba).reduceToVectors({
  geometry: zoneUtile, scale: 10, geometryType: 'polygon', eightConnected: false,
  labelProperty: 'cultive', reducer: ee.Reducer.mean(), maxPixels: 1e10
});

// On ecarte le bruit : sous 0,3 ha, a 10 m de resolution, ce n'est pas exploitable.
parcelles = parcelles.map(function (f) {
  var ha = f.geometry().area(10).divide(10000);
  var recouvrement = f.geometry().intersection(emprise, 10).area(10).divide(10000);
  return f.set({
    area_ha: ha,
    overlap_ha: recouvrement,
    in_corridor: recouvrement.gt(0.01),
    confidence: f.get('mean'),              // probabilite moyenne du modele
    detected_on: SAISON_FIN,
    source: 'sentinel-2',                   // a remplacer par capteur reel
    model_version: 'ts-ee-0.1.0',
    official: false
  });
}).filter(ee.Filter.gt('area_ha', 0.3));

// =====================================================================
// 7. Export
// =====================================================================
Export.table.toDrive({
  collection: parcelles,
  description: 'terra_sentinelle_parcelles_banikoara_2025',
  fileFormat: 'GeoJSON'
});

Map.centerObject(BBOX, 10);
Map.addLayer(compositeS2, {bands: ['B4','B3','B2'], min: 0, max: 0.3}, 'Composite S2 median');
Map.addLayer(proba, {min: 0, max: 1, palette: ['000000', 'D9B48F', 'F0665F']}, 'p(mis en culture)');
Map.addLayer(emprise, {color: '34D399'}, 'Emprise du couloir (RECONSTITUEE)');

// RAPPEL : ce script produit une carte d'occupation du sol, rien d'autre.
// Terra Sentinelle ne predit pas les conflits et ne delivre aucune autorisation
// de passage. La decision reste au comite communal de transhumance.
