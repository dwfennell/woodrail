/**
 * Tooltips for everything in the HUD that has a `title`: a small label that shows quickly beside the control on mouse
 * hover, and on a long press with a finger (touch screens have no hover). One handler for the whole HUD, so any new
 * button with a `title` gets one too. The native tooltip is suppressed (its text moves to `data-tip`).
 */
export function installTooltips(root: HTMLElement): void {
  const tip = document.createElement("div");
  tip.className = "tooltip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  document.body.appendChild(tip);
  let timer = 0;
  let target: HTMLElement | null = null;

  const textOf = (el: HTMLElement): string => {
    const t = el.getAttribute("title");
    if (t) {
      // Keep the words for screen readers, and stop the browser's own slow tooltip.
      el.dataset.tip = t;
      if (!el.getAttribute("aria-label")) el.setAttribute("aria-label", t);
      el.removeAttribute("title");
    }
    return el.dataset.tip ?? "";
  };

  const hide = () => {
    clearTimeout(timer);
    target = null;
    tip.hidden = true;
  };

  const show = (el: HTMLElement) => {
    const text = el.dataset.tip;
    if (!text || !el.isConnected) return;
    tip.textContent = text;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    // Below the control, or above it when that would run off the bottom (the tray's items).
    const below = r.bottom + 8 + h < window.innerHeight;
    const x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    const y = below ? r.bottom + 8 : r.top - h - 8;
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };

  const tippable = (e: Event) => (e.target as HTMLElement | null)?.closest<HTMLElement>("[title], [data-tip]") ?? null;

  root.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse") return;
    const el = tippable(e);
    if (!el || el === target) return;
    hide();
    if (!textOf(el)) return;
    target = el;
    timer = window.setTimeout(() => show(el), 350);
  });
  root.addEventListener("pointerout", (e) => {
    if (target && !target.contains(e.relatedTarget as Node | null)) hide();
  });
  // A finger: a long press shows the label. Not on the tray's pieces: pressing one starts dragging it.
  let downAt = { x: 0, y: 0 };
  root.addEventListener("pointerdown", (e) => {
    hide();
    if (e.pointerType === "mouse") return;
    const el = tippable(e);
    if (!el || el.closest(".tray-item") || !textOf(el)) return;
    target = el;
    downAt = { x: e.clientX, y: e.clientY };
    timer = window.setTimeout(() => show(el), 500);
  });
  window.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" && target && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 10) hide();
  });
  // Lifting the finger leaves a shown label up a moment to read; a click, wheel or key hides it at once.
  window.addEventListener("pointerup", (e) => {
    if (e.pointerType === "mouse") hide();
    else window.setTimeout(hide, 900);
  });
  for (const ev of ["pointercancel", "wheel", "keydown"]) window.addEventListener(ev, hide, { passive: true });
}
