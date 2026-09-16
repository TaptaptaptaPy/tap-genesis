/** เพลงประกอบ — เปลี่ยนตามสิ่งที่กำลังเกิดขึ้นในเกม ไม่ใช่เล่นวนเฉยๆ
 *
 *  เพลงที่เล่นวนไม่หยุดกลายเป็นเสียงรบกวนภายในสิบนาที
 *  เพลงที่เปลี่ยนตามสถานะบอกผู้เล่นว่า "ตอนนี้เรื่องกำลังไปทางไหน" โดยไม่ต้องอ่านตัวเลข
 *  ซึ่งเป็นข้อมูล ไม่ใช่การตกแต่ง
 *
 *  กติกา: ต้องเริ่มจาก event ของผู้ใช้จริงเท่านั้น เบราว์เซอร์บล็อกเสียงอัตโนมัติ
 *  และต้องเงียบสนิทได้ ผู้เล่นบางคนเล่นในที่ที่เปิดเสียงไม่ได้
 */
export class Bgm {
  private tracks = new Map<string, HTMLAudioElement>();
  private current: string | null = null;
  private wanted: string | null = null;
  private started = false;
  private muted = false;
  /** ระดับเสียงสูงสุดของเพลง — เบากว่าเสียงเอฟเฟกต์เสมอ เพลงไม่ควรกลบสิ่งที่ผู้เล่นทำ */
  private peak = 0.34;

  constructor(base: string, names: string[]) {
    for (const n of names) {
      const a = new Audio();
      a.loop = true;
      a.volume = 0;
      a.preload = "none";      // อย่าเพิ่งโหลดจนกว่าจะถูกใช้จริง iPad คิดค่าเน็ตเป็นเมกะ
      this.tracks.set(n, a);
      this.sources.set(n, `${base}/${n}.m4a`);
    }
  }

  /** ที่อยู่จริงของแต่ละเพลง — ตั้งทีหลังได้ เผื่อเพลงมาเป็น data URI แทนไฟล์ */
  private sources = new Map<string, string>();

  /** แทนที่ที่อยู่ของเพลงทั้งชุด
   *
   *  ใช้ตอนเอาเกมไปวางบนโฮสต์ที่เสิร์ฟเฉพาะชนิดไฟล์เว็บมาตรฐาน — `.m4a` ไม่อยู่ในนั้น
   *  เพลงจึงถูกมัดเป็น JSON (base64) แล้วแปลงกลับเป็น data URI ตอนรันแทน
   *  ถ้าไฟล์ชุดนั้นไม่มี ก็ใช้ที่อยู่เดิม เพลงหายไปเฉยๆ ไม่ทำให้เกมพัง
   */
  useSources(map: Record<string, string>) {
    for (const [n, url] of Object.entries(map)) if (this.tracks.has(n)) this.sources.set(n, url);
  }

  /** โหลดเพลงจริงตอนจะใช้ — `src` ถูกตั้งช้าที่สุดเท่าที่จะช้าได้ */
  private arm(name: string) {
    const a = this.tracks.get(name);
    const src = this.sources.get(name);
    if (a && src && !a.src) a.src = src;
  }

  /** ต้องเรียกจาก pointerdown/keydown จริงเท่านั้น */
  unlock() {
    if (this.started) return;
    this.started = true;
    if (this.wanted) this.play(this.wanted);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (m) for (const a of this.tracks.values()) { a.pause(); a.volume = 0; }
    else if (this.wanted) this.play(this.wanted);
  }

  /** บอกว่าตอนนี้ควรเป็นเพลงไหน เรียกได้ทุกเฟรม ซ้ำได้ ไม่มีผลถ้าเหมือนเดิม */
  want(name: string | null) {
    this.wanted = name;
    if (this.started && !this.muted) this.play(name);
  }

  private play(name: string | null) {
    if (name === this.current) return;
    this.current = name;
    for (const [n, a] of this.tracks) {
      if (n === name) {
        this.arm(n);
        a.preload = "auto";
        void a.play().catch(() => { /* เบราว์เซอร์ยังไม่ยอม ไม่เป็นไร ลองใหม่คราวหน้า */ });
      }
    }
  }

  /** ไล่ระดับเสียงเข้าหาเป้าหมายทีละนิด — ตัดเพลงดิบๆ ฟังแล้วสะดุด
   *  เรียกทุกเฟรมพร้อม dt จริง (วินาที) */
  update(dt: number) {
    if (this.muted) return;
    for (const [n, a] of this.tracks) {
      const target = n === this.current ? this.peak : 0;
      const k = Math.min(1, dt * 0.9);
      a.volume = Math.max(0, Math.min(1, a.volume + (target - a.volume) * k));
      if (a.volume < 0.002 && n !== this.current && !a.paused) a.pause();
    }
  }
}
