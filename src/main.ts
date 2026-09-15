import "./style.css";
import { FixedLoop } from "./core/loop";
import { createGame, stepTick, stepEffects, castSpell, teach, command,
         snapshot, restore, saveLooksValid, totalPop,
         SPELLS, type Game, type CommandId } from "./sim/index";
import { World3D } from "./render/world3d";
import { Terrain3D } from "./render/terrain3d";
import { Creature3D, Villages3D } from "./render/actors3d";
import { Fx3D } from "./render/fx3d";
import { Hud } from "./ui/hud";
import { clearSlot, readSlot, slotMeta, writeSlot, SLOTS, type SlotId } from "./core/storage";
import balance from "../data/balance.json";

const cv = document.getElementById("cv") as HTMLCanvasElement;
const stage = document.getElementById("stage")!;
const { W, H } = balance.world;

let game: Game = createGame(Date.now() & 0xffffff);
let armed: string | null = null;
let armedCmd: CommandId | null = null;
let hover: { x: number; y: number } | null = null;
let selected: { x: number; y: number } | null = null;

const world = new World3D(cv);
let terrain = new Terrain3D(game.state);
const villages = new Villages3D();
const creature = new Creature3D();
const fx = new Fx3D();
world.scene.add(terrain.group, villages.group, creature.root, fx.group);

const hud = new Hud((id) => {
  armedCmd = null; hud.setCommand(null);
  armed = armed === id ? null : id;
  hud.setArmed(armed);
  const sp = SPELLS.find((s) => s.id === id)!;
  hud.say(armed ? `${sp.name} — แตะบนเกาะเพื่อร่าย (${sp.hint})` : "ยกเลิก");
});

function rebuildTerrain() {
  world.scene.remove(terrain.group);
  terrain = new Terrain3D(game.state);
  world.scene.add(terrain.group);
}

// ───────────────────────── นิ้วและเมาส์ ─────────────────────────

const pointers = new Map<number, { x: number; y: number }>();
let dragged = false;
let last = { x: 0, y: 0 };
let pinchDist = 0;

const localPos = (e: PointerEvent) => {
  const r = cv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

cv.addEventListener("pointerdown", (e) => {
  // บาง pointer (เช่นที่ถูกยิงจากเครื่องมืออัตโนมัติ) ทำให้ setPointerCapture โยน error
  // ถ้าไม่ดักไว้ pointerdown จะตายกลางคันและการแตะครั้งนั้นหายไปทั้งครั้ง
  try { cv.setPointerCapture(e.pointerId); } catch { /* ไม่จำเป็นต้องจับ pointer ก็เล่นได้ */ }
  const p = localPos(e);
  pointers.set(e.pointerId, p);
  if (pointers.size === 1) { last = p; dragged = false; }
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
  }
});

cv.addEventListener("pointermove", (e) => {
  const p = localPos(e);
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);

  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist > 0 && d > 0) { world.zoomBy(pinchDist / d); dragged = true; }
    pinchDist = d;
    return;
  }
  if (pointers.size === 1) {
    const dx = p.x - last.x, dy = p.y - last.y;
    if (!dragged && Math.hypot(p.x - last.x, p.y - last.y) > 5) dragged = true;
    if (dragged) world.orbitBy(dx, dy);
    last = p;
  }
  hover = world.pick(p.x, p.y, [terrain.ground]);
});

cv.addEventListener("pointerup", (e) => {
  const wasSingle = pointers.size === 1;
  const p = localPos(e);
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchDist = 0;
  if (!wasSingle || dragged) return;
  onTap(p.x, p.y);
});
cv.addEventListener("pointercancel", (e) => pointers.delete(e.pointerId));
cv.addEventListener("pointerleave", () => (hover = null));
cv.addEventListener("wheel", (e) => {
  e.preventDefault();
  world.zoomBy(e.deltaY > 0 ? 1.1 : 1 / 1.1);
}, { passive: false });

function onTap(sx: number, sy: number) {
  const hit = world.pick(sx, sy, [terrain.ground]);
  if (!hit) return;
  const s = game.state;
  const log = (m: string) => hud.say(m);

  if (armed) {
    const before = s.terrainVersion;
    castSpell(s, armed, hit.x, hit.y, game.rng, log);
    if (s.terrainVersion !== before) rebuildTerrain();
    return;
  }
  if (armedCmd) {
    command(s, armedCmd, hit.x, hit.y);
    hud.say(armedCmd === "stay" ? "สั่งให้อยู่ตรงนั้น"
          : armedCmd === "eatHere" ? "สั่งให้ไปหากินตรงนั้น" : "เรียกให้ไปตรงนั้น");
    armedCmd = null; hud.setCommand(null);
    return;
  }
  selected = hit;
  hud.drawInspect(s, hit.x, hit.y);
}

// ───────────────────────── ปุ่ม ─────────────────────────

document.getElementById("bPraise")!.onclick = () => teach(game.state, 1, game.rng, (m) => hud.say(m));
document.getElementById("bScold")!.onclick = () => teach(game.state, -1, game.rng, (m) => hud.say(m));

function armCommand(kind: CommandId) {
  armed = null; hud.setArmed(null);
  armedCmd = armedCmd === kind ? null : kind;
  hud.setCommand(armedCmd);
  hud.say(armedCmd ? "แตะบนเกาะเพื่อบอกว่าตรงไหน" : "ยกเลิก");
}
document.getElementById("cStay")!.onclick = () => armCommand("stay");
document.getElementById("cEat")!.onclick = () => armCommand("eatHere");
document.getElementById("cGo")!.onclick = () => armCommand("goTo");

document.getElementById("bGen")!.onclick = () => {
  document.getElementById("inspect")!.classList.add("hidden");
  document.getElementById("menu")!.classList.add("hidden");
  document.getElementById("genome")!.classList.toggle("hidden");
  hud.drawGenome(game.state);
};
document.getElementById("bMenu")!.onclick = () => toggleMenu();

const bSpeed = document.getElementById("bSpeed") as HTMLButtonElement;
bSpeed.onclick = () => {
  loop.speed = loop.speed === 1 ? 2 : loop.speed === 2 ? 4 : 1;
  bSpeed.textContent = loop.speed + "×";
};

document.addEventListener("keydown", (e) => {
  if (e.key === "p") loop.paused = !loop.paused;
  if (e.key === "a") teach(game.state, 1, game.rng, (m) => hud.say(m));
  if (e.key === "z") teach(game.state, -1, game.rng, (m) => hud.say(m));
  if (e.key === "Escape") {
    armed = null; armedCmd = null; hud.setArmed(null); hud.setCommand(null);
    for (const id of ["genome", "inspect", "menu"]) document.getElementById(id)!.classList.add("hidden");
    selected = null;
  }
});

// ───────────────────────── เซฟ / โหลด ─────────────────────────

const metaOf = () => ({
  at: Date.now(), year: game.state.year, era: "",
  villages: game.state.villages.length, pop: Math.round(totalPop(game.state)),
});

function saveTo(slot: SlotId, quiet = false) {
  const ok = writeSlot(slot, snapshot(game), metaOf());
  if (!quiet) hud.say(ok ? "บันทึกแล้ว" : "บันทึกไม่สำเร็จ (พื้นที่เก็บเต็ม?)");
}

function loadFrom(slot: SlotId) {
  const r = readSlot(slot);
  if (!r || !saveLooksValid(r.state, W * H)) { hud.say("ช่องนี้ว่าง หรือเซฟมาจากเกมคนละรุ่น"); return; }
  game = restore(r.state);
  armed = null; armedCmd = null; selected = null;
  hud.setArmed(null); hud.setCommand(null);
  hud.buildSpells(game.state.align, null);
  rebuildTerrain();
  hud.say("โหลดโลกแล้ว");
  toggleMenu(false);
}

function toggleMenu(force?: boolean) {
  const el = document.getElementById("menu")!;
  const show = force ?? el.classList.contains("hidden");
  el.classList.toggle("hidden", !show);
  if (!show) return;
  document.getElementById("genome")!.classList.add("hidden");
  document.getElementById("inspect")!.classList.add("hidden");

  let h = "<h3>โลกของท่าน</h3>";
  for (const slot of SLOTS) {
    const m = slotMeta(slot);
    const name = slot === "auto" ? "อัตโนมัติ" : `ช่อง ${slot}`;
    const desc = m ? `ปีที่ ${m.year} · ${m.villages} หมู่บ้าน · ${m.pop} คน` : "ว่าง";
    h += `<div class="slot">
      <div class="slotinfo"><b>${name}</b><small>${desc}</small></div>
      <button data-save="${slot}">บันทึก</button>
      <button data-load="${slot}" ${m ? "" : "disabled"}>โหลด</button>
      <button data-wipe="${slot}" class="danger" ${m ? "" : "disabled"}>ลบ</button>
    </div>`;
  }
  h += `<hr><div class="slot"><div class="slotinfo"><b>โลกใหม่</b><small>เริ่มต้นใหม่ทั้งหมด</small></div>
        <button data-new="1" class="danger">สร้างโลกใหม่</button></div>`;
  h += `<div class="sub">เกมบันทึกลงช่องอัตโนมัติให้เองทุกๆ ไม่กี่นาที</div>`;
  el.innerHTML = h;

  el.querySelectorAll<HTMLButtonElement>("[data-save]").forEach((b) =>
    (b.onclick = () => { saveTo(b.dataset.save as SlotId); toggleMenu(true); }));
  el.querySelectorAll<HTMLButtonElement>("[data-load]").forEach((b) =>
    (b.onclick = () => loadFrom(b.dataset.load as SlotId)));
  el.querySelectorAll<HTMLButtonElement>("[data-wipe]").forEach((b) =>
    (b.onclick = () => { clearSlot(b.dataset.wipe as SlotId); toggleMenu(true); }));
  el.querySelector<HTMLButtonElement>("[data-new]")!.onclick = () => {
    if (confirm("เริ่มโลกใหม่ทั้งหมด?")) { newGame(); toggleMenu(false); }
  };
}

// ───────────────────────── ลูปหลัก ─────────────────────────

let lastAutosave = 0;
const loop = new FixedLoop(
  balance.time.tickSeconds,
  () => {
    stepTick(game);
    const s = game.state;
    if (s.tick - lastAutosave >= 240) { lastAutosave = s.tick; saveTo("auto", true); }
  },
  (dt, now) => {
    const s = game.state;
    stepEffects(s, dt);
    const r = stage.getBoundingClientRect();
    if (Math.abs(r.width - world.width) > 1 || Math.abs(r.height - world.height) > 1) world.resize();

    world.shake = Math.max(world.shake, s.shake);
    terrain.update(s, now);
    villages.update(s, now);
    creature.update(s, s.creature, now);
    const sp = armed ? SPELLS.find((x) => x.id === armed)! : null;
    fx.setCursor(s, hover ?? selected, sp ? sp.radius : null, sp?.dark ?? false);
    fx.update(s, now);

    world.update(dt);
    world.render();
    hud.update(s);
    if (selected && !document.getElementById("inspect")!.classList.contains("hidden")
        && s.tick % 8 === 0) hud.drawInspect(s, selected.x, selected.y);
  },
);

function showFirstHint() {
  const el = document.getElementById("firsthint")!;
  if (localStorage.getItem("genesis:seenHint3d") === "1") return;
  el.classList.remove("hidden");
  el.innerHTML = `<b>ท่านคือเทพเจ้าของเกาะนี้</b>
    <ol>
      <li>ผู้คนจะบอกเองว่าขาดอะไร — ดูป้ายลอยเหนือหมู่บ้าน กับแถบคำแนะนำกลางจอ</li>
      <li>เลือกปาฏิหาริย์ด้านล่าง แล้วแตะลงบนเกาะตรงจุดที่ต้องการ</li>
      <li>ยิ่งดูแลคนได้ดี ศรัทธายิ่งไหลเข้ามา และร่ายคาถาใหญ่ได้มากขึ้น</li>
      <li>สัตว์ของท่านเรียนจากท่าน — กด ✦ หรือ ✕ ทันทีหลังมันทำอะไรสักอย่าง</li>
    </ol>
    <div class="sub">ลากเพื่อหมุนกล้อง · หนีบสองนิ้วหรือใช้ล้อเมาส์เพื่อซูม</div>
    <button id="hintOk">เริ่มเลย</button>`;
  document.getElementById("hintOk")!.onclick = () => {
    el.classList.add("hidden");
    try { localStorage.setItem("genesis:seenHint3d", "1"); } catch { /* ไม่เป็นไร */ }
  };
}

function newGame() {
  game = createGame(Date.now() & 0xffffff);
  armed = null; armedCmd = null; selected = null; lastAutosave = 0;
  rebuildTerrain();
  world.resize();
  hud.buildSpells(game.state.align, null);
  hud.say("เกาะใหม่ผุดขึ้นจากทะเล");
  showFirstHint();
}

const auto = readSlot("auto");
if (auto && saveLooksValid(auto.state, W * H)) {
  game = restore(auto.state);
  rebuildTerrain();
  world.resize();
  hud.buildSpells(game.state.align, null);
  hud.say(`เล่นต่อจากปีที่ ${game.state.year}`);
} else {
  newGame();
}
window.addEventListener("resize", () => world.resize());

// เปิดทางให้ตรวจสอบฉากจาก console ตอนพัฒนา — ชั้น 3 มิติดีบั๊กยากถ้ามองจากข้างนอกไม่ได้
if (import.meta.env.DEV)
  (window as unknown as Record<string, unknown>).__genesis =
    { get game() { return game; }, world, villages, creature, terrain: () => terrain,
      state: () => ({ pointers: pointers.size, dragged, armed }) };
loop.start();
