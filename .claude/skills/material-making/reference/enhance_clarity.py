"""Content-locked 2x enhancement of a composed base color tile via Replicate's
clarity-upscaler, preserving seamlessness.

Usage: python3 enhance_clarity.py <input_1024.png> <output_2048.png> "<prompt>"
Requires a Replicate API token in a file named replicate.key next to the input.

Two runs are made: the tile as-is, and the tile rolled by half in both axes.
The rolled run's pristine interior covers the first run's wrap edges, feathered
together, so the result tiles even though diffusion does not respect wrap
edges. Never run diffusion on normal maps - vectors, not colors.
[LAW:no-ambient-temporal-coupling] polling is bounded: 10 x 15s then fail loud.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

CLARITY_VERSION = "dfad41707589d68ecdccd1dfa600d55a208f9310748e44bfe35b4a6291453d5e"
CLARITY_INPUT = {"creativity": 0.25, "resemblance": 1.0, "scale_factor": 2,
                 "num_inference_steps": 18, "seed": 7}


def api(key, method, url, payload=None):
    cmd = ["curl", "-s", "--max-time", "70", "-X", method, url,
           "-H", f"Authorization: Bearer {key}", "-H", "Content-Type: application/json",
           "-H", "Prefer: wait"]
    if payload is not None:
        cmd += ["-d", json.dumps(payload)]
    return json.loads(subprocess.run(cmd, capture_output=True, text=True).stdout)


def upload(key, path):
    r = subprocess.run(["curl", "-s", "--max-time", "60",
                        "-H", f"Authorization: Bearer {key}",
                        "-X", "POST", "https://api.replicate.com/v1/files",
                        "-F", f"content=@{path};type=image/png"],
                       capture_output=True, text=True)
    return json.loads(r.stdout)["urls"]["get"]


def run_clarity(key, image_url, prompt, outfile):
    p = api(key, "POST", "https://api.replicate.com/v1/predictions",
            {"version": CLARITY_VERSION, "input": {**CLARITY_INPUT, "image": image_url, "prompt": prompt}})
    pid = p.get("id")
    if not pid:
        raise SystemExit("[enhance] create failed: " + json.dumps(p)[:300])
    for _ in range(10):
        if p.get("status") in ("succeeded", "failed", "canceled"):
            break
        time.sleep(15)
        p = api(key, "GET", f"https://api.replicate.com/v1/predictions/{pid}")
    if p.get("status") != "succeeded":
        raise SystemExit(f"[enhance] {outfile}: {p.get('status')} {p.get('error')}")
    out = p["output"]
    url = out[0] if isinstance(out, list) else out
    subprocess.run(["curl", "-sL", "--max-time", "120", "-o", str(outfile),
                    "-H", f"Authorization: Bearer {key}", url], check=True)


def main(in_path, out_path, prompt):
    in_path, out_path = Path(in_path), Path(out_path)
    key = (in_path.parent / "replicate.key").read_text().strip()
    work = out_path.parent

    img = np.array(Image.open(in_path).convert("RGB"))
    half = img.shape[0] // 2
    rolled_path = work / f"{in_path.stem}_rolled.png"
    Image.fromarray(np.roll(np.roll(img, half, 0), half, 1)).save(rolled_path)

    a_path, b_path = work / "_clarity_a.png", work / "_clarity_b.png"
    run_clarity(key, upload(key, in_path), prompt, a_path)
    run_clarity(key, upload(key, rolled_path), prompt, b_path)

    A = np.array(Image.open(a_path).convert("RGB"), float)
    B = np.array(Image.open(b_path).convert("RGB"), float)
    size = A.shape[0]
    B = np.roll(np.roll(B, -size // 2, 0), -size // 2, 1)
    band = size // 16
    d = np.arange(size)
    edge = np.minimum(d, d[::-1])
    wA = np.clip(np.minimum(edge[:, None], edge[None, :]) / band, 0, 1)[..., None]
    final = np.clip(A * wA + B * (1 - wA), 0, 255)
    Image.fromarray(final.astype(np.uint8)).save(out_path, optimize=True)

    i = final.astype(int)
    lr = np.abs(i[:, 0] - i[:, -1]).mean()
    tb = np.abs(i[0, :] - i[-1, :]).mean()
    base = np.abs(i[:, size // 2] - i[:, size // 2 + 1]).mean()
    drift = np.abs(np.array(Image.open(in_path).convert("RGB").resize((size, size), Image.LANCZOS), float) - final).mean()
    print(f"[enhance] seams lr {lr:.1f} tb {tb:.1f} (baseline {base:.1f}), drift {drift:.1f}")
    if lr > base * 2 or tb > base * 2:
        raise SystemExit("[enhance] wrap seams exceed interior baseline - do not ship this output")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
