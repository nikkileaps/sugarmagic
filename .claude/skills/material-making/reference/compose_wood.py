"""Compose the rough_wood PBR set from strips harvested out of the wood spec
sheet's panels. Wood has no brick grid; the unit of harvest is a full-width
horizontal band strip, because the painting's structure is horizontal streaks.

Within a composed row every segment samples the SAME source y-window, so the
band pattern phase-aligns across segment joints; rows blend into each other
through soft feathers, which the banded painting tolerates by nature.

Relief follows the brick pipeline: normal composed from the normal panel,
height integrated from it, AO derived. [LAW:one-source-of-truth]
"""
import numpy as np
from PIL import Image
from pathlib import Path
from compose_wall import integrate_normal, build_ao, lit_preview

SCRATCH = Path(__file__).parent
OUT_DIR = Path("/Users/nikki/Library/CloudStorage/GoogleDrive-nikki@foxleapmoon.com/My Drive/games/wordlark/art/source/materials/wordlark/rough_wood/textures")

SEED = 5
TILE = 1024
FINAL = 2048
ROWSTRIPS = 6
SEGS = 3
FEATHER = 16
SCALE = 2          # panel is ~quarter native res; 2x here + 2x at save = spec band scale

MAPS = {
    "basecolor": {"panel": "wood_panel_basecolor.png", "normal_channels": False, "jitter": 0.03},
    "normal":    {"panel": "wood_panel_normal.png",    "normal_channels": True,  "jitter": 0.0},
    "roughness": {"panel": "wood_panel_roughness.png", "normal_channels": False, "jitter": 0.0},
}


def feather_alpha(h, w, f):
    ramp = lambda n: np.minimum(np.arange(n) + 0.5, f) / f
    ay = np.minimum(ramp(h), ramp(h)[::-1])[:, None]
    ax = np.minimum(ramp(w), ramp(w)[::-1])[None, :]
    return (ay * ax)[..., None]


def compose(cfg):
    panel = np.array(Image.open(SCRATCH / cfg["panel"]).convert("RGB"), np.float64)
    ph, pw, _ = panel.shape
    rng = np.random.default_rng(SEED)   # one seed: same row/segment skeleton per map
    row_edges = np.linspace(0, TILE, ROWSTRIPS + 1).round().astype(int)
    seg_edges = np.linspace(0, TILE, SEGS + 1).round().astype(int)
    acc = np.zeros((TILE, TILE, 3))
    wsum = np.zeros((TILE, TILE, 1))
    for r in range(ROWSTRIPS):
        rp = row_edges[r+1] - row_edges[r]
        src_h = rp // SCALE + 2 * (FEATHER // SCALE)
        y0 = int(rng.integers(0, ph - src_h))
        # flips are uniform per row: a flipped segment beside an unflipped one
        # would meet its own mirror image at the joint and read as a chevron
        row_flip_h = rng.random() < 0.5
        # no vertical flips for wood: flipping reverses band slope direction,
        # and alternating slopes integrate into a herringbone height weave
        # (rng still consumed to keep the layout skeleton identical per map)
        row_flip_v = rng.random() < 0.0
        # segments draw from a shuffled partition of the panel width so a row
        # never pastes the same window twice side by side
        starts = rng.permutation(SEGS)
        for s in range(SEGS):
            sw = seg_edges[s+1] - seg_edges[s]
            src_w = sw // SCALE + 2 * (FEATHER // SCALE)
            lane = (pw - src_w) * starts[s] // max(SEGS - 1, 1)
            x0 = int(np.clip(lane + rng.integers(-10, 11), 0, pw - src_w))
            src = panel[y0:y0 + src_h, x0:x0 + src_w]
            if row_flip_h:
                src = src[:, ::-1].copy()
                if cfg["normal_channels"]: src[..., 0] = 255 - src[..., 0]
            if row_flip_v:
                src = src[::-1, :].copy()
                if cfg["normal_channels"]: src[..., 1] = 255 - src[..., 1]
            if cfg["normal_channels"]:
                # a strip of plain surface averages facing straight out;
                # neutralizing removes the panel's tint drift before integration
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
    height = integrate_normal(normal, highpass_sigma=30.0)
    height = 0.5 + (height - 0.5) * 0.55   # spec wood is nearly flat; tame the bands
    ao = build_ao(height, sigma=8.0, depth=0.45)

    OUT_DIR.mkdir(exist_ok=True)
    save(base, "rough_wood_basecolor.png")
    save(normal, "rough_wood_normal.png")
    save((height * 255), "rough_wood_height.png", "L")
    save((ao * 255), "rough_wood_ao.png", "L")
    save(rough.mean(-1), "rough_wood_roughness.png", "L")

    Image.fromarray(np.clip(base, 0, 255).round().astype(np.uint8)).save(SCRATCH / "composed_wood.png")
    Image.fromarray(lit_preview(base, normal).round().astype(np.uint8)).save(SCRATCH / "wood_lit_preview.png")
    prev = 256
    maps = [base, normal, (height * 255)[..., None].repeat(3, -1),
            (ao * 255)[..., None].repeat(3, -1), rough]
    sheet = Image.new("RGB", (prev * 5 + 24, prev), (24, 24, 24))
    for i, m in enumerate(maps):
        sheet.paste(Image.fromarray(np.clip(m, 0, 255).round().astype(np.uint8)).resize((prev, prev), Image.LANCZOS), (i * (prev + 6), 0))
    sheet.save(SCRATCH / "wood_harvest_proof.png")
    print("previews written")


if __name__ == "__main__":
    main()
