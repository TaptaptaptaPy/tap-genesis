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

    const hemi = new THREE.HemisphereLight(0x9ec4dc, 0x2a3626, 0.75);
    this.scene.add(hemi);

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

  zoomBy(factor: number) {
    this.targetDistance = THREE.MathUtils.clamp(this.targetDistance * factor, 14, 70);
  }
  orbitBy(dx: number, dy: number) {
    this.azimuth -= dx * 0.006;
    this.elevation = THREE.MathUtils.clamp(this.elevation - dy * 0.005, 0.28, 1.4);
  }

  /** สั่นกล้องตอนฟ้าผ่าหรือแผ่นดินไหว */
  shake = 0;

  update(dt: number) {
    this.distance += (this.targetDistance - this.distance) * Math.min(1, dt * 6);
    const r = this.distance * Math.cos(this.elevation);
    const y = this.distance * Math.sin(this.elevation);
    const sx = this.shake > 0.2 ? (Math.random() - 0.5) * this.shake * 0.06 : 0;
    const sy = this.shake > 0.2 ? (Math.random() - 0.5) * this.shake * 0.06 : 0;
    this.camera.position.set(
      this.center.x + Math.cos(this.azimuth) * r + sx,
      y + sy,
      this.center.z + Math.sin(this.azimuth) * r);
    this.camera.lookAt(this.center);
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
