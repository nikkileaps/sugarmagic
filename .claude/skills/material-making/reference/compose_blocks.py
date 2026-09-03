"""Compose the concrete_block PBR set. The spec panels contain zero complete
joint-bounded blocks (blocks are larger than the panel), so the wall is
reconstructed from the two things the panels DO contain in full: face mottle
(stochastic, quilted across the whole canvas) and joint strips (harvested
whole with their worn edges, stamped along a running-bond grid). Every pixel
is still spec pixels; only the layout is ours.

Relief follows the grid family: normal assembled the same way from the normal
panel, height integrated from it, AO derived. [LAW:one-source-of-truth]
"""
import numpy as np
from PIL import Image
from pathlib import Path
from compose_wall import integrate_normal, build_ao, lit_preview

SCRATCH = Path(__file__).parent
OUT_DIR = Path("/Users/nikki/Library/CloudStorage/GoogleDrive-nikki@foxleapmoon.com/My Drive/games/wordlark/art/source/materials/wordlark/concrete_block/textures")

SEED = 17
TILE = 1024
FINAL = 2048
ROWS, COLS = 6, 3          # even rows: running bond must wrap vertically
ROW_P = TILE // ROWS       # 170
COL_P = TILE // COLS       # 341
SCALE = 170 / 128          # panel block row is 128 px; composed row is 170
FACE_GRID = 8              # face quilt lattice
FACE_FEATHER = 20
STRIP_EDGE = 8             # feather at strip borders and segment ends

# measured joint positions per panel (profile peaks, verified)
MAPS = {
    "basecolor": {
        "panel": "cb_panel_basecolor.png", "normal_channels": False,
        "hjoints": [99, 227], "vjoint": 251, "block_jitter": 0.03,
        "faces": [(0, 8, 95, 85), (140, 8, 383, 85), (0, 113, 235, 213),
                  (268, 113, 340, 213), (0, 241, 95, 295), (140, 241, 383, 295)],
    },
    "normal": {
        "panel": "cb_panel_normal.png", "normal_channels": True,
        "hjoints": [99, 227], "vjoint": 255, "block_jitter": 0.0,
        "faces": [(0, 8, 100, 85), (145, 8, 380, 85), (0, 113, 240, 213),
                  (270, 113, 360, 213), (0, 241, 100, 295), (145, 241, 380, 295)],
    },
    "roughness": {
        "panel": "cb_panel_roughness.png", "normal_channels": False,
        "hjoints": [98, 226], "vjoint": 251, "block_jitter": 0.0,
        "faces": [(0, 8, 95, 84), (140, 8, 379, 84), (0, 112, 235, 212),
                  (268, 112, 360, 212), (0, 240, 95, 295), (140, 240, 210, 295),
                  (260, 240, 379, 295)],
    },
    # height is reconstructed from the height panel, not integrated: block
    # faces are stochastic mottle, and integrating near-flat mottled normals
    # produces churn instead of the spec's calm flat faces (concrete lesson)
    "height": {
        "panel": "cb_panel_height.png", "normal_channels": False,
        "hjoints": [97, 223], "vjoint": 250, "block_jitter": 0.015,
        "faces": [(0, 8, 95, 83), (140, 8, 383, 83), (0, 111, 235, 209),
                  (270, 111, 383, 209), (0, 237, 95, 296), (140, 237, 383, 296)],
    },
}
H_STRIP_HALF = 14          # harvested strip half-height around a joint line
V_STRIP_HALF = 13


def neutralize(src):
    src = src.astype(np.float64).copy()
    src[..., 0] += 128 - src[..., 0].mean()
    src[..., 1] += 128 - src[..., 1].mean()
    return np.clip(src, 0, 255)


def resize(arr, w, h):
    return np.array(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).resize((w, h), Image.LANCZOS), np.float64)


def quilt_faces(panel, cfg, rng):
    """Fill the whole canvas with face mottle; block identity comes from the
    stamped joints, not from face boundaries, so the quilt ignores the grid."""
    acc = np.zeros((TILE, TILE, 3))
    wsum = np.zeros((TILE, TILE, 1))
    edges = np.linspace(0, TILE, FACE_GRID + 1).round().astype(int)
    faces = cfg["faces"]
    for gr in range(FACE_GRID):
        for gc in range(FACE_GRID):
            cw = edges[gc+1] - edges[gc] + 2 * FACE_FEATHER
            ch = edges[gr+1] - edges[gr] + 2 * FACE_FEATHER
            sw, sh = int(cw / SCALE), int(ch / SCALE)
            # a face band may be shorter than the ideal window; clamp to the
            # rect and accept mild anisotropic stretch - mottle tolerates it
            options = [f for f in faces
                       if f[2]-f[0] >= sw * 0.6 and f[3]-f[1] >= sh * 0.6]
            fx0, fy0, fx1, fy1 = options[int(rng.integers(0, len(options)))]
            sw2, sh2 = min(sw, fx1 - fx0), min(sh, fy1 - fy0)
            x0 = int(rng.integers(fx0, fx1 - sw2 + 1))
            y0 = int(rng.integers(fy0, fy1 - sh2 + 1))
            src = panel[y0:y0+sh2, x0:x0+sw2]
            if rng.random() < 0.5:
                src = src[:, ::-1].copy()
                if cfg["normal_channels"]: src[..., 0] = 255 - src[..., 0]
            if rng.random() < 0.5:
                src = src[::-1, :].copy()
                if cfg["normal_channels"]: src[..., 1] = 255 - src[..., 1]
            if cfg["normal_channels"]:
                src = neutralize(src)
            cell = resize(src, cw, ch)
            f = FACE_FEATHER
            ramp = lambda n: np.minimum(np.arange(n) + 0.5, f) / f
            alpha = (np.minimum(ramp(ch), ramp(ch)[::-1])[:, None]
                     * np.minimum(ramp(cw), ramp(cw)[::-1])[None, :])[..., None]
            ys = np.arange(edges[gr] - f, edges[gr] - f + ch) % TILE
            xs = np.arange(edges[gc] - f, edges[gc] - f + cw) % TILE
            acc[np.ix_(ys, xs)] += cell * alpha
            wsum[np.ix_(ys, xs)] += alpha
    return acc / np.maximum(wsum, 1e-6)


def strip_alpha(h, w, edge):
    """Opaque core, fading over `edge` px at the strip borders and ends."""
    dy = np.abs(np.arange(h) - (h - 1) / 2)
    ay = np.clip(((h - 1) / 2 - dy) / edge, 0, 1)
    ramp = np.minimum(np.arange(w) + 0.5, edge * 3) / (edge * 3)
    ax = np.minimum(ramp, ramp[::-1])
    return (ay[:, None] * ax[None, :])[..., None]


def harvest_h_segment(panel, cfg, rng, length_px):
    """A horizontal joint strip segment at compose scale, flips applied."""
    ph, pw, _ = panel.shape
    j = cfg["hjoints"][int(rng.integers(0, len(cfg["hjoints"])))]
    sw = min(int(length_px / SCALE), pw)
    sx = int(rng.integers(0, pw - sw + 1))
    src = panel[j - H_STRIP_HALF: j + H_STRIP_HALF + 1, sx:sx + sw]
    if rng.random() < 0.5:
        src = src[:, ::-1].copy()
        if cfg["normal_channels"]: src[..., 0] = 255 - src[..., 0]
    if cfg["normal_channels"]:
        src = neutralize(src)
    return src


def stamp_h_joints(canvas, panel, cfg, rng):
    seg_w = 512
    overlap = STRIP_EDGE * 6
    for r in range(ROWS):
        y = r * ROW_P
        x = int(rng.integers(0, seg_w))  # random phase per line
        placed = 0
        while placed < TILE + seg_w:
            src = harvest_h_segment(panel, cfg, rng, seg_w)
            h = int(src.shape[0] * SCALE)
            cell = resize(src, seg_w, h)
            alpha = strip_alpha(h, seg_w, STRIP_EDGE)
            ys = np.arange(y - h // 2, y - h // 2 + h) % TILE
            xs = np.arange(x + placed - seg_w, x + placed - seg_w + seg_w) % TILE
            region = canvas[np.ix_(ys, xs)]
            canvas[np.ix_(ys, xs)] = region * (1 - alpha) + cell * alpha
            placed += seg_w - overlap
    return canvas


def stamp_v_joints(canvas, panel, cfg, rng):
    """Vertical joints reuse the strong horizontal strips rotated 90 degrees;
    the panel's own vertical joint is too faint to read as a block boundary.
    Rotating a normal map rotates its vectors too: 90 degrees clockwise maps
    (nx, ny) -> (ny, -nx), i.e. R' = G and G' = 255 - R.

    Verticals span the full row and are stamped BEFORE the horizontal beds,
    which then cover their ends: every junction reads as a clean T, the way
    a real block wall runs continuous beds with verticals tucked between."""
    seg_h = ROW_P
    for r in range(ROWS):
        x_shift = (r % 2) * (COL_P // 2)
        for c in range(COLS):
            x = (c * COL_P + x_shift) % TILE
            # joint strength varies along the source line; take the most
            # pronounced of three candidates so no boundary reads as absent
            def strength(s):
                mid = s[s.shape[0] // 2 - 4: s.shape[0] // 2 + 5]
                rim = np.concatenate([s[:4], s[-4:]])
                return np.abs(mid.mean(-1).mean() - rim.mean(-1).mean())
            src = max((harvest_h_segment(panel, cfg, rng, seg_h) for _ in range(3)),
                      key=strength)
            src = np.rot90(src, k=-1).copy()
            if cfg["normal_channels"]:
                rch = src[..., 0].copy()
                src[..., 0] = src[..., 1]
                src[..., 1] = 255 - rch
            w = int(src.shape[1] * SCALE)
            cell = resize(src, w, seg_h)
            alpha = strip_alpha(w, seg_h, STRIP_EDGE).transpose(1, 0, 2)
            ys = np.arange(r * ROW_P, r * ROW_P + seg_h) % TILE
            xs = np.arange(x - w // 2, x - w // 2 + w) % TILE
            region = canvas[np.ix_(ys, xs)]
            canvas[np.ix_(ys, xs)] = region * (1 - alpha) + cell * alpha
    return canvas


def block_jitter(canvas, amount, rng):
    """Subtle per-block tone variation, feathered inside each block."""
    if not amount:
        return canvas
    gain = np.ones((TILE, TILE, 1))
    for r in range(ROWS):
        x_shift = (r % 2) * (COL_P // 2)
        for c in range(COLS):
            g = rng.uniform(1 - amount, 1 + amount)
            ys = np.arange(r * ROW_P, (r + 1) * ROW_P) % TILE
            xs = np.arange(c * COL_P + x_shift, (c + 1) * COL_P + x_shift) % TILE
            gain[np.ix_(ys, xs)] = g
    fy = np.fft.fftfreq(TILE)[:, None]
    fx = np.fft.fftfreq(TILE)[None, :]
    soft = np.real(np.fft.ifft2(np.fft.fft2(gain[..., 0])
                                * np.exp(-2 * (np.pi * 6.0) ** 2 * (fx**2 + fy**2))))
    return canvas * soft[..., None]


def compose(name):
    cfg = MAPS[name]
    panel = np.array(Image.open(SCRATCH / cfg["panel"]).convert("RGB"), np.float64)
    rng = np.random.default_rng(SEED)   # same seed: same grid skeleton per map
    canvas = quilt_faces(panel, cfg, rng)
    canvas = block_jitter(canvas, cfg["block_jitter"], rng)
    canvas = stamp_v_joints(canvas, panel, cfg, rng)
    canvas = stamp_h_joints(canvas, panel, cfg, rng)
    return np.clip(canvas, 0, 255)


def save(arr, name, mode="RGB"):
    im = Image.fromarray(arr.round().astype(np.uint8), mode)
    im.resize((FINAL, FINAL), Image.LANCZOS).save(OUT_DIR / name, optimize=True)
    print(name, "written")


def main():
    base = compose("basecolor")
    normal = compose("normal")
    n = normal / 127.5 - 1.0
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    normal = (n * 0.5 + 0.5) * 255
    rough = compose("roughness")
    height = compose("height").mean(-1) / 255.0
    ao = build_ao(height, sigma=10.0, depth=0.5)
    # diagnostic only: integrating the normal exposes a mirrored red channel
    # (vertical joints would integrate as ridges); eyeball before shipping
    diag = integrate_normal(normal, highpass_sigma=60.0)
    Image.fromarray((diag * 255).astype(np.uint8)).resize((512, 512)).save(SCRATCH / "blocks_redcheck.png")

    OUT_DIR.mkdir(exist_ok=True)
    save(base, "concrete_block_basecolor.png")
    save(normal, "concrete_block_normal.png")
    save((height * 255), "concrete_block_height.png", "L")
    save((ao * 255), "concrete_block_ao.png", "L")
    save(rough.mean(-1), "concrete_block_roughness.png", "L")

    Image.fromarray(base.round().astype(np.uint8)).save(SCRATCH / "composed_blocks.png")
    Image.fromarray(lit_preview(base, normal).round().astype(np.uint8)).save(SCRATCH / "blocks_lit_preview.png")
    prev = 256
    maps = [base, normal, (height * 255)[..., None].repeat(3, -1),
            (ao * 255)[..., None].repeat(3, -1), rough]
    sheet = Image.new("RGB", (prev * 5 + 24, prev * 2 + 12), (24, 24, 24))
    for i, m in enumerate(maps):
        sheet.paste(Image.fromarray(np.clip(m, 0, 255).round().astype(np.uint8)).resize((prev, prev), Image.LANCZOS), (i * (prev + 6), 0))
    tile2 = Image.fromarray(np.tile(base.round().astype(np.uint8), (2, 2, 1)))
    sheet.paste(tile2.resize((prev * 2, prev), Image.LANCZOS), (0, prev + 12))
    sheet.save(SCRATCH / "blocks_proof.png")
    print("previews written")


if __name__ == "__main__":
    main()
