/** ลูปเวลาแบบ fixed timestep: ตรรกะเกมเดินเป็นจังหวะคงที่ ภาพวาดตาม refresh rate
 *  แยกกันแบบนี้ทำให้เร่งความเร็ว (2x/4x) ได้โดยสมดุลเกมไม่เพี้ยน */
export class FixedLoop {
  private acc = 0;
  private last = 0;
  private raf = 0;
  speed = 1;
  paused = false;

  constructor(
    private stepSeconds: number,
    private onTick: () => void,
    private onFrame: (dtSeconds: number, nowMs: number) => void,
  ) {}

  start() {
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000 || 0);
      this.last = now;
      if (!this.paused) {
        this.acc += dt * this.speed;
        let guard = 0;
        while (this.acc >= this.stepSeconds && guard++ < 240) {
          this.acc -= this.stepSeconds;
          this.onTick();
        }
      }
      this.onFrame(dt * this.speed, now);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop() { cancelAnimationFrame(this.raf); }
}
