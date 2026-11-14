/**
 * Links from the game to the public wiki (src/wiki, `npm run wiki`): its home, an industry's page, a research row's.
 * Each page's path is the wiki's own (`src/wiki/data.ts`'s slugs: `wiki.test.ts` checks every one here is a page).
 */
import { TECHS } from "../game/tech";
import { INDUSTRY_GROUPS } from "./tray-catalogue";

export const WIKI_URL = "https://dwfennell.github.io/woodrail/wiki/";

const slug = (id: string): string => id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const INDUSTRY_TYPES: ReadonlySet<string> = new Set(INDUSTRY_GROUPS.flatMap((g) => g.items).flatMap((i) => (i.kind === "piece" ? [i.type] : [])));
const ROWS: ReadonlySet<string> = new Set(TECHS.map((t) => t.id));

/** An industry's wiki page by its piece type (`depot-sawmill`), or null (a town, a station: no page). */
export const industryWikiUrl = (type: string): string | null => (INDUSTRY_TYPES.has(type) ? `${WIKI_URL}industries/${slug(type.replace(/^depot-/, ""))}/` : null);

/** A research row's wiki page, or null for an id that isn't a row. */
export const researchWikiUrl = (id: string): string | null => (ROWS.has(id) ? `${WIKI_URL}research/${slug(id)}/` : null);
