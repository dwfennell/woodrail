import { dateOf } from "../game/calendar";
import type { Game } from "../game/game";
import type { Interaction } from "../game/interaction";
import type { Progress } from "../game/progress";
import { findSecret, foundText, haltName, hiddenCard, nextTier, secretsReached, TOURIST_COUNT, TOURIST_TIERS } from "../game/secrets";
import { EXPLORING } from "../game/stickers";
import type { SecretSite } from "../landscape";
import type { Hud } from "./hud";
import { SecretCard, type SecretCardView } from "./secret-card";

/** What the secrets need from the game around them (main.ts). */
export interface SecretsContext {
  game: Game;
  hud: Hud;
  interaction: Interaction;
  progress: () => Progress;
  /** A secret was found: saved, and heard (a chime). */
  found: (site: SecretSite) => void;
}

export interface SecretControls {
  /** The track changed: any hidden site it now reaches is found (its halt laid). Returns those found. */
  trackChanged(): SecretSite[];
  /** Once a second: midsummer at the stones comes or goes; an open card's numbers follow. */
  tick(): void;
  /** Open a secret's card (by its id). */
  open(id: number): void;
  /** The secret whose card is open (−1: none). */
  readonly openId: number;
}

/** June, by the railway's calendar: the standing stones' midsummer. */
const MIDSUMMER = 5;

/**
 * Game mode's secrets (src/game/secrets.ts) wired to the game: found as the track reaches them (a toast, their halt laid,
 * drawn restored), their cards (a tap on one in the mist, or on a found one's site or halt), and midsummer.
 */
export function attachSecrets(ctx: SecretsContext): SecretControls {
  const { game, hud, interaction } = ctx;
  const card = new SecretCard({ close: () => hud.hideCards() });
  hud.addCard(card.el);

  const site = (id: number) => game.landscape.secrets?.[id];

  function viewOf(s: SecretSite): SecretCardView {
    if (!s.found) return { id: s.id, found: false, ...hiddenCard(s) };
    const p = ctx.progress();
    const all = p.counts.get(TOURIST_COUNT) ?? 0;
    const reached = TOURIST_TIERS.filter((t) => all >= t).length;
    const next = nextTier(all);
    const year = dateOf(game.simSeconds).year;
    const towns = Object.entries(s.from ?? {})
      .map(([id, trips]) => ({ name: game.landscape.towns.find((t) => t.id === Number(id))?.name ?? "A town", trips }))
      .sort((a, b) => b.trips - a.trips);
    return {
      id: s.id,
      found: true,
      title: haltName(s),
      trips: s.trips ?? 0,
      thisYear: s.year && s.year[0] === year ? s.year[1] : 0,
      fares: s.fares ?? 0,
      tier: reached > 0 ? EXPLORING[reached - 1].title : "",
      all,
      next: next === null ? null : { at: next, name: EXPLORING[TOURIST_TIERS.indexOf(next as (typeof TOURIST_TIERS)[number])].title },
      towns,
      note: s.kind === "stones" && game.midsummer ? "🔥 Midsummer: garlands on the stones, a bonfire lit" : "",
    };
  }

  function open(id: number): void {
    const s = site(id);
    if (!s) return;
    hud.hideCards();
    interaction.clearSelection();
    card.show(viewOf(s));
  }
  interaction.onSecretTap = open;

  return {
    trackChanged() {
      const found = secretsReached(game.world);
      for (const s of found) {
        findSecret(game.world, s);
        hud.toast(foundText(s), true, 5200, () => open(s.id));
        ctx.found(s);
      }
      if (found.length > 0) game.syncSecrets();
      return found;
    },
    tick() {
      const midsummer = dateOf(game.simSeconds).month === MIDSUMMER;
      if (midsummer !== game.midsummer) {
        game.midsummer = midsummer;
        game.syncSecrets();
      }
      const id = card.openId;
      const s = id === -1 ? undefined : site(id);
      if (s) card.show(viewOf(s));
    },
    open,
    get openId() {
      return card.openId;
    },
  };
}
