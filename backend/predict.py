#!/usr/bin/env python
"""
Terra Sentinelle : inference du modele sur de VRAIES tuiles Sentinel-2 du Benin.
SPEC section 10.

CE QUE FAIT CE MODULE
  * telecharge les tuiles Sentinel-2 publiques EOX s2cloudless (sans compte, sans
    cle d'API) sur l'emprise reelle d'une commune ;
  * les met EN CACHE SUR DISQUE (data/tiles/) : la demonstration ne doit pas
    dependre du reseau de la salle ; le cache de Banikoara est pre-telecharge ;
  * applique le modele entraine par `train_model.py` et renvoie une probabilite
    de mise en culture par cellule.

UNITE D'ANALYSE : la « cellule »
  Une cellule est une decoupe de 64x64 pixels au zoom 14. Sous la latitude du
  Benin, le zoom 14 vaut ~9,4 m/px : une cellule couvre donc ~600 m de cote, a
  la meme resolution et sur la meme emprise au sol qu'une vignette EuroSAT
  d'entrainement. C'est la condition pour que le vecteur de caracteristiques
  presente au modele ait le meme sens qu'a l'entrainement.

BORNE DE PERFORMANCE (contrainte dure, SPEC section 10)
  Au plus GRID x GRID = 64 cellules par commune, et JAMAIS les 33 communes d'un
  coup. Les cellules forment une grille d'ECHANTILLONNAGE de l'emprise communale :
  elles l'echantillonnent regulierement, elles ne la couvrent pas integralement.
  C'est dit tel quel dans la reponse de l'API (champ `sampling`).

HONNETETE (SPEC sections 9 et 10)
  Le modele est entraine sur EuroSAT, c'est-a-dire sur de l'imagerie EUROPEENNE,
  et applique ici au Benin. Chaque cellule sort donc avec `validated: false` et
  `source: "model"` : c'est une sortie de modele NON VALIDEE LOCALEMENT, que
  l'agent communal doit verifier sur le terrain (role de Moussa Gounou).
"""
from __future__ import annotations

import argparse
import io
import json
import math
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import numpy as np

import features
import registry

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
MODEL_DIR = os.path.join(DATA, "model")
MODEL_PATH = os.path.join(MODEL_DIR, "model.joblib")
CARD_PATH = os.path.join(MODEL_DIR, "model_card.json")
TILE_DIR = os.path.join(DATA, "tiles")
PRED_DIR = os.path.join(DATA, "predictions")

# Mosaique Sentinel-2 sans nuages, WMTS public EOX. La forme en parametres de
# requete est celle qui repond (la forme en chemin /wmts/1.0.0/... renvoie 404).
TILE_URL = ("https://tiles.maps.eox.at/wmts?layer=s2cloudless-2020_3857"
            "&style=default&tilematrixset=g&Service=WMTS&Request=GetTile"
            "&Version=1.0.0&Format=image%2Fjpeg"
            "&TileMatrix={z}&TileCol={x}&TileRow={y}")
TILE_LAYER = "s2cloudless-2020_3857"
TILE_SOURCE = ("EOX s2cloudless 2020 (mosaique Sentinel-2 sans nuages, "
               "EOX IT Services GmbH, CC BY 4.0) · https://s2maps.eu")
TILE_PX = 256
ZOOM = 14                 # ~9,4 m/px au Benin ≈ resolution native Sentinel-2
GRID = 8                  # 8x8 = 64 cellules maximum par commune
MAX_CELLS = GRID * GRID
FETCH_WORKERS = 8
HTTP_TIMEOUT = 20
USER_AGENT = "TerraSentinelle/0.4 (hackathon IndabaX Benin 2026)"

_model_lock = threading.Lock()
_model: dict | None = None
_card: dict | None = None
_pred_lock = threading.Lock()


class ModelUnavailable(RuntimeError):
    """Modele absent ou incompatible : il faut (re)lancer train_model.py."""


class TileUnavailable(RuntimeError):
    """Tuile ni en cache, ni telechargeable."""


# ============================================================ modele
def load_model() -> dict:
    global _model
    with _model_lock:
        if _model is not None:
            return _model
        if not os.path.exists(MODEL_PATH):
            raise ModelUnavailable(
                f"aucun modele entraine dans {MODEL_DIR} ; lancer "
                f"`./.venv/bin/python train_model.py` (entrainement reel sur EuroSAT)")
        import joblib
        bundle = joblib.load(MODEL_PATH)
        if bundle.get("feature_version") != features.FEATURE_VERSION:
            raise ModelUnavailable(
                f"modele entraine avec {bundle.get('feature_version')} mais "
                f"features.py est en {features.FEATURE_VERSION} : reentrainer "
                f"plutot que servir des predictions incoherentes")
        _model = bundle
        return _model


def model_card() -> dict:
    """Carte de modele ecrite par l'entrainement. Jamais de chiffre invente :
    si la carte manque, on le dit."""
    global _card
    if _card is None:
        if not os.path.exists(CARD_PATH):
            raise ModelUnavailable(
                f"carte de modele absente ({CARD_PATH}) ; aucun entrainement reel "
                f"n'a ete effectue. Lancer `./.venv/bin/python train_model.py`.")
        with open(CARD_PATH, encoding="utf-8") as fh:
            _card = json.load(fh)
    return _card


def model_ready() -> bool:
    return os.path.exists(MODEL_PATH) and os.path.exists(CARD_PATH)


# ============================================================ geometrie WMTS
def lonlat_to_pixel(lon: float, lat: float, z: int) -> tuple[float, float]:
    """Coordonnees pixel globales Web Mercator (EPSG:3857, grille WMTS 'g')."""
    lat = max(min(lat, 85.05112878), -85.05112878)
    n = 2 ** z * TILE_PX
    px = (lon + 180.0) / 360.0 * n
    s = math.sin(math.radians(lat))
    py = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n
    return px, py


def pixel_to_lonlat(px: float, py: float, z: int) -> tuple[float, float]:
    n = 2 ** z * TILE_PX
    lon = px / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * py / n))))
    return lon, lat


def tile_of(lon: float, lat: float, z: int) -> tuple[int, int]:
    px, py = lonlat_to_pixel(lon, lat, z)
    return int(px // TILE_PX), int(py // TILE_PX)


def ground_res_m(lat: float, z: int) -> float:
    return 40075016.686 * math.cos(math.radians(lat)) / (2 ** z * TILE_PX)


def tile_url(z: int, x: int, y: int) -> str:
    return TILE_URL.format(z=z, x=x, y=y)


# ============================================================ cache de tuiles
def tile_path(z: int, x: int, y: int) -> str:
    return os.path.join(TILE_DIR, str(z), str(x), f"{y}.jpg")


def tile_cached(z: int, x: int, y: int) -> bool:
    p = tile_path(z, x, y)
    return os.path.exists(p) and os.path.getsize(p) > 0


def fetch_tile(z: int, x: int, y: int, allow_network: bool = True) -> tuple[bytes, bool]:
    """Octets JPEG de la tuile. Retourne (donnees, depuis_le_cache).

    Le cache disque est la regle, le reseau l'exception : une fois le cache
    chaud, la demonstration tourne hors ligne.
    """
    p = tile_path(z, x, y)
    if tile_cached(z, x, y):
        with open(p, "rb") as fh:
            return fh.read(), True
    if not allow_network:
        raise TileUnavailable(f"tuile {z}/{x}/{y} absente du cache et reseau desactive")
    req = urllib.request.Request(tile_url(z, x, y), headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
            blob = r.read()
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise TileUnavailable(f"tuile {z}/{x}/{y} indisponible : {exc}") from exc
    if not blob:
        raise TileUnavailable(f"tuile {z}/{x}/{y} vide")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + ".part"
    with open(tmp, "wb") as fh:
        fh.write(blob)
    os.replace(tmp, p)
    return blob, False


def tile_array(z: int, x: int, y: int, allow_network: bool = True):
    from PIL import Image
    blob, cached = fetch_tile(z, x, y, allow_network)
    with Image.open(io.BytesIO(blob)) as im:
        arr = np.asarray(im.convert("RGB"), dtype=np.uint8)
    return arr, cached


# ============================================================ inference
def _crop(arr: np.ndarray, x0: int, y0: int) -> np.ndarray:
    c = features.TILE_PX
    x0 = max(0, min(x0, arr.shape[1] - c))
    y0 = max(0, min(y0, arr.shape[0] - c))
    return arr[y0:y0 + c, x0:x0 + c, :3]


def predict_cells(crops: list[np.ndarray]) -> list[dict]:
    """Applique le modele a une liste de decoupes 64x64. Un seul appel vectorise."""
    m = load_model()
    X = np.vstack([features.features(c) for c in crops])
    p_cult = m["binary"].predict_proba(X)[:, 1]
    proba_c = m["multiclass"].predict_proba(X)
    classes = m["multiclass"].classes_
    names = m["class_names"]
    out = []
    for i in range(X.shape[0]):
        k = int(np.argmax(proba_c[i]))
        cname = names[int(classes[k])]
        out.append({
            "p_cultivated": round(float(p_cult[i]), 4),
            "predicted_class": cname,
            # confiance = probabilite de la classe multi-classes retenue
            "confidence": round(float(proba_c[i][k]), 4),
            "class_is_cultivated": cname in m["cultivated_classes"],
        })
    return out


def predict_tile(z: int, x: int, y: int, allow_network: bool = True) -> dict:
    """Prediction sur une tuile entiere : la tuile 256x256 est decoupee en 4x4
    cellules de 64x64, chacune classee, puis agregee (moyenne de la probabilite
    de mise en culture, classe majoritaire)."""
    arr, cached = tile_array(z, x, y, allow_network)
    step = features.TILE_PX
    crops, offsets = [], []
    for oy in range(0, TILE_PX, step):
        for ox in range(0, TILE_PX, step):
            crops.append(_crop(arr, ox, oy))
            offsets.append((ox, oy))
    cells = predict_cells(crops)
    ps = [c["p_cultivated"] for c in cells]
    votes: dict[str, int] = {}
    for c in cells:
        votes[c["predicted_class"]] = votes.get(c["predicted_class"], 0) + 1
    top = max(votes.items(), key=lambda kv: kv[1])[0]
    conf = float(np.mean([c["confidence"] for c in cells if c["predicted_class"] == top]))
    px0, py0 = x * TILE_PX, y * TILE_PX
    w, n = pixel_to_lonlat(px0, py0, z)
    e, s = pixel_to_lonlat(px0 + TILE_PX, py0 + TILE_PX, z)
    return {
        "tile": {"z": z, "x": x, "y": y},
        "tile_url": tile_url(z, x, y),
        "cached": cached,
        "p_cultivated": round(float(np.mean(ps)), 4),
        "p_cultivated_max": round(float(np.max(ps)), 4),
        "predicted_class": top,
        "confidence": round(conf, 4),
        "cells": len(cells),
        "cell_size_m": round(features.TILE_PX * ground_res_m((n + s) / 2, z)),
        "bbox": [round(w, 6), round(s, 6), round(e, 6), round(n, 6)],
        "validated": False,
        "source": "model",
        "imagery": TILE_SOURCE,
        "model_version": load_model()["version"],
        "domain_gap": DOMAIN_GAP_SHORT,
    }


def predict_lonlat(lon: float, lat: float, zoom: int = ZOOM,
                   allow_network: bool = True) -> dict:
    """Prediction sur la cellule 64x64 CENTREE sur le point demande."""
    px, py = lonlat_to_pixel(lon, lat, zoom)
    tx, ty = int(px // TILE_PX), int(py // TILE_PX)
    arr, cached = tile_array(zoom, tx, ty, allow_network)
    c = features.TILE_PX
    ox = max(0, min(int(px % TILE_PX) - c // 2, TILE_PX - c))
    oy = max(0, min(int(py % TILE_PX) - c // 2, TILE_PX - c))
    cell = predict_cells([_crop(arr, ox, oy)])[0]
    gx0, gy0 = tx * TILE_PX + ox, ty * TILE_PX + oy
    w, n = pixel_to_lonlat(gx0, gy0, zoom)
    e, s = pixel_to_lonlat(gx0 + c, gy0 + c, zoom)
    return {
        **cell,
        "point": [round(lon, 6), round(lat, 6)],
        "tile": {"z": zoom, "x": tx, "y": ty},
        "crop": {"x": ox, "y": oy, "size": c},
        "tile_url": tile_url(zoom, tx, ty),
        "cached": cached,
        "bbox": [round(w, 6), round(s, 6), round(e, 6), round(n, 6)],
        "cell_size_m": round(c * ground_res_m(lat, zoom)),
        "validated": False,
        "source": "model",
        "imagery": TILE_SOURCE,
        "model_version": load_model()["version"],
        "domain_gap": DOMAIN_GAP_SHORT,
    }


DOMAIN_GAP_SHORT = (
    "Sortie de modele NON VALIDEE LOCALEMENT : le modele est entraine sur EuroSAT "
    "(imagerie europeenne) et applique ici au Benin. A verifier sur le terrain par "
    "l'agent communal avant tout usage.")


# ============================================================ commune
def _grid_points(bbox: list[float], grid: int = GRID):
    """Centres d'une grille grid x grid inscrite dans l'emprise de la commune."""
    w, s, e, n = bbox
    pts = []
    for j in range(grid):                       # du nord vers le sud
        lat = n - (j + 0.5) * (n - s) / grid
        for i in range(grid):
            lon = w + (i + 0.5) * (e - w) / grid
            pts.append((i, j, lon, lat))
    return pts


def pred_path(cid: str) -> str:
    return os.path.join(PRED_DIR, f"{cid}.json")


def cached_predictions(cid: str) -> dict | None:
    p = pred_path(cid)
    if not os.path.exists(p):
        return None
    try:
        with open(p, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def predict_commune(cid: str, grid: int = GRID, allow_network: bool = True,
                    zoom: int = ZOOM) -> dict:
    """Inference bornee sur une commune -> FeatureCollection de cellules.

    Bornee a grid x grid <= MAX_CELLS cellules (contrainte dure de la SPEC).
    Les tuiles sont recuperees en parallele puis mises en cache : le second
    appel ne touche plus au reseau.
    """
    com = registry.get(cid)                     # leve UnknownCommune si inconnu
    grid = max(1, min(int(grid), GRID))
    if grid * grid > MAX_CELLS:
        raise ValueError(f"grille {grid}x{grid} > {MAX_CELLS} cellules")

    t0 = time.time()
    pts = _grid_points(com["bbox"], grid)
    jobs = []
    for i, j, lon, lat in pts:
        px, py = lonlat_to_pixel(lon, lat, zoom)
        tx, ty = int(px // TILE_PX), int(py // TILE_PX)
        c = features.TILE_PX
        ox = max(0, min(int(px % TILE_PX) - c // 2, TILE_PX - c))
        oy = max(0, min(int(py % TILE_PX) - c // 2, TILE_PX - c))
        jobs.append({"i": i, "j": j, "lon": lon, "lat": lat,
                     "z": zoom, "x": tx, "y": ty, "ox": ox, "oy": oy})

    uniq = sorted({(j["z"], j["x"], j["y"]) for j in jobs})
    tiles: dict[tuple, tuple] = {}
    errors: list[str] = []

    def grab(key):
        z, x, y = key
        try:
            return key, tile_array(z, x, y, allow_network)
        except Exception as exc:                # tuile manquante : cellule ignoree
            return key, exc

    with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as pool:
        for key, res in pool.map(grab, uniq):
            if isinstance(res, Exception):
                errors.append(f"{key[0]}/{key[1]}/{key[2]} : {res}")
            else:
                tiles[key] = res
    t_tiles = time.time() - t0

    crops, metas = [], []
    for j in jobs:
        key = (j["z"], j["x"], j["y"])
        if key not in tiles:
            continue
        arr, cached = tiles[key]
        crops.append(_crop(arr, j["ox"], j["oy"]))
        metas.append((j, cached))

    if not crops:
        raise TileUnavailable(
            f"aucune tuile disponible pour {cid} (cache vide et reseau indisponible) ; "
            f"pre-charger le cache avec `python predict.py --warm {cid}`")

    t1 = time.time()
    cells = predict_cells(crops)
    t_infer = time.time() - t1

    feats = []
    c = features.TILE_PX
    for (j, cached), cell in zip(metas, cells):
        gx0, gy0 = j["x"] * TILE_PX + j["ox"], j["y"] * TILE_PX + j["oy"]
        w_, n_ = pixel_to_lonlat(gx0, gy0, j["z"])
        e_, s_ = pixel_to_lonlat(gx0 + c, gy0 + c, j["z"])
        feats.append({
            "type": "Feature",
            "id": f"PRED-{cid.upper()}-{j['j']:02d}{j['i']:02d}",
            "geometry": {"type": "Polygon", "coordinates": [[
                [round(w_, 6), round(s_, 6)], [round(e_, 6), round(s_, 6)],
                [round(e_, 6), round(n_, 6)], [round(w_, 6), round(n_, 6)],
                [round(w_, 6), round(s_, 6)]]]},
            "properties": {
                "id": f"PRED-{cid.upper()}-{j['j']:02d}{j['i']:02d}",
                "commune": cid,
                "row": j["j"], "col": j["i"],
                "p_cultivated": cell["p_cultivated"],
                "predicted_class": cell["predicted_class"],
                "class_is_cultivated": cell["class_is_cultivated"],
                "confidence": cell["confidence"],
                "tile": {"z": j["z"], "x": j["x"], "y": j["y"]},
                "tile_url": tile_url(j["z"], j["x"], j["y"]),
                "crop": {"x": j["ox"], "y": j["oy"], "size": c},
                "cached": cached,
                "center": [round(j["lon"], 6), round(j["lat"], 6)],
                "cell_size_m": round(c * ground_res_m(j["lat"], j["z"])),
                # SPEC section 10 : jamais validee par defaut.
                "validated": False,
                "validation_status": "non verifie sur le terrain",
                "source": "model",
                "model_version": load_model()["version"],
                "imagery_date": "2020 (mosaique annuelle EOX s2cloudless)",
            },
        })

    ps = [f["properties"]["p_cultivated"] for f in feats]
    card = model_card()
    total = time.time() - t0
    doc = {
        "type": "FeatureCollection",
        "features": feats,
        "properties": {
            "commune": cid,
            "commune_name": com["name"],
            "department": com.get("department"),
            "bbox": com["bbox"],
            "grid": f"{grid}x{grid}",
            "cells": len(feats),
            "cells_requested": len(jobs),
            "cells_max": MAX_CELLS,
            "tiles_unique": len(uniq),
            "tiles_from_cache": sum(1 for _, cached in metas if cached),
            "tiles_failed": len(errors),
            "tile_errors": errors[:5] or None,
            "zoom": zoom,
            "cell_size_m": round(c * ground_res_m(com["center"][1], zoom)),
            "sampling": (f"grille d'ECHANTILLONNAGE {grid}x{grid} inscrite dans "
                         f"l'emprise de travail de la commune : chaque cellule couvre "
                         f"~600 m de cote au zoom {zoom} (~9,4 m/px, resolution "
                         f"Sentinel-2). La grille echantillonne l'emprise, elle ne la "
                         f"couvre pas integralement : borne de performance imposee "
                         f"(SPEC section 10, {MAX_CELLS} cellules au maximum)."),
            "imagery": TILE_SOURCE,
            "imagery_layer": TILE_LAYER,
            "model": {"version": card.get("version"),
                      "trained_on": card.get("trained_on", {}).get("dataset"),
                      "task": card.get("task")},
            "p_cultivated_mean": round(float(np.mean(ps)), 4) if ps else None,
            "p_cultivated_max": round(float(np.max(ps)), 4) if ps else None,
            "cells_cultivated_gt50": sum(1 for p in ps if p >= 0.5),
            "validated": False,
            "domain_gap": card.get("domain_gap", DOMAIN_GAP_SHORT),
            "timing_s": {"tiles": round(t_tiles, 2), "inference": round(t_infer, 2),
                         "total": round(total, 2)},
            "computed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        },
    }
    os.makedirs(PRED_DIR, exist_ok=True)
    with _pred_lock:
        tmp = pred_path(cid) + ".part"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, ensure_ascii=False)
        os.replace(tmp, pred_path(cid))
    return doc


def commune_predictions(cid: str, refresh: bool = False, grid: int = GRID,
                        allow_network: bool = True) -> dict:
    """Predictions d'une commune : servies depuis le disque si elles existent."""
    if not refresh:
        doc = cached_predictions(cid)
        if doc:
            doc["properties"]["served_from_cache"] = True
            return doc
    doc = predict_commune(cid, grid=grid, allow_network=allow_network)
    doc["properties"]["served_from_cache"] = False
    return doc


# ============================================================ CLI
def cache_stats() -> dict:
    n = size = 0
    for root, _dirs, files in os.walk(TILE_DIR):
        for f in files:
            if f.endswith(".jpg"):
                n += 1
                size += os.path.getsize(os.path.join(root, f))
    return {"tiles": n, "bytes": size, "dir": "data/tiles"}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--warm", nargs="*", metavar="COMMUNE",
                    help="pre-telecharge le cache de tuiles et calcule les "
                         "predictions (defaut : commune de reference)")
    ap.add_argument("--tile", nargs=3, type=int, metavar=("Z", "X", "Y"))
    ap.add_argument("--point", nargs=2, type=float, metavar=("LON", "LAT"))
    ap.add_argument("--offline", action="store_true",
                    help="interdit le reseau : verifie que le cache suffit")
    args = ap.parse_args()
    allow_net = not args.offline

    if args.tile:
        print(json.dumps(predict_tile(*args.tile, allow_network=allow_net),
                         ensure_ascii=False, indent=1))
        return 0
    if args.point:
        print(json.dumps(predict_lonlat(args.point[0], args.point[1],
                                        allow_network=allow_net),
                         ensure_ascii=False, indent=1))
        return 0

    targets = args.warm if args.warm else [registry.reference_id()]
    for cid in targets:
        t0 = time.time()
        doc = predict_commune(cid, allow_network=allow_net)
        p = doc["properties"]
        print(f"[predict] {p['commune_name']:14s} {p['cells']} cellules, "
              f"{p['tiles_unique']} tuiles ({p['tiles_from_cache']} en cache, "
              f"{p['tiles_failed']} en echec), "
              f"p_cultive moyen {p['p_cultivated_mean']}, "
              f"max {p['p_cultivated_max']}, "
              f"{p['cells_cultivated_gt50']} cellules >= 0.5 : {time.time() - t0:.2f} s")
    print(f"[predict] cache : {cache_stats()}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"[predict] ECHEC : {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(1)
