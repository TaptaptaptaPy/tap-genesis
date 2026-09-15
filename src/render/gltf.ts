import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

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
