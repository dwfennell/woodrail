import type { Object3D } from "three";
import type { Kit } from "../kit";
import { catalogueModel, loadModelSet, modelOf } from "../../render/blender-models";
import type { Asset } from "../types";

/**
 * People & animals: peg-doll people (turned bodies, round beech heads, painted uniforms, about 18 mm tall) told apart by
 * hats, bags and tools, and chunky turned-and-sawn wooden animals. Facing +x, standing on y = 0.
 * The models are made in Blender; this file gives the game their names, notes and animations.
 */

/** The models, made in Blender (tools/blender/life.py): waited for when this file loads. */
const MODELS = await loadModelSet("life", true);
const model = (id: string) => (k: Kit) => catalogueModel(modelOf(MODELS, id), k);

// ——— Animation ———

/** Look up a named part, cached on the root so animate doesn't search every frame. */
function part(root: Object3D, name: string): Object3D | undefined {
  const cache = (root.userData.parts ??= {}) as Record<string, Object3D | undefined>;
  if (!(name in cache)) cache[name] = root.getObjectByName(name);
  return cache[name];
}

// ——— The catalogue ———
const PECKS = ["peck-0", "peck-1", "peck-2"];
const DUCKS = ["duck-0", "duck-1", "duck-2", "duck-3"];
const SWANS = ["swan-0", "swan-1"];
const GEESE = ["goose-0", "goose-1"];
const DROPS = ["drop-0", "drop-1", "drop-2"];
const PENGUINS = ["penguin-0", "penguin-1"];
const PERCHES = ["perch-0", "perch-1", "perch-2"];

const C = "People & animals" as const;

export const ASSETS: Asset[] = [
  // ——— Railway staff ———
  {
    id: "life-driver",
    name: "Engine driver",
    category: C,
    tags: ["person", "driver", "railway", "staff", "wave"],
    notes: "A driver in blue overalls, striped cap and red neckerchief, waving, with an oil can. Ride in the engine's cab; a train won't leave the shed until its driver is aboard.",
    build: model("life-driver"),
    animate: (root, t) => {
      const a = part(root, "wave");
      if (a) a.rotation.x = 0.12 + Math.sin(t * 6) * 0.35;
    },
  },
  {
    id: "life-conductor",
    name: "Conductor with flag",
    category: C,
    tags: ["person", "conductor", "flag", "railway", "staff", "departure"],
    notes: "A conductor in a maroon coat with brass buttons, waving a green flag. Raise the flag to send a waiting train off: a departure signal the player can tap.",
    build: model("life-conductor"),
    animate: (root, t) => {
      const f = part(root, "flag");
      if (f) f.rotation.y = Math.sin(t * 7) * 0.5;
    },
  },
  {
    id: "life-station-master",
    name: "Station master",
    category: C,
    tags: ["person", "station master", "railway", "staff", "watch"],
    notes: "The station master in a navy frock coat and gold-banded kepi, checking a pocket watch. Stands on the platform and grumbles (a little puff) when a train is late against the timetable.",
    build: model("life-station-master"),
    animate: (root, t) => {
      const a = part(root, "watch-arm");
      if (a) a.rotation.z = 1.1 + Math.max(0, Math.sin(t * 0.8)) * 0.4;
    },
  },
  {
    id: "life-guard",
    name: "Guard with lantern",
    category: C,
    tags: ["person", "guard", "lantern", "railway", "staff", "night"],
    notes: "A guard in a green coat swinging a red lantern. Rides in the brake van; at dusk the lantern glows on the last car so you can see the train is complete.",
    build: model("life-guard"),
    animate: (root, t) => {
      const a = part(root, "lamp-arm");
      const l = part(root, "lamp");
      if (!a || !l) return;
      a.rotation.z = 0.5 + Math.sin(t * 2.2) * 0.3;
      l.rotation.z = -a.rotation.z + Math.sin(t * 2.2 - 0.6) * 0.25;
    },
  },
  {
    id: "life-porter",
    name: "Porter with luggage trolley",
    trayLabel: "Porter",
    category: C,
    tags: ["person", "porter", "luggage", "trolley", "station", "suitcase"],
    notes: "A porter in a brown waistcoat pushing a four-wheeled barrow piled with cases, a trunk and a hatbox. Wheel luggage from the taxi rank to the coach: passengers won't board until their bags are loaded.",
    build: model("life-porter"),
  },
  {
    id: "life-signal-operator",
    name: "Signal operator at the lever frame",
    trayLabel: "Signalman",
    category: C,
    tags: ["person", "signal", "signal box", "levers", "railway", "staff"],
    notes: "A signal operator in shirtsleeves and waistcoat working a frame of coloured levers. Put them in a signal box: each lever pulled changes a signal or a point, so the box becomes the player's control desk.",
    build: model("life-signal-operator"),
    animate: (root, t) => {
      const l = part(root, "lever-2");
      const a = part(root, "op-arm");
      const s = 0.5 + 0.5 * Math.sin(t * 1.2);
      if (l) l.rotation.z = -0.25 + s * 0.75;
      if (a) a.rotation.z = 1.4 - s * 0.35;
    },
  },

  // ——— Passengers ———
  {
    id: "life-child-balloon",
    name: "Child with balloon",
    category: C,
    tags: ["person", "child", "passenger", "balloon", "small"],
    notes: "A small passenger in a yellow raincoat and bobble hat, holding a red balloon on a string. Children could ride free, and a let-go balloon floating over the layout is a little thing to spot.",
    build: model("life-child-balloon"),
    animate: (root, t) => {
      const b = part(root, "balloon");
      if (b) b.rotation.x = Math.sin(t * 1.4) * 0.15;
    },
  },
  {
    id: "life-grandparent",
    name: "Grandparent with cane",
    category: C,
    tags: ["person", "grandparent", "passenger", "cane", "glasses"],
    notes: "A grandparent in a purple coat, grey hair in a bun, round glasses and a walking cane. Takes a seat on the platform bench and wants a coach with a step: a slow, patient passenger.",
    build: model("life-grandparent"),
  },
  {
    id: "life-traveller",
    name: "Traveller with suitcase",
    trayLabel: "Traveller",
    category: C,
    tags: ["person", "traveller", "passenger", "suitcase", "bowler"],
    notes: "A traveller in a green coat and bowler hat with a strapped brown case. A passenger with a destination: deliver them to the station they ask for to earn a ticket.",
    build: model("life-traveller"),
  },
  {
    id: "life-tourist",
    name: "Tourist with camera",
    category: C,
    tags: ["person", "tourist", "passenger", "camera", "photo", "backpack"],
    notes: "A tourist in an orange shirt and sun hat with a backpack, snapping photos (the flash blinks). Stands by scenic spots; pass a viewpoint slowly and they take a photo for the album.",
    build: model("life-tourist"),
    animate: (root, t) => {
      const f = part(root, "flash");
      if (f) f.visible = t % 2.5 < 0.15;
    },
  },

  // ——— Town folk ———
  {
    id: "life-farmer",
    name: "Farmer with pitchfork",
    category: C,
    tags: ["person", "farmer", "farm", "straw hat", "pitchfork"],
    notes: "A farmer in a check-red shirt, blue dungarees and a wide straw hat, holding a pitchfork. Waits at the farm halt with milk churns and hay bales to send to town.",
    build: model("life-farmer"),
  },
  {
    id: "life-fisher",
    name: "Fisher on a crate",
    category: C,
    tags: ["person", "fisher", "fishing", "harbour", "rod", "sou'wester"],
    notes: "A fisher in a yellow oilskin and sou'wester, sitting on a crate with a rod and a bucket of catch. Park by the river or harbour; fish could be loaded into an ice van for market.",
    build: model("life-fisher"),
    animate: (root, t) => {
      const a = part(root, "rod-arm");
      if (a) a.rotation.z = 1.1 + Math.sin(t * 1.6) * 0.06 + (t % 6 < 0.5 ? 0.25 : 0);
    },
  },
  {
    id: "life-firefighter",
    name: "Firefighter with hose",
    category: C,
    tags: ["person", "firefighter", "fire", "hose", "helmet", "emergency"],
    notes: "A firefighter in navy with reflective yellow bands and a red helmet, aiming a brass-nozzled hose from a coiled reel. Rides on the fire engine; a burning haystack event needs the water tanker to arrive.",
    build: model("life-firefighter"),
    animate: (root, t) => {
      const s = part(root, "spray");
      if (s) s.position.x = 10.5 + ((t * 6) % 2.5);
    },
  },
  {
    id: "life-police",
    name: "Police officer directing traffic",
    trayLabel: "Traffic police",
    category: C,
    tags: ["person", "police", "traffic", "helmet", "whistle", "town"],
    notes: "A police officer in a tall rounded helmet, white gloves raised to stop the traffic. Stand at a level crossing or junction: road vehicles wait while the officer's arm is up.",
    build: model("life-police"),
    animate: (root, t) => {
      const a = part(root, "stop-arm");
      if (a) a.rotation.z = (t % 6) < 3 ? 2.5 : 0.15;
    },
  },
  {
    id: "life-postie",
    name: "Postie with sack",
    category: C,
    tags: ["person", "postie", "post", "mail", "letters", "sack"],
    notes: "A postie in a red coat and cap with a bulging mail sack on the back and a letter in hand. Collects from the post box and rides the mail van; letters are a light, quick cargo between towns.",
    build: model("life-postie"),
  },
  {
    id: "life-baker",
    name: "Baker with bread tray",
    category: C,
    tags: ["person", "baker", "bread", "bakery", "food", "town"],
    notes: "A baker in white with a cream apron and a pillbox cap, carrying a tray of loaves. Bakeries take flour from the mill and send bread out on the morning train.",
    build: model("life-baker"),
  },
  {
    id: "life-chef",
    name: "Chef flipping pancakes",
    trayLabel: "Pancake chef",
    category: C,
    tags: ["person", "chef", "cook", "pan", "restaurant", "dining car"],
    notes: "A chef in a tall toque and red neckerchief tossing a pancake in a pan. Belongs in the dining car or station café; a busy chef means hungry passengers want the food wagon.",
    build: model("life-chef"),
    animate: (root, t) => {
      const p = part(root, "pancake");
      if (!p) return;
      const s = (t % 1.6) / 1.6;
      p.position.y = 7.6 + Math.sin(s * Math.PI) * 8;
      p.rotation.z = s * Math.PI * 2;
    },
  },
  {
    id: "life-doctor",
    name: "Doctor with bag",
    category: C,
    tags: ["person", "doctor", "medical", "bag", "stethoscope", "hospital"],
    notes: "A doctor in a white coat over teal, stethoscope round the neck, carrying a black bag. Hurries to the station when someone is poorly: an express job that clears the line ahead.",
    build: model("life-doctor"),
  },
  {
    id: "life-builder",
    name: "Builder with wheelbarrow",
    trayLabel: "Builder",
    category: C,
    tags: ["person", "builder", "hard hat", "wheelbarrow", "construction", "sand"],
    notes: "A builder in a yellow hard hat and hi-vis bib pushing a wheelbarrow of sand, a shovel stuck in it. Shows up where a track or building is being placed; new pieces arrive in their barrow.",
    build: model("life-builder"),
  },
  {
    id: "life-crane-operator",
    name: "Crane operator with pendant",
    trayLabel: "Crane operator",
    category: C,
    tags: ["person", "crane", "operator", "hard hat", "hi-vis", "yard", "controls"],
    notes: "A crane operator in an orange hard hat and hi-vis vest, working a yellow push-button pendant on a dangling cable. Stand them by the goods-yard crane: tap the operator to work the crane.",
    build: model("life-crane-operator"),
    animate: (root, t) => {
      const b = part(root, "go");
      if (b) b.position.x = 1.35 - (Math.sin(t * 3) > 0.5 ? 0.35 : 0);
    },
  },
  {
    id: "life-ice-cream-seller",
    name: "Ice-cream seller and cart",
    trayLabel: "Ice-cream cart",
    category: C,
    tags: ["person", "ice cream", "cart", "umbrella", "seaside", "park"],
    notes: "An ice-cream seller in a striped boater behind a two-wheeled cart under a pink parasol, holding out a cone. Set up by the beach halt: on hot days passengers queue, and the cart needs milk from the dairy.",
    build: model("life-ice-cream-seller"),
  },
  {
    id: "life-band",
    name: "Station band",
    category: C,
    tags: ["person", "band", "music", "drum", "trumpet", "parade", "festival"],
    notes: "A drummer and a trumpeter in red tunics and plumed band hats on a little round stage. Plays when a special train arrives: a celebration for finishing a route or a festival day.",
    build: model("life-band"),
    animate: (root, t) => {
      const r = part(root, "stick-r");
      const l = part(root, "stick-l");
      const tr = part(root, "trumpeter");
      if (r) r.rotation.z = 1.0 + Math.max(0, Math.sin(t * 9)) * 0.4;
      if (l) l.rotation.z = 1.0 + Math.max(0, -Math.sin(t * 9)) * 0.4;
      if (tr) tr.rotation.z = Math.sin(t * 2.25) * 0.08;
    },
  },
  {
    id: "life-family",
    name: "Family day out",
    category: C,
    tags: ["person", "family", "passengers", "children", "group", "holiday"],
    notes: "Two grown-ups and two children holding hands on a little plinth, the smallest hopping with excitement. A group fare: they all need seats in the same coach to the seaside.",
    build: model("life-family"),
    animate: (root, t) => {
      const h = part(root, "hopper");
      if (h) h.position.y = 2 + Math.abs(Math.sin(t * 4)) * 3;
    },
  },

  // ——— Farm animals ———
  {
    id: "life-dog",
    name: "Dog",
    category: C,
    tags: ["animal", "dog", "pet", "wag"],
    notes: "A chunky brown dog with floppy black ears and a red collar, tail wagging. Follows its owner to the station; a lost dog could be returned on the next train for a reward.",
    build: model("life-dog"),
    animate: (root, t) => {
      const tl = part(root, "tail");
      if (tl) tl.rotation.x = Math.sin(t * 14) * 0.6;
    },
  },
  {
    id: "life-cat",
    name: "Cat",
    category: C,
    tags: ["animal", "cat", "pet", "station cat"],
    notes: "A sitting ginger cat with pointed ears and a swishing tail. Every station needs a station cat: it naps on the sunniest platform and wakes when a train pulls in.",
    build: model("life-cat"),
    animate: (root, t) => {
      const tl = part(root, "tail");
      if (tl) tl.rotation.y = Math.sin(t * 1.5) * 0.5;
    },
  },
  {
    id: "life-cow",
    name: "Cow",
    category: C,
    tags: ["animal", "cow", "farm", "milk", "graze"],
    notes: "A black-and-white cow with horns, pink muzzle, udder and a brass bell, lowering her head to graze. A field of cows supplies milk churns for the dairy train.",
    build: model("life-cow"),
    animate: (root, t) => {
      const h = part(root, "head");
      const tl = part(root, "tail");
      if (h) h.rotation.z = -0.45 * (0.5 + 0.5 * Math.sin(t * 0.7));
      if (tl) tl.rotation.x = Math.sin(t * 2.5) * 0.35;
    },
  },
  {
    id: "life-sheep",
    name: "Sheep",
    category: C,
    tags: ["animal", "sheep", "farm", "wool", "lamb"],
    notes: "A fluffy sheep of stacked white beads with a black face and legs, chewing. A flock in the hills gives wool bales for the mill; sheep on the line would stop a train.",
    build: model("life-sheep"),
    animate: (root, t) => {
      const h = part(root, "head");
      if (h) h.rotation.z = Math.sin(t * 5) * 0.06 - 0.1;
    },
  },
  {
    id: "life-pig",
    name: "Pig",
    category: C,
    tags: ["animal", "pig", "farm", "mud", "curly tail"],
    notes: "A round pink pig with a big snout, triangle ears and a curly tail that twirls, standing in a puddle of mud. Pigs love the turnip wagon; a muddy pig might need a wash at the water tower.",
    build: model("life-pig"),
    animate: (root, t) => {
      const c = part(root, "curl");
      if (c) c.rotation.z = t * 4;
    },
  },
  {
    id: "life-horse",
    name: "Horse",
    category: C,
    tags: ["animal", "horse", "farm", "saddle", "pony"],
    notes: "A chestnut horse with a black mane and tail and a red saddle cloth, nodding. Could pull a cart to the station, or race the train along the field fence for a bonus.",
    build: model("life-horse"),
    animate: (root, t) => {
      const h = part(root, "head");
      const tl = part(root, "tail");
      if (h) h.rotation.z = Math.sin(t * 1.8) * 0.08;
      if (tl) tl.rotation.x = Math.sin(t * 2.6) * 0.3;
    },
  },
  {
    id: "life-goat",
    name: "Goat on a rock",
    category: C,
    tags: ["animal", "goat", "farm", "mountain", "rock", "horns"],
    notes: "A grey-and-white goat with curling horns and a beard, stood proudly on a boulder. Lives on hill blocks: it eats anything left on the line, so keep the wagons moving.",
    build: model("life-goat"),
    animate: (root, t) => {
      const h = part(root, "head");
      if (h) h.rotation.z = (t % 4) < 0.6 ? -0.4 * Math.sin(((t % 4) / 0.6) * Math.PI) : 0;
    },
  },
  {
    id: "life-chickens",
    name: "Chickens",
    category: C,
    tags: ["animal", "chicken", "hen", "rooster", "farm", "eggs"],
    notes: "Two hens and a rooster pecking at the ground round a scatter of corn. A hen house sends egg crates on the early train; the rooster could wake the layout in the morning.",
    build: model("life-chickens"),
    animate: (root, t) => {
      for (let i = 0; i < 3; i++) {
        const h = part(root, PECKS[i]);
        if (h) h.rotation.z = -Math.max(0, Math.sin(t * 3 + i * 2.1)) * 0.9;
      }
    },
  },
  {
    id: "life-ducks",
    name: "Duck and ducklings",
    category: C,
    tags: ["animal", "duck", "ducklings", "pond", "water", "bob"],
    notes: "A white duck leading a line of three yellow ducklings across a felt pond, all bobbing. Ducks crossing near the river bridge could hold up a slow train until they're over.",
    build: model("life-ducks"),
    animate: (root, t) => {
      for (let i = 0; i < 4; i++) {
        const d = part(root, DUCKS[i]);
        if (!d) continue;
        d.position.y = -0.6 + Math.sin(t * 2.5 + i * 1.3) * 0.4;
        d.rotation.z = Math.sin(t * 2.5 + i * 1.3 + 0.8) * 0.08;
      }
    },
  },
  {
    id: "life-swans",
    name: "Pair of swans",
    category: C,
    tags: ["animal", "swan", "pond", "river", "water", "elegant"],
    notes: "Two white swans with curved necks and orange beaks gliding face to face on a pond. Grace the park lake; they could glide under a bridge only when no train is crossing.",
    build: model("life-swans"),
    animate: (root, t) => {
      for (let i = 0; i < 2; i++) {
        const s = part(root, SWANS[i]);
        if (s) s.position.y = -0.2 + Math.sin(t * 1.6 + i * Math.PI) * 0.35;
      }
    },
  },
  {
    id: "life-geese",
    name: "Honking geese",
    category: C,
    tags: ["animal", "goose", "geese", "farm", "honk"],
    notes: "Two grey farmyard geese on orange legs, necks stretching out to honk in turn. Guard the farm gate: they chase off anyone who leaves it open (a gentle penalty for blocking the road).",
    build: model("life-geese"),
    animate: (root, t) => {
      for (let i = 0; i < 2; i++) {
        const h = part(root, GEESE[i]);
        const p = (t + i * 1.5) % 3;
        if (h) h.rotation.z = p < 0.8 ? -Math.sin((p / 0.8) * Math.PI) * 0.7 : 0;
      }
    },
  },
  {
    id: "life-rabbit",
    name: "Rabbit with carrot",
    category: C,
    tags: ["animal", "rabbit", "bunny", "hop", "carrot", "field"],
    notes: "A grey rabbit with tall ears and a cotton tail hopping beside a carrot. Rabbits pop out of hill tunnels; a carrot delivery to the allotments could be a tiny cargo job.",
    build: model("life-rabbit"),
    animate: (root, t) => {
      const b = part(root, "bunny");
      if (!b) return;
      const p = (t % 1.4) / 1.4;
      b.position.y = p < 0.4 ? Math.sin((p / 0.4) * Math.PI) * 5 : 0;
    },
  },
  {
    id: "life-fox",
    name: "Fox",
    category: C,
    tags: ["animal", "fox", "woods", "wild", "tail"],
    notes: "A russet fox with black socks, a pointed snout and a white-tipped brush of a tail. Lurks at the woodland edge near the hen house: keep the chicken train running on time.",
    build: model("life-fox"),
    animate: (root, t) => {
      const tl = part(root, "tail");
      if (tl) tl.rotation.y = Math.sin(t * 1.3) * 0.4;
    },
  },
  {
    id: "life-deer",
    name: "Deer",
    category: C,
    tags: ["animal", "deer", "stag", "antlers", "woods", "wild"],
    notes: "A fawn-coloured stag with branching antlers and a white tail, turning his head to watch the train. A forest scene: deer by the line could be a sightseeing stop for the tourist coach.",
    build: model("life-deer"),
    animate: (root, t) => {
      const h = part(root, "head");
      if (h) h.rotation.y = Math.sin(t * 0.6) * 0.5;
    },
  },
  {
    id: "life-bear",
    name: "Bear",
    category: C,
    tags: ["animal", "bear", "woods", "wild", "honey"],
    notes: "A big round brown bear with a cream muzzle and button ears, swaying its head. Lives in the mountain forest; a honey wagon passing by might need to keep its doors shut.",
    build: model("life-bear"),
    animate: (root, t) => {
      const h = part(root, "head");
      if (h) {
        h.rotation.x = Math.sin(t * 1.1) * 0.15;
        h.rotation.y = Math.sin(t * 0.55) * 0.2;
      }
    },
  },

  // ——— Wild and small creatures ———
  {
    id: "life-owl",
    name: "Owl on a post",
    category: C,
    tags: ["animal", "owl", "bird", "night", "post", "woods"],
    notes: "A round brown owl with big yellow eyes on a fence post, its head swivelling round. Wakes at night: a night-time layout with owls, lanterns and lit signals.",
    build: model("life-owl"),
    animate: (root, t) => {
      const h = part(root, "head");
      if (h) h.rotation.y = Math.sin(t * 0.7) * 1.3;
    },
  },
  {
    id: "life-squirrel",
    name: "Squirrel on a stump",
    category: C,
    tags: ["animal", "squirrel", "acorn", "stump", "woods", "tail"],
    notes: "A red squirrel on a tree stump, nibbling an acorn, bushy tail flicking. Squirrels stash acorns in the forest; spot all the hidden ones for a little collectable hunt.",
    build: model("life-squirrel"),
    animate: (root, t) => {
      const tl = part(root, "tail");
      if (tl) tl.rotation.z = (t % 2.2) < 0.3 ? Math.sin(((t % 2.2) / 0.3) * Math.PI) * 0.3 : 0;
    },
  },
  {
    id: "life-frog",
    name: "Frog on a lily pad",
    category: C,
    tags: ["animal", "frog", "pond", "lily pad", "hop", "water"],
    notes: "A green frog with bulging eyes on a lily pad with a pink flower, hopping. A pond puzzle: hop the frog pad to pad across the stream when the bridge is down.",
    build: model("life-frog"),
    animate: (root, t) => {
      const f = part(root, "frog");
      if (!f) return;
      const p = (t % 3) / 3;
      f.position.y = 2 + (p < 0.25 ? Math.sin((p / 0.25) * Math.PI) * 9 : 0);
    },
  },
  {
    id: "life-fish-jumping",
    name: "Leaping fish",
    category: C,
    tags: ["animal", "fish", "river", "pond", "jump", "water"],
    notes: "An orange fish leaping in an arc out of a felt pool, with splash rings where it goes in and out. Place under a river bridge: catch the moment it leaps as your train crosses.",
    build: model("life-fish-jumping"),
    animate: (root, t) => {
      const f = part(root, "fish");
      const p = (t % 3) / 3;
      const leap = Math.min(1, p / 0.45);
      if (f) {
        f.position.x = -12 + leap * 24;
        f.position.y = -2 + Math.sin(leap * Math.PI) * 18;
        f.rotation.z = Math.atan2(Math.cos(leap * Math.PI) * 18 * Math.PI, 24);
        f.visible = p < 0.45;
      }
      for (let i = 0; i < 3; i++) {
        const d = part(root, DROPS[i]);
        if (!d) continue;
        const s = Math.min(1, p / 0.25);
        d.visible = p < 0.25;
        d.position.set(-12 + (i - 1) * s * 4, 2 + Math.sin(s * Math.PI) * 5, (i - 1) * s * 2);
      }
    },
  },
  {
    id: "life-elephant",
    name: "Circus elephant on a drum",
    trayLabel: "Circus elephant",
    category: C,
    tags: ["animal", "elephant", "circus", "trunk", "show"],
    notes: "A grey circus elephant in a red-and-gold blanket and a little fez, standing on a starry drum, swinging its trunk. Arrives on the circus train: unload it at the big-top siding for a show.",
    build: model("life-elephant"),
    animate: (root, t) => {
      const tr = part(root, "trunk");
      if (tr) {
        tr.rotation.z = 0.3 + Math.sin(t * 1.4) * 0.35;
        tr.rotation.x = Math.sin(t * 0.9) * 0.2;
      }
    },
  },
  {
    id: "life-giraffe",
    name: "Giraffe",
    category: C,
    tags: ["animal", "giraffe", "zoo", "safari", "tall"],
    notes: "A tall yellow giraffe with brown patches, ossicones and a swaying neck. Too tall for tunnels: a giraffe wagon needs a route with no low bridges to reach the zoo.",
    build: model("life-giraffe"),
    animate: (root, t) => {
      const n = part(root, "neck");
      const tl = part(root, "tail");
      if (n) n.rotation.z = Math.sin(t * 0.8) * 0.08;
      if (tl) tl.rotation.x = Math.sin(t * 2) * 0.3;
    },
  },
  {
    id: "life-penguins",
    name: "Penguins on an ice floe",
    category: C,
    tags: ["animal", "penguin", "ice", "zoo", "cold", "waddle"],
    notes: "Two waddling penguins and a fish on a little ice floe. A cold-store wagon of fish keeps the zoo penguins happy; they could ride a polar express on a snowy layout.",
    build: model("life-penguins"),
    animate: (root, t) => {
      for (let i = 0; i < 2; i++) {
        const p = part(root, PENGUINS[i]);
        if (p) p.rotation.x = Math.sin(t * 5 + i * 2) * 0.15;
      }
    },
  },
  {
    id: "life-seagulls",
    name: "Seagulls on mooring posts",
    trayLabel: "Seagulls",
    category: C,
    tags: ["animal", "seagull", "bird", "harbour", "seaside", "posts", "flying"],
    notes: "Gulls bobbing on three weathered mooring posts while another wheels overhead. Harbour dressing: gulls gather when the fish train arrives and scatter when it whistles.",
    build: model("life-seagulls"),
    animate: (root, t) => {
      for (let i = 0; i < 3; i++) {
        const p = part(root, PERCHES[i]);
        if (p) p.rotation.z = Math.max(0, Math.sin(t * 2 + i * 1.7)) * -0.25;
      }
      const f = part(root, "flyer");
      if (f) {
        const a = t * 0.7;
        f.position.set(Math.cos(a) * 22, 40 + Math.sin(t * 1.3) * 3, Math.sin(a) * 22);
        f.rotation.y = -a - Math.PI / 2;
      }
      const flap = Math.sin(t * 5) * 0.5;
      const r = part(root, "flap-r");
      const l = part(root, "flap-l");
      if (r) r.rotation.x = -flap;
      if (l) l.rotation.x = flap;
    },
  },
  {
    id: "life-butterfly",
    name: "Butterfly and flower",
    category: C,
    tags: ["animal", "butterfly", "insect", "flower", "garden", "flutter"],
    notes: "A blue-and-yellow butterfly fluttering round a tall pink flower on a patch of grass. Garden dressing for a cottage halt: the more flowers you plant, the more butterflies appear.",
    build: model("life-butterfly"),
    animate: (root, t) => {
      const f = part(root, "fly");
      if (f) {
        f.position.set(Math.cos(t * 0.9) * 8, 24 + Math.sin(t * 2.1) * 3, Math.sin(t * 0.9) * 8);
        f.rotation.y = -t * 0.9 - Math.PI / 2;
      }
      const flap = Math.sin(t * 16) * 0.8;
      const r = part(root, "wing-r");
      const l = part(root, "wing-l");
      if (r) r.rotation.x = -flap;
      if (l) l.rotation.x = flap;
    },
  },
  {
    id: "life-dinosaur",
    name: "Toy dinosaur",
    category: C,
    tags: ["animal", "dinosaur", "toy", "prehistoric", "park", "nod"],
    notes: "A chunky green long-neck dinosaur with orange back plates and a yellow belly, nodding. A dinosaur park on the layout: a fossil wagon from the quarry fills the museum.",
    build: model("life-dinosaur"),
    animate: (root, t) => {
      const n = part(root, "neck");
      if (n) n.rotation.z = Math.sin(t * 1.2) * 0.12 - 0.05;
    },
  },
];

