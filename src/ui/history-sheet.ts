import type { HistoryView } from "./history-text";

/**
 * A train's or boat's History sheet (spec docs/superpowers/specs/2026-11-28-delivery-history.md, "The view"), opened
 * from its card: its name, what it moved lately, then a row a stop it called at, newest first: the stop (a tap frames
 * it on the map; the sheet stays), how long ago, and what it picked up and dropped there. Drawn again only when what it
 * shows changes (`refresh` compares a key: the log's version and the minute), never per frame for nothing.
 */
export class HistorySheet {
  readonly root = document.createElement("div");
  private shownKey = -1;
  /** What it's open on ("train:<engine car id>", "boat:<id>"), or "". */
  subject = "";
  /** When it opened: the tap that opened it isn't a tap on its backdrop (a phone's click follows the touch). */
  private openedAt = 0;
  private readonly title = document.createElement("h2");
  private readonly sub = document.createElement("p");
  private readonly summary = document.createElement("p");
  private readonly list = document.createElement("ol");

  constructor(
    private readonly on: {
      /**
       * A number that changes when what the subject's sheet shows does (its log's version, the minute: the "ago"s), or
       * −1: the subject is gone (the sheet closes). Asked every frame while open: no allocation.
       */
      keyOf(subject: string): number;
      /** What the subject's sheet shows: its name, a line about it, its log's view. */
      view(subject: string): { name: string; what: string; view: HistoryView };
      /** Frame a stop on the map. */
      frame(depotId: number): void;
      closed?(): void;
    },
  ) {
    this.root.className = "growth-sheet history-sheet";
    this.root.hidden = true;
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root && performance.now() - this.openedAt > 450) this.close();
    });
    const panel = document.createElement("div");
    panel.className = "gs-panel history-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "History");
    const head = document.createElement("div");
    head.className = "gs-head";
    const x = document.createElement("button");
    x.className = "close";
    x.type = "button";
    x.textContent = "✕";
    x.title = "Close";
    x.setAttribute("aria-label", "Close");
    x.addEventListener("click", () => this.close());
    head.append(this.title, x);
    this.sub.className = "paint-sub history-sub";
    this.summary.className = "history-summary";
    this.list.className = "history-visits";
    panel.append(head, this.sub, this.summary, this.list);
    this.root.append(panel);
    document.body.append(this.root);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(subject: string): void {
    this.subject = subject;
    this.openedAt = performance.now();
    this.root.hidden = false;
    this.shownKey = -1;
    this.list.scrollTop = 0;
    this.refresh();
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.subject = "";
    this.shownKey = -1;
    this.on.closed?.();
  }

  /** Draw again if what it shows changed (cheap to call often: a key compared). */
  refresh(): void {
    if (this.root.hidden) return;
    const key = this.on.keyOf(this.subject);
    if (key < 0) return this.close();
    if (key === this.shownKey) return;
    this.shownKey = key;
    const v = this.on.view(this.subject);
    this.draw(v.name, v.what, v.view);
  }

  private draw(name: string, what: string, v: HistoryView): void {
    this.title.textContent = "History";
    this.sub.textContent = `${name}: ${what}`;
    this.summary.textContent = v.summary;
    this.summary.classList.toggle("empty", v.visits.length === 0);
    const rows: HTMLLIElement[] = [];
    for (const visit of v.visits) {
      const li = document.createElement("li");
      li.className = "history-visit";
      const head = document.createElement(visit.depotId >= 0 ? "button" : "div");
      head.className = "history-stop";
      if (head instanceof HTMLButtonElement) {
        head.type = "button";
        head.title = `Show ${visit.name} on the map`;
        head.dataset.depot = String(visit.depotId);
        head.addEventListener("click", (e) => {
          e.stopPropagation();
          this.on.frame(visit.depotId);
        });
      }
      const nm = document.createElement("span");
      nm.className = "history-stop-name";
      nm.textContent = visit.name;
      const ago = document.createElement("span");
      ago.className = "history-ago";
      ago.textContent = visit.ago;
      head.append(nm, ago);
      const ul = document.createElement("ul");
      ul.className = "history-lines";
      for (const l of visit.lines) {
        const row = document.createElement("li");
        row.className = `history-line ${l.drop ? "drop" : "pick"}`;
        const t = document.createElement("span");
        t.className = "history-line-text";
        t.textContent = l.text;
        row.append(t);
        if (l.coins > 0) {
          const c = document.createElement("span");
          c.className = "history-coins";
          c.textContent = `+${l.coins}🪙`;
          row.append(c);
        }
        ul.append(row);
      }
      li.append(head, ul);
      rows.push(li);
    }
    this.list.replaceChildren(...rows);
  }
}
