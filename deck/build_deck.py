# -*- coding: utf-8 -*-
"""Terra Sentinelle — generateur du deck 14 slides (16:9) pour IndabaX Benin 2026."""
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
from pptx.oxml.ns import qn
import copy

OUT = "/home/koba-david/terra-sentinelle/deck/Terra_Sentinelle.pptx"

# ---------- Palette (SPEC section 7) ----------
BG_DEEP = RGBColor(0x08, 0x0F, 0x0C)
BG      = RGBColor(0x0C, 0x17, 0x12)
RAISE   = RGBColor(0x11, 0x20, 0x1A)
TEXT    = RGBColor(0xE9, 0xF2, 0xED)
DIM     = RGBColor(0x93, 0xA7, 0x9D)
ACCENT  = RGBColor(0x34, 0xD3, 0x99)
AMBER   = RGBColor(0xF5, 0xB5, 0x44)
RED     = RGBColor(0xF0, 0x66, 0x5F)
SAND    = RGBColor(0xD9, 0xB4, 0x8F)
LINE    = RGBColor(0x1E, 0x2E, 0x27)

TITLE_FONT = "Space Grotesk"
BODY_FONT  = "Inter"
MONO_FONT  = "JetBrains Mono"

W, H = 13.333, 7.5
M = 0.78              # marge laterale
FOOT_Y = 6.86


# ---------- mesure de texte (PIL, police proxy DejaVu corrigee) ----------
from PIL import ImageFont
import glob as _glob
_cand = _glob.glob("/usr/share/fonts/**/DejaVuSans.ttf", recursive=True)
_FP = _cand[0] if _cand else None
_fc = {}


def _f(px):
    px = max(6, int(round(px)))
    if px not in _fc:
        _fc[px] = ImageFont.truetype(_FP, px)
    return _fc[px]


def _wpt(t, size, bold=False):
    if not t:
        return 0.0
    w = _f(size * 4).getlength(t) / 4.0
    return w * (1.03 if bold else 1.0) * 0.90


def _nlines(t, size, bold, avail_pt):
    words = t.split()
    if not words:
        return 1
    n, cur = 1, ""
    for w in words:
        tr = (cur + " " + w).strip()
        if _wpt(tr, size, bold) <= avail_pt or not cur:
            cur = tr
        else:
            n += 1
            cur = w
    return n


def measure(text, w_in, size, spacing=1.18, bold=False, space_after=0):
    """hauteur necessaire en pouces pour `text` dans une boite de largeur w_in."""
    avail = w_in * 72.0
    h = 0.0
    for ln in text.split("\n"):
        h += _nlines(ln, size, bold, avail) * size * 1.20 * spacing + space_after
    return h / 72.0 + 0.035  # petite marge de securite


prs = Presentation()
prs.slide_width  = Inches(W)
prs.slide_height = Inches(H)
BLANK = prs.slide_layouts[6]


# ---------- helpers ----------
def _set_font(run, name):
    """Nomme la police + prevoit Arial en repli (latin/ea/cs)."""
    run.font.name = name
    rPr = run._r.get_or_add_rPr()
    for tag in ("a:latin", "a:cs"):
        e = rPr.find(qn(tag))
        if e is None:
            e = rPr.makeelement(qn(tag), {})
            rPr.append(e)
        e.set("typeface", name)
        e.set("pitchFamily", "34")
        e.set("charset", "0")


def add_slide():
    s = prs.slides.add_slide(BLANK)
    bg = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
    bg.fill.solid(); bg.fill.fore_color.rgb = BG
    bg.line.fill.background(); bg.shadow.inherit = False
    return s


def txt(slide, x, y, w, h, text, size=18, color=TEXT, font=BODY_FONT, bold=False,
        align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, spacing=1.18, space_after=0,
        caps=False, italic=False):
    _t = text if isinstance(text, str) else "\n".join(text)
    if anchor == MSO_ANCHOR.TOP:
        h = measure(_t, w, size, spacing, bold, space_after)
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    lines = text.split("\n") if isinstance(text, str) else list(text)
    for i, ln in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = spacing
        if space_after:
            p.space_after = Pt(space_after)
        r = p.add_run(); r.text = ln
        r.font.size = Pt(size); r.font.bold = bold; r.font.italic = italic
        r.font.color.rgb = color
        _set_font(r, font)
        if caps:
            r.font._rPr.set("cap", "all")
    return box


def rect(slide, x, y, w, h, fill=RAISE, line=LINE, radius=0.10, shape=MSO_SHAPE.ROUNDED_RECTANGLE,
         line_w=1.0):
    sh = slide.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    if fill is None:
        sh.fill.background()
    else:
        sh.fill.solid(); sh.fill.fore_color.rgb = fill
    if line is None:
        sh.line.fill.background()
    else:
        sh.line.color.rgb = line; sh.line.width = Pt(line_w)
    sh.shadow.inherit = False
    if shape == MSO_SHAPE.ROUNDED_RECTANGLE:
        try:
            sh.adjustments[0] = radius
        except Exception:
            pass
    return sh


def bar(slide, x, y, w, h, color=ACCENT):
    sh = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    sh.fill.solid(); sh.fill.fore_color.rgb = color
    sh.line.fill.background(); sh.shadow.inherit = False
    return sh


def arrow(slide, x, y, w, h=0.11, color=ACCENT):
    sh = slide.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, Inches(x), Inches(y), Inches(w), Inches(h))
    sh.fill.solid(); sh.fill.fore_color.rgb = color
    sh.line.fill.background(); sh.shadow.inherit = False
    return sh


def chrome(slide, idx, kicker=None, title=None, title_size=32, sub=None, sub_size=14):
    """Filet de pied de page + numero + (option) kicker/titre/sous-titre."""
    bar(slide, M, FOOT_Y, W - 2 * M, 0.012, LINE)
    txt(slide, M, FOOT_Y + 0.14, 6.0, 0.26, "Terra Sentinelle · IndabaX Bénin 2026", 9, DIM)
    txt(slide, W - M - 1.2, FOOT_Y + 0.14, 1.2, 0.26, "%02d / 14" % idx, 9, DIM,
        font=MONO_FONT, align=PP_ALIGN.RIGHT)
    y = 0.62
    if kicker:
        bar(slide, M, y + 0.045, 0.055, 0.17, ACCENT)
        txt(slide, M + 0.20, y, 9.5, 0.28, kicker.upper(), 11, ACCENT, bold=True, spacing=1.0)
        y += 0.40
    if title:
        th = measure(title, W - 2 * M, title_size, 1.06, True)
        txt(slide, M, y, W - 2 * M, th, title, title_size, TEXT, TITLE_FONT, bold=True, spacing=1.06)
        y += th + 0.18
    if sub:
        sh_ = measure(sub, W - 2 * M - 0.6, sub_size, 1.28)
        txt(slide, M, y, W - 2 * M - 0.6, sh_, sub, sub_size, DIM, spacing=1.28)
        y += sh_ + 0.10
    return y


def notes(slide, text):
    slide.notes_slide.notes_text_frame.text = text


def card(slide, x, y, w, h, title, body, accent=ACCENT, tsize=15, bsize=12.5, num=None):
    pad = 0.26
    iw = w - 2 * pad
    th = measure(title, iw, tsize, 1.12, True)
    bh = measure(body, iw, bsize, 1.30)
    need = pad + 0.06 + th + 0.16 + bh + pad
    h = max(h, need)
    rect(slide, x, y, w, h)
    bar(slide, x, y - 0.012, w, 0.05, accent)
    cy = y + pad + 0.06
    if num:
        txt(slide, x + pad, cy, iw, 0.3, num, 11, accent, font=MONO_FONT, bold=True)
        cy += 0.32
    txt(slide, x + pad, cy, iw, th, title, tsize, TEXT, TITLE_FONT, bold=True, spacing=1.12)
    txt(slide, x + pad, cy + th + 0.16, iw, bh, body, bsize, DIM, spacing=1.30)
    return h


def card_h(title, body, w, tsize=15, bsize=12.5):
    pad = 0.26
    iw = w - 2 * pad
    return pad + 0.06 + measure(title, iw, tsize, 1.12, True) + 0.16 + measure(body, iw, bsize, 1.30) + pad


def row_h(items, w, tsize=15, bsize=12.5):
    return max(card_h(t, b, w, tsize, bsize) for t, b in items)


# =====================================================================
# 01 — Titre
# =====================================================================
s = add_slide()
bar(s, 0, 0, W, 0.055, ACCENT)
txt(s, M, 1.72, 11.5, 1.3, "Terra Sentinelle", 60, TEXT, TITLE_FONT, bold=True, spacing=1.0)
bar(s, M, 3.14, 1.5, 0.045, ACCENT)
txt(s, M, 3.46, 10.6, 0.9,
    "Rendre aux couloirs de transhumance une carte qui a l'âge de la saison en cours.",
    19, DIM, spacing=1.28)
ch = rect(s, M, 4.62, 3.05, 0.46, None, ACCENT, 0.45)
txt(s, M + 0.30, 4.735, 2.6, 0.3, "Défi : Résilience climatique", 12, ACCENT, bold=True)
txt(s, M, 5.55, 8.0, 0.9,
    "Équipe KOBA David\nHackathon Deep Learning · IndabaX Bénin 2026 · Cotonou",
    13, DIM, spacing=1.35)
chrome(s, 1)
notes(s, "Bonjour, je suis David KOBA. Terra Sentinelle concourt sur le défi Résilience climatique.\nEn "
         "une phrase : dans le nord du Bénin, les couloirs de transhumance ont une carte, mais cette "
         "carte a des années. Nous lui redonnons l'âge de la saison en cours, à partir d'imagerie "
         "satellitaire.\nJe vais vous montrer pour qui, pourquoi, comment — et ce que le système refuse "
         "de faire.")

# =====================================================================
# 02 — Le constat (phrase de cadrage SPEC §2)
# =====================================================================
s = add_slide()
bar(s, M, 0.665, 0.055, 0.17, ACCENT)
txt(s, M + 0.20, 0.62, 9.5, 0.28, "LE CONSTAT", 11, ACCENT, bold=True, spacing=1.0)
bar(s, M, 1.25, 0.06, 3.55, ACCENT)
txt(s, M + 0.55, 1.30, 11.3, 1.4,
    "« Les couloirs de transhumance ont été délimités une fois.\nLes champs, eux, changent chaque saison.",
    27, TEXT, TITLE_FONT, bold=True, spacing=1.22)
txt(s, M + 0.55, 3.42, 11.3, 1.0,
    "Le conflit ne naît pas d'une carte absente,\nil naît d'une carte périmée. »",
    27, ACCENT, TITLE_FONT, bold=True, spacing=1.22)
chrome(s, 2)
notes(s, "Retenez cette phrase, c'est tout le projet.\nLes couloirs ont été délimités une fois : bornes, "
         "procès-verbaux, concertation. Un vrai travail.\nMais les champs changent chaque saison — une "
         "parcelle se défriche en quelques semaines.\nDonc le conflit ne naît pas d'une carte absente. Il "
         "naît d'une carte périmée : le troupeau arrive là où le couloir existe sur le papier, et où il y "
         "a désormais du coton.")

# =====================================================================
# 03 — Le problème : temporel, pas spatial
# =====================================================================
s = add_slide()
chrome(s, 3, "Le problème", "Ce n'est pas un problème spatial.\nC'est un problème temporel.", 30)
txt(s, M, 2.52, 11.8, 0.4, "Nord du Bénin · conflits agriculteurs–éleveurs", 13, SAND)
cy, chh = 3.15, 2.25
cw = (W - 2 * M - 0.6) / 3
card(s, M, cy, cw, chh, "La carte existe", "Couloirs délimités,\nbalisés, actés.\nUne fois.", ACCENT, 16, 13)
card(s, M + cw + 0.30, cy, cw, chh, "Le sol a bougé", "Mise en culture,\nextension cotonnière,\nchaque saison.", SAND, 16, 13)
card(s, M + 2 * (cw + 0.30), cy, cw, chh, "Le comité décide\nà l'aveugle",
     "Il arbitre sans image\nrécente du terrain.", RED, 16, 13)
txt(s, M, 5.78, 11.8, 0.5, "La carte est périmée avant d'être utilisée.", 17, TEXT, TITLE_FONT, bold=True)
notes(s, "Précisons, parce que le problème est souvent mal posé.\nUn : la carte existe. Ce n'est pas un "
         "vide cartographique.\nDeux : le sol bouge — extension cotonnière, mise en culture du couloir, à "
         "chaque saison.\nTrois : le comité communal doit arbitrer, mais sans image récente, sur des "
         "témoignages contradictoires.\nLe manque n'est donc pas spatial, il est temporel. Pas « où est "
         "le couloir », mais « à quoi ressemble-t-il cette année ».")

# =====================================================================
# 04 — Notre utilisateur : Moussa Gounou
# =====================================================================
s = add_slide()
chrome(s, 4, "Notre utilisateur", "Moussa Gounou", 34)
txt(s, M, 1.98, 8.0, 0.4, "Agent d'élevage · mairie de Banikoara (Alibori)", 15, SAND)
rect(s, M, 2.62, 5.55, 3.72)
bar(s, M, 2.608, 5.55, 0.05, ACCENT)
txt(s, M + 0.32, 2.98, 4.9, 0.35, "SON SCÉNARIO, AVANT LA SAISON", 11, ACCENT, bold=True)
steps = [("1", "Il reçoit la carte de friction du couloir"),
         ("2", "Il va vérifier sur le terrain, hors réseau"),
         ("3", "Il confirme ou invalide depuis son téléphone"),
         ("4", "Au retour du réseau, tout se synchronise"),
         ("5", "Le comité communal arbitre le lendemain")]
for i, (n, t) in enumerate(steps):
    yy = 3.50 + i * 0.60
    txt(s, M + 0.32, yy, 0.4, 0.3, n, 12, ACCENT, font=MONO_FONT, bold=True)
    txt(s, M + 0.78, yy - 0.02, 4.5, 0.42, t, 13.5, TEXT, spacing=1.2)
x2 = M + 5.9
rect(s, x2, 2.62, W - M - x2, 1.72)
txt(s, x2 + 0.32, 2.92, 4.6, 0.35, "UTILISATEURS SECONDAIRES", 11, AMBER, bold=True)
txt(s, x2 + 0.32, 3.34, W - M - x2 - 0.64, 0.9,
    "Le comité communal de transhumance (web)\nLes représentants d'éleveurs (message vocal)",
    13, DIM, spacing=1.35)
rect(s, x2, 4.58, W - M - x2, 1.76)
txt(s, x2 + 0.32, 4.88, 4.6, 0.35, "ZONE DE DÉMONSTRATION", 11, SAND, bold=True)
txt(s, x2 + 0.32, 5.30, W - M - x2 - 0.64, 0.9,
    "Commune de Banikoara, Alibori, nord Bénin\n11.298 N · 2.438 E",
    13, DIM, spacing=1.35)
notes(s, "Nous n'avons pas conçu pour « les communes », mais pour une personne.\nMoussa Gounou, agent "
         "d'élevage à Banikoara. Avant la saison, il reçoit la liste des portions du couloir devenues "
         "cultivées. Il part vérifier — et là-bas, pas de réseau. Il confirme ou invalide chaque "
         "détection hors ligne ; au retour du réseau tout se synchronise. Le comité arbitre le "
         "lendemain.\nDerrière lui : le comité, sur le web, et les représentants d'éleveurs, qui "
         "reçoivent la décision en vocal.")

# =====================================================================
# 05 — La solution + chaine de traitement
# =====================================================================
s = add_slide()
chrome(s, 5, "La solution")
txt(s, M, 1.02, 11.8, 0.9,
    "Transformer une carte statique\nen système de veille actualisé avant chaque saison.",
    28, TEXT, TITLE_FONT, bold=True, spacing=1.16)
NW, NH = 2.62, 0.92
gap = 0.42
row1 = [("Sentinel-2", "images 10 m", ACCENT), ("Classification", "zones en culture", ACCENT),
        ("Croisement", "emprise du couloir", AMBER), ("Carte de friction", "gravité + confiance", AMBER)]
row2 = [("Vérification terrain", "hors ligne", SAND), ("Arbitrage du comité", "maintien / ajustement", RED),
        ("Diffusion vocale", "en fulfulde", ACCENT)]
y1 = 2.85
x = M
for i, (t, sb, c) in enumerate(row1):
    rect(s, x, y1, NW, NH)
    bar(s, x, y1, 0.035, NH, c)
    txt(s, x + 0.22, y1 + 0.20, NW - 0.42, 0.3, t, 13, TEXT, TITLE_FONT, bold=True)
    txt(s, x + 0.22, y1 + 0.53, NW - 0.42, 0.28, sb, 10.5, DIM)
    if i < 3:
        arrow(s, x + NW + 0.09, y1 + NH / 2 - 0.055, gap - 0.18, 0.11, c)
    x += NW + gap
y2 = 4.62
bar(s, M + 3 * (NW + gap) + NW / 2 - 0.02, y1 + NH + 0.14, 0.045, 0.22, AMBER)
bar(s, M + NW / 2, y1 + NH + 0.30, 3 * (NW + gap), 0.02, LINE)
conn2 = s.shapes.add_shape(MSO_SHAPE.DOWN_ARROW, Inches(M + NW / 2 - 0.09),
                           Inches(y1 + NH + 0.30), Inches(0.18), Inches(0.42))
conn2.fill.solid(); conn2.fill.fore_color.rgb = SAND
conn2.line.fill.background(); conn2.shadow.inherit = False
x = M
for i, (t, sb, c) in enumerate(row2):
    rect(s, x, y2, NW, NH)
    bar(s, x, y2, 0.035, NH, c)
    txt(s, x + 0.22, y2 + 0.20, NW - 0.42, 0.3, t, 13, TEXT, TITLE_FONT, bold=True)
    txt(s, x + 0.22, y2 + 0.53, NW - 0.42, 0.28, sb, 10.5, DIM)
    if i < 2:
        arrow(s, x + NW + 0.09, y2 + NH / 2 - 0.055, gap - 0.18, 0.11, c)
    x += NW + gap
txt(s, M, 5.90, 11.8, 0.4,
    "Machine en amont · décision humaine au centre · restitution dans la langue des éleveurs",
    12.5, DIM)
notes(s, "La solution : transformer une carte statique en système de veille actualisé avant chaque "
         "saison.\nLa chaîne. Images Sentinel-2 à 10 mètres. Un modèle identifie les zones mises en "
         "culture. On les croise avec l'emprise du couloir — c'est là qu'est notre valeur. On en tire une "
         "carte de friction, avec gravité et confiance.\nPuis l'humain reprend la main : vérification "
         "terrain, arbitrage du comité, diffusion vocale en fulfulde.\nLa machine est en amont. La "
         "décision est au centre, et elle est humaine.")

# =====================================================================
# 06 — La carte de friction
# =====================================================================
s = add_slide()
chrome(s, 6, "Le livrable", "La carte de friction", 32,
       "Ce que le comité reçoit avant la saison : les portions devenues cultivées, "
       "classées par gravité, avec leur niveau de confiance.", 14)
hy = 3.28
cols = [("SEGMENT", M + 0.30, 3.1), ("SURFACE", M + 3.55, 1.5), ("GRAVITÉ", M + 5.35, 2.6),
        ("CONFIANCE", M + 8.20, 1.6), ("STATUT", M + 10.05, 1.6)]
for lab, cx, cw_ in cols:
    txt(s, cx, hy, cw_, 0.3, lab, 10, DIM, bold=True)
bar(s, M, hy + 0.34, W - 2 * M, 0.012, LINE)
rows = [("Couloir central — segment 04", "18,4 ha", "Grave", RED, "0.88", "à vérifier", AMBER),
        ("Couloir central — segment 07", "6,1 ha", "Moyenne", AMBER, "0.71", "confirmé", ACCENT),
        ("Dérivation ouest — segment 12", "2,3 ha", "Faible", ACCENT, "0.54", "incertain", DIM)]
for i, (seg, ha, grav, gc, conf, st, sc) in enumerate(rows):
    ry = hy + 0.52 + i * 0.72
    rect(s, M, ry, W - 2 * M, 0.60, RAISE, LINE, 0.14)
    bar(s, M, ry, 0.035, 0.60, gc)
    txt(s, M + 0.30, ry + 0.19, 3.1, 0.3, seg, 12.5, TEXT)
    txt(s, M + 3.55, ry + 0.19, 1.5, 0.3, ha, 12.5, DIM, font=MONO_FONT)
    dot = rect(s, M + 5.35, ry + 0.235, 0.13, 0.13, gc, None, 0.5, MSO_SHAPE.OVAL)
    txt(s, M + 5.58, ry + 0.19, 2.4, 0.3, grav, 12.5, gc, bold=True)
    txt(s, M + 8.20, ry + 0.19, 1.6, 0.3, conf, 12.5, DIM, font=MONO_FONT)
    txt(s, M + 10.05, ry + 0.19, 1.7, 0.3, st, 12.5, sc)
txt(s, M, 6.10, 11.8, 0.4,
    "Chaque ligne garde sa source, sa date de passage satellite et son statut de validation.",
    12, DIM, italic=True)
notes(s, "Voici le livrable, celui que le comité a sous les yeux.\nPour chaque portion : la surface, un "
         "niveau de gravité, un niveau de confiance, un statut.\nRegardez la troisième ligne : confiance "
         "0,54, statut incertain. Nous ne la cachons pas — c'est justement celle que Moussa ira voir en "
         "premier.\nChaque ligne garde sa source, la date du passage satellite et son statut de "
         "validation. Précision : les valeurs affichées sont des données de démonstration.")

# =====================================================================
# 07 — Pourquoi l'IA
# =====================================================================
s = add_slide()
chrome(s, 7, "Pourquoi l'IA", "L'IA n'est pas un ajout.\nElle est le mécanisme.", 30)
txt(s, M, 2.72, 11.8, 0.5,
    "Seule l'imagerie satellite peut rafraîchir la carte d'une commune entière, chaque saison.",
    16, SAND, spacing=1.25)
cy, chh = 3.55, 2.35
cw = (W - 2 * M - 0.6) / 3
card(s, M, cy, cw, chh, "L'échelle", "Banikoara : des milliers\nd'hectares de couloir.\nAucune brigade ne\nl'arpente chaque année.", SAND, 15, 12.5)
card(s, M + cw + 0.30, cy, cw, chh, "La cadence", "Sentinel-2 repasse\ntous les 5 jours.\nLa carte peut suivre\nle rythme des champs.", ACCENT, 15, 12.5)
card(s, M + 2 * (cw + 0.30), cy, cw, chh, "Le signal", "Distinguer sol nu,\njachère et culture\ndemande un modèle,\npas un seuil.", AMBER, 15, 12.5)
notes(s, "Pourquoi de l'IA, et pas une simple enquête de terrain ? Trois raisons.\nL'échelle : des "
         "milliers d'hectares de couloir sur la seule commune de Banikoara. Aucune brigade ne les arpente "
         "chaque année.\nLa cadence : Sentinel-2 repasse tous les cinq jours, gratuitement. Seule source "
         "capable de suivre le rythme des champs.\nLe signal : distinguer sol nu, jachère et culture "
         "demande un modèle appris, pas un seuil.\nRetirez l'IA, il ne reste plus de produit.")

# =====================================================================
# 08 — Les nuages : choix technique assume
# =====================================================================
s = add_slide()
chrome(s, 8, "Choix technique assumé", "La saison de culture est la saison des pluies.", 29,
       "Donc la saison des nuages. C'est le premier obstacle réel, et il se traite.", 14)
py, ph, pw = 2.92, 2.80, (W - 2 * M - 0.55) / 2
# Panneau optique
rect(s, M, py, pw, ph)
bar(s, M, py - 0.012, pw, 0.05, AMBER)
txt(s, M + 0.30, py + 0.30, pw - 0.6, 0.3, "SENTINEL-2 · OPTIQUE 10 m", 11, AMBER, bold=True)
for i in range(4):
    cl = rect(s, M + 0.42 + i * 1.28, py + 0.82, 1.05, 0.34, RGBColor(0x3A, 0x48, 0x43), None, 0.5)
bar(s, M + 0.42, py + 1.34, pw - 0.84, 0.02, LINE)
for i in range(4):
    blocked = i in (0, 2)
    a = s.shapes.add_shape(MSO_SHAPE.DOWN_ARROW, Inches(M + 0.90 + i * 1.28), Inches(py + 1.24),
                           Inches(0.16), Inches(0.46))
    a.fill.solid(); a.fill.fore_color.rgb = RED if blocked else ACCENT
    a.line.fill.background(); a.shadow.inherit = False
bar(s, M + 0.42, py + 1.86, pw - 0.84, 0.14, SAND)
txt(s, M + 0.42, py + 0.60, 2.4, 0.22, "nuages", 9, DIM)
txt(s, M + 0.42, py + 2.04, 2.4, 0.22, "sol", 9, DIM)
txt(s, M + 0.30, py + 2.30, pw - 0.6, 0.34,
    "Nuage = pixel perdu.\nParade : composite médian multi-dates + masque nuages.", 11.5, DIM, spacing=1.25)
# Panneau radar
x2 = M + pw + 0.55
rect(s, x2, py, pw, ph)
bar(s, x2, py - 0.012, pw, 0.05, ACCENT)
txt(s, x2 + 0.30, py + 0.30, pw - 0.6, 0.3, "SENTINEL-1 · RADAR", 11, ACCENT, bold=True)
for i in range(4):
    rect(s, x2 + 0.42 + i * 1.28, py + 0.82, 1.05, 0.34, RGBColor(0x3A, 0x48, 0x43), None, 0.5)
for i in range(4):
    a = s.shapes.add_shape(MSO_SHAPE.DOWN_ARROW, Inches(x2 + 0.90 + i * 1.28), Inches(py + 1.24),
                           Inches(0.16), Inches(0.46))
    a.fill.solid(); a.fill.fore_color.rgb = ACCENT
    a.line.fill.background(); a.shadow.inherit = False
bar(s, x2 + 0.42, py + 1.86, pw - 0.84, 0.14, SAND)
txt(s, x2 + 0.42, py + 0.60, 2.4, 0.22, "nuages", 9, DIM)
txt(s, x2 + 0.42, py + 2.04, 2.4, 0.22, "sol", 9, DIM)
txt(s, x2 + 0.30, py + 2.30, pw - 0.6, 0.34,
    "Le radar traverse les nuages.\nIl prend le relais en pleine saison humide.", 11.5, DIM, spacing=1.25)
txt(s, M, 5.86, 11.8, 0.44,
    "« La pertinence des choix techniques compte davantage que la complexité inutile. »",
    13.5, ACCENT, italic=True)
notes(s, "Voici le piège du projet, et notre choix technique.\nLa saison de culture, ici, c'est la saison "
         "des pluies. Donc des nuages. Une image optique sous un nuage, c'est un pixel perdu — au pire "
         "moment de l'année.\nDeux parades. Un composite médian Sentinel-2 sur plusieurs dates avec "
         "masquage des nuages : on garde la médiane des passages dégagés. Puis Sentinel-1, le radar, qui "
         "traverse les nuages et prend le relais en saison humide.\nRien d'exotique : deux briques "
         "choisies pour une contrainte réelle.")

# =====================================================================
# 09 — Pourquoi pas Dynamic World
# =====================================================================
s = add_slide()
chrome(s, 9, "La question qu'on va nous poser",
       "« Pourquoi pas simplement Dynamic World ? »", 30)
cy, chh = 2.42, 1.98
cw = (W - 2 * M - 0.6) / 3
card(s, M, cy, cw, chh, "Les cartes globales\ndécrochent ici",
     "Petites parcelles,\ncultures associées :\nl'agriculture subsaharienne\ny est sous-performée.", AMBER, 14, 12)
card(s, M + cw + 0.30, cy, cw, chh, "On s'en sert,\ncomme a priori",
     "Dynamic World en entrée,\nadaptation locale,\nécart mesuré.", ACCENT, 14, 12)
card(s, M + 2 * (cw + 0.30), cy, cw, chh, "Notre apport\nest ailleurs",
     "Pas le classifieur :\nle croisement avec\nl'emprise du couloir.", SAND, 14, 12)
rect(s, M, 5.00, W - 2 * M, 1.34, RAISE, ACCENT, 0.10)
txt(s, M + 0.36, 5.26, W - 2 * M - 0.72, 0.9,
    "Notre contribution n'est pas le classifieur.\n"
    "C'est le produit de décision remis au comité communal.",
    19, TEXT, TITLE_FONT, bold=True, spacing=1.25)
notes(s, "Posons nous-mêmes la question qui viendra : Dynamic World existe déjà. Pourquoi ne pas "
         "s'arrêter là ?\nD'abord parce que les cartes globales décrochent sur l'agriculture "
         "subsaharienne : petites parcelles, cultures associées. C'est documenté.\nEnsuite, nous ne les "
         "rejetons pas : Dynamic World sert d'a priori, nous adaptons localement et nous mesurons "
         "l'écart.\nSurtout : notre contribution n'est pas le classifieur, c'est le croisement avec "
         "l'emprise du couloir. Une carte de cultures ne dit rien à un comité. Une carte de friction, si.")

# =====================================================================
# 10 — Les donnees
# =====================================================================
s = add_slide()
chrome(s, 10, "Les données", "Ce que nous utilisons — et ce qui manque.", 30)
ty, th = 2.48, 3.62
lw = 7.05
rect(s, M, ty, lw, th)
bar(s, M, ty - 0.012, lw, 0.05, ACCENT)
txt(s, M + 0.32, ty + 0.28, lw - 0.64, 0.3, "LIBRE, OUVERT, UTILISÉ", 11, ACCENT, bold=True)
data = [("Sentinel-2", "optique 10 m · Copernicus"),
        ("Sentinel-1", "radar · traverse les nuages"),
        ("Dynamic World V1", "occupation du sol quasi temps réel"),
        ("ESA WorldCover v200", "10 m · 11 classes dont cropland"),
        ("OpenStreetMap Bénin", "Geofabrik"),
        ("Limites administratives", "HDX"),
        ("OIM TTT-DTM", "mouvements de transhumance")]
for i, (n, d) in enumerate(data):
    yy = ty + 0.72 + i * 0.40
    dot = rect(s, M + 0.34, yy + 0.10, 0.09, 0.09, ACCENT, None, 0.5, MSO_SHAPE.OVAL)
    txt(s, M + 0.60, yy, 2.95, 0.32, n, 12.5, TEXT)
    txt(s, M + 3.62, yy, lw - 3.94, 0.32, d, 11.5, DIM)
x2 = M + lw + 0.40
rw = W - M - x2
rect(s, x2, ty, rw, 1.82, RAISE, AMBER, 0.10)
bar(s, x2, ty - 0.012, rw, 0.05, AMBER)
txt(s, x2 + 0.32, ty + 0.28, rw - 0.64, 0.3, "CE QUI MANQUE", 11, AMBER, bold=True)
txt(s, x2 + 0.32, ty + 0.68, rw - 0.64, 1.0,
    "Aucun jeu ouvert de polygones\nde couloirs au Bénin.\nLe PFR de l'ANDF existe, mais fermé.",
    12.5, DIM, spacing=1.32)
rect(s, x2, ty + 2.04, rw, 1.58, RAISE, SAND, 0.10)
bar(s, x2, ty + 2.028, rw, 0.05, SAND)
txt(s, x2 + 0.32, ty + 2.32, rw - 0.64, 0.3, "CE QUE NOUS FAISONS", 11, SAND, bold=True)
txt(s, x2 + 0.32, ty + 2.72, rw - 0.64, 0.8,
    "L'emprise du couloir est reconstituée\npar l'équipe. Non officielle.\nÉcrit dans l'interface.",
    12.5, TEXT, spacing=1.32)
notes(s, "Tout ce qui est à gauche est libre et vérifié : Sentinel-1 et 2 via Copernicus, Dynamic World, "
         "ESA WorldCover, OpenStreetMap Bénin, les limites de HDX, les données de transhumance de "
         "l'OIM.\nMaintenant ce qui manque, et je préfère le dire moi-même : il n'existe aucun jeu ouvert "
         "de polygones de couloirs au Bénin. Le registre de l'ANDF existe, mais fermé.\nDonc l'emprise "
         "que nous affichons est reconstituée par l'équipe, non officielle, et c'est écrit dans "
         "l'interface. Le jour où une mairie fournit la vraie, elle se substitue sans rien changer au "
         "reste.")

# =====================================================================
# 11 — L'eleveur dans la boucle
# =====================================================================
s = add_slide()
chrome(s, 11, "IA et langues locales", "L'éleveur dans la boucle.", 30,
       "Une décision que son destinataire ne peut pas lire n'est pas une décision diffusée.", 14)
fy = 3.05
fw, fgap = 2.72, 0.52
flow = [("Comité", "maintien · ajustement\ncontournement", ACCENT),
        ("Message vocal", "synthèse en fulfulde", AMBER),
        ("WhatsApp / radio", "canaux déjà utilisés", SAND),
        ("Représentants\nd'éleveurs", "avant le départ", ACCENT)]
x = M
for i, (t, d, c) in enumerate(flow):
    rect(s, x, fy, fw, 1.55)
    bar(s, x, fy - 0.012, fw, 0.05, c)
    txt(s, x + 0.24, fy + 0.30, fw - 0.48, 0.62, t, 14, TEXT, TITLE_FONT, bold=True, spacing=1.1)
    txt(s, x + 0.24, fy + 0.96, fw - 0.48, 0.52, d, 11, DIM, spacing=1.25)
    if i < 3:
        arrow(s, x + fw + 0.11, fy + 0.72, fgap - 0.22, 0.11, c)
    x += fw + fgap
txt(s, M, 5.06, 11.8, 0.9,
    "Le fulfulde est la langue des éleveurs transhumants du nord Bénin.\n"
    "La décision circule dans la langue où elle sera appliquée.",
    15, TEXT, spacing=1.35)
notes(s, "Un système de décision qui ne parle pas la langue de ceux qu'il concerne ne sert à rien.\nLe "
         "comité arbitre : maintien, ajustement ou contournement. La décision devient un message vocal en "
         "fulfulde, la langue des éleveurs transhumants du nord Bénin, diffusé par les canaux qu'ils "
         "utilisent déjà — WhatsApp, radios communautaires — avant le départ des troupeaux.\nLe vocal "
         "n'est pas un gadget : il contourne la barrière de la langue et celle de l'écrit. C'est aussi "
         "pourquoi le projet touche le défi IA et langues locales.")

# =====================================================================
# 12 — Gouvernance et risque
# =====================================================================
s = add_slide()
chrome(s, 12, "Gouvernance et risque",
       "Une carte de conflit foncier est une donnée sensible.", 28,
       "Nous le disons avant qu'on nous le demande.", 14)
cy, chh = 3.02, 2.35
cw = (W - 2 * M - 0.6) / 3
card(s, M, cy, cw, chh, "Accès par rôle", "Agent, comité, autorité :\nchacun ne voit que\nce qui le concerne.", ACCENT, 15, 12.5)
card(s, M + cw + 0.30, cy, cw, chh, "Zones sensibles\nmasquées", "Invisibles hors du comité.\nUne friction n'est pas\nune information publique.", AMBER, 15, 12.5)
card(s, M + 2 * (cw + 0.30), cy, cw, chh, "Hébergement local", "Chez l'autorité communale.\nLa commune reste\npropriétaire de ses données.", SAND, 15, 12.5)
txt(s, M, 5.72, 11.8, 0.5,
    "Mal diffusée, elle désigne des coupables.\nBien gouvernée, elle prépare un arbitrage.",
    15, TEXT, spacing=1.30)
notes(s, "Soyons lucides sur ce que nous fabriquons. Une carte qui montre qui a cultivé dans un couloir, "
         "c'est une donnée sensible. Mal diffusée, elle désigne des coupables et alimente le conflit "
         "qu'elle prétend éviter.\nTrois garde-fous. L'accès est par rôle : agent, comité et autorité ne "
         "voient pas la même chose. Les zones sensibles restent invisibles hors du comité. L'hébergement "
         "se fait chez l'autorité communale : nous ne centralisons pas le foncier du nord Bénin sur un "
         "serveur privé.\nNous énonçons ce risque nous-mêmes plutôt que d'attendre la question.")

# =====================================================================
# 13 — Ce que Terra Sentinelle ne fait pas  (slide la plus importante)
# =====================================================================
s = add_slide()
bar(s, 0, 0, W, 0.055, RED)
txt(s, M, 1.05, 11.8, 0.4, "CE QUE TERRA SENTINELLE NE FAIT PAS", 13, RED, bold=True)
bar(s, M, 1.98, 0.07, 1.34, RED)
txt(s, M + 0.58, 1.92, 11.1, 2.1,
    "« Terra Sentinelle ne prédit pas les conflits\net ne délivre aucune autorisation de passage. »",
    31, TEXT, TITLE_FONT, bold=True, spacing=1.30)
bar(s, M, 4.40, W - 2 * M, 0.012, LINE)
items = [("Il ne dit pas qui avait le droit d'être là.", RED),
         ("Il ne tranche pas la légitimité foncière.", AMBER),
         ("Il informe un arbitrage humain. Rien de plus.", ACCENT)]
for i, (t, c) in enumerate(items):
    yy = 4.78 + i * 0.52
    bar(s, M, yy + 0.09, 0.16, 0.035, c)
    txt(s, M + 0.40, yy, 11.2, 0.38, t, 16, TEXT if i == 2 else DIM, spacing=1.15)
chrome(s, 13)
notes(s, "RALENTIR ICI. LAISSER UN SILENCE APRÈS LA PHRASE.\n\nC'est la slide la plus importante de la "
         "présentation.\n« Terra Sentinelle ne prédit pas les conflits et ne délivre aucune autorisation "
         "de passage. »\n(silence — deux à trois secondes, regarder le jury)\nLe système ne dit pas qui "
         "avait le droit d'être là. Il ne tranche pas la légitimité foncière : ni notre rôle, ni notre "
         "compétence, ni celle d'un modèle.\nIl informe un arbitrage humain. Rien de plus — et c'est déjà "
         "beaucoup, puisque aujourd'hui cet arbitrage se fait sans information récente.")

# =====================================================================
# 14 — Prototype et suite
# =====================================================================
s = add_slide()
chrome(s, 14, "Prototype et suite", "Ce qui tourne, ce qui est simulé, ce qui vient.", 28)
cy, chh = 2.62, 3.00
cw = (W - 2 * M - 0.6) / 3
card(s, M, cy, cw, chh, "Ce qui tourne\naujourd'hui",
     "Application web + API\nCarte de friction interactive\nValidation terrain hors ligne\nRecalcul d'itinéraire\nJournal de décisions",
     ACCENT, 15, 12.5)
card(s, M + cw + 0.30, cy, cw, chh, "Ce qui est\nsimulé",
     "Données de démonstration\nEmprise du couloir reconstituée\nMétriques du modèle\nSynthèse vocale fulfulde",
     AMBER, 15, 12.5)
card(s, M + 2 * (cw + 0.30), cy, cw, chh, "Les prochaines\nétapes",
     "Entraînement sur Banikoara\nAnnotation avec les agents\nEmprise officielle de la mairie\nTest d'une saison réelle",
     SAND, 15, 12.5)
txt(s, M, 5.92, 11.8, 0.44,
     "Ce qui est simulé est signalé dans l'interface, pas seulement dans cette présentation.",
     13, DIM, italic=True)
notes(s, "Où en sommes-nous vraiment.\nCe qui tourne : l'application web et son API, la carte de friction "
         "interactive, la validation terrain hors ligne avec synchronisation, le recalcul d'itinéraire et "
         "le journal des décisions.\nCe qui est simulé, je le dis clairement : les données de "
         "démonstration, l'emprise reconstituée, les métriques du modèle, la synthèse vocale. Tout cela "
         "est signalé dans l'interface, pas seulement ici.\nEnsuite : entraîner sur Banikoara, annoter "
         "avec les agents, obtenir l'emprise officielle, tester sur une saison réelle.\nMerci.")

prs.save(OUT)

# ---- police de theme = Arial : repli propre si Space Grotesk / Inter sont absents ----
import re as _re, zipfile as _zip, shutil as _sh, os as _os
_tmp = OUT + ".tmp"
with _zip.ZipFile(OUT) as zin, _zip.ZipFile(_tmp, "w", _zip.ZIP_DEFLATED) as zout:
    for it in zin.infolist():
        d = zin.read(it.filename)
        if it.filename.startswith("ppt/theme/theme"):
            t = d.decode("utf-8")
            t = _re.sub(r'(<a:(?:major|minor)Font><a:latin typeface=")[^"]*(")',
                        r'\g<1>Arial\g<2>', t)
            d = t.encode("utf-8")
        zout.writestr(it, d)
_os.replace(_tmp, OUT)

print("OK ->", OUT, "|", len(prs.slides.__iter__.__self__._sldIdLst), "slides")
