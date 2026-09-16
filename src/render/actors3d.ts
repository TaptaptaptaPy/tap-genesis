import * as THREE from "three";
import { bodySize } from "../sim/creature";
import { influenceOf } from "../sim/village";
import balance from "../../data/balance.json";
import type { Creature, GameState, NeedId, Village } from "../sim/types";
import { groundY, standOn } from "./terrain3d";
import { villageFootprint, villageGrow } from "./layout";
export { villageFootprint, villageGrow };
import { flattenToLambert, loadRigged, normalise, type Rigged } from "./gltf";
import { makeGranary, makeHut } from "./buildings";
import models from "../../data/models.json";

/** ป้ายลอยเหนือหมู่บ้าน บอกว่ากำลังขาดอะไร — ตัวที่ทำให้ผู้เล่นรู้ว่าตอนนี้ควรทำอะไร */
const ASK_COLOR: Record<NeedId, string> = {
  food: "#7fd08f", wood: "#d2a55e", shelter: "#7fb4d8",
};
const ASK_GLYPH: Record<NeedId, string> = { food: "❋", wood: "⌇", shelter: "⌂" };

function askTexture(need: NeedId): THREE.Texture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const g = cv.getContext("2d")!;
  g.fillStyle = "rgba(10,22,28,.86)";
  g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.fill();
  g.strokeStyle = ASK_COLOR[need]; g.lineWidth = 6;
  g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke();
  g.fillStyle = ASK_COLOR[need];
  g.font = "700 62px Trirong, serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(ASK_GLYPH[need], 64, 68);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface VillageParts {
  root: THREE.Group; huts: THREE.Group; ring: THREE.Mesh; ask: THREE.Sprite;
  fire: THREE.Mesh; glow: THREE.Sprite; inf: THREE.Mesh;
  hall: THREE.Group; totem: THREE.Group; wall: THREE.Mesh;
}

/** แสงกองไฟตอนกลางคืน — ใช้ sprite ไล่สีแทน PointLight จริง
 *  เพราะหมู่บ้านมีได้ถึง 6 แห่ง ไฟจริง 6 ดวงแพงเกินไปบน iPad */
function glowTexture(): THREE.Texture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const g = cv.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  grad.addColorStop(0, "rgba(255,196,110,.95)");
  grad.addColorStop(0.45, "rgba(226,140,60,.35)");
  grad.addColorStop(1, "rgba(226,140,60,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const GLOW_TEX = /* @__PURE__ */ (() => { let t: THREE.Texture | null = null;
  return () => (t ??= glowTexture()); })();

/** กระท่อมสร้างจากโค้ด ไม่ใช่จากไฟล์ — ดู `buildings.ts` ว่าทำไม
 *  หกทรงไม่เหมือนกันเป๊ะ ใช้วนตามตำแหน่งในหมู่บ้าน หมู่บ้านจึงไม่ดูเป็นของก็อปกัน */
const HUT_SHAPES = /* @__PURE__ */ (() => {
  let g: THREE.BufferGeometry[] | null = null;
  return () => (g ??= [0, 1, 2, 3, 4, 5].map((i) => makeHut(i)));
})();
const GRANARY_SHAPE = /* @__PURE__ */ (() => {
  let g: THREE.BufferGeometry | null = null;
  return () => (g ??= makeGranary());
})();



export class Villages3D {
  readonly group = new THREE.Group();
  private byId = new Map<number, VillageParts>();
  private askTex: Record<NeedId, THREE.Texture>;

  /** รอให้รูปทรงกระท่อมมาถึง — เทสต์ภาพใช้ตัวนี้ */
  readonly ready: Promise<void>;

  constructor() {
    this.askTex = { food: askTexture("food"), wood: askTexture("wood"), shelter: askTexture("shelter") };
    // กระท่อมไม่ต้องรอไฟล์แล้ว สร้างจากโค้ดได้ทันที
    this.ready = Promise.resolve();
  }

  update(s: GameState, time: number, daylight = 1) {
    const alive = new Set<number>();
    for (const v of s.villages) {
      alive.add(v.id);
      let e = this.byId.get(v.id);
      if (!e) { e = this.build(s, v); this.byId.set(v.id, e); this.group.add(e.root); }
      this.refresh(s, v, e, time, daylight);
    }
    for (const [id, e] of this.byId)
      if (!alive.has(id)) { this.group.remove(e.root); this.byId.delete(id); }
  }

  private build(s: GameState, v: Village): VillageParts {
    const root = new THREE.Group();
    root.position.set(v.x + 0.5, groundY(s, v.x + 0.5, v.y + 0.5) + 0.08, v.y + 0.5);
    standOn(root, s, v.x + 0.5, v.y + 0.5, 0, 0.85);

    const huts = new THREE.Group();
    // สีฝังอยู่ในจุดยอดแล้ว จึงใช้วัสดุตัวเดียวทั้งหมู่บ้าน
    const bakedMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const shapes = HUT_SHAPES();
    for (let i = 0; i < 6; i++) {
      const hut = new THREE.Group();
      // หลังแรกของทุกหมู่บ้านคือยุ้งฉาง — หมู่บ้านที่มีแต่บ้านเหมือนกันหกหลัง
      // อ่านเป็น "กองของ" ไม่ใช่ "ชุมชน"
      const body = new THREE.Mesh(i === 0 ? GRANARY_SHAPE() : shapes[i], bakedMat);
      body.castShadow = true;
      hut.add(body);
      const a = (i / 6) * Math.PI * 2 + v.id;
      const rad = i === 0 ? 0 : 0.62 + ((i * 37) % 10) / 18;
      hut.position.set(Math.cos(a) * rad, 0, Math.sin(a) * rad);
      hut.rotation.y = a;
      hut.visible = false;
      huts.add(hut);
    }
    root.add(huts);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.15, 1.45, 40),
      new THREE.MeshBasicMaterial({ color: 0xffcf6a, transparent: true, opacity: 0.5,
                                    side: THREE.DoubleSide, depthWrite: false, depthTest: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.12;
    root.add(ring);

    const ask = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.askTex.food, transparent: true, depthTest: false }));
    ask.scale.set(0.9, 0.9, 1);
    ask.position.y = 1.9;
    ask.visible = false;
    root.add(ask);

    const fire = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffb45c, transparent: true }));
    fire.position.y = 0.16;
    root.add(fire);

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: GLOW_TEX(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.set(3.2, 3.2, 1);
    glow.position.y = 0.3;
    root.add(glow);

    // หมู่บ้านโตพอจะมีศาลากลาง — รูปทรงบอกขนาดได้ดีกว่าการนับหลังคา
    const hall = new THREE.Group();
    const hallWall = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.5, 0.78),
      new THREE.MeshLambertMaterial({ color: 0xcdb98f }));
    hallWall.position.y = 0.25;
    const hallRoof = new THREE.Mesh(new THREE.ConeGeometry(0.88, 0.62, 4),
      new THREE.MeshLambertMaterial({ color: 0x8f5a33 }));
    hallRoof.position.y = 0.78;
    hallRoof.rotation.y = Math.PI / 4;
    hallWall.castShadow = hallRoof.castShadow = true;
    hall.add(hallWall, hallRoof);
    hall.position.set(0, 0, -1.05);
    hall.visible = false;
    root.add(hall);

    // เสาบูชากลางหมู่บ้าน โผล่เมื่อผู้คนเชื่อมากพอ
    const totem = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.5, 6),
      new THREE.MeshLambertMaterial({ color: 0x6b4a2f }));
    pole.position.y = 0.75;
    const disc = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.05, 6, 14),
      new THREE.MeshLambertMaterial({ color: 0xd9a437 }));
    disc.position.y = 1.5;
    disc.rotation.x = Math.PI / 2;
    pole.castShadow = true;
    totem.add(pole, disc);
    totem.position.set(0.55, 0, 0.9);
    totem.visible = false;
    root.add(totem);

    // เมืองใหญ่มีรั้วรอบ
    const wall = new THREE.Mesh(
      new THREE.TorusGeometry(1.75, 0.075, 5, 26),
      new THREE.MeshLambertMaterial({ color: 0x7a6242 }));
    wall.rotation.x = Math.PI / 2;
    wall.position.y = 0.16;
    wall.visible = false;
    root.add(wall);

    // ขอบเขตที่ร่ายคาถาได้ — ถ้าไม่วาดไว้ ข้อความ "ไกลเกินเขตที่ผู้คนศรัทธาท่าน" จะไม่มีทางเข้าใจได้
    // ใช้วงรัศมี 1 แล้วค่อยขยายตามค่าจริง จะได้ไม่ต้องสร้าง geometry ใหม่ทุกเฟรม
    const inf = new THREE.Mesh(
      new THREE.RingGeometry(0.965, 1, 72),
      new THREE.MeshBasicMaterial({ color: 0xf0d38a, transparent: true, opacity: 0.16,
                                    side: THREE.DoubleSide, depthWrite: false }));
    inf.rotation.x = -Math.PI / 2;
    inf.position.y = 0.06;
    root.add(inf);

    return { root, huts, ring, ask, fire, glow, inf, hall, totem, wall };
  }

  private refresh(_s: GameState, v: Village, e: VillageParts, time: number, daylight: number) {
    const n = Math.max(1, Math.min(6, Math.round(1 + v.pop / 14)));
    e.huts.children.forEach((h, i) => { h.visible = i < n; });
    const grow = villageGrow(v);
    e.huts.scale.setScalar(grow);

    const mat = e.ring.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.22 + v.belief * 0.55;
    e.ring.scale.setScalar(0.9 + grow * 0.35);

    if (v.ask) {
      e.ask.visible = true;
      (e.ask.material as THREE.SpriteMaterial).map = this.askTex[v.ask];
      (e.ask.material as THREE.SpriteMaterial).needsUpdate = true;
      e.ask.position.y = 1.9 + Math.sin(time * 0.004 + v.id) * 0.12;
    } else e.ask.visible = false;

    const T = balance.town;
    e.hall.visible = v.pop >= T.hallAtPop;
    e.totem.visible = v.belief >= T.totemAtBelief;
    e.wall.visible = v.pop >= T.wallAtPop;
    if (e.totem.visible) e.totem.rotation.y = time * 0.0004;

    const rad = influenceOf(v);
    e.inf.scale.set(rad, rad, 1);
    (e.inf.material as THREE.MeshBasicMaterial).opacity = 0.10 + v.belief * 0.14;

    // กองไฟติดตอนมืด และแรงขึ้นตามความเชื่อ — กลางคืนจะได้ยังบอกได้ว่าหมู่บ้านไหนยังมีคนอยู่
    const night = Math.max(0, 1 - daylight * 1.35);
    const flicker = 0.88 + Math.sin(time * 0.011 + v.id) * 0.12;
    e.fire.visible = e.glow.visible = night > 0.02;
    if (e.fire.visible) {
      (e.fire.material as THREE.MeshBasicMaterial).opacity = night;
      (e.glow.material as THREE.SpriteMaterial).opacity = night * (0.35 + v.belief * 0.45) * flicker;
      e.glow.scale.setScalar((2.6 + grow * 1.4) * flicker);
    }

    if (v.plague > 0) {
      const p = 0.5 + 0.5 * Math.sin(time * 0.006);
      (e.huts.children[0].children[0] as THREE.Mesh).material =
        new THREE.MeshLambertMaterial({ color: new THREE.Color(0.7 + p * 0.2, 0.5, 0.75) });
    }
  }
}

/** สัตว์ของผู้เล่น: ลำตัว หัว สี่ขาที่สลับเฟสตอนเดิน และหางที่แกว่ง */
/** สัตว์ของพระเจ้า
 *
 *  เคยเป็นทรงกลมกับทรงกระบอกต่อกันแล้วแกว่งขาด้วย `Math.sin` ซึ่งได้แค่ "มีอะไรขยับ"
 *  ตอนนี้เป็นโมเดลที่ rig มาแล้วจริง ท่าทางมาจาก `c.act` ที่ `src/sim/creature.ts` ตัดสินใจอยู่แล้ว
 *  แปลว่าสิ่งที่เห็นบนจอคือสิ่งที่มันกำลังทำจริงๆ ไม่ใช่ภาพประกอบ
 *
 *  วงแหวนความผูกพันกับสัญลักษณ์อารมณ์ยังเป็นของเดิม เพราะสองอันนั้นคือการบอกข้อมูล
 *  ไม่ใช่การตกแต่ง ถ้าเอาออกผู้เล่นจะไม่รู้ว่าสัตว์รู้สึกยังไงกับสิ่งที่เพิ่งทำลงไป
 */
export class Creature3D {
  readonly root = new THREE.Group();
  /** รอให้โมเดลมาถึงก่อนค่อยถ่ายภาพ — เทสต์ภาพใช้ตัวนี้ */
  readonly ready: Promise<void>;
  private rig: Rigged | null = null;
  private aura: THREE.Mesh;
  private moodSprite: THREE.Sprite;
  private moodTex: { good: THREE.Texture; bad: THREE.Texture };
  private clip = "";
  /** ท่าที่กำลังเล่นอยู่ — เปิดออกมาให้เทสต์ตรวจว่าภาพตรงกับสิ่งที่สัตว์กำลังทำจริง */
  get playing() { return this.clip; }

  constructor() {
    this.aura = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.74, 32),
      new THREE.MeshBasicMaterial({ color: 0xf0d38a, transparent: true, opacity: 0.4,
                                    side: THREE.DoubleSide, depthWrite: false }));
    this.aura.rotation.x = -Math.PI / 2;
    this.aura.position.y = 0.02;
    this.root.add(this.aura);

    this.moodTex = { good: moodTexture("✦", "#f0cd78"), bad: moodTexture("✕", "#c44e4e") };
    this.moodSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.moodTex.good, transparent: true, depthTest: false }));
    this.moodSprite.scale.set(0.7, 0.7, 1);
    this.moodSprite.position.y = 1.5;
    this.moodSprite.visible = false;
    this.root.add(this.moodSprite);

    this.ready = loadRigged(models.creature.file).then((r) => {
      normalise(r.scene);
      flattenToLambert(r.scene);
      r.scene.rotation.y = models.creature.faceOffset;
      this.rig = r;
      this.root.add(r.scene);
    });
  }

  /** ท่าที่ควรเล่นตอนนี้ — อ่านจากสภาพของสัตว์ล้วน ไม่มีการสุ่ม
   *  ลำดับสำคัญ: ตายมาก่อนทุกอย่าง แล้วค่อยงานที่กำลังทำ แล้วค่อยการเดิน แล้วค่อยความเหนื่อย */
  private wanted(c: Creature): string {
    const k = models.creature.clips;
    if (!c.alive) return k.death;
    if (c.act === "forage" && !c.tgt) return k.forage;
    if (c.act === "raid" && !c.tgt) return k.raid;
    if (c.act === "worship") return k.worship;
    if (c.tgt) return c.need === "tired" ? k.walk : k.run;
    return c.need === "tired" ? k.tired : k.idle;
  }

  update(s: GameState, c: Creature, time: number, dt: number) {
    this.root.visible = c.alive || !!this.rig;
    const scale = 0.7 + bodySize(c) * 0.9;
    this.root.scale.setScalar(scale);
    const y = groundY(s, c.x + 0.5, c.y + 0.5);
    this.root.position.set(c.x + 0.5, y, c.y + 0.5);
    standOn(this.root, s, c.x + 0.5, c.y + 0.5, c.facing, 0.75);

    if (this.rig) {
      const want = this.wanted(c);
      if (want !== this.clip) { this.rig.play(want); this.clip = want; }
      // ท่าเดินต้องเร็วขึ้นตามความไวของตัวมันเอง ไม่งั้นตัวที่วิ่งเร็วจะดูเหมือนลอยไปกับพื้น
      const speed = c.tgt ? 0.8 + c.genes.speed * 0.9 : 1;
      this.rig.mixer.timeScale = speed;
      this.rig.update(dt);
    }

    (this.aura.material as THREE.MeshBasicMaterial).opacity = c.alive ? 0.18 + c.bond * 0.5 : 0;

    if (c.alive && Math.abs(c.mood) > 0.12) {
      this.moodSprite.visible = true;
      (this.moodSprite.material as THREE.SpriteMaterial).map =
        c.mood > 0 ? this.moodTex.good : this.moodTex.bad;
      (this.moodSprite.material as THREE.SpriteMaterial).needsUpdate = true;
    } else this.moodSprite.visible = false;
    void time;
  }
}

function moodTexture(glyph: string, color: string): THREE.Texture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 96;
  const g = cv.getContext("2d")!;
  g.fillStyle = color;
  g.font = "700 72px Trirong, serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(glyph, 48, 52);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
