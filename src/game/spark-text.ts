import type { PowerPlan } from "./power";

/**
 * The spark balance on the top bar (Game mode, once the map has made a spark): "⚡ 3/5", spare of made, and what a tap
 * on it says (where the sparks come from, what takes them). Spare is made less wanted, so it goes below 0 at a
 * shortfall ("⚡ −1/5", drawn red), and the sheet names what goes without: the last engines, masts and yards in line
 * (src/game/power.ts shares sparks out engines first, then masts, then yards).
 */

export interface SparkLine {
  readonly text: string;
  /** Said as a warning (a shortfall): stamped red. */
  readonly warn?: boolean;
}

export interface SparkView {
  /** Made less wanted: below 0 at a shortfall. */
  readonly spare: number;
  readonly made: number;
  /** Sparks short (0: enough). */
  readonly short: number;
  /** The chip's count: "3/5", "−1/5". */
  readonly label: string;
  /** The chip's title and spoken label. */
  readonly title: string;
  /** The sheet's lines, in order. */
  readonly lines: readonly SparkLine[];
  /** Everything above, as one string: the page is touched only when it changes. */
  readonly key: string;
}

export interface SparkNames {
  /** An electric engine's name, by car id ("" for none). */
  engine(carId: number): string;
  /** A yard's name, by depot id ("Sawmill"). */
  yard(depotId: number): string;
}

const s = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;
/** A minus sign, not a hyphen, before a count below 0. */
const signed = (n: number) => (n < 0 ? `−${-n}` : String(n));

/** "Pip, Bramble and 2 more": a few named, the rest counted. */
function listed(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

/** What goes without a spark, in plain words: "Pip runs at steam speed", "the Sawmill waits for one". */
export function starvedText(p: PowerPlan, names: SparkNames): string {
  const parts: string[] = [];
  const slow = p.engines.filter((id) => !p.enginesOn.has(id));
  if (slow.length > 0) {
    const named = slow.map((id) => names.engine(id)).filter((n) => n !== "");
    const who =
      named.length === slow.length
        ? listed(named)
        : slow.length === 1
          ? p.engines.length === 1
            ? "your electric engine"
            : "the last electric engine"
          : `${slow.length} electric engines`;
    parts.push(`${who} ${slow.length === 1 ? "runs" : "run"} at steam speed`);
  }
  const quiet = p.masts.length - p.mastsOn.size;
  if (quiet > 0)
    parts.push(
      quiet === 1 ? "a radio mast is quiet" : `${quiet} radio masts are quiet`,
    );
  const waiting = p.yards.filter((id) => !p.yardsOn.has(id));
  if (waiting.length > 0)
    parts.push(
      `${listed(
        waiting.map((id) => {
          const n = names.yard(id);
          return `the ${n.charAt(0).toLowerCase()}${n.slice(1)}`;
        }),
      )} ${waiting.length === 1 ? "waits" : "wait"} for a spark`,
    );
  const text = parts.join("; ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The balance as the top bar shows it, and its sheet. */
export function sparkView(p: PowerPlan, names: SparkNames): SparkView {
  const wanted = p.engines.length + p.masts.length + p.yards.length;
  const spare = p.made - wanted;
  const short = Math.max(0, -spare);
  const label = `${signed(spare)}/${p.made}`;
  const lines: SparkLine[] = [];
  const from: string[] = [];
  if (p.fromCoal > 0)
    from.push(`${p.fromCoal} from coal (${s(p.stations, "power station")})`);
  if (p.fromWind > 0)
    from.push(`${p.fromWind} from the wind (${s(p.turbines, "turbine")})`);
  lines.push({
    text:
      p.made === 0
        ? "⚡ No sparks made: bring coal to a power station"
        : `⚡ ${s(p.made, "spark")} made: ${from.join(", ")}`,
  });
  if (p.engines.length > 0) {
    const slow = p.engines.length - p.enginesOn.size;
    lines.push({
      text: `🚂 Electric engines: ${p.engines.length}${slow > 0 ? `, ${slow} at steam speed` : ", all powered"}`,
    });
  }
  if (p.masts.length > 0) {
    const quiet = p.masts.length - p.mastsOn.size;
    lines.push({
      text: `⚡ Radio masts: ${p.masts.length}${quiet > 0 ? `, ${quiet} quiet` : ""}`,
    });
  }
  if (p.yards.length > 0) {
    const waiting = p.yards.length - p.yardsOn.size;
    lines.push({
      text: `🏭 Powered yards: ${p.yardsOn.size}${waiting > 0 ? `, ${waiting} waiting` : ""}`,
    });
  }
  if (short > 0)
    lines.push({
      text: `${s(short, "spark")} short. ${starvedText(p, names)}.`,
      warn: true,
    });
  else if (spare > 0)
    lines.push({
      text: `${spare} spare: power a yard from its card to speed it up`,
    });
  else if (p.made > 0) lines.push({ text: "None spare: all in use" });
  const title =
    short > 0
      ? `Sparks: ${s(short, "spark")} short`
      : `Sparks: ${spare} of ${p.made} spare`;
  const key = `${label}|${title}|${lines.map((l) => `${l.warn ? "!" : ""}${l.text}`).join("|")}`;
  return { spare, made: p.made, short, label, title, lines, key };
}
