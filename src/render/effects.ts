import { hash2 } from "./palette";
import type { GameState } from "../sim/types";
import type { Camera } from "./camera";
import type { Terrain } from "./terrain";

/** ประกายคลื่นตามแนวชายฝั่ง — ตัวเดียวที่ทำให้ทะเลไม่ใช่แผ่นสีนิ่งๆ */
export function drawShoreGlints(ctx: CanvasRenderingContext2D, cam: Camera,
                                terrain: Terrain, time: number) {
  const S = cam.scale;
  if (S < 7) return;
  const r = cam.visibleRange();
  ctx.fillStyle = "rgba(210,238,248,.5)";
  for (let i = 0; i < terrain.shore.length; i += 2) {
    const t = terrain.shore[i];
    if (t.x < r.x0 || t.x > r.x1 || t.y < r.y0 || t.y > r.y1) continue;
    const phase = (time * 0.0009 + hash2(t.x, t.y, 91)) % 1;
    if (phase > 0.42) continue;
    const a = 1 - phase / 0.42;
    const p = cam.toScreen(t.x + 0.2 + hash2(t.x, t.y, 92) * 0.6,
                           t.y + 0.2 + hash2(t.x, t.y, 93) * 0.6);
    ctx.globalAlpha = a * 0.55;
    ctx.fillRect(p.x, p.y, Math.max(1, S * 0.16), Math.max(1, S * 0.05));
  }
  ctx.globalAlpha = 1;
}

/** ภัยพิบัติต้องมองเห็นจากระยะไกล ไม่ใช่แค่วงประ */
export function drawDisasters(ctx: CanvasRenderingContext2D, s: GameState,
                              cam: Camera, time: number) {
  for (const d of s.disasters) {
    const p = cam.toScreen(d.x + 0.5, d.y + 0.5);
    const rad = (d.radius + 0.7) * cam.scale;
    const pulse = 0.5 + 0.5 * Math.sin(time * 0.0035);

    if (d.kind === "wildfire") {
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad * 1.6);
      g.addColorStop(0, `rgba(255,150,60,${0.2 + pulse * 0.12})`);
      g.addColorStop(1, "rgba(255,120,40,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, rad * 1.6, 0, Math.PI * 2); ctx.fill();
      // สะเก็ดไฟลอยขึ้น
      for (let i = 0; i < 10; i++) {
        const ph = (time * 0.0012 + i * 0.1) % 1;
        const ex = p.x + (hash2(d.x, d.y, i) - 0.5) * rad * 1.4;
        const ey = p.y - ph * rad * 1.8;
        ctx.fillStyle = `rgba(255,${180 - ph * 90 | 0},80,${(1 - ph) * 0.65})`;
        ctx.fillRect(ex, ey, 2, 2);
      }
    } else if (d.kind === "drought") {
      const g = ctx.createRadialGradient(p.x, p.y, rad * 0.3, p.x, p.y, rad);
      g.addColorStop(0, "rgba(226,186,104,0)");
      g.addColorStop(1, `rgba(214,168,86,${0.14 + pulse * 0.07})`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2); ctx.fill();
    } else if (d.kind === "flood") {
      ctx.strokeStyle = `rgba(120,180,226,${0.3 + pulse * 0.35})`;
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const k = ((time * 0.0006 + i / 3) % 1);
        ctx.globalAlpha = (1 - k) * 0.7;
        ctx.beginPath(); ctx.arc(p.x, p.y, rad * (0.3 + k * 0.85), 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else {
      ctx.strokeStyle = `rgba(168,110,206,${0.35 + pulse * 0.4})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

export function drawEffects(ctx: CanvasRenderingContext2D, s: GameState, cam: Camera) {
  const S = cam.scale;
  for (const f of s.fx) {
    const k = 1 - f.t / f.life;
    const p = cam.toScreen(f.x, f.y);
    if (p.x < -60 || p.y < -60 || p.x > cam.w + 60 || p.y > cam.h + 60) continue;

    if (f.kind === "rain") {
      const fall = (f.t * 300) % (S * 3.4);
      const yy = p.y + fall;
      ctx.strokeStyle = `rgba(164,212,240,${k * 0.7})`;
      ctx.lineWidth = Math.max(0.8, S * 0.035);
      ctx.beginPath(); ctx.moveTo(p.x, yy); ctx.lineTo(p.x - S * 0.07, yy + S * 0.5); ctx.stroke();
      if (fall > S * 3.0) {   // กระเซ็นตอนตกถึงพื้น
        ctx.strokeStyle = `rgba(196,230,248,${k * 0.5})`;
        ctx.beginPath();
        ctx.arc(p.x, yy + S * 0.5, S * 0.14, Math.PI, Math.PI * 2);
        ctx.stroke();
      }
    } else if (f.kind === "spark") {
      const rise = (1 - k) * S * 1.3;
      const col = f.color ?? "#f0d38a";
      ctx.globalAlpha = k;
      const gr = ctx.createRadialGradient(p.x, p.y - rise, 0, p.x, p.y - rise, Math.max(2, S * 0.3));
      gr.addColorStop(0, col);
      gr.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(p.x, p.y - rise, Math.max(2, S * 0.3), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    } else if (f.kind === "dust") {
      ctx.globalAlpha = k * 0.55;
      ctx.fillStyle = "#7a6d5e";
      ctx.beginPath(); ctx.arc(p.x, p.y - (1 - k) * S * 0.4, S * 0.42 * (1.35 - k), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    } else if (f.kind === "ripple") {
      ctx.globalAlpha = k * 0.65;
      ctx.strokeStyle = "#9fd0ec";
      ctx.lineWidth = Math.max(1, S * 0.06);
      ctx.beginPath(); ctx.arc(p.x, p.y, S * (1.5 - k) * 0.95, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (f.kind === "bolt") {
      ctx.globalAlpha = Math.min(1, k * 1.4);
      // แสงวาบทั้งจอตอนฟ้าผ่า
      ctx.fillStyle = `rgba(255,250,220,${k * 0.16})`;
      ctx.fillRect(0, 0, cam.w, cam.h);
      drawBoltPath(ctx, p.x, p.y, S, 0);
      ctx.globalAlpha = 1;
    }
  }
}

function drawBoltPath(ctx: CanvasRenderingContext2D, x: number, y: number, S: number, depth: number) {
  ctx.strokeStyle = depth === 0 ? "#fff6d4" : "rgba(255,246,212,.55)";
  ctx.lineWidth = depth === 0 ? Math.max(1.8, S * 0.1) : Math.max(1, S * 0.05);
  ctx.beginPath();
  ctx.moveTo(x, -10);
  let yy = -10, xx = x;
  while (yy < y) {
    yy += S * 0.45;
    xx += (Math.random() - 0.5) * S * 0.8;
    ctx.lineTo(xx, yy);
    if (depth === 0 && Math.random() < 0.18) {
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(xx, yy);
      ctx.lineTo(xx + (Math.random() - 0.5) * S * 2, yy + S * 0.7);
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(xx, yy);
    }
  }
  ctx.stroke();
}

/** ขอบจอมืดลงเล็กน้อย ดึงสายตาเข้ากลางแผนที่ */
export function drawVignette(ctx: CanvasRenderingContext2D, cam: Camera) {
  const g = ctx.createRadialGradient(
    cam.w / 2, cam.h / 2, Math.min(cam.w, cam.h) * 0.42,
    cam.w / 2, cam.h / 2, Math.max(cam.w, cam.h) * 0.78);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(3,12,16,.42)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cam.w, cam.h);
}
