// Table geometry, kept free of Phaser so it can be tested in node and read
// by PhaserGame before the game exists.

// ── Table layouts ─────────────────────────────────────────────────────────────
// The scene is drawn in its own coordinates and FIT-scaled into the screen.
// A wide screen gets the classic table: opponents left and right, own hand in
// one fanned row. A tall (portrait) screen gets a tall table — opponents at the
// top, own hand in two rows of big cards — so a phone held upright isn't
// limited to a sliver of the width. The scene switches when the screen turns.
//   VIEW_TOP  the camera skips this empty band above the felt (the top bar
//             overlays it), so the table fills more of the screen.
export function layoutFor(portrait) {
  if (!portrait) {
    const W = 1100, H = 700, TABLE_CX = W / 2, TABLE_CY = H / 2 - 20;
    return {
      portrait: false, W, H, VIEW_TOP: 55, TABLE_CX, TABLE_CY,
      felt: { left: 55, right: W - 55, top: H * 0.23, bottom: H * 0.845, cut: 92 },
      // relative seat: 0 = self (bottom, under the cards — its name and score
      // sit to the right of the photo, so it can sit low), 1 = left, 2 = right
      AVATAR_POS: [
        { x: TABLE_CX, y: H - 60 },
        { x: 100, y: H / 2 - 40 },
        { x: W - 100, y: H / 2 - 40 },
      ],
      OPP_FAN_POS: [
        null,
        { baseX: 230, y: H / 2 - 40, dir: 1 },
        { baseX: W - 230, y: H / 2 - 40, dir: -1 },
      ],
      // Centre trick drop zones (3 cards in a slight overlap stack)
      TRICK_POS: [
        { x: TABLE_CX, y: TABLE_CY + 50, angle: -4 },
        { x: TABLE_CX - 60, y: TABLE_CY, angle: -10 },
        { x: TABLE_CX + 60, y: TABLE_CY, angle: 10 },
      ],
    };
  }
  const W = 720, H = 1240, TABLE_CX = W / 2, TABLE_CY = 545;
  return {
    portrait: true, W, H, VIEW_TOP: 0, TABLE_CX, TABLE_CY,
    felt: { left: 26, right: W - 26, top: 280, bottom: 810, cut: 70 },
    // Opponents sit above the table (clear of the top bar and the
    // "waiting for…" pill); own avatar at the very bottom under the hand.
    AVATAR_POS: [
      { x: TABLE_CX, y: H - 70 },
      { x: 135, y: 170 },
      { x: W - 135, y: 170 },
    ],
    OPP_FAN_POS: [
      null,
      { baseX: 190, y: 372, dir: 1 },
      { baseX: W - 190, y: 372, dir: -1 },
    ],
    TRICK_POS: [
      { x: TABLE_CX, y: TABLE_CY + 70, angle: -4 },
      { x: TABLE_CX - 72, y: TABLE_CY - 5, angle: -10 },
      { x: TABLE_CX + 72, y: TABLE_CY - 5, angle: 10 },
    ],
  };
}

/** A box taller than wide gets the tall table. */
export const isPortraitBox = (w, h) => h > w * 1.1;

/** The scene size for a layout (what the Phaser game is created with). */
export const sceneSize = (L) => ({ width: L.W, height: L.H - L.VIEW_TOP });

// The player's own cards are this big in scene units before scaling.
export const CARD_W = 80;
export const CARD_H = 114;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * How much to enlarge the own hand. On a phone the whole scene is scaled
 * down, so the hand is drawn larger to keep cards readable: in one row aim
 * for ~50 px wide on screen (at most 1.3×); the tall table's two rows have
 * room for ~62 px (at most 1.5×). `shown` is on-screen px per scene unit.
 */
export function handScale(L, shown) {
  return L.portrait
    ? clamp(62 / (CARD_W * shown), 1, 1.5)
    : clamp(50 / (CARD_W * shown), 1, 1.3);
}

/**
 * Where each of `total` hand cards sits: [{ x, y, angle }]. `narrow` is a
 * narrow browser window (wide table only), where cards get more room so
 * neighbours don't overlap into a single tap target.
 */
export function handSlots(L, total, k, narrow) {
  const { W, H, portrait, felt } = L;
  const slots = [];
  if (portrait) {
    // Two rows under the table: the first half on top, the rest below.
    const cw = CARD_W * k;
    const ch = CARD_H * k;
    const rows = total > 5 ? [Math.ceil(total / 2), Math.floor(total / 2)] : [total];
    rows.forEach((count, r) => {
      const spacing = count > 1 ? Math.min(cw + 10, (W - 40 - cw) / (count - 1)) : 0;
      const startX = W / 2 - ((count - 1) * spacing) / 2;
      const rowY = felt.bottom + 20 + r * ch * 0.78;
      const mid = (count - 1) / 2;
      for (let j = 0; j < count; j++) {
        slots.push({ x: startX + j * spacing, y: rowY + Math.abs(j - mid) * 2, angle: (j - mid) * 1.2 });
      }
    });
    return slots;
  }
  const maxSpacing = narrow ? 78 : 64;
  const minSpacing = narrow ? 46 : 36;
  const spacing = Math.max(
    minSpacing,
    Math.min(maxSpacing, (W - 200) / Math.max(1, total)),
  );
  const startX = W / 2 - ((total - 1) * spacing) / 2;
  // Lifted so the fan clears the own avatar + sound button underneath
  // (bigger cards are lifted by their extra half-height).
  const baseY = H - 167 - ((k - 1) * CARD_H) / 2;
  const midIdx = (total - 1) / 2;
  for (let i = 0; i < total; i++) {
    // slight curve: ends drop a bit
    slots.push({ x: startX + i * spacing, y: baseY + Math.abs(i - midIdx) * 1.2, angle: (i - midIdx) * 1.6 });
  }
  return slots;
}

/** A seat's place around this table: 0 = the viewer's seat, 1 = left, 2 = right. */
export const relSeat = (seat, mySeat) => (seat - (mySeat ?? 0) + 3) % 3;
