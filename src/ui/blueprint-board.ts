/** One blueprint as the board shows it. */
export interface BoardCard {
  id: string;
  label: string;
  blurb: string;
  /** What it lets you make ("Switch, Y switch"). */
  makes: string;
  /** "6 planks" (for those that can be learned with goods). */
  cost?: string;
  /** Can it be paid for now (the workshop's yard has the goods)? */
  affordable?: boolean;
  /** Later: what it waits for ("needs Switches"). */
  waits?: string;
}

export interface BoardView {
  /** Choices from towns that grew: pick one of each pair, free. */
  offers: { from: string; cards: BoardCard[] }[];
  /** On the board: learn with goods. */
  board: BoardCard[];
  learned: BoardCard[];
  later: BoardCard[];
  /** "The workshop's yard has 7 planks" (or how to get one). */
  stock: string;
}

export interface BlueprintBoardHandlers {
  choose(offer: number, id: string): void;
  learn(id: string): void;
  close(): void;
}

/**
 * The blueprint board (Game mode): choices waiting from towns that grew, blueprints to learn with goods, and what's
 * learned and still to come. A panel over the game, rebuilt only when what it shows changed.
 */
export class BlueprintBoard {
  readonly root = document.createElement("div");
  private readonly body = document.createElement("div");
  private shownKey = "";

  constructor(parent: HTMLElement, handlers: BlueprintBoardHandlers) {
    this.root.className = "board-panel";
    this.root.hidden = true;
    const head = document.createElement("div");
    head.className = "board-head";
    head.innerHTML = `<h2>Blueprints</h2>`;
    const close = document.createElement("button");
    close.className = "close";
    close.textContent = "✕";
    close.title = "Close";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      handlers.close();
    });
    head.appendChild(close);
    this.body.className = "board-body";
    this.root.append(head, this.body);
    this.body.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("button[data-act]");
      if (!b || (b as HTMLButtonElement).disabled) return;
      e.stopPropagation();
      if (b.dataset.act === "choose") handlers.choose(Number(b.dataset.offer), b.dataset.id!);
      else handlers.learn(b.dataset.id!);
    });
    parent.appendChild(this.root);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  setOpen(open: boolean): void {
    this.root.hidden = !open;
    if (!open) this.shownKey = "";
  }

  show(v: BoardView): void {
    const key = JSON.stringify(v);
    if (key === this.shownKey) return;
    this.shownKey = key;
    const card = (c: BoardCard, cls: string, action = "") =>
      `<div class="bp ${cls}"><b>${c.label}</b><span class="bp-blurb">${c.blurb}</span><span class="bp-makes">Makes: ${c.makes}</span>${c.waits ? `<span class="bp-waits">${c.waits}</span>` : ""}${action}</div>`;
    let html = "";
    v.offers.forEach((o, k) => {
      html += `<section class="bp-offer"><div class="bp-title">${o.from} grew! Choose one to learn now, free. The other goes on the board.</div><div class="bp-row">${o.cards
        .map((c) => card(c, "offered", `<button class="chip text primary" data-act="choose" data-offer="${k}" data-id="${c.id}">Learn this</button>`))
        .join(`<span class="or">or</span>`)}</div></section>`;
    });
    if (v.board.length > 0)
      html += `<div class="bp-title">Learn with planks <span class="bp-stock">${v.stock}</span></div><div class="bp-grid">${v.board
        .map((c) => card(c, "pencil", `<button class="chip text${c.affordable ? " primary" : ""}" data-act="learn" data-id="${c.id}" ${c.affordable ? "" : "disabled"}>Learn · ${c.cost}</button>`))
        .join("")}</div>`;
    if (v.learned.length > 0) html += `<div class="bp-title">Learned</div><div class="bp-grid">${v.learned.map((c) => card(c, "painted")).join("")}</div>`;
    if (v.later.length > 0) html += `<div class="bp-title">Later</div><div class="bp-grid">${v.later.map((c) => card(c, "faint")).join("")}</div>`;
    this.body.innerHTML = html;
  }
}
