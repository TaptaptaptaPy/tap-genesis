/** เสียงทั้งเกม สังเคราะห์สดด้วย Web Audio ไม่มีไฟล์เสียงสักไฟล์
 *
 *  เหตุผลที่ไม่ใช้ไฟล์: เกมนี้เปิดจาก dev server บน Wi-Fi บ้านแล้วเล่นบน iPad
 *  ไฟล์เสียงหมายถึง bundle ใหญ่ขึ้นและต้องโหลดก่อนเล่น ส่วนการสังเคราะห์เองใช้โค้ดไม่กี่สิบบรรทัด
 *
 *  กติกา: เบราว์เซอร์ไม่ยอมให้เล่นเสียงจนกว่าผู้ใช้จะแตะจอครั้งแรก
 *  `unlock()` จึงต้องถูกเรียกจาก event ของผู้ใช้จริงเท่านั้น
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

export function unlock() {
  if (ctx) { void ctx.resume(); return; }
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  } catch { ctx = null; }
}

export function setMuted(v: boolean) {
  muted = v;
  if (master && ctx) master.gain.setTargetAtTime(v ? 0 : 0.5, ctx.currentTime, 0.05);
}
export const isMuted = () => muted;

/** โทนเดียว รูปคลื่นเลือกได้ พร้อมซองเสียงแบบ attack/decay ง่ายๆ */
function tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number) {
  if (!ctx || !master || muted) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + Math.min(0.02, dur * 0.2));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

/** เสียงซ่า ใช้ทำฝน ไฟ และแผ่นดินไหว */
function noise(dur: number, vol: number, hz: number, q = 1) {
  if (!ctx || !master || muted) return;
  const t = ctx.currentTime;
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = "bandpass"; f.frequency.value = hz; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t);
}

/** เสียงของแต่ละคาถา — คนละบุคลิกกัน ฟังแล้วรู้ว่าร่ายอะไรไปโดยไม่ต้องดูจอ */
export const sfx = {
  rain:  () => { noise(1.6, 0.16, 2400, 0.6); tone(320, 0.5, "sine", 0.05, 240); },
  grove: () => { tone(392, 0.5, "triangle", 0.11, 784); tone(523, 0.7, "sine", 0.07); },
  bless: () => { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.8, "sine", 0.09), i * 90)); },
  heal:  () => { tone(660, 0.6, "sine", 0.1, 990); tone(880, 0.5, "sine", 0.05); },
  seed:  () => { [262, 330, 392, 523].forEach((f, i) => setTimeout(() => tone(f, 0.6, "triangle", 0.09), i * 70)); },
  bolt:  () => { noise(0.5, 0.34, 1600, 0.4); tone(90, 0.45, "sawtooth", 0.16, 40); },
  quake: () => { noise(1.5, 0.3, 90, 0.8); tone(52, 1.3, "sine", 0.2, 28); },

  praise: () => { tone(784, 0.18, "sine", 0.1); setTimeout(() => tone(1046, 0.22, "sine", 0.09), 70); },
  scold:  () => { tone(196, 0.24, "square", 0.08, 140); },
  lift:   () => { tone(440, 0.16, "sine", 0.07, 660); },
  place:  () => { tone(330, 0.2, "sine", 0.07, 220); },
  ask:    () => { tone(587, 0.2, "triangle", 0.06); },
  disaster: () => { tone(160, 0.7, "sawtooth", 0.1, 90); noise(0.7, 0.1, 500, 0.7); },
  win:    () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 1.1, "sine", 0.11), i * 160)); },
  deny:   () => { tone(220, 0.14, "square", 0.05, 180); },

  // เสียงที่เคยขาด — เหตุการณ์ที่เกิดขึ้นแล้วเงียบสนิท ผู้เล่นจึงไม่รู้ว่ามันเกิด
  /** ลูบสัตว์ — เบาและอุ่น ต่างจากคำชมที่เป็นเสียงสูงชัดเจน */
  stroke: () => { tone(392, 0.28, "sine", 0.05, 466); },
  /** ตีสัตว์ตอนมันไม่ได้ทำอะไร — ทื่อและไม่มีปลาย ฟังแล้วรู้ว่าไม่ใช่การสอน */
  smack:  () => { noise(0.12, 0.13, 600, 0.5); tone(140, 0.18, "square", 0.07, 110); },
  /** ของที่ขว้างไปตกถึงพื้น */
  land:   () => { noise(0.1, 0.1, 400, 0.6); tone(180, 0.12, "triangle", 0.05, 120); },
  /** ทิ้งคนลงทะเล — เสียงที่ควรทำให้รู้สึกผิด */
  splash: () => { noise(0.5, 0.14, 1400, 0.5); tone(300, 0.35, "sine", 0.05, 160); },
  /** ผลร่วมของคาถาเกิดขึ้น — บอกว่าที่เพิ่งทำไปมีอะไรพิเศษ */
  combo:  () => { [659, 880, 1174].forEach((f, i) => setTimeout(() => tone(f, 0.45, "sine", 0.08), i * 60)); },
  /** ชาวบ้านที่ถูกอุ้มกลับบ้านกลายเป็นนักบวช */
  priest: () => { [523, 784].forEach((f, i) => setTimeout(() => tone(f, 0.9, "sine", 0.07), i * 130)); },
  /** สัตว์ตาย */
  died:   () => { [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.9, "triangle", 0.09), i * 200)); },
  /** หมู่บ้านใหม่ตั้งขึ้น */
  found:  () => { [330, 415, 494].forEach((f, i) => setTimeout(() => tone(f, 0.5, "triangle", 0.08), i * 80)); },
};
