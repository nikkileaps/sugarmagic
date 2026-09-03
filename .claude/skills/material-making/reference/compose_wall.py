"""Compose the full red_brick PBR set by cutting bricks from the spec sheet's
own panels and pasting them onto one shared seamless wall grid.

Every pixel is harvested; nothing is generated. The three relief maps are one
surface: normal is composed from the normal panel's pixels, height is the
exact integral of that normal field, AO is the occlusion of that height.
[LAW:one-source-of-truth]

Map types differ only in data: which panel, which cells, whether flips need
channel inversion, whether brightness jitter is allowed.
[LAW:one-type-per-behavior]
"""
import numpy as np
from PIL import Image
from pathlib import Path

SCRATCH = Path(__file__).parent
OUT_DIR = Path("/Users/nikki/Library/CloudStorage/GoogleDrive-nikki@foxleapmoon.com/My Drive/games/wordlark/art/source/materials/wordlark/red_brick/textures")

SEED = 7
TILE = 1024
FINAL = 2048
ROWS, COLS = 8, 4
FEATHER = 8

MAPS = {
    # cells: (x0, y0, x1, y1) on verified mortar joints of that map's own panel
    "basecolor": {
        "panel": "panel_basecolor.png",
        "cells": [(11, 46, 161, 116), (88, 116, 249, 189),
                  (16, 189, 155, 257), (155, 189, 311, 257)],
        "normal_channels": False, "jitter": 0.04,
    },
    "normal": {
        "panel": "panel_normal.png",
        "cells": [(15, 42, 159, 110), (159, 42, 319, 110), (87, 110, 244, 183)],
        "normal_channels": True, "jitter": 0.0,
    },
    "roughness": {
        "panel": "panel_roughness.png",
        "cells": [(30, 49, 166, 115), (166, 49, 319, 115)],
        "normal_channels": False, "jitter": 0.0,
    },
}


def feather_alpha(h, w, f):
    ramp = lambda n: np.minimum(np.arange(n) + 0.5, f) / f
    ay = np.minimum(ramp(h), ramp(h)[::-1])[:, None]
    ax = np.minimum(ramp(w), ramp(w)[::-1])[None, :]
    return (ay * ax)[..., None]


def flip_h(src, normal_channels):
    out = src[:, ::-1].copy()
    if normal_channels:
        out[..., 0] = 255 - out[..., 0]   # mirroring x negates the x normal
    return out


def flip_v(src, normal_channels):
    out = src[::-1, :].copy()
    if normal_channels:
        out[..., 1] = 255 - out[..., 1]   # mirroring y negates the y normal
    return out


def compose(map_cfg):
    panel = np.array(Image.open(SCRATCH / map_cfg["panel"]).convert("RGB"), np.float64)
    cells = map_cfg["cells"]
    rng = np.random.default_rng(SEED)   # same seed: same layout skeleton per map
    row_p = TILE // ROWS
    col_edges = np.linspace(0, TILE, COLS + 1).round().astype(int)
    acc = np.zeros((TILE, TILE, 3))
    wsum = np.zeros((TILE, TILE, 1))
    last_row_picks = [None] * COLS
    for r in range(ROWS):
        x_shift = (r % 2) * (col_edges[1] // 2)
        prev = None
        for c in range(COLS):
            choices = [i for i in range(len(cells))
                       if i != prev and i != last_row_picks[c]] or list(range(len(cells)))
            pick = int(rng.choice(choices))
            prev, last_row_picks[c] = pick, pick
            x0s, y0s, x1s, y1s = cells[pick]
            mx = round(FEATHER * (x1s - x0s) / (col_edges[c+1] - col_edges[c]))
            my = round(FEATHER * (y1s - y0s) / row_p)
            src = panel[max(0, y0s-my):min(panel.shape[0], y1s+my),
                        max(0, x0s-mx):min(panel.shape[1], x1s+mx)]
            if rng.random() < 0.5: src = flip_h(src, map_cfg["normal_channels"])
            if rng.random() < 0.25: src = flip_v(src, map_cfg["normal_channels"])
            if map_cfg["normal_channels"]:
                # a whole brick averages facing straight out; neutralizing each
                # cell's mean x/y lean removes the panel's painted tint drift,
                # which otherwise patchworks the wall and corrupts integration
                src = src.astype(np.float64).copy()
                src[..., 0] += 128 - src[..., 0].mean()
                src[..., 1] += 128 - src[..., 1].mean()
                src = np.clip(src, 0, 255)
            w = col_edges[c+1] - col_edges[c] + 2 * FEATHER
            h = row_p + 2 * FEATHER
            cell = np.array(Image.fromarray(src.astype(np.uint8)).resize((w, h), Image.LANCZOS), np.float64)
            if map_cfg["jitter"]:
                cell *= rng.uniform(1 - map_cfg["jitter"], 1 + map_cfg["jitter"])
            alpha = feather_alpha(h, w, FEATHER)
            ys = np.arange(r * row_p - FEATHER, r * row_p - FEATHER + h) % TILE
            xs = np.arange(col_edges[c] + x_shift - FEATHER, col_edges[c] + x_shift - FEATHER + w) % TILE
            acc[np.ix_(ys, xs)] += cell * alpha
            wsum[np.ix_(ys, xs)] += alpha
    return np.clip(acc / np.maximum(wsum, 1e-6), 0, 255)


def integrate_normal(normal_rgb: np.ndarray, highpass_sigma: float = 60.0) -> np.ndarray:
    """Exact height from the normal field on the periodic domain (FFT Poisson).
    Convention matches OpenGL normals with image rows increasing downward:
    dh/dx = -nx/nz, dh/dy_img = +ny/nz."""
    n = normal_rgb / 127.5 - 1.0
    nz = np.maximum(n[..., 2], 0.1)
    gx = -n[..., 0] / nz
    gy = n[..., 1] / nz
    H, W = gx.shape
    wx = 2j * np.pi * np.fft.fftfreq(W)[None, :]
    wy = 2j * np.pi * np.fft.fftfreq(H)[:, None]
    denom = wx * np.conj(wx) + wy * np.conj(wy)
    denom[0, 0] = 1.0
    h = np.real(np.fft.ifft2((np.conj(wx) * np.fft.fft2(gx)
                              + np.conj(wy) * np.fft.fft2(gy)) / denom))
    # real relief lives at brick scale; suppress wall-scale drift the
    # integration accumulates from any residual normal bias
    sigma = highpass_sigma
    fy = np.fft.fftfreq(h.shape[0])[:, None]
    fx = np.fft.fftfreq(h.shape[1])[None, :]
    low = np.real(np.fft.ifft2(np.fft.fft2(h)
                               * np.exp(-2 * (np.pi * sigma) ** 2 * (fx**2 + fy**2))))
    h -= low
    lo, hi = np.percentile(h, 0.5), np.percentile(h, 99.5)
    return np.clip((h - lo) / max(hi - lo, 1e-6), 0, 1)


def build_ao(height: np.ndarray, sigma=10.0, depth=0.6) -> np.ndarray:
    fy = np.fft.fftfreq(height.shape[0])[:, None]
    fx = np.fft.fftfreq(height.shape[1])[None, :]
    blur = np.real(np.fft.ifft2(np.fft.fft2(height)
                                * np.exp(-2 * (np.pi * sigma) ** 2 * (fx**2 + fy**2))))
    cavity = np.clip(blur - height, 0, None)
    cavity /= max(cavity.max(), 1e-6)
    return np.clip(1.0 - depth * cavity, 0, 1)


def lit_preview(base: np.ndarray, normal_rgb: np.ndarray) -> np.ndarray:
    """Lambert shade with a raking light from upper left - the acid test that
    mimics the spec's flat reference render."""
    n = normal_rgb / 127.5 - 1.0
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    light = np.array([-0.45, 0.55, 0.7])
    light = light / np.linalg.norm(light)
    lam = np.clip(n @ light, 0, 1)[..., None]
    return np.clip(base * (0.35 + 0.75 * lam), 0, 255)


def save(arr, name, mode="RGB"):
    im = Image.fromarray(arr.round().astype(np.uint8), mode)
    im.resize((FINAL, FINAL), Image.LANCZOS).save(OUT_DIR / name, optimize=True)
    print(name, "written")


def main():
    base = compose(MAPS["basecolor"])
    normal = compose(MAPS["normal"])
    # the spec panel's red channel is mirrored relative to the OpenGL
    # convention (vertical joints integrate as ridges, horizontal as valleys,
    # which is impossible for a consistent field); flip it to standard
    normal[..., 0] = 255 - normal[..., 0]
    # feathering and resizing shorten blended vectors; restore unit length
    n = normal / 127.5 - 1.0
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    normal = (n * 0.5 + 0.5) * 255
    rough = compose(MAPS["roughness"])
    height = integrate_normal(normal)
    ao = build_ao(height)

    OUT_DIR.mkdir(exist_ok=True)
    save(base, "red_brick_basecolor.png")
    save(normal, "red_brick_normal.png")
    save((height * 255)[..., None].repeat(3, -1)[..., 0], "red_brick_height.png", "L")
    save((ao * 255), "red_brick_ao.png", "L")
    save(rough.mean(-1), "red_brick_roughness.png", "L")

    Image.fromarray(lit_preview(base, normal).round().astype(np.uint8)).save(SCRATCH / "lit_preview.png")
    prev = 256
    maps = [base, normal, (height * 255)[..., None].repeat(3, -1), (ao * 255)[..., None].repeat(3, -1), rough]
    sheet = Image.new("RGB", (prev * 5 + 24, prev), (24, 24, 24))
    for i, m in enumerate(maps):
        sheet.paste(Image.fromarray(m.round().astype(np.uint8)).resize((prev, prev), Image.LANCZOS), (i * (prev + 6), 0))
    sheet.save(SCRATCH / "harvest_proof_sheet.png")
    print("lit_preview + harvest_proof_sheet written")


if __name__ == "__main__":
    main()
