#!/usr/bin/env python3
"""
Terra Sentinelle : generateur de donnees de demonstration.

    python seed.py

Couverture : 5 departements / 33 communes du nord et du centre du Benin
(SPEC section 5). La liste vit dans `data/communes.json` : SEULE source de verite,
aucune commune n'est codee en dur ici.

Produit dans ./data/ :
    communes.json                       (entree, non regeneree : editable a la main)
    region.json                         agregats precalcules (vue regionale, rapide)
    region_corridors.geojson            reseau inter-communal SIMPLIFIE (vue large)
    communes/<id>/commune.json
    communes/<id>/corridor.geojson
    communes/<id>/villages.geojson  water_points.geojson  pastures.geojson
    communes/<id>/parcels.geojson   friction.geojson
et (re)initialise ./data/terra.sqlite (validations, observations, decisions).

Densites (SPEC section 5) :
  * Banikoara = commune de reference : jeu DETAILLE, inchange depuis la version
    mono-commune (57,1 km de couloir, 17 villages, 32 parcelles, 10 frictions).
    Son tirage aleatoire est consomme EN PREMIER et dans le meme ordre qu'avant,
    ce qui garantit un jeu identique au bit pres.
  * les 32 autres = jeu plus leger mais coherent, tire d'un generateur aleatoire
    PROPRE a chaque commune (l'ajout d'une commune ne change pas les autres).

Reseau : chaque commune se raccorde a sa voisine du nord au MEME point de jonction
(`registry.network()`), donc les troncons se touchent reellement et le reseau
descend du Sahel vers le sud.

=====================  AVERTISSEMENT  =====================
TOUTES ces donnees sont SYNTHETIQUES. Elles sont plausibles et coherentes entre
elles (les zones de friction derivent reellement des recouvrements calcules entre
les parcelles generees et l'emprise du couloir), mais elles ne decrivent pas la
realite du terrain.
  * L'emprise du couloir est RECONSTITUEE par l'equipe : aucun jeu ouvert de
    polygones de couloirs de transhumance du Benin n'existe (SPEC section 6).
  * Chaque objet porte `synthetic: true`.
  * Chaque objet qui pourrait etre confondu avec une donnee administrative porte
    `official: false`.
  * Les noms de villages sont des toponymes plausibles de la commune, mais leurs
    positions sont tirees au sort et ne doivent pas etre utilisees pour naviguer.
===========================================================
"""
from __future__ import annotations

import json
import math
import os
import random
import shutil
import sqlite3
from datetime import date, datetime, timedelta, timezone

from shapely.geometry import LineString, Point, Polygon, box

import geo
import registry

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
COMMUNES_DIR = os.path.join(DATA, "communes")
DB = os.path.join(DATA, "terra.sqlite")

SEED = 20260911
MODEL_VERSION = "ts-demo-0.3.0"
CORRIDOR_WIDTH_M = 100          # largeur totale de l'emprise reconstituee
N_SEGMENTS = 8                  # commune de reference
N_SEGMENTS_LIGHT = 4            # autres communes

# Generateur de la commune de reference : consomme en premier, dans l'ordre
# historique, pour que Banikoara ne bouge pas d'un metre.
rnd = random.Random(SEED)

# Toponymes plausibles de la commune de Banikoara (positions tirees au sort).
VILLAGE_NAMES = [
    "Banikoara-Centre", "Founougo", "Gomparou", "Goumori", "Kokey", "Ounet",
    "Somperekou", "Toura", "Igrigou", "Sominkerou", "Kokiborou", "Simperou",
    "Tokey-Bante", "Gbassa", "Kandereou", "Arbonga", "Pouya", "Sonsoro",
]
CROPS = ["coton", "mais", "sorgho", "igname", "arachide", "niebe", "riz pluvial"]
WATER_NAMES = [
    "Mare de Koutakroukou", "Retenue de Sampeto", "Forage Gomparou 2",
    "Mare de Tintinmou", "Bras du Mekrou", "Forage Ounet 1", "Mare de Banigourou",
    "Puits pastoral Toura", "Retenue de Kokey", "Mare de Sonsoro",
]
PASTURE_NAMES = [
    "Paturage de Kpako", "Aire de repos de Gountoko", "Paturage de Sampeto",
    "Zone de paturage de Tintinmou", "Aire de paturage de Bouanri",
    "Paturage de Wonkoro",
]

# Pour les 32 autres communes on ne s'autorise AUCUN toponyme invente : les noms
# sont derives du nom de la commune (donc visiblement synthetiques), conformement
# a l'exigence d'honnetete de la SPEC section 9.
DIRECTIONS = ["Centre", "Nord", "Sud", "Est", "Ouest",
              "Nord-Est", "Nord-Ouest", "Sud-Est", "Sud-Ouest"]


# ==========================================================================
# Contexte de generation d'une commune
# ==========================================================================
class Ctx:
    """Tout ce qui distingue une commune d'une autre pendant la generation."""

    def __init__(self, commune: dict, detailed: bool):
        self.c = commune
        self.id = commune["id"]
        self.name = commune["name"]
        self.department = commune["department"]
        self.detailed = detailed
        self.center = commune["center"]
        self.bbox = tuple(commune["bbox"])
        self.proj = geo.proj_for(self.center)
        # reference : le generateur historique ; autres : un generateur dedie,
        # stable et independant de l'ordre des communes dans le fichier.
        seed_id = SEED ^ (int.from_bytes(self.id.encode(), "little") % 2_147_483_647)
        self.rnd = rnd if detailed else random.Random(seed_id)
        # Generateur SEPARE pour le trace du couloir : le tirage des couches de la
        # commune de reference doit rester exactement celui de la version
        # mono-commune, donc la geometrie du reseau ne doit jamais y puiser.
        self.grnd = random.Random(seed_id ^ 0x5EED)
        # identifiants : la reference garde ses identifiants courts historiques
        self.suffix = "" if detailed else "-" + self.id.upper()

    def oid(self, prefix: str, i: int, width: int = 2) -> str:
        return f"{prefix}{self.suffix}-{i:0{width}d}"

    def tag(self) -> dict:
        """Proprietes communes a TOUT objet servi par l'API."""
        return {"commune": self.id, "commune_name": self.name,
                "department": self.department, "synthetic": True, "official": False}

    def bbox_poly_m(self):
        w, s, e, n = self.bbox
        return box(*self.proj.to_m(w, s), *self.proj.to_m(e, n))

    def names(self, n: int) -> list[str]:
        """Noms derives du nom de la commune : `Kandi-Centre`, `Kandi Nord`, ..."""
        out = [f"{self.name}-Centre"]
        for d in DIRECTIONS[1:]:
            out.append(f"{self.name} {d}")
        while len(out) < n:
            out.append(f"{self.name} {len(out) + 1}")
        return out[:n]


# --------------------------------------------------------------------------
# 1. Couloir : axe nord-sud + emprise
# --------------------------------------------------------------------------
def build_corridor_axis() -> LineString:
    """Axe ~57 km oriente nord-sud, sinueux (commune de REFERENCE, fige).

    Ne surtout pas toucher : c'est le jeu de demonstration detaille et les
    extremites servent de points de raccordement aux communes voisines.
    """
    lat_start, lat_end = 11.088, 11.524
    n = 26
    pts = []
    for k in range(n):
        t = k / (n - 1)
        lat = lat_start + t * (lat_end - lat_start)
        # meandre principal + micro-bruit : le couloir contourne les zones habitees
        lon = (
            2.446
            + 0.052 * math.sin(t * math.pi * 1.6 + 0.4)
            - 0.030 * math.sin(t * math.pi * 3.1)
            + rnd.uniform(-0.004, 0.004)
        )
        pts.append((round(lon, 6), round(lat, 6)))
    return LineString(pts)


def build_light_axis(ctx: Ctx, entry_ll, exit_ll) -> LineString:
    """Troncon d'une commune ordinaire : jonction nord -> centre -> jonction sud.

    Les extremites sont IMPOSEES (ce sont les points de raccordement partages avec
    les communes voisines) : le troncon des voisines part exactement du meme point,
    le reseau est donc continu. Entre les deux, l'axe meandre autour de la droite.
    """
    P = ctx.proj
    a = P.to_m(*entry_ll)
    b = P.to_m(*ctx.center)
    c = P.to_m(*exit_ll)
    guide = LineString([a, b, c])
    total = guide.length
    n = max(12, min(30, int(total / 2500)))
    amp = min(2600.0, max(600.0, total * 0.045))
    phase = ctx.grnd.uniform(0.6, 2.6)
    pts = []
    for k in range(n + 1):
        t = k / n
        p = guide.interpolate(t * total)
        q = guide.interpolate(min(total, t * total + 50))
        ang = math.atan2(q.y - p.y, q.x - p.x) + math.pi / 2
        # enveloppe sin(pi t) : deviation nulle aux deux jonctions
        off = (amp * math.sin(t * math.pi * phase) * math.sin(t * math.pi)
               + ctx.grnd.uniform(-140, 140) * math.sin(t * math.pi))
        pts.append((p.x + off * math.cos(ang), p.y + off * math.sin(ang)))
    pts[0], pts[-1] = a, c
    return geo.round_geom(P.geom_to_ll(LineString(pts)), 6)


def nearest_on(axis_ll: LineString, proj, target_ll) -> list[float]:
    """Point de l'axe le plus proche d'une cible : jonction en T.

    Une commune qui n'est pas la continuation principale de sa voisine du nord
    ne demarre pas dans le vide : son troncon part d'un point situe SUR l'axe de
    la voisine. Le reseau reste continu sans ajouter la moindre geometrie a la
    commune amont : ce qui protege le jeu fige de la commune de reference.
    """
    axis_m = proj.geom_to_m(axis_ll)
    t = Point(proj.to_m(*target_ll))
    p = axis_m.interpolate(axis_m.project(t))
    lon, lat = proj.to_ll(p.x, p.y)
    return [round(lon, 6), round(lat, 6)]


def corridor_segments(ctx: Ctx, axis: LineString):
    """Decoupe l'axe en N segments nommes SEG-01..SEG-NN (SEG-<COMMUNE>-NN)."""
    axis_m = ctx.proj.geom_to_m(axis)
    total = axis_m.length
    n_seg = N_SEGMENTS if ctx.detailed else N_SEGMENTS_LIGHT
    step = total / n_seg
    segs = []
    for i in range(n_seg):
        a, b = i * step, (i + 1) * step
        sub = _substring(axis_m, a, b)
        segs.append(
            {
                "id": ctx.oid("SEG", i + 1),
                "from_km": round(a / 1000, 2),
                "to_km": round(b / 1000, 2),
                "geom_m": sub,
                "geom_ll": ctx.proj.geom_to_ll(sub),
            }
        )
    return segs


def _substring(line: LineString, a: float, b: float) -> LineString:
    coords = [line.interpolate(a).coords[0]]
    acc = 0.0
    pts = list(line.coords)
    for p, q in zip(pts, pts[1:]):
        seg_len = math.dist(p, q)
        if acc + seg_len > a and acc < b:
            if a < acc < b:
                coords.append(q if False else p)
        acc += seg_len
    coords.append(line.interpolate(b).coords[0])
    # densifie proprement : on echantillonne tous les 250 m
    n = max(2, int((b - a) / 250))
    return LineString([line.interpolate(a + (b - a) * i / n).coords[0] for i in range(n + 1)])


# --------------------------------------------------------------------------
# 2. Couches thematiques
# --------------------------------------------------------------------------
def build_villages(ctx: Ctx, axis_m):
    rnd = ctx.rnd
    BBOX = ctx.bbox
    feats = []
    names = (VILLAGE_NAMES[:] if ctx.detailed else ctx.names(9))
    rnd.shuffle(names)
    n = rnd.randint(14, 17) if ctx.detailed else rnd.randint(4, 7)
    min_gap = 3500 if ctx.detailed else 4500
    placed = []
    for i in range(n):
        for _ in range(400):
            lon = rnd.uniform(BBOX[0] + 0.03, BBOX[2] - 0.03)
            lat = rnd.uniform(BBOX[1] + 0.03, BBOX[3] - 0.03)
            p_m = Point(ctx.proj.to_m(lon, lat))
            d_axis = p_m.distance(axis_m)
            if d_axis < 900:            # le couloir contourne les villages
                continue
            if placed and min(p_m.distance(q) for q in placed) < min_gap:
                continue
            placed.append(p_m)
            break
        else:
            continue
        pop = rnd.choice([420, 760, 1100, 1850, 2400, 3200, 5400])
        if names[i % len(names)] == "Banikoara-Centre":
            pop = 28000
        elif not ctx.detailed and names[i % len(names)].endswith("-Centre"):
            pop = rnd.choice([9000, 14000, 21000, 32000])
        props = {
            "id": ctx.oid("VIL", i + 1),
            "name": names[i % len(names)],
            "kind": "village",
            "population": pop,
            "has_market": rnd.random() < 0.35,
            "distance_corridor_m": int(d_axis),
            "source": "OpenStreetMap (positions synthetiques)",
            "confidence": round(rnd.uniform(0.55, 0.95), 2),
            "synthetic": True,
            "official": False,
        }
        props.update(ctx.tag())
        feats.append(geo.feature(Point(round(lon, 6), round(lat, 6)), props))
    return feats


def build_water_points(ctx: Ctx, axis_m):
    rnd = ctx.rnd
    BBOX = ctx.bbox
    feats = []
    n = rnd.randint(7, 10) if ctx.detailed else rnd.randint(2, 4)
    names = (WATER_NAMES[:] if ctx.detailed
             else [f"Point d'eau {ctx.name} {k + 1}" for k in range(6)])
    rnd.shuffle(names)
    for i in range(n):
        # la moitie des points d'eau sont a portee du couloir
        if i % 2 == 0:
            d = rnd.uniform(0.05, 0.92) * axis_m.length
            base = axis_m.interpolate(d)
            ang = rnd.uniform(0, 2 * math.pi)
            off = rnd.uniform(300, 2600)
            x, y = base.x + off * math.cos(ang), base.y + off * math.sin(ang)
            lon, lat = ctx.proj.to_ll(x, y)
        else:
            lon = rnd.uniform(BBOX[0] + 0.04, BBOX[2] - 0.04)
            lat = rnd.uniform(BBOX[1] + 0.04, BBOX[3] - 0.04)
            x, y = ctx.proj.to_m(lon, lat)
        kind = rnd.choice(["mare", "mare", "forage", "retenue", "acces_riviere"])
        seasonal = kind in ("mare", "acces_riviere") and rnd.random() < 0.8
        accessible = rnd.random() < 0.75
        props = {
            "id": ctx.oid("EAU", i + 1),
            "name": names[i % len(names)],
            "kind": kind,
            "seasonal": bool(seasonal),
            "accessible": bool(accessible),
            "capacity_m3": rnd.choice([None, 800, 1500, 4200, 9000]),
            "distance_corridor_m": int(Point(x, y).distance(axis_m)),
            "source": "OpenStreetMap + enquete terrain (synthetique)",
            "confidence": round(rnd.uniform(0.45, 0.95), 2),
            "last_checked": _iso(rnd.randint(30, 400)),
            "synthetic": True,
            "official": False,
        }
        props.update(ctx.tag())
        feats.append(geo.feature(Point(round(lon, 6), round(lat, 6)), props))
    return feats


def build_pastures(ctx: Ctx, axis_m):
    rnd = ctx.rnd
    feats = []
    n = rnd.randint(4, 6) if ctx.detailed else rnd.randint(1, 3)
    names = (PASTURE_NAMES[:] if ctx.detailed
             else [f"Paturage {ctx.name} {k + 1}" for k in range(4)])
    rnd.shuffle(names)
    for i in range(n):
        d = (i + 0.5) / n * axis_m.length
        base = axis_m.interpolate(d)
        side = 1 if rnd.random() < 0.5 else -1
        cx = base.x + side * rnd.uniform(900, 4200)
        cy = base.y + rnd.uniform(-2500, 2500)
        poly_m = _blob(rnd, cx, cy, rnd.uniform(900, 1900), irregularity=0.30)
        poly = ctx.proj.geom_to_ll(poly_m)
        props = {
            "id": ctx.oid("PAT", i + 1),
            "name": names[i % len(names)],
            "kind": "pasture",
            "area_ha": round(poly_m.area / 10_000, 1),
            "status": rnd.choice(["amenage", "amenage", "non_amenage"]),
            "season": rnd.choice(["saison seche", "toute l'annee", "saison seche"]),
            "source": "Dynamic World V1 + terrain (synthetique)",
            "confidence": round(rnd.uniform(0.5, 0.9), 2),
            "synthetic": True,
            "official": False,
        }
        props.update(ctx.tag())
        feats.append(geo.feature(poly, props))
    return feats


def build_parcels(ctx: Ctx, axis_m, emprise_m, villages):
    """Parcelles de 0,5 a 6 ha, dont une part au contact de l'emprise.

    Reference : 30-38 parcelles dont 11-13 au contact. Autres communes : 11-18
    parcelles dont 4-8 au contact (assez pour produire 2 a 8 zones de friction).
    """
    rnd = ctx.rnd
    BBOX = ctx.bbox
    feats = []
    if ctx.detailed:
        n_near = rnd.randint(11, 13)
        n_total = rnd.randint(30, 38)
    else:
        n_near = rnd.randint(4, 8)
        n_total = rnd.randint(11, 18)
    vill_m = [Point(ctx.proj.to_m(*f["geometry"]["coordinates"])) for f in villages]

    def add(poly_m, near_corridor: bool):
        idx = len(feats) + 1
        poly = ctx.proj.geom_to_ll(poly_m)
        ha = poly_m.area / 10_000
        overlap = poly_m.intersection(emprise_m).area / 10_000
        conf = round(rnd.uniform(0.42, 0.95), 2)
        props = {
            "id": ctx.oid("PARC", idx, 3),
            "crop": rnd.choice(CROPS),
            "area_ha": round(ha, 2),
            "cultivated": True,
            "season": "2025-2026",
            "in_corridor": bool(overlap > 0.01),
            "overlap_ha": round(overlap, 2),
            "distance_corridor_m": int(poly_m.distance(emprise_m)),
            "detected_on": _iso(rnd.randint(40, 260)),
            "source": rnd.choice(["sentinel-2", "sentinel-2", "sentinel-2", "sentinel-1"]),
            "model_version": MODEL_VERSION,
            "confidence": conf,
            "synthetic": True,
            "official": False,
        }
        props.update(ctx.tag())
        feats.append(geo.feature(poly, props))

    # le couloir peut sortir de l'emprise de travail (il rejoint la commune
    # voisine) : les parcelles, elles, restent dans la commune.
    axis_in = axis_m.intersection(ctx.bbox_poly_m())
    if axis_in.is_empty or axis_in.length < 1000:
        axis_in = axis_m
    elif axis_in.geom_type == "MultiLineString":
        axis_in = max(axis_in.geoms, key=lambda g: g.length)

    # a. parcelles au contact du couloir
    for _ in range(n_near):
        d = rnd.uniform(0.04, 0.96) * axis_in.length
        base = axis_in.interpolate(d)
        nxt = axis_in.interpolate(min(d + 120, axis_in.length))
        ang = math.atan2(nxt.y - base.y, nxt.x - base.x)
        side = 1 if rnd.random() < 0.5 else -1
        # offset lateral faible => chevauchement ou frolement de l'emprise
        off = rnd.uniform(-20, 260)
        cx = base.x + side * off * math.cos(ang + math.pi / 2)
        cy = base.y + side * off * math.sin(ang + math.pi / 2)
        add(_field(rnd, cx, cy, rnd.uniform(0.6, 6.0), ang + rnd.uniform(-0.5, 0.5)), True)

    # b. parcelles de terroir, autour des villages
    guard = 0
    while len(feats) < n_total and guard < 4000:
        guard += 1
        if not vill_m:
            break
        v = rnd.choice(vill_m)
        ang = rnd.uniform(0, 2 * math.pi)
        r = rnd.uniform(400, 4500)
        cx, cy = v.x + r * math.cos(ang), v.y + r * math.sin(ang)
        lon, lat = ctx.proj.to_ll(cx, cy)
        if not (BBOX[0] < lon < BBOX[2] and BBOX[1] < lat < BBOX[3]):
            continue
        add(_field(rnd, cx, cy, rnd.uniform(0.5, 5.0), rnd.uniform(0, math.pi)), False)
    return feats


# --------------------------------------------------------------------------
# 3. Zones de friction, derivees des recouvrements reels
# --------------------------------------------------------------------------
def build_friction(ctx: Ctx, parcels, emprise_m, segments):
    rnd = ctx.rnd
    cands = []
    for f in parcels:
        poly_m = ctx.proj.geom_to_m(geo.geom_of(f))
        inter = poly_m.intersection(emprise_m)
        dist = poly_m.distance(emprise_m)
        if inter.is_empty and dist > 150:
            continue
        if inter.is_empty:
            # "frolement" : la friction est la bande entre la parcelle et l'emprise
            zone = poly_m.buffer(60).intersection(emprise_m.buffer(90))
            kind = "proximite"
        else:
            zone = inter.buffer(25)
            kind = "recouvrement"
        if zone.is_empty or zone.area < 400:
            continue
        cands.append((f, zone, kind, inter.area / 10_000, dist))

    cands.sort(key=lambda c: (-c[3], c[4]))
    keep = rnd.randint(9, 12) if ctx.detailed else rnd.randint(2, 8)
    cands = cands[:keep]

    feats = []
    for i, (parc, zone_m, kind, ov_ha, dist) in enumerate(cands, start=1):
        ha = zone_m.area / 10_000
        conf = round(rnd.uniform(0.40, 0.95), 2)
        if kind == "recouvrement":
            sev = 3 + min(2, int(ov_ha // 1.2))
        else:
            sev = 1 + (1 if dist < 60 else 0)
        sev = max(1, min(5, sev))
        centroid = zone_m.centroid
        seg = min(segments, key=lambda s: s["geom_m"].distance(centroid))
        source = rnd.choices(["sentinel-2", "sentinel-1", "terrain"], weights=[7, 2, 2])[0]
        status = rnd.choices(
            ["pending", "confirmed", "corrected", "invalidated"], weights=[5, 3, 1, 1]
        )[0]
        detected = _iso(rnd.randint(8, 210))
        crop = parc["properties"]["crop"]
        if kind == "recouvrement":
            note = (
                f"Mise en culture ({crop}) detectee dans l'emprise sur {ov_ha:.2f} ha "
                f"(parcelle {parc['properties']['id']}). A verifier au sol."
            )
        else:
            note = (
                f"Parcelle de {crop} a {int(dist)} m de l'emprise "
                f"(parcelle {parc['properties']['id']}) : retrecissement probable du passage."
            )
        props = {
            "id": ctx.oid("FRIC", i, 3),
            "severity": int(sev),
            "confidence": conf,
            "area_ha": round(ha, 2),
            "detected_on": detected,
            "source": source,
            "model_version": MODEL_VERSION,
            "status": status,
            "corridor_segment_id": seg["id"],
            "note": note,
            # champs additionnels (ignores par le contrat, utiles au moteur)
            "parcel_id": parc["properties"]["id"],
            "kind": kind,
            "season": 2026,
            "synthetic": True,
            "official": False,
        }
        props.update(ctx.tag())
        feats.append(geo.feature(ctx.proj.geom_to_ll(zone_m), props))

    # La demonstration du mode terrain a BESOIN de detections non verifiees :
    # on garantit au moins une detection `pending` par commune.
    if feats and not any(f["properties"]["status"] == "pending" for f in feats):
        feats[0]["properties"]["status"] = "pending"
    return feats


# --------------------------------------------------------------------------
# formes
# --------------------------------------------------------------------------
def _field(rnd, cx, cy, ha, ang):
    """Parcelle : quadrilatere legerement irregulier d'aire ~ha (en metres)."""
    area = ha * 10_000
    ratio = rnd.uniform(0.45, 1.0)
    w = math.sqrt(area / ratio)
    h = area / w
    pts = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
    out = []
    for x, y in pts:
        x += rnd.uniform(-w * 0.08, w * 0.08)
        y += rnd.uniform(-h * 0.08, h * 0.08)
        out.append((cx + x * math.cos(ang) - y * math.sin(ang),
                    cy + x * math.sin(ang) + y * math.cos(ang)))
    return Polygon(out)


def _blob(rnd, cx, cy, r, irregularity=0.25, n=13):
    pts = []
    for k in range(n):
        a = 2 * math.pi * k / n
        rr = r * (1 + rnd.uniform(-irregularity, irregularity))
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    return Polygon(pts).buffer(0)


def _iso(days_ago: int) -> str:
    return (date(2026, 3, 15) - timedelta(days=days_ago)).isoformat()


def _cloud_pct(iso_date: str) -> int:
    """Taux de nuages plausible, derive de facon deterministe de la date.

    La saison de culture est la saison des pluies (SPEC section 6) : les passages
    satellite sont souvent partiellement nuageux. VALEUR DE DEMONSTRATION.
    """
    return 8 + (sum(ord(c) for c in iso_date) % 47)


# --------------------------------------------------------------------------
# 4. SQLite
# --------------------------------------------------------------------------
SCHEMA = """
CREATE TABLE IF NOT EXISTS validations (
    rowid_        INTEGER PRIMARY KEY AUTOINCREMENT,
    friction_id   TEXT NOT NULL,
    status        TEXT NOT NULL,
    note          TEXT,
    agent         TEXT,
    channel       TEXT NOT NULL DEFAULT 'api',
    client_id     TEXT,
    observed_at   TEXT,
    created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_val_friction ON validations(friction_id);

CREATE TABLE IF NOT EXISTS observations (
    client_id     TEXT PRIMARY KEY,
    friction_id   TEXT,
    status        TEXT,
    agent         TEXT,
    note          TEXT,
    observed_at   TEXT,
    lon           REAL,
    lat           REAL,
    payload       TEXT NOT NULL,
    received_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS decisions (
    id                  TEXT PRIMARY KEY,
    corridor_segment_id TEXT NOT NULL,
    decision            TEXT NOT NULL,
    committee           TEXT NOT NULL,
    note                TEXT,
    decided_on          TEXT NOT NULL,
    broadcast           TEXT NOT NULL
);
"""

SEED_DECISIONS = [
    ("DEC-001", "SEG-03", "maintien", "Comite communal de transhumance de Banikoara",
     "Aucune mise en culture confirmee sur le segment apres verification terrain.",
     "2026-02-18", 42,
     "Le comite communal maintient le passage sur le segment SEG-03. Aucun champ "
     "n'a ete confirme dans l'emprise. Les eleveurs sont invites a respecter la "
     "largeur du couloir et les points d'eau signales."),
    ("DEC-002", "SEG-05", "ajustement", "Comite communal de transhumance de Banikoara",
     "Deux parcelles de coton confirmees dans l'emprise : passage decale de 300 m a l'ouest.",
     "2026-02-18", 55,
     "Le comite communal ajuste le passage sur le segment SEG-05. Deux champs de "
     "coton ont ete confirmes dans l'emprise. Le passage est decale de trois cents "
     "metres vers l'ouest jusqu'a la fin de la saison."),
    ("DEC-003", "SEG-06", "contournement", "Comite communal de transhumance de Banikoara",
     "Zone contestee entre eleveurs et exploitants : contournement par l'est valide en seance.",
     "2026-02-25", 61,
     "Le comite communal decide un contournement du segment SEG-06 par l'est. "
     "La zone reste contestee. Les representants des eleveurs sont pries d'en "
     "informer les campements avant le depart."),
]


def init_db():
    if os.path.exists(DB):
        os.remove(DB)
    con = sqlite3.connect(DB)
    con.executescript(SCHEMA)
    for (i, seg, dec, com, note, on, dur, tr) in SEED_DECISIONS:
        con.execute(
            "INSERT INTO decisions VALUES (?,?,?,?,?,?,?)",
            (i, seg, dec, com, note, on,
             json.dumps({"lang": "ff", "duration_s": dur, "transcript_fr": tr,
                         "audio_url": None, "synthetic": True}, ensure_ascii=False)),
        )
    con.commit()
    con.close()


# ==========================================================================
# 5. Generation d'une commune
# ==========================================================================
def seed_commune(ctx: Ctx, axis: LineString) -> dict:
    """Genere toutes les couches d'une commune et les ecrit dans data/communes/<id>/."""
    P = ctx.proj
    axis_m = P.geom_to_m(axis)
    emprise_m = axis_m.buffer(CORRIDOR_WIDTH_M / 2, cap_style=2, join_style=1)
    emprise = P.geom_to_ll(emprise_m)
    segments = corridor_segments(ctx, axis)

    meta = _meta()
    cor_id = ctx.oid("COR", 1) if not ctx.detailed else "COR-BANIKOARA-01"
    axis_props = {
        "id": cor_id,
        "name": f"Couloir de transhumance {ctx.name} Nord-Sud",
        "kind": "axis", "width_m": CORRIDOR_WIDTH_M,
        "source": "Reconstitution equipe Terra Sentinelle (OSM + OIM TTT-DTM + terrain)",
        "delimited_on": "2015-06-30", "official": False, "synthetic": True,
        "length_km": round(axis_m.length / 1000, 2),
        "segment_ids": [s["id"] for s in segments],
        "note": "Emprise RECONSTITUEE, non officielle. Aucun jeu ouvert de polygones "
                "de couloirs du Benin n'est disponible.",
    }
    axis_props.update(ctx.tag())
    feats = [geo.feature(axis, axis_props)]
    emp_props = {
        "id": f"{cor_id}-EMPRISE", "name": "Emprise du couloir (reconstituee)",
        "kind": "emprise", "width_m": CORRIDOR_WIDTH_M,
        "source": "Buffer 50 m de part et d'autre de l'axe reconstitue",
        "delimited_on": "2015-06-30", "official": False, "synthetic": True,
        "area_ha": round(emprise_m.area / 10_000, 1),
    }
    emp_props.update(ctx.tag())
    feats.append(geo.feature(emprise, emp_props))

    corridor = geo.fc(
        feats,
        segments=[{"id": s["id"], "corridor_id": cor_id,
                   "from_km": s["from_km"], "to_km": s["to_km"]} for s in segments],
        commune=ctx.id, meta=meta,
    )

    villages = build_villages(ctx, axis_m)
    water = build_water_points(ctx, axis_m)
    pastures = build_pastures(ctx, axis_m)
    parcels = build_parcels(ctx, axis_m, emprise_m, villages)
    friction = build_friction(ctx, parcels, emprise_m, segments)

    commune = {
        "id": ctx.id, "name": ctx.name, "department": ctx.department,
        "department_id": ctx.c.get("department_id"),
        "center": list(ctx.center), "bbox": list(ctx.bbox),
        "country": "Benin", "reference": ctx.detailed,
        "synthetic": True, "official": False, "note": meta["warning"],
    }

    out = os.path.join(COMMUNES_DIR, ctx.id)
    os.makedirs(out, exist_ok=True)
    _write(os.path.join(out, "commune.json"), commune)
    _write(os.path.join(out, "corridor.geojson"), corridor)
    _write(os.path.join(out, "villages.geojson"), geo.fc(villages, commune=ctx.id, meta=meta))
    _write(os.path.join(out, "water_points.geojson"), geo.fc(water, commune=ctx.id, meta=meta))
    _write(os.path.join(out, "pastures.geojson"), geo.fc(pastures, commune=ctx.id, meta=meta))
    _write(os.path.join(out, "parcels.geojson"), geo.fc(parcels, commune=ctx.id, meta=meta))
    _write(os.path.join(out, "friction.geojson"), geo.fc(friction, commune=ctx.id, meta=meta))

    corridor_km = round(axis_m.length / 1000, 2)
    sev = [f["properties"]["severity"] for f in friction]
    dated = sorted((f["properties"] for f in friction),
                   key=lambda p: p["detected_on"], reverse=True)
    last = dated[0] if dated else None
    status_counts = {s: sum(1 for f in friction if f["properties"]["status"] == s)
                     for s in ("pending", "confirmed", "corrected", "invalidated")}
    agg = {
        "id": ctx.id, "name": ctx.name, "department": ctx.department,
        "department_id": ctx.c.get("department_id"),
        "center": list(ctx.center), "bbox": list(ctx.bbox),
        "reference": ctx.detailed,
        "friction_count": len(friction),
        "max_severity": max(sev) if sev else 0,
        "last_pass": {
            "date": last["detected_on"] if last else None,
            "sensor": last["source"] if last else None,
            "cloud_pct": _cloud_pct(last["detected_on"]) if last else None,
            "synthetic": True,
        },
        "status_counts": status_counts,
        "corridor_km": corridor_km,
        "axis_km": round(axis_m.length / 1000, 2),
        "segment_count": len(segments),
        "village_count": len(villages),
        "water_point_count": len(water),
        "pasture_count": len(pastures),
        "parcel_count": len(parcels),
        "parcels_in_corridor": sum(1 for f in parcels if f["properties"]["in_corridor"]),
        "parcel_area_ha": round(sum(f["properties"]["area_ha"] for f in parcels), 1),
        "water_points_seasonal": sum(1 for f in water if f["properties"]["seasonal"]),
        "friction_area_ha": round(sum(f["properties"]["area_ha"] for f in friction), 2),
        "synthetic": True, "official": False,
    }
    return {
        "agg": agg,
        "friction_index": {f["properties"]["id"]: [ctx.id, f["properties"]["status"]]
                           for f in friction},
        "segment_index": {s["id"]: ctx.id for s in segments},
        "corridor_lines": [(f["properties"], geo.geom_of(f)) for f in feats
                           if f["geometry"]["type"] == "LineString"],
    }


def _meta() -> dict:
    return {
        "synthetic": True,
        "official": False,
        "generator": "seed.py",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "seed": SEED,
        "warning": ("Donnees de demonstration synthetiques. L'emprise du couloir est "
                    "reconstituee par l'equipe et n'a aucune valeur officielle."),
    }


# ==========================================================================
# 6. Reseau inter-communal
# ==========================================================================
def build_axes() -> dict[str, LineString]:
    """Trace le couloir de CHAQUE commune, raccorde a celui de sa voisine du nord.

    Regles de raccordement (aucune commune n'est citee en dur) :
      * la commune de REFERENCE garde son axe fige : ce sont SES extremites qui
        servent de jonction a ses voisines, jamais l'inverse ;
      * la continuation principale d'une commune part exactement de l'extremite
        SUD du troncon amont (meme point, reseau continu) ;
      * les autres voisines du sud partent d'un point situe SUR le troncon amont
        (jonction en T) : le couloir se divise ;
      * une commune sans voisine au nord demarre pres du bord nord de son emprise.
    Les communes sont traitees du nord vers le sud, pour qu'un troncon amont soit
    toujours trace avant ceux qui s'y raccordent.
    """
    net = registry.network()
    ref = registry.reference_id()

    ref_axis = build_corridor_axis()          # consomme le generateur historique
    ref_coords = list(ref_axis.coords)
    ref_south, ref_north = list(ref_coords[0]), list(ref_coords[-1])

    axes: dict[str, LineString] = {}
    south_end: dict[str, list[float]] = {}

    def exit_of(cid: str) -> list[float]:
        main = net["main_child"][cid]
        c = registry.get(cid)
        lon, lat = c["center"]
        w, s, e, n = c["bbox"]
        if main is None:                       # terminus : on s'arrete dans la commune
            return [round(lon, 6), round(s + (lat - s) * 0.15, 6)]
        if main == ref:                        # l'axe fige impose son entree
            return ref_north
        return registry.junction(cid, main)

    def entry_of(cid: str) -> list[float]:
        parent = net["parent"][cid]
        c = registry.get(cid)
        lon, lat = c["center"]
        w, s, e, n = c["bbox"]
        if parent is None:                     # tete de reseau (extreme nord)
            return [round(lon, 6), round(n - (n - lat) * 0.15, 6)]
        if net["main_child"][parent] == cid:
            return south_end[parent]
        return nearest_on(axes[parent], registry.proj(parent),
                          registry.junction(parent, cid))

    for cid in sorted(registry.ids(), key=lambda c: (net["depth"][c],
                                                     -registry.get(c)["center"][1])):
        if cid == ref:
            axes[cid] = ref_axis
            south_end[cid] = ref_south
            continue
        ctx = Ctx(registry.get(cid), detailed=False)
        entry, exit_ = entry_of(cid), exit_of(cid)
        axes[cid] = build_light_axis(ctx, entry, exit_)
        south_end[cid] = exit_
    return axes


def simplify_network(all_lines, tol_deg: float = 0.008) -> dict:
    """Reseau simplifie pour la VUE REGIONALE (moins de points, reponse < 500 ms)."""
    feats, kept, raw = [], 0, 0
    for props, line in all_lines:
        raw += len(line.coords)
        simp = line.simplify(tol_deg, preserve_topology=False)
        if len(simp.coords) < 2:
            simp = line
        kept += len(simp.coords)
        p = {k: props[k] for k in ("id", "name", "kind", "commune", "commune_name",
                                   "department", "length_km", "synthetic", "official")
             if k in props}
        feats.append(geo.feature(simp, p, ndigits=4))
    return geo.fc(feats, simplified=True, tolerance_deg=tol_deg,
                  points_original=raw, points_kept=kept,
                  note="Reseau SIMPLIFIE pour la vue regionale : pour le trace precis "
                       "d'une commune, utiliser GET /api/commune/{id}/corridor.")


# ==========================================================================
# 7. Programme principal
# ==========================================================================
def main():
    os.makedirs(DATA, exist_ok=True)
    if os.path.isdir(COMMUNES_DIR):
        shutil.rmtree(COMMUNES_DIR)          # rejouable : on repart d'une page blanche
    os.makedirs(COMMUNES_DIR, exist_ok=True)

    communes = registry.all_communes()
    ref = registry.reference_id()
    axes = build_axes()

    # La commune de reference est generee EN PREMIER : elle consomme le generateur
    # historique dans l'ordre historique, donc son jeu est identique a l'ancien.
    order = [ref] + [c["id"] for c in communes if c["id"] != ref]

    results: dict[str, dict] = {}
    all_lines = []
    friction_index: dict[str, list] = {}
    segment_index: dict[str, str] = {}
    for cid in order:
        ctx = Ctx(registry.get(cid), detailed=(cid == ref))
        res = seed_commune(ctx, axes[cid])
        results[cid] = res
        all_lines.extend(res["corridor_lines"])
        friction_index.update(res["friction_index"])
        segment_index.update(res["segment_index"])

    # ---- agregats regionaux (precalcules : /api/communes doit repondre vite) --
    aggs = [results[c["id"]]["agg"] for c in communes]
    depts = []
    for d in registry.departments():
        rows = [a for a in aggs if a["id"] in d["commune_ids"]]
        sev = [a["max_severity"] for a in rows]
        depts.append({
            "id": d["id"], "name": d["name"],
            "commune_count": len(rows),
            "commune_ids": list(d["commune_ids"]),
            "friction_count": sum(a["friction_count"] for a in rows),
            "max_severity": max(sev) if sev else 0,
            "corridor_km": round(sum(a["corridor_km"] for a in rows), 1),
            "village_count": sum(a["village_count"] for a in rows),
            "parcel_count": sum(a["parcel_count"] for a in rows),
            "bbox": list(registry.union_bbox(d["commune_ids"])) if d["commune_ids"] else None,
        })

    w, s, e, n = registry.region_bbox()
    info = registry.region_info()
    region = {
        "name": info.get("name", "Nord & Centre Benin"),
        "country": info.get("country", "Benin"),
        "bbox": [round(v, 4) for v in (w, s, e, n)],
        "center": registry.region_center(),
        "commune_count": len(aggs),
        "department_count": len(depts),
        "corridor_km_total": round(sum(a["corridor_km"] for a in aggs), 1),
        "reference_commune": ref,
        "friction_total": sum(a["friction_count"] for a in aggs),
        "village_total": sum(a["village_count"] for a in aggs),
        "parcel_total": sum(a["parcel_count"] for a in aggs),
        "water_point_total": sum(a["water_point_count"] for a in aggs),
        "pasture_total": sum(a["pasture_count"] for a in aggs),
        "communes": aggs,
        "departments": depts,
        "adjacency": registry.adjacency(),
        "network_links": [list(l) for l in registry.network()["links"]],
        "friction_index": friction_index,
        "segment_index": segment_index,
        "meta": _meta(),
        "synthetic": True,
        "official": False,
    }
    _write(os.path.join(DATA, "region.json"), region)
    _write(os.path.join(DATA, "region_corridors.geojson"), simplify_network(all_lines))

    # ---- anciens fichiers mono-commune : remplaces par data/communes/<id>/ ----
    legacy = ["commune.json", "corridor.geojson", "villages.geojson",
              "water_points.geojson", "pastures.geojson", "parcels.geojson",
              "friction.geojson"]
    removed = [f for f in legacy if os.path.exists(os.path.join(DATA, f))]
    for f in removed:
        os.remove(os.path.join(DATA, f))

    init_db()

    # ---- compte rendu --------------------------------------------------------
    pending = sum(a["status_counts"]["pending"] for a in aggs)
    refa = results[ref]["agg"]
    print("Terra Sentinelle : donnees de demonstration generees (SYNTHETIQUES)")
    print(f"  couverture   : {len(aggs)} communes / {len(depts)} departements "
          f"({region['corridor_km_total']} km de couloirs reconstitues, non officiels)")
    for d in depts:
        print(f"    - {d['name']:<10s} {d['commune_count']:2d} communes, "
              f"{d['friction_count']:3d} frictions, {d['corridor_km']:7.1f} km, "
              f"gravite max {d['max_severity']}/5")
    print(f"  reference    : {refa['name']} : {refa['axis_km']} km, "
          f"{refa['village_count']} villages, {refa['water_point_count']} points d'eau, "
          f"{refa['pasture_count']} paturages, {refa['parcel_count']} parcelles "
          f"(dont {refa['parcels_in_corridor']} dans l'emprise), "
          f"{refa['friction_count']} frictions, {refa['segment_count']} segments")
    print(f"  frictions    : {region['friction_total']} au total, "
          f"dont {pending} EN ATTENTE de validation terrain (mode terrain)")
    if pending == 0:
        raise SystemExit("ERREUR : aucune detection `pending`, la demo du mode terrain "
                         "serait vide. Verifiez build_friction().")
    print(f"  villages     : {region['village_total']}   points d'eau : "
          f"{region['water_point_total']}   paturages : {region['pasture_total']}   "
          f"parcelles : {region['parcel_total']}")
    if removed:
        print(f"  nettoyage    : anciens fichiers racine supprimes ({', '.join(removed)}) "
              f"-> remplaces par data/communes/<id>/")
    print(f"  base SQLite  : {DB} ({len(SEED_DECISIONS)} decisions de comite)")


def _write(path, obj):
    if not os.path.isabs(path):
        path = os.path.join(DATA, path)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
