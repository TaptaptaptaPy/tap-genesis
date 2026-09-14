import "./style.css";
import { FixedLoop } from "./core/loop";
import { createGame, stepTick, stepEffects, castSpell, teach, tileAt, isWater,
         SPELLS, type Game } from "./sim/index";
import { draw, type View } from "./render/draw";
import { Hud } from "./ui/hud";
import balance from "../data/balance.json";

const cv = document.getElementById("cv") as HTMLCanvasElement;
const ctx = cv.getContext("2d")!;
const stage = document.getElementById("stage")!;

let game: Game = createGame(Date.now() & 0xffffff);
let armed: string | null = null;
let hover: { x: number; y: number } | null = null;
const view: View = { tileSize: 16, ox: 0, oy: 0, w: 0, h: 0 };

const hud = new Hud(balance.era.names, (id) => {
  armed = armed === id ? null : id;
  hud.setArmed(armed);
  const sp = SPELLS.find((s) => s.id === id)!;
  hud.say(armed ? `เลือก${sp.name}แล้ว — แตะแผนที่` : "ยกเลิก");
});

function resize() {
  const r = stage.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  view.w = r.width; view.h = r.height;
  cv.width = Math.max(1, Math.floor(r.width * dpr));
  cv.height = Math.max(1, Math.floor(r.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  view.tileSize = Math.min(r.width / balance.world.W, r.height / balance.world.H);
  view.ox = (r.width - view.tileSize * balance.world.W) / 2;
  view.oy = (r.height - view.tileSize * balance.world.H) / 2;
}
window.addEventListener("resize", resize);

function toTile(e: PointerEvent) {
  const r = cv.getBoundingClientRect();
  return {
    x: Math.floor((e.clientX - r.left - view.ox) / view.tileSize),
    y: Math.floor((e.clientY - r.top - view.oy) / view.tileSize),
  };
}

cv.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  const p = toTile(e);
  if (p.x < 0 || p.y < 0 || p.x >= balance.world.W || p.y >= balance.world.H) return;
  const s = game.state;
  const log = (m: string) => s.log.push(m);

  if (armed) { castSpell(s, armed, p.x, p.y, game.rng, log); return; }

  const t = tileAt(s.tiles, p.x, p.y);
  if (t?.village) {
    const v = t.village;
    hud.say(`หมู่บ้าน${v.name} · ผู้คน ${Math.round(v.pop)} · ศรัทธา ${(v.belief * 100) | 0}%`);
  } else if (t && !isWater(t.biome) && s.creature.alive) {
    s.creature.act = "wander";
    s.creature.tgt = { x: p.x, y: p.y };
    hud.say("ท่านเรียกสัตว์ไปยังจุดนั้น");
  }
});
cv.addEventListener("pointermove", (e) => {
  const p = toTile(e);
  hover = p.x >= 0 && p.y >= 0 && p.x < balance.world.W && p.y < balance.world.H ? p : null;
});
cv.addEventListener("pointerleave", () => (hover = null));

document.getElementById("bPraise")!.onclick = () =>
  teach(game.state, 1, (m) => hud.say(m));
document.getElementById("bScold")!.onclick = () =>
  teach(game.state, -1, (m) => hud.say(m));
document.getElementById("bGen")!.onclick = () => {
  document.getElementById("genome")!.classList.toggle("hidden");
  hud.drawGenome(game.state);
};
document.getElementById("bNew")!.onclick = () => {
  if (confirm("เริ่มโลกใหม่ทั้งหมด?")) newGame();
};
const bSpeed = document.getElementById("bSpeed") as HTMLButtonElement;
bSpeed.onclick = () => {
  loop.speed = loop.speed === 1 ? 2 : loop.speed === 2 ? 4 : 1;
  bSpeed.textContent = loop.speed + "×";
};
document.addEventListener("keydown", (e) => {
  if (e.key === "p") loop.paused = !loop.paused;
  if (e.key === "a") teach(game.state, 1, (m) => hud.say(m));
  if (e.key === "z") teach(game.state, -1, (m) => hud.say(m));
});

let lastEra = -1;
const loop = new FixedLoop(
  balance.time.tickSeconds,
  () => stepTick(game),
  (dt, now) => {
    const s = game.state;
    stepEffects(s, dt);
    if (Math.abs(stage.clientWidth - view.w) > 1 || Math.abs(stage.clientHeight - view.h) > 1) resize();
    if (s.era !== lastEra) { lastEra = s.era; hud.buildSpells(s.era, s.align, armed); }
    const sp = armed ? SPELLS.find((x) => x.id === armed)! : null;
    draw(ctx, s, view, now, hover, sp ? sp.radius : null, sp?.dark ?? false);
    hud.update(s);
  },
);

function newGame() {
  game = createGame(Date.now() & 0xffffff);
  armed = null; lastEra = -1;
  resize();
  hud.say("โลกใหม่ถือกำเนิด");
}

newGame();
loop.start();
