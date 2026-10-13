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
export const BRIDGE_LENGTH = 216;
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

// Drag snapping: how close a dragged connector must come to a free one to snap.
export const SNAP_CAPTURE_RADIUS = 30;
export const SNAP_HEIGHT_TOLERANCE = RISER_HEIGHT / 2;

export const SPATIAL_CELL_SIZE = 64;
