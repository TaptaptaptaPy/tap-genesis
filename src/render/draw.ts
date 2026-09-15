import { lerp } from "../core/rng";
import { BIOMES, isWater } from "../sim/biomes";
import { bodySize } from "../sim/creature";
import type { Creature, GameState } from "../sim/types";
import type { Camera } from "./camera";
import balance from "../../data/balance.json";

const { W, H } = balance.world;
const TP = 18;                 // พิกเซลต่อช่องในแคชพื้นดิน
const REFRESH_TICKS = 6;       // พื้นดินเปลี่ยนช้า ไม่ต้องวาดใหม่ทุกเฟรม

/** แคชพื้นดิน: วาดทั้งแผนที่ลงผ้าใบซ่อนไว้ครั้งเดียว แล้วค่อย blit เฉพาะส่วนที่มองเห็น
 *  ถ้าวาดทีละช่องทุกเฟรมบนแผนที่ 44×32 iPad จะกระตุก */
export class TerrainCache {
  private cv = document.createElement("canvas");
  private cx: CanvasRenderingContext2D;
  private version = -1;
  private tickStamp = -999;

  constructor() {
    this.cv.width = W * TP; this.cv.height = H * TP;
    this.cx = this.cv.getContext("2d")!;
  }

  get canvas() { return this.cv; }

  maybeRefresh(s: GameState) {
    if (s.terrainVersion === this.version && s.tick - this.tickStamp < REFRESH_TICKS) return;
    this.version = s.terrainVersion;
    this.tickStamp = s.tick;
    this.redraw(s);
  }

  private redraw(s: GameState) {
    const g = this.cx;
    for (const t of s.tiles) {
      let c = BIOMES[t.biome].color.slice() as number[];
      if (!isWater(t.biome)) {
        const f = Math.min(1.2, t.fert / Math.max(0.12, t.cap));
        c = [lerp(c[0], c[0] * 0.78, f * 0.45), lerp(c[1], c[1] * 1.06, f * 0.5), lerp(c[2], c[2] * 0.8, f * 0.4)];
        if (t.wet > 0.02) c = [lerp(c[0], 40, t.wet * 0.28), lerp(c[1], 70, t.wet * 0.18), lerp(c[2], 80, t.wet * 0.3)];
        if (t.blight > 0.02) c = [lerp(c[0], 150, t.blight * 0.35), lerp(c[1], 128, t.blight * 0.3), lerp(c[2], 90, t.blight * 0.35)];
        if (t.burn > 0) c = [lerp(c[0], 200, t.burn * 0.5), lerp(c[1], 90, t.burn * 0.45), lerp(c[2], 40, t.burn * 0.5)];
      }
      g.fillStyle = `rgb(${(c[0] * t.shade) | 0},${(c[1] * t.shade) | 0},${(c[2] * t.shade) | 0})`;
      g.fillRect(t.x * TP, t.y * TP, TP + 1, TP + 1);
    }
    for (const t of s.tiles) {
      const px = t.x * TP, py = t.y * TP;
      if (t.biome === "FOREST") {
        g.fillStyle = "rgba(22,58,32,.75)";
        for (let i = 0; i < 3; i++) {
          const bx = px + TP * (0.22 + 0.28 * i) + ((t.x * 7 + i * 3) % 3) * 0.8;
          const by = py + TP * (0.7 - ((t.y * 5 + i) % 3) * 0.08);
          g.beginPath(); g.moveTo(bx, by - TP * 0.34);
          g.lineTo(bx + TP * 0.13, by); g.lineTo(bx - TP * 0.13, by);
          g.closePath(); g.fill();
        }
      } else if (t.biome === "MOUNT" || t.biome === "SNOW") {
        g.fillStyle = t.biome === "SNOW" ? "rgba(255,255,255,.7)" : "rgba(90,88,84,.75)";
        g.beginPath(); g.moveTo(px + TP * 0.5, py + TP * 0.18);
        g.lineTo(px + TP * 0.86, py + TP * 0.82); g.lineTo(px + TP * 0.14, py + TP * 0.82);
        g.closePath(); g.fill();
      }
    }
  }
}

export interface DrawOpts {
  hover: { x: number; y: number } | null;
  armedRadius: number | null;
  armedDark: boolean;
  selected: { x: number; y: number } | null;
  showMemory: boolean;
}

export function draw(ctx: CanvasRenderingContext2D, s: GameState, cam: Camera,
                     terrain: TerrainCache, time: number, o: DrawOpts) {
  const S = cam.scale;
  ctx.clearRect(0, 0, cam.w, cam.h);
  ctx.save();
  if (s.shake > 0.2) ctx.translate((Math.random() - 0.5) * s.shake, (Math.random() - 0.5) * s.shake);

  terrain.maybeRefresh(s);
  const r = cam.visibleRange();
  const tl = cam.toScreen(r.x0, r.y0);
  ctx.imageSmoothingEnabled = S < TP;
  ctx.drawImage(terrain.canvas,
    r.x0 * TP, r.y0 * TP, (r.x1 - r.x0 + 1) * TP, (r.y1 - r.y0 + 1) * TP,
    tl.x, tl.y, (r.x1 - r.x0 + 1) * S, (r.y1 - r.y0 + 1) * S);

  // ผสมสีตามแกนธรรม/อธรรมและฤดูกาล — ทาทับทีเดียว ไม่ต้องคิดทีละช่อง
  const a = Math.abs(s.align);
  if (a > 0.02) {
    ctx.globalAlpha = a * 0.26;
    ctx.fillStyle = s.align >= 0 ? "rgb(255,236,186)" : "rgb(104,26,34)";
    ctx.fillRect(0, 0, cam.w, cam.h);
    ctx.globalAlpha = 1;
  }
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = balance.season.tint[s.season];
  ctx.fillRect(0, 0, cam.w, cam.h);
  ctx.globalAlpha = 1;

  if (o.showMemory) drawMemory(ctx, s, cam, r);
  drawDisasters(ctx, s, cam, time);
  drawVillages(ctx, s, cam);
  for (const c of s.creatures) if (c.alive) drawCreature(ctx, s, c, cam, time);
  drawEffects(ctx, s, cam);

  if (o.selected) {
    const p = cam.toScreen(o.selected.x, o.selected.y);
    ctx.strokeStyle = "rgba(239,227,200,.85)"; ctx.lineWidth = 1.6;
    ctx.strokeRect(p.x, p.y, S, S);
  }
  if (o.hover && o.armedRadius !== null) {
    const p = cam.toScreen(o.hover.x + 0.5, o.hover.y + 0.5);
    ctx.strokeStyle = o.armedDark ? "rgba(200,80,80,.8)" : "rgba(217,164,55,.85)";
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(p.x, p.y, (o.armedRadius + 0.5) * S, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

/** แผนที่ความจำของสัตว์: เขียว = มันจำว่าที่นี่ดี แดง = จำว่าแย่ */
function drawMemory(ctx: CanvasRenderingContext2D, s: GameState, cam: Camera,
                    r: { x0: number; y0: number; x1: number; y1: number }) {
  const pet = s.creatures.find((c) => c.pet);
  if (!pet) return;
  const S = cam.scale;
  for (const [k, v] of Object.entries(pet.mem)) {
    const i = Number(k), x = i % W, y = Math.floor(i / W);
    if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) continue;
    const p = cam.toScreen(x, y);
    ctx.globalAlpha = Math.min(0.55, Math.abs(v) * 0.6);
    ctx.fillStyle = v > 0 ? "#6ad08a" : "#d05a5a";
    ctx.fillRect(p.x, p.y, S, S);
  }
  ctx.globalAlpha = 1;
}

function drawDisasters(ctx: CanvasRenderingContext2D, s: GameState, cam: Camera, time: number) {
  for (const d of s.disasters) {
    const p = cam.toScreen(d.x + 0.5, d.y + 0.5);
    const pulse = 0.5 + 0.5 * Math.sin(time * 0.004);
    ctx.strokeStyle = d.kind === "plague" ? `rgba(150,90,190,${0.3 + pulse * 0.4})`
                    : d.kind === "drought" ? `rgba(214,168,86,${0.25 + pulse * 0.35})`
                    : d.kind === "flood" ? `rgba(96,150,210,${0.3 + pulse * 0.4})`
                    : `rgba(220,110,60,${0.3 + pulse * 0.45})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.arc(p.x, p.y, (d.radius + 0.6) * cam.scale, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawVillages(ctx: CanvasRenderingContext2D, s: GameState, cam: Camera) {
  const S = cam.scale;
  for (const vg of s.villages) {
    const p = cam.toScreen(vg.x + 0.5, vg.y + 0.5);
    if (p.x < -S * 3 || p.y < -S * 3 || p.x > cam.w + S * 3 || p.y > cam.h + S * 3) continue;
    const sz = S * (0.3 + Math.min(0.34, vg.pop / 220));
    // สีอาคารบอกว่าใจของหมู่บ้านเอนไปทางใคร
    ctx.fillStyle = vg.devotion >= 0.2 ? "#e8cf9a" : vg.devotion <= -0.2 ? "#9b7fc4" : "#c9bda6";
    if (s.era <= 1) {
      ctx.beginPath(); ctx.moveTo(p.x, p.y - sz);
      ctx.lineTo(p.x + sz, p.y + sz * 0.7); ctx.lineTo(p.x - sz, p.y + sz * 0.7);
      ctx.closePath(); ctx.fill();
    } else if (s.era <= 3) {
      ctx.fillRect(p.x - sz * 0.8, p.y - sz * 0.2, sz * 1.6, sz);
      ctx.beginPath(); ctx.moveTo(p.x, p.y - sz * 1.1);
      ctx.lineTo(p.x + sz, p.y - sz * 0.2); ctx.lineTo(p.x - sz, p.y - sz * 0.2);
      ctx.closePath(); ctx.fill();
    } else {
      ctx.fillRect(p.x - sz * 0.9, p.y - sz * 0.5, sz * 0.8, sz * 1.4);
      ctx.fillRect(p.x + sz * 0.1, p.y - sz * 1.1, sz * 0.8, sz * 2);
    }
    ctx.strokeStyle = `rgba(217,164,55,${0.25 + vg.belief * 0.65})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(p.x, p.y, sz * 1.65, 0, Math.PI * 2); ctx.stroke();

    // ความต้องการที่ขาด แสดงเป็นขีดเล็กๆ ใต้หมู่บ้าน ให้เห็นว่าที่ไหนกำลังเดือดร้อน
    const bars: [number, string][] = [
      [vg.needs.food, "#7fc08a"], [vg.needs.wood, "#b58a5a"], [vg.needs.shelter, "#7fa6c0"]];
    const bw = sz * 0.7;
    bars.forEach(([val, col], i) => {
      if (val > 0.72) return;
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(p.x - bw * 1.5 + i * bw * 1.1, p.y + sz * 1.9, bw * (0.25 + val * 0.75), Math.max(1.5, S * 0.06));
      ctx.globalAlpha = 1;
    });
    if (vg.plague > 0) {
      ctx.fillStyle = "rgba(170,110,200,.9)";
      ctx.font = `${Math.max(8, S * 0.5)}px Trirong,serif`; ctx.textAlign = "center";
      ctx.fillText("☠", p.x, p.y - sz * 2);
    }
  }
}

function drawCreature(ctx: CanvasRenderingContext2D, s: GameState, c: Creature, cam: Camera, time: number) {
  const S = cam.scale, g = c.genes;
  const p = cam.toScreen(c.x + 0.5, c.y + 0.5);
  if (p.x < -S * 3 || p.y < -S * 3 || p.x > cam.w + S * 3 || p.y > cam.h + S * 3) return;
  const r = S * (0.2 + 0.3 * bodySize(c));
  const bob = Math.sin(time * 0.006 + c.id) * r * 0.12;
  ctx.fillStyle = "rgba(0,0,0,.28)";
  ctx.beginPath(); ctx.ellipse(p.x, p.y + r * 0.85, r * 0.9, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();

  const br = lerp(150, 206, g.aggr), bg = lerp(150, 116, g.aggr), bb = lerp(130, 150, g.intel);
  const dim = c.pet ? 1 : 0.78;    // สัตว์ป่าสีจางกว่า จะได้แยกออกจากตัวของเรา
  ctx.fillStyle = `rgb(${(br * dim) | 0},${(bg * dim) | 0},${(bb * dim) | 0})`;
  ctx.beginPath(); ctx.ellipse(p.x, p.y + bob, r, r * 0.86, 0, 0, Math.PI * 2); ctx.fill();

  if (g.coat > 0.55) {
    ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(p.x + Math.cos(a) * r * 0.8, p.y + bob + Math.sin(a) * r * 0.7);
      ctx.lineTo(p.x + Math.cos(a) * r * 1.15, p.y + bob + Math.sin(a) * r);
      ctx.stroke();
    }
  }
  ctx.fillStyle = `rgb(${(br * 0.9 * dim) | 0},${(bg * 0.9 * dim) | 0},${(bb * 0.9 * dim) | 0})`;
  ctx.beginPath(); ctx.arc(p.x + r * 0.72, p.y + bob - r * 0.42, r * 0.5, 0, Math.PI * 2); ctx.fill();
  if (c.blink <= 0) {
    ctx.fillStyle = "#111";
    ctx.beginPath(); ctx.arc(p.x + r * 0.92, p.y + bob - r * 0.5, Math.max(1, r * 0.12), 0, Math.PI * 2); ctx.fill();
  }

  if (c.pet) {
    ctx.strokeStyle = "rgba(240,211,138,.55)"; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(p.x, p.y + bob, r * 1.5, 0, Math.PI * 2); ctx.stroke();
    // ฟองความคิด: บอกว่ามันต้องการอะไรอยู่ตอนนี้
    if (c.need !== "content" && S > 10) {
      const icon = c.need === "hungry" ? "✿" : c.need === "tired" ? "﹏" : "?";
      ctx.fillStyle = "rgba(20,28,32,.72)";
      ctx.beginPath(); ctx.arc(p.x + r * 1.2, p.y + bob - r * 1.5, r * 0.62, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#efe3c8";
      ctx.font = `${Math.max(8, r * 0.8)}px Trirong,serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(icon, p.x + r * 1.2, p.y + bob - r * 1.5);
      ctx.textBaseline = "alphabetic";
    }
    if (c.cmd) {
      const t = cam.toScreen(c.cmd.x + 0.5, c.cmd.y + 0.5);
      ctx.strokeStyle = "rgba(240,211,138,.3)"; ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(t.x, t.y); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  if (Math.abs(c.mood) > 0.12) {
    ctx.fillStyle = c.mood > 0 ? "rgba(217,164,55,.9)" : "rgba(154,48,48,.9)";
    ctx.font = `${Math.max(10, r)}px Trirong,serif`; ctx.textAlign = "center";
    ctx.fillText(c.mood > 0 ? "✦" : "✕", p.x, p.y - r * 1.7 + bob);
  }
  if (c.tgt && c.pet) {
    const t = cam.toScreen(c.tgt.x + 0.5, c.tgt.y + 0.5);
    ctx.strokeStyle = "rgba(239,227,200,.16)"; ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(t.x, t.y); ctx.stroke(); ctx.setLineDash([]);
  }
}

function drawEffects(ctx: CanvasRenderingContext2D, s: GameState, cam: Camera) {
  const S = cam.scale;
  for (const f of s.fx) {
    const k = 1 - f.t / f.life;
    const p = cam.toScreen(f.x, f.y);
    if (p.x < -40 || p.y < -40 || p.x > cam.w + 40 || p.y > cam.h + 40) continue;
    if (f.kind === "rain") {
      ctx.strokeStyle = `rgba(150,200,235,${k * 0.8})`; ctx.lineWidth = 1;
      const yy = p.y + ((f.t * 260) % (S * 3));
      ctx.beginPath(); ctx.moveTo(p.x, yy); ctx.lineTo(p.x - 1.5, yy + S * 0.45); ctx.stroke();
    } else if (f.kind === "spark") {
      ctx.globalAlpha = k; ctx.fillStyle = f.color ?? "#f0d38a";
      ctx.beginPath(); ctx.arc(p.x, p.y - (1 - k) * S * 1.1, Math.max(0.8, S * 0.11 * k), 0, Math.PI * 2);
      ctx.fill(); ctx.globalAlpha = 1;
    } else if (f.kind === "dust") {
      ctx.globalAlpha = k * 0.6; ctx.fillStyle = "#6b6055";
      ctx.beginPath(); ctx.arc(p.x, p.y, S * 0.4 * (1.3 - k), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    } else if (f.kind === "ripple") {
      ctx.globalAlpha = k * 0.7; ctx.strokeStyle = "#8fc4e8"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, S * (1.4 - k) * 0.9, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (f.kind === "bolt") {
      ctx.globalAlpha = k; ctx.strokeStyle = "#fff3c4"; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(p.x, -10);
      let yy = -10;
      while (yy < p.y) { yy += S * 0.55; ctx.lineTo(p.x + (Math.random() - 0.5) * S * 0.9, yy); }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
  }
}
