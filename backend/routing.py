"""
Terra Sentinelle : moteur d'itineraire.

Principe
--------
1. On discretise la bbox de demonstration en une grille reguliere (defaut 200 m,
   reglable via TS_GRID_RES_M).
2. Chaque cellule recoit un COUT DE TRAVERSEE construit a partir des couches :
      - tres eleve  : parcelles cultivees, frictions confirmees graves, abords
                      immediats des villages (zones de fait interdites), secteurs
                      contestes (friction "corrected"/"pending" grave)
      - reduit      : emprise validee du couloir, paturages, abords des points
                      d'eau accessibles
      - moyen       : partout ailleurs
   Chaque penalite est PONDEREE PAR LA CONFIANCE de l'objet : une detection peu
   fiable pese moins lourd qu'une detection confirmee au sol.
3. Le graphe 8-connexe est construit une seule fois avec networkx ; le plus court
   chemin pondere est obtenu par A* (heuristique admissible = cout minimal de la
   grille x distance a vol d'oiseau).
4. Trois alternatives distinctes : apres chaque trajet, les cellules empruntees
   (et leur voisinage immediat) sont penalisees, ce qui force le calcul suivant a
   chercher un autre passage.

Limites assumees : la grille est une approximation (une cellule de 200 m est plus
large que l'emprise de 100 m du couloir, on tolere donc une cellule d'ecart pour
le bonus "dans l'emprise"), et les couts sont des choix d'ingenierie, pas un
modele calibre.

PERIMETRE DE CALCUL (SPEC section 5, contrainte DURE)
-----------------------------------------------------
La grille est construite sur UNE commune, ou sur DEUX communes ADJACENTES : jamais
sur les 5 departements : a 200 m, la region entiere ferait ~9 millions de cellules
et le calcul serait inutilisable. Une demande entre deux communes non adjacentes
est REFUSEE avec un message explicite (`RouteError`) plutot que calculee.
Pour un couple de communes, la resolution est relachee automatiquement afin que le
nombre de cellules reste borne (`TS_GRID_MAX_CELLS`) : le temps de reponse reste du
meme ordre que pour une commune seule.
"""
from __future__ import annotations

import math
import os
import threading
import time

import networkx as nx
import numpy as np
import shapely
from shapely.geometry import LineString, Point
from shapely.ops import unary_union

import geo
import registry
import store

RES_M = float(os.environ.get("TS_GRID_RES_M", 200))
# Plafond du nombre de cellules d'une grille : au-dela, la resolution est relachee.
# Cale juste au-dessus de la commune de reference (Banikoara : 277 x 284 = 78 668
# cellules), qui garde donc sa maille nominale de 200 m et son trace d'origine ;
# un couple de communes adjacentes passe automatiquement a une maille plus large.
# Mesure : aucun couple adjacent ne depasse 1,5 s, grille et graphe compris.
MAX_CELLS = int(os.environ.get("TS_GRID_MAX_CELLS", 80_000))
# Nombre de grilles / graphes conserves en memoire (un graphe networkx de 80 000
# noeuds est volumineux : on n'en garde que quelques-uns).
CACHE_SIZE = 3

# --- couts de base --------------------------------------------------------
C_BASE = 1.00          # rase campagne, hors couche connue
C_CORRIDOR = 0.35      # emprise du couloir non contestee
C_PASTURE = 0.65       # paturage : praticable et souhaitable
K_WATER = 0.85         # facteur multiplicatif a proximite d'un point d'eau accessible
P_PARCEL = 9.0         # penalite max pour une parcelle cultivee (x confiance)
P_FRICTION = 12.0      # penalite max pour une friction confirmee (x confiance x gravite)
C_FORBIDDEN = 60.0     # zones interdites de fait (village, friction grave confirmee)
C_MAX = 80.0
CONF_BACKGROUND = 0.70  # a priori d'occupation du sol non verifie au sol
CONF_UNCERTAIN = 0.60   # seuil d'incertitude (SPEC : l'incertitude s'affiche)

WATER_RADIUS_M = 800
VILLAGE_CORE_M = 300

_lock = threading.Lock()
_graph_cache: dict = {}
_grid_cache: dict = {}


# ==========================================================================
# Grille
# ==========================================================================
def choose_res(bbox, proj, res: float = RES_M) -> float:
    """Resolution qui garde la grille sous `MAX_CELLS` cellules.

    Contrainte de performance : on ne raffine jamais au point de rendre le calcul
    inutilisable. Une commune seule garde la resolution nominale (200 m).
    """
    w, s, e, n = bbox
    x0, y0 = proj.to_m(w, s)
    x1, y1 = proj.to_m(e, n)
    cells = ((x1 - x0) / res + 1) * ((y1 - y0) / res + 1)
    if cells <= MAX_CELLS:
        return res
    return round(res * math.sqrt(cells / MAX_CELLS) / 50 + 0.5) * 50


class Grid:
    def __init__(self, bbox, proj, res: float = RES_M, cids=()):
        w, s, e, n = bbox
        self.bbox = tuple(bbox)
        self.proj = proj
        self.cids = list(cids)
        self.res = res
        self.xmin, self.ymin = proj.to_m(w, s)
        self.xmax, self.ymax = proj.to_m(e, n)
        self.ncols = int((self.xmax - self.xmin) // res) + 1
        self.nrows = int((self.ymax - self.ymin) // res) + 1
        self.xs = self.xmin + (np.arange(self.ncols) + 0.5) * res
        self.ys = self.ymin + (np.arange(self.nrows) + 0.5) * res
        self.cost = np.full((self.nrows, self.ncols), C_BASE, dtype=np.float32)
        self.conf = np.full((self.nrows, self.ncols), CONF_BACKGROUND, dtype=np.float32)
        self.data_used: list[str] = []

    # -- rasterisation ----------------------------------------------------
    def _window(self, geom, pad: float = 0.0):
        minx, miny, maxx, maxy = geom.bounds
        c0 = max(0, int((minx - pad - self.xmin) // self.res))
        c1 = min(self.ncols - 1, int((maxx + pad - self.xmin) // self.res))
        r0 = max(0, int((miny - pad - self.ymin) // self.res))
        r1 = min(self.nrows - 1, int((maxy + pad - self.ymin) // self.res))
        if c1 < c0 or r1 < r0:
            return None
        return r0, r1, c0, c1

    def mask(self, geom, pad: float = 0.0):
        """Masque booleen (sous-fenetre) des cellules dont le centre est dans geom."""
        win = self._window(geom, pad)
        if win is None:
            return None, None
        r0, r1, c0, c1 = win
        gx, gy = np.meshgrid(self.xs[c0:c1 + 1], self.ys[r0:r1 + 1])
        if pad:
            m = shapely.dwithin(geom, shapely.points(gx.ravel(), gy.ravel()), pad)
        else:
            m = shapely.contains_xy(geom, gx.ravel(), gy.ravel())
        return win, m.reshape(gx.shape)

    def apply_set(self, geom, value: float, conf: float | None = None, pad: float = 0.0):
        win, m = self.mask(geom, pad)
        if win is None or not m.any():
            return 0
        r0, r1, c0, c1 = win
        sub = self.cost[r0:r1 + 1, c0:c1 + 1]
        sub[m] = value
        if conf is not None:
            sc = self.conf[r0:r1 + 1, c0:c1 + 1]
            sc[m] = np.minimum(sc[m], conf)
        return int(m.sum())

    def apply_add(self, geom, value: float, conf: float | None = None, pad: float = 0.0):
        win, m = self.mask(geom, pad)
        if win is None or not m.any():
            return 0
        r0, r1, c0, c1 = win
        sub = self.cost[r0:r1 + 1, c0:c1 + 1]
        sub[m] = np.minimum(sub[m] + value, C_MAX)
        if conf is not None:
            sc = self.conf[r0:r1 + 1, c0:c1 + 1]
            sc[m] = np.minimum(sc[m], conf)
        return int(m.sum())

    def apply_mul(self, geom, factor: float, pad: float = 0.0):
        win, m = self.mask(geom, pad)
        if win is None or not m.any():
            return 0
        r0, r1, c0, c1 = win
        sub = self.cost[r0:r1 + 1, c0:c1 + 1]
        sub[m] = sub[m] * factor
        return int(m.sum())

    # -- indices ----------------------------------------------------------
    def node_of(self, lon: float, lat: float) -> int:
        x, y = self.proj.to_m(lon, lat)
        c = int(round((x - self.xmin - self.res / 2) / self.res))
        r = int(round((y - self.ymin - self.res / 2) / self.res))
        c = min(max(c, 0), self.ncols - 1)
        r = min(max(r, 0), self.nrows - 1)
        return r * self.ncols + c

    def xy_of(self, node: int):
        r, c = divmod(node, self.ncols)
        return float(self.xs[c]), float(self.ys[r])


# ==========================================================================
# Construction de la surface de cout
# ==========================================================================
def layers_of(cids, kind: str) -> list:
    """Couche `kind` de toutes les communes du perimetre de calcul."""
    out = []
    for cid in cids:
        out.extend(store.layer(kind, cid)["features"])
    return out


def build_grid(cids) -> Grid:
    """Surface de cout sur une commune, ou sur deux communes adjacentes."""
    cids = list(cids)
    proj = registry.proj_of(cids)
    bbox = registry.union_bbox(cids)
    g = Grid(bbox, proj, choose_res(bbox, proj), cids)
    used = []

    # --- emprise du couloir (bonus), tolerance d'une demi-cellule ---------
    for cid in cids:
        cor = store.corridor(cid)
        axis_ll = _feat(cor, "axis")
        emprise_ll = _feat(cor, "emprise")
        axis_m = proj.geom_to_m(geo.geom_of(axis_ll))
        tol = max(emprise_ll["properties"]["width_m"] / 2, g.res * 0.75)
        g.apply_set(axis_m.buffer(tol), C_CORRIDOR, conf=0.70)
    used.append("emprise du couloir reconstituee (non officielle)")

    # --- paturages -------------------------------------------------------
    for f in layers_of(cids, "pastures"):
        p = f["properties"]
        g.apply_set(proj.geom_to_m(geo.geom_of(f)), C_PASTURE, conf=p.get("confidence"))
    used.append("zones de paturage")

    # --- points d'eau accessibles (bonus de proximite) -------------------
    acc = [f for f in layers_of(cids, "water_points")
           if f["properties"].get("accessible")]
    for f in acc:
        g.apply_mul(proj.geom_to_m(geo.geom_of(f)), K_WATER, pad=WATER_RADIUS_M)
    used.append(f"points d'eau accessibles ({len(acc)})")

    # --- parcelles cultivees (penalite ponderee par la confiance) --------
    parcels = layers_of(cids, "parcels")
    for f in parcels:
        p = f["properties"]
        if not p.get("cultivated", True):
            continue
        c = float(p.get("confidence", 0.6))
        g.apply_add(proj.geom_to_m(geo.geom_of(f)), P_PARCEL * c, conf=c)
    used.append(f"parcelles cultivees detectees ({len(parcels)}, Sentinel-1/2, synthetiques)")

    # --- zones de friction ------------------------------------------------
    fr = []
    for cid in cids:
        fr.extend(store.friction(cid=cid)["features"])
    n_conf = 0
    for f in fr:
        p = f["properties"]
        c = float(p.get("confidence", 0.6))
        sev = int(p.get("severity", 3))
        status = p.get("status", "pending")
        gm = proj.geom_to_m(geo.geom_of(f))
        if status == "invalidated":
            continue                      # invalidee sur le terrain : aucune penalite
        if status == "confirmed":
            n_conf += 1
            if sev >= 4:
                g.apply_set(gm, C_FORBIDDEN, conf=c)   # interdit de fait
                continue
            w = 1.0
        elif status == "corrected":
            w = 0.6
        else:
            w = 0.5                        # detection non verifiee : on pondere a la baisse
        g.apply_add(gm, P_FRICTION * w * c * (sev / 5.0), conf=c)
    used.append(f"zones de friction ({len(fr)} dont {n_conf} confirmees terrain)")

    # --- villages : on ne traverse pas l'habitat -------------------------
    vill = layers_of(cids, "villages")
    for f in vill:
        g.apply_set(proj.geom_to_m(geo.geom_of(f)).buffer(VILLAGE_CORE_M),
                    C_FORBIDDEN, conf=None)
    used.append(f"villages ({len(vill)}, zones d'habitat evitees)")

    np.clip(g.cost, 0.05, C_MAX, out=g.cost)
    g.data_used = used
    return g


def _feat(fc: dict, kind: str) -> dict:
    """Feature d'un couloir par son role (`axis` / `emprise`)."""
    for f in fc["features"]:
        if f["properties"].get("kind") == kind:
            return f
    want = "LineString" if kind == "axis" else "Polygon"   # anciens fichiers
    return next(f for f in fc["features"] if f["geometry"]["type"] == want)


def get_grid(cids) -> Grid:
    """Grille en cache, reconstruite quand une validation terrain change les statuts.

    Le cache est indexe par PERIMETRE : passer d'une commune a l'autre ne jette pas
    la grille de la precedente (au plus `CACHE_SIZE` conservees).
    """
    key = (tuple(cids), store.DATA_VERSION["v"])
    with _lock:
        hit = _grid_cache.get(key)
        if hit is None:
            t0 = time.perf_counter()
            hit = {"grid": build_grid(cids)}
            hit["build_ms"] = round((time.perf_counter() - t0) * 1000, 1)
            _grid_cache[key] = hit
            _trim(_grid_cache)
        _grid_cache["last"] = hit
        return hit["grid"]


def _trim(cache: dict):
    """Garde les `CACHE_SIZE` dernieres entrees (hors marqueur `last`)."""
    keys = [k for k in cache if k != "last"]
    while len(keys) > CACHE_SIZE:
        cache.pop(keys.pop(0), None)


def get_graph(g: Grid) -> nx.Graph:
    """Graphe 8-connexe (topologie fixe : ne depend que des dimensions)."""
    with _lock:
        key = (g.nrows, g.ncols)
        if key not in _graph_cache:
            t0 = time.perf_counter()
            idx = np.arange(g.nrows * g.ncols, dtype=np.int64).reshape(g.nrows, g.ncols)
            edges = []
            for dr, dc in ((0, 1), (1, 0), (1, 1), (1, -1)):
                a = idx[max(0, -dr):g.nrows - max(0, dr),
                        max(0, -dc):g.ncols - max(0, dc)]
                b = idx[max(0, dr):g.nrows + min(0, dr),
                        max(0, dc):g.ncols + min(0, dc)]
                edges.append(np.stack([a.ravel(), b.ravel()], axis=1))
            E = np.concatenate(edges, axis=0)
            G = nx.Graph()
            G.add_nodes_from(range(g.nrows * g.ncols))
            G.add_edges_from(map(tuple, E.tolist()))
            _graph_cache[key] = G
            _graph_cache["build_ms"] = round((time.perf_counter() - t0) * 1000, 1)
            _trim(_graph_cache)
        return _graph_cache[key]


def warmup(cids=None):
    """Prechauffe le perimetre de la commune de reference (celui de la demo)."""
    cids = list(cids) if cids else [store.reference()]
    g = get_grid(cids)
    get_graph(g)
    return {"commune": cids, "grid": f"{g.nrows}x{g.ncols} @ {g.res:.0f} m",
            "grid_build_ms": _grid_cache.get("last", {}).get("build_ms"),
            "graph_build_ms": _graph_cache.get("build_ms")}


# ==========================================================================
# Plus court chemin + alternatives
# ==========================================================================
class RouteError(ValueError):
    pass


def resolve_scope(commune: str | None, src_lonlat, dst_lonlat) -> list:
    """Perimetre de calcul : une commune, ou deux communes ADJACENTES.

    C'est ici que s'applique la contrainte dure de la SPEC section 5 : on refuse
    explicitement, et vite, ce qui reviendrait a mailler la moitie du pays.
    """
    if commune not in (None, ""):
        resolved = registry.resolve_alias(commune)
        if resolved is None:
            raise RouteError(
                f"commune inconnue : '{commune}' ; la liste des {len(registry.ids())} "
                f"communes couvertes est servie par GET /api/communes")
        commune = resolved
    ends = {}
    for name, (lon, lat) in (("from", src_lonlat), ("to", dst_lonlat)):
        cid = registry.commune_for_point(lon, lat, prefer=commune or None)
        if cid is None:
            w, s, e, n = registry.region_bbox()
            hint = ""
            if commune:
                bw, bs, be, bn = registry.bbox(commune)
                hint = (f" ; emprise de {registry.name(commune)} : "
                        f"{bw},{bs},{be},{bn}")
            raise RouteError(
                f"parametre '{name}' ({lon},{lat}) hors de la zone couverte "
                f"(5 departements / 33 communes, bbox {w},{s},{e},{n}){hint}")
        ends[name] = cid
    a, b = ends["from"], ends["to"]
    if a == b:
        return [a]
    if not registry.adjacent(a, b):
        raise RouteError(
            f"itineraire refuse : {registry.name(a)} ({a}) et {registry.name(b)} ({b}) "
            f"ne sont pas des communes adjacentes. Le calcul d'itineraire reste "
            f"intra-commune ou entre deux communes voisines (SPEC section 5) : "
            f"mailler tout le nord et le centre du Benin d'un coup serait "
            f"inutilisable. Voisines de {registry.name(a)} : "
            f"{', '.join(registry.neighbours(a)) or 'aucune'}.")
    return sorted([a, b])


def compute_routes(src_lonlat, dst_lonlat, n_alt: int = 3, commune: str | None = None) -> dict:
    t0 = time.perf_counter()
    cids = resolve_scope(commune, src_lonlat, dst_lonlat)

    g = get_grid(cids)
    G = get_graph(g)
    src = g.node_of(*src_lonlat)
    dst = g.node_of(*dst_lonlat)
    if src == dst:
        raise RouteError("'from' et 'to' tombent dans la meme cellule de la grille")

    cost_flat = g.cost.ravel()
    pen = np.zeros_like(cost_flat)
    ncols = g.ncols
    res = g.res
    diag = res * math.sqrt(2)
    cmin = float(cost_flat.min())

    def step_len(u, v):
        d = abs(u - v)
        return res if (d == 1 or d == ncols) else diag

    def weight(u, v, _d):
        # la penalite de diversification est MULTIPLICATIVE : elle renrenchit une
        # cellule deja empruntee sans jamais la rendre infranchissable, ce qui
        # produit des variantes locales plutot qu'un trajet totalement different.
        return (cost_flat[u] * (1.0 + pen[u])
                + cost_flat[v] * (1.0 + pen[v])) * 0.5 * step_len(u, v)

    dst_x, dst_y = g.xy_of(dst)

    def h(u, _v=None):
        x, y = g.xy_of(u)
        return cmin * math.hypot(x - dst_x, y - dst_y)

    # Trois strategies, qui correspondent aux trois decisions possibles du comite
    # (maintien / ajustement / contournement) :
    #   0. trace de moindre cout
    #   1. ajustement local : on renrenchit fortement UNIQUEMENT les cellules
    #      contraintes du trace precedent -> le calcul contourne les points durs
    #      mais reste sur le couloir partout ailleurs
    #   2. contournement : on renrenchit tout le trace precedent -> variante
    #      franchement distincte
    alternatives = []
    for k in range(n_alt):
        try:
            path = nx.astar_path(G, src, dst, heuristic=h, weight=weight)
        except nx.NetworkXNoPath:
            break
        alternatives.append(_describe(g, path, k))
        if k == 0 and _has_costly(g, path):
            _penalise(g, pen, path, factor=9.0, only_costly=True)
        else:
            _penalise(g, pen, path, factor=0.5 + 1.0 * k, radius=1 + k)

    elapsed = round((time.perf_counter() - t0) * 1000, 1)
    return {
        "from": list(src_lonlat),
        "to": list(dst_lonlat),
        "communes": cids,
        "commune": cids[0] if len(cids) == 1 else None,
        "scope": ("intra-commune" if len(cids) == 1 else "inter-communes adjacentes"),
        "alternatives": alternatives,
        "computed_in_ms": elapsed,
        "grid": {"resolution_m": res, "rows": g.nrows, "cols": g.ncols,
                 "nodes": g.nrows * g.ncols, "edges": G.number_of_edges()},
        "synthetic": True,
        "official": False,
        "disclaimer": ("Itineraire calcule sur des donnees geographiques generees "
                       "et une emprise de couloir reconstituee, sans valeur officielle."),
    }


def _has_costly(g: Grid, path) -> bool:
    n = np.array(path, dtype=np.int64)
    return bool((g.cost.ravel()[n] > 1.2 * C_BASE).any())


def _penalise(g: Grid, pen: np.ndarray, path, factor: float, only_costly: bool = False,
              radius: int = 1):
    """Penalise les cellules empruntees (et leur voisinage) pour diversifier.

    only_costly=True : on ne penalise que les cellules contraintes du trace
    (parcelle, friction, interdit), ce qui produit un AJUSTEMENT local.
    """
    nodes = np.array(path, dtype=np.int64)
    if only_costly:
        nodes = nodes[g.cost.ravel()[nodes] > 1.2 * C_BASE]
    if nodes.size == 0:
        return
    rows, cols = np.divmod(nodes, g.ncols)
    # une passe = au plus `factor` par cellule (sinon les cellules voisines de
    # plusieurs points du trace cumuleraient jusqu'a 9 x factor), mais les passes
    # successives, elles, se cumulent.
    add = np.zeros_like(pen)
    rng = range(-radius, radius + 1)
    for dr in rng:
        for dc in rng:
            rr = np.clip(rows + dr, 0, g.nrows - 1)
            cc = np.clip(cols + dc, 0, g.ncols - 1)
            add[rr * g.ncols + cc] = factor
    pen += add


# ==========================================================================
# Description d'un itineraire
# ==========================================================================
def _describe(g: Grid, path, k: int) -> dict:
    cost_flat = g.cost.ravel()
    conf_flat = g.conf.ravel()

    # cout reel (sans la penalite de diversification)
    total_cost = 0.0
    for u, v in zip(path, path[1:]):
        d = abs(u - v)
        step = g.res if (d == 1 or d == g.ncols) else g.res * math.sqrt(2)
        total_cost += (cost_flat[u] + cost_flat[v]) * 0.5 * step

    # simplification : on garde les changements de direction + un point tous les ~400 m
    keep = _simplify_indices(path, g.ncols, every=max(1, int(round(400 / g.res))))
    nodes = [path[i] for i in keep]
    pts_m = [g.xy_of(n) for n in nodes]
    line_m = LineString(pts_m)
    line_ll = geo.round_geom(g.proj.geom_to_ll(line_m), 6)

    # segments incertains : confiance des donnees sous-jacentes < 0.6
    flags = [bool(conf_flat[n] < CONF_UNCERTAIN) for n in nodes]
    uncertain = []
    i = 0
    while i < len(flags):
        if flags[i]:
            j = i
            while j + 1 < len(flags) and flags[j + 1]:
                j += 1
            uncertain.append([i, min(j + 1, len(flags) - 1)])
            i = j + 1
        else:
            i += 1

    constraints, data_used = _constraints(g, line_m, nodes)

    return {
        "id": ["ALT-A", "ALT-B", "ALT-C", "ALT-D"][k] if k < 4 else f"ALT-{k}",
        "label": ["Trace de moindre cout",
                  "Ajustement local (evite les portions contraintes)",
                  "Contournement (s'ecarte de l'emprise)",
                  "Variante supplementaire"][min(k, 3)],
        "geometry": shapely.geometry.mapping(line_ll),
        "distance_km": round(line_m.length / 1000, 2),
        "cost": round(float(total_cost) / 1000, 1),
        "constraints": constraints,
        "uncertain_segments": uncertain,
        "data_used": data_used,
        "mean_confidence": round(float(np.mean([conf_flat[n] for n in nodes])), 2),
        "recommended": k == 0,
    }


def _simplify_indices(path, ncols, every=2):
    keep = [0]
    prev_dir = None
    for i in range(1, len(path) - 1):
        d = path[i + 1] - path[i]
        if d != prev_dir or (i - keep[-1]) >= every:
            keep.append(i)
            prev_dir = d
    keep.append(len(path) - 1)
    return keep


def _fr(x: float, nd: int = 1) -> str:
    return f"{x:.{nd}f}".replace(".", ",")


def _constraints(g: Grid, line_m: LineString, nodes) -> tuple[list, list]:
    cons, used = [], []
    cids = g.cids or [store.reference()]
    P = g.proj
    buf = line_m.buffer(g.res / 2)
    total_km = line_m.length / 1000

    # couloir (une ou deux communes : on raisonne sur l'union)
    emprises, axes = [], []
    for cid in cids:
        cor = store.corridor(cid)
        emprises.append(P.geom_to_m(geo.geom_of(_feat(cor, "emprise"))))
        axes.append(P.geom_to_m(geo.geom_of(_feat(cor, "axis"))))
    emprise = unary_union(emprises)
    axis = unary_union(axes)
    inside_km = line_m.intersection(emprise.buffer(g.res * 0.75)).length / 1000
    share = inside_km / total_km if total_km else 0
    max_dev = max(Point(p).distance(axis) for p in line_m.coords)
    if share >= 0.95:
        cons.append("reste dans l'emprise validee du couloir sur la quasi-totalite du trajet")
    else:
        cons.append(f"suit l'emprise validee du couloir sur {_fr(share * 100, 0)} % du trajet")
    if max_dev > 400:
        cons.append(f"s'ecarte de {_fr(max_dev / 1000, 1)} km du couloir valide")
    used.append("emprise du couloir reconstituee (non officielle)")

    # parcelles
    crossed, grazed = [], []
    for f in layers_of(cids, "parcels"):
        gm = P.geom_to_m(geo.geom_of(f))
        if gm.intersects(line_m):
            crossed.append((f, gm))
        elif gm.intersects(buf):
            grazed.append((f, gm))
    if crossed:
        ha = sum(line_m.intersection(gm).length / 1000 * 0 + f["properties"]["area_ha"]
                 for f, gm in crossed)
        cons.append(f"traverse {len(crossed)} parcelle{'s' if len(crossed) > 1 else ''} "
                    f"cultivee{'s' if len(crossed) > 1 else ''} ({_fr(ha, 1)} ha)")
    else:
        cons.append("ne traverse aucune parcelle cultivee detectee")
    if grazed:
        cons.append(f"frole {len(grazed)} parcelle{'s' if len(grazed) > 1 else ''} cultivee"
                    f"{'s' if len(grazed) > 1 else ''} a moins de {g.res / 2:.0f} m")
    low = sum(1 for f, _ in crossed + grazed
              if f["properties"]["confidence"] < CONF_UNCERTAIN)
    if low:
        cons.append(f"dont {low} parcelle{'s' if low > 1 else ''} de confiance faible "
                    f"(< {_fr(CONF_UNCERTAIN, 1)}) : a verifier au sol")
    if crossed or grazed:
        used.append("parcelles detectees (Sentinel-2 / Sentinel-1, synthetiques)")

    # frictions
    frs = []
    for cid in cids:
        frs.extend(f for f in store.friction(cid=cid)["features"]
                   if f["properties"]["status"] != "invalidated"
                   and P.geom_to_m(geo.geom_of(f)).intersects(buf))
    if frs:
        conf_n = sum(1 for f in frs if f["properties"]["status"] == "confirmed")
        sev = max(f["properties"]["severity"] for f in frs)
        cons.append(f"passe au contact de {len(frs)} zone{'s' if len(frs) > 1 else ''} "
                    f"de friction (dont {conf_n} confirmee{'s' if conf_n > 1 else ''} "
                    f"au sol, gravite max {sev}/5)")
        used.append("zones de friction validees terrain")

    # villages
    vil = [f for f in layers_of(cids, "villages")
           if P.geom_to_m(geo.geom_of(f)).distance(line_m) < 1000]
    if vil:
        names = ", ".join(f["properties"]["name"] for f in vil[:3])
        cons.append(f"longe {len(vil)} village{'s' if len(vil) > 1 else ''} a moins de 1 km "
                    f"({names}{' ...' if len(vil) > 3 else ''})")
        used.append("villages (OpenStreetMap, positions synthetiques)")

    # points d'eau
    water = [f for f in layers_of(cids, "water_points")
             if f["properties"]["accessible"]
             and P.geom_to_m(geo.geom_of(f)).distance(line_m) < 1500]
    if water:
        seas = sum(1 for f in water if f["properties"]["seasonal"])
        txt = (f"dessert {len(water)} point{'s' if len(water) > 1 else ''} d'eau accessible"
               f"{'s' if len(water) > 1 else ''} a moins de 1,5 km")
        if seas:
            txt += f" (dont {seas} saisonnier{'s' if seas > 1 else ''})"
        cons.append(txt)
        used.append("points d'eau (accessibilite declaree)")

    # paturages
    past = [f for f in layers_of(cids, "pastures")
            if P.geom_to_m(geo.geom_of(f)).intersects(buf)]
    if past:
        cons.append(f"traverse {len(past)} zone{'s' if len(past) > 1 else ''} de paturage")
        used.append("zones de paturage")

    used.append("grille de cout Terra Sentinelle "
                f"({g.res:.0f} m, ponderee par la confiance de chaque objet, "
                f"perimetre : {', '.join(registry.name(c) for c in cids)})")
    return cons, list(dict.fromkeys(used))
