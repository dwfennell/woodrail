// Dimensions in millimetres, based on common wooden-rail standards. Tune against a physical set.
export const TRACK_WIDTH = 40;
export const TRACK_THICKNESS = 12;
export const GROOVE_WIDTH = 6;
export const GROOVE_SPACING = 26; // centre to centre
export const PEG_HEAD_DIAMETER = 12;

export const STRAIGHT_LENGTHS = [54, 108, 144, 216] as const;
export const LARGE_CURVE_RADIUS = 180; // 10 × 18 mm: a quarter turn lands on the track lattice (and the 72 mm grid)
export const SMALL_CURVE_RADIUS = 90;
export const WIDE_CURVE_RADIUS = 270; // 15 × 18 mm: a gentle sweep for wide loops
export const CURVE_SWEEP = Math.PI / 4; // eight curves make a circle

export const SWITCH_LENGTH = 144;
export const CROSSING_SIZE = 144;
export const RISER_HEIGHT = 48;
export const RAMP_LENGTH = 144;
/** Track over other track must be at least this much higher, so trains fit under (the tallest engine is ~72 mm). */
export const TRAIN_CLEARANCE = 2 * RISER_HEIGHT;
export const BRIDGE_LENGTH = 216;
/**
 * The tallest car stands 72.5 mm over its track's base (the double-decker coach; the electric's pantograph 71.6, the
 * classic engine's chimney 66.7): track over track needs this much between their bases (a little to spare).
 */
export const TRAIN_HEADROOM = 76;
/** An underpass sinks its middle this far into the board: one level (48) + this clears `TRAIN_HEADROOM`. */
export const UNDERPASS_DIP = 30;
/** Two 144 straights long: eased down over 96 at each end (no steeper than a ramp), flat for 96 in the middle. */
export const UNDERPASS_LENGTH = 288;
export const UNDERPASS_EASE = 96;
/** Inner half-width of an underpass's trench, and its walls' thickness (mm). */
export const TRENCH_HALF = TRACK_WIDTH / 2 + 4;
export const TRENCH_WALL = 4;
/** How far an underpass's trench starts in from each end (the dip is too shallow there to need one). */
export const TRENCH_INSET = 10;
/** A girder span's pier at each end: this long along its track (mm). */
export const GIRDER_PIER = 14;
export const BUFFER_LENGTH = 54;
export const ADAPTER_LENGTH = 54;
/** Double track: its two lines this far apart (a square), as the S-curve shifts a line. */
export const DOUBLE_TRACK_SPACING = 72;
/** The balloon loop's big circle (mm): long enough round that a whole train is clear of the neck before it comes back. */
export const LOOP_RADIUS = 144;
/** The small balloon loop's circle: about 0.78 m round, still longer than a four-car train. */
export const SMALL_LOOP_RADIUS = 108;
/** A dog-bone joiner's two pegs stand this far apart: the two track ends it joins butt together. */
export const JOINER_LENGTH = 1;

// Arches under bridges (and raised ramps): two round openings, centred at these fractions of the length, with radius
// this fraction of the length, their crowns this far below the deck.
export const ARCH_CENTRES = [0.28, 0.72] as const;
export const ARCH_RADIUS = 0.19;
export const ARCH_CROWN_DROP = RISER_HEIGHT / 4;

// Joint play: how far a peg can be from perfectly seated and still hold. Generous, like real wooden track: straight
// lengths step by 18 mm, so 9 mm lets any straight run close between two fixed ends (station to station).
export const JOINT_POS_TOLERANCE = 9;
export const JOINT_ANGLE_TOLERANCE = (4 * Math.PI) / 180;

// Drag snapping: how close a dragged connector must come to a free one to snap. Tight (was 30), so a piece put down
// near track stays where it's put unless it's dropped at the joint (play-test: the pull made pieces hard to place).
export const SNAP_CAPTURE_RADIUS = 10;
export const SNAP_HEIGHT_TOLERANCE = RISER_HEIGHT / 2;

export const SPATIAL_CELL_SIZE = 64;
