import * as THREE from "three";
import type { GameState } from "../sim/types";
import { groundY } from "./terrain3d";

/** มือของพระเจ้า
 *
 *  ของที่ห่างจาก Black & White มากที่สุดคือข้อนี้ เดิมตัวชี้เป็นวงรีแบนบนพื้น
 *  มือของ B&W ไม่ใช่ของประดับ มันคือ *ทั้งอินเทอร์เฟซ* — ทุกอย่างเกิดผ่านมือเดียว
 *  ที่นี่ยังไม่ได้หยิบทุกอย่างได้เหมือนต้นฉบับ แต่มันลอยอยู่เหนือจุดที่ท่านชี้
 *  กำมือตอนเล็งคาถา และยกสัตว์ไปวางที่อื่นได้จริง
 *
 *  ทั้งไฟล์อยู่ใน src/render/ ล้วน ไม่มีตรรกะเกมสักบรรทัด
 */

const SKIN = 0xf0dfb8;
const DARK_SKIN = 0xd8a58e;

function finger(len: number, thick: number) {
  const g = new THREE.CapsuleGeometry(thick, len, 3, 6);
  g.translate(0, len / 2 + thick, 0);
  return g;
}

export class Hand3D {
  readonly root = new THREE.Group();
  private palm: THREE.Mesh;
  private digits: THREE.Group[] = [];
  private mat: THREE.MeshLambertMaterial;
  /** 0 = แบมือ, 1 = กำแน่น */
  private grip = 0;
  private targetGrip = 0;
  private hover = new THREE.Vector3();
  private lift = 0;

  constructor() {
    this.mat = new THREE.MeshLambertMaterial({ color: SKIN, transparent: true, opacity: 0.94 });

    // ฝ่ามือเป็นทรงกลมแบน ไม่ใช่กล่อง — กล่องอ่านออกเป็น "แผ่นไม้" ทันทีที่เห็นมุมฉาก
    const palmGeo = new THREE.SphereGeometry(0.42, 16, 12);
    palmGeo.scale(0.82, 0.38, 1.0);
    palmGeo.translate(0, 0, 0.08);
    this.palm = new THREE.Mesh(palmGeo, this.mat);
    this.root.add(this.palm);

    // สี่นิ้วเรียงหน้าฝ่ามือ บวกนิ้วโป้งที่กางออกข้าง
    // นิ้วกางออกเป็นพัดและยาวไม่เท่ากัน ถ้าเรียงขนานยาวเท่ากันจะอ่านออกเป็น "คราด" ไม่ใช่มือ
    const layout: [number, number, number, number][] = [
      [-0.235, 0.5, 0.2, 0.1],
      [-0.082, 0.62, 0.07, 0.108],
      [0.082, 0.58, -0.07, 0.105],
      [0.228, 0.45, -0.22, 0.095],
    ];
    for (const [x, len, spread, thick] of layout) {
      const g = new THREE.Group();
      const m = new THREE.Mesh(finger(len, thick), this.mat);
      m.rotation.x = Math.PI / 2;
      // ปลายนิ้วงุ้มลงเล็กน้อยแม้ตอนแบมือ มือคนไม่เคยเหยียดตรงเป๊ะ
      m.position.z = 0.02;
      g.add(m);
      g.position.set(x, -0.02, 0.34);
      g.rotation.set(0.12, spread, 0);
      this.digits.push(g);
      this.root.add(g);
    }
    const thumb = new THREE.Group();
    const tm = new THREE.Mesh(finger(0.44, 0.125), this.mat);
    tm.rotation.x = Math.PI / 2;
    thumb.add(tm);
    thumb.position.set(-0.36, 0.02, 0.02);
    thumb.rotation.set(0.3, 1.0, 0);
    this.digits.push(thumb);
    this.root.add(thumb);

    this.root.visible = false;
    // เกาะกว้าง 24 หน่วยและกล้องอยู่ห่าง ~34 มือขนาดจริงจะเล็กจนไม่มีใครเห็น
    // ใน B&W มือก็ใหญ่เกินจริงเหมือนกัน เพราะมันคือตัวแทนของผู้เล่น ไม่ใช่วัตถุในฉาก
    this.root.scale.setScalar(2.4);
  }

  /** กำมือตอนเล็งคาถา — บอกด้วยรูปมือว่ากำลังจะทำอะไร ไม่ต้องอ่านข้อความ */
  setGrip(closed: boolean) { this.targetGrip = closed ? 1 : 0; }

  /** มือแดงขึ้นเมื่อสิ่งที่กำลังจะร่ายเป็นคาถาดำ */
  setDark(dark: boolean) { this.mat.color.setHex(dark ? DARK_SKIN : SKIN); }

  hide() { this.root.visible = false; }

  /** วางมือไว้เหนือช่องที่ชี้อยู่ `carry` = กำลังยกอะไรอยู่ มือจะลดต่ำลงไปใกล้พื้น */
  update(s: GameState, tile: { x: number; y: number } | null, dt: number, time: number, carry = false) {
    if (!tile) { this.root.visible = false; return; }
    this.root.visible = true;

    const gx = tile.x + 0.5, gz = tile.y + 0.5;
    const gy = groundY(s, gx, gz);
    this.hover.lerp(new THREE.Vector3(gx, gy, gz), Math.min(1, dt * 14));

    this.grip += (this.targetGrip - this.grip) * Math.min(1, dt * 12);
    this.lift += ((carry ? 1.1 : 2.2) - this.lift) * Math.min(1, dt * 8);

    const bob = Math.sin(time * 0.0016) * 0.06;
    this.root.position.set(this.hover.x, this.hover.y + this.lift + bob, this.hover.z);
    // เอียงลงราว 45 องศา เห็นทั้งหลังมือและปลายนิ้วที่ชี้ลงพื้น
    this.root.rotation.set(-0.8 + this.grip * 0.3, Math.sin(time * 0.0009) * 0.12, 0);

    // นิ้วงอเข้าหาฝ่ามือตามค่ากำ นิ้วโป้งงอน้อยกว่าเพื่อนเหมือนมือจริง
    this.digits.forEach((d, i) => {
      const last = i === this.digits.length - 1;
      d.rotation.x = this.grip * (last ? 0.85 : 1.35) + (last ? 0 : 0.05 * i);
    });
  }
}
