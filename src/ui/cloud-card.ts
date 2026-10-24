import type { GameMode } from "../game/modes";
import { statusText, type CloudSync, type UseCodeResult } from "../persist/cloud";
import { showCode } from "../persist/sync-code";

/** How long Turn off waits for its second tap (ms). */
const ASK_MS = 4000;

const ERRORS: Record<Extract<UseCodeResult, { ok: false }>["error"], string> = {
  malformed: "That doesn't look like a code: three words and four numbers",
  nothing: "No railway is saved with that code yet",
  offline: "Can't reach the cloud right now. Try again soon.",
  newer: "That railway was saved by a newer version of the game: update this one first",
};

export interface CloudCardHandlers {
  /** The mode being played (its backup is the one offered to restore). */
  mode(): GameMode;
  /** Storage now holds other railways: reload into them (without saving the one showing over them). */
  reload(): void;
  toast(message: string): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function chip(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", `chip text ${cls}`.trim(), label);
  b.type = "button";
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

/**
 * The menu's Cloud save card: turn it on (and see the code to type on another device), type in a code from another
 * device, restore the railway a sync kept aside, or turn it off. Drawn afresh each time something on it changes (it's
 * small, and only open now and then).
 */
export class CloudCard {
  readonly root = el("div", "card cloud-card");
  private entering = false;
  private error = "";
  private busy = false;
  private askingOff = false;
  private askTimer = 0;

  constructor(
    parent: HTMLElement,
    private readonly cloud: CloudSync,
    private readonly h: CloudCardHandlers,
  ) {
    this.root.hidden = true;
    this.root.addEventListener("pointerdown", (e) => e.stopPropagation());
    parent.appendChild(this.root);
    const was = cloud.onStatus;
    cloud.onStatus = (s) => {
      was(s);
      if (!this.root.hidden && !this.busy) this.draw();
    };
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    this.entering = false;
    this.error = "";
    this.root.hidden = false;
    this.draw();
  }

  hide(): void {
    this.root.hidden = true;
    this.stopAsking();
  }

  private draw(): void {
    const r = this.root;
    r.replaceChildren(el("div", "card-title", "☁ Cloud save"));
    if (this.entering) this.drawEntry();
    else if (this.cloud.code) this.drawOn(this.cloud.code);
    else this.drawOff();
    r.append(el("p", "cloud-credit", "Code words from the EFF's word list (CC BY 3.0)."));
  }

  private drawOff(): void {
    const row = el("div", "card-row");
    row.append(
      chip("I have a code", "", () => this.enter()),
      chip("Turn on", "primary", async () => {
        this.busy = true;
        try {
          await this.cloud.enable();
        } finally {
          this.busy = false;
        }
        this.draw();
      }),
      this.done(),
    );
    this.root.append(el("p", "cloud-text", "Keep your railway safe online, and carry on playing on another device."), row);
  }

  private drawOn(code: string): void {
    const codeRow = el("div", "cloud-code-row");
    codeRow.append(
      el("span", "cloud-code", showCode(code)),
      chip("Copy", "", () => {
        void navigator.clipboard?.writeText(showCode(code)).then(
          () => this.h.toast("Code copied"),
          () => this.h.toast("Couldn't copy it: write it down instead"),
        );
      }),
    );
    this.root.append(
      el("div", "cloud-status", statusText(this.cloud.status, Date.now())),
      el("div", "cloud-label", "Your code"),
      codeRow,
      el("p", "cloud-text", "Type this code on your other device to carry on there. Only share it with people you'd let play your railway."),
    );
    const mode = this.h.mode();
    const backup = this.cloud.backupOf(mode);
    if (backup !== null) {
      const when = new Date(backup).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
      this.root.append(
        chip(`Restore the railway from ${when}`, "cloud-restore", async () => {
          if (await this.cloud.restore(mode)) this.h.reload();
          else this.h.toast("Couldn't restore it: there's no room on this device");
        }),
      );
    }
    const off = chip(this.askingOff ? "Forget the code here? Tap again" : "Turn off", this.askingOff ? "asking" : "", () => {
      if (!this.askingOff) {
        this.askingOff = true;
        this.askTimer = window.setTimeout(() => {
          this.stopAsking();
          if (this.open) this.draw();
        }, ASK_MS);
        this.draw();
        return;
      }
      this.stopAsking();
      this.cloud.disable();
      this.draw();
    });
    const row = el("div", "card-row");
    row.append(chip("Use a different code", "", () => this.enter()), off, this.done());
    this.root.append(row);
  }

  private drawEntry(): void {
    const input = el("input", "cloud-input");
    input.type = "text";
    input.autocomplete = "off";
    input.autocapitalize = "none";
    input.spellcheck = false;
    input.placeholder = "acorn badge otter 0420";
    input.setAttribute("aria-label", "Sync code");
    const err = el("div", "cloud-error", this.error);
    err.hidden = !this.error;
    const load = chip(this.busy ? "Loading…" : "Load", "primary", () => void this.load(input.value));
    load.disabled = this.busy;
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") void this.load(input.value);
      if (e.key === "Escape") this.back();
    });
    const row = el("div", "card-row");
    row.append(chip("Cancel", "", () => this.back()), load);
    this.root.append(el("p", "cloud-text", "Type the code from your other device"), input, err, row);
    if (!this.busy) requestAnimationFrame(() => input.focus());
  }

  private async load(typed: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    this.draw();
    let res: UseCodeResult;
    try {
      res = await this.cloud.useCode(typed);
    } finally {
      this.busy = false;
    }
    if (res.ok) {
      // (Its railways are in storage now: the game starts again on them.)
      this.h.reload();
      return;
    }
    this.error = ERRORS[res.error];
    this.draw();
    const input = this.root.querySelector<HTMLInputElement>(".cloud-input");
    if (input) input.value = typed;
  }

  private enter(): void {
    this.entering = true;
    this.error = "";
    this.draw();
  }

  private back(): void {
    this.entering = false;
    this.error = "";
    this.draw();
  }

  private done(): HTMLButtonElement {
    return chip("Done", "", () => this.hide());
  }

  private stopAsking(): void {
    window.clearTimeout(this.askTimer);
    this.askingOff = false;
  }
}
