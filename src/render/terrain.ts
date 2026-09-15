import { clamp, lerp } from "../core/rng";
import { isWater } from "../sim/biomes";
import { tileAt } from "../sim/world";
import type { GameState, Tile } from "../sim/types";
import { SKIN, SEASON_GRADE, css, hash2, isPlant, mix, shade, type RGB } from "./palette";
import balance from "../../data/balance.json";

const { W, H } = balance.world;
export const TP = 24;                 // พิกเซลต่อช่องในแคชพื้นดิน
const OVERLAY_EVERY = 5;              // ความอุดม/ความชุ่มน้ำเปลี่ยนช้า ไม่ต้องวาดใหม่ทุกเฟรม

/** พื้นดินถูกวาดล่วงหน้าลงผ้าใบซ่อนสองชั้น แล้วค่อย blit เฉพาะส่วนที่มองเห็น
 *  ชั้นล่าง (base) เปลี่ยนเฉพาะตอนภูมิประเทศเปลี่ยนจริง — แพงแต่นานๆ ครั้ง
 *  ชั้นบน (overlay) คือความอุดม ความชุ่มน้ำ ไฟไหม้ ดินเสีย — ถูกกว่า วาดบ่อยกว่า */
export class Terrain {
  readonly base = document.createElement("canvas");
  readonly overlay = document.createElement("canvas");
  private bx: CanvasRenderingContext2D;
  private ox: CanvasRenderingContext2D;
  private baseVersion = -1;
  private baseSeason = -1;
  private overlayTick = -999;
  /** ช่องน้ำที่ติดแผ่นดิน ใช้วางประกายคลื่นแบบเคลื่อนไหว */
  shore: { x: number; y: number }[] = [];
  /** ผ้าใบ 1 พิกเซลต่อ 1 ช่อง — ขยายขึ้นมาแบบ bilinear เพื่อให้สีไล่เข้าหากัน
   *  แทนที่จะเป็นบล็อกสี่เหลี่ยมคมๆ ทีละช่อง */
  private low = document.createElement("canvas");
  private readonly SUB = 4;   // พิกเซลต่อช่องในผ้าใบไล่เฉด

  constructor() {
    for (const cv of [this.base, this.overlay]) { cv.width = W * TP; cv.height = H * TP; }
    this.low.width = W * 4; this.low.height = H * 4;
    this.bx = this.base.getContext("2d")!;
    this.ox = this.overlay.getContext("2d")!;
  }

  update(s: GameState) {
    if (s.terrainVersion !== this.baseVersion || s.season !== this.baseSeason) {
      this.baseVersion = s.terrainVersion;
      this.baseSeason = s.season;
      this.drawBase(s);
    }
    if (s.tick - this.overlayTick >= OVERLAY_EVERY) {
      this.overlayTick = s.tick;
      this.drawOverlay(s);
    }
  }

  // ───────────────── ชั้นล่าง: รูปร่างของแผ่นดิน ─────────────────

  private drawBase(s: GameState) {
    const g = this.bx;
    g.clearRect(0, 0, W * TP, H * TP);
    this.shore = [];

    // 1) เขียนสีของทุกช่องลงผ้าใบ 1px/ช่อง (รวมแสงเงาตามความลาดเอียงไว้แล้ว)
    const SUB = this.SUB;
    const lg = this.low.getContext("2d")!;

    // สีประจำช่อง (รวมแสงเงาตามความลาดเอียงไว้แล้ว) เก็บเป็นตารางก่อน
    const grid = new Float32Array(W * H * 3);
    for (const t of s.tiles) {
      const c = shade(this.tileColor(s, t), this.relief(s, t) * t.shade);
      const i = (t.y * W + t.x) * 3;
      grid[i] = c[0]; grid[i + 1] = c[1]; grid[i + 2] = c[2];
    }
    const sample = (gx: number, gy: number, ch: number) => {
      const x = clamp(gx, 0, W - 1), y = clamp(gy, 0, H - 1);
      return grid[((y | 0) * W + (x | 0)) * 3 + ch];
    };
    // ผสมสีของช่องข้างเคียงแบบ bilinear ทีละพิกเซลย่อย
    // ถ้าปล่อยให้พิกเซลย่อยในช่องเดียวกันใช้สีเดียวกัน ขอบช่องจะกลับมาเห็นเป็นตาราง
    const img = lg.createImageData(W * SUB, H * SUB);
    const px8 = img.data;
    let o = 0;
    for (let y = 0; y < H * SUB; y++) {
      const v = (y + 0.5) / SUB - 0.5;
      const y0 = Math.floor(v), ty = v - y0;
      for (let x = 0; x < W * SUB; x++) {
        const u = (x + 0.5) / SUB - 0.5;
        const x0 = Math.floor(u), tx = u - x0;
        const n = 1 + (hash2(x, y, 7) - 0.5) * 0.11;
        for (let ch = 0; ch < 3; ch++) {
          const a = lerp(sample(x0, y0, ch), sample(x0 + 1, y0, ch), tx);
          const b = lerp(sample(x0, y0 + 1, ch), sample(x0 + 1, y0 + 1, ch), tx);
          px8[o + ch] = lerp(a, b, ty) * n;
        }
        px8[o + 3] = 255;
        o += 4;
      }
    }
    lg.putImageData(img, 0, 0);
    // 2) ขยายขึ้นแบบ bilinear — ขอบช่องหายไป กลายเป็นผืนดินที่ไล่สีเข้าหากัน
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(this.low, 0, 0, W * SUB, H * SUB, 0, 0, W * TP, H * TP);

    for (const t of s.tiles) this.paintCoast(g, s, t);
    for (const t of s.tiles) this.paintDetail(g, s, t);
  }

  private tileColor(s: GameState, t: Tile): RGB {
    const sk = SKIN[t.biome];
    const grade = SEASON_GRADE[s.season];
    let c: RGB = [...sk.base];

    if (isWater(t.biome)) {
      // น้ำลึกเข้มกว่าน้ำตื้น ใช้ความสูงจริงของพื้นทะเลไล่เฉด
      const depth = clamp((0.47 - t.h) / 0.47, 0, 1);
      c = mix(sk.light, sk.dark, depth * 0.9);
    } else if (isPlant(t.biome)) {
      // พืชเปลี่ยนสีตามฤดู และเข้มขึ้นตามความอุดม
      c = mix(c, grade.veg, grade.vegMix);
      const f = clamp(t.fert / Math.max(0.12, t.cap), 0, 1.15);
      c = mix(sk.dark, sk.light, clamp(f * 0.75 + 0.12, 0, 1));
      c = mix(c, grade.veg, grade.vegMix * 0.75);
    } else {
      const f = clamp(t.fert / Math.max(0.1, t.cap), 0, 1);
      c = mix(sk.dark, sk.light, 0.35 + f * 0.4);
    }
    // ฤดูร้อน/แล้งทำให้ทั้งภาพอุ่นขึ้นเล็กน้อย
    if (grade.warm !== 0) c = [c[0] * (1 + grade.warm), c[1] * (1 + grade.warm * 0.45), c[2] * (1 - grade.warm * 0.5)];
    return c;
  }

  /** แสงมาจากทิศตะวันตกเฉียงเหนือ — เทียบความสูงกับเพื่อนบ้านแล้วสว่าง/มืดตามลาดเอียง */
  private relief(s: GameState, t: Tile): number {
    if (isWater(t.biome)) return 1;
    const nw = tileAt(s.tiles, t.x - 1, t.y - 1);
    const se = tileAt(s.tiles, t.x + 1, t.y + 1);
    const dh = (t.h - (nw?.h ?? t.h)) + ((se?.h ?? t.h) - t.h) * 0.4;
    return clamp(1 + dh * 6.5, 0.62, 1.42);
  }

  /** ชายฝั่ง: หาดทรายกับแนวโฟม วาดเป็นวงไล่จางทีละช่อง ไม่ใช่แถบสี่เหลี่ยม
   *  เพราะแถบสี่เหลี่ยมทำให้ขอบเกาะกลายเป็นขั้นบันไดทันที */
  private paintCoast(g: CanvasRenderingContext2D, s: GameState, t: Tile) {
    const neigh = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const;
    const water = isWater(t.biome);
    let touching = 0;
    for (const [dx, dy] of neigh) {
      const n = tileAt(s.tiles, t.x + dx, t.y + dy);
      if (n && isWater(n.biome) !== water) touching++;
    }
    if (!touching) return;

    const cx = t.x * TP + TP / 2, cy = t.y * TP + TP / 2;
    const strength = Math.min(1, touching / 3);
    const rad = TP * 0.72;
    const grad = g.createRadialGradient(cx, cy, TP * 0.1, cx, cy, rad);
    if (water) {
      grad.addColorStop(0, `rgba(184,222,236,${0.26 * strength})`);
      grad.addColorStop(1, "rgba(184,222,236,0)");
      this.shore.push({ x: t.x, y: t.y });
    } else {
      grad.addColorStop(0, `rgba(222,206,162,${0.3 * strength})`);
      grad.addColorStop(1, "rgba(222,206,162,0)");
    }
    g.fillStyle = grad;
    g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.fill();
  }

  // ───────────────── รายละเอียดของแต่ละชีวนิเวศ ─────────────────

  private paintDetail(g: CanvasRenderingContext2D, s: GameState, t: Tile) {
    const px = t.x * TP, py = t.y * TP;
    const sk = SKIN[t.biome];
    const grade = SEASON_GRADE[s.season];
    const rnd = (k: number) => hash2(t.x, t.y, k);

    switch (t.biome) {
      case "FOREST": {
        const n = 2 + Math.floor(rnd(11) * 4);
        for (let i = 0; i < n; i++) {
          const ox = rnd(i * 13 + 3) * (TP - 9) + 4.5;
          const oy = rnd(i * 13 + 4) * (TP - 11) + 7;
          const h = TP * (0.3 + rnd(i * 13 + 5) * 0.3);
          const w = h * (0.44 + rnd(i * 13 + 6) * 0.2);
          g.fillStyle = "rgba(34,26,18,.5)";
          g.fillRect(px + ox - 0.8, py + oy - h * 0.12, 1.6, h * 0.24);
          const canopy = mix(sk.detail, grade.veg, grade.vegMix * 0.9);
          g.fillStyle = css(canopy, 0.92);
          g.beginPath();
          g.moveTo(px + ox, py + oy - h);
          g.lineTo(px + ox + w, py + oy);
          g.lineTo(px + ox - w, py + oy);
          g.closePath(); g.fill();
          g.fillStyle = css(shade(canopy, 1.3), 0.6);
          g.beginPath();
          g.moveTo(px + ox, py + oy - h);
          g.lineTo(px + ox + w * 0.36, py + oy - h * 0.2);
          g.lineTo(px + ox - w * 0.22, py + oy - h * 0.2);
          g.closePath(); g.fill();
        }
        break;
      }
      case "LUSH":
      case "GRASS": {
        // ไม่ใช่ทุกช่องที่มีกอหญ้า ไม่งั้นลายจะซ้ำทั้งทุ่ง
        if (rnd(19) > (t.biome === "LUSH" ? 0.72 : 0.42)) break;
        const n = 2 + Math.floor(rnd(20) * 4);
        g.strokeStyle = css(mix(sk.detail, grade.veg, grade.vegMix), 0.34);
        g.lineWidth = 1;
        for (let i = 0; i < n; i++) {
          const ox = px + 2 + rnd(i * 5 + 21) * (TP - 4);
          const oy = py + 3 + rnd(i * 5 + 22) * (TP - 5);
          const hgt = 2 + rnd(i * 5 + 23) * 3.5;
          g.beginPath();
          g.moveTo(ox, oy);
          g.lineTo(ox + (rnd(i * 5 + 24) - 0.5) * 3, oy - hgt);
          g.stroke();
        }
        break;
      }
      case "DESERT":
      case "SAND": {
        // สันทรายมีแค่บางช่อง และเอียงไม่เท่ากัน ไม่งั้นดูเหมือนกระเบื้องหลังคา
        if (rnd(29) > 0.34) break;
        g.strokeStyle = css(sk.detail, 0.26);
        g.lineWidth = 1 + rnd(30);
        const oy = py + (0.2 + rnd(31) * 0.6) * TP;
        const w = TP * (0.4 + rnd(32) * 0.55);
        const x0 = px + rnd(33) * (TP - w);
        const lift = 2 + rnd(34) * 4;
        g.beginPath();
        g.moveTo(x0, oy);
        g.quadraticCurveTo(x0 + w / 2, oy - lift, x0 + w, oy + (rnd(35) - 0.5) * 2);
        g.stroke();
        break;
      }
      case "HILL": {
        if (rnd(36) > 0.45) break;
        g.strokeStyle = css(sk.detail, 0.3);
        g.lineWidth = 1;
        const oy = py + (0.28 + rnd(37) * 0.42) * TP;
        const w = TP * (0.5 + rnd(38) * 0.4);
        const x0 = px + rnd(39) * (TP - w);
        g.beginPath();
        g.moveTo(x0, oy + 2);
        g.quadraticCurveTo(x0 + w / 2, oy - 4 - rnd(40) * 3, x0 + w, oy + 2);
        g.stroke();
        // ก้อนหินประปราย
        if (rnd(43) > 0.7) {
          g.fillStyle = css(sk.detail, 0.5);
          g.beginPath();
          g.ellipse(px + rnd(44) * TP, py + rnd(45) * TP, 2 + rnd(46) * 1.6, 1.4 + rnd(47), 0, 0, Math.PI * 2);
          g.fill();
        }
        break;
      }
      case "MOUNT":
      case "SNOW": {
        // เว้นบางช่องไว้ และให้ยอดสูง-กว้างไม่เท่ากัน เทือกเขาจะได้ไม่เป็นตาราง
        if (rnd(60) > 0.86) break;
        const snow = t.biome === "SNOW";
        const peaks = rnd(61) > 0.62 ? 2 : 1;
        for (let i = 0; i < peaks; i++) {
          const peak = TP * (0.52 + rnd(41 + i * 9) * 0.62);
          const cx = px + TP * (0.2 + rnd(42 + i * 9) * 0.6);
          const baseY = py + TP * (0.86 + rnd(43 + i * 9) * 0.2);
          const halfW = TP * (0.26 + rnd(48 + i * 9) * 0.3);
          const tone = 0.86 + rnd(62 + i * 9) * 0.3;
          g.fillStyle = css(shade(sk.detail, tone));
          g.beginPath();
          g.moveTo(cx, baseY - peak);
          g.lineTo(cx + halfW, baseY);
          g.lineTo(cx - halfW, baseY);
          g.closePath(); g.fill();
          g.fillStyle = css(shade(sk.light, tone * 1.06), 0.85);
          g.beginPath();
          g.moveTo(cx, baseY - peak);
          g.lineTo(cx - halfW, baseY);
          g.lineTo(cx - halfW * 0.1, baseY);
          g.closePath(); g.fill();
          if (snow || peak > TP * 0.8) {
            g.fillStyle = snow ? "rgba(255,255,255,.95)" : "rgba(238,243,250,.75)";
            const capY = baseY - peak * (0.5 + rnd(49 + i * 9) * 0.16);
            g.beginPath();
            g.moveTo(cx, baseY - peak);
            g.lineTo(cx + halfW * 0.44, capY);
            g.lineTo(cx + halfW * 0.16, capY - 2);
            g.lineTo(cx - halfW * 0.18, capY + 1);
            g.lineTo(cx - halfW * 0.42, capY - 1);
            g.closePath(); g.fill();
          }
        }
        break;
      }
      case "ASH": {
        g.fillStyle = css(sk.detail, 0.55);
        const n = 3 + Math.floor(rnd(50) * 4);
        for (let i = 0; i < n; i++)
          g.fillRect(px + rnd(i * 3 + 51) * (TP - 3), py + rnd(i * 3 + 52) * (TP - 3), 2, 2);
        if (rnd(59) > 0.6) {
          g.fillStyle = "rgba(26,20,18,.75)";
          g.fillRect(px + rnd(60) * (TP - 4), py + TP * 0.5, 2, TP * 0.28);
        }
        break;
      }
      default: break;
    }
  }

  // ───────────────── ชั้นบน: สภาพของดิน ณ ตอนนี้ ─────────────────

  private drawOverlay(s: GameState) {
    const g = this.ox;
    g.clearRect(0, 0, W * TP, H * TP);
    for (const t of s.tiles) {
      if (isWater(t.biome)) continue;
      const px = t.x * TP, py = t.y * TP;
      if (t.wet > 0.03) {
        g.fillStyle = `rgba(56,104,132,${Math.min(0.34, t.wet * 0.34)})`;
        g.fillRect(px, py, TP + 1, TP + 1);
      }
      if (t.blight > 0.03) {
        g.fillStyle = `rgba(158,132,86,${Math.min(0.42, t.blight * 0.42)})`;
        g.fillRect(px, py, TP + 1, TP + 1);
        // รอยดินแตก
        g.strokeStyle = `rgba(92,72,48,${Math.min(0.5, t.blight * 0.5)})`;
        g.lineWidth = 1;
        g.beginPath();
        const a = hash2(t.x, t.y, 71) * Math.PI;
        g.moveTo(px + TP * 0.2, py + TP * (0.3 + hash2(t.x, t.y, 72) * 0.4));
        g.lineTo(px + TP * 0.8, py + TP * (0.3 + Math.sin(a) * 0.4));
        g.stroke();
      }
      if (t.burn > 0.02) {
        const k = Math.min(1, t.burn);
        g.fillStyle = `rgba(214,96,38,${k * 0.55})`;
        g.fillRect(px, py, TP + 1, TP + 1);
        g.fillStyle = `rgba(255,196,86,${k * 0.5})`;
        for (let i = 0; i < 3; i++) {
          const ox = px + hash2(t.x, t.y, i + 81) * (TP - 5);
          const oy = py + hash2(t.x, t.y, i + 84) * (TP - 8);
          g.beginPath();
          g.moveTo(ox, oy + 6);
          g.quadraticCurveTo(ox + 2.5, oy + 1, ox + 1.2, oy - 3);
          g.quadraticCurveTo(ox + 0.2, oy + 1, ox - 2, oy + 6);
          g.closePath(); g.fill();
        }
      }
    }
  }
}

/** เฉดของแผ่นดินที่ยังไม่ถูกสำรวจ — ใช้กับ minimap ด้วย */
export const tilePreviewColor = (s: GameState, t: Tile): string => {
  const sk = SKIN[t.biome];
  const c = isWater(t.biome)
    ? mix(sk.light, sk.dark, clamp((0.47 - t.h) / 0.47, 0, 1) * 0.9)
    : mix(sk.dark, sk.light, clamp(t.fert / Math.max(0.12, t.cap), 0, 1) * 0.7 + 0.2);
  return css(c);
};

export const lerpRGB = lerp;
