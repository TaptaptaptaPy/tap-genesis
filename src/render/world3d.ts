import * as THREE from "three";
import balance from "../../data/balance.json";

const { W, H } = balance.world;

/** ฉาก 3 มิติ แสง ท้องฟ้า และกล้องที่โคจรรอบเกาะ
 *  เกาะเล็กพอที่จะเห็นทั้งใบในจอเดียว ผู้เล่นจึงไม่ต้องเลื่อนแผนที่หา — แค่หมุนดู */
export class World3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly center = new THREE.Vector3(W / 2, 0, H / 2);
  readonly sun: THREE.DirectionalLight;

  // มุมกล้องแบบโคจร
  azimuth = Math.PI * 0.25;
  elevation = 0.92;
  distance = 34;
  private targetDistance = 34;
  /** จุดที่กล้องหมุนรอบ — เลื่อนได้แล้ว เพื่อให้ "ลงไปยืนตรงนั้น" ได้จริง ไม่ใช่ดูเกาะจากข้างนอกอย่างเดียว */
  private targetCenter = new THREE.Vector3(W / 2, 0, H / 2);
  /** 0 = กลางดึก, 1 = เที่ยงวัน — อ่านได้จากข้างนอกเพื่อให้กองไฟในหมู่บ้านติดตอนมืด */
  daylight = 1;

  private readonly skyDay = new THREE.Color(0x122c3a);
  private readonly skyNight = new THREE.Color(0x0a1526);
  private readonly hemiDay = new THREE.Color(0x9ec4dc);
  private readonly hemiNight = new THREE.Color(0x46618f);
  private readonly moon = new THREE.Color(0x9fb8e8);
  private readonly sunNoon = new THREE.Color(0xfff2d8);
  private readonly sunLow = new THREE.Color(0xffb066);
  private hemi!: THREE.HemisphereLight;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 400);
    this.scene.fog = new THREE.Fog(0x0a1a26, 40, 110);
    this.scene.background = new THREE.Color(0x0a1a26);

    this.hemi = new THREE.HemisphereLight(0x9ec4dc, 0x2a3626, 0.75);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff2d8, 1.45);
    this.sun.position.set(-16, 40, -12);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0012;
    this.sun.shadow.normalBias = 0.05;
    const d = 20;
    const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
    cam.left = -d; cam.right = d; cam.top = d; cam.bottom = -d;
    cam.near = 1; cam.far = 80;
    this.sun.target.position.copy(this.center);
    this.scene.add(this.sun, this.sun.target);

    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  get width() { return this.canvas.clientWidth; }
  get height() { return this.canvas.clientHeight; }

  /** ขั้นต่ำ 4 ไม่ใช่ 14 — บนเกาะ 24x24 ระยะ 14 แปลว่าเห็นทั้งเกาะตลอดเวลา ไม่มีวันลงไปยืนในนั้น */
  zoomBy(factor: number) {
    this.targetDistance = THREE.MathUtils.clamp(this.targetDistance * factor, 4, 70);
  }

  /** ร่อนลงไปดูจุดหนึ่งใกล้ๆ — ใช้ตอนแตะช่องสองครั้ง */
  focusOn(x: number, y: number, z: number) {
    this.targetCenter.set(x, y, z);
    this.targetDistance = Math.min(this.targetDistance, 7);
    this.elevation = Math.min(this.elevation, 0.62);
  }

  /** ถอยกลับไปมองทั้งเกาะ */
  resetView() {
    this.targetCenter.set(W / 2, 0, H / 2);
    this.targetDistance = 34;
    this.elevation = 0.92;
  }

  /** ตอนนี้กล้องอยู่ใกล้พอที่จะเห็นคนหรือยัง — HUD ใช้ตัดสินว่าจะโชว์ปุ่มถอยออกไหม */
  get closeUp() { return this.targetDistance < 16; }

  /** วัฏจักรกลางวัน/กลางคืน — phase 0..1 โดย 0.25 คือเที่ยงวัน 0.75 คือเที่ยงคืน
   *  แสงดวงเดียวค้างมุมเดิมทั้งเกมทำให้เกาะดูเป็นภาพนิ่ง ไม่ใช่ที่ที่มีเวลาเดินอยู่ */
  setTimeOfDay(phase: number) {
    const t = phase * Math.PI * 2;
    const up = Math.sin(t);
    this.daylight = THREE.MathUtils.clamp(up * 1.5, 0, 1);
    const d = this.daylight;

    // กลางคืนไม่ใช่ "ไม่มีแสง" — ดวงจันทร์ขึ้นแทนที่ ใช้ไฟดวงเดิมสลับข้างและเปลี่ยนสี
    // เคยปล่อยให้แสงตกใต้ขอบฟ้าจริงๆ แล้วเกาะดำสนิทจนมองไม่ออกว่ามีอะไรอยู่ตรงไหน
    const night = up < 0;
    const h = Math.abs(up);
    this.sun.position.set(Math.cos(night ? t + Math.PI : t) * 30, 5 + h * 38, -12);
    this.sun.intensity = night ? 0.3 + 0.14 * h : 0.2 + 1.4 * d;
    if (night) this.sun.color.copy(this.moon);
    else this.sun.color.copy(this.sunLow).lerp(this.sunNoon, d);

    this.hemi.intensity = 0.44 + 0.42 * d;
    this.hemi.color.copy(this.hemiNight).lerp(this.hemiDay, d);

    const sky = this.skyNight.clone().lerp(this.skyDay, d);
    (this.scene.background as THREE.Color).copy(sky);
    (this.scene.fog as THREE.Fog).color.copy(sky);
    this.renderer.toneMappingExposure = 1.0 + 0.2 * d;
  }
  orbitBy(dx: number, dy: number) {
    this.azimuth -= dx * 0.006;
    this.elevation = THREE.MathUtils.clamp(this.elevation - dy * 0.005, 0.28, 1.4);
  }

  /** สั่นกล้องตอนฟ้าผ่าหรือแผ่นดินไหว */
  shake = 0;

  /** `groundAt` ใช้กันกล้องมุดลงไปใต้ดินตอนซูมใกล้ — ฉากไม่รู้จักภูมิประเทศ จึงต้องรับเข้ามา */
  update(dt: number, groundAt?: (x: number, z: number) => number) {
    this.distance += (this.targetDistance - this.distance) * Math.min(1, dt * 6);
    this.center.lerp(this.targetCenter, Math.min(1, dt * 4));
    const r = this.distance * Math.cos(this.elevation);
    const y = this.distance * Math.sin(this.elevation);
    const sx = this.shake > 0.2 ? (Math.random() - 0.5) * this.shake * 0.06 : 0;
    const sy = this.shake > 0.2 ? (Math.random() - 0.5) * this.shake * 0.06 : 0;
    const px = this.center.x + Math.cos(this.azimuth) * r + sx;
    const pz = this.center.z + Math.sin(this.azimuth) * r;
    let py = this.center.y + y + sy;
    if (groundAt) py = Math.max(py, groundAt(px, pz) + 1.1);
    this.camera.position.set(px, py, pz);
    this.camera.lookAt(this.center);
    // เงาต้องตามจุดที่กล้องมองอยู่ ไม่งั้นพอเลื่อนไปมุมเกาะ เงาจะหายไปทั้งแถบ
    this.sun.target.position.copy(this.center);
    this.sun.target.updateMatrixWorld();
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 22);
  }

  render() { this.renderer.render(this.scene, this.camera); }

  /** ยิงรังสีจากตำแหน่งนิ้วลงไปบนพื้น แล้วคืนพิกัดช่อง */
  pick(px: number, py: number, targets: THREE.Object3D[]): { x: number; y: number } | null {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((px) / r.width) * 2 - 1, -((py) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects(targets, false);
    if (!hits.length) return null;
    const p = hits[0].point;
    const x = Math.floor(p.x), y = Math.floor(p.z);
    if (x < 0 || y < 0 || x >= W || y >= H) return null;
    return { x, y };
  }
}

/** ระดับความสูงของโลก 3 มิติ: h 0..1 จากตัวสร้างโลก → หน่วยในฉาก */
export const SEA = balance.world.seaLevel;
export const HEIGHT_SCALE = 11;
export const worldY = (h: number) => Math.max(0, (h - SEA)) * HEIGHT_SCALE;
