import * as THREE from "three";
import type { GameState, Village } from "../sim/types";
import { groundY } from "./terrain3d";
import { villageFootprint } from "./actors3d";
import balance from "../../data/balance.json";

/** ชาวบ้านที่มองเห็นได้
 *
 *  เดิมหมู่บ้านคือกระท่อม 1-6 หลังกับ `v.pop` ที่เป็นเลขทศนิยม เกมขอให้ผู้เล่นแคร์
 *  "ผู้คน" ที่ไม่เคยเห็นหน้าสักคน พอมีตัวให้เห็น ประโยค "หมู่บ้านอรุณขาดอาหาร"
 *  ก็เปลี่ยนจากข้อความบนจอเป็นภาพคนยืนเอ๋ออยู่กลางไร่ที่แห้ง
 *
 *  ทุกอย่างในไฟล์นี้อยู่ใน src/render/ ล้วน ตำแหน่งทุกตัวคำนวณสดจาก state ของหมู่บ้าน
 *  (ประชากร · ความต้องการ · โรคระบาด · ความทรงจำถึงปาฏิหาริย์) ไม่มี state เป็นของตัวเอง
 *  จึงไม่ต้องเซฟ ไม่ต้องแก้ `src/sim/` และ `npm run sim` ไม่กระทบเลยสักบรรทัด
 */

/** จำนวนตัวสูงสุดทั้งเกาะ — เกินกว่านี้ตาเปล่าก็แยกไม่ออกแล้ว แต่ GPU ยังต้องวาด */
const MAX_BODIES = 96;
/** ต่อหนึ่งหมู่บ้าน ป้องกันไม่ให้หมู่บ้านใหญ่กินโควตาของทุกหมู่บ้านที่เหลือ */
const PER_VILLAGE = 16;
/** ประชากรกี่คนต่อหนึ่งตัวที่วาด — หนึ่งตัวแทนคนกลุ่มหนึ่ง ไม่ใช่หนึ่งคน */
const POP_PER_BODY = 3;
/** ไปกลับหนึ่งรอบใช้เวลากี่วินาที (ตามเวลาเกม จึงเร็วขึ้นตอนกด 2× / 4×) */
const ROUND_TRIP_SECONDS = 13;
/** ความต้องการต่ำกว่านี้ถือว่าหมู่บ้านไม่มีอะไรให้ทำ คนจะยืนรอแทนที่จะออกไปทำงาน */
const IDLE_BELOW = 0.5;
/** ความทรงจำถึงปาฏิหาริย์สูงกว่านี้ คนจะมารวมกันกลางหมู่บ้านเพื่อบูชา */
const PRAY_ABOVE = 0.35;
/** รัศมีที่หมู่บ้านเก็บเกี่ยวจริง อ่านจาก balance.json ไม่ใช่เดาเอง
 *
 *  ข้อควรรู้: พอหมู่บ้านโตเต็มที่ กลุ่มกระท่อมกินรัศมีราว 1.7 ขณะที่ workRadius มีแค่ 2
 *  หมู่บ้านจึงเกือบกลืนไร่ของตัวเองหมด ระยะเดินข้างล่างเลยต้องอิงขอบกระท่อมเป็นหลัก
 *  ไม่งั้นคนจะเดินอยู่ในหลังคาตัวเอง ถ้าวันหนึ่งแก้สเกลตรงนี้ ให้กลับมาดูค่านี้ด้วย */
const WORK_RADIUS = balance.village.workRadius;

/** ผ้าย้อมสีเดียวกันทั้งหมู่บ้านดูตาย — แต่ต้องคงที่ต่อช่อง ไม่งั้นสีจะกระพริบทุกเฟรม
 *  เคยใช้โทนครีม แล้วตัวคนกลืนหายไปกับเนินที่โดนแดดจนเหลือแต่หัวกับของที่แบกลอยอยู่
 *  สีผ้าต้องเข้มและอิ่มพอจะตัดกับทั้งหญ้าสว่างและป่าทึบ */
const CLOTH = [0x9a5340, 0x4d5f80, 0x8a6f2a, 0x6d4a63, 0xb0674a, 0x56705a];

/** ค่าสุ่มที่ซ้ำได้จากเลขจำนวนเต็ม — ใช้แทน Math.random() เพื่อให้ตัวเดิมยืนที่เดิมทุกเฟรม */
function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** คลื่นสามเหลี่ยม 0→1→0 คาบ 2 — เดินไปแล้วเดินกลับโดยไม่ต้องเก็บทิศไว้ */
const triangle = (t: number) => { const u = ((t % 2) + 2) % 2; return u > 1 ? 2 - u : u; };

type Mood = "work" | "idle" | "pray" | "sick";

export class Villagers3D {
  readonly group = new THREE.Group();
  private body: THREE.InstancedMesh;
  private head: THREE.InstancedMesh;
  private load: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private clock = 0;

  /** หันหัวก่อน (Y) แล้วค่อยเอนตัวไปข้างหน้า (X) — ลำดับ XYZ ปกติจะเอนผิดทาง */
  private readonly ORDER = "YXZ" as const;

  constructor() {
    // กระท่อมสูงราว 1.3 หน่วยตอนหมู่บ้านโตเต็มที่ คนจึงต้องสูงราว 0.45
    // ถึงจะได้สัดส่วนบ้านต่อคนประมาณ 3:1 แบบบ้านจริง
    const bodyGeo = new THREE.ConeGeometry(0.10, 0.34, 6);
    bodyGeo.translate(0, 0.17, 0);
    const headGeo = new THREE.SphereGeometry(0.065, 8, 6);
    const loadGeo = new THREE.BoxGeometry(0.13, 0.11, 0.13);

    // สีขาวเป็นฐาน เพราะ instanceColor ของ InstancedMesh คูณทับสีของวัสดุอีกที
    this.body = new THREE.InstancedMesh(bodyGeo,
      new THREE.MeshLambertMaterial({ color: 0xffffff }), MAX_BODIES);
    this.head = new THREE.InstancedMesh(headGeo,
      new THREE.MeshLambertMaterial({ color: 0x8a6f58 }), MAX_BODIES);
    this.load = new THREE.InstancedMesh(loadGeo,
      new THREE.MeshLambertMaterial({ color: 0x7c8f5a }), MAX_BODIES);

    for (const m of [this.body, this.head, this.load]) {
      m.castShadow = true;
      m.frustumCulled = false;   // ตัวเล็กมาก กล่องขอบเขตของ instance คำนวณผิดง่าย
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
    }

    // สีเสื้อผูกกับหมายเลขช่อง ไม่ใช่กับตัวคน เพื่อไม่ให้สีสลับตอนประชากรขึ้นลง
    this.dummy.rotation.order = this.ORDER;
    for (let i = 0; i < MAX_BODIES; i++)
      this.body.setColorAt(i, new THREE.Color(CLOTH[i % CLOTH.length]));
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
  }

  /** `dt` มาจาก FixedLoop ซึ่งคูณความเร็วเกมมาแล้ว ใช้ `dt` ไม่ใช่ `performance.now()`
   *  ไม่งั้นกด 4× โลกจะเดินเร็วขึ้นแต่คนยังเดินเท่าเดิม */
  update(s: GameState, dt: number) {
    this.clock += dt;
    let k = 0;

    for (const v of s.villages) {
      const n = Math.min(PER_VILLAGE, Math.max(1, Math.round(v.pop / POP_PER_BODY)));
      const mood: Mood = v.plague > 0 ? "sick"
        : v.awe > PRAY_ABOVE ? "pray"
        : Math.min(v.needs.food, v.needs.wood) < IDLE_BELOW ? "idle"
        : "work";

      for (let i = 0; i < n && k < MAX_BODIES; i++, k++)
        this.place(s, v, i, k, mood);
    }

    for (; k < MAX_BODIES; k++) this.hide(k);

    this.body.instanceMatrix.needsUpdate = true;
    this.head.instanceMatrix.needsUpdate = true;
    this.load.instanceMatrix.needsUpdate = true;
  }

  private place(s: GameState, v: Village, i: number, k: number, mood: Mood) {
    const cx = v.x + 0.5, cz = v.y + 0.5;
    const a = hash(v.id * 977 + i * 31) * Math.PI * 2;
    const pace = 0.7 + hash(v.id * 7919 + i * 17) * 0.7;
    const phase = hash(v.id * 61 + i * 409) * 2;

    // กลุ่มกระท่อมกินรัศมีถึงราว 1.5 หน่วยตอนหมู่บ้านใหญ่ คนที่ยืนนิ่งต้องอยู่นอกนั้น
    // ไม่งั้นหมู่บ้านยิ่งโต ยิ่งกลืนคนของตัวเองจนมองไม่เห็นสักคน
    // ยืนชิดขอบกลุ่มกระท่อมเสมอ หมู่บ้านโตแค่ไหนก็ยังเห็นคนของมัน
    const ring = villageFootprint(v) + 0.35;
    const far = ring + 0.5 + hash(v.id * 131 + i * 613) * WORK_RADIUS * 0.75;

    let x = cx, z = cz, face = a, lift = 0, squat = 1, lean = 0, carrying = false;

    if (mood === "work") {
      // ออกไปทำกินที่ช่องรอบๆ แล้วแบกกลับ — ขากลับคือขาที่มีของอยู่บนหัว
      const u = this.clock * (2 / ROUND_TRIP_SECONDS) * pace + phase;
      const t = triangle(u);
      const outward = t >= triangle(u - 0.01);
      const home = ring * 0.6;
      const r = home + (far - home) * t;
      x = cx + Math.cos(a) * r;
      z = cz + Math.sin(a) * r;
      face = outward ? a : a + Math.PI;
      lean = 0.13;
      lift = Math.abs(Math.sin(this.clock * 7 * pace + phase * 9)) * 0.04;
      carrying = !outward && t > 0.12;
    } else if (mood === "idle") {
      // ไม่มีอะไรให้ทำ ยืนเก้ๆ กังๆ อยู่ขอบหมู่บ้าน หันหน้าออกไปทางไร่ที่แห้ง
      const r = ring + hash(v.id * 53 + i * 907) * 0.6;
      x = cx + Math.cos(a) * r;
      z = cz + Math.sin(a) * r;
      face = a + Math.sin(this.clock * 0.5 + phase * 3) * 0.5;
    } else if (mood === "pray") {
      // เพิ่งเห็นปาฏิหาริย์ มายืนเป็นวงแล้วโค้งให้กลางหมู่บ้าน
      x = cx + Math.cos(a) * ring;
      z = cz + Math.sin(a) * ring;
      face = a + Math.PI;
      const bow = (Math.sin(this.clock * 1.6 + phase * 2) + 1) * 0.5;
      lean = bow * 0.55;
      squat = 1 - bow * 0.16;
      lift = bow * 0.03;
    } else {
      // โรคระบาด นั่งซมอยู่ขอบกระท่อม ไม่ไปไหนทั้งวัน
      const r = ring * 0.85;
      x = cx + Math.cos(a) * r;
      z = cz + Math.sin(a) * r;
      face = a;
      squat = 0.6;
      lean = 0.3;
      lift = Math.sin(this.clock * 0.9 + phase * 5) * 0.012;
    }

    const y = groundY(s, x, z) + lift;
    const heading = Math.atan2(Math.cos(face), Math.sin(face));
    const d = this.dummy;

    d.position.set(x, y, z);
    d.rotation.set(lean, heading, 0);
    d.scale.set(1, squat, 1);
    d.updateMatrix();
    this.body.setMatrixAt(k, d.matrix);

    // หัวต้องขยับตามตัวที่เอน ไม่งั้นจะลอยหลุดออกจากบ่าตอนโค้ง
    const neck = 0.36 * squat;
    const hx = x + Math.cos(face) * Math.sin(lean) * neck;
    const hz = z + Math.sin(face) * Math.sin(lean) * neck;
    const hy = y + Math.cos(lean) * neck;
    d.position.set(hx, hy, hz);
    d.scale.setScalar(1);
    d.updateMatrix();
    this.head.setMatrixAt(k, d.matrix);

    if (carrying) {
      d.position.set(hx, hy + 0.12, hz);
      d.updateMatrix();
    } else {
      d.scale.setScalar(0);
      d.updateMatrix();
      d.scale.setScalar(1);
    }
    this.load.setMatrixAt(k, d.matrix);
  }

  private hide(k: number) {
    const d = this.dummy;
    d.position.set(0, -50, 0);
    d.rotation.set(0, 0, 0);
    d.scale.setScalar(0);
    d.updateMatrix();
    this.body.setMatrixAt(k, d.matrix);
    this.head.setMatrixAt(k, d.matrix);
    this.load.setMatrixAt(k, d.matrix);
    d.scale.setScalar(1);
  }
}
