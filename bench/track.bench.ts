import {
  buildStressLayout,
  createRouteStep,
  createSample,
  createWorldConnector,
  findSnap,
  getPieceDef,
  pathLength,
  routeFrom,
  samplePath,
} from "../src/track";
import { checkPlacement, checkSupport, generateLandscape, looseHeight } from "../src/landscape";
import { runGroup } from "./run";

const land = generateLandscape(11);

for (const ovals of [30, 200]) {
  const pieces = ovals * 11;
  const { layout, looseSockets } = buildStressLayout(ovals);
  const w = createWorldConnector();
  const targets = looseSockets.map((ref) => {
    layout.worldConnector(ref, w);
    return { x: w.x - 160, z: w.z + 6 }; // a straight-144 dropped here snaps its peg onto the socket
  });
  const step = createRouteStep();
  let i = 0;

  await runGroup(`track @ ${pieces} pieces`, {
    "findSnap (drag frame)": () => {
      const t = targets[i++ % targets.length];
      findSnap(layout, "straight-144", false, { x: t.x, z: t.z, heading: 0.05 }, 0);
    },
    "addPiece + removePiece": () => {
      const t = targets[i++ % targets.length];
      const id = layout.addPiece("straight-144", { x: t.x + 16, z: t.z - 6, heading: 0 });
      layout.removePiece(id);
    },
    routeFrom: () => {
      routeFrom(layout, 1 + (i++ % pieces), 1, step);
    },
    "looseHeight + checkSupport (drag frame)": () => {
      const t = targets[i++ % targets.length];
      const pose = { x: t.x, z: t.z, heading: 0.05 };
      checkSupport(land, layout, "straight-144", false, pose, looseHeight(land, layout, "straight-144", false, pose, -1), -1);
    },
  });
}

const geom = getPieceDef("curve-large", false).paths[0].geom;
const len = pathLength(geom);
const out = createSample();
let s = 0;
await runGroup("path sampling", {
  "samplePath (arc)": () => {
    s = (s + 1.7) % len;
    samplePath(geom, s, out);
  },
});

const stationPose = land.towns[0].station;
let k = 0;
await runGroup("landscape", {
  "checkPlacement (drag frame, curve)": () => {
    k = (k + 1) % 50;
    checkPlacement(land, "curve-large", false, { x: stationPose.x + k * 3, z: stationPose.z + 120, heading: 0.3 }, 0);
  },
});
