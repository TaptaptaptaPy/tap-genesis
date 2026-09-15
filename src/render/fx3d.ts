import * as THREE from "three";
import type { DisasterId, GameState } from "../sim/types";
import { groundY } from "./terrain3d";

const MAX = 900;

/** เอฟเฟกต์ทั้งหมดรวมอยู่ใน Points ก้อนเดียว เขียนตำแหน่งใหม่ทุกเฟรม
 *  ถูกกว่าการสร้าง mesh ต่อเม็ดมาก และพอสำหรับฝนเป็นร้อยหยด */
export class Fx3D {
  readonly group = new THREE.Group();
  private points: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 3);
  private size = new Float32Array(MAX);
  private bolt: THREE.Mesh;
  private rings: THREE.Mesh[] = [];
  private cursor: THREE.Mesh;
  private radiusRing: THREE.Mesh;

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute("psize", new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.PointsMaterial({
      size: 0.22, vertexColors: true, transparent: true, opacity: 0.95,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.group.add(this.points);

    const bgeo = new THREE.CylinderGeometry(0.06, 0.16, 26, 6, 1, true);
    bgeo.translate(0, 13, 0);
    this.bolt = new THREE.Mesh(bgeo, new THREE.MeshBasicMaterial({
      color: 0xfff4cc, transparent: true, opacity: 0, depthWrite: false }));
    this.group.add(this.bolt);

    for (let i = 0; i < 6; i++) {
      const r = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 1.0, 36),
        new THREE.MeshBasicMaterial({ color: 0x9fd0ec, transparent: true, opacity: 0,
                                      side: THREE.DoubleSide, depthWrite: false }));
      r.rotation.x = -Math.PI / 2;
      this.rings.push(r);
      this.group.add(r);
    }

    // "มือของพระเจ้า" — วงบนพื้นตรงที่นิ้วชี้อยู่
    this.cursor = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.46, 28),
      new THREE.MeshBasicMaterial({ color: 0xf0e3c0, transparent: true, opacity: 0.75,
                                    side: THREE.DoubleSide, depthWrite: false }));
    this.cursor.rotation.x = -Math.PI / 2;
    this.cursor.visible = false;
    this.group.add(this.cursor);

    this.radiusRing = new THREE.Mesh(
      new THREE.RingGeometry(0.97, 1.0, 48),
      new THREE.MeshBasicMaterial({ color: 0xd9a437, transparent: true, opacity: 0.6,
                                    side: THREE.DoubleSide, depthWrite: false }));
    this.radiusRing.rotation.x = -Math.PI / 2;
    this.radiusRing.visible = false;
    this.group.add(this.radiusRing);
  }

  setCursor(s: GameState, tile: { x: number; y: number } | null, radius: number | null, dark: boolean) {
    if (!tile) { this.cursor.visible = false; this.radiusRing.visible = false; return; }
    const y = groundY(s, tile.x + 0.5, tile.y + 0.5) + 0.06;
    this.cursor.visible = true;
    this.cursor.position.set(tile.x + 0.5, y, tile.y + 0.5);
    if (radius === null) { this.radiusRing.visible = false; return; }
    this.radiusRing.visible = true;
    this.radiusRing.position.set(tile.x + 0.5, y, tile.y + 0.5);
    this.radiusRing.scale.setScalar(Math.max(0.4, radius + 0.5));
    (this.radiusRing.material as THREE.MeshBasicMaterial).color.set(dark ? 0xc45448 : 0xd9a437);
  }

  update(s: GameState, time: number) {
    let n = 0;
    let boltAlpha = 0, boltX = 0, boltZ = 0;
    let ringIdx = 0;

    for (const f of s.fx) {
      const k = 1 - f.t / f.life;
      const baseY = groundY(s, f.x, f.y);
      if (f.kind === "bolt") {
        boltAlpha = Math.max(boltAlpha, k); boltX = f.x; boltZ = f.y;
        continue;
      }
      if (f.kind === "ripple" || f.kind === "heal") {
        if (ringIdx < this.rings.length) {
          const r = this.rings[ringIdx++];
          r.position.set(f.x, baseY + 0.08, f.y);
          r.scale.setScalar(0.4 + (1 - k) * 2.2);
          const m = r.material as THREE.MeshBasicMaterial;
          m.opacity = k * 0.7;
          m.color.set(f.kind === "heal" ? 0x9fe0c8 : 0x9fd0ec);
        }
        continue;
      }
      if (n >= MAX) continue;
      const i = n * 3;
      let cx = f.x, cy = baseY, cz = f.y, r = 0.22;
      let col: [number, number, number] = [1, 1, 1];

      if (f.kind === "rain") {
        cy = baseY + 6 - (f.t / f.life) * 6.4;
        col = [0.55, 0.78, 0.95]; r = 0.16;
      } else if (f.kind === "spark") {
        cy = baseY + 0.3 + (1 - k) * 1.5;
        const c = new THREE.Color(f.color ?? "#f0d38a");
        col = [c.r, c.g, c.b];
        r = 0.3 * k + 0.08;
      } else if (f.kind === "dust") {
        cy = baseY + 0.2 + (1 - k) * 0.7;
        col = [0.42, 0.37, 0.32]; r = 0.5 * (1.3 - k);
      }
      this.pos[i] = cx; this.pos[i + 1] = cy; this.pos[i + 2] = cz;
      this.col[i] = col[0] * k; this.col[i + 1] = col[1] * k; this.col[i + 2] = col[2] * k;
      this.size[n] = r;
      n++;
    }

    // ภัยพิบัติ: ไฟป่าพ่นสะเก็ดขึ้น ภัยแล้งมีฝุ่นลอย
    for (const d of s.disasters) {
      if (n >= MAX - 12) break;
      const dy = groundY(s, d.x + 0.5, d.y + 0.5);
      const count = d.kind === "wildfire" ? 10 : d.kind === "drought" ? 6 : 4;
      for (let i = 0; i < count; i++) {
        const ph = ((time * 0.0009) + i * 0.13) % 1;
        const ang = i * 2.4 + time * 0.0004;
        const rad = (d.radius + 0.4) * (0.3 + ph * 0.7);
        const px = d.x + 0.5 + Math.cos(ang) * rad;
        const pz = d.y + 0.5 + Math.sin(ang) * rad;
        const j = n * 3;
        this.pos[j] = px;
        this.pos[j + 1] = dy + ph * (d.kind === "wildfire" ? 2.4 : 1.1);
        this.pos[j + 2] = pz;
        const c = DISASTER_COLOR[d.kind];
        const fade = 1 - ph;
        this.col[j] = c[0] * fade; this.col[j + 1] = c[1] * fade; this.col[j + 2] = c[2] * fade;
        this.size[n] = 0.24;
        n++;
      }
    }

    for (let i = ringIdx; i < this.rings.length; i++)
      (this.rings[i].material as THREE.MeshBasicMaterial).opacity = 0;

    const geo = this.points.geometry;
    geo.setDrawRange(0, n);
    (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;

    const bm = this.bolt.material as THREE.MeshBasicMaterial;
    bm.opacity = boltAlpha * 0.9;
    if (boltAlpha > 0) this.bolt.position.set(boltX, groundY(s, boltX, boltZ), boltZ);
  }
}

const DISASTER_COLOR: Record<DisasterId, [number, number, number]> = {
  wildfire: [1.0, 0.55, 0.18],
  drought: [0.85, 0.7, 0.36],
  flood: [0.42, 0.68, 0.9],
  plague: [0.68, 0.42, 0.82],
};
