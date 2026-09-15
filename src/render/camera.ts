import { clamp } from "../core/rng";
import balance from "../../data/balance.json";

const { W, H } = balance.world;

/** กล้อง: เก็บจุดกึ่งกลางที่มองอยู่ (พิกัดช่อง) กับกำลังขยาย (พิกเซลต่อช่อง)
 *  แยกออกมาเป็นไฟล์ของตัวเอง เพราะทั้ง input และ render ต้องใช้ตัวเดียวกัน */
export class Camera {
  cx = W / 2;
  cy = H / 2;
  scale = 22;
  w = 1; h = 1;

  /** กำลังขยายต่ำสุด = พอดีทั้งแผนที่ สูงสุด = เห็นรายละเอียดตัวสัตว์ */
  get minScale() { return Math.min(this.w / W, this.h / H); }
  get maxScale() { return 54; }

  resize(w: number, h: number) {
    this.w = Math.max(1, w); this.h = Math.max(1, h);
    this.scale = clamp(this.scale, this.minScale, this.maxScale);
    this.clampCenter();
  }

  fitAll() { this.scale = this.minScale; this.cx = W / 2; this.cy = H / 2; }

  /** ซูมโดยตรึงจุดบนหน้าจอไว้ที่เดิม (นิ้วอยู่ตรงไหน ที่ตรงนั้นไม่ขยับ) */
  zoomAt(sx: number, sy: number, factor: number) {
    const before = this.toWorld(sx, sy);
    this.scale = clamp(this.scale * factor, this.minScale, this.maxScale);
    const after = this.toWorld(sx, sy);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
    this.clampCenter();
  }

  panByPixels(dx: number, dy: number) {
    this.cx -= dx / this.scale;
    this.cy -= dy / this.scale;
    this.clampCenter();
  }

  /** ไม่ให้เลื่อนจนแผนที่หลุดออกนอกจอ */
  clampCenter() {
    const halfW = this.w / this.scale / 2, halfH = this.h / this.scale / 2;
    this.cx = halfW * 2 >= W ? W / 2 : clamp(this.cx, halfW, W - halfW);
    this.cy = halfH * 2 >= H ? H / 2 : clamp(this.cy, halfH, H - halfH);
  }

  toScreen(wx: number, wy: number) {
    return { x: (wx - this.cx) * this.scale + this.w / 2,
             y: (wy - this.cy) * this.scale + this.h / 2 };
  }
  toWorld(sx: number, sy: number) {
    return { x: (sx - this.w / 2) / this.scale + this.cx,
             y: (sy - this.h / 2) / this.scale + this.cy };
  }
  /** ช่วงช่องที่มองเห็นจริง — วาดแค่นี้พอ ไม่ต้องวาดทั้งแผนที่ */
  visibleRange() {
    const a = this.toWorld(0, 0), b = this.toWorld(this.w, this.h);
    return {
      x0: Math.max(0, Math.floor(a.x) - 1), y0: Math.max(0, Math.floor(a.y) - 1),
      x1: Math.min(W - 1, Math.ceil(b.x) + 1), y1: Math.min(H - 1, Math.ceil(b.y) + 1),
    };
  }
}
