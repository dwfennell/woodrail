import { Economy } from "../economy";
import { trainState } from "../game/engine-status";
// Temporary probe: time trains spend served at depots, by role, and visits.
export const dw = { t: new Map<string, number>(), v: new Map<string, number>(), moving: 0, standing: 0, why: new Map<string, number>() };
const last = new Map<number, string>();
const orig = Economy.prototype.tick;
Economy.prototype.tick = function (this: Economy) {
  orig.call(this);
  for (const t of this.sim.trains()) {
    const d = this.servingDepot(t.id);
    const k = d ? d.role : "";
    if (t.speed > 0) dw.moving++;
    else {
      dw.standing++;
      if (!d) {
        const eng = t.cars.find((c) => c.kind === "engine");
        let k2 = "?";
        try { const st = trainState(this.sim, this, t, eng?.lever ?? 0); k2 = st.kind + ("cause" in st ? ":" + String((st as { cause?: string }).cause) : ""); } catch { k2 = "err"; }
        dw.why.set(k2, (dw.why.get(k2) ?? 0) + 1);
      }
    }
    if (k) {
      dw.t.set(k, (dw.t.get(k) ?? 0) + 1);
      if (last.get(t.id) !== k) dw.v.set(k, (dw.v.get(k) ?? 0) + 1);
    }
    last.set(t.id, k);
  }
};
export const dwReport = () => `WHY ${[...dw.why].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / 120 / 60).toFixed(1)}m`).join(" ")}\nDWELL moving ${(dw.moving / 120 / 60).toFixed(0)} train-min standing ${(dw.standing / 120 / 60).toFixed(0)} train-min | ${[...dw.t].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / 120 / (dw.v.get(k) ?? 1)).toFixed(1)}s×${dw.v.get(k)}`).join(" ")}`;
