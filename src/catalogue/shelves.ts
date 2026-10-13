/**
 * Which catalogue models the tray offers as props, and where: tab → shelves → asset ids. An asset not listed here
 * isn't in the game yet — see the sandbox assets design's "Deferred" list: roads (waiting for the road system), tunnels
 * (waiting for track that tunnels through hills), the catalogue's own track and trains (they need mechanics), and the
 * sky (clouds, rainbow, sun and moon).
 */
export interface PropShelf {
  label: string;
  assets: readonly string[];
}

export interface PropTab {
  id: string;
  label: string;
  shelves: readonly PropShelf[];
}

export const PROP_TABS: readonly PropTab[] = [
  {
    id: "buildings",
    label: "Buildings",
    shelves: [
      {
        label: "Railway",
        assets: [
          "bldg-country-halt",
          "bldg-two-platform-station",
          "bldg-grand-terminus",
          "bldg-mountain-station",
          "bldg-harbour-station",
          "bldg-signal-box",
          "bldg-ticket-booth",
          "bldg-waiting-shelter",
          "bldg-platform-furnished",
          "bldg-station-clock",
          "bldg-water-tower",
          "bldg-coal-stage",
          "bldg-engine-shed",
          "bldg-roundhouse-segment",
          "bldg-goods-shed",
        ],
      },
      {
        label: "Houses & shops",
        assets: [
          "bldg-townhouse",
          "bldg-thatched-cottage",
          "bldg-timber-house",
          "bldg-bungalow",
          "bldg-brick-house",
          "bldg-narrow-house",
          "bldg-corner-shop",
          "bldg-terrace",
          "bldg-semi-detached",
          "bldg-villa",
          "bldg-cottage-row", "bldg-apartment-block", "bldg-bakery", "bldg-cafe", "bldg-post-office", "bldg-toy-shop", "bldg-market-stall", "bldg-ice-cream-kiosk", "bldg-petrol-station"],
      },
      {
        label: "Town",
        assets: ["bldg-town-hall", "bldg-church", "bldg-school", "bldg-hospital", "bldg-fire-station", "bldg-police-station", "bldg-castle-gate", "bldg-lighthouse", "bldg-control-tower"],
      },
      {
        label: "Farm & industry",
        assets: ["bldg-farmhouse", "bldg-red-barn", "bldg-silo", "bldg-windmill", "bldg-watermill", "bldg-dairy", "bldg-sawmill", "bldg-factory", "bldg-warehouse"],
      },
    ],
  },
  {
    id: "nature",
    label: "Nature",
    shelves: [
      {
        label: "Trees",
        assets: [
          "scene-lollipop-tree",
          "scene-cone-fir",
          "scene-stacked-disc-tree",
          "scene-birch",
          "scene-apple-tree",
          "scene-willow",
          "scene-autumn-tree",
          "scene-palm",
          "scene-snowy-fir",
          "scene-christmas-tree",
          "scene-cactus",
        ],
      },
      { label: "Plants & flowers", assets: ["scene-bush-trio", "scene-hedge", "scene-flower-bed", "scene-tulip-row", "scene-toadstool", "scene-pumpkin-patch"] },
      { label: "Rocks & water", assets: ["scene-rocks", "scene-mountain", "scene-cliff", "scene-waterfall", "scene-lily-pond", "scene-river-bend", "scene-beach"] },
      { label: "Farm", assets: ["scene-crop-rows", "scene-haystacks", "scene-scarecrow", "scene-beehives"] },
      { label: "Outdoors", assets: ["scene-tent", "scene-campfire", "scene-picnic", "scene-snowman"] },
    ],
  },
  {
    id: "town",
    label: "Town",
    shelves: [
      {
        label: "Street",
        assets: [
          "scene-street-lamp",
          "scene-bench",
          "scene-bus-stop",
          "scene-post-box",
          "scene-phone-box",
          "scene-clock-post",
          "scene-signpost",
          "scene-traffic-lights",
          "scene-market-stall",
          "scene-bins-bollards",
          "scene-flagpole",
          "scene-bunting",
        ],
      },
      { label: "Park", assets: ["scene-fountain", "scene-bandstand", "scene-playground", "scene-park-gate", "scene-statue"] },
      { label: "Fences & walls", assets: ["scene-picket-fence", "scene-rail-fence", "scene-stone-wall", "scene-farm-gate", "scene-stile"] },
    ],
  },
  {
    id: "vehicles",
    label: "Vehicles",
    shelves: [
      {
        label: "Road",
        assets: [
          "veh-family-car",
          "veh-taxi",
          "veh-police-car",
          "veh-ambulance",
          "veh-delivery-van",
          "veh-post-van",
          "veh-ice-cream-van",
          "veh-camper-van",
          "veh-town-bus",
          "veh-double-decker",
          "veh-school-bus",
          "veh-trolleybus",
          "veh-motorbike",
          "veh-bicycle",
          "veh-horse-cart",
        ],
      },
      {
        label: "Work",
        assets: [
          "veh-fire-engine",
          "veh-tow-truck",
          "veh-crane-truck",
          "veh-dump-truck",
          "veh-cement-mixer",
          "veh-petrol-tanker",
          "veh-log-truck",
          "veh-tractor-trailer",
          "veh-combine-harvester",
          "veh-forklift",
          "veh-digger",
          "veh-road-roller",
        ],
      },
      { label: "Boats", assets: ["veh-rowing-boat", "veh-sailing-boat", "veh-fishing-boat", "veh-tugboat", "veh-paddle-steamer", "veh-car-ferry", "veh-cargo-ship", "veh-submarine"] },
      { label: "Air", assets: ["veh-propeller-plane", "veh-seaplane", "veh-helicopter", "veh-hot-air-balloon", "veh-airship", "veh-rocket-pad", "veh-space-shuttle"] },
    ],
  },
  {
    id: "life",
    label: "People & animals",
    shelves: [
      {
        label: "Railway people",
        assets: ["life-driver", "life-conductor", "life-station-master", "life-guard", "life-porter", "life-signal-operator", "life-traveller", "life-tourist"],
      },
      {
        label: "Townsfolk",
        assets: [
          "life-family",
          "life-child-balloon",
          "life-grandparent",
          "life-farmer",
          "life-fisher",
          "life-firefighter",
          "life-police",
          "life-postie",
          "life-baker",
          "life-chef",
          "life-doctor",
          "life-builder",
          "life-crane-operator",
          "life-ice-cream-seller",
          "life-band",
        ],
      },
      { label: "Farm animals", assets: ["life-cow", "life-sheep", "life-pig", "life-horse", "life-goat", "life-chickens", "life-ducks", "life-geese", "life-dog", "life-cat"] },
      {
        label: "Wild animals",
        assets: [
          "life-rabbit",
          "life-fox",
          "life-deer",
          "life-squirrel",
          "life-owl",
          "life-frog",
          "life-bear",
          "life-swans",
          "life-fish-jumping",
          "life-seagulls",
          "life-butterfly",
          "life-penguins",
          "life-elephant",
          "life-giraffe",
          "life-dinosaur",
        ],
      },
    ],
  },
  {
    id: "machines",
    label: "Machines",
    shelves: [
      {
        label: "Cranes & loaders",
        assets: [
          "mech-gantry-crane",
          "mech-harbour-crane",
          "mech-magnet-crane",
          "mech-log-loader",
          "mech-coal-chute",
          "mech-coaling-crane",
          "mech-water-crane",
          "mech-grain-elevator",
          "mech-cargo-conveyor",
          "mech-tipping-dump",
          "mech-drop-hopper",
          "mech-fuel-station",
          "mech-weighbridge",
        ],
      },
      {
        label: "Signals & crossings",
        assets: [
          "mech-semaphore-signal",
          "mech-colour-light-signal",
          "mech-signal-gantry",
          "mech-level-crossing",
          "mech-gated-crossing",
          "mech-buffer-stop-lamp",
          "mech-lever-frame",
          "mech-whistle-post",
          "mech-ticket-barrier",
        ],
      },
      { label: "Railway kit", assets: ["mech-turntable", "mech-transfer-table", "mech-train-lift", "mech-train-wash", "mech-track-cleaner", "mech-loop-the-loop", "mech-lighthouse-beacon"] },
    ],
  },
];

/**
 * Decorative bridges: a shelf on the Bridges tab, after the track bridges. (Tunnels wait until track can tunnel through
 * the map's hills: see the design's Deferred list.)
 */
export const BRIDGE_PROP_SHELVES: readonly PropShelf[] = [
  {
    label: "Model bridges",
    assets: [
      "mech-stone-arch-bridge",
      "mech-viaduct",
      "mech-truss-bridge",
      "mech-suspension-bridge",
      "mech-covered-bridge",
      "mech-trestle",
      "mech-rope-bridge",
      "mech-bascule-bridge",
      "mech-swing-bridge",
      "mech-lift-bridge",
      "mech-road-over-rail",
      "mech-river-ford",
    ],
  },
];
