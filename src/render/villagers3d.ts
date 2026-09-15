import * as THREE from "three";
import type { Folk, GameState, Village } from "../sim/types";
import { groundY } from "./terrain3d";

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

/** จำนวนช่องคนสูงสุดที่วาดได้ทั้งเกาะ — `folk.maxPerVillage` × จำนวนหมู่บ้านสูงสุดพอดี */
const MAX_BODIES = 96;

/** ผ้าย้อมสีเดียวกันทั้งหมู่บ้านดูตาย — ผูกสีกับหมายเลขช่องเพื่อไม่ให้กระพริบทุกเฟรม */
const CLOTH = [0x9a5340, 0x4d5f80, 0x8a6f2a, 0x6d4a63, 0xb0674a, 0x56705a];

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

  /** `dt` มาจาก FixedLoop ซึ่งคูณความเร็วเกมมาแล้ว — ใช้กับการแกว่งขาเท่านั้น
   *  ตำแหน่งของคนมาจาก `v.folk` ใน `src/sim/` ตรงๆ แล้ว ไม่ได้คำนวณเองที่นี่อีก
   *  เดิมที่นี่เดาตำแหน่งด้วยแฮช ทำให้คนบนจอไม่ใช่คนเดียวกับคนที่มืออาจหยิบขึ้นมา */
  update(s: GameState, dt: number) {
    this.clock += dt;
    let k = 0;

    for (const v of s.villages) {
      for (const f of v.folk) {
        if (k >= MAX_BODIES) break;
        this.place(s, v, f, k++);
      }
    }

    for (; k < MAX_BODIES; k++) this.hide(k);

    this.body.instanceMatrix.needsUpdate = true;
    this.head.instanceMatrix.needsUpdate = true;
    this.load.instanceMatrix.needsUpdate = true;
  }

  private place(s: GameState, v: Village, f: Folk, k: number) {
    const dx = f.tx - f.x, dy = f.ty - f.y;
    const dist = Math.hypot(dx, dy);
    const moving = f.rest <= 0 && dist > 0.12;
    const face = moving ? Math.atan2(dy, dx) : Math.atan2(f.y - (v.y + 0.5), f.x - (v.x + 0.5));

    let lift = 0, squat = 1, lean = 0, carrying = false;
    const phase = f.id * 0.7;

    if (f.job === "sick") {
      squat = 0.6; lean = 0.3;
      lift = Math.sin(this.clock * 0.9 + phase) * 0.012;
    } else if (f.job === "pray") {
      const bow = (Math.sin(this.clock * 1.6 + phase) + 1) * 0.5;
      lean = bow * 0.55;
      squat = 1 - bow * 0.16;
      lift = bow * 0.03;
    } else if (moving) {
      lean = 0.13;
      lift = Math.abs(Math.sin(this.clock * 7 + phase * 3)) * 0.04;
      // ขากลับบ้านคือขาที่มีของอยู่บนหัว
      const homeward = Math.hypot(f.tx - (v.x + 0.5), f.ty - (v.y + 0.5)) < 1.1;
      carrying = homeward && (f.job === "farm" || f.job === "wood");
    } else if (f.job === "idle") {
      lean = Math.sin(this.clock * 0.5 + phase) * 0.06;
    }

    const y = groundY(s, f.x, f.y) + lift;
    const heading = Math.atan2(Math.cos(face), Math.sin(face));
    const d = this.dummy;

    d.position.set(f.x, y, f.y);
    d.rotation.set(lean, heading, 0);
    d.scale.set(1, squat, 1);
    d.updateMatrix();
    this.body.setMatrixAt(k, d.matrix);

    const neck = 0.36 * squat;
    const hx = f.x + Math.cos(face) * Math.sin(lean) * neck;
    const hz = f.y + Math.sin(face) * Math.sin(lean) * neck;
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
