"""Detect each spec panel's own brick grid and list its complete brick cells.

Each panel is a different painted wall, so each gets its own grid detection.
Recess-ness (how mortar-like a pixel is) is the one thing that varies per map
type; detection and cell cutting are identical after that.
[LAW:one-type-per-behavior]

Outputs: printed cell lists per panel + a debug overlay image per panel.
"""
import numpy as np
from PIL import Image
from pathlib import Path

SCRATCH = Path(__file__).parent


def recessness(panel_name: str, img: np.ndarray) -> np.ndarray:
    """1.0 where the pixel looks like mortar for this map type."""
    f = img.astype(float)
    if panel_name == "basecolor":     # mortar is desaturated
        r = -(f.max(-1) - f.min(-1))
    elif panel_name == "normal":      # mortar/edges deviate from flat (128,128,255)
        r = np.abs(f - np.array([128.0, 128.0, 255.0])).sum(-1)
    elif panel_name == "roughness":   # mortar is lighter than brick faces
        r = f.mean(-1)
    else:                             # height, ao: mortar is dark
        r = -f.mean(-1)
    lo, hi = np.percentile(r, 5), np.percentile(r, 95)
    return np.clip((r - lo) / max(hi - lo, 1e-6), 0, 1)


def find_bands(profile: np.ndarray, threshold: float, min_gap: int) -> list:
    peaks = [i for i in range(3, len(profile) - 3)
             if profile[i] > threshold and profile[i] == profile[i-3:i+4].max()]
    merged = []
    for i in peaks:
        if not merged or i - merged[-1] > min_gap:
            merged.append(i)
    return merged


def detect_cells(name: str, img: np.ndarray, row_thr=0.5, col_thr=0.45):
    rec = recessness(name, img)
    bands = find_bands(rec.mean(1), row_thr, 20)
    cells = []
    for y0, y1 in zip(bands, bands[1:]):
        joints = find_bands(rec[y0+8:y1-8].mean(0), col_thr, 12)
        for x0, x1 in zip(joints, joints[1:]):
            if x1 - x0 > 80:
                cells.append((x0, y0, x1, y1))
    return rec, bands, cells


for name in ["basecolor", "normal", "roughness", "height", "ao"]:
    img = np.array(Image.open(SCRATCH / f"panel_{name}.png").convert("RGB"))
    rec, bands, cells = detect_cells(name, img)
    print(f"{name}: bands={bands} cells={cells}")
    vis = img.copy()
    for y in bands: vis[y, :] = [0, 255, 0]
    for (x0, y0, x1, y1) in cells:
        vis[y0:y1, x0] = [255, 255, 0]; vis[y0:y1, x1-1] = [255, 255, 0]
        vis[y0, x0:x1] = [255, 255, 0]; vis[y1-1, x0:x1] = [255, 255, 0]
    Image.fromarray(vis).save(SCRATCH / f"grid_{name}.png")
