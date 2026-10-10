import { pieceOfRef, type Layout } from "../track";

/**
 * Pairs of towns (a < b) whose station pieces are joined by any continuous track.
 * Direction and switch state are ignored: it's about whether the rails reach, not where trains go today.
 */
export function connectedPairs(layout: Layout, stations: ReadonlyMap<number, number>): [number, number][] {
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let p = parent.get(x) ?? x;
    if (p !== x) {
      p = find(p);
      parent.set(x, p);
    }
    return p;
  };
  for (const j of layout.joints()) {
    const a = find(pieceOfRef(j.a));
    const b = find(pieceOfRef(j.b));
    if (a !== b) parent.set(a, b);
  }
  const towns = [...stations.entries()].sort((x, y) => x[0] - y[0]);
  const pairs: [number, number][] = [];
  for (let i = 0; i < towns.length; i++) {
    for (let k = i + 1; k < towns.length; k++) {
      if (find(towns[i][1]) === find(towns[k][1])) pairs.push([towns[i][0], towns[k][0]]);
    }
  }
  return pairs;
}
