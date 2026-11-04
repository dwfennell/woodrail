import { buildFeedback, feedbackBody, feedbackCopyText, jpegShot, sendFeedback, type FeedbackKind, type FeedbackPayload, type Sent } from "../feedback/feedback";
import type { GameMode } from "../game/modes";

export interface FeedbackSheetHandlers {
  /** Save, then the mode's map as "Copy map for a bug report" copies it, and the mode. */
  map(): Promise<{ map: string; mode: GameMode }>;
  /** A picture of the game as it is now (one frame drawn for it). */
  capture(): Promise<Blob | null>;
  /** The build, and the problems the game noticed lately (dev invariant breaks, errors). */
  info(): { build: string; badges: string[] };
  toast(message: string): void;
  /** Send the body (a seam for tests; the game's is `sendFeedback` to the Worker). */
  send?(body: string): Promise<Sent>;
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

/** A checkbox with its label, the whole row a 44 px target. */
function check(label: string, cls: string): { row: HTMLLabelElement; box: HTMLInputElement; text: HTMLSpanElement } {
  const row = el("label", `feedback-check ${cls}`);
  const box = el("input", "");
  box.type = "checkbox";
  const text = el("span", "", label);
  row.append(box, text);
  return { row, box, text };
}

const PLACEHOLDER: Record<FeedbackKind, string> = {
  bug: "What happened? What were you doing just before?",
  idea: "What would make Woodrail better?",
};
const MAP_NOTE: Record<FeedbackKind, string> = {
  bug: "A bug always sends your map, so we can play it and see what went wrong.",
  idea: "Your map helps us see what you mean.",
};

/**
 * "Report a bug or give feedback" (the ☰ menu): Bug or Idea, a note, a picture of the game (on by default: one frame,
 * taken as the sheet opens), the map (always with a bug), and Send. Sent, it says so; failed, it says why and offers
 * Copy instead (the note and the map, to paste to us).
 */
export class FeedbackSheet {
  readonly root = el("div", "card report-card feedback-sheet");
  private kind: FeedbackKind = "bug";
  private readonly note = el("textarea", "report-note feedback-note");
  private readonly bugChip: HTMLButtonElement;
  private readonly ideaChip: HTMLButtonElement;
  private readonly shotCheck = check("Include a picture of the game", "feedback-shot");
  private readonly mapCheck = check("Include my map", "feedback-map");
  private readonly mapNote = el("div", "feedback-small");
  private readonly thumb = el("img", "feedback-thumb");
  private readonly status = el("div", "report-status feedback-status");
  private readonly sendBtn: HTMLButtonElement;
  private readonly copyBtn: HTMLButtonElement;
  private readonly form = el("div", "feedback-form");
  private readonly done = el("div", "feedback-done");
  /** The picture for this opening (taken once, as it opens), as base64 JPEG; and its preview's URL. */
  private shot: Promise<string | null> | null = null;
  private thumbUrl = "";
  /** The report last tried, for Copy instead. */
  private last: FeedbackPayload | null = null;
  private sending = false;
  /** Which opening this is (a picture still coming from an earlier one is dropped). */
  private opening = 0;

  constructor(
    parent: HTMLElement,
    private readonly url: string,
    private readonly h: FeedbackSheetHandlers,
  ) {
    const r = this.root;
    r.hidden = true;
    r.setAttribute("role", "dialog");
    r.setAttribute("aria-label", "Report a bug or give feedback");
    r.addEventListener("pointerdown", (e) => e.stopPropagation());
    r.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.hide();
      e.stopPropagation();
    });
    const kinds = el("div", "card-row feedback-kinds");
    kinds.setAttribute("role", "radiogroup");
    this.bugChip = chip("🐞 Bug", "feedback-kind", () => this.setKind("bug"));
    this.ideaChip = chip("💡 Idea", "feedback-kind", () => this.setKind("idea"));
    for (const c of [this.bugChip, this.ideaChip]) c.setAttribute("role", "radio");
    kinds.append(this.bugChip, this.ideaChip);
    this.note.rows = 3;
    this.note.maxLength = 4000;
    this.note.setAttribute("aria-label", "Your note");
    this.note.addEventListener("input", () => this.drawSend());
    this.shotCheck.box.checked = true;
    this.shotCheck.box.addEventListener("change", () => {
      if (this.shotCheck.box.checked && !this.shot) this.takeShot();
      this.thumb.hidden = !this.shotCheck.box.checked || !this.thumbUrl;
    });
    this.thumb.alt = "";
    this.thumb.hidden = true;
    this.shotCheck.row.append(this.thumb);
    this.mapCheck.box.checked = true;
    this.mapCheck.box.addEventListener("change", () => this.drawKind());
    const privacy = el("div", "feedback-small feedback-privacy", "Sends only your note, map, picture, game version, browser and screen size, to the people who make Woodrail.");
    this.status.setAttribute("aria-live", "polite");
    this.sendBtn = chip("Send", "primary feedback-send", () => void this.send());
    this.copyBtn = chip("Copy instead", "feedback-copy", () => void this.copyInstead());
    this.copyBtn.hidden = true;
    const row = el("div", "card-row");
    row.append(chip("Cancel", "feedback-cancel", () => this.hide()), this.copyBtn, this.sendBtn);
    this.form.append(kinds, this.note, this.shotCheck.row, this.mapCheck.row, this.mapNote, privacy, this.status, row);
    this.done.hidden = true;
    r.append(el("div", "card-title", "Report a bug or give feedback"), this.form, this.done);
    parent.appendChild(r);
    this.setKind("bug");
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    this.opening++;
    this.form.hidden = false;
    this.done.hidden = true;
    this.copyBtn.hidden = true;
    this.status.textContent = "";
    this.status.classList.remove("error");
    this.last = null;
    this.shot = null;
    this.clearThumb();
    if (this.shotCheck.box.checked) this.takeShot();
    this.root.hidden = false;
    this.drawSend();
    this.note.focus({ preventScroll: true });
  }

  hide(): void {
    this.root.hidden = true;
    this.shot = null;
    this.clearThumb();
  }

  private clearThumb(): void {
    if (this.thumbUrl) URL.revokeObjectURL(this.thumbUrl);
    this.thumbUrl = "";
    this.thumb.removeAttribute("src");
    this.thumb.hidden = true;
  }

  /** The picture, taken once for this opening: a frame of the game (the sheet isn't in it), as a JPEG. */
  private takeShot(): void {
    const opening = this.opening;
    this.shot = this.h.capture().then(async (frame) => {
      if (!frame) return null;
      if (opening === this.opening && !this.root.hidden) {
        this.thumbUrl = URL.createObjectURL(frame);
        this.thumb.src = this.thumbUrl;
        this.thumb.hidden = !this.shotCheck.box.checked;
      }
      return jpegShot(frame);
    });
  }

  private setKind(kind: FeedbackKind): void {
    this.kind = kind;
    this.drawKind();
  }

  private drawKind(): void {
    const bug = this.kind === "bug";
    this.bugChip.classList.toggle("active", bug);
    this.ideaChip.classList.toggle("active", !bug);
    this.bugChip.setAttribute("aria-checked", String(bug));
    this.ideaChip.setAttribute("aria-checked", String(!bug));
    this.note.placeholder = PLACEHOLDER[this.kind];
    // A bug always has its map: the box shows it, ticked, and can't be changed.
    if (bug) this.mapCheck.box.checked = true;
    this.mapCheck.box.disabled = bug;
    this.mapCheck.row.classList.toggle("locked", bug);
    this.mapNote.textContent = MAP_NOTE[this.kind];
  }

  private drawSend(): void {
    this.sendBtn.disabled = this.sending || this.note.value.trim() === "";
  }

  private async send(): Promise<void> {
    if (this.sending || this.note.value.trim() === "") return;
    this.sending = true;
    this.drawSend();
    this.copyBtn.hidden = true;
    this.status.classList.remove("error");
    this.status.textContent = "Sending…";
    try {
      const { map, mode } = await this.h.map();
      const shot = this.shotCheck.box.checked && this.shot ? await this.shot : null;
      const { build, badges } = this.h.info();
      const payload = buildFeedback({
        kind: this.kind,
        text: this.note.value,
        map,
        includeMap: this.mapCheck.box.checked,
        shot,
        mode,
        build,
        userAgent: navigator.userAgent,
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        badges,
      });
      this.last = payload;
      const fit = feedbackBody(payload);
      if (!fit) throw new Error("This report is too big to send.");
      const sent = await (this.h.send ? this.h.send(fit.body) : sendFeedback(this.url, fit.body));
      this.showSent(sent, fit.droppedShot);
    } catch (e) {
      this.status.classList.add("error");
      this.status.textContent = `Couldn't send it. ${(e as Error).message ?? ""}`.trim();
      this.copyBtn.hidden = this.last === null;
    } finally {
      this.sending = false;
      this.drawSend();
    }
  }

  private showSent(sent: Sent, droppedShot: boolean): void {
    this.note.value = "";
    this.form.hidden = true;
    const lines = [el("p", "feedback-thanks", "✓ Sent. Thank you!")];
    lines.push(el("p", "feedback-small", sent.issue ? "It's on our list now." : "We'll read it soon."));
    if (droppedShot) lines.push(el("p", "feedback-small", "(The picture was left out: the report was too big with it.)"));
    const row = el("div", "card-row");
    row.append(chip("Close", "primary feedback-close", () => this.hide()));
    this.done.replaceChildren(...lines, row);
    this.done.dataset.id = sent.id;
    this.done.hidden = false;
    this.h.toast("Report sent. Thank you!");
  }

  /** The note and map on the clipboard, to paste to us by hand. */
  private async copyInstead(): Promise<void> {
    if (!this.last) return;
    const text = feedbackCopyText(this.last);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // (No clipboard API, or not allowed: the old way, through a selected field.)
      const field = el("textarea", "cloud-copy-field");
      field.value = text;
      this.root.append(field);
      field.select();
      const ok = document.execCommand("copy");
      field.remove();
      if (!ok) {
        this.status.textContent = "Couldn't copy here either. Sorry!";
        return;
      }
    }
    this.status.classList.remove("error");
    this.status.textContent = "Copied. Paste it to us on GitHub or itch.io.";
    this.h.toast("Copied your report and map");
  }
}
