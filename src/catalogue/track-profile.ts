/** The slab's cross-section: `w` wide, 12 thick, its top edges chamfered. */
export function slabProfile(w: number, offsets: readonly number[]): [number, number][] {
  const height = 12, railOffset = 13;
  const edge = w / 2;
  const profile: [number, number][] = [[-edge + 0.7, 0], [edge - 0.7, 0], [edge, 0.7], [edge, height - 1.4], [edge - 1.4, height]];
  const channels = offsets.flatMap(off => [off + railOffset, off - railOffset]).sort((a, b) => b - a);
  for (const l of channels) {
    profile.push([l + 3.4, height], [l + 2.6, height - 2.3], [l + 1.9, height - 2.9],
      [l - 1.9, height - 2.9], [l - 2.6, height - 2.3], [l - 3.4, height]);
  }
  profile.push([-edge + 1.4, height], [-edge, height - 1.4], [-edge, 0.7]);
  return profile;
}
