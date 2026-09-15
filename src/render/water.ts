import * as THREE from "three";
import balance from "../../data/balance.json";
import type { GameState } from "../sim/types";
import { SEA } from "./world3d";
import { sampleH } from "./terrain3d";

const { W, H } = balance.world;

/** ผิวน้ำ
 *
 *  เคยเป็นแผ่นสีเดียวทึบ ซึ่งบอกได้แค่ว่า "ตรงนี้ไม่ใช่พื้นดิน"
 *  ทะเลจริงบอกมากกว่านั้น: ตรงไหนตื้น ตรงไหนลึก ขอบฝั่งอยู่ตรงไหน และมันไม่เคยอยู่นิ่ง
 *
 *  ความลึกมาจากพื้นผิวที่สร้างจากความสูงของช่อง (`depthMap`) ไม่ได้มาจากการเดา
 *  เชเดอร์จึงรู้ว่าจุดที่กำลังวาดอยู่ห่างจากฝั่งแค่ไหน แล้วเอามาทำฟองคลื่นริมฝั่ง
 *
 *  กติกา: ไฟล์นี้อยู่ในชั้นภาพล้วน `src/sim/` ห้ามเรียก
 */
const RES = 160;

const VERT = /* glsl */ `
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const FRAG = /* glsl */ `
  uniform sampler2D depthMap;
  uniform vec2 worldMin;
  uniform vec2 worldSize;
  uniform float time;
  uniform vec3 shallowColor;
  uniform vec3 deepColor;
  uniform vec3 foamColor;
  uniform float daylight;
  varying vec3 vWorld;
  #include <fog_pars_fragment>

  void main() {
    vec2 uv = (vWorld.xz - worldMin) / worldSize;
    // นอกขอบเกาะถือว่าลึกสุด ไม่ต้องอ่านพื้นผิว (ทะเลรอบนอกกว้างกว่าเกาะหลายสิบเท่า)
    float depth = 1.0;
    if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0)
      depth = texture2D(depthMap, uv).r;

    // คลื่นสองชุดที่คาบไม่ลงตัวกัน จะได้ไม่เห็นลายซ้ำ
    float w1 = sin(vWorld.x * 1.35 + vWorld.z * 0.6 + time * 0.85);
    float w2 = sin(vWorld.z * 2.05 - vWorld.x * 0.4 - time * 0.62);
    float wave = (w1 + w2) * 0.5;

    // คลื่นความถี่คงที่บนระนาบที่กว้างเป็นร้อยเท่าของเกาะ จะกลายเป็นลายตารางเต็มทะเล
    // (ลองแล้วเห็นชัดมากในภาพอ้างอิง) ทางแก้คือให้มันมีผลเฉพาะใกล้ฝั่ง
    // ทะเลเปิดที่ไกลออกไปควรนิ่ง เพราะมองจากระยะนั้นคลื่นเล็กมองไม่เห็นอยู่แล้ว
    float nearShore = 1.0 - smoothstep(0.05, 0.45, depth);

    vec3 col = mix(shallowColor, deepColor, smoothstep(0.02, 0.38, depth));

    // ฟองริมฝั่ง — ขอบขยับตามคลื่น ไม่ใช่เส้นตายตัว
    float edge = 0.055 + wave * 0.022;
    float foam = 1.0 - smoothstep(0.0, edge, depth);
    foam *= step(0.0005, depth);          // บนพื้นดินไม่มีฟอง
    col = mix(col, foamColor, clamp(foam, 0.0, 1.0) * 0.8);

    // ประกายผิวน้ำ เห็นเฉพาะน้ำตื้นใกล้ฝั่ง และเห็นชัดตอนกลางวัน
    col += wave * 0.020 * daylight * nearShore;
    // ทะเลเปิดมีคลื่นยาวๆ เบามาก แค่ให้ไม่ตายสนิท
    col += sin(vWorld.x * 0.055 + vWorld.z * 0.031 + time * 0.22) * 0.006 * daylight;

    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
    #include <colorspace_fragment>
  }`;

export class Water3D {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private tex: THREE.DataTexture;
  private version = -1;

  constructor(s: GameState) {
    const data = new Uint8Array(RES * RES);
    this.tex = new THREE.DataTexture(data, RES, RES, THREE.RedFormat);
    this.tex.minFilter = this.tex.magFilter = THREE.LinearFilter;
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.refresh(s, true);

    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          depthMap: { value: null },
          worldMin: { value: new THREE.Vector2(0, 0) },
          worldSize: { value: new THREE.Vector2(W, H) },
          time: { value: 0 },
          shallowColor: { value: new THREE.Color(0x3f8fa6) },
          deepColor: { value: new THREE.Color(0x11405c) },
          foamColor: { value: new THREE.Color(0xdff0f4) },
          daylight: { value: 1 },
        },
      ]),
    });
    // merge() โคลน uniform ทุกตัว ต้องยัด texture เข้าไปหลังจากนั้น ไม่งั้นได้ค่า null ค้าง
    this.mat.uniforms.depthMap.value = this.tex;

    // ต้องใหญ่กว่ารัศมีโดมท้องฟ้า (260) ไม่งั้นจะเห็นขอบทะเลเป็นเส้นตรง
    const geo = new THREE.PlaneGeometry(W * 22, H * 22, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.mat);
    // ต้องอยู่เหนือ y = 0 เสมอ — `worldY()` ตัดทุกช่องใต้ระดับน้ำทะเลให้เป็น 0 พอดี
    // ถ้าระนาบมุดลงไปต่ำกว่านั้น จะเห็นสีช่องน้ำในตารางโผล่เป็นสี่เหลี่ยมรอบเกาะ
    this.mesh.position.set(W / 2, 0.12, H / 2);
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 1;
  }

  /** สร้างพื้นผิวความลึกใหม่ — 0 ที่ริมฝั่ง 1 ที่ลึกสุด
   *  เรียกซ้ำเฉพาะตอนแผ่นดินเปลี่ยนจริง (คาถาถมทะเล ยกแผ่นดิน) ไม่ใช่ทุกเฟรม */
  private refresh(s: GameState, force = false) {
    if (!force && s.terrainVersion === this.version) return;
    this.version = s.terrainVersion;
    const d = this.tex.image.data as Uint8Array;
    for (let j = 0; j < RES; j++) {
      const z = (j / (RES - 1)) * H;
      for (let i = 0; i < RES; i++) {
        const x = (i / (RES - 1)) * W;
        const h = sampleH(s, x, z);
        // ลึกเท่าไรเทียบกับระดับน้ำทะเล — บนบกเป็น 0
        const depth = Math.max(0, SEA - h) / Math.max(1e-4, SEA);
        d[j * RES + i] = Math.round(Math.min(1, depth) * 255);
      }
    }
    this.tex.needsUpdate = true;
  }

  /** ทะเลกินพื้นที่จอมากที่สุดในเฟรม และกล้องก้มลงจนโดมท้องฟ้าแทบไม่อยู่ในภาพ
   *  ถ้าจะให้รัชสมัย "มองเห็นได้" จริง ทะเลคือที่ที่ต้องเปลี่ยน ไม่ใช่ท้องฟ้า
   *  ทะเลของเทพพิโรธขุ่นและอมเขียวเทา ของเทพเมตตาใสขึ้นและฟ้าขึ้น */
  private readonly shallowBase = new THREE.Color(0x3f8fa6);
  private readonly deepBase = new THREE.Color(0x11405c);
  private readonly shallowDark = new THREE.Color(0x4a6b52);
  private readonly deepDark = new THREE.Color(0x1d2e2a);
  private readonly shallowHoly = new THREE.Color(0x4fa8c8);
  private readonly deepHoly = new THREE.Color(0x0e4a72);
  private alignShown = 0;

  setAlign(align: number, snap = false) {
    const want = Math.max(-1, Math.min(1, align));
    this.alignShown = snap ? want : this.alignShown + (want - this.alignShown) * 0.02;
    const dark = Math.max(0, -this.alignShown), holy = Math.max(0, this.alignShown);
    (this.mat.uniforms.shallowColor.value as THREE.Color)
      .copy(this.shallowBase).lerp(this.shallowDark, dark * 0.7).lerp(this.shallowHoly, holy * 0.6);
    (this.mat.uniforms.deepColor.value as THREE.Color)
      .copy(this.deepBase).lerp(this.deepDark, dark * 0.7).lerp(this.deepHoly, holy * 0.6);
  }

  update(s: GameState, timeMs: number, daylight: number) {
    this.setAlign(s.align);
    this.refresh(s);
    this.mat.uniforms.time.value = timeMs * 0.001;
    this.mat.uniforms.daylight.value = daylight;
    this.mesh.position.y = 0.12 + Math.sin(timeMs * 0.0009) * 0.035;
  }
}
