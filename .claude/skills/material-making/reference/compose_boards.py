"""Compose the wood_board_painted PBR set. Banded family with a refinement:
the bands are discrete boards bounded by seam lines, so each output row is a
complete harvested board (seam-center to seam-center, like brick cells), not
an arbitrary y-window. Butt-joined rows reconstruct full seams; feathering
lands in the seam. Chip patches travel inside the strips as spec pixels.

Banded rules hold: same source board per row so chip phase aligns at segment
joints, uniform horizontal flips per row, no vertical flips.
[LAW:one-source-of-truth] relief: normal composed, height integrated, AO
derived.
"""
import numpy as np
from PIL import Image
from pathlib import Path
from compose_wall import integrate_normal, build_ao, lit_preview

SCRATCH = Path(__file__).parent
OUT_DIR = Path("/Users/nikki/Library/CloudStorage/GoogleDrive-nikki@foxleapmoon.com/My Drive/games/wordlark/art/source/materials/wordlark/wood_board_painted/textures")

SEED = 29
TILE = 1024
FINAL = 2048
ROWS = 6
SEGS = 3
FEATHER = 12

# complete boards per panel: (y0, y1) on measured seam centers
MAPS = {
    "basecolor": {"panel": "wbp_panel_basecolor.png", "normal_channels": False,
                  "jitter": 0.03, "boards": [(48, 132), (132, 218)]},
    "normal":    {"panel": "wbp_panel_normal.png",    "normal_channels": True,
                  "jitter": 0.0, "boards": [(48, 133), (133, 217)]},
    "roughness": {"panel": "wbp_panel_roughness.png", "normal_channels": False,
                  "jitter": 0.0, "boards": [(49, 133), (133, 219)]},
    # chip strokes are mottle; integrating them churns (stochastic-faces
    # lesson), so height is board-quilted from the height panel instead
    "height":    {"panel": "wbp_panel_height.png",    "normal_channels": False,
                  "jitter": 0.01, "boards": [(51, 134), (134, 220)]},
}


def feather_alpha(h, w, f):
    ramp = lambda n: np.minimum(np.arange(n) + 0.5, f) / f
    ay = np.minimum(ramp(h), ramp(h)[::-1])[:, None]
    ax = np.minimum(ramp(w), ramp(w)[::-1])[None, :]
    return (ay * ax)[..., None]


def compose(cfg):
    panel = np.array(Image.open(SCRATCH / cfg["panel"]).convert("RGB"), np.float64)
    ph, pw, _ = panel.shape
    rng = np.random.default_rng(SEED)   # same seed: same board skeleton per map
    row_edges = np.linspace(0, TILE, ROWS + 1).round().astype(int)
    seg_edges = np.linspace(0, TILE, SEGS + 1).round().astype(int)
    acc = np.zeros((TILE, TILE, 3))
    wsum = np.zeros((TILE, TILE, 1))
    last_board = None
    for r in range(ROWS):
        rp = row_edges[r+1] - row_edges[r]
        # a whole board per row, never the same board twice in a row
        choices = [i for i in range(len(cfg["boards"])) if i != last_board]
        board = int(rng.choice(choices))
        last_board = board
        by0, by1 = cfg["boards"][board]
        scale_y = rp / (by1 - by0)
        my = round(FEATHER / scale_y)
        row_flip_h = rng.random() < 0.5
        starts = rng.permutation(SEGS)
        for s in range(SEGS):
            sw = seg_edges[s+1] - seg_edges[s]
            src_w = int(sw / scale_y) + 2 * round(FEATHER / scale_y)
            lane = (pw - src_w) * starts[s] // max(SEGS - 1, 1)
            x0 = int(np.clip(lane + rng.integers(-10, 11), 0, pw - src_w))
            src = panel[max(0, by0 - my): min(ph, by1 + my), x0:x0 + src_w]
            if row_flip_h:
                src = src[:, ::-1].copy()
                if cfg["normal_channels"]: src[..., 0] = 255 - src[..., 0]
            if cfg["normal_channels"]:
                src = src.astype(np.float64).copy()
                src[..., 0] += 128 - src[..., 0].mean()
                src[..., 1] += 128 - src[..., 1].mean()
                src = np.clip(src, 0, 255)
            w = sw + 2 * FEATHER
            h = rp + 2 * FEATHER
            cell = np.array(Image.fromarray(src.astype(np.uint8)).resize((w, h), Image.LANCZOS), np.float64)
            if cfg["jitter"]:
                cell *= rng.uniform(1 - cfg["jitter"], 1 + cfg["jitter"])
            alpha = feather_alpha(h, w, FEATHER)
            ys = np.arange(row_edges[r] - FEATHER, row_edges[r] - FEATHER + h) % TILE
            xs = np.arange(seg_edges[s] - FEATHER, seg_edges[s] - FEATHER + w) % TILE
            acc[np.ix_(ys, xs)] += cell * alpha
            wsum[np.ix_(ys, xs)] += alpha
    return np.clip(acc / np.maximum(wsum, 1e-6), 0, 255)


def save(arr, name, mode="RGB"):
    im = Image.fromarray(arr.round().astype(np.uint8), mode)
    im.resize((FINAL, FINAL), Image.LANCZOS).save(OUT_DIR / name, optimize=True)
    print(name, "written")


def main():
    base = compose(MAPS["basecolor"])
    normal = compose(MAPS["normal"])
    n = normal / 127.5 - 1.0
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    normal = (n * 0.5 + 0.5) * 255
    rough = compose(MAPS["roughness"])
    height = compose(MAPS["height"]).mean(-1) / 255.0
    ao = build_ao(height, sigma=8.0, depth=0.45)
    # diagnostic only: red-channel convention check via integration
    diag = integrate_normal(normal, highpass_sigma=30.0)
    Image.fromarray((diag * 255).astype(np.uint8)).resize((512, 512)).save(SCRATCH / "boards_redcheck.png")

    OUT_DIR.mkdir(exist_ok=True)
    save(base, "wood_board_painted_basecolor.png")
    save(normal, "wood_board_painted_normal.png")
    save((height * 255), "wood_board_painted_height.png", "L")
    save((ao * 255), "wood_board_painted_ao.png", "L")
    save(rough.mean(-1), "wood_board_painted_roughness.png", "L")

    Image.fromarray(base.round().astype(np.uint8)).save(SCRATCH / "composed_boards.png")
    Image.fromarray(lit_preview(base, normal).round().astype(np.uint8)).save(SCRATCH / "boards_lit_preview.png")
    prev = 256
    maps = [base, normal, (height * 255)[..., None].repeat(3, -1),
            (ao * 255)[..., None].repeat(3, -1), rough]
    sheet = Image.new("RGB", (prev * 5 + 24, prev * 2 + 12), (24, 24, 24))
    for i, m in enumerate(maps):
        sheet.paste(Image.fromarray(np.clip(m, 0, 255).round().astype(np.uint8)).resize((prev, prev), Image.LANCZOS), (i * (prev + 6), 0))
    tile2 = Image.fromarray(np.tile(base.round().astype(np.uint8), (2, 2, 1)))
    sheet.paste(tile2.resize((prev * 2, prev), Image.LANCZOS), (0, prev + 12))
    sheet.save(SCRATCH / "boards_proof.png")
    print("previews written")


if __name__ == "__main__":
    main()
