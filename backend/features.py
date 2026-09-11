"""
Terra Sentinelle : extraction de caracteristiques spectrales et de texture.

SPEC section 10. Ce module est PARTAGE par l'entrainement (`train_model.py`) et
par l'inference sur le Benin (`predict.py`) : c'est la seule facon de garantir
que le vecteur presente au modele en production est calcule exactement comme
celui vu a l'entrainement. Toute modification ici invalide le modele serialise
(la carte de modele porte FEATURE_VERSION, verifiee au chargement).

ENTREE : une vignette RGB 64x64 (uint8).
  * a l'entrainement : une image EuroSAT (Sentinel-2, 10 m/px, 64x64 = 640 m)
  * a l'inference    : une decoupe 64x64 d'une tuile EOX s2cloudless au zoom 14
                       (~9,4 m/px sous la latitude du Benin) -> meme emprise au
                       sol et meme resolution que EuroSAT. Le choix du zoom 14
                       n'est pas cosmetique : c'est ce qui rend les deux jeux
                       comparables. Il reste un ecart de domaine (rendu, gamme
                       dynamique, saison, geographie) documente dans la carte.

POURQUOI CES CARACTERISTIQUES (pas de deep learning : pas de GPU, et la
pertinence prime sur la complexite inutile : SPEC section 10)

1. Statistiques par canal (moyenne, ecart-type, deciles 10/50/90) : 15 valeurs.
   Le niveau brut separe deja beaucoup : l'eau est sombre, le bati est clair et
   gris, la vegetation dense est sombre dans le rouge.

2. Chromaticite normalisee r,g,b = canal / somme : 3 valeurs.
   Invariante a l'intensite globale : c'est la premiere defense contre l'ecart
   de domaine (une tuile EOX plus lumineuse qu'une tuile EuroSAT garde la meme
   chromaticite). Meme raison pour les deux indices suivants.

3. ExG = 2G - R - B (Excess Green, Woebbecke 1995) : indice de verdure
   calculable SANS proche infrarouge. On ne dispose ici que du visible : le NDVI
   est hors de portee, ExG en est le substitut classique en teledetection
   agricole a bas cout. Moyenne, ecart-type, deciles 10/90.

4. GRVI = (G - R) / (G + R) (Green-Red Vegetation Index, Tucker 1979) : ratio
   borne [-1,1], robuste a l'eclairement. Moyenne, ecart-type, deciles 10/90.

5. Texture : c'est la ou se joue la distinction la plus utile au projet.
   Une parcelle cultivee est SPATIALEMENT HOMOGENE et bordee de limites nettes ;
   une foret, une savane arboree ou un tissu urbain sont heterogenes a petite
   echelle. On mesure :
     * la magnitude du gradient (moyenne, ecart-type, decile 90) : densite de
       contours ;
     * l'ecart-type local en blocs 8x8 (moyenne, ecart-type) : heterogeneite
       intra-parcelle ;
     * l'entropie de l'histogramme des niveaux de gris (32 classes) : desordre
       radiometrique ;
     * l'anisotropie |grad_x| - |grad_y| : les parcelles cultivees portent des
       structures orientees (sillons, limites rectilignes).

LIMITE ASSUMEE : ces caracteristiques sont globales a la vignette (pas de
convolution apprise). Elles suffisent a une tache binaire cultive / non cultive
et restent lisibles : un jury peut verifier ce que le modele regarde.
"""
from __future__ import annotations

import numpy as np

# Toute modification du vecteur de caracteristiques doit incrementer cette
# version : `predict.py` refuse un modele dont la version ne correspond pas.
FEATURE_VERSION = "feat-1.0"
TILE_PX = 64            # cote de la vignette attendue
BLOCK = 8               # cote des blocs de texture (8x8 blocs de 8x8 px)
EPS = 1e-6

_CHANNELS = ("r", "g", "b")
_STATS = ("mean", "std", "p10", "p50", "p90")


def _names() -> list[str]:
    n: list[str] = []
    for c in _CHANNELS:
        n += [f"{c}_{s}" for s in _STATS]
    n += [f"chroma_{c}_mean" for c in _CHANNELS]
    n += ["exg_mean", "exg_std", "exg_p10", "exg_p90"]
    n += ["grvi_mean", "grvi_std", "grvi_p10", "grvi_p90"]
    n += ["gray_mean", "gray_std"]
    n += ["grad_mean", "grad_std", "grad_p90", "grad_aniso"]
    n += ["blockstd_mean", "blockstd_std"]
    n += ["entropy"]
    return n


FEATURE_NAMES: list[str] = _names()
N_FEATURES = len(FEATURE_NAMES)


def _stats(v: np.ndarray) -> list[float]:
    p10, p50, p90 = np.percentile(v, (10, 50, 90))
    return [float(v.mean()), float(v.std()), float(p10), float(p50), float(p90)]


def features(arr: np.ndarray) -> np.ndarray:
    """Vecteur de caracteristiques d'une vignette RGB 64x64 uint8.

    Retourne un tableau float32 de longueur N_FEATURES, dans l'ordre de
    FEATURE_NAMES. Aucune normalisation globale n'est appliquee : le modele
    retenu (arbres de decision boostes) est invariant aux changements d'echelle
    monotones par caracteristique, ce qui est un atout de plus face a l'ecart
    de domaine Europe -> Benin.
    """
    a = np.asarray(arr, dtype=np.float32)
    if a.ndim != 3 or a.shape[2] < 3:
        raise ValueError(f"vignette RGB attendue (H,W,3), recu {a.shape}")
    a = a[:, :, :3]
    if a.shape[0] != TILE_PX or a.shape[1] != TILE_PX:
        raise ValueError(
            f"vignette {TILE_PX}x{TILE_PX} attendue, recu {a.shape[0]}x{a.shape[1]} ; "
            f"redimensionnez en amont (voir predict.py)")

    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    out: list[float] = []

    # 1. statistiques par canal
    for ch in (r, g, b):
        out += _stats(ch)

    # 2. chromaticite normalisee
    tot = r + g + b + EPS
    out += [float((r / tot).mean()), float((g / tot).mean()), float((b / tot).mean())]

    # 3. ExG = 2G - R - B
    exg = 2.0 * g - r - b
    p10, p90 = np.percentile(exg, (10, 90))
    out += [float(exg.mean()), float(exg.std()), float(p10), float(p90)]

    # 4. GRVI = (G - R) / (G + R)
    grvi = (g - r) / (g + r + EPS)
    p10, p90 = np.percentile(grvi, (10, 90))
    out += [float(grvi.mean()), float(grvi.std()), float(p10), float(p90)]

    # 5. texture, sur le niveau de gris perceptuel
    gray = 0.299 * r + 0.587 * g + 0.114 * b
    out += [float(gray.mean()), float(gray.std())]

    gx = np.abs(np.diff(gray, axis=1))          # contours verticaux
    gy = np.abs(np.diff(gray, axis=0))          # contours horizontaux
    grad = np.hypot(gx[:-1, :], gy[:, :-1])
    out += [float(grad.mean()), float(grad.std()), float(np.percentile(grad, 90)),
            float(gx.mean() - gy.mean())]

    nb = TILE_PX // BLOCK
    blocks = gray.reshape(nb, BLOCK, nb, BLOCK).transpose(0, 2, 1, 3).reshape(nb * nb, -1)
    bstd = blocks.std(axis=1)
    out += [float(bstd.mean()), float(bstd.std())]

    hist, _ = np.histogram(gray, bins=32, range=(0.0, 255.0))
    p = hist.astype(np.float64) / max(hist.sum(), 1)
    nz = p[p > 0]
    out += [float(-(nz * np.log2(nz)).sum())]

    vec = np.asarray(out, dtype=np.float32)
    if vec.shape[0] != N_FEATURES:      # garde-fou : noms et calcul desynchronises
        raise AssertionError(f"{vec.shape[0]} caracteristiques calculees, "
                             f"{N_FEATURES} attendues")
    return vec
