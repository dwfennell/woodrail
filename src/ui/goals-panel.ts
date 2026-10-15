import { GOALS, type Goal, type GoalProgress } from "../game/goals";

export interface GoalsPanelHandlers {
  /** All goals done: start a new game. */
  newGame(): void;
  /** Show where the current goal is done, and reach for what it needs. */
  showMe(): void;
}

/** Game mode's goal card, under the logo: the goal to do now, how far along it is, and what comes next. */
export class GoalsPanel {
  readonly root = document.createElement("section");
  private readonly count = document.createElement("span");
  private readonly body = document.createElement("div");
  /** The current goal's title in the header, shown when the card is folded up. */
  private readonly now = document.createElement("span");
  private readonly showBtn = document.createElement("button");
  /** What's shown now, so an unchanged poll touches nothing. */
  private shownKey = "";

  constructor(parent: HTMLElement, handlers: GoalsPanelHandlers) {
    this.root.className = "goals";
    // Folded up to one line on a small screen, to leave the view clear.
    if (window.matchMedia("(max-width: 640px)").matches) this.root.classList.add("collapsed");
    this.root.hidden = true;
    const head = document.createElement("button");
    head.className = "goals-head";
    head.title = "Show or hide the goals";
    head.innerHTML = `<span class="goals-label">Goals</span>`;
    this.count.className = "goals-count";
    this.now.className = "goals-now";
    head.append(this.count, this.now);
    head.addEventListener("click", (e) => {
      e.stopPropagation();
      this.root.classList.toggle("collapsed");
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
    this.root.append(top, this.body);
    this.body.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest(".goals-new")) handlers.newGame();
      if (t.closest(".goals-show")) {
        e.stopPropagation();
        // Folded up, so the panel doesn't cover what it shows.
        this.root.classList.add("collapsed");
        handlers.showMe();
      }
    });
    parent.appendChild(this.root);
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
      this.body.innerHTML = `
        <div class="goal current all-done"><span class="goal-tick">✓</span><div><b>All goals done!</b><p>Every town is on the railway and the planks are flowing.</p></div></div>
        <button class="chip text primary goals-new">New game</button>`;
      return;
    }
    const counted = progress?.target ? `<span class="goal-progress">${progress.count} / ${progress.target} ${progress.unit ?? ""}</span>` : "";
    this.body.innerHTML = `
      <div class="goal current${fresh ? " arrive" : ""}"><span class="goal-box"></span><div><b>${current.title}</b>${counted}<p>${current.hint}</p><button class="chip text goals-show" title="Show me where to do this goal">Show me</button></div></div>
      ${next ? `<div class="goal upcoming"><span class="goal-box"></span><span>${next.title}</span></div>` : ""}`;
  }
}
