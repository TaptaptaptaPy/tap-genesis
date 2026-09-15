import type { GameState } from "../sim/types";
import type { Camera } from "./camera";
import { Terrain, TP } from "./terrain";
import { drawCreature, drawVillage } from "./sprites";
import { drawDisasters, drawEffects, drawShoreGlints, drawVignette } from "./effects";
import balance from "../../data/balance.json";

const { W } = balance.world;

export { Terrain } from "./terrain";

export interface DrawOpts {
  hover: { x: number; y: number } | null;
  armedRadius: number | null;
  armedDark: boolean;
  selected: { x: number; y: number } | null;
  showMemory: boolean;
}

export function draw(ctx: CanvasRenderingContext2D, s: GameState, cam: Camera,
                     terrain: Terrain, time: number, o: DrawOpts) {
  const S = cam.scale;
  ctx.clearRect(0, 0, cam.w, cam.h);
  ctx.save();
  if (s.shake > 0.2) ctx.translate((Math.random() - 0.5) * s.shake, (Math.random() - 0.5) * s.shake);

  terrain.update(s);
  const r = cam.visibleRange();
  const tl = cam.toScreen(r.x0, r.y0);
  const sw = (r.x1 - r.x0 + 1), sh = (r.y1 - r.y0 + 1);
  ctx.imageSmoothingEnabled = S < TP;
  ctx.drawImage(terrain.base, r.x0 * TP, r.y0 * TP, sw * TP, sh * TP,
                tl.x, tl.y, sw * S, sh * S);
  ctx.drawImage(terrain.overlay, r.x0 * TP, r.y0 * TP, sw * TP, sh * TP,
                tl.x, tl.y, sw * S, sh * S);

  drawShoreGlints(ctx, cam, terrain, time);

  // แกนธรรม/อธรรมย้อมทั้งโลก — ทาทีเดียว ไม่ต้องคิดทีละช่อง
  const a = Math.abs(s.align);
  if (a > 0.02) {
    ctx.globalAlpha = a * 0.22;
    ctx.fillStyle = s.align >= 0 ? "rgb(255,238,192)" : "rgb(116,28,36)";
    ctx.fillRect(0, 0, cam.w, cam.h);
    ctx.globalAlpha = 1;
  }

  if (o.showMemory) drawMemory(ctx, s, cam, r);
  drawDisasters(ctx, s, cam, time);

  // เรียงตามแกน y เพื่อให้สิ่งที่อยู่หน้าบังสิ่งที่อยู่หลัง
  const actors: { y: number; go: () => void }[] = [];
  for (const v of s.villages) actors.push({ y: v.y, go: () => drawVillage(ctx, s, v, cam, time) });
  for (const c of s.creatures) if (c.alive) actors.push({ y: c.y, go: () => drawCreature(ctx, c, cam, time) });
  actors.sort((p, q) => p.y - q.y);
  for (const act of actors) act.go();

  drawEffects(ctx, s, cam);

  if (o.selected) {
    const p = cam.toScreen(o.selected.x, o.selected.y);
    ctx.strokeStyle = "rgba(245,236,214,.9)";
    ctx.lineWidth = Math.max(1.4, S * 0.06);
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, S, S);
    ctx.strokeStyle = "rgba(20,36,42,.55)";
    ctx.lineWidth = Math.max(1, S * 0.03);
    ctx.strokeRect(p.x + 1.8, p.y + 1.8, S - 3.6, S - 3.6);
  }
  if (o.hover && o.armedRadius !== null) {
    const p = cam.toScreen(o.hover.x + 0.5, o.hover.y + 0.5);
    const rad = (o.armedRadius + 0.5) * S;
    const g = ctx.createRadialGradient(p.x, p.y, rad * 0.55, p.x, p.y, rad);
    const tint = o.armedDark ? "196,84,72" : "217,164,55";
    g.addColorStop(0, `rgba(${tint},0)`);
    g.addColorStop(1, `rgba(${tint},.22)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(${tint},.9)`;
    ctx.lineWidth = Math.max(1.4, S * 0.05);
    ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
  drawVignette(ctx, cam);
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
    const p = cam.toScreen(x + 0.5, y + 0.5);
    ctx.globalAlpha = Math.min(0.5, Math.abs(v) * 0.55);
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, S * 0.72);
    g.addColorStop(0, v > 0 ? "#7ce09a" : "#e06a6a");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, S * 0.72, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
