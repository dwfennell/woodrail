import { dateText } from "../game/calendar";
import { GOALS, type Goal, type GoalProgress } from "../game/goals";
import { type Journal, type JournalEntry, type JournalPlace } from "../game/journal";
import { STICKERS, type Sticker, type StickerTheme } from "../game/stickers";

/** The Stickers tab's headings, in order. */
const THEMES: readonly [StickerTheme, string][] = [
  ["building", "Building"],
  ["trains", "Trains"],
  ["towns", "Towns"],
  ["economy", "Goods and coins"],
];

/** What the Stickers tab shows: those earned, those not yet seen there, and whether the core goals are done. */
export interface StickersShown {
  earned: readonly string[];
  unseen: readonly string[];
  /** The core goals done: the tab shows (before, a sticker earned is only a dot on the chip). */
  open: boolean;
}

/** A sticker's ticket line: how to earn it (a hidden one not yet earned: its hint). */
export function stickerTicket(s: Sticker, earned: boolean): string {
  if (s.hidden && !earned) return `Hint: ${s.hint}`;
  return earned ? `Earned! ${s.how}.` : `${s.how}.`;
}

/** A small screen (a phone, either way up): the card starts folded up. */
const SMALL_SCREEN = "(max-width: 640px), (max-height: 520px)";
/** Where the open Journal is a bottom sheet (keep in step with style.css). */
const SHEET = "(max-width: 560px), (max-height: 520px)";

/**
 * The panel's count: the goals done of all of them, those waiting for blueprints too ("16 / 17" beside "🔒 Learn
 * Signals to unlock a goal", never "16 / 16", which reads as all done).
 */
/** How long New game asks before it goes back to itself (ms): as the menu's (see hud.ts). */
const ASK_MS = 4000;

/** When a News entry happened, as the railway's date ("Mar 2001": its time is on the game's clock, in ms). */
const when = (e: JournalEntry): string => dateText(e.time / 1000);

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
  /** The Stickers tab was looked at: its new ones are seen. */
  stickersSeen(): void;
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
  private readonly tabStickers = document.createElement("button");
  private readonly stickersPane = document.createElement("div");
  /** A sticker earned and not yet seen in its tab: a dot on the chip. */
  private readonly dot = document.createElement("span");
  private stickers: StickersShown = { earned: [], unseen: [], open: false };
  private stickersKey = "";
  /** The sticker whose ticket is open. */
  private picked: string | null = null;
  private readonly bell = document.createElement("span");
  private readonly newsBadge = document.createElement("span");
  private tab: "goals" | "news" | "stickers" = "goals";
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
    this.dot.className = "goals-dot";
    this.dot.hidden = true;
    this.dot.title = "A sticker earned! Finish the goals to see your stickers.";
    head.append(this.count, this.bell, this.dot, this.now);
    head.addEventListener("click", (e) => {
      e.stopPropagation();
      this.setOpen(this.root.classList.contains("collapsed"));
    });
    // Folded up, a small round button beside the goal's title; unfolded, "Show me" sits under the goal's hint.
    this.showBtn.className = "goals-show-icon";
    // (The room for the word changes as the phone turns.)
    let refit = 0;
    addEventListener("resize", () => {
      cancelAnimationFrame(refit);
      refit = requestAnimationFrame(() => this.fitShow());
    });
    this.showBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/></svg><span class="goals-show-word">Show me</span>`;
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
    this.tabStickers.textContent = "Stickers";
    this.tabStickers.hidden = true;
    for (const [b, which] of [
      [this.tabGoals, "goals"],
      [this.tabNews, "news"],
      [this.tabStickers, "stickers"],
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
    tabs.append(this.tabGoals, this.tabNews, this.tabStickers, close);
    this.pane.className = "goals-pane";
    this.newsPane.className = "news-pane";
    this.newsPane.hidden = true;
    this.stickersPane.className = "stickers-pane";
    this.stickersPane.hidden = true;
    this.stickersPane.addEventListener("click", (e) => {
      const tile = (e.target as HTMLElement).closest<HTMLElement>(".sticker");
      if (!tile) return;
      e.stopPropagation();
      this.picked = this.picked === tile.dataset.id ? null : tile.dataset.id!;
      this.drawStickers(true);
    });
    this.handlers = handlers;
    this.body.append(tabs, this.pane, this.newsPane, this.stickersPane);
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
      const again = t.closest<HTMLElement>(".goals-new");
      if (again) {
        // Starting over loses the game's progress: the first tap asks, a second (while it asks) does it.
        e.stopPropagation();
        if (!again.classList.contains("asking")) {
          again.classList.add("asking");
          again.textContent = "Start over? Tap again";
          window.setTimeout(() => {
            again.classList.remove("asking");
            again.textContent = "New game";
          }, ASK_MS);
          return;
        }
        handlers.newGame();
      }
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
    this.syncStickers();
    this.fitShow();
  }

  /**
   * Folded, "Show me" has its word beside its ⌖ where the goal's title still fits beside it (QA: unlabelled), and is
   * the round ⌖ alone where the word would cut the title short (a long one on a narrow phone). Measured when the title
   * or the room changes, not per frame.
   */
  private fitShow(): void {
    this.root.classList.remove("show-tight", "title-small");
    if (!this.root.classList.contains("collapsed") || this.now.clientWidth === 0) return;
    const cut = () => this.now.scrollWidth > this.now.clientWidth + 1;
    if (cut()) this.root.classList.add("show-tight");
    // (Cut even then, "Bring planks to the workshop" at 390 px (QA): the title a little smaller.)
    if (cut()) this.root.classList.add("title-small");
  }

  private setTab(tab: "goals" | "news" | "stickers"): void {
    this.tab = tab;
    this.pane.hidden = tab !== "goals";
    this.newsPane.hidden = tab !== "news";
    this.stickersPane.hidden = tab !== "stickers";
    for (const [b, which] of [
      [this.tabGoals, "goals"],
      [this.tabNews, "news"],
      [this.tabStickers, "stickers"],
    ] as const) {
      b.classList.toggle("on", tab === which);
      b.setAttribute("aria-selected", String(tab === which));
    }
    this.syncNews();
    this.syncStickers();
  }

  private readonly handlers: GoalsPanelHandlers;

  /** Open the Journal on its Stickers tab (a sticker's toast was tapped), on one sticker's ticket if given. */
  openStickers(id?: string): void {
    if (!this.stickers.open || this.root.hidden) return;
    if (id) this.picked = id;
    this.setTab("stickers");
    this.setOpen(true);
  }

  /** The stickers earned and seen, and whether the tab shows yet (cheap when unchanged: called with every goals check). */
  setStickers(shown: StickersShown): void {
    const key = `${shown.open}|${shown.earned.join(",")}|${shown.unseen.join(",")}`;
    if (key === this.stickersKey) return;
    this.stickersKey = key;
    this.stickers = shown;
    this.tabStickers.hidden = !shown.open;
    if (!shown.open && this.tab === "stickers") this.setTab("goals");
    this.dot.hidden = shown.unseen.length === 0;
    this.dot.title = shown.open ? "A new sticker! See it in the Stickers tab" : "A sticker earned! Finish the goals to see your stickers.";
    this.tabStickers.classList.toggle("fresh", shown.open && shown.unseen.length > 0);
    this.drawStickers(false);
    this.syncStickers();
  }

  /** The tab looked at: its new stickers are seen (the dot goes once the next check says so). */
  private syncStickers(): void {
    const showing = !this.root.hidden && !this.root.classList.contains("collapsed") && this.tab === "stickers";
    if (showing && this.stickers.unseen.length > 0) this.handlers.stickersSeen();
  }

  /** The tab: a count, then a grid of tiles under each theme's heading; a tapped tile's ticket under the grid. */
  private drawStickers(force: boolean): void {
    if (!this.stickers.open && !force) {
      this.stickersPane.replaceChildren();
      return;
    }
    const earned = new Set(this.stickers.earned);
    const unseen = new Set(this.stickers.unseen);
    const tile = (s: Sticker) => {
      const got = earned.has(s.id);
      const name = s.hidden && !got ? "???" : s.title;
      const cls = `sticker${got ? " got" : ""}${unseen.has(s.id) ? " new" : ""}${this.picked === s.id ? " picked" : ""}`;
      return `<button class="${cls}" data-id="${s.id}" title="${escapeHtml(`${name}: ${stickerTicket(s, got)}`)}" aria-label="${escapeHtml(name)}"><span class="sticker-icon">${s.hidden && !got ? "❔" : s.icon}</span><span class="sticker-name">${escapeHtml(name)}</span></button>`;
    };
    const groups = THEMES.flatMap(([theme, label]) => {
      const of = STICKERS.filter((s) => s.theme === theme);
      return of.length === 0 ? [] : [`<h4 class="stickers-theme">${label}</h4><div class="stickers-grid">${of.map(tile).join("")}</div>`];
    });
    const picked = STICKERS.find((s) => s.id === this.picked);
    const ticket = picked
      ? `<p class="sticker-ticket"><b>${escapeHtml(picked.hidden && !earned.has(picked.id) ? "???" : picked.title)}</b> ${escapeHtml(stickerTicket(picked, earned.has(picked.id)))}</p>`
      : `<p class="sticker-ticket hint">Tap a sticker to see how to earn it.</p>`;
    this.stickersPane.innerHTML = `<p class="stickers-count">🌟 ${earned.size} / ${STICKERS.length} stickers</p>${ticket}${groups.join("")}`;
  }

  /** The journal changed: the badge, and the list if it's showing. */
  newsChanged(): void {
    this.syncNews();
  }

  /** Badge and list (each entry dated as it happened: nothing on a timer). */
  private syncNews(): void {
    const showing = !this.root.hidden && !this.root.classList.contains("collapsed") && this.tab === "news";
    if (showing) {
      this.journal.markRead();
      this.updateNews();
    }
    const n = this.journal.unread;
    this.bell.hidden = n === 0;
    this.bell.textContent = `🔔${n}`;
    this.newsBadge.hidden = n === 0;
    this.newsBadge.textContent = String(n);
  }

  private row(e: JournalEntry): HTMLElement {
    const el = document.createElement(e.place ? "button" : "div");
    this.fillRow(el, e);
    return el;
  }

  private fillRow(el: HTMLElement, e: JournalEntry): void {
    el.className = `news-item${e.kind === "milestone" ? " milestone" : ""}${e.place ? " go" : ""}`;
    // One mark per row: a star for a milestone, unless its text has its own (a goal's "✓", maybe joined onto a growth).
    const star = e.kind === "milestone" && !e.text.includes("✓") ? `<i>★</i> ` : "";
    el.innerHTML = `<span class="news-text">${star}${escapeHtml(e.text)}</span><span class="news-time">${when(e)}</span>${e.place ? `<span class="news-go" aria-hidden="true">›</span>` : ""}`;
    this.rowEntry.set(el, e);
  }

  /**
   * Bring the list up to date without redrawing it (rows shift under a finger): a new entry is put in at the top, a
   * merged one moves up to the top, and the first showing draws everything.
   */
  private updateNews(): void {
    if (this.pressed && this.drawnSeq !== 0) return;
    const entries = this.journal.entries;
    const pane = this.newsPane;
    if (entries.length === 0) {
      pane.innerHTML = `<p class="news-empty">Nothing yet. Towns growing, things learned and new places show up here.</p>`;
      this.drawnSeq = 0;
      return;
    }
    if (this.drawnSeq === 0 || pane.firstElementChild?.classList.contains("news-empty")) {
      pane.replaceChildren(...entries.map((e) => this.row(e)));
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
      if (el) this.fillRow(el, e);
      top.push(el ?? this.row(e));
    }
    if (top.length > 0) pane.prepend(...top);
    // Entries that fell off the end of the journal.
    const keep = new Set<JournalEntry>(entries);
    for (const [e, el] of have) if (!keep.has(e)) el.remove();
    // A row for every entry and no more: should the list ever disagree (QA once saw an entry's row twice, not
    // reproduced), it's drawn again whole rather than left wrong.
    if (pane.children.length !== entries.length) pane.replaceChildren(...entries.map((e) => this.row(e)));
    this.drawnSeq = entries[0].seq;
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
    this.picked = null;
    this.setStickers({ earned: [], unseen: [], open: false });
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
    const key = `${done}|${total}|${lockedCount}|${current?.id}|${progress?.count}|${progress?.hint}|${next?.id}|${locked}|${this.stickers.open}|${this.stickers.earned.length}`;
    if (key === this.shownKey) return;
    const fresh = this.shownKey !== "" && !this.shownKey.startsWith(`${done}|`);
    this.shownKey = key;
    this.count.textContent = goalsCountText(done, total, lockedCount);
    this.now.textContent = current?.title ?? locked ?? (this.stickers.open ? `Goals ✓ · 🌟 ${this.stickers.earned.length} / ${STICKERS.length}` : "All done!");
    this.showBtn.hidden = !current;
    this.fitShow();
    // A goal still to come waits for blueprints: said in a line of its own ("Research Signals to unlock a goal").
    const lockedRow = locked ? `<div class="goal upcoming locked"><span class="goal-box">🔒</span><span>${locked}</span></div>` : "";
    if (!current && locked) {
      this.pane.innerHTML = lockedRow;
      return;
    }
    if (!current) {
      this.pane.innerHTML = `
        <div class="goal current all-done"><span class="goal-tick">✓</span><div><b>All goals done!</b><p>Every town is on the railway and the planks are flowing.${this.stickers.open ? " Now collect the stickers!" : ""}</p></div></div>
        <button class="chip text primary goals-new">New game</button>`;
      return;
    }
    const counted = progress?.target ? `<span class="goal-progress">${progress.count} / ${progress.target} ${progress.unit ?? ""}</span>` : "";
    this.pane.innerHTML = `
      <div class="goal current${fresh ? " arrive" : ""}"><span class="goal-box"></span><div><b>${current.title}</b>${counted}<p>${progress?.hint ?? current.hint}</p><button class="chip text goals-show" title="Show me where to do this goal">Show me</button></div></div>
      ${next ? `<div class="goal upcoming"><span class="goal-box"></span><span>${next.title}</span></div>` : lockedRow}`;
  }
}
