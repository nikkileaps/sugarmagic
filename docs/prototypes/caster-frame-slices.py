"""Cut the repeating slices out of the frame sheets.

CSS background-repeat tiles a whole image, not a sprite-sheet sub-region, so
every piece the prototype repeats (side rails, stretch strips, parchment tile)
must be its own file. Fixed pieces keep using the big sheets via
background-position.

Two sheets: caster-frame-source.png (meters + medallion hardware) and
plain-frame-source.png (bare frame, used by the inventory list).

Run from this directory: python3 caster-frame-slices.py
"""
from PIL import Image
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "caster-frame-slices")
os.makedirs(OUT, exist_ok=True)

# sheet file -> {name -> (x0, y0, x1, y1) in source pixels}. Keep in sync
# with the SLICES tables in caster-frame.html / plain-frame.html and the
# frame geometry in packages/runtime-core/src/framed-panel/geometry.ts.
SHEETS = {
    "caster-frame-source.png": {
        "rail-left": (6, 690, 110, 722),
        "rail-right": (1424, 690, 1528, 722),
        # Wood rows only: no full-height top-band column is free of hardware
        # shadows, so the parchment fill shows beneath the strip.
        "top-stretch": (150, 31, 162, 122),
        "bottom-stretch": (400, 860, 432, 999),
        "parchment": (320, 212, 600, 352),
    },
    "plain-frame-source.png": {
        # The plain sheet's top band has no hardware, so the strip keeps the
        # full band height including the baked pinstripe.
        "plain-rail-left": (6, 690, 126, 722),
        "plain-rail-right": (1410, 690, 1530, 722),
        "plain-top-stretch": (400, 38, 412, 178),
        "plain-bottom-stretch": (300, 855, 332, 999),
        "plain-parchment": (400, 200, 680, 340),
    },
}

for sheet, repeating in SHEETS.items():
    img = Image.open(os.path.join(HERE, sheet))
    for name, box in repeating.items():
        crop = img.crop(box)
        if name.endswith("parchment"):
            # Mirror into a 2x2 quilt so every tile edge meets its own
            # reflection: no seams whatever the panel size.
            w, h = crop.size
            quilt = Image.new(crop.mode, (w * 2, h * 2))
            quilt.paste(crop, (0, 0))
            quilt.paste(crop.transpose(Image.FLIP_LEFT_RIGHT), (w, 0))
            quilt.paste(crop.transpose(Image.FLIP_TOP_BOTTOM), (0, h))
            quilt.paste(
                crop.transpose(Image.FLIP_LEFT_RIGHT).transpose(Image.FLIP_TOP_BOTTOM),
                (w, h)
            )
            crop = quilt
        crop.save(os.path.join(OUT, f"{name}.png"))
        print(f"{name}.png {crop.size[0]}x{crop.size[1]}")
