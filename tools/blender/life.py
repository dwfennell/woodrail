"""
People and animals (src/catalogue/assets/life.ts), modelled in Blender.

    npm run models     # builds every model file (with `python3`, or $BLENDER_PYTHON), then compresses them

Writes tools/blender/life.blend (every model laid out in a grid) and tools/blender/out/life.glb: one node per
catalogue asset, named by its id (`life-driver`), facing +x and standing on y = 0. Parts the catalogue animates are
nodes of their own, named `<asset id>|<part>` (the game keeps the part's name).

The models themselves are in life_people.py, life_farm.py and life_wild.py, written with kit.py and life_parts.py.
ONLY=<asset id>[,<asset id>...] builds just those, MODULE=<module> just that file's, and NOEXPORT=1 checks the build
without writing the .blend or the .glb (for working on one file while others are built).
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import kit  # noqa: E402
import toy  # noqa: E402
import life_farm  # noqa: E402
import life_people  # noqa: E402
import life_town  # noqa: E402
import life_wild  # noqa: E402

MODULES = {"life_people": life_people, "life_town": life_town, "life_farm": life_farm, "life_wild": life_wild}
MODELS = [m for mod in MODULES.values() for m in mod.ASSETS]


def main():
    toy.reset()
    only = set(filter(None, os.environ.get("ONLY", "").split(",")))
    module = os.environ.get("MODULE")
    chosen = {i for i, _ in MODULES[module].ASSETS} if module else None
    ids = [i for i, _ in MODELS]
    assert len(ids) == len(set(ids)), "asset ids must be unique"
    for i, (asset_id, build) in enumerate(MODELS):
        if (only and asset_id not in only) or (chosen is not None and asset_id not in chosen):
            continue
        toy.begin()
        root = build(kit.Kit())
        pivots = kit.realize(root, asset_id)
        toy.finish(asset_id, (i % 8 * 60, -(i // 8) * 60, 0), pivots)
    print(f"{len(MODELS)} models")
    if not os.environ.get("NOEXPORT"):
        toy.save_and_export("life")


main()
