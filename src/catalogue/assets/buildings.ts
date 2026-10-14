import type { Object3D } from "three";
import type { Kit } from "../kit";
import { catalogueModel, loadModelSet, modelOf } from "../../render/blender-models";
import type { Asset } from "../types";

/**
 * Stations & buildings: chunky toy architecture. Beech or lacquered walls, gloss roofs and doors, windows as dark
 * printed-look insets with a white sill. Fronts face +x; anything a train runs through runs along x.
 * The models are made in Blender; this file gives the game their names, notes and animations.
 */

/** The models, made in Blender (tools/blender/bldg.py): waited for when this file loads. */
const MODELS = await loadModelSet("buildings", true);
const model = (id: string) => (k: Kit) => catalogueModel(modelOf(MODELS, id), k);

const CAT = "Stations & buildings" as const;

// ——— Animation ———

/** Parts named `name` under `root`, found once and cached on the root (so animate allocates nothing per frame). */
function parts(root: Object3D, name: string): Object3D[] {
  const cache = (root.userData.parts ??= {}) as Record<string, Object3D[]>;
  let list = cache[name];
  if (!list) {
    const found: Object3D[] = [];
    root.traverse((o) => {
      if (o.name === name) found.push(o);
    });
    list = cache[name] = found;
  }
  return list;
}

function animateSmoke(root: Object3D, t: number): void {
  for (const g of parts(root, "smoke")) {
    const n = g.children.length;
    for (let i = 0; i < n; i++) {
      const f = (t * 0.45 + i / n) % 1;
      const p = g.children[i];
      p.position.set(f * 6, f * 26, 0);
      p.scale.setScalar(0.5 + f * 0.9);
    }
  }
}

function animateClock(root: Object3D, t: number): void {
  for (const m of parts(root, "minute")) m.rotation.x = -t * 0.6;
  for (const h of parts(root, "hour")) h.rotation.x = -t * 0.05;
}

// ——— The assets ———

export const ASSETS: Asset[] = [
  // ——— Stations ———
  {
    id: "bldg-country-halt",
    name: "Country halt",
    category: CAT,
    tags: ["station", "halt", "platform", "rural", "shelter"],
    notes: "A single short platform with a lean-to shelter, a name board and one lamp. Place it beside any straight; a passenger train that stops here could pick up the one peg person waiting.",
    build: model("bldg-country-halt"),
  },
  {
    id: "bldg-two-platform-station",
    name: "Two-platform station with footbridge",
    category: CAT,
    tags: ["station", "footbridge", "double track", "platform", "canopy"],
    notes: "Two through tracks between a platform each side, joined by a covered footbridge. A good passing place: one train waits at the platform while the other runs through.",
    build: model("bldg-two-platform-station"),
  },
  {
    id: "bldg-grand-terminus",
    name: "Grand terminus",
    category: CAT,
    tags: ["station", "terminus", "clock tower", "glass roof", "city", "buffers"],
    notes: "Three dead-end roads under an arched glass train shed, fronted by a concourse and a clock tower. The end of the line: a city's terminus could set timetabled departures for each road.",
    build: model("bldg-grand-terminus"),
    animate: animateClock,
  },
  {
    id: "bldg-mountain-station",
    name: "Mountain station",
    category: CAT,
    tags: ["station", "mountain", "chalet", "snow", "alpine", "balcony"],
    notes: "A chalet station with a stone ground floor, timber upper storey and a snow-capped roof. Sits at the top of a climb; trains that reach it could earn a bonus for a hill route.",
    build: model("bldg-mountain-station"),
  },
  {
    id: "bldg-harbour-station",
    name: "Harbour station",
    category: CAT,
    tags: ["station", "harbour", "quay", "boat", "water", "jetty", "lifebuoy"],
    notes: "A seaside station on the quay with a jetty, bollards and a little boat bobbing at its mooring. Boat-train idea: passengers arriving by ferry want a train onward.",
    build: model("bldg-harbour-station"),
    animate: (root, t) => {
      for (const b of parts(root, "boat")) {
        b.position.y = 0.6 + Math.sin(t * 1.6) * 0.8;
        b.rotation.x = Math.sin(t * 1.1) * 0.06;
      }
    },
  },
  {
    id: "bldg-signal-box",
    name: "Signal box",
    category: CAT,
    tags: ["signal box", "levers", "signalman", "lineside", "stairs"],
    notes: "A two-storey signal box: brick base, glazed operating floor with a row of levers, outside stairs. In game it could be the place you tap to switch points and signals for its stretch of line.",
    build: model("bldg-signal-box"),
    animate: (root, t) => {
      for (const l of parts(root, "lever")) l.rotation.z = Math.max(0, Math.sin(t * 0.8)) * 0.7;
    },
  },
  {
    id: "bldg-ticket-booth",
    name: "Ticket booth",
    category: CAT,
    tags: ["ticket", "booth", "kiosk", "platform", "small"],
    notes: "A one-person ticket booth with a counter window. Tickets sold here could be the game's way of letting passengers queue for a route.",
    build: model("bldg-ticket-booth"),
  },
  {
    id: "bldg-waiting-shelter",
    name: "Waiting shelter",
    category: CAT,
    tags: ["shelter", "bench", "glass", "platform", "small"],
    notes: "A glass-sided shelter with a bench and a timetable board. Passengers wait longer without complaining when there's one at the stop.",
    build: model("bldg-waiting-shelter"),
  },
  {
    id: "bldg-platform-furnished",
    name: "Platform with benches and lamps",
    category: CAT,
    tags: ["platform", "bench", "lamp", "clock", "bin", "straight"],
    notes: "A long plain platform dressed with lamps, benches, a hanging clock and a bin. Lay several end to end beside a straight to build any length of station.",
    build: model("bldg-platform-furnished"),
    animate: animateClock,
  },
  {
    id: "bldg-station-clock",
    name: "Station clock",
    category: CAT,
    tags: ["clock", "post", "small", "time", "platform"],
    notes: "A two-faced clock on a turned post. Could show the game's timetable clock, ticking faster when you speed up time.",
    build: model("bldg-station-clock"),
    animate: animateClock,
  },

  // ——— Railway yard ———
  {
    id: "bldg-water-tower",
    name: "Water tower",
    category: CAT,
    tags: ["water", "tower", "tank", "steam", "spout", "yard"],
    notes: "A round tank on four legs with a swinging spout. Steam engines could need a drink every so many laps, adding a reason to route past it.",
    build: model("bldg-water-tower"),
    animate: (root, t) => {
      for (const s of parts(root, "spout")) s.rotation.y = Math.sin(t * 0.7) * 0.9;
    },
  },
  {
    id: "bldg-coal-stage",
    name: "Coal stage",
    category: CAT,
    tags: ["coal", "fuel", "chute", "tubs", "yard", "steam"],
    notes: "A raised brick stage heaped with coal, with tubs and a tipping chute. Engines parked alongside refuel; it could also accept coal unloaded from hoppers.",
    build: model("bldg-coal-stage"),
    animate: (root, t) => {
      for (const c of parts(root, "chute")) c.rotation.x = 0.2 + Math.max(0, Math.sin(t * 0.9)) * 0.5;
    },
  },
  {
    id: "bldg-engine-shed",
    name: "Engine shed (2-road)",
    category: CAT,
    tags: ["engine shed", "depot", "two road", "doors", "yard", "storage"],
    notes: "A brick shed with two roads under a smoke-vented roof and swinging doors. Parking engines out of sight; trains inside could be saved between sessions.",
    build: model("bldg-engine-shed"),
    animate: (root, t) => {
      const a = (0.5 - 0.5 * Math.cos(t * 0.6)) * 1.5;
      for (const l of parts(root, "leafL")) l.rotation.y = a;
      for (const r of parts(root, "leafR")) r.rotation.y = -a;
    },
  },
  {
    id: "bldg-roundhouse-segment",
    name: "Roundhouse segment",
    category: CAT,
    tags: ["roundhouse", "turntable", "stalls", "depot", "engine", "modular"],
    notes: "Three engine stalls fanned round a turntable's centre, each with its own track and smoke jack. Clip several segments round a turntable for a full roundhouse.",
    build: model("bldg-roundhouse-segment"),
  },
  {
    id: "bldg-goods-shed",
    name: "Goods shed",
    category: CAT,
    tags: ["goods", "freight", "shed", "crane", "crates", "loading dock", "sliding door"],
    notes: "A timber goods shed with a loading dock, a sliding door and a little hand crane. Wagons left at the dock could be loaded with crates for delivery to the town.",
    build: model("bldg-goods-shed"),
    animate: (root, t) => {
      for (const d of parts(root, "door")) d.position.x = (0.5 - 0.5 * Math.cos(t * 0.5)) * 34;
      for (const j of parts(root, "jib")) j.rotation.y = Math.sin(t * 0.4) * 1.6;
    },
  },
  {
    id: "bldg-warehouse",
    name: "Warehouse",
    category: CAT,
    tags: ["warehouse", "hoist", "loading doors", "brick", "storage", "freight"],
    notes: "A tall brick warehouse with stacked loading doors and a hoist lifting sacks to the top floor. Stores goods between deliveries: fill it by train, empty it by lorry.",
    build: model("bldg-warehouse"),
    animate: (root, t) => {
      const y = 22 + (0.5 - 0.5 * Math.cos(t * 0.6)) * 70;
      for (const h of parts(root, "hook")) h.position.y = y;
      for (const r of parts(root, "rope")) {
        r.position.y = y;
        r.scale.y = 100 - y;
      }
    },
  },

  // ——— Countryside ———
  {
    id: "bldg-farmhouse",
    name: "Farmhouse",
    category: CAT,
    tags: ["farm", "house", "porch", "countryside", "chimney"],
    notes: "A cream farmhouse with a red roof, a porch and two chimneys. The farm could send milk, eggs and grain to town by rail.",
    build: model("bldg-farmhouse"),
  },
  {
    id: "bldg-red-barn",
    name: "Red barn",
    category: CAT,
    tags: ["barn", "farm", "gambrel", "hay", "countryside"],
    notes: "A big red barn with a gambrel roof, white-crossed doors and a hay loft. Fill it with hay bales from a flat wagon at harvest time.",
    build: model("bldg-red-barn"),
    animate: (root, t) => {
      for (const l of parts(root, "loft")) l.rotation.y = (0.5 - 0.5 * Math.cos(t * 0.8)) * 1.4;
    },
  },
  {
    id: "bldg-silo",
    name: "Grain silo",
    category: CAT,
    tags: ["silo", "grain", "farm", "tall", "ladder", "chute"],
    notes: "A tall banded silo with a domed cap and a loading spout. Tip a hopper of grain in at harvest, or load wagons from its spout.",
    build: model("bldg-silo"),
  },
  {
    id: "bldg-windmill",
    name: "Windmill",
    category: CAT,
    tags: ["windmill", "mill", "sails", "flour", "countryside", "animated"],
    notes: "A turned tower mill with a red cap and four lattice sails that turn in the breeze. Grain in, flour out: a stop on the bakery's supply line.",
    build: model("bldg-windmill"),
    animate: (root, t) => {
      for (const s of parts(root, "sails")) s.rotation.x = t * 1.1;
    },
  },
  {
    id: "bldg-watermill",
    name: "Watermill",
    category: CAT,
    tags: ["watermill", "mill", "water wheel", "river", "animated"],
    notes: "A stone mill beside its own mill race, its paddle wheel turning in the stream. Place it where the river meets the line and it grinds grain sent by rail.",
    build: model("bldg-watermill"),
    animate: (root, t) => {
      for (const w of parts(root, "wheel")) w.rotation.z = -t * 0.8;
    },
  },
  {
    id: "bldg-lighthouse",
    name: "Lighthouse",
    category: CAT,
    tags: ["lighthouse", "coast", "harbour", "light", "striped", "animated"],
    notes: "A red-and-white striped lighthouse on a stone base, its beam sweeping round and lamp blinking. A landmark for the harbour; its light could flash at night-time in game.",
    build: model("bldg-lighthouse"),
    animate: (root, t) => {
      for (const b of parts(root, "beam")) b.rotation.y = t * 1.4;
      for (const l of parts(root, "light")) l.visible = (t * 1.5) % 1 < 0.6;
    },
  },

  // ——— Town ———
  {
    id: "bldg-fire-station",
    name: "Fire station",
    category: CAT,
    tags: ["fire station", "emergency", "doors", "bell", "hose tower", "town"],
    notes: "A two-bay fire station with roll-up doors, a hose tower and a brass bell. Its doors open when a fire engine is called out; a fire wagon on rails could answer too.",
    build: model("bldg-fire-station"),
    animate: (root, t) => {
      const lift = Math.min(1, Math.max(0, Math.sin(t * 0.6) * 1.5)) * 22;
      for (const d of parts(root, "door")) d.position.y = lift;
    },
  },
  {
    id: "bldg-police-station",
    name: "Police station",
    category: CAT,
    tags: ["police", "station", "blue lamp", "town", "emergency"],
    notes: "A tidy blue-trimmed police station with a blinking blue lamp over the door. A police car could be called from here when a level crossing is blocked.",
    build: model("bldg-police-station"),
    animate: (root, t) => {
      for (const b of parts(root, "blue")) b.visible = (t * 2) % 1 < 0.5;
    },
  },
  {
    id: "bldg-post-office",
    name: "Post office",
    category: CAT,
    tags: ["post office", "mail", "letters", "post box", "town"],
    notes: "A red-trimmed post office with a pillar box outside and an envelope sign. Mail sacks loaded here could ride a mail van to every station on the line.",
    build: model("bldg-post-office"),
  },
  {
    id: "bldg-bakery",
    name: "Bakery",
    category: CAT,
    tags: ["bakery", "bread", "shop", "awning", "chimney", "town", "smoke"],
    notes: "A bakery with a striped awning, a giant loaf on the roof and a smoking oven chimney. It wants flour from the mill and sends bread to the café.",
    build: model("bldg-bakery"),
    animate: animateSmoke,
  },
  {
    id: "bldg-cafe",
    name: "Café",
    category: CAT,
    tags: ["cafe", "tea", "tables", "umbrella", "awning", "town"],
    notes: "A little café with an awning and two outside tables under parasols. Passengers waiting for a late train could drift over for a cup of tea.",
    build: model("bldg-cafe"),
  },
  {
    id: "bldg-school",
    name: "School with bell",
    category: CAT,
    tags: ["school", "bell", "cupola", "playground", "town", "animated"],
    notes: "A yellow schoolhouse with its long front to the street, a bell swinging in its cupola and a playground fence. The bell could ring at the school run, when children want the morning train.",
    build: model("bldg-school"),
    animate: (root, t) => {
      for (const b of parts(root, "bell")) b.rotation.x = Math.sin(t * 3) * 0.6;
    },
  },
  {
    id: "bldg-church",
    name: "Church",
    category: CAT,
    tags: ["church", "spire", "tower", "rose window", "village"],
    notes: "A village church: a long nave and a stone tower with a tall spire and a rose window. A landmark you can see across the layout; wedding specials could run on Saturdays.",
    build: model("bldg-church"),
  },
  {
    id: "bldg-town-hall",
    name: "Town hall",
    category: CAT,
    tags: ["town hall", "civic", "columns", "clock", "flag", "pediment"],
    notes: "A columned town hall with a clock turret and a flag. The heart of a town: its requests (passengers, coal, bread) could set the layout's goals.",
    build: model("bldg-town-hall"),
    animate: (root, t) => {
      animateClock(root, t);
      for (const f of parts(root, "flag")) f.rotation.y = Math.sin(t * 2.2) * 0.35;
    },
  },
  {
    id: "bldg-market-hall",
    name: "Market hall",
    category: CAT,
    tags: ["market", "hall", "stalls", "awning", "produce", "clock", "town"],
    notes: "An open-sided market hall on posts, with three striped stalls of produce under its roof and a clock lantern on the ridge. Market day could bring farm goods in by train.",
    build: model("bldg-market-hall"),
    animate: (root, t) => animateClock(root, t),
  },
  {
    id: "bldg-library",
    name: "Library",
    category: CAT,
    tags: ["library", "civic", "columns", "dome", "clock", "steps", "research", "landmark"],
    notes: "A grand library with broad steps, six columns under a pediment and a domed clock tower. The town's place of learning, where new ideas come from.",
    build: model("bldg-library"),
    animate: (root, t) => animateClock(root, t),
  },
  {
    id: "bldg-castle-gate",
    name: "Castle gate",
    category: CAT,
    tags: ["castle", "gate", "portcullis", "towers", "tunnel", "animated"],
    notes: "Two round towers and a crenellated wall with a portcullis the track runs through. The portcullis must be raised before a train can pass: a toll gate or a timing puzzle.",
    build: model("bldg-castle-gate"),
    animate: (root, t) => {
      const lift = Math.min(1, Math.max(0, Math.sin(t * 0.5) * 1.4 + 0.3)) * 48;
      for (const p of parts(root, "portcullis")) p.position.y = lift;
    },
  },
  {
    id: "bldg-factory",
    name: "Factory with chimney",
    category: CAT,
    tags: ["factory", "chimney", "sawtooth roof", "industry", "smoke"],
    notes: "A brick works under a sawtooth roof with a tall banded chimney puffing smoke. Takes in coal and timber by rail and sends out boxes of toys.",
    build: model("bldg-factory"),
    animate: animateSmoke,
  },
  {
    id: "bldg-sawmill",
    name: "Sawmill",
    category: CAT,
    tags: ["sawmill", "timber", "logs", "saw", "industry", "animated"],
    notes: "An open-sided sawmill with a spinning saw, a log pile and a stack of sawn planks. Unload a timber wagon here and it turns logs into planks for the toy factory.",
    build: model("bldg-sawmill"),
    animate: (root, t) => {
      for (const b of parts(root, "blade")) b.rotation.z = -t * 12;
    },
  },
  {
    id: "bldg-dairy",
    name: "Dairy",
    category: CAT,
    tags: ["dairy", "milk", "churns", "farm", "loading stand"],
    notes: "A white dairy with a giant milk bottle on the roof and a stand of churns ready for collection. A milk train stops each morning to load the churns.",
    build: model("bldg-dairy"),
  },
  {
    id: "bldg-petrol-station",
    name: "Petrol station",
    category: CAT,
    tags: ["petrol", "fuel", "pumps", "canopy", "road", "garage"],
    notes: "A roadside filling station: two pumps under a canopy, a kiosk and a turning sign. Road vehicles refuel here; a tanker train could keep it supplied.",
    build: model("bldg-petrol-station"),
    animate: (root, t) => {
      for (const s of parts(root, "sign")) s.rotation.y = t * 0.8;
    },
  },
  {
    id: "bldg-market-stall",
    name: "Market stall",
    category: CAT,
    tags: ["market", "stall", "fruit", "canopy", "small", "town"],
    notes: "A striped market stall piled with fruit and veg, with a peg stallholder. Farm goods brought by train end up here on market day.",
    build: model("bldg-market-stall"),
  },
  {
    id: "bldg-cottage-row",
    name: "Cottage row",
    category: CAT,
    tags: ["cottages", "terrace", "houses", "village", "chimneys"],
    notes: "Three terraced cottages in different colours, each with its own door and chimney. Houses make passengers: the more homes near a station, the busier it gets.",
    build: model("bldg-cottage-row"),
  },
  {
    id: "bldg-apartment-block",
    name: "Apartment block",
    category: CAT,
    tags: ["apartments", "flats", "city", "balconies", "tall"],
    notes: "A four-storey block of flats with balconies and a roof hut. Lots of people in a small footprint: a city station beside it never runs out of passengers.",
    build: model("bldg-apartment-block"),
  },
  {
    id: "bldg-hospital",
    name: "Hospital",
    category: CAT,
    tags: ["hospital", "red cross", "helipad", "ambulance", "town", "emergency"],
    notes: "A white hospital with a red cross, a covered entrance and a helipad on the roof. An ambulance coach on the train could bring patients from the countryside.",
    build: model("bldg-hospital"),
  },
  {
    id: "bldg-control-tower",
    name: "Airport control tower",
    category: CAT,
    tags: ["airport", "control tower", "radar", "aviation", "tall", "animated"],
    notes: "A slender control tower with a glass cab and a spinning radar dish. An airport station: planes in the sky, trains connecting to town.",
    build: model("bldg-control-tower"),
    animate: (root, t) => {
      for (const r of parts(root, "radar")) r.rotation.y = t * 1.5;
      for (const b of parts(root, "beacon")) b.visible = (t * 1.2) % 1 < 0.5;
    },
  },
  {
    id: "bldg-ice-cream-kiosk",
    name: "Ice-cream kiosk",
    category: CAT,
    tags: ["ice cream", "kiosk", "seaside", "round", "small", "animated"],
    notes: "A round pink kiosk with a striped roof and a giant cone slowly turning on top. Seaside fun near the harbour: busier in summer, a reason to run day-trip specials.",
    build: model("bldg-ice-cream-kiosk"),
    animate: (root, t) => {
      for (const c of parts(root, "cone")) c.rotation.y = t * 0.7;
    },
  },
  {
    id: "bldg-toy-shop",
    name: "Toy shop",
    category: CAT,
    tags: ["toy shop", "shop", "window", "pinwheel", "town", "animated"],
    notes: "A purple toy shop with a tiny wooden train in the window and a pinwheel spinning on the roof. A toy railway in a toy railway: deliveries from the factory keep its shelves full.",
    build: model("bldg-toy-shop"),
    animate: (root, t) => {
      for (const p of parts(root, "pinwheel")) p.rotation.x = t * 3;
    },
  },
  // ——— Town houses: sized to the map's town squares (one square: about 56 × 56; two squares: about 128 × 56) ———
  {
    id: "bldg-townhouse",
    name: "Townhouse",
    category: CAT,
    tags: ["house", "townhouse", "town", "tall", "two floors"],
    notes: "A tall, narrow two-storey townhouse with a blue door and a little fanlight. Fits one town square; a row of them makes a high street.",
    build: model("bldg-townhouse"),
  },
  {
    id: "bldg-thatched-cottage",
    name: "Thatched cottage",
    category: CAT,
    tags: ["house", "cottage", "thatch", "village", "town", "country"],
    notes: "A low whitewashed cottage under a deep, rounded straw thatch, with roses round the door. Fits one town square, and looks at home on the edge of a village.",
    build: model("bldg-thatched-cottage"),
  },
  {
    id: "bldg-timber-house",
    name: "Timber-framed house",
    category: CAT,
    tags: ["house", "timber", "half-timbered", "tudor", "town"],
    notes: "Cream walls criss-crossed with dark oak beams, an upper floor jutting out over the street and a steep red roof. Fits one town square.",
    build: model("bldg-timber-house"),
  },
  {
    id: "bldg-bungalow",
    name: "Bungalow",
    category: CAT,
    tags: ["house", "bungalow", "town", "low", "garden"],
    notes: "A wide, low house all on one floor under a hipped roof, with a front step and a window box. Fits one town square.",
    build: model("bldg-bungalow"),
  },
  {
    id: "bldg-corner-shop",
    name: "Corner shop",
    category: CAT,
    tags: ["shop", "corner shop", "grocer", "town", "awning"],
    notes: "A little grocer's with a striped awning, crates of fruit by the door and a flat above with a window box. Fits one town square.",
    build: model("bldg-corner-shop"),
  },
  {
    id: "bldg-narrow-house",
    name: "Narrow gabled house",
    category: CAT,
    tags: ["house", "narrow", "canal house", "gable", "town", "tall"],
    notes: "A slim house with a stepped gable to the street, like the canal houses of an old port. Three floors on one town square; a row of them in different colours is a postcard.",
    build: model("bldg-narrow-house"),
  },
  {
    id: "bldg-brick-house",
    name: "Brick house with bay window",
    category: CAT,
    tags: ["house", "brick", "bay window", "town", "victorian"],
    notes: "A red-brick house with a white bay window on the ground floor, a slate roof and a chimney at each end. Fits one town square.",
    build: model("bldg-brick-house"),
  },
  {
    id: "bldg-terrace",
    name: "Terrace of three",
    category: CAT,
    tags: ["houses", "terrace", "row", "town", "street"],
    notes: "Three joined houses under one long roof, each with its own colour of front door and a chimney on the ridge between them. Fits two town squares, front along the long side.",
    build: model("bldg-terrace"),
  },
  {
    id: "bldg-semi-detached",
    name: "Semi-detached pair",
    category: CAT,
    tags: ["houses", "semi-detached", "pair", "town", "suburb"],
    notes: "Two mirror-image houses sharing a wall, each with a porch and a front garden hedge. Fits two town squares, front along the long side.",
    build: model("bldg-semi-detached"),
  },
  {
    id: "bldg-villa",
    name: "Villa",
    category: CAT,
    tags: ["house", "villa", "grand", "town", "porch", "columns"],
    notes: "A grand pale villa with a columned porch, tall windows, a hipped roof and a chimney at each end. The finest house in town; fits two town squares.",
    build: model("bldg-villa"),
  },
];

