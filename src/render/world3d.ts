import * as THREE from "three";
import balance from "../../data/balance.json";
import { driftClouds, makeClouds, type CloudSky } from "./clouds";

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
  distance = 26;
  private targetDistance = 26;
  /** จุดที่กล้องหมุนรอบ — เลื่อนได้แล้ว เพื่อให้ "ลงไปยืนตรงนั้น" ได้จริง ไม่ใช่ดูเกาะจากข้างนอกอย่างเดียว */
  private targetCenter = new THREE.Vector3(W / 2, 0, H / 2);
  /** 0 = กลางดึก, 1 = เที่ยงวัน — อ่านได้จากข้างนอกเพื่อให้กองไฟในหมู่บ้านติดตอนมืด */
  daylight = 1;

  // ท้องฟ้ากลางวันเคยเป็น 0x122c3a ซึ่งเข้มพอๆ กับกลางคืน เกมเลยดูเป็นเวลาเย็นตลอดทั้งเกม
  // ตอนนี้แยกเป็นสองสี: สีบนหัวกับสีตรงขอบฟ้า แล้วไล่เฉดระหว่างกันด้วยโดมท้องฟ้า
  private readonly zenithDay = new THREE.Color(0x2f6f9e);
  private readonly zenithNight = new THREE.Color(0x0c1424);
  private readonly horizonDay = new THREE.Color(0x9cc6dc);
  private readonly horizonNight = new THREE.Color(0x1d2b44);
  private readonly hemiDay = new THREE.Color(0x9ec4dc);
  private readonly hemiNight = new THREE.Color(0x46618f);
  private readonly moon = new THREE.Color(0x9fb8e8);
  private readonly cloudNight = new THREE.Color(0x3a4460);
  private readonly sunNoon = new THREE.Color(0xfff2d8);
  private readonly sunLow = new THREE.Color(0xffb066);
  // สีของรัชสมัย — ฟ้าของเทพเมตตากับเทพพิโรธต้องไม่ใช่ฟ้าเดียวกัน
  // ใน B&W สภาพแวดล้อม ดนตรี และวิหารเปลี่ยนตามแกนนี้ทั้งหมด มันคือเสาหลักของเกม
  // ไม่ใช่ตัวเลขในแถบบน ของเดิมที่นี่ไม่มีอะไรอ่าน `align` เลยสักบรรทัด
  private readonly zenithDark = new THREE.Color(0x3a1d22);
  private readonly horizonDark = new THREE.Color(0x8a5340);
  private readonly zenithHoly = new THREE.Color(0x2b7fb4);
  private readonly horizonHoly = new THREE.Color(0xd8e6ea);
  private readonly sunDark = new THREE.Color(0xd8864e);
  private readonly sunHoly = new THREE.Color(0xfff8e4);
  /** ค่าที่ใช้วาดจริง ไล่ตาม `align` แบบนุ่มๆ ไม่งั้นคาถาเดียวจะพลิกสีทั้งเกาะทันที */
  private alignShown = 0;
  private hemi!: THREE.HemisphereLight;
  private skyMat!: THREE.ShaderMaterial;
  /** เมฆ — ใช้พื้นผิวก้อนเดียวกับเงาเมฆบนพื้น เพื่อให้เงาตรงกับก้อนที่เห็นจริง */
  readonly clouds: CloudSky = makeClouds();

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 400);
    // หมอกต้องเริ่ม "หลังเกาะ" ไม่ใช่กลางเกาะ เกาะกว้าง 44 ยาว 32 กล้องปกติอยู่ที่ 26
    // ของเดิมเริ่มที่ 40 จบ 110 ขอบเกาะฝั่งไกลเลยจางหายไปในสีท้องฟ้าตลอดเวลา
    this.scene.fog = new THREE.Fog(0x0a1a26, 70, 175);
    this.scene.background = null;
    this.addSkyDome();

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

  /** โดมท้องฟ้า: ทรงกลมใบใหญ่ที่มองจากด้านใน ไล่สีจากขอบฟ้าขึ้นไปบนหัว
   *  พื้นหลังสีเดียวแบนๆ คือสิ่งที่ทำให้ฉากดูเหมือนภาพ 3 มิติลอยอยู่ในกล่อง ไม่ใช่เกาะกลางทะเล
   *  ใช้ ShaderMaterial ดิบ ไม่รับหมอกและไม่รับ tone mapping สีที่ใส่จึงเป็นสีที่เห็นจริงๆ */
  private addSkyDome() {
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
      uniforms: {
        zenith: { value: this.zenithDay.clone() },
        horizon: { value: this.horizonDay.clone() },
        glow: { value: new THREE.Color(0xffd9a0) },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        glowStrength: { value: 0.5 },
        cloudMap: { value: this.clouds.map },
        cloudOffset: { value: this.clouds.offset },
        cloudScale: { value: this.clouds.scale },
        cloudLight: { value: new THREE.Color(0xffffff) },
        cloudAmount: { value: 0.55 },
      },
      vertexShader: `varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `uniform vec3 zenith; uniform vec3 horizon; uniform vec3 glow;
        uniform vec3 sunDir; uniform float glowStrength;
        uniform sampler2D cloudMap; uniform vec2 cloudOffset;
        uniform float cloudScale; uniform vec3 cloudLight; uniform float cloudAmount;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 c = mix(horizon, zenith, pow(h, 0.65));

          // ฉายทิศทางที่มองอยู่ขึ้นไปบนระนาบเมฆ แล้วอ่านพื้นผิวก้อนเดียวกับที่ใช้ทำเงาบนพื้น
          // ทำในเชเดอร์ของโดม ไม่ได้ใช้ระนาบลอย เพราะกล้องเกมนี้ก้มลงเกือบตลอด
          // ระนาบเมฆจะไปอยู่หลังกล้องแทบทุกมุม
          float up = max(d.y, 0.035);
          vec2 cuv = (d.xz / up) * 5.5 * cloudScale + cloudOffset;
          float cl = texture2D(cloudMap, cuv).r;
          cl *= smoothstep(0.015, 0.20, d.y);      // เมฆต้องไม่ไหลลงไปใต้ขอบฟ้า
          c = mix(c, cloudLight, clamp(cl, 0.0, 1.0) * cloudAmount);
          // แสงฟุ้งรอบดวงอาทิตย์ — ทำให้รู้ว่าตอนนี้แดดมาจากทางไหนโดยไม่ต้องวาดดวงอาทิตย์
          float s = max(0.0, dot(d, normalize(sunDir)));
          c += glow * pow(s, 8.0) * glowStrength;
          gl_FragColor = vec4(c, 1.0);
          // THREE.Color แปลงเลขฐานสิบหกจาก sRGB เป็น linear ให้ตั้งแต่ตอนสร้าง
          // ถ้าเขียนค่านั้นลงบัฟเฟอร์ตรงๆ ท้องฟ้าจะมืดกว่าที่ตั้งไว้มาก (เคยเป็นแบบนั้นมาแล้ว)
          #include <colorspace_fragment>
        }`,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(260, 24, 16), this.skyMat);
    dome.renderOrder = -1;
    dome.frustumCulled = false;
    this.scene.add(dome);
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

  /** เน้นจุดหนึ่งสั้นๆ แล้วคืนกล้องให้ผู้เล่นเหมือนเดิม
   *
   *  ปาฏิหาริย์ตอนนี้แค่ "เกิดขึ้น" — ไม่มีอะไรบอกว่ามันใหญ่
   *  การขยับกล้องเข้าไปหนึ่งวินาทีทำให้มันรู้สึกว่ามีน้ำหนัก
   *  ต้องคืนค่าเดิมเสมอ ห้ามยึดกล้องไปจากผู้เล่น — เขาเป็นคนตั้งมุมไว้เอง
   */
  private punchBack: { dist: number; center: THREE.Vector3 } | null = null;
  private punchLeft = 0;

  emphasise(x: number, y: number, z: number, strength = 0.28) {
    if (!this.punchBack)
      this.punchBack = { dist: this.targetDistance, center: this.targetCenter.clone() };
    this.punchLeft = 1.1;
    this.targetDistance = Math.max(4, this.punchBack.dist * (1 - strength));
    this.targetCenter.lerp(new THREE.Vector3(x, y, z), 0.55);
  }

  private stepPunch(dt: number) {
    if (!this.punchBack) return;
    this.punchLeft -= dt;
    if (this.punchLeft > 0) return;
    this.targetDistance = this.punchBack.dist;
    this.targetCenter.copy(this.punchBack.center);
    this.punchBack = null;
  }

  /** ถอยกลับไปมองทั้งเกาะ */
  resetView() {
    this.targetCenter.set(W / 2, 0, H / 2);
    this.targetDistance = 26;
    this.elevation = 0.92;
  }

  /** ตอนนี้กล้องอยู่ใกล้พอที่จะเห็นคนหรือยัง — HUD ใช้ตัดสินว่าจะโชว์ปุ่มถอยออกไหม */
  get closeUp() { return this.targetDistance < 16; }

  /** วัฏจักรกลางวัน/กลางคืน — phase 0..1 โดย 0.25 คือเที่ยงวัน 0.75 คือเที่ยงคืน
   *  แสงดวงเดียวค้างมุมเดิมทั้งเกมทำให้เกาะดูเป็นภาพนิ่ง ไม่ใช่ที่ที่มีเวลาเดินอยู่ */
  /** ธรรม/อธรรมของรัชสมัย -1..+1 — เรียกทุกเฟรม ค่าที่วาดจริงจะไล่ตามช้าๆ
   *  ต้องเรียกก่อน `setTimeOfDay()` ในเฟรมเดียวกัน เพราะเวลาเป็นคนเอาสีไปใช้ */
  setAlign(align: number, dt = 0.016) {
    const k = Math.min(1, dt * 0.6);
    this.alignShown += (THREE.MathUtils.clamp(align, -1, 1) - this.alignShown) * k;
  }

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
    // เคยเป็น 0.2 + 1.4*d ซึ่งพอรวมกับ hemi แล้วความสว่างรวมทะลุ 1 ตอนเที่ยง
    // ACES ไม่ได้ทำให้ภาพพัง มันแค่ม้วนส่วนที่เกินไปเป็นขาว ทุ่งหญ้าเลยกลายเป็นทุ่งหิมะ
    // (CLAUDE.md จดไว้ว่าปรับ sun เป็น 1.45 แล้วหาย — แต่บรรทัดนี้เขียนทับค่านั้นทุกเฟรม)
    this.sun.intensity = night ? 0.26 + 0.12 * h : 0.18 + 0.92 * d;
    if (night) this.sun.color.copy(this.moon);
    else {
      const noon = this.sunNoon.clone()
        .lerp(this.sunDark, Math.max(0, -this.alignShown) * 0.75)
        .lerp(this.sunHoly, Math.max(0, this.alignShown) * 0.7);
      this.sun.color.copy(this.sunLow).lerp(noon, d);
    }

    // อธรรมทำให้แสงรอบข้างตายลง เงาจึงแข็งขึ้นโดยที่ไม่ต้องแตะเงาเลย
    this.hemi.intensity = (0.34 + 0.28 * d) * (1 - Math.max(0, -this.alignShown) * 0.3);
    this.hemi.color.copy(this.hemiNight).lerp(this.hemiDay, d);

    // สีของกลางวันขึ้นกับรัชสมัย: อธรรมได้ฟ้าสีเลือดจางกับขอบฟ้าสีทราย
    // ธรรมได้ฟ้าใสกว่าและขอบฟ้าที่เกือบเป็นสีขาว
    const dark = Math.max(0, -this.alignShown), holy = Math.max(0, this.alignShown);
    const zDay = this.zenithDay.clone().lerp(this.zenithDark, dark * 0.85)
                                       .lerp(this.zenithHoly, holy * 0.6);
    const hDay = this.horizonDay.clone().lerp(this.horizonDark, dark * 0.8)
                                        .lerp(this.horizonHoly, holy * 0.55);
    const horizon = this.horizonNight.clone().lerp(hDay, d);
    (this.skyMat.uniforms.zenith.value as THREE.Color)
      .copy(this.zenithNight).lerp(zDay, d);
    (this.skyMat.uniforms.horizon.value as THREE.Color).copy(horizon);
    (this.skyMat.uniforms.glow.value as THREE.Color).copy(this.sun.color);
    (this.skyMat.uniforms.sunDir.value as THREE.Vector3)
      .copy(this.sun.position).sub(this.center).normalize();
    this.skyMat.uniforms.glowStrength.value = night ? 0.12 : 0.22 + 0.4 * (1 - d);
    // เมฆกลางวันขาว ตอนเย็นรับแสงส้ม กลางคืนเป็นเงาเทาเข้ม
    (this.skyMat.uniforms.cloudLight.value as THREE.Color)
      .copy(this.cloudNight).lerp(this.sun.color, d);
    // ฟ้าของเทพพิโรธมีเมฆหนากว่าและเงาเมฆเข้มกว่า ฟ้าของเทพเมตตาโปร่งกว่า
    this.skyMat.uniforms.cloudAmount.value =
      (0.30 + 0.32 * d) * (1 + Math.max(0, -this.alignShown) * 0.55
                             - Math.max(0, this.alignShown) * 0.3);
    this.clouds.shadow.value = (0.10 + 0.26 * d) * (1 + Math.max(0, -this.alignShown) * 0.6);
    // หมอกต้องเป็นสีขอบฟ้า ไม่ใช่สีบนหัว ไม่งั้นเกาะฝั่งไกลจะจางไปคนละสีกับฟ้าที่อยู่หลังมัน
    (this.scene.fog as THREE.Fog).color.copy(horizon);
    // โลกของเทพพิโรธมืดลงทั้งใบ ไม่ใช่แค่เปลี่ยนสี
    this.renderer.toneMappingExposure =
      (0.96 + 0.14 * d) * (1 - Math.max(0, -this.alignShown) * 0.14);
  }
  /** เลื่อนแผนที่แบบจับพื้นดินลาก — นิ้วอยู่ตรงไหน พื้นดินตรงนั้นต้องตามไปด้วย
   *
   *  นี่คือการควบคุมหลักของ Black & White และเป็นสิ่งที่เกมนี้ไม่มีมาตลอด
   *  ของเดิมมีแค่หมุนรอบจุดกลางที่ตายตัว แปลว่าผู้เล่นไปดูมุมอื่นของเกาะไม่ได้เลย
   *
   *  ทิศทางอิงกล้อง ไม่ใช่อิงแกนโลก — ลากขึ้น = แผนที่เลื่อนเข้าหาตัวเสมอ
   *  ไม่ว่ากล้องจะหันไปทางไหนอยู่ · และคูณด้วยระยะกล้อง เพราะซูมออกแล้วหนึ่งพิกเซล
   *  ควรกินระยะบนพื้นมากกว่าตอนซูมเข้า ไม่งั้นตอนซูมออกจะรู้สึกว่าลากไม่ไปไหน
   */
  panBy(dxPx: number, dyPx: number) {
    // ปรับให้จุดที่นิ้วกดอยู่ *อยู่กับที่* ใต้นิ้ว ไม่ใช่เลื่อนเร็วกว่าหรือช้ากว่า
    // ที่ระยะกล้อง 26 จอกว้าง ~1568px เห็นเกาะกว้าง 24 หน่วย = 65px ต่อหนึ่งหน่วย
    // ลาก 200px จึงต้องเลื่อนราว 3 หน่วย ไม่ใช่ 11 หน่วยแบบที่ลองครั้งแรก
    const k = this.distance * 0.0006;
    const cos = Math.cos(this.azimuth), sin = Math.sin(this.azimuth);
    // แกนขวาของกล้องบนระนาบพื้น และแกน "เข้าหาจอ"
    this.targetCenter.x += (dxPx * sin - dyPx * cos) * k;
    this.targetCenter.z += (-dxPx * cos - dyPx * sin) * k;
    this.clampCenter();
  }

  /** กันไม่ให้เลื่อนออกไปจนเกาะหลุดจอ — ปล่อยให้ออกนอกขอบได้นิดหน่อยเพื่อดูชายฝั่ง */
  private clampCenter() {
    const m = 6;
    this.targetCenter.x = THREE.MathUtils.clamp(this.targetCenter.x, -m, W + m);
    this.targetCenter.z = THREE.MathUtils.clamp(this.targetCenter.z, -m, H + m);
  }

  /** กลับไปมองกลางเกาะ */
  recentre() {
    this.targetCenter.set(W / 2, 0, H / 2);
  }

  orbitBy(dx: number, dy: number) {
    this.azimuth -= dx * 0.006;
    this.elevation = THREE.MathUtils.clamp(this.elevation - dy * 0.005, 0.28, 1.4);
  }

  /** วาดหนึ่งเฟรมแล้วอ่านพิกเซลกลับมาเฉลี่ยเป็นสีเดียว
   *  ต้องอ่านทันทีหลังวาด เพราะ WebGL ล้างบัฟเฟอร์ทิ้งหลัง composite
   *  (canvas.toDataURL() หรือ drawImage() จากที่อื่นจะได้ภาพดำสนิททุกครั้ง)
   *  มีไว้ให้เทสต์ถามว่า "ภาพที่ออกมาจริงๆ ต่างกันไหม" ไม่ใช่ถามว่า uniform ถูกตั้งไหม */
  sampleAverage(): [number, number, number] {
    this.renderer.render(this.scene, this.camera);
    const gl = this.renderer.getContext();
    // ต้องอ่าน *ทั้งเฟรม* ไม่ใช่มุมล่างซ้าย 160x120 — readPixels นับ y จากล่างขึ้นบน
    // อ่านแค่มุมเดียวจะได้แต่ทะเลกับพื้นล่างจอ ซึ่งเป็นส่วนที่รัชสมัยเปลี่ยนน้อยที่สุดพอดี
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; }
    const n = px.length / 4;
    return [r / n, g / n, b / n];
  }

  /** สั่นกล้องตอนฟ้าผ่าหรือแผ่นดินไหว */
  shake = 0;

  /** `groundAt` ใช้กันกล้องมุดลงไปใต้ดินตอนซูมใกล้ — ฉากไม่รู้จักภูมิประเทศ จึงต้องรับเข้ามา */
  update(dt: number, groundAt?: (x: number, z: number) => number) {
    this.stepPunch(dt);
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

  /** ลมพัดเมฆไปเรื่อยๆ — เรียกทุกเฟรมพร้อมกับ dt ของเกม (คูณความเร็วมาแล้ว)
   *  ใช้ dt ของเกมไม่ใช่นาฬิกาจริง กด 4× แล้วเมฆต้องไหลเร็วขึ้นด้วย */
  driftSky(dt: number) { driftClouds(this.clouds, dt); }

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
