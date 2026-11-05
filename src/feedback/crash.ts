/**
 * Crash reports: when the game hits an uncaught error or rejection, or the browser takes its drawing away (a lost
 * WebGL context), one small report goes to the cloud Worker's `POST /crash` (cloud/src/crash.ts), so errors on players'
 * phones reach us. At most one a session; none if the player switched them off (☰ "Crash reports").
 *
 * A report holds only: the error's message and stack (links cut to file:line), the build, the browser's user agent
 * (browser and OS), the screen's size and density, the drawing's pixel ratio and the graphics tier. No map, no save,
 * no id. See docs/feedback.md.
 */

export type CrashKind = "error" | "rejection" | "context-lost";

export interface CrashPayload {
  kind: CrashKind;
  message: string;
  stack: string;
  build: string;
  userAgent: string;
  screen: { width: number; height: number; dpr: number };
  pixelRatio: number;
  quality: string;
}

export const CRASH_OFF_KEY = "woodrail.crashReports";
const SENT_KEY = "woodrail.crashSent";
export const MAX_MESSAGE = 300;
export const MAX_STACK = 2000;

/** A stack with its links cut to file:line:col (no host, no query, no #map), and short. */
export function cleanStack(stack: string): string {
  return stack
    .replace(/#[^\s)]*/g, "")
    .replace(/(?:https?|blob|file|chrome-extension):\/\/[^\s)]*\/([^/\s)?]+)(?:\?[^\s):]*)?/g, "$1")
    .slice(0, MAX_STACK);
}

/** The report for an error, from what the page knows. */
export function crashPayload(kind: CrashKind, error: unknown, about: Omit<CrashPayload, "kind" | "message" | "stack">): CrashPayload {
  const e = error as { message?: unknown; stack?: unknown } | null;
  const message = typeof e?.message === "string" ? e.message : String(error ?? "");
  return { kind, message: cleanStack(message).slice(0, MAX_MESSAGE), stack: typeof e?.stack === "string" ? cleanStack(e.stack) : "", ...about };
}

/** Has the player switched crash reports off? */
export function crashReportsOff(): boolean {
  try {
    return localStorage.getItem(CRASH_OFF_KEY) === "off";
  } catch {
    return false;
  }
}

export function setCrashReportsOff(off: boolean): void {
  try {
    if (off) localStorage.setItem(CRASH_OFF_KEY, "off");
    else localStorage.removeItem(CRASH_OFF_KEY);
  } catch {
    // no storage: on for this session, as before
  }
}

export class CrashReporter {
  /** Sent this page (where there's no session storage to say so). */
  private sentHere = false;

  constructor(
    private readonly url: string,
    private readonly about: () => Omit<CrashPayload, "kind" | "message" | "stack">,
    private readonly send: (url: string, body: string) => void = (url, body) =>
      // text/plain: a simple request, no preflight; keepalive, so it goes even as the tab falls over.
      void fetch(url, { method: "POST", body, keepalive: true, headers: { "Content-Type": "text/plain" } }).catch(() => {}),
  ) {}

  /** Has one gone this session (this tab, reloads too)? */
  private get sent(): boolean {
    try {
      return this.sentHere || sessionStorage.getItem(SENT_KEY) === "1";
    } catch {
      return this.sentHere;
    }
  }

  /** Report it, if none has gone this session and the player hasn't said no. True if it was sent. */
  report(kind: CrashKind, error: unknown): boolean {
    if (this.sent || crashReportsOff()) return false;
    this.sentHere = true;
    try {
      sessionStorage.setItem(SENT_KEY, "1");
    } catch {
      // no session storage: once for this page
    }
    try {
      this.send(`${this.url.replace(/\/$/, "")}/crash`, JSON.stringify(crashPayload(kind, error, this.about())));
    } catch {
      // nothing to do: a report is best effort
    }
    return true;
  }

  /** Report uncaught errors and rejections. */
  listen(): void {
    addEventListener("error", (e) => this.report("error", e.error ?? { message: e.message, stack: `at ${e.filename}:${e.lineno}:${e.colno}` }));
    addEventListener("unhandledrejection", (e) => this.report("rejection", e.reason));
  }
}
