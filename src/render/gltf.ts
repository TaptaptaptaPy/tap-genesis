import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** โหลดโมเดลที่มีโครงกระดูกและท่าทางมาแล้ว
 *
 *  ทุกอย่างในฉากตอนนี้สร้างจากโค้ด (กรวย ทรงหลายหน้า ทรงกลม) ซึ่งเพดานมันอยู่แค่นี้
 *  สัตว์ที่ควรมีขาและมีท่าทางต้องมาจากไฟล์ที่ rig มาแล้ว ไฟล์นี้คือประตูบานนั้น
 *
 *  กติกา: `src/sim/` ห้ามเรียกไฟล์นี้เด็ดขาด — มันแตะ THREE ซึ่งแตะ DOM
 *  โหลดครั้งเดียวแล้วโคลนเอา ถ้าต้องใช้หลายตัว (`SkeletonUtils.clone` ไม่ใช่ `.clone()`)
 */
export interface Rigged {
  scene: THREE.Group;
  mixer: THREE.AnimationMixer;
  /** ชื่อท่า → ตัวควบคุมท่า ชื่อมาจากในไฟล์ ไม่ได้ตั้งเอง */
  actions: Record<string, THREE.AnimationAction>;
  play(name: string, fade?: number): void;
  update(dt: number): void;
}

export async function loadRigged(url: string): Promise<Rigged> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const scene = gltf.scene as THREE.Group;
  const mixer = new THREE.AnimationMixer(scene);
  const actions: Record<string, THREE.AnimationAction> = {};
  // ชุดของ Quaternius ใส่ท่าเดียวกันมาสองชื่อ: "Walk" กับ "AnimalArmature|Walk"
  // เก็บชื่อสั้นไว้ ชื่อยาวทิ้ง ไม่งั้นตารางท่าจะมีของซ้ำครึ่งหนึ่ง
  for (const clip of gltf.animations) {
    const bare = clip.name.includes("|") ? clip.name.split("|").pop()! : clip.name;
    if (!actions[bare]) actions[bare] = mixer.clipAction(clip);
  }

  let current: THREE.AnimationAction | null = null;
  return {
    scene, mixer, actions,
    play(name, fade = 0.25) {
      const next = actions[name];
      if (!next || next === current) return;
      next.reset().play();
      if (current) current.crossFadeTo(next, fade, false);
      current = next;
    },
    update(dt) { mixer.update(dt); },
  };
}

/** ชื่อท่าทั้งหมดที่ไฟล์นี้มี — ใช้ตอนสำรวจโมเดลใหม่ว่ามันทำอะไรได้บ้าง */
export const clipNames = (r: Rigged) => Object.keys(r.actions);

/** ย่อโมเดลให้สูงสุด 1 หน่วยโลก แล้วดันให้เท้าอยู่ที่ y = 0
 *
 *  ชุดโมเดลแต่ละชุดใช้หน่วยไม่เหมือนกันเลย (วัวตัวนี้ยาว 8 หน่วยในไฟล์)
 *  ถ้าไม่ปรับให้เป็นหน่วยเดียวกันก่อน การเปลี่ยนโมเดลทีหลังจะต้องไล่จูนเลขใหม่ทั้งหมด
 *  คืนค่าตัวคูณที่ใช้ เผื่อคนเรียกอยากรู้ */
export function normalise(scene: THREE.Object3D): number {
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const k = 1 / Math.max(size.x, size.y, size.z, 1e-6);
  scene.scale.setScalar(k);
  scene.updateMatrixWorld(true);
  const after = new THREE.Box3().setFromObject(scene);
  scene.position.y -= after.min.y;
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.castShadow = true; m.receiveShadow = false; }
  });
  return k;
}

/** เปลี่ยนวัสดุ PBR ของโมเดลให้เป็น Lambert แบบเดียวกับทั้งฉาก
 *
 *  โมเดลของ Quaternius แปลงมาจาก FBX/Phong ค่า PBR ข้างในจึงไม่ได้มีความหมายจริง
 *  (`extras.fromFBX.isTruePBR: false`) แต่ `metallicFactor` ติดมา 0.4
 *  ผิวที่เป็นโลหะต้องการ environment map ถึงจะมีอะไรให้สะท้อน ฉากนี้ไม่มี
 *  ผลคือสีหายไป 40% ตัวสัตว์เลยออกมาเกือบดำทั้งที่สีพื้นเป็นน้ำตาล
 *
 *  แปลงเป็น Lambert เลยดีกว่าไล่ปิด metalness ทีละตัว เพราะทั้งเกาะใช้ Lambert อยู่แล้ว
 *  ถ้าปล่อยให้สัตว์เป็น PBR ตัวเดียว แสงจะไม่เข้ากับอย่างอื่นบนจอ
 */
export function flattenToLambert(scene: THREE.Object3D): void {
  const seen = new Map<THREE.Material, THREE.MeshLambertMaterial>();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const src = Array.isArray(m.material) ? m.material : [m.material];
    const out = src.map((old) => {
      let lam = seen.get(old);
      if (!lam) {
        const std = old as THREE.MeshStandardMaterial;
        lam = new THREE.MeshLambertMaterial({
          color: std.color ? std.color.clone() : new THREE.Color(0xffffff),
          map: std.map ?? null,
          vertexColors: std.vertexColors ?? false,
          side: std.side,
          transparent: std.transparent,
          opacity: std.opacity,
        });
        seen.set(old, lam);
      }
      return lam;
    });
    m.material = Array.isArray(m.material) ? out : out[0];
  });
}

/** รวมโมเดลทั้งไฟล์ให้เหลือรูปทรงเดียวที่เก็บสีไว้ในจุดยอด
 *
 *  ต้นไม้ของ Kenney หนึ่งต้นมีสองชิ้น (ลำต้นกับใบ) คนละวัสดุ
 *  ถ้าวาดตรงๆ จะได้สองครั้งต่อหนึ่งต้น พอมีเป็นพันต้นก็จบเห่
 *  ทางแก้คือย้ายสีของวัสดุไปเป็นสีของจุดยอด แล้วเชื่อมทุกชิ้นเป็นก้อนเดียว
 *  จากนั้นทั้งป่าจะวาดครั้งเดียวด้วย InstancedMesh เหมือนกรวยที่ใช้อยู่เดิม
 *
 *  ผลข้างเคียงที่ตั้งใจ: สีติดมากับรูปทรง ไม่ต้องมานั่งกำหนดสีเองในโค้ดอีก
 */
export async function bakedGeometry(
  url: string,
  tint: Record<string, string> = {},
): Promise<THREE.BufferGeometry> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const parts: THREE.BufferGeometry[] = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
    g.deleteAttribute("uv");
    g.deleteAttribute("uv1");
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    // สีที่มากับไฟล์ไม่ได้เข้ากับจานสีของเกาะเสมอไป ทับตามชื่อวัสดุได้
    // (ชุด Nature Kit ให้ใบไม้เป็นฟ้าอมเขียวและเปลือกไม้เป็นส้มอ่อน)
    const over = tint[mat?.name ?? ""];
    const col = over ? new THREE.Color(over) : (mat?.color ?? new THREE.Color(0xffffff));
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
    g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    parts.push(g);
  });
  if (parts.length === 0) throw new Error("ไม่มี mesh ใน " + url);
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error("เชื่อมรูปทรงไม่สำเร็จ: " + url);

  // ย่อให้สูง 1 หน่วยและฐานอยู่ที่ y = 0 เหมือน normalise() ของโมเดลมีกระดูก
  merged.computeBoundingBox();
  const b = merged.boundingBox!;
  const k = 1 / Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z, 1e-6);
  merged.scale(k, k, k);
  merged.computeBoundingBox();
  merged.translate(0, -merged.boundingBox!.min.y, 0);
  merged.computeVertexNormals();
  return merged;
}
