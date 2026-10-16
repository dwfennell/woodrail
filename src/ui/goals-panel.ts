import { GOALS, type Goal, type GoalProgress } from "../game/goals";
import { ago, type Journal, type JournalPlace } from "../game/journal";

/** How often the news times ("2 min ago") are refreshed, only while the News tab is open. */
const NEWS_TICK_MS = 30_000;

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
    if (window.matchMedia("(max-width: 640px)").matches) this.root.classList.add("collapsed");
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
    this.newsPane.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>(".news-item[data-i]");
      const entry = row ? this.journal.entries[Number(row.dataset.i)] : undefined;
      if (!entry?.place) return;
      // Folded up on a phone, so the sheet doesn't cover where the camera goes.
      if (window.matchMedia("(max-width: 560px)").matches) this.setOpen(false);
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

  /** Badge and list; the 30 s time tick runs only while the News tab is showing. */
  private syncNews(): void {
    const showing = !this.root.classList.contains("collapsed") && this.tab === "news";
    if (showing) {
      this.journal.markRead();
      this.renderNews();
      this.newsTimer ||= window.setInterval(() => this.renderNews(), NEWS_TICK_MS);
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

  private renderNews(): void {
    const now = performance.now();
    const rows = this.journal.entries.map((e, i) => {
      const tag = e.place ? "button" : "div";
      const star = e.kind === "milestone" ? `<i>★</i> ` : "";
      return `<${tag} class="news-item${e.kind === "milestone" ? " milestone" : ""}${e.place ? " go" : ""}" data-i="${i}"><span class="news-text">${star}${escapeHtml(e.text)}</span><span class="news-time">${ago(now - e.time)}</span>${e.place ? `<span class="news-go" aria-hidden="true">›</span>` : ""}</${tag}>`;
    });
    this.newsPane.innerHTML = rows.length > 0 ? rows.join("") : `<p class="news-empty">Nothing yet. Deliveries and boats show up here.</p>`;
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
    this.syncNews();
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  /** Show the current goal (null when all are done) and its progress. */
  show(done: number, current: Goal | null, progress: GoalProgress | null, next: Goal | null): void {
    const key = `${done}|${current?.id}|${progress?.count}|${next?.id}`;
    if (key === this.shownKey) return;
    const fresh = this.shownKey !== "" && !this.shownKey.startsWith(`${done}|`);
    this.shownKey = key;
    this.count.textContent = `${done} / ${GOALS.length}`;
    this.now.textContent = current?.title ?? "All done!";
    this.showBtn.hidden = !current;
    if (!current) {
      this.pane.innerHTML = `
        <div class="goal current all-done"><span class="goal-tick">✓</span><div><b>All goals done!</b><p>Every town is on the railway and the planks are flowing.</p></div></div>
        <button class="chip text primary goals-new">New game</button>`;
      return;
    }
    const counted = progress?.target ? `<span class="goal-progress">${progress.count} / ${progress.target} ${progress.unit ?? ""}</span>` : "";
    this.pane.innerHTML = `
      <div class="goal current${fresh ? " arrive" : ""}"><span class="goal-box"></span><div><b>${current.title}</b>${counted}<p>${current.hint}</p><button class="chip text goals-show" title="Show me where to do this goal">Show me</button></div></div>
      ${next ? `<div class="goal upcoming"><span class="goal-box"></span><span>${next.title}</span></div>` : ""}`;
  }
}
