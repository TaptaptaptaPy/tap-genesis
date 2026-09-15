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
  for (const clip of gltf.animations) actions[clip.name] = mixer.clipAction(clip);

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
