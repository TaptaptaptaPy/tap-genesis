import { tilePreviewColor } from "../render/terrain";
import type { Camera } from "../render/camera";
import type { GameState } from "../sim/index";
import balance from "../../data/balance.json";

const { W, H } = balance.world;

/** แผนที่ย่อ — พอโลกใหญ่ขึ้นสี่เท่าและมีกล้องแล้ว ผู้เล่นต้องมีที่ให้กวาดตาดูทั้งโลกได้
 *  แตะเพื่อกระโดดกล้องไปจุดนั้นทันที */
export class Minimap {
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private land = document.createElement("canvas");
  private landVersion = -1;
  private px = 4;

  constructor(host: HTMLElement, private cam: Camera, private onJump: (x: number, y: number) => void) {
    this.cv = document.createElement("canvas");
    this.cv.id = "minimapCv";
    host.appendChild(this.cv);
    this.ctx = this.cv.getContext("2d")!;
    this.land.width = W; this.land.height = H;
    this.resize();
    const jump = (e: PointerEvent) => {
      const r = this.cv.getBoundingClientRect();
      this.onJump(((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H);
    };
    this.cv.addEventListener("pointerdown", (e) => { e.stopPropagation(); jump(e); });
    window.addEventListener("resize", () => this.resize());
  }

  private resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = this.cv.clientWidth || 150;
    this.px = cssW / W;
    this.cv.width = Math.round(cssW * dpr);
    this.cv.height = Math.round(cssW * (H / W) * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(s: GameState) {
    if (this.cv.clientWidth && Math.abs(this.px * W - this.cv.clientWidth) > 1) this.resize();
    if (s.terrainVersion !== this.landVersion) {
      this.landVersion = s.terrainVersion;
      const lg = this.land.getContext("2d")!;
      for (const t of s.tiles) { lg.fillStyle = tilePreviewColor(s, t); lg.fillRect(t.x, t.y, 1, 1); }
    }
    const w = this.px * W, h = this.px * H;
    const g = this.ctx;
    g.clearRect(0, 0, w, h);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.land, 0, 0, w, h);

    for (const v of s.villages) {
      g.fillStyle = v.devotion >= 0.2 ? "#f0d38a" : v.devotion <= -0.2 ? "#a48ad4" : "#cfc3ab";
      g.beginPath(); g.arc((v.x + 0.5) * this.px, (v.y + 0.5) * this.px, Math.max(1.6, this.px * 0.9), 0, Math.PI * 2); g.fill();
    }
    for (const d of s.disasters) {
      g.strokeStyle = d.kind === "wildfire" ? "#e07a3a" : d.kind === "plague" ? "#a86ece"
                    : d.kind === "flood" ? "#6aa8d8" : "#d6a856";
      g.lineWidth = 1;
      g.beginPath(); g.arc((d.x + 0.5) * this.px, (d.y + 0.5) * this.px, (d.radius + 0.5) * this.px, 0, Math.PI * 2); g.stroke();
    }
    for (const c of s.creatures) {
      if (!c.alive) continue;
      g.fillStyle = c.pet ? "#ffe9a8" : "rgba(226,214,190,.65)";
      const r = c.pet ? Math.max(1.6, this.px * 0.8) : Math.max(1, this.px * 0.5);
      g.beginPath(); g.arc((c.x + 0.5) * this.px, (c.y + 0.5) * this.px, r, 0, Math.PI * 2); g.fill();
    }

    // กรอบบอกว่ากล้องกำลังมองตรงไหน
    const halfW = this.cam.w / this.cam.scale / 2, halfH = this.cam.h / this.cam.scale / 2;
    g.strokeStyle = "rgba(255,255,255,.85)";
    g.lineWidth = 1.2;
    g.strokeRect((this.cam.cx - halfW) * this.px, (this.cam.cy - halfH) * this.px,
                 halfW * 2 * this.px, halfH * 2 * this.px);
  }
}
