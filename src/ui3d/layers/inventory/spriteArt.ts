import { ink, shade } from "../../theme";

/** The grimoire's little pixel sprites as bitmaps — the artpass DOM
 * chrome's icons (ui/pixelArt.ts: the slot silhouettes, the rarity gem, the
 * run-loot hourglass), plus a coin, a flask and the rule's diamond painted
 * the same way. Each row of characters is one row of pixels; pure, so the
 * painter is tested (grade.test.ts) and sprites.tsx only uploads it. */

/** Palette keys (artpass `palette()`): `a/b/c` are the tint and its light and
 * dark, so one bitmap serves every item colour; the rest are fixed. */
function palette(tint: string): Record<string, string> {
  return {
    o: ink.ink,
    a: tint,
    b: shade(tint, 0.45),
    c: shade(tint, -0.45),
    w: "#6b4426",
    W: "#9c6a3c",
    d: "#3f2614",
    m: ink.brass,
    M: ink.brassLight,
    n: ink.brassDark,
    k: "#140c14",
    s: "#e9dfc8",
    S: "#9d917c",
    g: ink.arcane,
  };
}

const SPRITES = {
  staff: [
    "...........oo...",
    "..........obbo..",
    ".........obbaao.",
    "........mobaaco.",
    "........mMoacco.",
    ".........nmoco..",
    "........oWnmo...",
    ".......oWwo.....",
    "......oWwo......",
    ".....oWwo.......",
    "....oWwo........",
    "...oWwo.........",
    "..oWwo..........",
    ".oWdo...........",
    ".odo............",
    "..o.............",
  ],
  amulet: [
    "....mn....nm....",
    "...n........n...",
    "..m..........m..",
    "..n..........n..",
    "...m........m...",
    "....n......n....",
    ".....m....m.....",
    "......oMMo......",
    ".....omMMmo.....",
    "....omoooomo....",
    "...omobbaaomo...",
    "...omobaaacmo...",
    "...omoaaaccmo...",
    "....omoccomo....",
    ".....ommmmo.....",
    "......oooo......",
  ],
  cloak: [
    "......oooo......",
    ".....obbaao.....",
    "....obakkaco....",
    "....obkkkkco....",
    "...obakkkkaco...",
    "...obaakkaacco..",
    "..obaaaMMaaaco..",
    "..obaaaaaaaacco.",
    "..obaaaaaaaacco.",
    ".obaaaaaaaaaacco",
    ".obaaaaaaaaaacco",
    ".obaacaaaacaacco",
    "obaaacaaaacaaacc",
    "obaaacaaaacaaaco",
    "occcoccocccoccco",
    ".ooo.oo.ooo.ooo.",
  ],
  boots: [
    "................",
    ".....oooooo.....",
    ".....obbaco.....",
    ".....mMmmmo.....",
    ".....obaaco.....",
    ".....obaaco.....",
    ".....obaaco.....",
    ".....obaaco.....",
    ".....obaacoo....",
    "....obaaaaacoo..",
    "....obaaaaaaaco.",
    "....obaaaaaaaaco",
    "....oddddddddddo",
    ".....oooooooooo.",
    "................",
    "................",
  ],
  flask: [
    "....ooo....",
    "....oso....",
    "....oSo....",
    "...ooooo...",
    "...obaao...",
    "..obbaaco..",
    ".obbaaaaco.",
    ".obaaaaaco.",
    ".oaaaaaaco.",
    ".oaaaaacco.",
    "..oaaacco..",
    "...ooooo...",
  ],
  gem: [
    "..ooo..",
    ".obbao.",
    "obbaaco",
    "oaaaaco",
    ".oacco.",
    "..oco..",
    "...o...",
  ],
  hourglass: [
    "ommmmmo",
    ".obbbo.",
    "..oao..",
    "...o...",
    "..oao..",
    ".oaaao.",
    "ommmmmo",
  ],
  diamond: ["..o..", ".oMo.", "oMmno", ".ono.", "..o.."],
  coin: [
    "..ooooo..",
    ".obbbbao.",
    "obbaaaaco",
    "obacccaco",
    "obacbcaco",
    "obacccaco",
    "oaaaaaaco",
    ".oaaccco.",
    "..ooooo..",
  ],
} satisfies Record<string, string[]>;

export type SpriteName = keyof typeof SPRITES;

export function spriteSize(name: SpriteName): { w: number; h: number } {
  const rows: readonly string[] = SPRITES[name];
  return { w: Math.max(...rows.map((r) => r.length)), h: rows.length };
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** RGBA bytes of a sprite, bottom row first (texture order). Pure. */
export function paintSprite(name: SpriteName, tint: string): Uint8Array {
  const rows: readonly string[] = SPRITES[name];
  const { w, h } = spriteSize(name);
  const pal = palette(tint);
  const data = new Uint8Array(w * h * 4);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const hex = pal[row[x]!];
      if (!hex) continue;
      const [r, g, b] = hexRgb(hex);
      const i = ((h - 1 - y) * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  });
  return data;
}
