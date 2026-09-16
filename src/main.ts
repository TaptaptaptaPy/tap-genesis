import "./style.css";
import { FixedLoop } from "./core/loop";
import { createGame, stepTick, stepEffects, castSpell, teach, stroke, smack, command,
         snapshot, restore, saveLooksValid, totalPop, computeReign, placeCreature,
         grabAt, throwTo, dropCarry, whatIsAt, CARRY_NAME, carryLabel, nearestFolk,
         tileAt, advise, adviceEvery,
         SPELLS, goalBelievers, type Game, type CommandId, type Village } from "./sim/index";
import { World3D } from "./render/world3d";
import { Terrain3D, groundY } from "./render/terrain3d";
import { Creature3D, Villages3D } from "./render/actors3d";
import { Villagers3D } from "./render/villagers3d";
import { Hand3D, Thrown3D } from "./render/hand3d";
import { unlock as unlockAudio, sfx, setMuted, isMuted } from "./core/audio";
import { Bgm } from "./core/bgm";
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
/** โหมด "ยกสัตว์ไปวาง" — ไม่ใช่คำสั่งให้มันเดินเอง แต่คือมือหยิบมันไปวางจริงๆ */
let lifting = false;
/** โหมดหยิบของ — แตะช่องเพื่อหยิบ แล้วแตะอีกช่องเพื่อขว้าง */
let grabbing = false;
let hover: { x: number; y: number } | null = null;
let selected: { x: number; y: number } | null = null;

const world = new World3D(cv);
let terrain = new Terrain3D(game.state, world.clouds);
const villages = new Villages3D();
const villagers = new Villagers3D();
const hand = new Hand3D();
const thrown = new Thrown3D();
const creature = new Creature3D();
const fx = new Fx3D();
world.scene.add(terrain.group, villages.group, villagers.group, creature.root, fx.group,
                hand.root, thrown.group);

const hud = new Hud((id) => {
  armedCmd = null; lifting = false; hud.setCommand(null);
  armed = armed === id ? null : id;
  hud.setArmed(armed);
  const sp = SPELLS.find((s) => s.id === id)!;
  hud.say(armed ? `${sp.name} — แตะบนเกาะเพื่อร่าย (${sp.hint})` : "ยกเลิก");
});

function rebuildTerrain() {
  world.scene.remove(terrain.group);
  terrain = new Terrain3D(game.state, world.clouds);
  world.scene.add(terrain.group);
}

// ───────────────────────── นิ้วและเมาส์ ─────────────────────────

const pointers = new Map<number, { x: number; y: number }>();
let dragged = false;
let last = { x: 0, y: 0 };
let pinchDist = 0;
/** จุดกึ่งกลางของสองนิ้วรอบที่แล้ว — ใช้หมุนกล้องด้วยสองนิ้ว */
let twoMid: { x: number; y: number } | null = null;

const localPos = (e: PointerEvent) => {
  const r = cv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

/** ลูบหรือตีสัตว์ด้วยมือจริงๆ ไม่ใช่กดปุ่ม
 *
 *  ปุ่มชม/ดุยังอยู่ (และยังจำเป็นบน iPad ที่นิ้วหนากว่าตัวสัตว์บนจอ)
 *  แต่การลากมือผ่านตัวมันคือท่าที่ Black & White ใช้ และมันสื่อสารคนละอย่างกับการกดปุ่ม
 *  — ปุ่มคือคำสั่ง การสัมผัสคือความสัมพันธ์
 */
const TOUCH = balance.pet;
let strokeOnCreature = false;   // แตะลงบนตัวมันไหม
let strokePath = 0;             // ลากไปแล้วกี่พิกเซล
let strokeDown = 0;             // ลากลงล่างเร็วแค่ไหน (ใช้แยก "ตี" ออกจาก "ลูบ")

/** แตะตรงนี้โดนตัวสัตว์ไหม */
function hitsCreature(px: number, py: number): boolean {
  return !!world.pick(px, py, [creature.root]);
}

cv.addEventListener("pointerdown", (e) => {
  // บาง pointer (เช่นที่ถูกยิงจากเครื่องมืออัตโนมัติ) ทำให้ setPointerCapture โยน error
  // ถ้าไม่ดักไว้ pointerdown จะตายกลางคันและการแตะครั้งนั้นหายไปทั้งครั้ง
  unlockAudio(); bgm.unlock();
  // พระเจ้ากำลังมองอยู่ — สัตว์ที่กลัวจะไม่ทำสิ่งที่เคยโดนห้ามตอนนี้ ดู src/sim/creature.ts
  // ชั้นหน้าจอเป็นคนบอก sim ว่ามีคนดูอยู่ เพราะ sim ไม่รู้จักเมาส์หรือกล้อง
  game.state.attention = balance.pet.attentionTicks;
  try { cv.setPointerCapture(e.pointerId); } catch { /* ไม่จำเป็นต้องจับ pointer ก็เล่นได้ */ }
  const p = localPos(e);
  pointers.set(e.pointerId, p);
  if (pointers.size === 1) {
    last = p; dragged = false;
    strokeOnCreature = hitsCreature(p.x, p.y);
    strokePath = 0; strokeDown = 0;
  }
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
  }
});

cv.addEventListener("pointermove", (e) => {
  if (pointers.size > 0) game.state.attention = balance.pet.attentionTicks;
  const p = localPos(e);
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);

  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist > 0 && d > 0) { world.zoomBy(pinchDist / d); dragged = true; }
    // สองนิ้ว = หนีบซูม *และ* หมุน — เพราะนิ้วเดียวถูกใช้ไปกับการเลื่อนแผนที่แล้ว
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (twoMid) { world.orbitBy(mid.x - twoMid.x, mid.y - twoMid.y); dragged = true; }
    twoMid = mid;
    pinchDist = d;
    return;
  }
  if (pointers.size === 1) {
    const dx = p.x - last.x, dy = p.y - last.y;
    if (!dragged && Math.hypot(p.x - last.x, p.y - last.y) > 5) dragged = true;

    if (strokeOnCreature) {
      // ลากอยู่บนตัวมัน — ห้ามหมุนกล้อง ไม่งั้นการลูบจะกลายเป็นการส่ายกล้อง
      strokePath += Math.hypot(dx, dy);
      strokeDown = dy > strokeDown ? dy : strokeDown;
      if (strokePath > TOUCH.strokePx) {
        strokePath = 0;
        const log = (m: string) => hud.say(m);
        if (strokeDown > TOUCH.smackPx) {
          if (smack(game.state, game.rng, log)) sfx.smack();
          strokeDown = 0;
        } else if (stroke(game.state, game.rng, log)) sfx.stroke();
      }
    } else if (dragged) {
      // นิ้วเดียวลากบนพื้น = **เลื่อนแผนที่** ไม่ใช่หมุนกล้อง
      //
      // นี่คือการควบคุมของ Black & White: กดค้างบนพื้นดินแล้วลาก แผ่นดินตามมือไป
      // ของเดิมนิ้วเดียวลาก = หมุนรอบจุดกลางที่ตายตัว แปลว่าไปดูมุมอื่นของเกาะไม่ได้เลย
      // การหมุนย้ายไปอยู่ที่สองนิ้ว (iPad) และปุ่มขวา/Shift (แมค)
      if (e.buttons === 2 || e.shiftKey) world.orbitBy(dx, dy);
      else world.panBy(dx, dy);
    }
    last = p;
  }
  hover = world.pick(p.x, p.y, [terrain.ground]);
});

/** แตะสองครั้งที่ช่องเดิม = ร่อนลงไปดูใกล้ๆ ตรงนั้น
 *  ใช้ท่าเดิมที่มีอยู่แล้ว ไม่ต้องสอนท่าใหม่ และทำงานได้ทั้งบนแมคและ iPad */
let lastTapAt = 0, lastTapPos = { x: -99, y: -99 };
const DOUBLE_TAP_MS = 320, DOUBLE_TAP_PX = 28;

cv.addEventListener("pointerup", (e) => {
  const wasSingle = pointers.size === 1;
  const wasStroking = strokeOnCreature;
  strokeOnCreature = false;
  const p = localPos(e);
  pointers.delete(e.pointerId);
  if (pointers.size < 2) { pinchDist = 0; twoMid = null; }
  if (!wasSingle || dragged) return;
  // แตะตัวมันเฉยๆ ก็คือการลูบหนึ่งครั้ง
  if (wasStroking) { if (stroke(game.state, game.rng, (m) => hud.say(m))) sfx.stroke(); return; }

  const now = performance.now();
  const near = Math.hypot(p.x - lastTapPos.x, p.y - lastTapPos.y) < DOUBLE_TAP_PX;
  if (now - lastTapAt < DOUBLE_TAP_MS && near) {
    lastTapAt = 0;
    const hit = world.pick(p.x, p.y, [terrain.ground]);
    if (hit) { swoopTo(hit.x, hit.y); return; }
  }
  lastTapAt = now; lastTapPos = p;
  onTap(p.x, p.y);
});

function swoopTo(tx: number, ty: number) {
  world.focusOn(tx + 0.5, groundY(game.state, tx + 0.5, ty + 0.5), ty + 0.5);
  hud.say("แตะสองครั้งอีกที หรือกดถอยออก เพื่อกลับไปมองทั้งเกาะ");
  renderZoomOut();
}

/** ปุ่มถอยออกโผล่มาเฉพาะตอนที่ลงไปใกล้แล้ว ไม่งั้นมันเกะกะจอเปล่าๆ */
function renderZoomOut() {
  const el = document.getElementById("zoomOut");
  if (el) el.classList.toggle("hidden", !world.closeUp);
}
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
    const ok = castSpell(s, armed, hit.x, hit.y, game.rng, log);
    if (ok) {
      (sfx as Record<string, () => void>)[armed]?.();
      // กล้องขยับเข้าไปดูสิ่งที่เพิ่งเกิด แล้วคืนมุมเดิมให้ผู้เล่น
      // ถ้าไม่มีอะไรตอบกลับ ปาฏิหาริย์จะรู้สึกเหมือนแค่ตัวเลขที่ลดลง
      world.emphasise(hit.x + 0.5, groundY(s, hit.x + 0.5, hit.y + 0.5), hit.y + 0.5);
    } else sfx.deny();
    if (s.terrainVersion !== before) rebuildTerrain();
    return;
  }
  if (lifting) {
    if (placeCreature(s, hit.x, hit.y, log)) sfx.place(); else sfx.deny();
    lifting = false; hud.setCommand(null);
    return;
  }
  // ถืออะไรอยู่ก็ขว้างไปตรงที่แตะ ไม่ต้องเลือกโหมดใหม่ — มือเดียวจบ
  if (s.carrying) {
    if (throwTo(s, hit.x, hit.y, log)) sfx.lift(); else sfx.deny();
    renderGrabBar();
    return;
  }
  if (grabbing) {
    if (grabAt(s, hit.x, hit.y, log)) sfx.place(); else sfx.deny();
    renderGrabBar();
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

document.getElementById("zoomOut")!.onclick = () => { world.resetView(); renderZoomOut(); };

const bGrab = document.getElementById("bGrab")!;
bGrab.onclick = () => {
  const s = game.state;
  if (s.carrying) { dropCarry(s, (m) => hud.say(m)); renderGrabBar(); return; }
  grabbing = !grabbing;
  armed = null; armedCmd = null; lifting = false;
  hud.setArmed(null); hud.setCommand(null);
  hud.say(grabbing ? "แตะต้นไม้ หิน หรือผืนดินอุดม เพื่อหยิบขึ้นมา" : "ยกเลิก");
  renderGrabBar();
};

/** ปุ่มมือบอกสถานะตัวเองได้ในตัว ไม่ต้องอ่านข้อความบนแถบ
 *  ตอนอยู่ในโหมดหยิบ มันบอกด้วยว่าใต้มือตอนนี้มีอะไรให้หยิบ
 *  ไม่งั้นผู้เล่นต้องเดาเองว่าช่องไหนหยิบได้ ซึ่งเป็นการเดาที่ไม่มีทางเดาถูก */
function renderGrabBar() {
  const s = game.state;
  if (s.carrying) { bGrab.textContent = `วาง${carryLabel(s)}`; bGrab.dataset.on = "1"; return; }
  if (!grabbing) { bGrab.textContent = "หยิบของ"; bGrab.dataset.on = "0"; return; }
  const at = hover ?? selected;
  const t = at ? tileAt(s.tiles, at.x, at.y) ?? null : null;
  const here = whatIsAt(t);
  // ถ้าใต้มือเป็นคน ก็บอกชื่อเขาไปเลย จะได้รู้ว่ากำลังจะหยิบใคร
  const who = here === "folk" && t?.village ? nearestFolk(t.village, at!.x + 0.5, at!.y + 0.5) : null;
  bGrab.textContent = who ? `หยิบ${who.name}`
    : here ? `หยิบ${CARRY_NAME[here]}` : "ไม่มีอะไรให้หยิบ";
  bGrab.dataset.on = "1";
}
const bSound = document.getElementById("bSound")!;
bSound.onclick = () => {
  unlockAudio();
  setMuted(!isMuted());
  bgm.setMuted(isMuted());
  bSound.textContent = isMuted() ? "เสียงปิด" : "เสียงเปิด";
};
document.getElementById("bPraise")!.onclick = () => {
  if (teach(game.state, 1, game.rng, (m) => hud.say(m))) sfx.praise();
};
document.getElementById("bScold")!.onclick = () => {
  if (teach(game.state, -1, game.rng, (m) => hud.say(m))) sfx.scold();
};

function armCommand(kind: CommandId) {
  armed = null; hud.setArmed(null);
  armedCmd = armedCmd === kind ? null : kind;
  hud.setCommand(armedCmd);
  hud.say(armedCmd ? "แตะบนเกาะเพื่อบอกว่าตรงไหน" : "ยกเลิก");
}
document.getElementById("cStay")!.onclick = () => armCommand("stay");
document.getElementById("cEat")!.onclick = () => armCommand("eatHere");
document.getElementById("cGo")!.onclick = () => armCommand("goTo");
document.getElementById("cLift")!.onclick = () => {
  lifting = !lifting;
  armed = null; armedCmd = null; hud.setArmed(null);
  hud.setCommand(lifting ? "lift" : null);
  hud.say(lifting ? "แตะบนเกาะเพื่อวางมันลงตรงนั้น" : "ยกเลิก");
  if (lifting) sfx.lift();
};

document.getElementById("bGen")!.onclick = () => {
  document.getElementById("inspect")!.classList.add("hidden");
  document.getElementById("menu")!.classList.add("hidden");
  document.getElementById("genome")!.classList.toggle("hidden");
  hud.drawGenome(game.state);
};
document.getElementById("bMenu")!.onclick = () => toggleMenu();

const bSpeed = document.getElementById("bSpeed") as HTMLButtonElement;
bSpeed.onclick = () => {
  // สี่ระดับ ไม่ใช่สาม — หนึ่งวันบนเกาะยาว 6 นาทีจริงที่ 1x
  // ผู้เล่นต้องข้ามช่วงที่ไม่มีอะไรเกิดขึ้นได้ ไม่งั้นจะรู้สึกว่าเกมอืด
  loop.speed = loop.speed === 1 ? 2 : loop.speed === 2 ? 4 : loop.speed === 4 ? 8 : 1;
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
  at: Date.now(), year: game.state.day, era: "",
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
  armed = null; armedCmd = null; lifting = false; grabbing = false; selected = null;
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
    const desc = m ? `วันที่ ${m.year} · ${m.villages} หมู่บ้าน · ${m.pop} คน` : "ว่าง";
    h += `<div class="slot">
      <div class="slotinfo"><b>${name}</b><small>${desc}</small></div>
      <button data-save="${slot}">บันทึก</button>
      <button data-load="${slot}" ${m ? "" : "disabled"}>โหลด</button>
      <button data-wipe="${slot}" class="danger" ${m ? "" : "disabled"}>ลบ</button>
    </div>`;
  }
  h += `<hr><div class="slot"><div class="slotinfo"><b>วิธีเล่น</b><small>ท่าทั้งหมดและเป้าหมายของเกม</small></div>
        <button data-how="1">เปิด</button></div>`;
  h += `<div class="slot"><div class="slotinfo"><b>กลับไปมองกลางเกาะ</b><small>เผื่อเลื่อนกล้องจนหลง</small></div>
        <button data-home="1">กลับ</button></div>`;
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
  el.querySelector<HTMLButtonElement>("[data-how]")!.onclick = () => {
    toggleMenu(false); showFirstHint(true);
  };
  el.querySelector<HTMLButtonElement>("[data-home]")!.onclick = () => {
    world.recentre(); toggleMenu(false);
  };
}

// ───────────────────────── ลูปหลัก ─────────────────────────

/** โหมดทดสอบภาพ — `?seed=123&t=0.35` เปิดโลกเดิมทุกครั้งและหยุดเวลาไว้ที่จุดเดิม
 *
 *  ภาพหน้าจอเทียบกันได้ก็ต่อเมื่อสองรอบเห็นของเหมือนกันเป๊ะ แต่ปกติเกมนี้
 *  สุ่ม seed จาก `Date.now()` และเดินเวลากลางวันกลางคืนตลอดเวลา สองอย่างนี้ทำให้เทียบไม่ได้เลย
 *  พารามิเตอร์นี้จึงมีไว้ให้ Playwright ใช้ (ดู tests/visual.spec.ts) */
const testParams = (() => {
  const q = new URLSearchParams(location.search);
  const seed = q.get("seed");
  if (seed === null) return null;
  const t = q.get("t");
  const a = q.get("align");
  return { seed: Number(seed) | 0, t: t === null ? 0.35 : Number(t),
           align: a === null ? 0 : Number(a) };
})();

/** เพลงบอกสภาพของรัชสมัย — โลกที่ดูแลดีกับโลกที่กำลังพัง ฟังไม่เหมือนกัน
 *  ผู้เล่นจึงรู้ว่าเรื่องไปทางไหนโดยไม่ต้องอ่านตัวเลขบนแถบบน */
const bgm = new Bgm("/assets/audio", ["calm", "night", "strain"]);

/** เลือกเพลงจาก state ล้วน ไม่มีการสุ่ม
 *  ลำดับสำคัญ: ความเดือดร้อนมาก่อนเวลากลางคืน เพราะมันเป็นข้อมูลที่เร่งด่วนกว่า */
function bgmFor(s: Game["state"], daylight: number): string {
  const hungry = s.villages.filter((v: Village) => v.needs.food < 0.5 || v.plague > 0).length;
  if (hungry > 0 && hungry >= s.villages.length / 2) return "strain";
  // รัชสมัยที่เดินมาไกลทางอธรรมไม่ควรฟังเหมือนเช้าวันที่ทุกอย่างเรียบร้อย
  // ใน B&W ดนตรีเป็นหนึ่งในของที่เปลี่ยนตามแกนนี้ พร้อมกับฟ้าและวิหาร
  if (s.align <= balance.align.darkMusicAt) return "strain";
  return daylight < 0.25 ? "night" : "calm";
}

let lastAsking = 0;
/** ก้อนเอฟเฟกต์ที่เล่นเสียงไปแล้ว — WeakSet เพราะ sim ทิ้งก้อนเก่าเองเมื่อหมดอายุ */
const fxSeen = new WeakSet<object>();
let lastCombos = 0, lastPriests = 0, lastVillages = 1, creatureWasAlive = true;
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
    // รัชสมัยที่เลือกเดินมาต้องมองเห็นได้จากฟ้า จากแสง และจากผืนดิน ไม่ใช่แค่ตัวเลขในแถบบน
    // ต้องมาก่อน setTimeOfDay() เพราะเวลาเป็นคนหยิบสีของรัชสมัยไปใช้
    world.setAlign(s.align, dt);
    // เวลาบนเกาะเดินตาม tick ไม่ใช่นาฬิกาจริง กด 2x/4x แล้วพระอาทิตย์ต้องเคลื่อนเร็วขึ้นด้วย
    world.setTimeOfDay(testParams?.t ??
      ((s.tick % balance.time.ticksPerDay) / balance.time.ticksPerDay + 0.18) % 1);
    world.driftSky(dt);
    // เสียงของเหตุการณ์ที่เกิดใน sim — เฝ้าตัวนับแทนที่จะยัด callback เข้าไปใน sim
    // `src/sim/` ต้องไม่รู้จักเรื่องเสียง มันเป็นเรื่องของหน้าจอล้วน
    if (s.combos !== lastCombos) { if (s.combos > lastCombos) sfx.combo(); lastCombos = s.combos; }
    const priests = s.villages.reduce((n, v) => n + v.folk.reduce((m, f) => m + (f.priest ? 1 : 0), 0), 0);
    if (priests > lastPriests) sfx.priest();
    lastPriests = priests;
    if (s.villages.length > lastVillages) sfx.found();
    lastVillages = s.villages.length;
    if (!s.creature.alive && creatureWasAlive) sfx.died();
    creatureWasAlive = s.creature.alive;
    // ของที่ขว้างออกไปตกลงพื้นหรือตกน้ำ — `s.fx` คือทางที่ sim บอกหน้าจอว่าเกิดอะไรขึ้นอยู่แล้ว
    // ก้อนใหม่คือก้อนที่ยังไม่เคยเห็น ไม่ใช่ก้อนที่ t == 0 (เฟรมกับ tick ไม่ได้เดินพร้อมกัน)
    for (const f of s.fx) {
      if (fxSeen.has(f)) continue;
      fxSeen.add(f);
      if (f.kind === "ripple") sfx.splash();
      else if (f.kind === "dust") sfx.land();
    }
    // หมู่บ้านที่กำลังขาดอะไรสักอย่าง — คำขอที่ไม่มีเสียงคือคำขอที่ผู้เล่นไม่ได้ยิน
    const asking = s.villages.filter((v: Village) => v.needs.food < 0.5 || v.plague > 0).length;
    if (asking > lastAsking) sfx.ask();
    lastAsking = asking;

    bgm.want(bgmFor(s, world.daylight));
    bgm.update(dt);
    terrain.update(s, now, world.daylight);
    villages.update(s, now, world.daylight);
    villagers.update(s, dt);
    creature.update(s, s.creature, now, dt);
    const sp = armed ? SPELLS.find((x) => x.id === armed)! : null;
    fx.setCursor(s, hover ?? selected, sp ? sp.radius : null, sp?.dark ?? false);
    hand.setGrip(!!armed || lifting || !!s.carrying);
    hand.setDark(sp?.dark ?? false);
    hand.setCarry(s.carrying);
    hand.update(s, hover ?? selected, dt, now, lifting || !!s.carrying);
    thrown.update(s, now);
    if (grabbing || s.carrying) renderGrabBar();
    renderAdvisors();
    fx.update(s, now);

    world.update(dt, (x, z) => groundY(s, x, z));
    world.render();
    hud.update(s);
    renderZoomOut();
    if (s.won && !reignShown) { reignShown = true; sfx.win(); showReign(); }
    if (selected && !document.getElementById("inspect")!.classList.contains("hidden")
        && s.tick % 8 === 0) hud.drawInspect(s, selected.x, selected.y);
  },
);

// ───────────────────────── ที่ปรึกษาสองฝ่าย ─────────────────────────

/** เถียงกันเรื่องเดียวกันจากคนละมุม — และทำหน้าที่เป็นระบบคำใบ้ไปในตัว */
let adviceAt = -999;
function renderAdvisors() {
  const s = game.state;
  if (s.tick - adviceAt < adviceEvery) return;
  adviceAt = s.tick;
  const pair = advise(s);
  if (!pair) return;
  for (const a of pair) {
    const el = document.querySelector<HTMLElement>(`.adv.${a.voice === "kind" ? "kind" : "cruel"}`);
    if (!el) continue;
    el.textContent = a.text;
    el.classList.remove("show");
    void el.offsetWidth;        // บังคับให้ animation เริ่มใหม่
    el.classList.add("show");
  }
}

// ───────────────────────── ฉากจบ ─────────────────────────

/** โผล่ครั้งเดียวตอนถึงเป้าหมาย เกมไม่หยุด เล่นต่อได้ — นี่คือ "รัชสมัยของท่านเป็นแบบไหน"
 *  ไม่ใช่ "ท่านชนะแล้ว" เพราะธรรมกับอธรรมไม่มีฝั่งไหนถูก */
let reignShown = false;
function showReign() {
  const r = computeReign(game.state);
  const el = document.getElementById("reign")!;
  el.classList.remove("hidden");
  el.innerHTML = `<div class="rwrap">
    <b>${r.title}</b>
    <em>${r.tone}</em>
    <ul>${r.lines.map((l) => `<li>${l}</li>`).join("")}</ul>
    <div class="sub">ปีที่ ${r.years} · ผู้ศรัทธา ${r.believers} · หมู่บ้าน ${r.villages} ·
      สัตว์รุ่นที่ ${r.generation} · คะแนนรัชสมัย ${r.score}</div>
    <button id="reignOk">เล่นต่อ</button>
  </div>`;
  document.getElementById("reignOk")!.onclick = () => el.classList.add("hidden");
}

/** ขึ้นเลขนี้ทุกครั้งที่แก้เนื้อหาหน้าสอนเล่น */
const HINT_KEY = "genesis:seenHint4";

function showFirstHint(force = false) {
  if (force) { try { localStorage.removeItem(HINT_KEY); } catch { /* ไม่เป็นไร */ } }
  const el = document.getElementById("firsthint")!;
  // เลขรุ่นอยู่ในคีย์ — พอเนื้อหาหน้านี้เปลี่ยน คนที่เคยกดปิดไปแล้วต้องได้เห็นของใหม่
  // ของเดิมใช้คีย์เดิมตลอด คนที่เล่นมาก่อนจึงไม่มีวันเห็นคำแนะนำที่เขียนใหม่เลย
  if (localStorage.getItem(HINT_KEY) === "1") return;
  el.classList.remove("hidden");
  el.innerHTML = `<b>ท่านคือเทพเจ้าของเกาะนี้</b>
    <ol>
      <li><b>เป้าหมาย: ผู้ศรัทธา ${goalBelievers()} คน</b> — ตอนนี้มีหมู่บ้านเดียวกับคนสิบคน
        เขาจะโตเองช้าๆ จากผืนดินรอบตัว แต่โตถึง ${goalBelievers()} ไม่ได้ถ้าไม่มีท่าน</li>
      <li><b>เลื่อนแผนที่: กดค้างบนพื้นแล้วลาก</b> แผ่นดินจะตามมือไป
        · สองนิ้วบน iPad = หมุนกับซูม · บนแมคกด Shift ค้างหรือใช้ปุ่มขวาเพื่อหมุน</li>
      <li><b>ผู้คนจะบอกเองว่าขาดอะไร</b> — ดูป้ายลอยเหนือหมู่บ้าน กับเสียงของที่ปรึกษาสองฝ่าย
        ที่จะเถียงกันเรื่องเดียวกันตลอดเวลา</li>
      <li><b>ปาฏิหาริย์</b> — เลือกจากแถบล่าง แล้วแตะลงบนเกาะ · คาถาบางคู่ทำงานร่วมกันได้
        (ฝนก่อนพร · สายฟ้าลงพื้นเปียก · ป่าศักดิ์สิทธิ์บนดินเสีย)</li>
      <li><b>มือของท่าน</b> — แตะค้างบนของบนเกาะเพื่อหยิบขึ้นมา แล้วปัดเพื่อขว้าง
        ก้อนหิน ต้นไม้ อาหาร และผู้คน ยกได้หมด · คนที่ท่านอุ้มแล้ววางคืนอย่างปลอดภัย
        จะกลายเป็นนักบวชที่เล่าสิ่งที่เห็นให้คนทั้งหมู่บ้านฟัง</li>
      <li><b>สัตว์ของท่านเรียนจากท่าน</b> — ลากนิ้วบนตัวมันคือลูบ ปัดลงเร็วคือตี
        (ปุ่ม ✦ ✕ ยังใช้ได้) · มันจะ<b>ลังเลก่อนลงมือทุกครั้ง</b> ห้ามตอนนั้นได้ผลกว่าดุทีหลัง
        และมันดูท่านร่ายคาถาแล้วเลียนแบบได้ด้วย</li>
      <li><b>ตีมันมากเกินไปจะไม่ได้สัตว์ที่เชื่อฟัง</b> — จะได้สัตว์ที่ทำตัวเรียบร้อยตอนท่านมอง
        แล้วไปทำอีกอย่างตอนท่านหันหลัง ดูความกลัวกับความอยากรู้ได้ในแผงสัตว์</li>
      <li><b>หมู่บ้านไม่เหมือนกัน</b> — ขยันทำกิน · ขี้กลัว · ดื้อ · ศรัทธาแรง
        แตะหมู่บ้านเพื่อดูว่าที่นี่เป็นแบบไหน</li>
      <li><b>ธรรมกับอธรรมเปลี่ยนหน้าตาของโลก</b> ฟ้า ทะเล ผืนดิน แสง และเพลง
        ไม่เหมือนกันเลยระหว่างเทพเมตตากับเทพพิโรธ</li>
    </ol>
    <div class="sub">หนึ่งวันบนเกาะยาว 6 นาทีจริง · กดปุ่ม 1× มุมขวาบนเพื่อเร่งเป็น 2× 4× 8×
      · หลงทางเมื่อไหร่ เปิดเมนูแล้วกด "กลับไปมองกลางเกาะ"</div>
    <button id="hintOk">เริ่มเลย</button>`;
  document.getElementById("hintOk")!.onclick = () => {
    el.classList.add("hidden");
    try { localStorage.setItem(HINT_KEY, "1"); } catch { /* ไม่เป็นไร */ }
  };
}

function newGame() {
  game = createGame(Date.now() & 0xffffff);
  armed = null; armedCmd = null; lifting = false; selected = null; lastAutosave = 0;
  rebuildTerrain();
  world.resize();
  hud.buildSpells(game.state.align, null);
  hud.say("เกาะใหม่ผุดขึ้นจากทะเล");
  showFirstHint();
}

const auto = testParams ? null : readSlot("auto");
if (testParams) {
  game = createGame(testParams.seed);
  // เทสต์ภาพต้องตั้งรัชสมัยแล้วเห็นผลทันที เพราะลูปถูกหยุดไว้ ค่าจะไม่มีวันไล่ตามเอง
  game.state.align = testParams.align;
  world.setAlign(testParams.align, 99);
  terrain.setAlign(testParams.align, true);
  rebuildTerrain();
  world.resize();
  hud.buildSpells(game.state.align, null);
  world.setTimeOfDay(testParams.t);
  loop.paused = true;
} else if (auto && saveLooksValid(auto.state, W * H)) {
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
    { get game() { return game; }, world, villages, villagers, creature, terrain: () => terrain,
      get creatureReady() { return creatureLoaded; },
      get propsReady() { return propsLoaded; },
      step: (n = 1) => { for (let i = 0; i < n; i++) stepTick(game); },
      state: () => ({ pointers: pointers.size, dragged, armed }) };
let creatureLoaded = false;
let propsLoaded = false;
void creature.ready.then(() => { creatureLoaded = true; });
void Promise.all([terrain.propsReady, villages.ready, villagers.ready])
  .then(() => { propsLoaded = true; });
loop.start();
