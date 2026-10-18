import { GOALS, type Goal, type GoalProgress } from "../game/goals";
import { ago, type Journal, type JournalEntry, type JournalPlace } from "../game/journal";

/** How often the news times ("2 min ago") are refreshed, only while the News tab is open. */
const NEWS_TICK_MS = 30_000;
/** A small screen (a phone, either way up): the card starts folded up. */
const SMALL_SCREEN = "(max-width: 640px), (max-height: 520px)";
/** Where the open Journal is a bottom sheet (keep in step with style.css). */
const SHEET = "(max-width: 560px), (max-height: 520px)";

/**
 * The panel's count: the goals done of all of them, those waiting for blueprints too ("16 / 17" beside "🔒 Learn
 * Signals to unlock a goal", never "16 / 16", which reads as all done).
 */
export function goalsCountText(done: number, total: number, locked: number): string {
  return `${done} / ${total + locked}`;
}

export interface GoalsPanelHandlers {
  /** All goals done: start a new game. */
  newGame(): void;
  /** Show where the current goal is done, and reach for what it needs. */
  showMe(): void;
  /** A news entry with a place was tapped: fly the camera there. */
  fly(place: JournalPlace): void;
}

const escapeHtml = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Game mode's Journal, under the logo: a chip with the goal to do now (and a bell with the unread news), opening a
 * panel with two tabs: Goals (the goal to do, how far along it is, what comes next) and News (what happened lately).
 * On a phone the open panel is a bottom sheet.
 */
export class GoalsPanel {
  readonly root = document.createElement("section");
  private readonly count = document.createElement("span");
  private readonly body = document.createElement("div");
  /** The Goals tab's content. */
  private readonly pane = document.createElement("div");
  private readonly newsPane = document.createElement("div");
  private readonly tabGoals = document.createElement("button");
  private readonly tabNews = document.createElement("button");
  private readonly bell = document.createElement("span");
  private readonly newsBadge = document.createElement("span");
  private tab: "goals" | "news" = "goals";
  private newsTimer = 0;
  /** The journal entry each News row shows, and the newest entry seq drawn, so a new entry adds to the list in place. */
  private readonly rowEntry = new WeakMap<HTMLElement, JournalEntry>();
  private drawnSeq = 0;
  /** A finger (or button) is down on the News list. */
  private pressed = false;
  /** The current goal's title in the header, shown when the card is folded up. */
  private readonly now = document.createElement("span");
  private readonly showBtn = document.createElement("button");
  /** What's shown now, so an unchanged poll touches nothing. */
  private shownKey = "";

  constructor(
    parent: HTMLElement,
    handlers: GoalsPanelHandlers,
    private readonly journal: Journal,
  ) {
    this.root.className = "goals";
    // Folded up to one line on a small screen, to leave the view clear.
    if (window.matchMedia(SMALL_SCREEN).matches) this.root.classList.add("collapsed");
    this.root.hidden = true;
    const head = document.createElement("button");
    head.className = "goals-head";
    head.title = "Show or hide the goals and news";
    head.innerHTML = `<span class="goals-label">Goals</span>`;
    this.count.className = "goals-count";
    this.now.className = "goals-now";
    this.bell.className = "goals-bell";
    this.bell.hidden = true;
    head.append(this.count, this.bell, this.now);
    head.addEventListener("click", (e) => {
      e.stopPropagation();
      this.setOpen(this.root.classList.contains("collapsed"));
    });
    // Folded up, a small round button beside the goal's title; unfolded, "Show me" sits under the goal's hint.
    this.showBtn.className = "goals-show-icon";
    this.showBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/></svg>`;
    this.showBtn.title = "Show me where to do this goal";
    this.showBtn.setAttribute("aria-label", "Show me where to do this goal");
    this.showBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      handlers.showMe();
    });
    const top = document.createElement("div");
    top.className = "goals-top";
    top.append(head, this.showBtn);
    this.body.className = "goals-body";
    const tabs = document.createElement("div");
    tabs.className = "goals-tabs";
    tabs.setAttribute("role", "tablist");
    this.tabGoals.textContent = "Goals";
    this.newsBadge.className = "goals-tab-badge";
    this.newsBadge.hidden = true;
    this.tabNews.append("News", this.newsBadge);
    for (const [b, which] of [
      [this.tabGoals, "goals"],
      [this.tabNews, "news"],
    ] as const) {
      b.className = "goals-tab";
      b.setAttribute("role", "tab");
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        this.setTab(which);
      });
    }
    const close = document.createElement("button");
    close.className = "goals-close";
    close.textContent = "✕";
    close.title = "Close";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      this.setOpen(false);
    });
    tabs.append(this.tabGoals, this.tabNews, close);
    this.pane.className = "goals-pane";
    this.newsPane.className = "news-pane";
    this.newsPane.hidden = true;
    this.body.append(tabs, this.pane, this.newsPane);
    this.root.append(top, this.body);
    this.setTab("goals");
    // A new entry put in at the top mid-tap would move the row away from the finger: it waits for the press to end
    // (until just after the click it makes).
    this.newsPane.addEventListener("pointerdown", () => (this.pressed = true));
    const release = () => {
      if (!this.pressed) return;
      this.pressed = false;
      window.setTimeout(() => this.syncNews(), 0);
    };
    window.addEventListener("pointerup", release, { capture: true });
    window.addEventListener("pointercancel", release, { capture: true });
    this.newsPane.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>(".news-item");
      const entry = row ? this.rowEntry.get(row) : undefined;
      if (!entry?.place) return;
      // Folded up on a phone, so the sheet doesn't cover where the camera goes.
      if (window.matchMedia(SHEET).matches) this.setOpen(false);
      handlers.fly(entry.place);
    });
    this.body.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest(".goals-new")) handlers.newGame();
      if (t.closest(".goals-show")) {
        e.stopPropagation();
        // Folded up, so the panel doesn't cover what it shows.
        this.setOpen(false);
        handlers.showMe();
      }
    });
    // A phone's sheet closes on a tap outside it (the map, or a drag of the camera, starts with a press).
    window.addEventListener(
      "pointerdown",
      (e) => {
        if (!this.root.classList.contains("collapsed") && window.matchMedia(SHEET).matches && !this.root.contains(e.target as Node)) this.setOpen(false);
      },
      { capture: true },
    );
    parent.appendChild(this.root);
  }

  /** Unfold or fold the card; the News tab counts as read while it's showing. */
  private setOpen(open: boolean): void {
    this.root.classList.toggle("collapsed", !open);
    this.syncNews();
  }

  private setTab(tab: "goals" | "news"): void {
    this.tab = tab;
    this.pane.hidden = tab !== "goals";
    this.newsPane.hidden = tab !== "news";
    for (const [b, which] of [
      [this.tabGoals, "goals"],
      [this.tabNews, "news"],
    ] as const) {
      b.classList.toggle("on", tab === which);
      b.setAttribute("aria-selected", String(tab === which));
    }
    this.syncNews();
  }

  /** The journal changed: the badge, and the list if it's showing. */
  newsChanged(): void {
    this.syncNews();
  }

  /** Badge and list; the 30 s time tick runs only while the News tab is showing in a visible Journal. */
  private syncNews(): void {
    const showing = !this.root.hidden && !this.root.classList.contains("collapsed") && this.tab === "news";
    if (showing) {
      this.journal.markRead();
      this.updateNews();
      this.newsTimer ||= window.setInterval(() => this.refreshTimes(), NEWS_TICK_MS);
    } else if (this.newsTimer) {
      clearInterval(this.newsTimer);
      this.newsTimer = 0;
    }
    const n = this.journal.unread;
    this.bell.hidden = n === 0;
    this.bell.textContent = `🔔${n}`;
    this.newsBadge.hidden = n === 0;
    this.newsBadge.textContent = String(n);
  }

  private row(e: JournalEntry, now: number): HTMLElement {
    const el = document.createElement(e.place ? "button" : "div");
    this.fillRow(el, e, now);
    return el;
  }

  private fillRow(el: HTMLElement, e: JournalEntry, now: number): void {
    el.className = `news-item${e.kind === "milestone" ? " milestone" : ""}${e.place ? " go" : ""}`;
    // One mark per row: a star for a milestone, unless its text has its own (a goal's "✓", maybe joined onto a growth).
    const star = e.kind === "milestone" && !e.text.includes("✓") ? `<i>★</i> ` : "";
    el.innerHTML = `<span class="news-text">${star}${escapeHtml(e.text)}</span><span class="news-time">${ago(now - e.time)}</span>${e.place ? `<span class="news-go" aria-hidden="true">›</span>` : ""}`;
    this.rowEntry.set(el, e);
  }

  /**
   * Bring the list up to date without redrawing it (rows shift under a finger): a new entry is put in at the top, a
   * merged one moves up to the top, and the first showing draws everything.
   */
  private updateNews(): void {
    const now = this.journal.now();
    if (this.pressed && this.drawnSeq !== 0) return;
    const entries = this.journal.entries;
    const pane = this.newsPane;
    if (entries.length === 0) {
      pane.innerHTML = `<p class="news-empty">Nothing yet. Deliveries and boats show up here.</p>`;
      this.drawnSeq = 0;
      return;
    }
    if (this.drawnSeq === 0 || pane.firstElementChild?.classList.contains("news-empty")) {
      pane.replaceChildren(...entries.map((e) => this.row(e, now)));
      this.drawnSeq = entries[0].seq;
      return;
    }
    const have = new Map<JournalEntry, HTMLElement>();
    for (const el of Array.from(pane.children) as HTMLElement[]) {
      const e = this.rowEntry.get(el);
      if (e) have.set(e, el);
    }
    // Entries newer than what's drawn are a prefix of the list (each add or merge takes the next seq).
    const fresh: JournalEntry[] = [];
    for (const e of entries) {
      if (e.seq <= this.drawnSeq) break;
      fresh.push(e);
    }
    // New and merged entries go to the top, newest first (a merged one moves up from where it was).
    const top: HTMLElement[] = [];
    for (const e of fresh) {
      const el = have.get(e);
      if (el) this.fillRow(el, e, now);
      top.push(el ?? this.row(e, now));
    }
    if (top.length > 0) pane.prepend(...top);
    // Entries that fell off the end of the journal.
    const keep = new Set<JournalEntry>(entries);
    for (const [e, el] of have) if (!keep.has(e)) el.remove();
    // A row for every entry and no more: should the list ever disagree (QA once saw an entry's row twice, not
    // reproduced), it's drawn again whole rather than left wrong.
    if (pane.children.length !== entries.length) pane.replaceChildren(...entries.map((e) => this.row(e, now)));
    this.drawnSeq = entries[0].seq;
  }

  /** Only the "2 min ago" texts change on the timer. */
  private refreshTimes(): void {
    const now = this.journal.now();
    for (const el of Array.from(this.newsPane.children) as HTMLElement[]) {
      const e = this.rowEntry.get(el);
      const t = el.querySelector(".news-time");
      if (e && t) t.textContent = ago(now - e.time);
    }
  }

  /** A goal was just done: pop the count. */
  celebrate(): void {
    this.root.classList.remove("ticked");
    void this.root.offsetWidth; // restart the animation
    this.root.classList.add("ticked");
  }

  /** Forget what's shown (a new game starts over without the arrival flourish). */
  reset(): void {
    this.shownKey = "";
    this.drawnSeq = 0;
    this.newsPane.replaceChildren();
    this.syncNews();
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
    // Leaving Game mode: fold the sheet up, and stop the news timer.
    if (!visible) this.root.classList.add("collapsed");
    this.syncNews();
  }

  /**
   * Show the current goal (null when all are done) and its progress. `total`: the goals open or done; `lockedCount` more
   * wait for blueprints (`locked` says which to learn).
   */
  show(done: number, current: Goal | null, progress: GoalProgress | null, next: Goal | null, total = GOALS.length, locked: string | null = null, lockedCount = 0): void {
    const key = `${done}|${total}|${lockedCount}|${current?.id}|${progress?.count}|${next?.id}|${locked}`;
    if (key === this.shownKey) return;
    const fresh = this.shownKey !== "" && !this.shownKey.startsWith(`${done}|`);
    this.shownKey = key;
    this.count.textContent = goalsCountText(done, total, lockedCount);
    this.now.textContent = current?.title ?? locked ?? "All done!";
    this.showBtn.hidden = !current;
    // A goal still to come waits for blueprints: said in a line of its own ("Learn Signals to unlock a goal").
    const lockedRow = locked ? `<div class="goal upcoming locked"><span class="goal-box">🔒</span><span>${locked}</span></div>` : "";
    if (!current && locked) {
      this.pane.innerHTML = lockedRow;
      return;
    }
    if (!current) {
      this.pane.innerHTML = `
        <div class="goal current all-done"><span class="goal-tick">✓</span><div><b>All goals done!</b><p>Every town is on the railway and the planks are flowing.</p></div></div>
        <button class="chip text primary goals-new">New game</button>`;
      return;
    }
    const counted = progress?.target ? `<span class="goal-progress">${progress.count} / ${progress.target} ${progress.unit ?? ""}</span>` : "";
    this.pane.innerHTML = `
      <div class="goal current${fresh ? " arrive" : ""}"><span class="goal-box"></span><div><b>${current.title}</b>${counted}<p>${current.hint}</p><button class="chip text goals-show" title="Show me where to do this goal">Show me</button></div></div>
      ${next ? `<div class="goal upcoming"><span class="goal-box"></span><span>${next.title}</span></div>` : lockedRow}`;
  }
}
