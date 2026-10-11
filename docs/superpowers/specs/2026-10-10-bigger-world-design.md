# Bigger World — Design

**Date:** 2026-10-10 · **Status:** approved (user approved the design in chat and delegated spec/plan approval)

## Intent

The user felt the map was "a bit too small" and wanted to "lose the surrounding bedroom theming". Chosen options:
about 2× the buildable area, and a toy landscape that runs to the horizon instead of a room.

## 1. Bigger mat

- Grid 70 × 52 squares (4.48 × 3.33 m), up from 50 × 37.
- 5–7 towns on a new map (starter map: 5, its first two still lined up with a clear strip between them).
- 1–3 rivers. Hills keep the same noise scale, so they keep their character.
- More town names so 7 towns never repeat.
- Save version bumps to 3; older saves are discarded (no back-compat before v1).
- The 200-seed generation checks still pass (reachability, flat towns and corridors, gentle hills, signs on
  platforms), with the town count range updated.

## 2. Landscape to the horizon

- Floorboards, walls and skirting removed. The felt continues past the mat as one large ground sheet; the stitched
  hem stays as the subtle boundary of the buildable area. There is no mat slab edge any more.
- A decorative ring of scenery around the mat (about 3 m wide), deterministic per seed:
  - a 2-square flat margin just outside the hem, so the boundary reads;
  - block hills that rise outward: near band (to 1.5 m) of normal blocks up to 3 high, far band of double-size
    blocks rising to about 6 levels ("mountains");
  - clumps of turned-wood trees on the outer hills and flats;
  - 3–4 hamlets of 2–4 houses each.
  Scenery only: nothing can be built there; dropping track past the hem says "That's past the edge of the map".
- Haze: fog measured as distance **outside the mat rectangle** (plus a little camera distance), so the mat is never
  hazed and the ring fades into warm haze by its outer edge, at any zoom.
- Sky: a dome with a warm haze colour at and below the horizon, rising to pale blue. Its horizon colour equals the
  fog colour, so the hazed ground meets the sky with no seam.
- Lighting (sun, hemisphere, environment) stays as is.

## 3. Camera

- The orbit target is clamped to the mat rectangle (pan, edge-pan, zoom-to-pointer, glides all respect it).
- Max zoom-out distance raised so the whole bigger mat fits on a phone in portrait.
- Shadow frustum maximum raised so the whole-mat view still has shadows.

## Performance

- Outer scenery: instanced, matte materials, receives but does not cast shadows (near-band hills add their merged
  slabs to the existing shadow-proxy layer); far-band blocks use plain boxes; buried blocks skipped.
- Budget: ≤10% frame-time regression against current `main` per quality tier, same measuring view.

## Testing

Unit: grid size; town count 5–7 over 200 seeds; starter layout; surroundings deterministic per seed, never inside
the mat (plus margin), heights rise outward, trees and houses not inside the mat; camera target clamp; shadow radius
cap; off-mat message. Visual: screenshots desktop + phone portrait, low angle and top-down. Perf: both tiers.

## Out of scope

Building on the outer ring, landscape editing, economy, towns that grow.
