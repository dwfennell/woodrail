/**
 * Ways into the in-game help (help.ts, the "Learn more" sheet): which page an industry card or a research ticket opens.
 * Small, and loaded with the HUD; the pages themselves are worked out from the game's tables the first time help opens.
 * A page's ref is the web wiki's path for it without the slashes round it (`industries/sawmill`, `research/sawmills`):
 * `help.test.ts` checks every one here is a page.
 */
import { built, TECHS } from "../game/tech";
import { INDUSTRY_GROUPS } from "./tray-catalogue";

/** The help's front page: every topic (☰ Help topics). */
export const HELP_HOME = "help";

const slug = (id: string): string => id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const INDUSTRY_TYPES: ReadonlySet<string> = new Set(INDUSTRY_GROUPS.flatMap((g) => g.items).flatMap((i) => (i.kind === "piece" ? [i.type] : [])));
const BUILT_ROWS: ReadonlySet<string> = new Set(TECHS.filter(built).map((t) => t.id));

/** An industry's help page by its piece type (`depot-sawmill`), or null (a town, a station: none). */
export const industryHelpRef = (type: string): string | null => (INDUSTRY_TYPES.has(type) ? `industries/${slug(type.replace(/^depot-/, ""))}` : null);

/** A research row's help page, or null for a row not built yet (the help leaves planned rows out). */
export const researchHelpRef = (id: string): string | null => (BUILT_ROWS.has(id) ? `research/${slug(id)}` : null);
