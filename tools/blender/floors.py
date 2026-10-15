"""
Floor blocks for town houses that grow (bldg_floors.py), modelled in Blender, in a file of their own so the game pays
nothing for them until it uses them.

    npm run models     # builds every model file (with `python3`, or $BLENDER_PYTHON), then compresses them

Writes tools/blender/floors.blend and tools/blender/out/floors.glb: one node per block, named by its id
(`bldg-townhouse-floor`), fronts facing +x, standing on y = 0. ONLY=<id>[,<id>...] builds just those, and NOEXPORT=1
checks the build without writing the .blend or the .glb.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import kit  # noqa: E402
import toy  # noqa: E402
import bldg_floors  # noqa: E402


def main():
    toy.reset()
    only = set(filter(None, os.environ.get("ONLY", "").split(",")))
    for i, (block_id, build) in enumerate(bldg_floors.ASSETS):
        if only and block_id not in only:
            continue
        toy.begin()
        root = build(kit.Kit())
        pivots = kit.realize(root, block_id)
        toy.finish(block_id, (i % 8 * 220, -(i // 8) * 220, 0), pivots)
    print(f"{len(bldg_floors.ASSETS)} storey blocks")
    if not os.environ.get("NOEXPORT"):
        toy.save_and_export("floors")


main()
