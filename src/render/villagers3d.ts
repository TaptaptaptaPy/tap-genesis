import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { loadRigged, flattenToLambert, normalise, type Rigged } from "./gltf";
import models from "../../data/models.json";
import type { Folk, GameState, Village } from "../sim/types";
import { groundY, standOn } from "./terrain3d";

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

/** ความสูงของชาวบ้าน *เป็นหน่วยโลกจริงๆ* — กระท่อมสูง 0.86 ก่อนคูณ `villageGrow`
 *  อัตราส่วนบ้านต่อคนราว 3:1 คือสิ่งที่ทำให้กลุ่มกระท่อมอ่านออกว่าเป็นหมู่บ้าน
 *
 *  ของเดิมเขียนว่า 0.34 โดยคิดว่า `normalise()` ย่อโมเดลให้สูง 1 หน่วยไปแล้ว
 *  แต่บรรทัดถัดมา `root.scale.setScalar(FOLK_SCALE)` **เขียนทับ** ตัวคูณของ normalise ทิ้ง
 *  (`cloneSkeleton` ก๊อป scale ติดมาด้วย แล้ว setScalar ก็ทับมันทั้งก้อน)
 *  ผลคือ 0.34 ไปคูณกับหน่วยดิบของไฟล์ ชาวบ้านจึงสูง 0.87 — **เท่ากับหลังคาบ้านตัวเอง**
 *  นี่คือที่มาของ "สัดส่วนคนกับเกาะดูแปลกๆ" และเป็นเหตุผลที่สัตว์ดูตัวเล็กไปด้วย
 *  ทั้งที่ขนาดของสัตว์ไม่เคยผิด (วัดได้ 0.77 ซึ่งพอดีกับที่ตั้งใจ) */
const FOLK_HEIGHT = 0.30;

/** สีผ้าย้อมธรรมชาติ — ดินแดง คราม ขมิ้น ครั่ง ใบไม้ เปลือกไม้
 *  ผูกสีกับหมายเลขช่อง ไม่ใช่กับตัวคน เพื่อไม่ให้สีสลับตอนประชากรขึ้นลง
 *
 *  ชุดสีนี้เคยถูกใช้กับกรวยสำรองเท่านั้น ซึ่งถูกซ่อนทิ้งทันทีที่โมเดลคนมาถึง
 *  แปลว่าตลอดเวลาที่ผ่านมาทั้งเกาะใส่เสื้อสีเดียวกันหมดทุกคน แก้สีตรงนี้ก็ไม่มีอะไรเกิดขึ้น
 *  ตอนนี้มันถูกทาลงบนร่างจริงแล้ว (ดู `dress()`) */
const CLOTH = [0xc2694a, 0x5c7ba6, 0xd6a63f, 0x9c5570, 0xd9825a, 0x6f9468];

/** ชิ้นส่วนที่นับเป็น "เสื้อผ้า" — ชื่อมาจากไฟล์ของ Kenney ตรงๆ
 *  หัวไม่อยู่ในนี้ เพราะหัวคือหน้ากับผมซึ่งมาจากเท็กซ์เจอร์ ทับสีแล้วจะเพี้ยนทั้งใบ */
const SHIRT = ["torso", "arm-left", "arm-right"];
const TROUSER = ["leg-left", "leg-right"];

export class Villagers3D {
  readonly group = new THREE.Group();
  private body: THREE.InstancedMesh;
  private head: THREE.InstancedMesh;
  private load: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private clock = 0;

  /** คนจริงที่มีท่าทาง — มาถึงทีหลัง ระหว่างรอใช้กรวยกับทรงกลมแบบเดิมไปก่อน
   *  หนึ่งคนหนึ่งร่าง เพราะแต่ละคนทำงานคนละอย่างจึงเล่นคนละท่า
   *  InstancedMesh ทำแบบนั้นไม่ได้ มันวาดรูปทรงเดียวกันทุกตัว */
  private rigSrc: Rigged | null = null;
  /** ตัวคูณที่ทำให้โมเดลสูง `FOLK_HEIGHT` พอดี — คิดครั้งเดียวตอนโหลด */
  private rigScale = 1;
  /** ระยะยกให้ฝ่าเท้าอยู่ที่พื้นพอดี — `normalise()` คิดไว้แล้ว แต่เราเขียนทับ `position` ทุกเฟรม */
  private rigLift = 0;
  /** วัสดุเสื้อผ้าหกสี × สองชิ้น ใช้ร่วมกันทั้งเกาะ — ดู `dress()` ว่าทำไมห้ามโคลนต่อคน */
  private cloth = new Map<string, THREE.MeshLambertMaterial>();
  private bodies: { root: THREE.Object3D; rig: Rigged; clip: string; facing: number }[] = [];
  readonly ready: Promise<void>;

  /** หันหัวก่อน (Y) แล้วค่อยเอนตัวไปข้างหน้า (X) — ลำดับ XYZ ปกติจะเอนผิดทาง */
  private readonly ORDER = "YXZ" as const;

  /** ร่างที่กำลังวาดอยู่จริง — เทสต์ภาพต้องเล็งกล้องไปที่ตัวจริง ไม่ใช่พิกัดจาก state
   *  เพราะความสูงของพื้นใต้เท้าอยู่ในชั้นภาพ ไม่ได้อยู่ใน state */
  get roots(): THREE.Object3D[] {
    return this.bodies.filter((b) => b.root.visible).map((b) => b.root);
  }

  /** หยุดท่าทางไว้ที่วินาทีที่กำหนด — มีไว้ให้เทสต์ภาพเท่านั้น
   *  ท่าของทุกคนเดินต่อทุกเฟรมแม้เวลาของเกมจะหยุด (ลูปวาดภาพไม่ได้หยุดไปด้วย)
   *  ภาพระยะใกล้จึงไม่มีวันได้ท่าเดิมสองรอบติด แล้วเทสต์จะล้มแบบสุ่มไปตลอด */
  freezeAt: number | null = null;

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

    this.ready = loadRigged(models.folk.file).then((r) => {
      normalise(r.scene);
      flattenToLambert(r.scene);
      // `normalise()` ย่อให้ด้านยาวสุดเป็น 1 หน่วย ซึ่งของคนยืนคือ *ความสูง*
      // ตัวคูณของมันอยู่ที่ `scene.scale` ต้องคูณต่อ ไม่ใช่ทับทิ้ง
      this.rigScale = r.scene.scale.x * FOLK_HEIGHT;
      this.rigLift = r.scene.position.y * FOLK_HEIGHT;
      this.rigSrc = r;
      // ซ่อนทรงเดิม ไม่ลบทิ้ง เผื่อวันไหนอยากเทียบว่าแบบไหนเร็วกว่า
      for (const m of [this.body, this.head, this.load]) m.visible = false;
    });
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
        if (this.rigSrc) this.placeBody(s, v, f, k++, dt);
        else this.place(s, v, f, k++);
      }
    }

    if (this.rigSrc) {
      for (let i = k; i < this.bodies.length; i++) this.bodies[i].root.visible = false;
      return;
    }

    for (; k < MAX_BODIES; k++) this.hide(k);

    this.body.instanceMatrix.needsUpdate = true;
    this.head.instanceMatrix.needsUpdate = true;
    this.load.instanceMatrix.needsUpdate = true;
  }

  /** ท่าที่ควรเล่น — มาจากงานที่ชาวบ้านคนนี้กำลังทำ ซึ่ง `src/sim/folk.ts` ตัดสินใจไว้แล้ว */
  private clipFor(f: Folk, moving: boolean): string {
    const c = models.folk.clips;
    if (f.job === "sick") return c.sick;
    if (moving) return c.walk;
    if (f.job === "pray") return c.pray;
    if (f.job === "farm") return c.farm;
    if (f.job === "wood") return c.wood;
    if (f.job === "build") return c.build;
    return c.idle;
  }

  /** ทาสีเสื้อผ้าให้ร่างหนึ่งร่าง
   *
   *  `cloneSkeleton()` ใช้วัสดุ*ก้อนเดียวกัน*กับต้นฉบับ แก้สีที่ร่างหนึ่งจึงเปลี่ยนทั้งเกาะ
   *  ต้องโคลนวัสดุแยกต่อคนก่อนเสมอ
   *
   *  และต้องทิ้ง `map` ไปด้วย ไม่ใช่แค่ทับ `color` — เท็กซ์เจอร์ของ Kenney เป็นแผ่นรวม
   *  ที่เสื้อเป็นสีส้มอยู่แล้ว การคูณสีครามลงบนส้มได้สีโคลน ไม่ได้เสื้อสีคราม
   *  ตัวคนสูง 0.3 หน่วย ลายบนเสื้อไม่มีใครเห็นอยู่แล้ว สิ่งที่เห็นคือ "คนนี้ไม่ใช่คนเมื่อกี้" */
  private dress(root: THREE.Object3D, k: number) {
    const i = k % CLOTH.length;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const shirt = SHIRT.includes(m.name);
      if (!shirt && !TROUSER.includes(m.name)) return;
      const key = (shirt ? "s" : "t") + i;
      let lam = this.cloth.get(key);
      if (!lam) {
        // **ต้องแชร์วัสดุกันตามหมายเลขสี ห้ามโคลนใหม่ต่อคน**
        // ลองโคลนต่อคนแล้ววัดได้: 96 คน = วัสดุ 192 ก้อน เวลาต่อเฟรมขึ้นจาก +18% เป็น +90%
        // เทียบกับแบบกรวยเดิม ซึ่งเกือบชนเพดานที่เทสต์ `perf.spec.ts` ตั้งไว้ (สองเท่า)
        // สีมีแค่หกชุด วัสดุจึงควรมีแค่สิบสองก้อนทั้งเกาะ
        const c = new THREE.Color(CLOTH[i]);
        // กางเกงเป็นสีเดียวกับเสื้อแต่หม่นกว่า — ย้อมคนละครั้งย่อมไม่ได้สีเท่ากัน
        if (!shirt) c.multiplyScalar(0.62).offsetHSL(0, -0.12, 0);
        lam = (m.material as THREE.MeshLambertMaterial).clone();
        lam.map = null;
        lam.color.copy(c);
        this.cloth.set(key, lam);
      }
      m.material = lam;
    });
  }

  private placeBody(s: GameState, v: Village, f: Folk, k: number, dt: number) {
    while (this.bodies.length <= k) {
      const root = cloneSkeleton(this.rigSrc!.scene) as THREE.Object3D;
      root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.castShadow = true; });
      this.dress(root, this.bodies.length);
      const mixer = new THREE.AnimationMixer(root);
      const actions: Record<string, THREE.AnimationAction> = {};
      for (const [name, a] of Object.entries(this.rigSrc!.actions))
        actions[name] = mixer.clipAction(a.getClip());
      let current: THREE.AnimationAction | null = null;
      const rig: Rigged = {
        scene: root as THREE.Group, mixer, actions,
        play(name, fade = 0.2) {
          const next = actions[name];
          if (!next || next === current) return;
          next.reset().play();
          if (current) current.crossFadeTo(next, fade, false);
          current = next;
        },
        update(d) { mixer.update(d); },
      };
      this.group.add(root);
      this.bodies.push({ root, rig, clip: "", facing: 0 });
    }

    const b = this.bodies[k];
    const dx = f.tx - f.x, dy = f.ty - f.y;
    const dist = Math.hypot(dx, dy);
    const moving = f.rest <= 0 && dist > 0.12;

    b.root.visible = true;
    b.root.position.set(f.x, groundY(s, f.x, f.y) + this.rigLift, f.y);
    b.root.scale.setScalar(this.rigScale);
    if (moving) b.facing = Math.atan2(dx, dy);
    // คนยืนตรง ไม่ได้เอียงตามพื้น — เอียงตามแค่พอให้รู้ว่ายืนอยู่บนเนิน
    // เกาะนี้ชันมาก (`HEIGHT_SCALE` 11 บนช่องกว้าง 1) เส้นตั้งฉากของพื้นเอียงได้เกิน 60°
    // ครึ่งหนึ่งของนั้นคือ 33° ซึ่งวัดได้จริงและอ่านออกมาเป็น "คนกำลังจะล้ม" ทั้งหมู่บ้าน
    standOn(b.root, s, f.x, f.y, b.facing, 0.22);

    const want = this.clipFor(f, moving);
    // ตอนหยุดเวลาต้องสลับท่าแบบไม่ไล่ระดับ ไม่งั้นน้ำหนักท่าจะค้างกลางทางตลอดกาล
    if (want !== b.clip) { b.rig.play(want, this.freezeAt === null ? 0.2 : 0); b.clip = want; }
    if (this.freezeAt === null) b.rig.update(dt);
    else b.rig.mixer.setTime(this.freezeAt);
    void v;
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
