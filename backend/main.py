"""
Terra Sentinelle : API du prototype (hackathon IndabaX Benin 2026).

Contrat : SPEC.md section 8, implemente a l'identique sous le prefixe /api.
Demarrage :  python seed.py && uvicorn main:app --reload

Couverture : 5 departements / 33 communes (SPEC section 5), deux echelles :
  * vue REGIONALE  /api/region, /api/communes, /api/departments, /api/region/corridors
  * vue COMMUNALE  /api/commune/{id}, .../corridor, .../layers/{kind}
Les anciennes routes sans identifiant (/api/commune, /api/corridor, /api/layers/{kind})
restent servies comme ALIAS de la commune de reference (Banikoara) : rien de ce qui
existait ne casse (regle de compatibilite, SPEC section 8).

MODELE REEL (SPEC section 10) : les metriques de modele ne sont plus des valeurs
de demonstration. Un classifieur est REELLEMENT entraine par `train_model.py` sur
EuroSAT (imagerie Sentinel-2 reelle, etiquetee) et applique par `predict.py` a de
VRAIES tuiles Sentinel-2 du nord du Benin (EOX s2cloudless, cache disque).
  GET  /api/model                    carte de modele et metriques mesurees
  POST /api/predict/tile             prediction sur une tuile ou un point
  GET  /api/commune/{id}/predictions cellules predites sur l'emprise communale
  POST /api/commune/{id}/predict     relance l'inference (bornee a 64 cellules)

AVERTISSEMENT (SPEC section 9) : les couches vectorielles servies par cette API
(couloirs, parcelles, frictions, villages) restent SYNTHETIQUES et l'emprise du
couloir est RECONSTITUEE (non officielle).
AVERTISSEMENT (SPEC section 10) : les metriques du modele sont REELLES mais
mesurees sur un jeu de test EUROPEEN (EuroSAT). Elles ne decrivent pas la
performance au Benin : toute prediction beninoise est une sortie de modele NON
VALIDEE LOCALEMENT, a verifier sur le terrain par l'agent communal.
Terra Sentinelle ne predit pas les conflits et ne delivre aucune autorisation
de passage.
"""
from __future__ import annotations

import statistics
import threading
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Path, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

import geo
import predict
import registry
import routing
import store

DISCLAIMER = (
    "Donnees de demonstration synthetiques. Emprise du couloir reconstituee, non "
    "officielle. Terra Sentinelle ne predit pas les conflits et ne delivre aucune "
    "autorisation de passage."
)

app = FastAPI(
    title="Terra Sentinelle API",
    version="0.4.0",
    description=DISCLAIMER,
    docs_url="/docs",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(store.MissingData)
async def _missing(_r: Request, exc: store.MissingData):
    return JSONResponse(status_code=503, content={"detail": str(exc)})


@app.exception_handler(store.UnknownCommune)
async def _unknown_commune(_r: Request, exc: store.UnknownCommune):
    return JSONResponse(status_code=404, content={"detail": str(exc.args[0])})


@app.exception_handler(registry.UnknownCommune)
async def _unknown_commune2(_r: Request, exc: registry.UnknownCommune):
    return JSONResponse(status_code=404, content={"detail": str(exc.args[0])})


@app.exception_handler(routing.RouteError)
async def _route_err(_r: Request, exc: routing.RouteError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(predict.ModelUnavailable)
async def _model_unavailable(_r: Request, exc: predict.ModelUnavailable):
    """Aucun modele entraine : on le dit, on n'invente pas de chiffres."""
    return JSONResponse(status_code=503, content={
        "detail": str(exc),
        "remediation": "./.venv/bin/python train_model.py",
        "honesty": "aucune metrique n'est servie tant qu'aucun entrainement reel "
                   "n'a eu lieu (SPEC sections 9 et 10)",
    })


@app.exception_handler(predict.TileUnavailable)
async def _tile_unavailable(_r: Request, exc: predict.TileUnavailable):
    return JSONResponse(status_code=503, content={
        "detail": str(exc),
        "remediation": "pre-charger le cache : ./.venv/bin/python predict.py "
                       "--warm <commune>",
    })


@app.on_event("startup")
def _warm():
    """Prechauffe la grille de cout et le graphe en tache de fond."""
    def run():
        try:
            print(f"[terra] couverture : {len(registry.ids())} communes / "
                  f"{len(registry.departments())} departements ; "
                  f"commune de reference : {store.reference()}")
            print("[terra] prechauffage du moteur d'itineraire :", routing.warmup())
        except Exception as exc:                       # pragma: no cover
            print("[terra] prechauffage impossible :", exc)
    threading.Thread(target=run, daemon=True).start()


# =========================================================================
# Modeles d'entree
# =========================================================================
class ValidationIn(BaseModel):
    status: Literal["pending", "confirmed", "corrected", "invalidated"]
    note: str | None = None
    agent: str | None = Field(default=None, description="Agent qui valide (ex. Moussa Gounou)")


class ObservationIn(BaseModel):
    """Observation collectee sur le terrain, potentiellement hors reseau."""
    model_config = ConfigDict(extra="allow")
    client_id: str | None = Field(default=None, description="Identifiant genere par le mobile")
    id: str | None = None
    friction_id: str | None = None
    status: str | None = None
    agent: str | None = None
    note: str | None = None
    observed_at: str | None = None
    lon: float | None = None
    lat: float | None = None
    geometry: dict[str, Any] | None = None

    def key(self) -> str | None:
        return self.client_id or self.id


class ObservationsIn(BaseModel):
    batch: list[ObservationIn] = Field(default_factory=list)
    device: str | None = None
    agent: str | None = None


class TileIn(BaseModel):
    """Cible d'une prediction : une tuile WMTS {z,x,y} OU un point {lon,lat,zoom}."""
    z: int | None = Field(default=None, ge=0, le=20)
    x: int | None = None
    y: int | None = None
    lon: float | None = Field(default=None, ge=-180, le=180)
    lat: float | None = Field(default=None, ge=-85, le=85)
    zoom: int | None = Field(default=None, ge=8, le=16,
                             description=f"defaut {predict.ZOOM} (~9,4 m/px au Benin)")


class DecisionIn(BaseModel):
    corridor_segment_id: str
    decision: Literal["maintien", "ajustement", "contournement"]
    committee: str
    note: str | None = None


# =========================================================================
# Endpoints : SPEC section 8
# =========================================================================
# ---------------------------------------------------------------- vue regionale
@app.get("/api/region")
def get_region():
    """Entete de la vue regionale : emprise, nombre de communes, km de couloirs."""
    return store.region_summary()


@app.get("/api/region/corridors")
def get_region_corridors():
    """Reseau de couloirs inter-communal, SIMPLIFIE (vue large).

    Trace precis d'une commune : GET /api/commune/{id}/corridor.
    """
    return store.region_corridors()


@app.get("/api/communes")
def get_communes(department: str | None = Query(default=None, description="filtre, ex. alibori")):
    """Les 33 communes et leurs agregats (frictions, gravite max, dernier passage).

    Agregats PRECALCULES par le seed ; seul le decompte par statut est reajuste
    avec les validations terrain, pour tenir la contrainte de temps de reponse.
    """
    rows = store.communes()
    if department:
        did = registry.resolve_department(department)
        if did is None:
            raise HTTPException(
                status_code=404,
                detail=f"departement inconnu : '{department}' ; voir GET /api/departments")
        rows = [r for r in rows if r.get("department_id") == did]
    return rows


@app.get("/api/departments")
def get_departments():
    return store.departments()


# ---------------------------------------------------------------- vue communale
@app.get("/api/commune/{cid}")
def get_commune_by_id(cid: str):
    return store.commune(cid)


@app.get("/api/commune/{cid}/corridor")
def get_commune_corridor(cid: str):
    return store.corridor(cid)


@app.get("/api/commune/{cid}/layers/{kind}")
def get_commune_layer(cid: str, kind: str = Path(
        ..., description="villages|water_points|pastures|parcels")):
    try:
        return store.layer(kind, cid)
    except KeyError:
        raise HTTPException(
            status_code=404,
            detail=f"couche inconnue '{kind}' ; valeurs admises : "
                   f"{'|'.join(store.LAYER_FILES)}")


# ------------------------------------------- alias de compatibilite (Banikoara)
@app.get("/api/commune")
def get_commune():
    """ALIAS historique : commune de reference (Banikoara)."""
    return store.commune()


@app.get("/api/corridor")
def get_corridor():
    """ALIAS historique : couloir de la commune de reference."""
    return store.corridor()


@app.get("/api/layers/{kind}")
def get_layer(kind: str = Path(..., description="villages|water_points|pastures|parcels")):
    """ALIAS historique : couche de la commune de reference."""
    try:
        return store.layer(kind)
    except KeyError:
        raise HTTPException(
            status_code=404,
            detail=f"couche inconnue '{kind}' ; valeurs admises : "
                   f"{'|'.join(store.LAYER_FILES)}")


# ---------------------------------------------------------------------- friction
@app.get("/api/friction")
def get_friction(
    season: int | None = Query(default=None, description="ex. 2026"),
    commune: str | None = Query(default=None,
                                description="id de commune ; absent = toutes les communes"),
    status: str | None = Query(default=None,
                               description="filtre : pending|confirmed|corrected|invalidated"),
):
    fc = store.friction(season, commune)
    if status:
        wanted = {s.strip().lower() for s in status.split(",") if s.strip()}
        bad = wanted - set(store.VALID_STATUS)
        if bad:
            raise HTTPException(
                status_code=400,
                detail=f"statut inconnu : {', '.join(sorted(bad))} ; admis : "
                       f"{'|'.join(store.VALID_STATUS)}")
        fc["features"] = [f for f in fc["features"]
                          if f["properties"]["status"] in wanted]
        fc["status_filter"] = sorted(wanted)
    return fc


@app.post("/api/friction/{fid}/validate")
def validate_friction(fid: str, body: ValidationIn):
    if store.friction_by_id(fid) is None:
        raise HTTPException(status_code=404, detail=f"zone de friction inconnue : {fid}")
    store.record_validation(fid, body.status, body.note, body.agent, channel="api")
    feat = store.friction_by_id(fid)
    feat["properties"]["validation_history"] = store.validation_log(fid, limit=20)
    return feat


@app.get("/api/routes")
def get_routes(
    frm: str = Query(..., alias="from", description="lon,lat"),
    to: str = Query(..., description="lon,lat"),
    alternatives: int = Query(default=3, ge=1, le=4),
    commune: str | None = Query(
        default=None,
        description="id de commune ; absent = deduit des coordonnees. Le calcul reste "
                    "intra-commune ou entre deux communes adjacentes (SPEC section 5)"),
):
    """Itineraires alternatifs. PERIMETRE BORNE : une commune, ou deux communes
    adjacentes. Toute autre demande est refusee (400) avec un message explicite
    plutot que calculee sur les 5 departements."""
    return routing.compute_routes(_lonlat(frm, "from"), _lonlat(to, "to"),
                                  alternatives, commune)


@app.post("/api/observations")
def post_observations(body: ObservationsIn):
    """Synchronisation d'un lot collecte hors reseau. Idempotent : rejouer le
    meme lot ne cree aucun doublon (deduplication par identifiant client)."""
    accepted, duplicates, rejected = [], [], []
    applied = 0
    seen: set[str] = set()
    for i, obs in enumerate(body.batch):
        key = obs.key()
        if not key:
            rejected.append({"index": i, "client_id": None,
                             "reason": "client_id manquant"})
            continue
        if key in seen:
            duplicates.append(key)
            continue
        seen.add(key)
        payload = obs.model_dump(exclude_none=False)
        payload.setdefault("device", body.device)
        if obs.status and obs.status not in store.VALID_STATUS:
            rejected.append({"index": i, "client_id": key,
                             "reason": f"statut invalide '{obs.status}' ; admis : "
                                       f"{'|'.join(store.VALID_STATUS)}"})
            continue
        if obs.friction_id and store.friction_by_id(obs.friction_id) is None:
            rejected.append({"index": i, "client_id": key,
                             "reason": f"zone de friction inconnue : {obs.friction_id}"})
            continue
        inserted = store.insert_observation(key, payload)
        if not inserted:
            duplicates.append(key)
            continue
        accepted.append(key)
        if obs.friction_id and obs.status:
            store.record_validation(
                obs.friction_id, obs.status, obs.note, obs.agent or body.agent,
                channel="offline-sync", client_id=key, observed_at=obs.observed_at)
            applied += 1
    return {
        # `accepted` inclut les doublons deja synchronises : rejouer un lot renvoie
        # le meme succes sans rien creer (idempotence).
        "accepted": len(accepted) + len(duplicates),
        "rejected": len(rejected),
        "synced_at": store.now_iso(),
        "new": len(accepted),
        "duplicates": len(duplicates),
        "accepted_ids": accepted,
        "duplicate_ids": duplicates,
        "rejected_details": rejected,
        "validations_applied": applied,
    }


@app.get("/api/decisions")
def get_decisions():
    return store.decisions()


@app.post("/api/decisions")
def post_decision(body: DecisionIn):
    if store.segment_commune(body.corridor_segment_id) is None:
        ref_segs = [s["id"] for s in store.corridor_segments()]
        raise HTTPException(
            status_code=404,
            detail=f"segment inconnu : {body.corridor_segment_id} ; "
                   f"{len(store.all_segment_ids())} segments existent sur les "
                   f"{len(registry.ids())} communes : ceux de la commune de reference "
                   f"sont {', '.join(ref_segs)} ; les autres suivent le motif "
                   f"SEG-<COMMUNE>-NN (voir GET /api/commune/{{id}}/corridor)")
    return store.add_decision(body.corridor_segment_id, body.decision,
                              body.committee, body.note)


# =========================================================================
# MODELE REEL : SPEC section 10
# =========================================================================
# Ces quatre routes remplacent les anciennes « valeurs de demonstration ».
# Elles ne servent QUE des chiffres mesures : si aucun entrainement n'a eu lieu,
# elles repondent 503 avec la marche a suivre, jamais un nombre invente.
def _stats_model_block() -> dict:
    """Metriques du modele pour /api/stats.

    Lues depuis la carte du modele REELLEMENT entraine (SPEC section 10).
    On n'invente jamais de chiffre : si aucun modele n'est entraine, on le dit.
    """
    try:
        card = predict.model_card()
    except Exception:
        return {
            "trained": False,
            "note": "aucun modele entraine : lancer ./.venv/bin/python train_model.py",
        }
    m = card.get("metrics", {}) or {}
    tr = card.get("trained_on", {}) or {}
    return {
        "trained": True,
        "real": True,
        "version": card.get("version"),
        "algorithm": card.get("algorithm"),
        "accuracy": m.get("accuracy"),
        "precision": m.get("precision"),
        "recall": m.get("recall"),
        "f1": m.get("f1"),
        "roc_auc": m.get("roc_auc"),
        "tested_on": (
            f"jeu de test tenu a l'ecart : {tr.get('dataset')} "
            f"(n={tr.get('n_test')}, imagerie {tr.get('geography')})"
        ),
        "trained_on": tr,
        "domain_gap": card.get("domain_gap"),
        "validation_status": card.get("validation_status"),
    }

@app.get("/api/model")
def get_model():
    """Carte du modele REELLEMENT entraine (train_model.py) et metriques mesurees
    sur le jeu de test EuroSAT tenu a l'ecart.

    ATTENTION (SPEC section 10) : ces metriques valent pour l'EUROPE. EuroSAT est
    un jeu europeen ; elles ne decrivent pas la performance au Benin. Le champ
    `domain_gap` porte cet avertissement et doit etre affiche a cote des chiffres.
    """
    card = dict(predict.model_card())
    card["endpoints"] = {
        "tile": "POST /api/predict/tile  body {z,x,y} ou {lon,lat,zoom}",
        "commune": "GET /api/commune/{id}/predictions",
        "recompute": "POST /api/commune/{id}/predict",
    }
    card["inference_cache"] = predict.cache_stats()
    card["tile_url_template"] = predict.TILE_URL
    card["max_cells_per_commune"] = predict.MAX_CELLS
    card["disclaimer"] = DISCLAIMER
    return card


@app.post("/api/predict/tile")
def post_predict_tile(body: TileIn):
    """Prediction sur une VRAIE tuile Sentinel-2 (EOX s2cloudless).

    Deux formes acceptees (SPEC section 10) :
      * {z, x, y}          -> la tuile 256x256 est decoupee en 4x4 cellules de
                              64x64, chacune classee, puis agregee ;
      * {lon, lat, zoom?}  -> une seule cellule 64x64 centree sur le point.
    La tuile est mise en cache disque : le second appel ne touche pas au reseau.
    """
    has_tile = body.z is not None and body.x is not None and body.y is not None
    has_pt = body.lon is not None and body.lat is not None
    if has_tile == has_pt:
        raise HTTPException(
            status_code=400,
            detail="fournir soit {z,x,y}, soit {lon,lat} (zoom optionnel, defaut "
                   f"{predict.ZOOM}) : pas les deux, pas aucun")
    if has_tile:
        n = 2 ** body.z
        if not (0 <= body.x < n and 0 <= body.y < n):
            raise HTTPException(status_code=400,
                                detail=f"tuile hors grille au zoom {body.z} : "
                                       f"x et y doivent etre dans [0, {n - 1}]")
        return predict.predict_tile(body.z, body.x, body.y)
    return predict.predict_lonlat(body.lon, body.lat, body.zoom or predict.ZOOM)


@app.get("/api/commune/{cid}/predictions")
def get_commune_predictions(
    cid: str,
    refresh: bool = Query(default=False, description="forcer le recalcul"),
    grid: int = Query(default=predict.GRID, ge=1, le=predict.GRID,
                      description=f"cote de la grille, au plus {predict.GRID} "
                                  f"({predict.MAX_CELLS} cellules)"),
):
    """Cellules predites sur l'emprise reelle de la commune (FeatureCollection).

    Servies depuis le disque si elles ont deja ete calculees. Chaque cellule
    porte `validated: false` et `source: "model"` : c'est une sortie de modele
    non validee localement, a verifier par l'agent communal (SPEC section 10).
    """
    cid = store.resolve(cid)
    return predict.commune_predictions(cid, refresh=refresh, grid=grid)


@app.post("/api/commune/{cid}/predict")
def post_commune_predict(
    cid: str,
    grid: int = Query(default=predict.GRID, ge=1, le=predict.GRID),
):
    """Relance l'inference sur la commune. Bornee a 64 cellules au plus (SPEC section 10) :
    on ne lance JAMAIS l'inference sur les 33 communes d'un coup.
    """
    cid = store.resolve(cid)
    return predict.commune_predictions(cid, refresh=True, grid=grid)


@app.get("/api/stats")
def get_stats(commune: str | None = Query(
        default=None, description="id de commune ; absent = toute la region")):
    """Chiffres calcules sur les donnees servies. Les metriques du modele sont
    des VALEURS DE DEMONSTRATION : aucun entrainement reel n'a eu lieu.

    Sans `commune`, les chiffres portent sur les 5 departements ; les volumes
    proviennent des agregats precalcules au seed, seules les zones de friction
    (statut a jour) sont parcourues.
    """
    rows = store.communes()
    if commune:
        cid = store.resolve(commune)
        rows = [r for r in rows if r["id"] == cid]

    fr = store.friction(cid=commune)["features"]
    props = [f["properties"] for f in fr]
    counts = {s: sum(1 for p in props if p["status"] == s) for s in store.VALID_STATUS}

    km = round(sum(r["corridor_km"] for r in rows), 1)
    dated = sorted(props, key=lambda p: p["detected_on"], reverse=True)
    last = dated[0] if dated else None
    # taux de nuages plausible, derive de facon deterministe de la date : la saison
    # de culture est la saison des pluies (SPEC section 6). Valeur de demonstration.
    cloud = 0
    if last:
        cloud = 8 + (sum(ord(c) for c in last["detected_on"]) % 47)

    validations = store.validation_log(limit=1000)
    obs = store.observations(limit=1000)

    return {
        "scope": {
            "commune": rows[0]["id"] if commune else None,
            "commune_name": rows[0]["name"] if commune else None,
            "communes": len(rows),
            "departments": len({r["department_id"] for r in rows}),
            "label": (rows[0]["name"] if commune
                      else f"{len(rows)} communes / {len({r['department_id'] for r in rows})} "
                           f"departements (nord & centre Benin)"),
        },
        "friction_total": len(fr),
        "confirmed": counts["confirmed"],
        "pending": counts["pending"],
        "invalidated": counts["invalidated"],
        "corrected": counts["corrected"],
        "km_corridor": km,
        "last_pass": {
            "date": last["detected_on"] if last else None,
            "sensor": last["source"] if last else None,
            "cloud_pct": cloud,
            "synthetic": True,
        },
        "model": _stats_model_block(),
        "coverage": {
            "parcels_total": sum(r["parcel_count"] for r in rows),
            "parcels_in_corridor": sum(r["parcels_in_corridor"] for r in rows),
            "parcels_area_ha": round(sum(r["parcel_area_ha"] for r in rows), 1),
            "villages": sum(r["village_count"] for r in rows),
            "water_points": sum(r["water_point_count"] for r in rows),
            "water_points_seasonal": sum(r["water_points_seasonal"] for r in rows),
            "pastures": sum(r["pasture_count"] for r in rows),
            "corridor_segments": sum(r["segment_count"] for r in rows),
            "communes": len(rows),
        },
        "friction_area_ha": round(sum(p["area_ha"] for p in props), 2),
        "mean_confidence": round(statistics.fmean([p["confidence"] for p in props]), 2)
        if props else None,
        "low_confidence": sum(1 for p in props
                              if p["confidence"] < routing.CONF_UNCERTAIN),
        "severity_histogram": {str(s): sum(1 for p in props if p["severity"] == s)
                               for s in range(1, 6)},
        "by_source": {s: sum(1 for p in props if p["source"] == s)
                      for s in ("sentinel-2", "sentinel-1", "terrain")},
        "by_department": [
            {"id": d["id"], "name": d["name"], "commune_count": d["commune_count"],
             "friction_count": d["friction_count"], "max_severity": d["max_severity"],
             "pending": d["pending"], "corridor_km": d["corridor_km"]}
            for d in store.departments()
        ] if not commune else None,
        "field_validations": len(validations),
        "observations_synced": len(obs),
        "decisions": len(store.decisions()),
        "synthetic": True,
        "official": False,
        "disclaimer": DISCLAIMER,
    }


# =========================================================================
# Complements hors contrat (utiles a la demo, ignorables par le frontend)
# =========================================================================
@app.get("/api/health")
def health():
    last = routing._grid_cache.get("last") or {}
    g = last.get("grid")
    return {
        "status": "ok",
        "communes": len(registry.ids()),
        "departments": len(registry.departments()),
        "reference_commune": store.reference(),
        "grid_ready": g is not None,
        "grid_scope": g.cids if g else None,
        "grid": f"{g.nrows}x{g.ncols} @ {g.res:.0f} m" if g else None,
        "grid_max_cells": routing.MAX_CELLS,
        "disclaimer": DISCLAIMER,
    }


@app.get("/api/validations")
def get_validations(friction_id: str | None = None, limit: int = 200):
    return store.validation_log(friction_id, limit)


@app.get("/api/observations")
def list_observations(limit: int = 200):
    return store.observations(limit)


@app.get("/")
def index():
    return {
        "name": "Terra Sentinelle API",
        "spec": "SPEC.md section 8",
        "base": "/api",
        "coverage": {
            "region": store.region_summary()["name"],
            "communes": len(registry.ids()),
            "departments": len(registry.departments()),
            "reference_commune": store.reference(),
        },
        "endpoints": [
            "GET  /api/region", "GET  /api/region/corridors",
            "GET  /api/communes?department=alibori", "GET  /api/departments",
            "GET  /api/commune/{id}", "GET  /api/commune/{id}/corridor",
            "GET  /api/commune/{id}/layers/{villages|water_points|pastures|parcels}",
            "GET  /api/friction?season=2026&commune={id}",
            "POST /api/friction/{id}/validate",
            "GET  /api/routes?commune={id}&from=lon,lat&to=lon,lat",
            "POST /api/observations", "GET  /api/decisions", "POST /api/decisions",
            "GET  /api/stats?commune={id}", "GET  /api/health",
        ],
        "aliases": {
            "note": "anciennes routes sans identifiant, servies pour la commune "
                    "de reference (compatibilite, SPEC section 8)",
            "routes": ["GET /api/commune", "GET /api/corridor", "GET /api/layers/{kind}"],
        },
        "disclaimer": DISCLAIMER,
    }


def _lonlat(raw: str, name: str):
    try:
        lon, lat = [float(v) for v in raw.replace(" ", "").split(",")]
    except Exception:
        raise HTTPException(
            status_code=400,
            detail=f"parametre '{name}' invalide : attendu 'lon,lat', recu '{raw}'")
    return (lon, lat)
