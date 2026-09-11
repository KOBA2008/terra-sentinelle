"""
Terra Sentinelle : acces aux donnees.

Deux sources, volontairement simples (le prototype doit demarrer en 30 s sur un
portable, sans PostGIS ni Docker) :
  * fichiers GeoJSON dans ./data/          -> couches de reference (sortie de seed.py)
  * SQLite ./data/terra.sqlite             -> validations terrain, observations
                                              synchronisees hors ligne, decisions

Depuis l'elargissement a 5 departements / 33 communes (SPEC section 5), les
couches sont rangees PAR COMMUNE dans ./data/communes/<id>/ et deux fichiers
precalcules par le seed servent la vue regionale sans rien recalculer :
  * data/region.json              agregats par commune et par departement
  * data/region_corridors.geojson reseau inter-communal simplifie

Toute fonction de couche accepte un identifiant de commune ; sans identifiant,
elle repond pour la COMMUNE DE REFERENCE (Banikoara) : c'est ce qui fait tenir
les anciennes routes sans {id} (regle de compatibilite, SPEC section 8).

Le statut d'une zone de friction expose par l'API est TOUJOURS le dernier statut
journalise en base s'il existe, sinon le statut issu de la detection.
"""
from __future__ import annotations

import copy
import json
import os
import sqlite3
import threading
from datetime import datetime, timezone

import registry

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
COMMUNES_DIR = os.path.join(DATA, "communes")
DB = os.path.join(DATA, "terra.sqlite")

_LOCK = threading.Lock()
_cache: dict = {}
# incremente a chaque ecriture qui change la surface de cout (validation terrain)
DATA_VERSION = {"v": 0}

LAYER_FILES = {
    "villages": "villages.geojson",
    "water_points": "water_points.geojson",
    "pastures": "pastures.geojson",
    "parcels": "parcels.geojson",
}
VALID_STATUS = ("pending", "confirmed", "corrected", "invalidated")


class MissingData(RuntimeError):
    pass


class UnknownCommune(KeyError):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


# --------------------------------------------------------------------- GeoJSON
def _load(relpath: str):
    """Charge un fichier de ./data/, avec cache invalide par date de modification."""
    path = os.path.join(DATA, relpath)
    if not os.path.exists(path):
        raise MissingData(
            f"{relpath} introuvable dans {DATA}. Lancez d'abord :  python seed.py"
        )
    mtime = os.path.getmtime(path)
    hit = _cache.get(relpath)
    if hit and hit[0] == mtime:
        return hit[1]
    with open(path, encoding="utf-8") as fh:
        obj = json.load(fh)
    _cache[relpath] = (mtime, obj)
    return obj


# ------------------------------------------------------------------- communes
def reference() -> str:
    """Commune servie par les anciennes routes sans identifiant (Banikoara)."""
    return registry.reference_id()


def resolve(cid: str | None) -> str:
    """Identifiant de commune valide, ou celui de la commune de reference."""
    if cid in (None, ""):
        return reference()
    raw = str(cid).strip()
    resolved = registry.resolve_alias(raw)
    if resolved is None:
        raise UnknownCommune(
            f"commune inconnue : '{raw}' ; la liste des {len(registry.ids())} communes "
            f"couvertes est servie par GET /api/communes")
    return resolved


def _cfile(cid: str, name: str):
    return _load(os.path.join("communes", cid, name))


def region() -> dict:
    """Agregats precalcules par le seed (vue regionale : reponse immediate)."""
    return _load("region.json")


def region_corridors() -> dict:
    """Reseau inter-communal SIMPLIFIE (vue large)."""
    return _load("region_corridors.geojson")


def commune(cid: str | None = None) -> dict:
    return _cfile(resolve(cid), "commune.json")


def corridor(cid: str | None = None) -> dict:
    return _cfile(resolve(cid), "corridor.geojson")


def corridor_segments(cid: str | None = None) -> list:
    return corridor(cid).get("segments", [])


def layer(kind: str, cid: str | None = None) -> dict:
    if kind not in LAYER_FILES:
        raise KeyError(kind)
    return _cfile(resolve(cid), LAYER_FILES[kind])


def friction_raw(cid: str | None = None) -> dict:
    return _cfile(resolve(cid), "friction.geojson")


def communes(live: bool = True) -> list:
    """Une ligne par commune, agregats compris (SPEC section 8 : GET /communes).

    Les agregats sont PRECALCULES au seed ; seul le decompte par statut est
    reajuste ici avec les validations terrain enregistrees depuis (quelques
    lignes de SQLite), ce qui garde la reponse sous les 500 ms exigees.
    """
    reg = region()
    rows = copy.deepcopy(reg["communes"])
    if not live:
        return rows
    over = latest_validations()
    if over:
        index = reg.get("friction_index", {})
        by_id = {r["id"]: r for r in rows}
        for fid, v in over.items():
            entry = index.get(fid)
            if not entry:
                continue
            cid, base = entry[0], entry[1]
            row = by_id.get(cid)
            if not row or v["status"] == base:
                continue
            counts = row.setdefault("status_counts", {})
            counts[base] = max(0, counts.get(base, 0) - 1)
            counts[v["status"]] = counts.get(v["status"], 0) + 1
    return rows


def departments() -> list:
    """Agregats par departement (SPEC section 8 : GET /departments)."""
    reg = region()
    rows = copy.deepcopy(reg["departments"])
    live = {r["id"]: r for r in communes()}
    for d in rows:
        cids = d.get("commune_ids", [])
        pend = sum(live[c]["status_counts"].get("pending", 0) for c in cids if c in live)
        conf = sum(live[c]["status_counts"].get("confirmed", 0) for c in cids if c in live)
        d["pending"] = pend
        d["confirmed"] = conf
    return rows


def region_summary() -> dict:
    """Entete de la vue regionale (SPEC section 8 : GET /region)."""
    reg = region()
    keys = ("name", "country", "bbox", "center", "commune_count", "department_count",
            "corridor_km_total", "reference_commune", "friction_total", "village_total",
            "parcel_total", "water_point_total", "pasture_total", "synthetic", "official")
    out = {k: reg[k] for k in keys if k in reg}
    out["departments"] = [{"id": d["id"], "name": d["name"],
                           "commune_count": d["commune_count"]} for d in reg["departments"]]
    out["generated_at"] = reg.get("meta", {}).get("generated_at")
    return out


def friction(season: int | None = None, cid: str | None = None) -> dict:
    """Zones de friction avec statut a jour (overrides SQLite appliques).

    `cid = None` -> TOUTES les communes (vue regionale) ; sinon une seule.
    """
    targets = registry.ids() if cid in (None, "") else [resolve(cid)]
    over = latest_validations()
    feats = []
    for c in targets:
        base = copy.deepcopy(friction_raw(c)["features"])
        for f in base:
            p = f["properties"]
            p.setdefault("commune", c)
            v = over.get(p["id"])
            if v:
                p["status"] = v["status"]
                p["validated_by"] = v["agent"]
                p["validated_at"] = v["created_at"]
                p["validation_note"] = v["note"]
                p["validation_channel"] = v["channel"]
            else:
                p.setdefault("validated_by", None)
                p.setdefault("validated_at", None)
            if season is not None and int(p.get("season", season)) != int(season):
                continue
            feats.append(f)
    out = {"type": "FeatureCollection", "features": feats,
           "commune": (None if cid in (None, "") else resolve(cid)),
           "communes": len(targets),
           "meta": region().get("meta", {})}
    if season is not None:
        out["season"] = int(season)
    return out


def friction_commune(fid: str) -> str | None:
    """Commune d'une zone de friction, via l'index precalcule (pas de balayage)."""
    entry = region().get("friction_index", {}).get(fid)
    return entry[0] if entry else None


def friction_by_id(fid: str):
    cid = friction_commune(fid)
    if cid is None:
        return None
    for f in friction(cid=cid)["features"]:
        if f["properties"]["id"] == fid:
            return f
    return None


def segment_commune(sid: str) -> str | None:
    return region().get("segment_index", {}).get(sid)


def all_segment_ids() -> list:
    return sorted(region().get("segment_index", {}))


# ---------------------------------------------------------------------- SQLite
def connect() -> sqlite3.Connection:
    if not os.path.exists(DB):
        raise MissingData(f"{DB} introuvable. Lancez d'abord :  python seed.py")
    con = sqlite3.connect(DB, timeout=10)
    con.row_factory = sqlite3.Row
    return con


def record_validation(friction_id: str, status: str, note: str | None, agent: str | None,
                      channel: str = "api", client_id: str | None = None,
                      observed_at: str | None = None) -> dict:
    with _LOCK, connect() as con:
        con.execute(
            "INSERT INTO validations (friction_id,status,note,agent,channel,client_id,"
            "observed_at,created_at) VALUES (?,?,?,?,?,?,?,?)",
            (friction_id, status, note, agent, channel, client_id, observed_at, now_iso()),
        )
    DATA_VERSION["v"] += 1
    return {"friction_id": friction_id, "status": status, "agent": agent}


def latest_validations() -> dict:
    try:
        con = connect()
    except MissingData:
        return {}
    with con:
        rows = con.execute(
            "SELECT v.* FROM validations v JOIN (SELECT friction_id, MAX(rowid_) m "
            "FROM validations GROUP BY friction_id) x "
            "ON v.friction_id = x.friction_id AND v.rowid_ = x.m"
        ).fetchall()
    return {r["friction_id"]: dict(r) for r in rows}


def validation_log(friction_id: str | None = None, limit: int = 200) -> list:
    with connect() as con:
        if friction_id:
            rows = con.execute(
                "SELECT * FROM validations WHERE friction_id=? ORDER BY rowid_ DESC LIMIT ?",
                (friction_id, limit)).fetchall()
        else:
            rows = con.execute(
                "SELECT * FROM validations ORDER BY rowid_ DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]


def observation_exists(client_id: str) -> bool:
    with connect() as con:
        return con.execute(
            "SELECT 1 FROM observations WHERE client_id=?", (client_id,)).fetchone() is not None


def insert_observation(client_id: str, obs: dict) -> bool:
    """Insere une observation. Retourne False si le client_id existe deja (idempotence)."""
    lon = lat = None
    geom = obs.get("geometry") or {}
    if isinstance(geom, dict) and geom.get("type") == "Point":
        c = geom.get("coordinates") or []
        if len(c) >= 2:
            lon, lat = float(c[0]), float(c[1])
    if obs.get("lon") is not None and obs.get("lat") is not None:
        lon, lat = float(obs["lon"]), float(obs["lat"])
    with _LOCK, connect() as con:
        cur = con.execute(
            "INSERT OR IGNORE INTO observations (client_id,friction_id,status,agent,note,"
            "observed_at,lon,lat,payload,received_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (client_id, obs.get("friction_id"), obs.get("status"), obs.get("agent"),
             obs.get("note"), obs.get("observed_at"), lon, lat,
             json.dumps(obs, ensure_ascii=False), now_iso()),
        )
        return cur.rowcount == 1


def observations(limit: int = 200) -> list:
    with connect() as con:
        rows = con.execute(
            "SELECT * FROM observations ORDER BY received_at DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]


def decisions() -> list:
    with connect() as con:
        rows = con.execute("SELECT * FROM decisions ORDER BY decided_on DESC, id DESC").fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["broadcast"] = json.loads(d["broadcast"])
        out.append(d)
    return out


def add_decision(corridor_segment_id: str, decision: str, committee: str,
                 note: str | None) -> dict:
    with _LOCK, connect() as con:
        n = con.execute("SELECT COUNT(*) c FROM decisions").fetchone()["c"]
        did = f"DEC-{n + 1:03d}"
        while con.execute("SELECT 1 FROM decisions WHERE id=?", (did,)).fetchone():
            n += 1
            did = f"DEC-{n + 1:03d}"
        transcript = _transcript(corridor_segment_id, decision, note)
        broadcast = {
            "lang": "ff",
            "duration_s": max(25, min(90, int(len(transcript.split()) / 2.3) + 12)),
            "transcript_fr": transcript,
            "audio_url": None,
            "synthetic": True,
            "note": "Synthese vocale fulfulde non branchee dans le prototype : "
                    "seul le texte a diffuser est produit.",
        }
        con.execute(
            "INSERT INTO decisions VALUES (?,?,?,?,?,?,?)",
            (did, corridor_segment_id, decision, committee, note,
             now_iso()[:10], json.dumps(broadcast, ensure_ascii=False)),
        )
    return {
        "id": did, "corridor_segment_id": corridor_segment_id, "decision": decision,
        "committee": committee, "note": note, "decided_on": now_iso()[:10],
        "broadcast": broadcast,
    }


def _transcript(seg: str, decision: str, note: str | None) -> str:
    base = {
        "maintien": (f"Le comite communal maintient le passage sur le segment {seg}. "
                     "Le couloir reste utilisable sur sa largeur habituelle."),
        "ajustement": (f"Le comite communal ajuste le passage sur le segment {seg}. "
                       "Le trace est modifie localement pour eviter les champs confirmes."),
        "contournement": (f"Le comite communal decide un contournement du segment {seg}. "
                          "Les troupeaux doivent emprunter l'itineraire de substitution indique."),
    }[decision]
    if note:
        base += " " + note.strip().rstrip(".") + "."
    base += (" Les representants des eleveurs sont pries d'en informer les campements "
             "avant le depart.")
    return base
