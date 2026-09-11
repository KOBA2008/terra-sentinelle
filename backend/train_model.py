#!/usr/bin/env python
"""
Terra Sentinelle : entrainement REEL du classifieur d'occupation du sol.
SPEC section 10. Lancer :  ./.venv/bin/python train_model.py

CE QUI EST FAIT ICI
  1. Telechargement (et mise en cache) d'EuroSAT RGB : 27 000 vignettes
     Sentinel-2 REELLES, etiquetees, 64x64, 10 classes.
     Source : https://zenodo.org/records/7711810/files/EuroSAT_RGB.zip
  2. Extraction des caracteristiques de `features.py` (visible : statistiques
     par canal, ExG, GRVI, texture). Le cache .npz evite de tout recalculer.
  3. Split train/test STRATIFIE sur les 10 classes, graine fixee (SEED),
     jeu de test REELLEMENT tenu a l'ecart : il ne sert qu'a la mesure finale,
     ni a la selection, ni a l'ajustement, ni au calibrage.
  4. Deux modeles HistGradientBoostingClassifier entraines sur le MEME split :
     - binaire      : cultive (AnnualCrop, PermanentCrop) vs non cultive
     - multi-classe : les 10 classes EuroSAT (plus parlant en demonstration)
     Pas de deep learning : pas de GPU ici, et la pertinence prime sur la
     complexite inutile (critere du jury, SPEC section 10).
  5. Serialisation dans data/model/ + carte de modele JSON avec les metriques
     REELLEMENT mesurees sur le jeu de test.

HONNETETE (SPEC sections 9 et 10)
  Les metriques produites ici valent pour l'EUROPE (EuroSAT est europeen).
  Elles ne disent RIEN de la performance au Benin. Toute sortie du modele sur
  le Benin est une prediction NON VALIDEE LOCALEMENT, a verifier par l'agent
  communal. Ce script n'ecrit jamais un chiffre qu'il n'a pas mesure : si
  l'entrainement echoue, il s'arrete en erreur et n'ecrit aucune carte.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import sys
import time
import urllib.request
import zipfile
from datetime import datetime, timezone

import numpy as np

import features

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
DATASETS = os.path.join(DATA, "datasets")
MODEL_DIR = os.path.join(DATA, "model")
ZIP_PATH = os.path.join(DATASETS, "EuroSAT_RGB.zip")
EXTRACT_DIR = os.path.join(DATASETS, "EuroSAT_RGB")
FEATURE_CACHE = os.path.join(DATASETS, f"eurosat_{features.FEATURE_VERSION}.npz")

DATASET_URL = "https://zenodo.org/records/7711810/files/EuroSAT_RGB.zip"
DATASET_NAME = "EuroSAT (RGB)"
DATASET_CITATION = ("Helber et al., 2019 · EuroSAT: A Novel Dataset and Deep Learning "
                    "Benchmark for Land Use and Land Cover Classification (IEEE JSTARS). "
                    "Vignettes Sentinel-2 reelles, 64x64, 10 classes.")

# Tache binaire du projet : une zone mise en culture a l'interieur ou a
# proximite de l'emprise d'un couloir est une friction potentielle.
CULTIVATED_CLASSES = ("AnnualCrop", "PermanentCrop")

SEED = 42
TEST_SIZE = 0.20
MODEL_VERSION = "ts-eurosat-1.0.0"


def log(msg: str) -> None:
    print(f"[train] {msg}", flush=True)


# --------------------------------------------------------------- 1. dataset
def ensure_dataset() -> str:
    """Telecharge EuroSAT si absent, l'extrait, renvoie le repertoire des classes."""
    os.makedirs(DATASETS, exist_ok=True)
    classes_dir = _classes_dir()
    if classes_dir:
        log(f"jeu de donnees deja present : {classes_dir}")
        return classes_dir

    if not os.path.exists(ZIP_PATH):
        log(f"telechargement de {DATASET_URL} (~94 Mo)...")
        tmp = ZIP_PATH + ".part"
        t0 = time.time()
        with urllib.request.urlopen(DATASET_URL, timeout=120) as r, open(tmp, "wb") as fh:
            shutil.copyfileobj(r, fh, length=1 << 20)
        os.replace(tmp, ZIP_PATH)
        log(f"telecharge en {time.time() - t0:.0f} s "
            f"({os.path.getsize(ZIP_PATH) / 1e6:.1f} Mo)")
    else:
        log(f"archive en cache : {ZIP_PATH} ({os.path.getsize(ZIP_PATH) / 1e6:.1f} Mo)")

    log("extraction...")
    with zipfile.ZipFile(ZIP_PATH) as zf:
        zf.extractall(EXTRACT_DIR)
    classes_dir = _classes_dir()
    if not classes_dir:
        raise RuntimeError(f"extraction incoherente : aucun repertoire de classes "
                           f"trouve sous {EXTRACT_DIR}")
    return classes_dir


def _classes_dir() -> str | None:
    """Repertoire contenant un sous-repertoire par classe (l'archive peut
    encapsuler un niveau supplementaire ; on le retrouve sans le supposer)."""
    if not os.path.isdir(EXTRACT_DIR):
        return None
    candidates = [EXTRACT_DIR]
    for name in sorted(os.listdir(EXTRACT_DIR)):
        p = os.path.join(EXTRACT_DIR, name)
        if os.path.isdir(p):
            candidates.append(p)
    for c in candidates:
        subs = [d for d in sorted(os.listdir(c)) if os.path.isdir(os.path.join(c, d))]
        if len(subs) >= 8 and any(
                f.lower().endswith((".jpg", ".jpeg", ".png"))
                for f in os.listdir(os.path.join(c, subs[0]))[:20]):
            return c
    return None


# ------------------------------------------------- 2. caracteristiques
def build_features(classes_dir: str):
    """(X, y_class, class_names) : avec cache disque .npz."""
    if os.path.exists(FEATURE_CACHE):
        z = np.load(FEATURE_CACHE, allow_pickle=True)
        names = [str(n) for n in z["class_names"]]
        log(f"caracteristiques en cache : {z['X'].shape[0]} vignettes x "
            f"{z['X'].shape[1]} ({FEATURE_CACHE})")
        return z["X"], z["y"], names

    from PIL import Image

    class_names = sorted(d for d in os.listdir(classes_dir)
                         if os.path.isdir(os.path.join(classes_dir, d)))
    log(f"{len(class_names)} classes : {', '.join(class_names)}")

    X: list[np.ndarray] = []
    y: list[int] = []
    t0 = time.time()
    total = 0
    for ci, cname in enumerate(class_names):
        cdir = os.path.join(classes_dir, cname)
        files = sorted(f for f in os.listdir(cdir)
                       if f.lower().endswith((".jpg", ".jpeg", ".png")))
        for f in files:
            with Image.open(os.path.join(cdir, f)) as im:
                im = im.convert("RGB")
                if im.size != (features.TILE_PX, features.TILE_PX):
                    im = im.resize((features.TILE_PX, features.TILE_PX), Image.BILINEAR)
                arr = np.asarray(im, dtype=np.uint8)
            X.append(features.features(arr))
            y.append(ci)
        total += len(files)
        log(f"  {cname:22s} {len(files):6d} vignettes  "
            f"(cumul {total}, {time.time() - t0:.0f} s)")

    Xa = np.vstack(X).astype(np.float32)
    ya = np.asarray(y, dtype=np.int16)
    np.savez_compressed(FEATURE_CACHE, X=Xa, y=ya,
                        class_names=np.array(class_names, dtype=object),
                        feature_names=np.array(features.FEATURE_NAMES, dtype=object))
    log(f"caracteristiques calculees en {time.time() - t0:.0f} s -> {FEATURE_CACHE}")
    return Xa, ya, class_names


# --------------------------------------------------------------- 3-5. train
def main() -> int:
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.metrics import (accuracy_score, classification_report,
                                 confusion_matrix, f1_score, precision_score,
                                 recall_score, roc_auc_score)
    from sklearn.model_selection import train_test_split
    import joblib
    import sklearn

    classes_dir = ensure_dataset()
    X, y_cls, class_names = build_features(classes_dir)

    missing = [c for c in CULTIVATED_CLASSES if c not in class_names]
    if missing:
        raise RuntimeError(f"classes cultivees absentes du jeu : {missing} ; "
                           f"classes trouvees : {class_names}")
    cult_idx = {class_names.index(c) for c in CULTIVATED_CLASSES}
    y_bin = np.array([1 if c in cult_idx else 0 for c in y_cls], dtype=np.int8)

    log(f"{X.shape[0]} vignettes, {X.shape[1]} caracteristiques "
        f"({features.FEATURE_VERSION})")
    log(f"cultive = {CULTIVATED_CLASSES} -> {int(y_bin.sum())} positifs "
        f"({100 * y_bin.mean():.1f} %), {int((1 - y_bin).sum())} negatifs")

    # Split stratifie sur les 10 CLASSES (plus contraignant que sur le binaire :
    # il garantit aussi la representativite du test par classe d'occupation).
    idx = np.arange(X.shape[0])
    i_tr, i_te = train_test_split(idx, test_size=TEST_SIZE, random_state=SEED,
                                  stratify=y_cls, shuffle=True)
    X_tr, X_te = X[i_tr], X[i_te]
    yb_tr, yb_te = y_bin[i_tr], y_bin[i_te]
    yc_tr, yc_te = y_cls[i_tr], y_cls[i_te]
    log(f"split graine={SEED} : train={len(i_tr)} / test={len(i_te)} "
        f"(test tenu a l'ecart, jamais vu pendant l'entrainement)")

    common = dict(max_iter=400, learning_rate=0.08, max_leaf_nodes=31,
                  l2_regularization=1.0, early_stopping=True,
                  validation_fraction=0.15, n_iter_no_change=25,
                  random_state=SEED)

    t0 = time.time()
    clf_bin = HistGradientBoostingClassifier(**common).fit(X_tr, yb_tr)
    t_bin = time.time() - t0
    log(f"modele binaire entraine en {t_bin:.1f} s "
        f"({clf_bin.n_iter_} iterations retenues)")

    t0 = time.time()
    clf_cls = HistGradientBoostingClassifier(**common).fit(X_tr, yc_tr)
    t_cls = time.time() - t0
    log(f"modele multi-classes entraine en {t_cls:.1f} s "
        f"({clf_cls.n_iter_} iterations retenues)")

    # ---- evaluation sur le jeu de test tenu a l'ecart
    pb = clf_bin.predict(X_te)
    proba = clf_bin.predict_proba(X_te)[:, 1]
    acc = accuracy_score(yb_te, pb)
    prec = precision_score(yb_te, pb, zero_division=0)
    rec = recall_score(yb_te, pb, zero_division=0)
    f1 = f1_score(yb_te, pb, zero_division=0)
    auc = roc_auc_score(yb_te, proba)
    cm = confusion_matrix(yb_te, pb).tolist()

    pc = clf_cls.predict(X_te)
    acc_c = accuracy_score(yc_te, pc)
    f1_macro = f1_score(yc_te, pc, average="macro", zero_division=0)
    rep = classification_report(yc_te, pc, target_names=class_names,
                                output_dict=True, zero_division=0)
    cm_c = confusion_matrix(yc_te, pc).tolist()

    per_class = {
        cn: {"precision": round(rep[cn]["precision"], 4),
             "recall": round(rep[cn]["recall"], 4),
             "f1": round(rep[cn]["f1-score"], 4),
             "support": int(rep[cn]["support"]),
             "cultivated": cn in CULTIVATED_CLASSES}
        for cn in class_names
    }

    # ---- serialisation
    os.makedirs(MODEL_DIR, exist_ok=True)
    bundle = {
        "version": MODEL_VERSION,
        "feature_version": features.FEATURE_VERSION,
        "feature_names": features.FEATURE_NAMES,
        "class_names": class_names,
        "cultivated_classes": list(CULTIVATED_CLASSES),
        "binary": clf_bin,
        "multiclass": clf_cls,
        "seed": SEED,
    }
    model_path = os.path.join(MODEL_DIR, "model.joblib")
    joblib.dump(bundle, model_path, compress=3)

    digest = hashlib.sha256(open(model_path, "rb").read()).hexdigest()[:16]
    card = {
        "name": "Terra Sentinelle : classifieur d'occupation du sol",
        "version": MODEL_VERSION,
        "real": True,
        "task": "binaire cultive / non cultive (+ sortie multi-classes a 10 classes)",
        "algorithm": "sklearn HistGradientBoostingClassifier (gradient boosting "
                     "d'arbres sur histogrammes) · pas de deep learning : pas de GPU "
                     "disponible, et la pertinence prime sur la complexite inutile",
        "sklearn_version": sklearn.__version__,
        "trained_on": {
            "dataset": DATASET_NAME,
            "source": DATASET_URL,
            "citation": DATASET_CITATION,
            "imagery": "Sentinel-2 (RGB, 10 m/px, vignettes 64x64 = 640 m au sol)",
            "geography": "EUROPE : 34 pays europeens. Aucune vignette africaine.",
            "n_total": int(X.shape[0]),
            "n_train": int(len(i_tr)),
            "n_test": int(len(i_te)),
            "test_size": TEST_SIZE,
            "stratified_on": "les 10 classes EuroSAT",
            "classes": class_names,
            "cultivated_classes": list(CULTIVATED_CLASSES),
            "positives_total": int(y_bin.sum()),
            "positive_rate": round(float(y_bin.mean()), 4),
        },
        "features": {
            "version": features.FEATURE_VERSION,
            "count": len(features.FEATURE_NAMES),
            "names": features.FEATURE_NAMES,
            "description": "statistiques par canal RGB, chromaticite normalisee, "
                           "ExG = 2G-R-B, GRVI = (G-R)/(G+R), texture (gradient, "
                           "ecart-type local en blocs 8x8, entropie, anisotropie)",
            "no_nir": "le proche infrarouge n'est pas disponible sur les tuiles "
                      "d'inference : pas de NDVI, ExG et GRVI en tiennent lieu",
        },
        "metrics": {
            "measured_on": "jeu de test EuroSAT tenu a l'ecart "
                           f"({int(len(i_te))} vignettes, jamais vues a l'entrainement)",
            "accuracy": round(float(acc), 4),
            "precision": round(float(prec), 4),
            "recall": round(float(rec), 4),
            "f1": round(float(f1), 4),
            "roc_auc": round(float(auc), 4),
            "confusion": cm,
            "confusion_labels": ["non_cultive", "cultive"],
            "multiclass": {
                "accuracy": round(float(acc_c), 4),
                "f1_macro": round(float(f1_macro), 4),
                "confusion": cm_c,
                "labels": class_names,
            },
            "per_class": per_class,
        },
        "seed": SEED,
        "train_seconds": {"binary": round(t_bin, 1), "multiclass": round(t_cls, 1)},
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "artifact": {"path": "data/model/model.joblib",
                     "bytes": os.path.getsize(model_path),
                     "sha256_16": digest},
        "inference_on": {
            "imagery": "Sentinel-2 cloudless 2020 (EOX s2cloudless), tuiles WMTS "
                       "publiques sans authentification",
            "zoom": 14,
            "ground_resolution_m_px": 9.4,
            "note": "zoom 14 choisi pour retrouver ~10 m/px sous la latitude du "
                    "Benin, soit la resolution d'EuroSAT ; une decoupe 64x64 y "
                    "couvre ~600 m, comme une vignette d'entrainement",
        },
        # ------------------------------------------------------------------
        # SPEC section 10 : le point le plus important de la carte de modele.
        # ------------------------------------------------------------------
        "domain_gap": (
            "ATTENTION : ECART DE DOMAINE. Les metriques ci-dessus sont mesurees sur "
            "le jeu de test EuroSAT, c'est-a-dire sur de l'imagerie EUROPEENNE. Elles "
            "ne decrivent PAS la performance du modele au Benin et ne doivent jamais "
            "etre presentees comme telle. Les cartes d'occupation du sol globales "
            "sous-performent sur l'agriculture subsaharienne : parcelles plus petites "
            "que la vignette, cultures associees, jacheres, parcs agroforestiers, "
            "calendrier cultural et signature spectrale differents. S'ajoute un ecart "
            "de rendu : EuroSAT provient de produits Sentinel-2 L2A tandis que "
            "l'inference porte sur une mosaique EOX s2cloudless 2020 deja stylisee. "
            "Toute sortie du modele sur le Benin est donc une PREDICTION NON VALIDEE "
            "LOCALEMENT, a verifier sur le terrain par l'agent communal (role de "
            "Moussa Gounou, SPEC section 4). Aucune metrique beninoise n'est publiee "
            "ici parce qu'aucune n'a ete mesuree : il n'existe pas encore de jeu de "
            "verification annote pour le nord du Benin."),
        "validation_status": "non valide localement (Benin) ; metriques valides pour "
                             "le domaine europeen d'entrainement uniquement",
        "not_claimed": "Ce modele ne predit pas les conflits et ne delivre aucune "
                       "autorisation de passage.",
    }
    card_path = os.path.join(MODEL_DIR, "model_card.json")
    with open(card_path, "w", encoding="utf-8") as fh:
        json.dump(card, fh, ensure_ascii=False, indent=1)

    # ---- rapport final (chiffres REELLEMENT mesures)
    print()
    print("=" * 72)
    print("  RESULTATS MESURES : jeu de test EuroSAT tenu a l'ecart")
    print("=" * 72)
    print(f"  vignettes totales     : {X.shape[0]}")
    print(f"  train / test          : {len(i_tr)} / {len(i_te)}  (graine {SEED})")
    print(f"  caracteristiques      : {X.shape[1]} ({features.FEATURE_VERSION})")
    print()
    print("  BINAIRE  cultive (AnnualCrop, PermanentCrop) vs non cultive")
    print(f"    accuracy  {acc:.4f}")
    print(f"    precision {prec:.4f}")
    print(f"    recall    {rec:.4f}")
    print(f"    F1        {f1:.4f}")
    print(f"    ROC AUC   {auc:.4f}")
    print(f"    matrice   [[VN {cm[0][0]}, FP {cm[0][1]}], [FN {cm[1][0]}, VP {cm[1][1]}]]")
    print()
    print(f"  MULTI-CLASSES (10 classes)  accuracy {acc_c:.4f}  F1 macro {f1_macro:.4f}")
    for cn in class_names:
        m = per_class[cn]
        mark = "*" if m["cultivated"] else " "
        print(f"   {mark} {cn:22s} P {m['precision']:.3f}  R {m['recall']:.3f}  "
              f"F1 {m['f1']:.3f}  (n={m['support']})")
    print()
    print("  ECART DE DOMAINE : ces chiffres valent pour l'EUROPE (EuroSAT).")
    print("  Ils ne disent rien de la performance au Benin. Toute prediction")
    print("  beninoise est non validee localement et doit etre verifiee au sol.")
    print("=" * 72)
    print(f"  modele : {model_path}")
    print(f"  carte  : {card_path}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"\n[train] ECHEC : {type(exc).__name__}: {exc}", file=sys.stderr)
        print("[train] aucune metrique n'est ecrite : un entrainement qui echoue "
              "ne produit pas de chiffres.", file=sys.stderr)
        sys.exit(1)
