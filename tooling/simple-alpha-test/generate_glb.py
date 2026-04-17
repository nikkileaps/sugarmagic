#!/usr/bin/env python3
"""
/Users/nikki/projects/sugarmagic/tooling/simple-alpha-test/generate_glb.py

Purpose: Generates simple_alpha_test.glb — a single vertical quad textured with
the leaf PNG, authored as alphaMode=MASK / alphaCutoff=0.5. No Blender required.
Use this to isolate whether the alpha-cutout issue is coming from Blender's
glTF exporter, Three's glTF loader, our ShaderRuntime, or the foliage shader.

Status: active
"""

import base64
import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))

DEFAULT_TEXTURE = os.path.join(
    REPO_ROOT,
    "tooling",
    ".foilagemaker-prototype-textures",
    "textures",
    "leavesTexture05_transparency.png",
)

DEFAULT_OUTPUT = os.path.join(HERE, "simple_alpha_test.glb")


def _pad4(buf: bytes, pad_byte: bytes = b"\x00") -> bytes:
    rem = len(buf) % 4
    if rem == 0:
        return buf
    return buf + (pad_byte * (4 - rem))


def build_glb(texture_path: str, output_path: str, alpha_mode: str = "MASK", alpha_cutoff: float = 0.5) -> None:
    with open(texture_path, "rb") as fh:
        png_bytes = fh.read()

    # Quad in the XY plane, facing +Z. 2 units wide, 2 units tall, base at y=0.
    positions = [
        (-1.0, 0.0, 0.0),
        ( 1.0, 0.0, 0.0),
        (-1.0, 2.0, 0.0),
        ( 1.0, 2.0, 0.0),
    ]
    normals = [(0.0, 0.0, 1.0)] * 4
    # glTF: UV origin is top-left; V grows downward.
    uvs = [
        (0.0, 1.0),
        (1.0, 1.0),
        (0.0, 0.0),
        (1.0, 0.0),
    ]
    indices = [0, 1, 2, 2, 1, 3]

    pos_bytes = b"".join(struct.pack("<fff", *p) for p in positions)
    nrm_bytes = b"".join(struct.pack("<fff", *n) for n in normals)
    uv_bytes = b"".join(struct.pack("<ff", *t) for t in uvs)
    idx_bytes = struct.pack("<{}H".format(len(indices)), *indices)

    # Pack buffer views contiguously, each 4-byte aligned.
    bin_parts = []
    offsets = {}

    def add(name: str, data: bytes) -> int:
        offset = sum(len(p) for p in bin_parts)
        bin_parts.append(data)
        # Pad for next view
        rem = len(data) % 4
        if rem != 0:
            bin_parts.append(b"\x00" * (4 - rem))
        offsets[name] = (offset, len(data))
        return offset

    add("pos", pos_bytes)
    add("nrm", nrm_bytes)
    add("uv", uv_bytes)
    add("idx", idx_bytes)
    add("png", png_bytes)

    bin_chunk = b"".join(bin_parts)

    pos_off, pos_len = offsets["pos"]
    nrm_off, nrm_len = offsets["nrm"]
    uv_off, uv_len = offsets["uv"]
    idx_off, idx_len = offsets["idx"]
    png_off, png_len = offsets["png"]

    gltf = {
        "asset": {"generator": "sugarmagic simple-alpha-test", "version": "2.0"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "AlphaTestQuad"}],
        "meshes": [
            {
                "name": "AlphaTestQuadMesh",
                "primitives": [
                    {
                        "attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2},
                        "indices": 3,
                        "material": 0,
                    }
                ],
            }
        ],
        "materials": [
            {
                "name": "AlphaTestMaterial",
                "doubleSided": True,
                "alphaMode": alpha_mode,
                **({"alphaCutoff": alpha_cutoff} if alpha_mode == "MASK" else {}),
                "pbrMetallicRoughness": {
                    "baseColorFactor": [1.0, 1.0, 1.0, 1.0],
                    "metallicFactor": 0.0,
                    "roughnessFactor": 1.0,
                    "baseColorTexture": {"index": 0, "texCoord": 0},
                },
            }
        ],
        "textures": [{"source": 0, "sampler": 0}],
        "samplers": [
            {
                "magFilter": 9729,  # LINEAR
                "minFilter": 9987,  # LINEAR_MIPMAP_LINEAR
                "wrapS": 33071,     # CLAMP_TO_EDGE
                "wrapT": 33071,
            }
        ],
        "images": [
            {
                "bufferView": 4,
                "mimeType": "image/png",
                "name": "LeafTexture",
            }
        ],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,  # FLOAT
                "count": len(positions),
                "type": "VEC3",
                "min": [min(p[i] for p in positions) for i in range(3)],
                "max": [max(p[i] for p in positions) for i in range(3)],
            },
            {
                "bufferView": 1,
                "componentType": 5126,
                "count": len(normals),
                "type": "VEC3",
            },
            {
                "bufferView": 2,
                "componentType": 5126,
                "count": len(uvs),
                "type": "VEC2",
            },
            {
                "bufferView": 3,
                "componentType": 5123,  # UNSIGNED_SHORT
                "count": len(indices),
                "type": "SCALAR",
            },
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": pos_off, "byteLength": pos_len, "target": 34962},
            {"buffer": 0, "byteOffset": nrm_off, "byteLength": nrm_len, "target": 34962},
            {"buffer": 0, "byteOffset": uv_off, "byteLength": uv_len, "target": 34962},
            {"buffer": 0, "byteOffset": idx_off, "byteLength": idx_len, "target": 34963},
            {"buffer": 0, "byteOffset": png_off, "byteLength": png_len},
        ],
        "buffers": [{"byteLength": len(bin_chunk)}],
    }

    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    json_chunk = _pad4(json_bytes, b" ")
    bin_chunk_padded = _pad4(bin_chunk, b"\x00")

    total_len = 12 + 8 + len(json_chunk) + 8 + len(bin_chunk_padded)
    with open(output_path, "wb") as out:
        out.write(b"glTF")
        out.write(struct.pack("<II", 2, total_len))
        out.write(struct.pack("<I", len(json_chunk)))
        out.write(b"JSON")
        out.write(json_chunk)
        out.write(struct.pack("<I", len(bin_chunk_padded)))
        out.write(b"BIN\x00")
        out.write(bin_chunk_padded)

    print(f"wrote {output_path} ({total_len} bytes, alphaMode={alpha_mode}"
          + (f", alphaCutoff={alpha_cutoff})" if alpha_mode == "MASK" else ")"))


def main() -> int:
    texture = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_TEXTURE
    output = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_OUTPUT
    alpha_mode = sys.argv[3] if len(sys.argv) > 3 else "MASK"
    if not os.path.isfile(texture):
        print(f"ERROR: texture not found: {texture}", file=sys.stderr)
        return 1
    build_glb(texture, output, alpha_mode=alpha_mode)
    return 0


if __name__ == "__main__":
    sys.exit(main())
