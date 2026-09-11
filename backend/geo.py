"""
Terra Sentinelle : helpers geometriques.

Toutes les donnees publiques sont en EPSG:4326 (lon/lat).
Pour les calculs metriques (buffers, aires, distances, grille de cout) on passe par
une projection locale equirectangulaire : l'erreur est inferieure a 0,2 % sur
l'emprise d'une commune, largement suffisante pour un prototype de hackathon, et
cela evite une dependance a pyproj.

La couverture est passee d'une commune (Banikoara) a 5 departements / 33 communes
(SPEC section 5). On NE projette JAMAIS les 5 departements d'un coup : chaque
calcul metrique se fait dans une projection LOCALE, centree sur la commune (ou sur
le couple de communes adjacentes) traitee -> `Proj`. Les fonctions de module
(`to_m`, `geom_to_m`, ...) restent centrees sur Banikoara : elles servent la
compatibilite et la commune de reference.
"""
from __future__ import annotations

from math import cos, radians

from shapely.geometry import mapping, shape
from shapely.ops import transform

# --- Zone de demonstration (SPEC section 5) ---------------------------------
COMMUNE_ID = "BJ-AL-BANIKOARA"
COMMUNE_NAME = "Banikoara"
DEPARTMENT = "Alibori"
CENTER = (2.438, 11.298)          # lon, lat
BBOX = (2.20, 11.05, 2.72, 11.55)  # w, s, e, n

LON0, LAT0 = CENTER
M_PER_DEG_LAT = 110574.0
M_PER_DEG_LON = 111320.0 * cos(radians(LAT0))


class Proj:
    """Projection equirectangulaire locale, centree sur un point donne.

    Deux instances de meme centre donnent exactement les memes nombres : la
    projection de Banikoara (`DEFAULT`) reproduit au bit pres l'ancien calcul
    global, ce qui garantit la non-regression du jeu de demonstration.
    """

    __slots__ = ("lon0", "lat0", "mx", "my")

    def __init__(self, lon0: float, lat0: float):
        self.lon0 = float(lon0)
        self.lat0 = float(lat0)
        self.mx = 111320.0 * cos(radians(self.lat0))
        self.my = M_PER_DEG_LAT

    def __repr__(self):                                    # pragma: no cover
        return f"Proj({self.lon0:.4f}, {self.lat0:.4f})"

    def to_m(self, lon: float, lat: float):
        return ((lon - self.lon0) * self.mx, (lat - self.lat0) * self.my)

    def to_ll(self, x: float, y: float):
        return (x / self.mx + self.lon0, y / self.my + self.lat0)

    def geom_to_m(self, geom):
        return transform(lambda xs, ys, z=None: _zip(self.to_m, xs, ys), geom)

    def geom_to_ll(self, geom):
        return transform(lambda xs, ys, z=None: _zip(self.to_ll, xs, ys), geom)

    def area_ha(self, geom_ll) -> float:
        return self.geom_to_m(geom_ll).area / 10_000.0

    def length_km(self, geom_ll) -> float:
        return self.geom_to_m(geom_ll).length / 1000.0


def proj_for(center) -> Proj:
    """Projection locale centree sur [lon, lat] (centre d'une commune)."""
    return Proj(center[0], center[1])


def proj_for_many(centers) -> Proj:
    """Projection locale centree sur le barycentre de plusieurs centres.

    Utilisee pour un itineraire entre deux communes adjacentes : le centre commun
    borne l'erreur de projection des deux cotes.
    """
    centers = list(centers)
    if len(centers) == 1:
        return proj_for(centers[0])
    return Proj(sum(c[0] for c in centers) / len(centers),
                sum(c[1] for c in centers) / len(centers))


DEFAULT = Proj(LON0, LAT0)       # projection de la commune de reference (Banikoara)


def to_m(lon: float, lat: float):
    """lon/lat -> metres locaux (x est vers l'est, y vers le nord)."""
    return DEFAULT.to_m(lon, lat)


def to_ll(x: float, y: float):
    """metres locaux -> lon/lat."""
    return DEFAULT.to_ll(x, y)


def geom_to_m(geom):
    return DEFAULT.geom_to_m(geom)


def geom_to_ll(geom):
    return DEFAULT.geom_to_ll(geom)


def _zip(fn, xs, ys):
    out = [fn(a, b) for a, b in zip(xs, ys)]
    return ([p[0] for p in out], [p[1] for p in out])


def round_geom(geom, ndigits: int = 6):
    """Arrondit les coordonnees (6 decimales ~ 11 cm) pour alleger le GeoJSON."""
    return transform(
        lambda xs, ys, z=None: ([round(x, ndigits) for x in xs], [round(y, ndigits) for y in ys]),
        geom,
    )


def feature(geom, props: dict, ndigits: int = 6) -> dict:
    return {"type": "Feature", "geometry": mapping(round_geom(geom, ndigits)), "properties": props}


def fc(features, **foreign) -> dict:
    out = {"type": "FeatureCollection", "features": list(features)}
    out.update(foreign)
    return out


def geom_of(feat) -> object:
    return shape(feat["geometry"])


def area_ha(geom_ll) -> float:
    """Aire en hectares d'une geometrie lon/lat (projection Banikoara)."""
    return DEFAULT.area_ha(geom_ll)


def length_km(geom_ll) -> float:
    """Longueur en km d'une geometrie lon/lat (projection Banikoara)."""
    return DEFAULT.length_km(geom_ll)
