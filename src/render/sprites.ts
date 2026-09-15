import { clamp, lerp } from "../core/rng";
import { bodySize } from "../sim/creature";
import type { Creature, GameState, Village } from "../sim/types";
import { css, hash2, mix, shade, type RGB } from "./palette";
import type { Camera } from "./camera";

const GOLD: RGB = [232, 207, 154];
const VIOLET: RGB = [164, 138, 212];
const NEUTRAL: RGB = [201, 189, 166];

/** สีของหมู่บ้านบอกว่าใจของพวกเขาเอนไปทางเทพองค์ไหน */
const sideColor = (v: Village): RGB =>
  v.devotion >= 0.2 ? GOLD : v.devotion <= -0.2 ? VIOLET : NEUTRAL;

// ───────────────────────── หมู่บ้าน ─────────────────────────

export function drawVillage(ctx: CanvasRenderingContext2D, s: GameState, v: Village,
                            cam: Camera, time: number) {
  const S = cam.scale;
  const p = cam.toScreen(v.x + 0.5, v.y + 0.5);
  if (p.x < -S * 4 || p.y < -S * 4 || p.x > cam.w + S * 4 || p.y > cam.h + S * 4) return;

  const growth = clamp(v.pop / 120, 0, 1);
  const unit = S * (0.26 + growth * 0.2);
  const col = sideColor(v);
  const roof = shade(col, 0.68);
  const wall = shade(col, 1.0);

  // เงารวมของหมู่บ้าน ทำให้มันนั่งอยู่บนพื้นจริง
  ctx.fillStyle = "rgba(0,0,0,.22)";
  ctx.beginPath();
  ctx.ellipse(p.x, p.y + unit * 0.75, unit * 1.5, unit * 0.52, 0, 0, Math.PI * 2);
  ctx.fill();

  // วงศรัทธา — ยิ่งเชื่อยิ่งสว่าง
  ctx.strokeStyle = `rgba(217,164,55,${0.14 + v.belief * 0.55})`;
  ctx.lineWidth = Math.max(1, S * 0.05);
  ctx.beginPath();
  ctx.arc(p.x, p.y, unit * 2.05, 0, Math.PI * 2);
  ctx.stroke();

  const era = s.era;
  const count = era === 0 ? 2 : era === 1 ? 3 : era === 2 ? 4 : era === 3 ? 4 : 5;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + hash2(v.x, v.y, 3) * 6.28;
    const rad = i === 0 ? 0 : unit * (0.75 + hash2(v.x, v.y, i + 5) * 0.4);
    const bx = p.x + Math.cos(a) * rad;
    const by = p.y + Math.sin(a) * rad * 0.62;
    const scale = (i === 0 ? 1.15 : 0.8 + hash2(v.x, v.y, i + 9) * 0.3) * unit;
    drawBuilding(ctx, bx, by, scale, era, wall, roof);
  }

  // ควันจากเตาไฟ — ตัวเดียวที่ทำให้หมู่บ้านดูมีคนอยู่จริง
  if (S > 9) {
    const puffs = era >= 4 ? 3 : era >= 2 ? 2 : 1;
    for (let i = 0; i < puffs; i++) {
      const phase = (time * 0.00042 + i * 0.37 + hash2(v.x, v.y, i + 17)) % 1;
      const sx = p.x + (hash2(v.x, v.y, i + 21) - 0.5) * unit;
      const sy = p.y - unit * 0.9 - phase * unit * 2.6;
      ctx.fillStyle = `rgba(226,222,214,${(1 - phase) * 0.28})`;
      ctx.beginPath();
      ctx.arc(sx + Math.sin(phase * 5 + i) * unit * 0.26, sy,
              unit * (0.16 + phase * 0.34), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ความต้องการที่ขาด บอกด้วยไอคอนเล็กเหนือหมู่บ้าน ให้กวาดตาเห็นได้ทั้งแผนที่
  if (S > 8) drawNeedPips(ctx, v, p.x, p.y - unit * 2.5, S);

  if (v.plague > 0) {
    const pulse = 0.55 + 0.45 * Math.sin(time * 0.005);
    ctx.fillStyle = `rgba(178,120,208,${pulse})`;
    ctx.font = `${Math.max(9, S * 0.55)}px Trirong,serif`;
    ctx.textAlign = "center";
    ctx.fillText("☣", p.x, p.y - unit * 3.1);
  }

  // ชื่อหมู่บ้านโผล่มาตอนซูมเข้าใกล้
  if (S > 26) {
    ctx.font = `${Math.max(9, S * 0.34)}px Trirong,serif`;
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(10,24,28,.62)";
    const label = v.name;
    const tw = ctx.measureText(label).width;
    ctx.fillRect(p.x - tw / 2 - 4, p.y + unit * 2.2, tw + 8, S * 0.44);
    ctx.fillStyle = "rgba(239,227,200,.92)";
    ctx.fillText(label, p.x, p.y + unit * 2.2 + S * 0.34);
  }
}

function drawBuilding(ctx: CanvasRenderingContext2D, x: number, y: number, u: number,
                      era: number, wall: RGB, roof: RGB) {
  if (era === 0) {
    // กระท่อมทรงกรวย
    ctx.fillStyle = css(roof);
    ctx.beginPath();
    ctx.moveTo(x, y - u * 1.0);
    ctx.lineTo(x + u * 0.62, y + u * 0.3);
    ctx.lineTo(x - u * 0.62, y + u * 0.3);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = css(shade(roof, 1.3), 0.6);
    ctx.beginPath();
    ctx.moveTo(x, y - u * 1.0);
    ctx.lineTo(x - u * 0.62, y + u * 0.3);
    ctx.lineTo(x - u * 0.14, y + u * 0.3);
    ctx.closePath(); ctx.fill();
    return;
  }
  const wh = u * (era >= 4 ? 0.95 : era >= 2 ? 0.62 : 0.46);
  const ww = u * 0.78;
  ctx.fillStyle = css(wall);
  ctx.fillRect(x - ww / 2, y - wh + u * 0.3, ww, wh);
  ctx.fillStyle = css(shade(wall, 0.78));
  ctx.fillRect(x + ww * 0.16, y - wh + u * 0.3, ww * 0.34, wh);
  // หลังคาจั่ว
  ctx.fillStyle = css(roof);
  ctx.beginPath();
  ctx.moveTo(x, y - wh - u * 0.42 + u * 0.3);
  ctx.lineTo(x + ww * 0.72, y - wh + u * 0.3);
  ctx.lineTo(x - ww * 0.72, y - wh + u * 0.3);
  ctx.closePath(); ctx.fill();
  if (era >= 3) {
    // หอสูงของยุครุ่งเรืองขึ้นไป
    ctx.fillStyle = css(shade(wall, 0.92));
    ctx.fillRect(x + ww * 0.42, y - wh * 1.75 + u * 0.3, ww * 0.3, wh * 1.75);
    ctx.fillStyle = css(roof);
    ctx.beginPath();
    ctx.moveTo(x + ww * 0.57, y - wh * 2.15 + u * 0.3);
    ctx.lineTo(x + ww * 0.8, y - wh * 1.75 + u * 0.3);
    ctx.lineTo(x + ww * 0.34, y - wh * 1.75 + u * 0.3);
    ctx.closePath(); ctx.fill();
  }
  if (era >= 1 && u > 6) {
    ctx.fillStyle = "rgba(38,28,20,.55)";
    ctx.fillRect(x - ww * 0.12, y - wh * 0.45 + u * 0.3, ww * 0.24, wh * 0.45);
  }
}

const NEED_COLOR: Record<string, string> = {
  food: "#7fc08a", wood: "#b58a5a", shelter: "#7fa6c0",
};

function drawNeedPips(ctx: CanvasRenderingContext2D, v: Village, x: number, y: number, S: number) {
  const items: [string, number][] = [
    ["food", v.needs.food], ["wood", v.needs.wood], ["shelter", v.needs.shelter]];
  const lacking = items.filter(([, val]) => val < 0.72);
  if (!lacking.length) return;
  const r = Math.max(1.6, S * 0.085);
  const gap = r * 2.7;
  let cx = x - ((lacking.length - 1) * gap) / 2;
  for (const [id, val] of lacking) {
    ctx.fillStyle = "rgba(10,22,26,.5)";
    ctx.beginPath(); ctx.arc(cx, y, r * 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = NEED_COLOR[id];
    ctx.globalAlpha = 0.35 + (1 - val) * 0.65;
    ctx.beginPath(); ctx.arc(cx, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    cx += gap;
  }
}

// ───────────────────────── สัตว์ ─────────────────────────

export function drawCreature(ctx: CanvasRenderingContext2D, c: Creature, cam: Camera, time: number) {
  const S = cam.scale, g = c.genes;
  const p = cam.toScreen(c.x + 0.5, c.y + 0.5);
  if (p.x < -S * 4 || p.y < -S * 4 || p.x > cam.w + S * 4 || p.y > cam.h + S * 4) return;

  const r = S * (0.17 + 0.26 * bodySize(c));
  const moving = !!c.tgt;
  const face = c.tgt && c.tgt.x < c.x ? -1 : 1;
  const stride = moving ? Math.sin(time * 0.012 + c.id) : 0;
  const bob = Math.sin(time * 0.006 + c.id * 1.7) * r * (moving ? 0.16 : 0.08);
  const dim = c.pet ? 1 : 0.8;

  // สีตัวมาจากยีน: ดุร้าย = แดงขึ้น ปัญญา = อมม่วง ขนหนา = สว่างขึ้น
  const body: RGB = [
    lerp(142, 208, g.aggr) * dim,
    lerp(150, 112, g.aggr) * dim,
    lerp(126, 156, g.intel) * dim,
  ];
  const belly = mix(body, [252, 244, 226], 0.32);
  const dark = shade(body, 0.72);

  ctx.save();
  ctx.translate(p.x, p.y + bob);
  ctx.scale(face, 1);

  // เงา
  ctx.fillStyle = "rgba(0,0,0,.26)";
  ctx.beginPath();
  ctx.ellipse(0, r * 0.88 - bob, r * 0.95, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();

  // หาง
  ctx.strokeStyle = css(dark);
  ctx.lineWidth = Math.max(1.2, r * 0.22);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-r * 0.82, r * 0.08);
  ctx.quadraticCurveTo(-r * 1.5, -r * 0.1 + stride * r * 0.2, -r * 1.35, -r * 0.62);
  ctx.stroke();

  // ขา — สลับเฟสหน้า/หลังตอนเดิน
  ctx.strokeStyle = css(dark);
  ctx.lineWidth = Math.max(1.1, r * 0.2);
  for (const [lx, ph] of [[-0.44, 0], [-0.2, Math.PI], [0.3, Math.PI], [0.54, 0]] as const) {
    const swing = Math.sin(time * 0.012 + c.id + ph) * (moving ? 0.34 : 0.04);
    ctx.beginPath();
    ctx.moveTo(r * lx, r * 0.42);
    ctx.lineTo(r * (lx + swing * 0.5), r * 0.95);
    ctx.stroke();
  }

  // ลำตัว
  ctx.fillStyle = css(body);
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * 0.82, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = css(belly, 0.75);
  ctx.beginPath();
  ctx.ellipse(0, r * 0.28, r * 0.74, r * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();

  // ขนกันทารุณ
  if (g.coat > 0.5) {
    ctx.strokeStyle = `rgba(255,255,255,${0.25 + g.coat * 0.45})`;
    ctx.lineWidth = Math.max(0.8, r * 0.1);
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI * 0.85 + (i / 6) * Math.PI * 0.8;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.7);
      ctx.lineTo(Math.cos(a) * r * 1.22, Math.sin(a) * r * 1.0);
      ctx.stroke();
    }
  }

  // หัว
  const hx = r * 0.78, hy = -r * 0.44, hr = r * 0.52;
  ctx.fillStyle = css(body);
  ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.fill();
  // ปาก
  ctx.fillStyle = css(shade(body, 0.88));
  ctx.beginPath();
  ctx.ellipse(hx + hr * 0.62, hy + hr * 0.22, hr * 0.46, hr * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  // หู — ยิ่งปัญญาสูงยิ่งตั้ง
  ctx.fillStyle = css(dark);
  ctx.beginPath();
  ctx.moveTo(hx - hr * 0.3, hy - hr * 0.6);
  ctx.lineTo(hx - hr * 0.05, hy - hr * (0.9 + g.intel * 0.7));
  ctx.lineTo(hx + hr * 0.3, hy - hr * 0.5);
  ctx.closePath(); ctx.fill();
  // ตา
  if (c.blink <= 0) {
    ctx.fillStyle = "#14181a";
    ctx.beginPath(); ctx.arc(hx + hr * 0.3, hy - hr * 0.08, Math.max(0.9, hr * 0.17), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.85)";
    ctx.beginPath(); ctx.arc(hx + hr * 0.36, hy - hr * 0.16, Math.max(0.4, hr * 0.07), 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.strokeStyle = "#14181a"; ctx.lineWidth = Math.max(0.8, hr * 0.12);
    ctx.beginPath();
    ctx.moveTo(hx + hr * 0.16, hy - hr * 0.08);
    ctx.lineTo(hx + hr * 0.46, hy - hr * 0.08);
    ctx.stroke();
  }
  ctx.restore();

  // วงบอกว่านี่คือสัตว์ของผู้เล่น
  if (c.pet) {
    const pulse = 0.42 + 0.18 * Math.sin(time * 0.003);
    ctx.strokeStyle = `rgba(240,211,138,${pulse})`;
    ctx.lineWidth = Math.max(1, S * 0.045);
    ctx.setLineDash([S * 0.22, S * 0.3]);
    ctx.beginPath(); ctx.arc(p.x, p.y + bob, r * 1.62, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    if (c.need !== "content" && S > 9) drawThought(ctx, c, p.x + r * 1.3, p.y + bob - r * 1.7, r);
    if (c.cmd) {
      const t = cam.toScreen(c.cmd.x + 0.5, c.cmd.y + 0.5);
      ctx.strokeStyle = "rgba(240,211,138,.26)";
      ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(t.x, t.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(240,211,138,.5)";
      ctx.beginPath(); ctx.arc(t.x, t.y, S * 0.3, 0, Math.PI * 2); ctx.stroke();
    }
  }

  if (Math.abs(c.mood) > 0.12) {
    ctx.fillStyle = c.mood > 0 ? "rgba(240,205,120,.95)" : "rgba(196,78,78,.95)";
    ctx.font = `${Math.max(11, r * 1.25)}px Trirong,serif`;
    ctx.textAlign = "center";
    ctx.fillText(c.mood > 0 ? "✦" : "✕", p.x, p.y - r * 1.9 + bob);
  }
}

const NEED_ICON: Record<string, string> = {
  hungry: "✿", tired: "﹏", bored: "?", hurt: "!", content: "",
};

function drawThought(ctx: CanvasRenderingContext2D, c: Creature, x: number, y: number, r: number) {
  const rr = r * 0.66;
  ctx.fillStyle = "rgba(14,30,34,.78)";
  ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x - rr * 0.9, y + rr * 0.85, rr * 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(239,227,200,.28)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "#efe3c8";
  ctx.font = `${Math.max(8, rr * 1.15)}px Trirong,serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(NEED_ICON[c.need] ?? "?", x, y + 0.5);
  ctx.textBaseline = "alphabetic";
}
