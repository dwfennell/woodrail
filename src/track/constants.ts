// Dimensions in millimetres, based on common wooden-rail standards. Tune against a physical set.
export const TRACK_WIDTH = 40;
export const TRACK_THICKNESS = 12;
export const GROOVE_WIDTH = 6;
export const GROOVE_SPACING = 26; // centre to centre
export const PEG_HEAD_DIAMETER = 12;

export const STRAIGHT_LENGTHS = [54, 108, 144, 216] as const;
export const LARGE_CURVE_RADIUS = 182;
export const SMALL_CURVE_RADIUS = 90;
export const CURVE_SWEEP = Math.PI / 4; // eight curves make a circle

export const SWITCH_LENGTH = 144;
export const CROSSING_SIZE = 144;
export const RISER_HEIGHT = 64;
export const RAMP_LENGTH = 216;
export const BRIDGE_LENGTH = 216;
export const BUFFER_LENGTH = 54;
export const ADAPTER_LENGTH = 54;

// Joint play: how far a peg can be from perfectly seated and still hold.
export const JOINT_POS_TOLERANCE = 1.5;
export const JOINT_ANGLE_TOLERANCE = (2 * Math.PI) / 180;

// Drag snapping: how close a dragged connector must come to a free one to snap.
export const SNAP_CAPTURE_RADIUS = 30;
export const SNAP_HEIGHT_TOLERANCE = RISER_HEIGHT / 2;

export const SPATIAL_CELL_SIZE = 64;
