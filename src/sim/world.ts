import type { Rng } from "../core/rng";
import { lerp } from "../core/rng";
import { BIOMES, isWater } from "./biomes";
import type { BiomeId, GameState, Tile } from "./types";
import balance from "../../data/balance.json";

/** value noise: สุ่มค่าบนกริดหยาบ แล้ว interpolate ให้เนียน
 *  ซ้อนหลายชั้น (fractal) = ได้ภูมิประเทศที่มีทั้งโครงใหญ่และรายละเอียดเล็ก */
function valueNoise(rng: Rng, gw: number, gh: number) {
  const g: number[][] = [];
  for (let y = 0; y < gh; y++) {
    const row: number[] = [];
    for (let x = 0; x < gw; x++) row.push(rng());
    g.push(row);
  }
  return (u: number, v: number) => {
    const fx = u * (gw - 1), fy = v * (gh - 1);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(x0 + 1, gw - 1), y1 = Math.min(y0 + 1, gh - 1);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty); // smoothstep
    return lerp(lerp(g[y0][x0], g[y0][x1], sx), lerp(g[y1][x0], g[y1][x1], sx), sy);
  };
}

function classify(h: number, m: number): BiomeId {
  if (h < 0.40) return "OCEAN";
  if (h < 0.47) return "SHALLOW";
  if (h < 0.51) return "SAND";
  if (h > 0.88) return m > 0.5 ? "SNOW" : "MOUNT";
  if (h > 0.76) return "HILL";
  if (m < 0.33) return "DESERT";
  if (m < 0.52) return "GRASS";
  if (m < 0.70) return "LUSH";
  return "FOREST";
}

export function generateWorld(rng: Rng): Tile[] {
  const { W, H, minLandRatio, maxLandRatio } = balance.world;
  let out: Tile[] = [];

  for (let attempt = 0; attempt < 24; attempt++) {
    const n1 = valueNoise(rng, 5, 4), n2 = valueNoise(rng, 9, 7), n3 = valueNoise(rng, 17, 13);
    const m1 = valueNoise(rng, 6, 5), m2 = valueNoise(rng, 12, 9);
    const hs = new Float32Array(W * H), ms = new Float32Array(W * H);
    let lo = Infinity, hi = -Infinity;

    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = x / (W - 1), v = y / (H - 1);
      let h = 0.55 * n1(u, v) + 0.30 * n2(u, v) + 0.15 * n3(u, v);
      // ฟอลล์ออฟรูปวงรี: บังคับให้ขอบแผนที่จมน้ำ = ได้เกาะเสมอ
      const dx = (u - 0.5) * 2, dy = (v - 0.5) * 2;
      const d = Math.min(1, Math.sqrt(dx * dx * 0.95 + dy * dy * 1.25));
      h = h * 1.18 - d * d * 0.66;
      hs[y * W + x] = h; lo = Math.min(lo, h); hi = Math.max(hi, h);
      ms[y * W + x] = 0.65 * m1(u, v) + 0.35 * m2(u, v);
    }

    out = []; let land = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const h = (hs[i] - lo) / (hi - lo || 1);
      const biome = classify(h, ms[i]);
      if (!isWater(biome)) land++;
      const cap = BIOMES[biome].cap;
      out.push({ x, y, h, biome, cap, fert: cap * (0.8 + 0.2 * rng()),
                 wet: 0, burn: 0, blight: 0, shade: 0.93 + 0.14 * rng(), village: null });
    }
    const ratio = land / (W * H);
    if (ratio >= minLandRatio && ratio <= maxLandRatio) return out;
  }
  return out;
}

export const idx = (x: number, y: number) => y * balance.world.W + x;

export const tileAt = (tiles: Tile[], x: number, y: number): Tile | null => {
  const { W, H } = balance.world;
  if (x < 0 || y < 0 || x >= W || y >= H) return null;
  return tiles[y * W + x];
};

/** เปลี่ยนชีวนิเวศของช่อง พร้อมอัปเดตเพดานความอุดม และสั่งให้ผู้วาดรีเฟรชพื้นดิน */
export function setBiome(s: GameState, t: Tile, b: BiomeId) {
  if (t.biome === b) return;
  t.biome = b;
  t.cap = BIOMES[b].cap;
  s.terrainVersion++;
}

/** ฝนธรรมชาติประปราย — โลกไม่ได้รอผู้เล่นอย่างเดียว */
export function naturalWeather(s: GameState, rng: Rng): void {
  if (rng() > 0.016) return;
  const { W, H } = balance.world;
  const cx = Math.floor(rng() * W), cy = Math.floor(rng() * H);
  const r = 2 + Math.floor(rng() * 3);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.hypot(dx, dy) > r) continue;
    const t = tileAt(s.tiles, cx + dx, cy + dy);
    if (!t) continue;
    t.wet = Math.min(1, t.wet + 0.35);
    t.burn = 0;
  }
}

export function stepLand(s: GameState): void {
  const L = balance.land;
  const regen = L.regen;
  const wetDecay = L.wetDecay;
  for (const t of s.tiles) {
    if (t.wet > 0) t.wet = Math.max(0, t.wet - wetDecay);
    if (t.burn > 0) t.burn = Math.max(0, t.burn - L.burnDecay);
    if (t.blight > 0) t.blight = Math.max(0, t.blight - 0.004);
    if (isWater(t.biome)) continue;
    const capEff = t.cap * (1 + L.wetCapBonus * t.wet) * (1 - 0.7 * t.blight);
    t.fert = Math.min(1, Math.max(0, t.fert + (capEff - t.fert) * regen));
  }
}
