/**
 * "Send to Claude": a debug report from the game as published on claude.ai. A picture of the current view, the save,
 * and what happened lately (errors, toasts) are stored with the page (its `assets` and `db` capabilities), where the
 * Claude session working on the game reads them. Off the claude.ai page (the dev server), there's no button.
 */

/** What happened lately, newest last: errors and warnings, and the messages the player saw. */
const LOG_SIZE = 80;
const log: { t: number; kind: string; text: string }[] = [];
const started = performance.now();

/** Warnings already logged: a library repeating one (three.js, the BVH) would crowd everything else out. */
const warned = new Set<string>();

export function note(kind: string, text: string): void {
  if (kind === "warn") {
    if (warned.has(text)) return;
    warned.add(text);
  }
  log.push({ t: Math.round(performance.now() - started), kind, text: text.slice(0, 400) });
  if (log.length > LOG_SIZE) log.shift();
}

/** Start keeping the log: console errors and warnings, uncaught errors and rejections. */
export function startLog(): void {
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      note(level, args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack ?? ""}` : String(a))).join(" "));
      original(...args);
    };
  }
  window.addEventListener("error", (e) => note("error", `${e.message} at ${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) => note("error", `unhandled: ${String((e.reason as Error)?.stack ?? e.reason)}`));
}

interface Db {
  collection(path: string): { add(data: Record<string, unknown>): Promise<{ id: string }> };
}
interface Assets {
  upload(blob: Blob, options?: { type?: string }): Promise<{ id: string }>;
}

export interface Reporter {
  /** Send a report: the player's note, the game's state (small, JSON-able), the save, and a picture. */
  send(noteText: string, state: Record<string, unknown>, save: unknown, picture: Blob | null): Promise<string>;
}

/**
 * The reporter where reports can go: the dev server (to `.reports/`), or the game published as a claude.ai artifact
 * (stored with the page, for someone who can edit it). Anywhere else, null: no button.
 */
export async function reporter(): Promise<Reporter | null> {
  if (import.meta.env.DEV) return devReporter();
  const claude = (window as unknown as { claude?: { use?: (name: string) => Promise<unknown> } }).claude;
  if (typeof claude?.use !== "function") return null;
  const [db, assets] = (await Promise.all([claude.use("db"), claude.use("assets")])) as [Db | null, Assets | null];
  if (!db || !assets) return null;
  return {
    async send(noteText, state, save, picture) {
      const saved = await assets.upload(new Blob([JSON.stringify(save)], { type: "application/json" }), { type: "application/json" });
      const shot = picture ? await assets.upload(picture, { type: picture.type || "image/webp" }) : null;
      const doc = await db.collection("reports").add({
        at: new Date().toISOString(),
        note: noteText.slice(0, 4000),
        state,
        log: [...log],
        save: saved.id,
        picture: shot?.id ?? null,
      });
      return doc.id;
    },
  };
}

function devReporter(): Reporter {
  return {
    async send(noteText, state, save, picture) {
      const dataUrl = picture
        ? await new Promise<string>((resolve) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result));
            r.readAsDataURL(picture);
          })
        : null;
      const report = { at: new Date().toISOString(), note: noteText, state, log: [...log] };
      const res = await fetch("/__woodrail/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ report, save, picture: dataUrl }) });
      if (!res.ok) throw new Error(`dev server said ${res.status}`);
      return ((await res.json()) as { id: string }).id;
    },
  };
}
