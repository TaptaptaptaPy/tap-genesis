import "./style.css";
import { FixedLoop } from "./core/loop";
import { createGame, stepTick, stepEffects, castSpell, teach, command,
         snapshot, restore, saveLooksValid, loyalPop, totalPop,
         SPELLS, type Game, type CommandId } from "./sim/index";
import { draw, TerrainCache } from "./render/draw";
import { Camera } from "./render/camera";
import { Hud } from "./ui/hud";
import { clearSlot, readSlot, slotMeta, writeSlot, SLOTS, type SlotId } from "./core/storage";
import balance from "../data/balance.json";

const cv = document.getElementById("cv") as HTMLCanvasElement;
const ctx = cv.getContext("2d")!;
const stage = document.getElementById("stage")!;
const { W, H } = balance.world;

let game: Game = createGame(Date.now() & 0xffffff);
let armed: string | null = null;
let armedCmd: CommandId | null = null;
let hover: { x: number; y: number } | null = null;
let selected: { x: number; y: number } | null = null;
let showMemory = false;

const cam = new Camera();
const terrain = new TerrainCache();
const hud = new Hud(balance.era.names, (id) => {
  armedCmd = null; hud.setCommand(null);
  armed = armed === id ? null : id;
  hud.setArmed(armed);
  const sp = SPELLS.find((s) => s.id === id)!;
  hud.say(armed ? `${sp.name} — แตะแผนที่ (${sp.hint})` : "ยกเลิก");
});

// ───────────────────────── ขนาดจอ ─────────────────────────

function resize() {
  const r = stage.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.max(1, Math.floor(r.width * dpr));
  cv.height = Math.max(1, Math.floor(r.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cam.resize(r.width, r.height);
}
window.addEventListener("resize", resize);

// ───────────────────────── นิ้วและเมาส์ ─────────────────────────

const pointers = new Map<number, { x: number; y: number }>();
let dragStart: { x: number; y: number; cx: number; cy: number } | null = null;
let dragged = false;
let pinchDist = 0;

const localPos = (e: PointerEvent) => {
  const r = cv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

cv.addEventListener("pointerdown", (e) => {
  cv.setPointerCapture(e.pointerId);
  const p = localPos(e);
  pointers.set(e.pointerId, p);
  if (pointers.size === 1) { dragStart = { x: p.x, y: p.y, cx: cam.cx, cy: cam.cy }; dragged = false; }
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
    if (pinchDist > 0 && d > 0) {
      cam.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinchDist);
      dragged = true;
    }
    pinchDist = d;
    return;
  }
  if (pointers.size === 1 && dragStart) {
    const dx = p.x - dragStart.x, dy = p.y - dragStart.y;
    if (!dragged && Math.hypot(dx, dy) > 6) dragged = true;
    if (dragged) {
      cam.cx = dragStart.cx - dx / cam.scale;
      cam.cy = dragStart.cy - dy / cam.scale;
      cam.clampCenter();
    }
  }
  const w = cam.toWorld(p.x, p.y);
  const tx = Math.floor(w.x), ty = Math.floor(w.y);
  hover = tx >= 0 && ty >= 0 && tx < W && ty < H ? { x: tx, y: ty } : null;
});

function endPointer(e: PointerEvent) {
  const wasSingle = pointers.size === 1;
  const p = localPos(e);
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchDist = 0;
  if (!wasSingle || dragged) { dragStart = null; return; }
  dragStart = null;
  onTap(p.x, p.y);
}
cv.addEventListener("pointerup", endPointer);
cv.addEventListener("pointercancel", (e) => { pointers.delete(e.pointerId); dragStart = null; });
cv.addEventListener("pointerleave", () => (hover = null));

cv.addEventListener("wheel", (e) => {
  e.preventDefault();
  const r = cv.getBoundingClientRect();
  cam.zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
}, { passive: false });

function onTap(sx: number, sy: number) {
  const w = cam.toWorld(sx, sy);
  const x = Math.floor(w.x), y = Math.floor(w.y);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const s = game.state;
  const log = (m: string) => hud.say(m);

  if (armed) { castSpell(s, armed, x, y, game.rng, log); return; }
  if (armedCmd) {
    command(s, armedCmd, x, y);
    hud.say(armedCmd === "stay" ? "สั่งให้อยู่ตรงนั้น"
          : armedCmd === "eatHere" ? "สั่งให้ไปหากินตรงนั้น" : "เรียกให้ไปตรงนั้น");
    armedCmd = null; hud.setCommand(null);
    return;
  }
  selected = { x, y };
  hud.drawInspect(s, x, y);
}

// ───────────────────────── ปุ่ม ─────────────────────────

document.getElementById("bPraise")!.onclick = () => teach(game.state, 1, game.rng, (m) => hud.say(m));
document.getElementById("bScold")!.onclick = () => teach(game.state, -1, game.rng, (m) => hud.say(m));

function armCommand(kind: CommandId) {
  armed = null; hud.setArmed(null);
  armedCmd = armedCmd === kind ? null : kind;
  hud.setCommand(armedCmd);
  hud.say(armedCmd ? "แตะแผนที่เพื่อบอกว่าตรงไหน" : "ยกเลิก");
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
document.getElementById("bMem")!.onclick = () => {
  showMemory = !showMemory;
  hud.say(showMemory ? "แสดงแผนที่ความจำของสัตว์ — เขียวคือที่ที่มันจำว่าดี" : "ปิดแผนที่ความจำ");
};
document.getElementById("bFit")!.onclick = () => cam.fitAll();
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
  if (e.key === "f") cam.fitAll();
  if (e.key === "m") document.getElementById("bMem")!.dispatchEvent(new Event("click"));
  if (e.key === "Escape") {
    armed = null; armedCmd = null; hud.setArmed(null); hud.setCommand(null);
    for (const id of ["genome", "inspect", "menu"]) document.getElementById(id)!.classList.add("hidden");
    selected = null;
  }
});

// ───────────────────────── เซฟ / โหลด ─────────────────────────

function metaOf() {
  const s = game.state;
  return { at: Date.now(), year: s.year, era: balance.era.names[s.era],
           villages: s.villages.length, pop: Math.round(totalPop(s)) };
}

function saveTo(slot: SlotId, quiet = false) {
  const ok = writeSlot(slot, snapshot(game), metaOf());
  if (!quiet) hud.say(ok ? `บันทึกลงช่อง ${slot === "auto" ? "อัตโนมัติ" : slot} แล้ว` : "บันทึกไม่สำเร็จ (พื้นที่เก็บเต็ม?)");
  return ok;
}

function loadFrom(slot: SlotId) {
  const r = readSlot(slot);
  if (!r || !saveLooksValid(r.state, W * H)) { hud.say("ช่องนี้ว่าง หรือเซฟมาจากโครงเกมคนละรุ่น"); return; }
  game = restore(r.state);
  armed = null; armedCmd = null; selected = null;
  hud.setArmed(null); hud.setCommand(null);
  hud.buildSpells(game.state.era, game.state.align, null);
  cam.fitAll();
  hud.say(`โหลดโลกจากช่อง ${slot === "auto" ? "อัตโนมัติ" : slot} แล้ว`);
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
    const desc = m ? `ปีที่ ${m.year} · ${m.era} · ${m.villages} หมู่บ้าน · ${m.pop} คน`
                   : "ว่าง";
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
    if (confirm("เริ่มโลกใหม่ทั้งหมด? โลกปัจจุบันที่ยังไม่บันทึกจะหายไป")) { newGame(); toggleMenu(false); }
  };
}

// ───────────────────────── ลูปหลัก ─────────────────────────

let lastEra = -1;
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
    if (Math.abs(r.width - cam.w) > 1 || Math.abs(r.height - cam.h) > 1) resize();
    if (s.era !== lastEra) { lastEra = s.era; hud.buildSpells(s.era, s.align, armed); }
    const sp = armed ? SPELLS.find((x) => x.id === armed)! : null;
    draw(ctx, s, cam, terrain, now, {
      hover, armedRadius: sp ? sp.radius : null, armedDark: sp?.dark ?? false,
      selected, showMemory,
    });
    hud.update(s);
    if (selected && !document.getElementById("inspect")!.classList.contains("hidden")
        && s.tick % 8 === 0) hud.drawInspect(s, selected.x, selected.y);
  },
);

function newGame() {
  game = createGame(Date.now() & 0xffffff);
  armed = null; armedCmd = null; selected = null; lastEra = -1; lastAutosave = 0;
  resize();
  cam.fitAll();
  hud.say("โลกใหม่ถือกำเนิด — แตะแผ่นดินเพื่อดูว่าดินเป็นอย่างไร");
}

// เปิดเกมมาแล้วมีโลกค้างอยู่ ก็เล่นต่อจากเดิม ไม่ใช่เริ่มใหม่ทุกครั้ง
const auto = readSlot("auto");
if (auto && saveLooksValid(auto.state, W * H)) {
  game = restore(auto.state);
  resize(); cam.fitAll();
  hud.buildSpells(game.state.era, game.state.align, null);
  hud.say(`เล่นต่อจากปีที่ ${game.state.year} · ผู้ศรัทธา ${Math.round(loyalPop(game.state))} คน`);
} else {
  newGame();
}
loop.start();
