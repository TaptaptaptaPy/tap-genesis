import * as THREE from "three";
import { isWater } from "../sim/biomes";
import { tileAt } from "../sim/world";
import type { BiomeId, GameState, Tile } from "../sim/types";
import { HEIGHT_SCALE, SEA, worldY } from "./world3d";
import balance from "../../data/balance.json";
import models from "../../data/models.json";
import { bakedGeometry } from "./gltf";
import { villageFootprint } from "./layout";
import { Water3D } from "./water";

const { W, H } = balance.world;

type RGB = [number, number, number];
const SKIN: Record<BiomeId, { lo: RGB; hi: RGB }> = {
  // ช่องน้ำในตัวเกาะถูกระนาบผิวน้ำทับอยู่ 88% ที่เหลืออีก 12% คือสิ่งที่เห็น
  // ถ้าสีไม่ใกล้สีระนาบ (0x164b63 = linear ราว 0.008/0.068/0.123) จะเห็น "ขอบโลก"
  // เป็นสี่เหลี่ยมจัตุรัสรอบเกาะ เพราะนอกตารางพื้นดินไม่มีช่องน้ำให้ทับ
  OCEAN:   { lo: [0.006, 0.052, 0.098], hi: [0.011, 0.082, 0.147] },
  SHALLOW: { lo: [0.03, 0.14, 0.21], hi: [0.09, 0.30, 0.40] },
  SAND:    { lo: [0.66, 0.59, 0.42], hi: [0.86, 0.80, 0.63] },
  DESERT:  { lo: [0.58, 0.49, 0.30], hi: [0.80, 0.71, 0.49] },
  GRASS:   { lo: [0.25, 0.37, 0.16], hi: [0.49, 0.65, 0.31] },
  LUSH:    { lo: [0.18, 0.36, 0.14], hi: [0.38, 0.62, 0.27] },
  FOREST:  { lo: [0.10, 0.25, 0.13], hi: [0.22, 0.42, 0.22] },
  HILL:    { lo: [0.34, 0.35, 0.21], hi: [0.55, 0.56, 0.37] },
  MOUNT:   { lo: [0.33, 0.32, 0.31], hi: [0.60, 0.59, 0.57] },
  SNOW:    { lo: [0.72, 0.76, 0.80], hi: [0.94, 0.96, 0.98] },
  ASH:     { lo: [0.18, 0.16, 0.15], hi: [0.36, 0.33, 0.31] },
};

const mixc = (a: RGB, b: RGB, t: number): RGB =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function tileColor(t: Tile): RGB {
  const sk = SKIN[t.biome];
  let c: RGB;
  if (isWater(t.biome)) {
    c = mixc(sk.hi, sk.lo, Math.min(1, (SEA - t.h) / SEA * 1.6));
  } else {
    const f = Math.min(1, t.fert / Math.max(0.12, t.cap));
    c = mixc(sk.lo, sk.hi, 0.25 + f * 0.75);
    if (t.wet > 0.03) c = mixc(c, [0.16, 0.28, 0.34], Math.min(0.42, t.wet * 0.42));
    if (t.blight > 0.03) c = mixc(c, [0.55, 0.45, 0.28], Math.min(0.5, t.blight * 0.5));
    if (t.burn > 0.02) c = mixc(c, [0.72, 0.28, 0.10], Math.min(0.75, t.burn * 0.75));
  }
  const s = 0.93 + t.shade * 0.07;
  return [c[0] * s, c[1] * s, c[2] * s];
}

/** เกาะทั้งใบเป็น mesh เดียว: ตาราง (W+1)×(H+1) จุด ความสูงมาจาก tile.h ที่ตัวสร้างโลกผลิตอยู่แล้ว
 *  ซึ่งแปลว่าขึ้น 3 มิติได้โดยไม่ต้องแตะตัวสร้างโลกเลยสักบรรทัด */
export class Terrain3D {
  readonly group = new THREE.Group();
  readonly ground: THREE.Mesh;
  private geo = new THREE.BufferGeometry();
  private colors!: Float32Array;
  private version = -1;
  private tickStamp = -999;
  private trees?: THREE.InstancedMesh;
  private rocks?: THREE.InstancedMesh;
  /** รูปทรงของต้นไม้กับก้อนหิน มาถึงทีหลังเพราะโหลดจากไฟล์
   *  ระหว่างรอ ใช้กรวยกับทรงสิบสองหน้าไปก่อน เกาะจะได้ไม่โล่งตอนเปิดเกม */
  private propGeo: { tree?: THREE.BufferGeometry; rock?: THREE.BufferGeometry } = {};
  private lastState: GameState | null = null;
  readonly propsReady: Promise<void>;
  private water: Water3D;

  constructor(s: GameState) {
    const vw = W + 1, vh = H + 1;
    const pos = new Float32Array(vw * vh * 3);
    this.colors = new Float32Array(vw * vh * 3);
    const idxs: number[] = [];

    for (let y = 0; y < vh; y++) for (let x = 0; x < vw; x++) {
      const i = (y * vw + x) * 3;
      pos[i] = x; pos[i + 1] = this.cornerHeight(s, x, y); pos[i + 2] = y;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const a = y * vw + x, b = a + 1, c = a + vw, d = c + 1;
      idxs.push(a, c, b, b, c, d);
    }
    this.geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    this.geo.setIndex(idxs);

    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.ground = new THREE.Mesh(this.geo, mat);
    this.ground.receiveShadow = true;
    this.ground.castShadow = true;
    this.group.add(this.ground);

    this.water = new Water3D(s);
    this.group.add(this.water.mesh);

    this.propsReady = Promise.all([
      bakedGeometry(models.props.tree, models.props.tint).then((g) => { this.propGeo.tree = g; }),
      bakedGeometry(models.props.rock, models.props.tint).then((g) => { this.propGeo.rock = g; }),
    ]).then(() => {
      // รูปทรงมาถึงแล้ว ต้องปลูกใหม่ทั้งเกาะ ไม่งั้นจะยังเป็นกรวยอยู่จนกว่าชีวนิเวศจะเปลี่ยน
      if (this.lastState) this.buildProps(this.lastState);
    });

    this.refresh(s, true);
  }

  private cornerHeight(s: GameState, vx: number, vy: number): number {
    let sum = 0, n = 0;
    for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
      const t = tileAt(s.tiles, vx + dx, vy + dy);
      if (t) { sum += worldY(t.h); n++; }
    }
    return n ? sum / n : 0;
  }

  private cornerColor(s: GameState, vx: number, vy: number): RGB {
    let r = 0, g = 0, b = 0, n = 0;
    for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
      const t = tileAt(s.tiles, vx + dx, vy + dy);
      if (!t) continue;
      const c = tileColor(t);
      r += c[0]; g += c[1]; b += c[2]; n++;
    }
    return n ? [r / n, g / n, b / n] : [0, 0, 0];
  }

  /** สีเปลี่ยนบ่อย (ความอุดม ไฟ ดินเสีย) · ต้นไม้เปลี่ยนเฉพาะตอนชีวนิเวศเปลี่ยนจริง */
  update(s: GameState, time: number, daylight = 1) {
    if (s.tick - this.tickStamp >= 4 || s.terrainVersion !== this.version) {
      this.tickStamp = s.tick;
      this.refresh(s, s.terrainVersion !== this.version);
      this.version = s.terrainVersion;
    }
    this.water.update(s, time, daylight);
  }

  private refresh(s: GameState, rebuildProps: boolean) {
    this.lastState = s;
    const vw = W + 1;
    for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) {
      const c = this.cornerColor(s, x, y);
      const i = (y * vw + x) * 3;
      this.colors[i] = c[0]; this.colors[i + 1] = c[1]; this.colors[i + 2] = c[2];
    }
    (this.geo.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
    this.geo.computeVertexNormals();
    if (rebuildProps) this.buildProps(s);
  }

  /** ต้นไม้และก้อนหินเป็น InstancedMesh ก้อนเดียว วาดทีเดียวจบ ไม่ว่าจะมีกี่พัน */
  private buildProps(s: GameState) {
    for (const m of [this.trees, this.rocks]) if (m) { this.group.remove(m); m.dispose(); }

    // ห้ามปลูกต้นไม้ทับหมู่บ้าน — ต้นสนเต็มทรงบังกระท่อมจนมองไม่เห็นทั้งหมู่บ้าน
    // (ตอนเป็นกรวยผอมๆ ยังพอเห็นลอดได้ เลยไม่มีใครสังเกต จนเปลี่ยนมาใช้โมเดลจริง)
    const clearOf = (t: Tile) => !s.villages.some((v) => {
      const r = villageFootprint(v) + 0.6;
      return Math.hypot(v.x + 0.5 - (t.x + 0.5), v.y + 0.5 - (t.y + 0.5)) < r;
    });
    const treeTiles = s.tiles.filter((t) =>
      (t.biome === "FOREST" || (t.biome === "LUSH" && (t.x * 7 + t.y * 13) % 5 === 0)) && clearOf(t));
    const perTile = 3;
    // รูปทรงจากไฟล์มีสีอยู่ในจุดยอดแล้ว ตัวสำรองเป็นกรวยสีเดียวแบบเดิม
    const tgeo = this.propGeo.tree ?? (() => {
      const g = new THREE.ConeGeometry(0.22, 0.75, 6); g.translate(0, 0.38, 0); return g;
    })();
    const tmat = new THREE.MeshLambertMaterial(
      this.propGeo.tree ? { vertexColors: true } : { color: 0x2c5c34 });
    const trees = new THREE.InstancedMesh(tgeo, tmat, Math.max(1, treeTiles.length * perTile));
    trees.castShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    let n = 0;
    for (const t of treeTiles) {
      for (let k = 0; k < perTile; k++) {
        const hx = frac(t.x * 12.9898 + t.y * 78.233 + k * 3.1);
        const hz = frac(t.x * 39.346 + t.y * 11.135 + k * 7.7);
        const hs = frac(t.x * 5.1 + t.y * 9.3 + k * 2.2);
        const px = t.x + 0.15 + hx * 0.7, pz = t.y + 0.15 + hz * 0.7;
        const py = worldY(sampleH(s, px, pz));
        const scale = 0.75 + hs * 0.65;
        sc.set(scale, scale * (0.8 + hs * 0.5), scale);
        m.compose(new THREE.Vector3(px, py, pz), q, sc);
        trees.setMatrixAt(n++, m);
      }
    }
    trees.count = n;
    trees.instanceMatrix.needsUpdate = true;
    this.trees = trees;
    this.group.add(trees);

    const rockTiles = s.tiles.filter((t) => (t.biome === "MOUNT" || t.biome === "SNOW" || t.biome === "HILL")
      && (t.x * 5 + t.y * 3) % 3 === 0 && clearOf(t));
    const rgeo = this.propGeo.rock ?? new THREE.DodecahedronGeometry(0.26, 0);
    const rmat = new THREE.MeshLambertMaterial(
      this.propGeo.rock ? { vertexColors: true } : { color: 0x6b6a66, flatShading: true });
    const rocks = new THREE.InstancedMesh(rgeo, rmat, Math.max(1, rockTiles.length));
    rocks.castShadow = true;
    let rn = 0;
    for (const t of rockTiles) {
      const hx = frac(t.x * 3.7 + t.y * 8.1), hz = frac(t.x * 9.1 + t.y * 2.3);
      const px = t.x + 0.2 + hx * 0.6, pz = t.y + 0.2 + hz * 0.6;
      const scale = 0.7 + frac(t.x + t.y * 4.2) * 0.9;
      sc.set(scale, scale * 0.8, scale);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hx * 6.28);
      const lift = this.propGeo.rock ? 0 : 0.1;
      m.compose(new THREE.Vector3(px, worldY(sampleH(s, px, pz)) + lift, pz), q, sc);
      rocks.setMatrixAt(rn++, m);
    }
    rocks.count = rn;
    rocks.instanceMatrix.needsUpdate = true;
    this.rocks = rocks;
    this.group.add(rocks);
  }
}

const frac = (v: number) => v - Math.floor(v);

/** ความสูงที่จุดใดๆ บนเกาะ (ผสมสี่ช่องรอบตัว) — ใช้วางหมู่บ้าน สัตว์ และเอฟเฟกต์ */
export function sampleH(s: GameState, x: number, z: number): number {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const tx = x - x0, tz = z - z0;
  const at = (a: number, b: number) => tileAt(s.tiles, a, b)?.h ?? 0;
  const a = at(x0, z0) + (at(x0 + 1, z0) - at(x0, z0)) * tx;
  const b = at(x0, z0 + 1) + (at(x0 + 1, z0 + 1) - at(x0, z0 + 1)) * tx;
  return a + (b - a) * tz;
}
export const groundY = (s: GameState, x: number, z: number) => worldY(sampleH(s, x, z));
export { HEIGHT_SCALE };

const UP = /* @__PURE__ */ new THREE.Vector3(0, 1, 0);
const _n = /* @__PURE__ */ new THREE.Vector3();
const _qa = /* @__PURE__ */ new THREE.Quaternion();
const _qy = /* @__PURE__ */ new THREE.Quaternion();

/** เวกเตอร์ตั้งฉากกับผิวพื้นที่จุดนี้
 *  วัดความสูงสี่จุดรอบตัวแล้วหาความชัน ไม่ได้อ่านจาก normal ของ mesh
 *  เพราะ mesh ถูกทำให้เรียบ (`computeVertexNormals`) ค่าที่ได้จะนุ่มเกินจริง */
export function groundNormal(s: GameState, x: number, z: number, step = 0.4): THREE.Vector3 {
  const l = worldY(sampleH(s, x - step, z)), r = worldY(sampleH(s, x + step, z));
  const d = worldY(sampleH(s, x, z - step)), u = worldY(sampleH(s, x, z + step));
  return _n.set(l - r, 2 * step, d - u).normalize();
}

/** วางของให้ยืนบนพื้นโดยเอียงตามความชัน
 *
 *  ของทุกชิ้นในฉากเคยหมุนแค่แกน Y อย่างเดียว บนที่ราบไม่มีใครสังเกต
 *  แต่บนไหล่เขาทุกอย่างจะยืนตรงแหน่วขณะที่พื้นเอียง กระท่อมลอยข้างหนึ่ง สัตว์เหมือนลอยอยู่
 *
 *  `lean` คือเอียงตามพื้นแค่ไหน — คนยืนตรงกว่าพื้นเสมอ (คนจริงก็ทำแบบนั้น)
 *  ส่วนสิ่งปลูกสร้างเอียงตามพื้นมากกว่า เพราะมันถูกสร้างคร่อมความชันนั้นจริงๆ
 */
export function standOn(obj: THREE.Object3D, s: GameState,
                        x: number, z: number, facing: number, lean = 1): void {
  const n = groundNormal(s, x, z);
  _qa.setFromUnitVectors(UP, n);
  if (lean < 1) _qa.slerp(_qy.identity(), 1 - lean);
  _qy.setFromAxisAngle(UP, facing);
  obj.quaternion.copy(_qa).multiply(_qy);
}
