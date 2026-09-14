import { lerp } from "../core/rng";
import { BIOMES, isWater } from "../sim/biomes";
import type { GameState } from "../sim/types";

export interface View { tileSize: number; ox: number; oy: number; w: number; h: number; }

/** ผสมสีตามแกนธรรม/อธรรม — นี่คือสิ่งที่ทำให้ "ทางเลือกของผู้เล่นเห็นได้ด้วยตา" */
function tint(c: number[], align: number): number[] {
  const a = Math.abs(align) * 0.26;
  const to = align >= 0 ? [255, 236, 186] : [104, 26, 34];
  return [lerp(c[0], to[0], a), lerp(c[1], to[1], a), lerp(c[2], to[2], a)];
}

export function draw(ctx: CanvasRenderingContext2D, s: GameState, v: View, time: number,
                     hover: { x: number; y: number } | null, armedRadius: number | null,
                     armedDark = false) {
  const { tileSize: TS, ox: OX, oy: OY } = v;
  ctx.clearRect(0, 0, v.w, v.h);
  ctx.save();
  if (s.shake > 0.2) ctx.translate((Math.random() - 0.5) * s.shake, (Math.random() - 0.5) * s.shake);

  for (const t of s.tiles) {
    let c = BIOMES[t.biome].color.slice() as number[];
    if (!isWater(t.biome)) {
      const f = Math.min(1.2, t.fert / Math.max(0.12, t.cap));
      c = [lerp(c[0], c[0] * 0.78, f * 0.45), lerp(c[1], c[1] * 1.06, f * 0.5), lerp(c[2], c[2] * 0.8, f * 0.4)];
      if (t.wet > 0.02) c = [lerp(c[0], 40, t.wet * 0.28), lerp(c[1], 70, t.wet * 0.18), lerp(c[2], 80, t.wet * 0.3)];
      if (t.burn > 0) c = [lerp(c[0], 200, t.burn * 0.5), lerp(c[1], 90, t.burn * 0.45), lerp(c[2], 40, t.burn * 0.5)];
    } else {
      const sh = Math.sin(time * 0.0011 + t.x * 0.7 + t.y * 1.1) * 0.5 + 0.5;
      c = [c[0] + sh * 9, c[1] + sh * 11, c[2] + sh * 13];
    }
    c = tint(c, s.align);
    ctx.fillStyle = `rgb(${(c[0] * t.shade) | 0},${(c[1] * t.shade) | 0},${(c[2] * t.shade) | 0})`;
    ctx.fillRect(OX + t.x * TS, OY + t.y * TS, TS + 0.7, TS + 0.7);
  }

  for (const t of s.tiles) {
    const px = OX + t.x * TS, py = OY + t.y * TS;
    if (t.biome === "FOREST") {
      ctx.fillStyle = "rgba(22,58,32,.75)";
      for (let i = 0; i < 3; i++) {
        const bx = px + TS * (0.22 + 0.28 * i) + ((t.x * 7 + i * 3) % 3) * 0.8;
        const by = py + TS * (0.7 - ((t.y * 5 + i) % 3) * 0.08);
        ctx.beginPath(); ctx.moveTo(bx, by - TS * 0.34);
        ctx.lineTo(bx + TS * 0.13, by); ctx.lineTo(bx - TS * 0.13, by);
        ctx.closePath(); ctx.fill();
      }
    } else if (t.biome === "MOUNT" || t.biome === "SNOW") {
      ctx.fillStyle = t.biome === "SNOW" ? "rgba(255,255,255,.7)" : "rgba(90,88,84,.75)";
      ctx.beginPath(); ctx.moveTo(px + TS * 0.5, py + TS * 0.18);
      ctx.lineTo(px + TS * 0.86, py + TS * 0.82); ctx.lineTo(px + TS * 0.14, py + TS * 0.82);
      ctx.closePath(); ctx.fill();
    }
  }

  for (const vg of s.villages) {
    const px = OX + vg.x * TS + TS / 2, py = OY + vg.y * TS + TS / 2;
    const sz = TS * (0.3 + Math.min(0.34, vg.pop / 220));
    ctx.fillStyle = s.align >= 0 ? "#e8cf9a" : "#c4917f";
    if (s.era <= 1) {
      ctx.beginPath(); ctx.moveTo(px, py - sz);
      ctx.lineTo(px + sz, py + sz * 0.7); ctx.lineTo(px - sz, py + sz * 0.7);
      ctx.closePath(); ctx.fill();
    } else if (s.era <= 3) {
      ctx.fillRect(px - sz * 0.8, py - sz * 0.2, sz * 1.6, sz);
      ctx.beginPath(); ctx.moveTo(px, py - sz * 1.1);
      ctx.lineTo(px + sz, py - sz * 0.2); ctx.lineTo(px - sz, py - sz * 0.2);
      ctx.closePath(); ctx.fill();
    } else {
      ctx.fillRect(px - sz * 0.9, py - sz * 0.5, sz * 0.8, sz * 1.4);
      ctx.fillRect(px + sz * 0.1, py - sz * 1.1, sz * 0.8, sz * 2);
    }
    ctx.strokeStyle = `rgba(217,164,55,${0.25 + vg.belief * 0.65})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(px, py, sz * 1.65, 0, Math.PI * 2); ctx.stroke();
  }

  const c = s.creature;
  if (c.alive) {
    const g = c.genes;
    const px = OX + c.x * TS + TS / 2, py = OY + c.y * TS + TS / 2;
    const r = TS * (0.24 + 0.3 * g.size);
    const bob = Math.sin(time * 0.006) * r * 0.12;
    ctx.fillStyle = "rgba(0,0,0,.28)";
    ctx.beginPath(); ctx.ellipse(px, py + r * 0.85, r * 0.9, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    const br = lerp(150, 206, g.aggr), bg = lerp(150, 116, g.aggr), bb = lerp(130, 150, g.intel);
    ctx.fillStyle = `rgb(${br | 0},${bg | 0},${bb | 0})`;
    ctx.beginPath(); ctx.ellipse(px, py + bob, r, r * 0.86, 0, 0, Math.PI * 2); ctx.fill();
    if (g.coat > 0.55) {
      ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(px + Math.cos(a) * r * 0.8, py + bob + Math.sin(a) * r * 0.7);
        ctx.lineTo(px + Math.cos(a) * r * 1.15, py + bob + Math.sin(a) * r);
        ctx.stroke();
      }
    }
    ctx.fillStyle = `rgb(${(br * 0.9) | 0},${(bg * 0.9) | 0},${(bb * 0.9) | 0})`;
    ctx.beginPath(); ctx.arc(px + r * 0.72, py + bob - r * 0.42, r * 0.5, 0, Math.PI * 2); ctx.fill();
    if (c.blink <= 0) {
      ctx.fillStyle = "#111";
      ctx.beginPath(); ctx.arc(px + r * 0.92, py + bob - r * 0.5, Math.max(1, r * 0.12), 0, Math.PI * 2); ctx.fill();
    }
    if (Math.abs(c.mood) > 0.12) {
      ctx.fillStyle = c.mood > 0 ? "rgba(217,164,55,.9)" : "rgba(154,48,48,.9)";
      ctx.font = `${Math.max(10, r)}px Trirong,serif`; ctx.textAlign = "center";
      ctx.fillText(c.mood > 0 ? "✦" : "✕", px, py - r * 1.7 + bob);
    }
    if (c.tgt) {
      ctx.strokeStyle = "rgba(239,227,200,.16)"; ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(px, py);
      ctx.lineTo(OX + c.tgt.x * TS + TS / 2, OY + c.tgt.y * TS + TS / 2);
      ctx.stroke(); ctx.setLineDash([]);
    }
  }

  for (const f of s.fx) {
    const k = 1 - f.t / f.life, px = OX + f.x * TS, py = OY + f.y * TS;
    if (f.kind === "rain") {
      ctx.strokeStyle = `rgba(150,200,235,${k * 0.8})`; ctx.lineWidth = 1;
      const yy = py + ((f.t * 260) % (TS * 3));
      ctx.beginPath(); ctx.moveTo(px, yy); ctx.lineTo(px - 1.5, yy + TS * 0.45); ctx.stroke();
    } else if (f.kind === "spark") {
      ctx.globalAlpha = k; ctx.fillStyle = f.color ?? "#f0d38a";
      ctx.beginPath(); ctx.arc(px, py - (1 - k) * TS * 1.1, Math.max(0.8, TS * 0.11 * k), 0, Math.PI * 2);
      ctx.fill(); ctx.globalAlpha = 1;
    } else if (f.kind === "dust") {
      ctx.globalAlpha = k * 0.6; ctx.fillStyle = "#6b6055";
      ctx.beginPath(); ctx.arc(px, py, TS * 0.4 * (1.3 - k), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    } else if (f.kind === "bolt") {
      ctx.globalAlpha = k; ctx.strokeStyle = "#fff3c4"; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(px, OY - 10);
      let yy = OY - 10;
      while (yy < py) { yy += TS * 0.55; ctx.lineTo(px + (Math.random() - 0.5) * TS * 0.9, yy); }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
  }

  if (hover && armedRadius !== null) {
    ctx.strokeStyle = armedDark ? "rgba(200,80,80,.8)" : "rgba(217,164,55,.85)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(OX + (hover.x + 0.5) * TS, OY + (hover.y + 0.5) * TS, (armedRadius + 0.5) * TS, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
