const OFFSET = 0x8000; // supports ±32768 cells per axis (±2 km at 64 mm cells)
const SPAN = 0x10000;

/** Uniform-grid hash of numeric item ids. Queries return candidates; callers filter by exact distance. */
export class SpatialHash {
  private readonly cells = new Map<number, number[]>();
  private readonly itemCell = new Map<number, number>();

  constructor(private readonly cellSize: number) {}

  get size(): number {
    return this.itemCell.size;
  }

  has(item: number): boolean {
    return this.itemCell.has(item);
  }

  insert(item: number, x: number, z: number): void {
    this.remove(item);
    const key = this.key(Math.floor(x / this.cellSize), Math.floor(z / this.cellSize));
    let cell = this.cells.get(key);
    if (!cell) {
      cell = [];
      this.cells.set(key, cell);
    }
    cell.push(item);
    this.itemCell.set(item, key);
  }

  remove(item: number): boolean {
    const key = this.itemCell.get(item);
    if (key === undefined) return false;
    const cell = this.cells.get(key)!;
    const i = cell.indexOf(item);
    cell[i] = cell[cell.length - 1];
    cell.pop();
    if (cell.length === 0) this.cells.delete(key);
    this.itemCell.delete(item);
    return true;
  }

  query(x: number, z: number, radius: number, out: number[]): number {
    out.length = 0;
    const cs = this.cellSize;
    const x0 = Math.floor((x - radius) / cs);
    const x1 = Math.floor((x + radius) / cs);
    const z0 = Math.floor((z - radius) / cs);
    const z1 = Math.floor((z + radius) / cs);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const cell = this.cells.get(this.key(cx, cz));
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) out.push(cell[i]);
      }
    }
    return out.length;
  }

  private key(cx: number, cz: number): number {
    return (cx + OFFSET) * SPAN + (cz + OFFSET);
  }
}
