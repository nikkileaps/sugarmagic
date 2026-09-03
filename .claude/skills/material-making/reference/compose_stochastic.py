"""Compose an unstructured (stochastic) material's PBR set - concrete-like
surfaces with no grid and no bands, just isotropic mottle.

The composer is a 2D patch quilt: a lattice of cells, each filled from a
distinct source window of the panel, feathered into its neighbors and pasted
with wrap-around coordinates so the tile is seamless by construction. With no
directional structure there are no chevron or herringbone risks, so flips are
free per patch - the normal channel math still applies.
[LAW:one-source-of-truth] relief: normal composed from the normal panel,
height integrated from it, AO derived from height.
"""
import numpy as np
from PIL import Image
from pathlib import Path
from compose_wall import integrate_normal, build_ao, lit_preview


def gaussian_blur_wrap(arr, sigma):
    """Gaussian blur on the periodic domain, so smoothing respects the wrap."""
    fy = np.fft.fftfreq(arr.shape[0])[:, None]
    fx = np.fft.fftfreq(arr.shape[1])[None, :]
    transfer = np.exp(-2 * (np.pi * sigma) ** 2 * (fx ** 2 + fy ** 2))
    return np.real(np.fft.ifft2(np.fft.fft2(arr) * transfer))

SCRATCH = Path(__file__).parent
OUT_DIR = Path("/Users/nikki/Library/CloudStorage/GoogleDrive-nikki@foxleapmoon.com/My Drive/games/wordlark/art/source/materials/wordlark/concrete/textures")

SEED = 13
TILE = 1024
FINAL = 2048
GRID = 5            # 5x5 patch lattice
FEATHER = 24
SCALE = 2           # panel is ~quarter native res; 2x here + 2x at save

MAPS = {
    "basecolor": {"panel": "conc_panel_basecolor.png", "normal_channels": False, "jitter": 0.02},
    "normal":    {"panel": "conc_panel_normal.png",    "normal_channels": True,  "jitter": 0.0},
    "roughness": {"panel": "conc_panel_roughness.png", "normal_channels": False, "jitter": 0.0},
    # stochastic materials harvest the height panel too: with no feature edges
    # there is nothing for height and normal to misregister against, and the
    # near-flat normal integrates into churn instead of the spec's calm clouds
    "height":    {"panel": "conc_panel_height.png",    "normal_channels": False, "jitter": 0.0},
}


def feather_alpha(h, w, f):
    ramp = lambda n: np.minimum(np.arange(n) + 0.5, f) / f
    ay = np.minimum(ramp(h), ramp(h)[::-1])[:, None]
    ax = np.minimum(ramp(w), ramp(w)[::-1])[None, :]
    return (ay * ax)[..., None]


def compose(cfg):
    panel = np.array(Image.open(SCRATCH / cfg["panel"]).convert("RGB"), np.float64)
    ph, pw, _ = panel.shape
    rng = np.random.default_rng(SEED)   # same seed: same quilt skeleton per map
    edges = np.linspace(0, TILE, GRID + 1).round().astype(int)
    acc = np.zeros((TILE, TILE, 3))
    wsum = np.zeros((TILE, TILE, 1))
    # distinct source windows: a shuffled lattice of anchors covers the panel
    # instead of pure random draws, so no two patches twin the same window
    anchors = [(r, c) for r in range(GRID) for c in range(GRID)]
    rng.shuffle(anchors)
    for i, (gr, gc) in enumerate([(r, c) for r in range(GRID) for c in range(GRID)]):
        cw = edges[gc+1] - edges[gc] + 2 * FEATHER
        chh = edges[gr+1] - edges[gr] + 2 * FEATHER
        sw, sh = cw // SCALE, chh // SCALE
        ar, ac = anchors[i]
        x0 = (pw - sw) * ac // max(GRID - 1, 1)
        y0 = (ph - sh) * ar // max(GRID - 1, 1)
        x0 = int(np.clip(x0 + rng.integers(-8, 9), 0, pw - sw))
        y0 = int(np.clip(y0 + rng.integers(-8, 9), 0, ph - sh))
        src = panel[y0:y0 + sh, x0:x0 + sw]
        if rng.random() < 0.5:
            src = src[:, ::-1].copy()
            if cfg["normal_channels"]: src[..., 0] = 255 - src[..., 0]
        if rng.random() < 0.5:
            src = src[::-1, :].copy()
            if cfg["normal_channels"]: src[..., 1] = 255 - src[..., 1]
        if cfg["normal_channels"]:
            src = src.astype(np.float64).copy()
            src[..., 0] += 128 - src[..., 0].mean()
            src[..., 1] += 128 - src[..., 1].mean()
            src = np.clip(src, 0, 255)
        cell = np.array(Image.fromarray(src.astype(np.uint8)).resize((cw, chh), Image.LANCZOS), np.float64)
        if cfg["jitter"]:
            cell *= rng.uniform(1 - cfg["jitter"], 1 + cfg["jitter"])
        alpha = feather_alpha(chh, cw, FEATHER)
        ys = np.arange(edges[gr] - FEATHER, edges[gr] - FEATHER + chh) % TILE
        xs = np.arange(edges[gc] - FEATHER, edges[gc] - FEATHER + cw) % TILE
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
    ao = build_ao(height, sigma=8.0, depth=0.4)

    OUT_DIR.mkdir(exist_ok=True)
    save(base, "concrete_basecolor.png")
    save(normal, "concrete_normal.png")
    save((height * 255), "concrete_height.png", "L")
    save((ao * 255), "concrete_ao.png", "L")
    save(rough.mean(-1), "concrete_roughness.png", "L")

    Image.fromarray(base.round().astype(np.uint8)).save(SCRATCH / "composed_concrete.png")
    Image.fromarray(lit_preview(base, normal).round().astype(np.uint8)).save(SCRATCH / "concrete_lit_preview.png")
    prev = 256
    maps = [base, normal, (height * 255)[..., None].repeat(3, -1),
            (ao * 255)[..., None].repeat(3, -1), rough]
    sheet = Image.new("RGB", (prev * 5 + 24, prev * 2 + 12), (24, 24, 24))
    for i, m in enumerate(maps):
        sheet.paste(Image.fromarray(np.clip(m, 0, 255).round().astype(np.uint8)).resize((prev, prev), Image.LANCZOS), (i * (prev + 6), 0))
    tile2 = Image.fromarray(np.tile(base.round().astype(np.uint8), (2, 2, 1)))
    sheet.paste(tile2.resize((prev * 2, prev), Image.LANCZOS), (0, prev + 12))
    sheet.save(SCRATCH / "concrete_proof.png")
    print("previews written")


if __name__ == "__main__":
    main()
