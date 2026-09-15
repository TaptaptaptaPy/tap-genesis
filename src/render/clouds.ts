import * as THREE from "three";

/** เมฆ — ใช้พื้นผิวเดียวกันทั้งบนฟ้าและเป็นเงาบนพื้น
 *
 *  ถ้าเมฆบนฟ้ากับเงาบนพื้นมาจากคนละที่ มันจะไม่ตรงกัน แล้วสมองคนดูจับได้ทันที
 *  ว่าเงานั้นไม่ได้มาจากเมฆก้อนนั้น — ที่นี่จึงใช้พื้นผิวก้อนเดียวและออฟเซ็ตชุดเดียว
 *
 *  เมฆถูกวาดในเชเดอร์ของโดมท้องฟ้า ไม่ได้เป็นระนาบลอยอยู่
 *  เพราะกล้องเกมนี้ส่วนใหญ่ก้มลง ระนาบเมฆจะอยู่หลังกล้องเกือบตลอดเวลา
 */

/** สร้างพื้นผิวเมฆแบบต่อขอบได้ ด้วย fBm จากตัวสุ่มที่กำหนด seed ได้
 *  ต่อขอบได้เป็นเรื่องจำเป็น เพราะพื้นผิวนี้ถูกปูซ้ำทั้งท้องฟ้าและทั้งเกาะ */
export function cloudTexture(size = 256): THREE.DataTexture {
  const hash = (x: number, y: number) => {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);

  /** value noise ที่ต่อขอบได้ — พิกัดกริดถูกวนด้วย % period */
  const noise = (x: number, y: number, period: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const wrap = (v: number) => ((v % period) + period) % period;
    const a = hash(wrap(xi), wrap(yi));
    const b = hash(wrap(xi + 1), wrap(yi));
    const c = hash(wrap(xi), wrap(yi + 1));
    const d = hash(wrap(xi + 1), wrap(yi + 1));
    const u = smooth(xf), v = smooth(yf);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  };

  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0, amp = 0.5, period = 4;
      for (let o = 0; o < 5; o++) {
        v += noise((x / size) * period, (y / size) * period, period) * amp;
        amp *= 0.5; period *= 2;
      }
      // ดันให้เป็นก้อนแยกกัน ไม่ใช่หมอกเทาทั้งผืน
      const c = Math.max(0, (v - 0.42) / 0.58);
      data[y * size + x] = Math.round(Math.min(1, c * c * (3 - 2 * c)) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** ค่าที่ทุกคนที่วาดเมฆหรือเงาเมฆต้องใช้ร่วมกัน */
export interface CloudSky {
  map: THREE.DataTexture;
  /** เลื่อนไปตามลม หน่วยเดียวกับ UV ของพื้นผิว */
  offset: THREE.Vector2;
  /** ขนาดเมฆเทียบกับหน่วยโลก — เลขน้อย = ก้อนใหญ่ */
  scale: number;
  /** ความเข้มของเงาบนพื้น 0-1 */
  shadow: { value: number };
}

export function makeClouds(): CloudSky {
  return {
    map: cloudTexture(),
    offset: new THREE.Vector2(0, 0),
    scale: 0.055,
    shadow: { value: 0.34 },
  };
}

/** ลมพัดเมฆไปเรื่อยๆ — เรียกทุกเฟรม */
export function driftClouds(c: CloudSky, dt: number) {
  c.offset.x += dt * 0.011;
  c.offset.y += dt * 0.006;
}

/** แปะเงาเมฆลงบนวัสดุที่มีอยู่แล้ว โดยไม่ต้องเขียนเชเดอร์ใหม่ทั้งตัว
 *
 *  เมฆบนโดมท้องฟ้ามองไม่เห็นเลยด้วยมุมกล้องปกติ เพราะกล้องก้มลงราว 53 องศา
 *  ทั้งเฟรมจึงอยู่ "ใต้" เส้นขอบฟ้า — ครึ่งที่ผู้เล่นเห็นจริงคือเงาที่พาดบนพื้น
 *  ใช้พื้นผิวและออฟเซ็ตก้อนเดียวกับบนฟ้า เงากับก้อนเมฆจะได้เคลื่อนไปด้วยกัน
 */
export function applyCloudShadow(mat: THREE.Material, sky: CloudSky): void {
  patchMaterial(mat, (shader) => {
    shader.uniforms.cloudMap = { value: sky.map };
    shader.uniforms.cloudOffset = { value: sky.offset };
    shader.uniforms.cloudScale = { value: sky.scale };
    shader.uniforms.cloudShadow = sky.shadow;

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCloudPos;")
      .replace("#include <begin_vertex>",
               "#include <begin_vertex>\nvCloudPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>",
               "#include <common>\nvarying vec3 vCloudPos;\nuniform sampler2D cloudMap;" +
               "\nuniform vec2 cloudOffset;\nuniform float cloudScale;\nuniform float cloudShadow;")
      .replace("#include <dithering_fragment>",
               "float cShade = texture2D(cloudMap, vCloudPos.xz * cloudScale + cloudOffset).r;" +
               "\ngl_FragColor.rgb *= 1.0 - cShade * cloudShadow;" +
               "\n#include <dithering_fragment>");
  });
}

/** ต่อการแก้เชเดอร์เข้ากับของเดิม แทนที่จะเขียนทับ
 *  วัสดุหนึ่งตัวมี `onBeforeCompile` ได้ช่องเดียว ถ้าใครมาทีหลังเขียนทับ
 *  ของคนแรกจะหายไปเงียบๆ (ต้นไม้ต้องมีทั้งเงาเมฆและลม) */
export function patchMaterial(
  mat: THREE.Material,
  fn: (shader: THREE.WebGLProgramParametersWithUniforms) => void,
): void {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    fn(shader);
  };
  mat.needsUpdate = true;
}

/** ลมพัดใบไม้และหญ้า — ยอดไหวมาก โคนไม่ไหวเลย
 *
 *  ใช้ตำแหน่งของ instance เป็นเฟส ต้นที่อยู่คนละที่จึงไม่ไหวพร้อมกัน
 *  ถ้าไหวพร้อมกันหมดจะดูเหมือนทั้งป่าเป็นชิ้นเดียว ไม่ใช่ต้นไม้หลายต้น
 */
export function applyWind(mat: THREE.Material, wind: { value: number }, strength = 0.055): void {
  patchMaterial(mat, (shader) => {
    shader.uniforms.windTime = wind;
    shader.uniforms.windAmp = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float windTime;\nuniform float windAmp;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float wph = instanceMatrix[3][0] * 0.83 + instanceMatrix[3][2] * 1.37;
        #else
          float wph = 0.0;
        #endif
        float wsway = sin(windTime * 1.5 + wph) * windAmp
                    + sin(windTime * 2.9 + wph * 1.7) * windAmp * 0.45;
        // ยกกำลังสองของความสูง = โคนนิ่งสนิท ยอดไหวเต็มที่
        float wlift = transformed.y * transformed.y;
        transformed.x += wsway * wlift;
        transformed.z += wsway * 0.55 * wlift;`);
  });
}
