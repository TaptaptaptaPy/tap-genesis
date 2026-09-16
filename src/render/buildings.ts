import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { HUT_R } from "./layout";

/** กระท่อมของหมู่บ้าน — สร้างจากโค้ด ไม่ใช่ไฟล์โมเดล
 *
 *  ชุดโมเดลฟรีที่หาได้ไม่มีกระท่อมมุงจากเลยสักชุด (Kenney Survival Kit มีแต่โครงไม้
 *  Castle Kit เป็นหอคอยหิน) และของเดิมเป็นกล่องเหลี่ยมที่อ่านไม่ออกว่าเป็นบ้าน
 *
 *  ทรงที่ต้องการคือทรงของ Black & White: ผนังดินกลมเตี้ย หลังคาจากทรงกรวยสูง
 *  ชายคายื่นออกมาคลุมผนัง และมีประตูมืดๆ หนึ่งช่อง
 *  สามอย่างนี้คือสิ่งที่ทำให้ก้อนหนึ่งอ่านว่า "บ้าน" ไม่ใช่ "ก้อน"
 *
 *  สีฝังอยู่ในจุดยอด (vertexColors) เหมือนของประดับอื่นในเกม จะได้ใช้วัสดุตัวเดียว
 *  ทั้งหมู่บ้านและรวมเป็น mesh เดียวได้
 */

// ผนังกับหลังคาต้องต่างสีกันชัด ไม่งั้นทั้งหลังอ่านเป็นก้อนสีเดียว
// ดินสว่างอมชมพู หลังคาจากเหลืองฟาง — คู่สีที่อ่านออกแม้ตอนอยู่ไกล
const CLAY = new THREE.Color(0xc9a982);
const CLAY_DARK = new THREE.Color(0x9a7a56);
const THATCH = new THREE.Color(0xd8b968);
const THATCH_TIP = new THREE.Color(0x9c7c3e);
const DOOR = new THREE.Color(0x2e2419);

/** ทาสีให้จุดยอดทุกจุดของรูปทรงหนึ่ง โดยไล่สีตามความสูง
 *
 *  แปลงเป็นแบบไม่มี index ก่อนเสมอ — `mergeGeometries()` คืน null เงียบๆ
 *  ถ้าเอารูปทรงที่มี index ไปรวมกับรูปทรงที่ไม่มี (เช่น Cylinder กับ Icosahedron)
 *  แล้วบรรทัดถัดไปจะพังทั้งหน้าโดยไม่มีอะไรบอกว่าพังเพราะอะไร
 *  ผลพลอยได้: เหลี่ยมคมขึ้นเพราะจุดยอดไม่ถูกใช้ร่วมกัน ซึ่งเป็นสิ่งที่ต้องการอยู่แล้ว
 */
function paint(geo: THREE.BufferGeometry, low: THREE.Color, high: THREE.Color) {
  if (geo.index) { const flat = geo.toNonIndexed(); geo.dispose(); geo = flat; }
  const pos = geo.getAttribute("position");
  const col = new Float32Array(pos.count * 3);
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i); if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const span = Math.max(1e-6, maxY - minY);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.copy(low).lerp(high, (pos.getY(i) - minY) / span);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return geo;
}

/** กระท่อมหนึ่งหลัง สูงราว 1 หน่วย ฐานกว้างราว HUT_R*2 */
export function makeHut(seed = 0): THREE.BufferGeometry {
  const jitter = ((seed * 37) % 7) / 40;          // แต่ละหลังไม่เท่ากันเป๊ะ
  // ชายคายื่นออกไปถึง r*1.38 ทั้งหลังจึงกว้างราว r*2.76
  // ต้องแคบกว่า HUT_SPREAD (1.06) ไม่งั้นหลังคาซ้อนทับกันเป็นพืด
  const r = HUT_R * 0.68 * (0.92 + jitter);
  const parts: THREE.BufferGeometry[] = [];

  // ผนังดิน — ต้องสูงพอจะเห็นว่ามีผนัง ไม่งั้นทั้งหลังอ่านเป็นกรวยเปล่า
  // ลองครั้งแรกให้ผนัง 0.34 หลังคา 0.84 ผลคือเห็นแต่หลังคา
  const wallH = 0.42;
  const wall = new THREE.CylinderGeometry(r * 0.94, r, wallH, 12);
  wall.translate(0, wallH / 2, 0);
  parts.push(paint(wall, CLAY_DARK, CLAY));

  // หลังคาจาก — เตี้ยกว่าผนังนิดเดียว และชายคายื่นเลยผนังออกมา
  // ชายคาคือสิ่งที่ทำให้มันอ่านว่าเป็นหลังคา ไม่ใช่ฝาปิด
  const roofH = 0.46;
  const roof = new THREE.ConeGeometry(r * 1.3, roofH, 12);
  roof.translate(0, wallH + roofH / 2 - 0.02, 0);
  parts.push(paint(roof, THATCH, THATCH_TIP));

  // ขอบชายคาหนาอีกชั้น เห็นเป็นชั้นๆ เหมือนมุงจริง
  const eave = new THREE.CylinderGeometry(r * 1.3, r * 1.38, 0.09, 12);
  eave.translate(0, wallH - 0.01, 0);
  parts.push(paint(eave, THATCH_TIP, THATCH));

  // ประตู — ช่องมืดที่ทำให้รู้ว่าด้านไหนคือด้านหน้า และให้สเกลกับสายตา
  const door = new THREE.BoxGeometry(r * 0.5, wallH * 0.62, 0.06);
  door.translate(0, wallH * 0.31, r * 0.97);
  parts.push(paint(door, DOOR, DOOR));

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  merged.computeVertexNormals();
  return merged;
}

/** ยุ้งฉางกลางหมู่บ้าน — หลังใหญ่กว่าเพื่อนและมีเสายกพื้น
 *  หมู่บ้านที่มีแต่บ้านเหมือนกันหกหลังอ่านเป็น "กองของ" ไม่ใช่ "ชุมชน" */
export function makeGranary(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const r = HUT_R * 0.82;
  for (let i = 0; i < 4; i++) {
    const leg = new THREE.CylinderGeometry(0.035, 0.045, 0.22, 5);
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    leg.translate(Math.cos(a) * r * 0.6, 0.11, Math.sin(a) * r * 0.6);
    parts.push(paint(leg, CLAY_DARK, CLAY_DARK));
  }
  const body = new THREE.CylinderGeometry(r * 0.82, r * 0.9, 0.38, 10);
  body.translate(0, 0.41, 0);
  parts.push(paint(body, CLAY_DARK, CLAY));
  const roof = new THREE.ConeGeometry(r * 1.22, 0.4, 10);
  roof.translate(0, 0.6 + 0.2, 0);
  parts.push(paint(roof, THATCH, THATCH_TIP));

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  merged.computeVertexNormals();
  return merged;
}

// ───────────────────────── ของประดับบนเกาะ ─────────────────────────

const TRUNK = new THREE.Color(0x6b4a30);
const TRUNK_TOP = new THREE.Color(0x8a6340);
const LEAF = new THREE.Color(0x4e8a43);
const LEAF_TOP = new THREE.Color(0x76b25a);
const STONE = new THREE.Color(0x6e6a63);
const STONE_TOP = new THREE.Color(0x98938a);

/** ต้นไม้ใบกว้าง — ทรงพุ่มกลม ไม่ใช่ทรงกรวยแบบสน
 *
 *  เกาะของ Black & White เป็นเกาะเขตร้อน ต้นสนทำให้มันอ่านเป็นป่าเหนือ
 *  พุ่มกลมซ้อนกันสามก้อนให้เงาที่นุ่มกว่าและอ่านเป็นต้นไม้ได้แม้ตอนอยู่ไกลมาก
 *
 *  ต้องเป็นรูปทรงเดียวที่ใช้ซ้ำได้ทั้งเกาะ เพราะมันถูกวาดด้วย InstancedMesh
 *  (ต้นไม้บนเกาะมีเป็นร้อยต้น วาดทีละต้นไม่ไหว)
 */
export function makeTree(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.048, 0.075, 0.46, 6);
  trunk.translate(0, 0.23, 0);
  parts.push(paint(trunk, TRUNK, TRUNK_TOP));

  // พุ่มสามก้อนเยื้องกัน — ก้อนเดียวอ่านเป็นลูกบอลเสียบไม้
  const blobs: [number, number, number, number][] = [
    [0.00, 0.62, 0.00, 0.30],
    [0.13, 0.78, 0.06, 0.22],
    [-0.11, 0.74, -0.08, 0.19],
  ];
  for (const [x, y, z, r] of blobs) {
    const b = new THREE.IcosahedronGeometry(r, 1);
    b.scale(1, 0.86, 1);
    b.translate(x, y, z);
    parts.push(paint(b, LEAF, LEAF_TOP));
  }
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  merged.computeVertexNormals();
  return merged;
}

/** ก้อนหิน — ก้อนใหญ่ก้อนหนึ่งกับก้อนเล็กข้างๆ
 *  ก้อนเดียวโดดๆ อ่านเป็นเศษขยะ สองก้อนอ่านเป็นหินธรรมชาติ */
export function makeRock(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const big = new THREE.DodecahedronGeometry(0.26, 0);
  big.scale(1.15, 0.78, 1);
  big.translate(0, 0.16, 0);
  parts.push(paint(big, STONE, STONE_TOP));

  const small = new THREE.DodecahedronGeometry(0.13, 0);
  small.scale(1.1, 0.8, 1);
  small.translate(0.26, 0.07, 0.12);
  parts.push(paint(small, STONE, STONE_TOP));

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  merged.computeVertexNormals();
  return merged;
}
