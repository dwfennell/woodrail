# Life on the Line — Design

**Date:** 2026-10-11 · **Status:** implemented (user chose the items in chat)
**Builds on:** `2026-10-11-grid-72-design.md`, the toy style rules in `2026-10-11-depots-and-cargo-design.md` §9.1

## Intent

Cosmetic touches drawn from wooden toy railway sets, so the world feels busier while staying toy-realistic.
Everything follows the toy style rules: bare beech first, a few strong lacquered colours, printed detail, chunky
rounded parts, batched scenery.

## Built

- **Station sign:** the name board sits on a rail carried by two short posts, so nothing crosses the lettering on
  either face.
- **Departure bell:** two quick strikes of a small synthesized bell when an engine is set going from a standstill.
- **Country lanes and level crossings:** most towns get a felt lane from their platform side to the mat's edge
  (cheapest route over flat grass, turns penalised so lanes run straight; own random stream). Track may cross a lane.
  Where ground-level track crosses one, a level crossing appears: a white post with a red lamp and a red-and-white
  striped arm on each side of the track, lowered while any car is within 260 mm.
- **Signals:** a turned semaphore beside every switch, arm level for the straight route and raised for the branch.
  Tapping it flips the switch, like the lever.
- **Station dressing:** a clock over the station house door, two beech benches facing the track, and two to four
  peg-doll passengers (painted coat, beech head, sometimes a hat) waiting on the platform.
- **Stacked-disc trees:** a third turned tree shape (about one tree in five) on the mat and in the scenery.
- **Bridge:** the support under bridge pieces is a red painted viaduct with two round arches (a third material
  slot on track geometry, drawn everywhere a piece is: track, held piece, animations, tray thumbnails).
- **Animal paddocks:** one to three fenced 2 × 2-square paddocks per map with toy cows or sheep, on flat open grass
  away from towns, lanes, rivers and station approaches. Track goes around them ("That's a farm field").
- **Engine shed:** a beech shed with a red gable roof, two arched green doors and printed side windows, a few squares
  from the first town with room. Decorative for now; track goes around it.

Paddocks and the shed are each kept only if every town can still reach every other.

## Later

- Tunnel portals where track meets block hills.
- Ships (with the harbour cargo chain), and boats on rivers.
- Lifting bridge over rivers.
- Turntable (a gameplay piece: turns trains round).
- The engine shed as a real place to park trains.

Declined for now: steam puffs (keep the toy realism).

## Testing

Unit: lanes are flat, open and reach the mat edge on 200 seeds, and most maps have one; crossings found once per
lane run, at the lane, ignoring lifted and raised track; paddocks and shed are flat 2 × 2 blocks off the corridors
with towns still reachable on 200 seeds; track is blocked on paddocks; three tree kinds. Visual: screenshots of
each item.

## Saves

Save version 5. The map is regenerated from its seed on load, and paddocks and the shed take squares that saved
track may already use, so older saves are discarded (no compatibility before v1).
