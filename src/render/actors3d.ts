import * as THREE from "three";
import { bodySize } from "../sim/creature";
import { influenceOf } from "../sim/village";
import balance from "../../data/balance.json";
import type { Creature, GameState, NeedId, Village } from "../sim/types";
import { groundY } from "./terrain3d";

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

const HUT_R = 0.42;
const HUT_GEO = new THREE.ConeGeometry(HUT_R, 0.8, 6);
HUT_GEO.translate(0, 0.4, 0);
const WALL_GEO = new THREE.CylinderGeometry(0.34, 0.38, 0.42, 6);
WALL_GEO.translate(0, 0.21, 0);

/** กระท่อมหลังไกลสุดอยู่ที่รัศมีเท่านี้ (ดู build() ข้างล่าง) */
const HUT_SPREAD = 1.06;

/** หมู่บ้านโตขึ้นตามประชากร — ใช้ที่เดียวกันทั้งตอนวาดกระท่อมและตอนวางชาวบ้าน */
export const villageGrow = (v: Village) => 0.75 + Math.min(0.55, v.pop / 120);

/** ขอบนอกสุดที่กลุ่มกระท่อมกินจริง `villagers3d.ts` ใช้ค่านี้เพื่อไม่ให้คนไปยืนซ้อนอยู่ในหลังคา
 *  ถ้าแก้ผังกระท่อมใน build() ต้องแก้ HUT_SPREAD ด้วย ไม่งั้นคนจะจมหายไปในหมู่บ้านเงียบๆ */
export const villageFootprint = (v: Village) => (HUT_SPREAD + HUT_R) * villageGrow(v);

export class Villages3D {
  readonly group = new THREE.Group();
  private byId = new Map<number, VillageParts>();
  private askTex: Record<NeedId, THREE.Texture>;

  constructor() {
    this.askTex = { food: askTexture("food"), wood: askTexture("wood"), shelter: askTexture("shelter") };
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

    const huts = new THREE.Group();
    const roofMat = new THREE.MeshLambertMaterial({ color: 0xa8713f });
    const wallMat = new THREE.MeshLambertMaterial({ color: 0xd9c9a4 });
    for (let i = 0; i < 6; i++) {
      const hut = new THREE.Group();
      const wall = new THREE.Mesh(WALL_GEO, wallMat);
      const roof = new THREE.Mesh(HUT_GEO, roofMat);
      roof.position.y = 0.42;
      wall.castShadow = roof.castShadow = true;
      hut.add(wall, roof);
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
export class Creature3D {
  readonly root = new THREE.Group();
  private body: THREE.Mesh;
  private head: THREE.Group;
  private legs: THREE.Mesh[] = [];
  private tail: THREE.Mesh;
  private aura: THREE.Mesh;
  private moodSprite: THREE.Sprite;
  private moodTex: { good: THREE.Texture; bad: THREE.Texture };

  constructor() {
    const skin = new THREE.MeshLambertMaterial({ color: 0xa88f78 });
    this.body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), skin);
    this.body.scale.set(1, 0.82, 1.25);
    this.body.castShadow = true;
    this.root.add(this.body);

    this.head = new THREE.Group();
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10), skin);
    headMesh.castShadow = true;
    const snout = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8),
      new THREE.MeshLambertMaterial({ color: 0x8e7663 }));
    snout.position.set(0, -0.04, 0.22);
    const earGeo = new THREE.ConeGeometry(0.09, 0.22, 5);
    const earL = new THREE.Mesh(earGeo, skin); earL.position.set(-0.13, 0.22, -0.02);
    const earR = new THREE.Mesh(earGeo, skin); earR.position.set(0.13, 0.22, -0.02);
    const eyeGeo = new THREE.SphereGeometry(0.045, 8, 6);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x141a1c });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.11, 0.06, 0.2);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(0.11, 0.06, 0.2);
    this.head.add(headMesh, snout, earL, earR, eyeL, eyeR);
    this.head.position.set(0, 0.24, 0.42);
    this.root.add(this.head);

    const legGeo = new THREE.CylinderGeometry(0.07, 0.055, 0.42, 6);
    legGeo.translate(0, -0.21, 0);
    for (const [lx, lz] of [[-0.22, 0.3], [0.22, 0.3], [-0.22, -0.28], [0.22, -0.28]] as const) {
      const leg = new THREE.Mesh(legGeo, skin);
      leg.position.set(lx, -0.12, lz);
      leg.castShadow = true;
      this.legs.push(leg);
      this.root.add(leg);
    }

    const tailGeo = new THREE.CylinderGeometry(0.06, 0.02, 0.5, 5);
    tailGeo.translate(0, 0.25, 0);
    this.tail = new THREE.Mesh(tailGeo, skin);
    this.tail.position.set(0, 0.16, -0.5);
    this.tail.rotation.x = -2.2;
    this.root.add(this.tail);

    this.aura = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.74, 32),
      new THREE.MeshBasicMaterial({ color: 0xf0d38a, transparent: true, opacity: 0.4,
                                    side: THREE.DoubleSide, depthWrite: false }));
    this.aura.rotation.x = -Math.PI / 2;
    this.aura.position.y = -0.44;
    this.root.add(this.aura);

    this.moodTex = { good: moodTexture("✦", "#f0cd78"), bad: moodTexture("✕", "#c44e4e") };
    this.moodSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.moodTex.good, transparent: true, depthTest: false }));
    this.moodSprite.scale.set(0.7, 0.7, 1);
    this.moodSprite.position.y = 1.15;
    this.moodSprite.visible = false;
    this.root.add(this.moodSprite);
  }

  update(s: GameState, c: Creature, time: number) {
    this.root.visible = c.alive;
    if (!c.alive) return;
    const scale = 0.7 + bodySize(c) * 0.9;
    this.root.scale.setScalar(scale);
    const y = groundY(s, c.x + 0.5, c.y + 0.5);
    const moving = !!c.tgt;
    const bob = Math.sin(time * 0.009) * (moving ? 0.05 : 0.02);
    this.root.position.set(c.x + 0.5, y + 0.5 * scale + bob, c.y + 0.5);
    this.root.rotation.y = c.facing;

    const phase = time * 0.012;
    this.legs.forEach((leg, i) => {
      const swing = moving ? Math.sin(phase + (i % 2 ? Math.PI : 0) + (i > 1 ? 0.6 : 0)) * 0.5 : 0;
      leg.rotation.x = swing;
    });
    this.tail.rotation.z = Math.sin(phase * 0.6) * 0.3;
    this.head.rotation.x = c.need === "tired" ? 0.35 : Math.sin(time * 0.002) * 0.08;

    (this.aura.material as THREE.MeshBasicMaterial).opacity = 0.18 + c.bond * 0.5;

    if (Math.abs(c.mood) > 0.12) {
      this.moodSprite.visible = true;
      (this.moodSprite.material as THREE.SpriteMaterial).map =
        c.mood > 0 ? this.moodTex.good : this.moodTex.bad;
      (this.moodSprite.material as THREE.SpriteMaterial).needsUpdate = true;
    } else this.moodSprite.visible = false;
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
