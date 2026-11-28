import type { GameMode } from "../game/modes";
import { statusText, type CloudSync, type UseCodeResult } from "../persist/cloud";
import { showCode } from "../persist/sync-code";

/** How long Turn off waits for its second tap (ms). */
const ASK_MS = 4000;

/**
 * The way to a railway saved under a code (another device's, or this one's before its browser forgot it), the same
 * words on the card and the title (playthrough: "I have a code" / "Use a different code" didn't read as loading a save;
 * review 2026-11-26: five names for one thing).
 */
export const LOAD_LABEL = "Load with a code";

const ERRORS: Record<Extract<UseCodeResult, { ok: false }>["error"], string> = {
  malformed: "That's not a code: it's three words and four numbers, like acorn badge otter 0420",
  nothing: "No railway is saved with that code yet",
  offline: "Can't reach the cloud right now. Try again soon.",
  newer: "That railway was saved by a newer Woodrail: reload the page to update, then try again",
  tries: "Too many tries from here: wait a minute, then try again",
};

export interface CloudCardHandlers {
  /** The mode being played (its backup is the one offered to restore). */
  mode(): GameMode;
  /** Storage now holds other railways: reload into them (without saving the one showing over them). */
  reload(): void;
  toast(message: string): void;
  /**
   * Where the game is played: on itch.io (`itch`: its frame's storage is shared with every itch game, so the code
   * typed in can be read by them), and whether this browser may forget the page's saves, the code with them
   * (`mayForget`: storage-life.ts). Unset: neither.
   */
  where?: { itch: boolean; mayForget: boolean };
}

/** Why to keep the code, said under it: the plainer the more it matters. */
export function keepCodeText(where: CloudCardHandlers["where"]): string {
  if (where?.mayForget) return "Write this code down! On iPhone and iPad, itch.io forgets your railway when you leave. Load with this code to get it back.";
  if (where?.itch) return "Keep this code somewhere safe: if this browser forgets your railway, Load with a code brings it back.";
  return "Keep this code somewhere safe: it's the way back to your railway on any device.";
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
  private askingEarlier = false;
  private askTimer = 0;
  /** The cloud's earlier copy of the mode being played (asked when the card opens: `CloudSync.earlier`), or null. */
  private earlier: { savedAt: number } | null = null;
  /** Opened straight to the code (from the title screen): Cancel closes the card and calls this. */
  private cancelTo: (() => void) | null = null;

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
      if (this.root.hidden || this.busy) return;
      // Only the status line, when that's all that changed: drawn afresh, the card's buttons would be swapped under a
      // finger mid-tap (QA: a Turn off's second tap lost).
      const line = this.root.querySelector(".cloud-status");
      if (line && !this.entering && this.cloud.code !== null) line.textContent = statusText(s, Date.now());
      else this.draw();
    };
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    this.cancelTo = null;
    this.entering = false;
    this.error = "";
    this.root.hidden = false;
    this.earlier = null;
    this.draw();
    // (Asked once as it opens: put in its own place when the answer comes, nothing else moved under a finger.)
    const mode = this.h.mode();
    if (this.cloud.code)
      void this.cloud.earlier(mode).then((e) => {
        this.earlier = e;
        const slot = this.root.querySelector<HTMLElement>(".cloud-earlier");
        if (slot && !this.root.hidden) this.fillEarlier(slot);
      });
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
    // (The code words' credit, the EFF's word list, is in ☰ Credits.)
  }

  /** The load chip, first on the card, on a row of its own. */
  private loadRow(): HTMLElement {
    const row = el("div", "card-row cloud-load-row");
    row.append(chip(LOAD_LABEL, "cloud-load", () => this.enter()));
    return row;
  }

  private drawOff(): void {
    const row = el("div", "card-row");
    row.append(
      chip(this.busy ? "Turning on…" : "Turn on", "primary", async () => {
        if (this.busy) return;
        this.busy = true;
        this.draw();
        try {
          await this.cloud.enable();
        } finally {
          this.busy = false;
        }
        this.draw();
      }),
      this.done(),
    );
    this.root.append(el("p", "cloud-text", this.cloud.turnedOff ? "Off: your railway is saved on this device only. Turn on to keep it safe online (with a new code), and carry on on another device." : "Keep your railway safe online, and carry on playing on another device."), this.loadRow(), row);
  }

  /** The other railway a sync kept on this device (see `CloudSync.backupOf`; dated by its last edit), offered back. */
  private restoreChip(): void {
    const mode = this.h.mode();
    const kept = this.cloud.backupOf(mode);
    if (kept === null) return;
    this.root.append(
      el("div", "cloud-label", "Kept on this device"),
      chip(`Bring back the other railway (${when(kept)})`, "cloud-restore", async () => {
        if (this.busy) return;
        this.busy = true;
        try {
          if (await this.cloud.restore(mode)) {
            this.h.reload();
            return;
          }
          this.h.toast("Couldn't bring it back: there's no room on this device");
        } finally {
          this.busy = false;
        }
      }),
      el("p", "cloud-small", "The one you're playing now is kept in its place, to swap back."),
    );
  }

  /** The cloud's earlier copy (the railway as it was before you last played), offered back with a second tap. */
  private fillEarlier(slot: HTMLElement): void {
    slot.replaceChildren();
    const e = this.earlier;
    slot.hidden = e === null;
    if (e === null) return;
    const go = chip(this.askingEarlier ? "Go back to it? Tap again" : `Go back to the copy of ${when(e.savedAt)}`, this.askingEarlier ? "asking cloud-earlier-go" : "cloud-earlier-go", async () => {
      if (this.busy) return;
      if (!this.askingEarlier) {
        this.stopAsking();
        this.askingEarlier = true;
        this.askTimer = window.setTimeout(() => {
          this.stopAsking();
          if (this.open) this.fillEarlier(slot);
        }, ASK_MS);
        this.fillEarlier(slot);
        return;
      }
      this.stopAsking();
      this.busy = true;
      try {
        if (await this.cloud.restoreEarlier(this.h.mode())) {
          this.h.reload();
          return;
        }
        this.h.toast("Couldn't go back to it: can't reach the cloud, or there's no room. Try again soon.");
      } finally {
        this.busy = false;
      }
      this.fillEarlier(slot);
    });
    slot.append(el("div", "cloud-label", "Earlier copy online"), go, el("p", "cloud-small", "Your railway as it was before you last played. The one now is kept online in its place, to swap back."));
  }

  private drawOn(code: string): void {
    const codeRow = el("div", "cloud-code-row");
    codeRow.append(el("span", "cloud-code", showCode(code)), chip("Copy", "", () => void this.copy(showCode(code))));
    // (A phone's share sheet: to Notes, or a message to themselves. Not where sharing isn't allowed: an itch frame may not.)
    if (typeof navigator.share === "function") {
      codeRow.classList.add("shares");
      codeRow.append(chip("Share", "cloud-share", () => void this.share(showCode(code))));
    }
    // The code first: it's what most come to the card for (review 2026-11-26).
    const keep = el("p", `cloud-text cloud-keep${this.h.where?.mayForget ? " urgent" : ""}`, keepCodeText(this.h.where));
    this.root.append(
      el("div", "cloud-label", "Your code"),
      codeRow,
      keep,
      el("div", "cloud-status", statusText(this.cloud.status, Date.now())),
      el("p", "cloud-small", "Your railway saves online by itself as you play. Type the code on another device to carry on there. Share it only with people you'd let play your railway."),
    );
    this.restoreChip();
    const earlier = el("div", "cloud-earlier");
    this.root.append(earlier);
    this.fillEarlier(earlier);
    this.root.append(this.loadRow());
    const kept = this.cloud.backupOf(this.h.mode()) !== null || this.cloud.backupOf(this.h.mode() === "game" ? "sandbox" : "game") !== null;
    const off = chip(this.askingOff ? (kept ? "Tap again: this device forgets your code and the kept railway" : "Tap again: this device forgets your code") : "Turn off", this.askingOff ? "asking" : "", () => {
      if (!this.askingOff) {
        this.stopAsking();
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
    row.append(off, this.done());
    this.root.append(row);
  }

  private drawEntry(): void {
    const input = el("input", "cloud-input");
    input.type = "text";
    input.autocomplete = "off";
    input.autocapitalize = "none";
    input.spellcheck = false;
    input.placeholder = "acorn badge otter 0420";
    input.setAttribute("aria-label", "Your code");
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
    this.root.append(
      el("p", "cloud-text", "Type your code: three words and four numbers"),
      input,
      err,
      el("p", "cloud-small", "Loads the railway saved with that code. The one on this device is kept, and you can bring it back from this card."),
    );
    // On itch.io every game's page shares this browser's storage: the code typed here, they could read (2026-11-26).
    if (this.h.where?.itch) this.root.append(el("p", "cloud-small cloud-shared", "On itch.io, other games can read what this page keeps in your browser, your code too. Use a code just for here."));
    this.root.append(row);
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

  /** Copy the code: the clipboard, else the old way (a selected field), else it's left selected to copy by hand. */
  private async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.h.toast("Code copied");
      return;
    } catch {
      // (No clipboard here: an http page, or not allowed.)
    }
    const field = el("textarea", "cloud-copy-field");
    field.value = text;
    field.readOnly = true;
    this.root.append(field);
    field.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    field.remove();
    if (copied) {
      this.h.toast("Code copied");
      return;
    }
    // Selected on the card, to copy (or write down).
    const shown = this.root.querySelector(".cloud-code");
    if (shown) getSelection()?.selectAllChildren(shown);
    this.h.toast("Couldn't copy. It's selected: copy it, or write it down.");
  }

  /** The phone's share sheet with the code; turned away (no permission in a frame, say), copied instead. */
  private async share(code: string): Promise<void> {
    try {
      await navigator.share({ text: `My Woodrail code: ${code}` });
    } catch (e) {
      // (Closed by the player: nothing more to do.)
      if (e instanceof DOMException && e.name === "AbortError") return;
      await this.copy(code);
    }
  }

  /** Open straight to the code entry (the title screen's "Load with a code"): Cancel closes it and calls `onCancel`. */
  showEntry(onCancel: () => void): void {
    this.show();
    this.cancelTo = onCancel;
    this.enter();
  }

  private enter(): void {
    this.entering = true;
    this.error = "";
    this.draw();
  }

  private back(): void {
    const to = this.cancelTo;
    if (to) {
      this.hide();
      to();
      return;
    }
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
    this.askingEarlier = false;
  }
}

/** A copy's date and time, short: "26 Nov, 14:05". */
const when = (at: number): string => new Date(at).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
