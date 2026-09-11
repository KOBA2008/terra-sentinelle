"""
Terra Sentinelle : registre des communes couvertes.

SOURCE DE VERITE UNIQUE : `data/communes.json` (SPEC section 5, 5 departements /
33 communes). Ce module est le SEUL a lire ce fichier ; aucune commune n'est codee
en dur dans le code Python. Corriger un nom, un centre ou une bbox = editer le JSON
puis relancer `python seed.py`.

Il derive du fichier, de facon deterministe et sans aucune table en dur :
  * la projection locale de chaque commune                  -> `proj(cid)`
  * l'adjacence entre communes (recouvrement des emprises)  -> `adjacent(a, b)`
  * le reseau de couloirs nord -> sud (qui se raccorde a qui) -> `network()`

L'adjacence sert de GARDE-FOU de performance : un itineraire n'est calcule que
dans une commune ou entre deux communes adjacentes (SPEC section 5).
"""
from __future__ import annotations

import json
import math
import os
import re
import threading
import unicodedata

import geo

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
COMMUNES_FILE = os.path.join(DATA, "communes.json")

# Deux emprises dilatees de cette marge (en degres) qui se recouvrent =
# communes considerees adjacentes. Les bbox du fichier sont approximatives :
# la marge absorbe le jeu, sans rendre adjacentes des communes eloignees.
ADJACENCY_MARGIN_DEG = 0.12

# Reseau : une commune ne se raccorde qu'a une commune situee plus au nord et
# distante de moins de ce seuil (en degres). Au-dela, elle amorce son propre axe.
LINK_MAX_DEG = 1.10
# Poids de l'ecart est-ouest : la transhumance descend du Sahel vers le sud, on
# privilegie donc les raccordements verticaux.
LINK_LON_WEIGHT = 1.8
MIN_DLAT = 0.05


class UnknownCommune(KeyError):
    """Identifiant de commune absent de data/communes.json."""


_lock = threading.Lock()
_cache: dict = {}


# ---------------------------------------------------------------- chargement
def _raw() -> dict:
    """Contenu de communes.json, recharge automatiquement si le fichier change."""
    mtime = os.path.getmtime(COMMUNES_FILE) if os.path.exists(COMMUNES_FILE) else None
    if mtime is None:
        raise FileNotFoundError(
            f"{COMMUNES_FILE} introuvable : c'est la liste des communes couvertes "
            f"(SPEC section 5). Sans lui, rien ne peut etre genere ni servi.")
    with _lock:
        if _cache.get("mtime") != mtime:
            with open(COMMUNES_FILE, encoding="utf-8") as fh:
                doc = json.load(fh)
            _cache.clear()
            _cache["mtime"] = mtime
            _cache["doc"] = doc
            _cache["list"] = [_normalise(c) for c in doc["communes"]]
            _cache["index"] = {c["id"]: c for c in _cache["list"]}
            if len(_cache["index"]) != len(_cache["list"]):
                raise ValueError("communes.json : identifiants de commune en double")
        return _cache


def _normalise(c: dict) -> dict:
    out = dict(c)
    out["id"] = str(c["id"]).strip()
    out["center"] = [float(c["center"][0]), float(c["center"][1])]
    out["bbox"] = [float(v) for v in c["bbox"]]
    w, s, e, n = out["bbox"]
    if not (w < e and s < n):
        raise ValueError(f"communes.json : bbox invalide pour {out['id']} : {out['bbox']}")
    out.setdefault("department_id", _slug(out.get("department", "")))
    return out


def _slug(txt: str) -> str:
    return "".join(ch.lower() if ch.isalnum() else "-" for ch in txt).strip("-")


# ---------------------------------------------------------------- accesseurs
def region_info() -> dict:
    return _raw()["doc"].get("region", {"name": "Nord & Centre Benin", "country": "Benin"})


def reference_id() -> str:
    """Commune de demonstration detaillee (Banikoara). Lue, pas codee en dur."""
    r = region_info().get("reference_commune")
    return r if r and r in index() else all_communes()[0]["id"]


def all_communes() -> list[dict]:
    return _raw()["list"]


def index() -> dict:
    return _raw()["index"]


def ids() -> list[str]:
    return [c["id"] for c in all_communes()]


def get(cid: str) -> dict:
    try:
        return index()[cid]
    except KeyError:
        raise UnknownCommune(
            f"commune inconnue : '{cid}' ; {len(ids())} communes disponibles "
            f"(voir GET /api/communes)") from None


def exists(cid: str) -> bool:
    return cid in index()


def _ascii(txt: str) -> str:
    return "".join(ch for ch in unicodedata.normalize("NFD", txt)
                   if unicodedata.category(ch) != "Mn")


def _aliases() -> dict:
    """Autres ecritures acceptees pour un identifiant de commune.

    Le front, les anciens exports et les notes de terrain n'emploient pas tous le
    meme code (`BJ-AL-BANIKOARA`, `Banikoara`, `banikoara`). On accepte tout ce
    qui est non ambigu et on renvoie TOUJOURS le slug canonique.
    """
    raw = _raw()
    if "aliases" not in raw:
        idx: dict[str, str] = {}
        for c in all_communes():
            cid = c["id"]
            for k in (cid, cid.replace("-", ""), cid.replace("-", "_"),
                      _ascii(c["name"]).lower().replace(" ", "-"),
                      _ascii(c["name"]).lower().replace(" ", ""),
                      _ascii(c["name"]).lower().replace("'", "")):
                idx.setdefault(k, cid)
        raw["aliases"] = idx
    return raw["aliases"]


def resolve_alias(raw_id) -> str | None:
    """Slug canonique correspondant a `raw_id`, ou None si indecidable."""
    key = str(raw_id).strip().lower().replace("'", "")
    idx = _aliases()
    if key in idx:
        return idx[key]
    m = re.match(r"^bj[-_]?[a-z]{2}[-_](.+)$", key)     # BJ-AL-BANIKOARA
    if m:
        key = m.group(1)
        if key in idx:
            return idx[key]
    cands = sorted({cid for k, cid in idx.items() if k.startswith(key)})
    return cands[0] if len(cands) == 1 else None


def resolve_department(raw_id) -> str | None:
    """Slug de departement, en acceptant `BJ-AL`, `Alibori`, `alibori`."""
    key = str(raw_id).strip().lower()
    known = {d["id"]: d["id"] for d in departments()}
    known.update({_ascii(d["name"]).lower(): d["id"] for d in departments()})
    if key in known:
        return known[key]
    m = re.match(r"^bj[-_]?([a-z]{2})$", key)
    if m:
        cands = [d for d in known.values() if d.startswith(m.group(1))]
        if len(set(cands)) == 1:
            return cands[0]
    return None


def name(cid: str) -> str:
    return get(cid)["name"]


def bbox(cid: str) -> tuple[float, float, float, float]:
    return tuple(get(cid)["bbox"])          # type: ignore[return-value]

def center(cid: str) -> list[float]:
    return list(get(cid)["center"])


def proj(cid: str) -> geo.Proj:
    """Projection locale de la commune."""
    return geo.proj_for(get(cid)["center"])


def proj_of(cids) -> geo.Proj:
    """Projection locale commune a un ou deux identifiants."""
    return geo.proj_for_many([get(c)["center"] for c in cids])


def union_bbox(cids) -> tuple[float, float, float, float]:
    bxs = [get(c)["bbox"] for c in cids]
    return (min(b[0] for b in bxs), min(b[1] for b in bxs),
            max(b[2] for b in bxs), max(b[3] for b in bxs))


def region_bbox() -> tuple[float, float, float, float]:
    return union_bbox(ids())


def region_center() -> list[float]:
    w, s, e, n = region_bbox()
    return [round((w + e) / 2, 4), round((s + n) / 2, 4)]


def departments() -> list[dict]:
    """Departements dans l'ordre du fichier, avec leurs communes."""
    doc = _raw()["doc"]
    declared = {d["id"]: d.get("name", d["id"]) for d in doc.get("departments", [])}
    order, seen = [], {}
    for c in all_communes():
        did = c["department_id"]
        if did not in seen:
            seen[did] = {"id": did, "name": declared.get(did, c.get("department", did)),
                         "commune_ids": []}
            order.append(seen[did])
        seen[did]["commune_ids"].append(c["id"])
    for did, label in declared.items():          # departement declare mais vide
        if did not in seen:
            order.append({"id": did, "name": label, "commune_ids": []})
    return order


def contains(cid: str, lon: float, lat: float) -> bool:
    w, s, e, n = bbox(cid)
    return w <= lon <= e and s <= lat <= n


def commune_for_point(lon: float, lat: float, prefer: str | None = None) -> str | None:
    """Commune dont l'emprise contient le point.

    Les emprises se recouvrent volontairement : on retient `prefer` si elle
    convient, sinon la commune dont le centre est le plus proche.
    """
    if prefer and exists(prefer) and contains(prefer, lon, lat):
        return prefer
    hits = [c for c in all_communes()
            if c["bbox"][0] <= lon <= c["bbox"][2] and c["bbox"][1] <= lat <= c["bbox"][3]]
    if not hits:
        return None
    return min(hits, key=lambda c: math.hypot(c["center"][0] - lon,
                                              c["center"][1] - lat))["id"]


# ----------------------------------------------------------------- adjacence
def _bbox_touch(a: dict, b: dict, margin: float = ADJACENCY_MARGIN_DEG) -> bool:
    aw, as_, ae, an = a["bbox"]
    bw, bs, be, bn = b["bbox"]
    return not (ae + margin < bw - margin or be + margin < aw - margin
                or an + margin < bs - margin or bn + margin < as_ - margin)


def adjacency() -> dict[str, list[str]]:
    """Graphe d'adjacence derive des emprises + des raccordements de couloir."""
    raw = _raw()
    if "adjacency" not in raw:
        cs = all_communes()
        adj = {c["id"]: set() for c in cs}
        for i, a in enumerate(cs):
            for b in cs[i + 1:]:
                if _bbox_touch(a, b):
                    adj[a["id"]].add(b["id"])
                    adj[b["id"]].add(a["id"])
        for a, b in network()["links"]:          # un couloir raccorde = adjacence
            adj[a].add(b)
            adj[b].add(a)
        raw["adjacency"] = {k: sorted(v) for k, v in adj.items()}
    return raw["adjacency"]


def neighbours(cid: str) -> list[str]:
    get(cid)
    return adjacency().get(cid, [])


def adjacent(a: str, b: str) -> bool:
    return a == b or b in neighbours(a)


# ------------------------------------------------------------------- reseau
def _link_cost(up: dict, down: dict) -> float:
    dlon = (up["center"][0] - down["center"][0]) * LINK_LON_WEIGHT
    dlat = up["center"][1] - down["center"][1]
    return math.hypot(dlon, dlat)


def network() -> dict:
    """Arborescence des couloirs, orientee nord -> sud.

    Chaque commune se raccorde a la commune la plus proche situee au nord (cout
    penalisant l'ecart est-ouest) : on obtient une foret de couloirs qui descendent
    du Sahel vers le sud, ou les troncons de communes voisines se rejoignent au
    MEME point (la jonction est partagee), donc un reseau reellement continu.

    Retourne {parent, children, main_child, roots, links, depth}.
    """
    raw = _raw()
    if "network" in raw:
        return raw["network"]

    cs = sorted(all_communes(), key=lambda c: (-c["center"][1], c["center"][0]))
    parent: dict[str, str | None] = {}
    for i, c in enumerate(cs):
        best, best_cost = None, None
        for up in cs[:i]:                        # strictement plus au nord
            if up["center"][1] - c["center"][1] < MIN_DLAT:
                continue
            cost = _link_cost(up, c)
            if cost > LINK_MAX_DEG:
                continue
            if best_cost is None or cost < best_cost:
                best, best_cost = up["id"], cost
        parent[c["id"]] = best

    children: dict[str, list[str]] = {c["id"]: [] for c in cs}
    for cid, pid in parent.items():
        if pid:
            children[pid].append(cid)

    # branche principale = continuation la plus "droite" ; les autres enfants
    # sont des embranchements (le couloir se divise).
    main_child: dict[str, str | None] = {}
    for cid, kids in children.items():
        main_child[cid] = min(kids, key=lambda k: _link_cost(get(cid), get(k))) if kids else None

    depth: dict[str, int] = {}
    for c in cs:                                  # cs est trie du nord au sud
        p = parent[c["id"]]
        depth[c["id"]] = 0 if p is None else depth.get(p, 0) + 1

    links = sorted((pid, cid) for cid, pid in parent.items() if pid)
    raw["network"] = {
        "parent": parent,
        "children": {k: sorted(v) for k, v in children.items()},
        "main_child": main_child,
        "roots": [c["id"] for c in cs if parent[c["id"]] is None],
        "links": links,
        "depth": depth,
    }
    return raw["network"]


def junction(a: str, b: str) -> list[float]:
    """Point de raccordement partage par deux communes liees (milieu des centres).

    Le seed peut le surcharger (l'axe fige de Banikoara impose ses extremites) :
    voir `seed.JUNCTION_OVERRIDES`.
    """
    ca, cb = get(a)["center"], get(b)["center"]
    return [round((ca[0] + cb[0]) / 2, 6), round((ca[1] + cb[1]) / 2, 6)]
