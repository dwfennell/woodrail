"""
Stations and buildings (src/catalogue/assets/buildings.ts), modelled in Blender.

    npm run models     # builds every model file (with `python3`, or $BLENDER_PYTHON), then compresses them

Writes tools/blender/buildings.blend and tools/blender/out/buildings.glb: one node per catalogue asset, named by its
id (`bldg-country-halt`), fronts facing +x, standing on y = 0. Parts the catalogue animates are nodes of their own
(see kit.py).

The models are in bldg_stations.py, bldg_works.py, bldg_town.py and bldg_houses.py, written with kit.py and
bldg_parts.py. ONLY=<id>[,<id>...] builds just those, MODULE=<module> just that file's, and NOEXPORT=1 checks the
build without writing the .blend or the .glb.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import kit  # noqa: E402
import toy  # noqa: E402
import bldg_houses  # noqa: E402
import bldg_stations  # noqa: E402
import bldg_town  # noqa: E402
import bldg_works  # noqa: E402

MODULES = {"bldg_stations": bldg_stations, "bldg_works": bldg_works, "bldg_town": bldg_town, "bldg_houses": bldg_houses}
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
        toy.finish(asset_id, (i % 8 * 220, -(i // 8) * 220, 0), pivots)
    print(f"{len(MODELS)} models")
    if not os.environ.get("NOEXPORT"):
        toy.save_and_export("buildings")


main()
