/** ทดสอบสมดุลโดยไม่ต้องเปิดเบราว์เซอร์ — รันด้วย `npm run sim`
 *
 *  เทียบโลกเดียวกัน (seed เดียวกัน) สามแบบ: ปล่อยทิ้ง · เทพเมตตา · เทพพิโรธ
 *
 *  เดิมเทสต์นี้เรียกแต่ `stepTick` ไม่เคยร่ายคาถาและไม่เคยสอนสัตว์เลยสักครั้ง
 *  ลูปหลักของเกม (ขาด → ร้องขอ → ปาฏิหาริย์ → ศรัทธา) จึงไม่มีอะไรคุมอยู่เลย
 *  และเลข "ศรัทธาเต็มคาป ผูกพัน 0%" ที่เคยเห็นทุกโลกก็มาจากการที่ไม่มีใครใช้มัน
 *  ไม่ใช่เพราะสมดุลพัง — ตัวเลขที่อ่านผิดได้แบบนั้นแย่กว่าไม่มีตัวเลขเลย */
import { createGame, stepTick, stepEffects, totalPop, maxVillages, snapshot, restore,
         tileAt, bodySize, faithCap, saveLooksValid, castSpell, spellCost, spellFor,
         SPELLS, teach, neediestVillage, isWater, inInfluence, computeReign, goalBelievers,
         GENE_NAME, NEED_NAME,
         type Game, type GameState, type GeneId, type Genes, type NeedId, type Village }
       from "../sim/index";
import balance from "../../data/balance.json";

const MINUTES = Number(process.argv[2] ?? 20);
const RUNS = Number(process.argv[3] ?? 3);
const ticks = Math.round((MINUTES * 60) / balance.time.tickSeconds);
const GENES = Object.keys(GENE_NAME) as GeneId[];
const NEEDS: NeedId[] = ["food", "wood", "shelter"];
const TILES = balance.world.W * balance.world.H;

/** นิสัยของผู้เล่นจำลอง — ไม่ใช่ตัวเลขสมดุลของเกม จึงอยู่ในเทสต์ ไม่ใช่ใน balance.json */
const GOD = {
  /** ร่ายคาถาถี่สุดทุกกี่ tick — คนจริงกดไม่ทันกว่านี้ (20 tick = 9 วินาทีเกม) */
  castEveryTicks: 20,
  /** เก็บศรัทธาไว้เท่านี้ของเพดานก่อนจะยอมใช้คาถาฟุ่มเฟือยอย่าง "ก่อเผ่า" */
  seedAbove: 0.8,
  /** ดินต้องอุดมอย่างน้อยเท่านี้ถึงจะคุ้มค่าตั้งหมู่บ้านใหม่ */
  seedMinFert: 0.4,
  /** สอนสัตว์ถี่สุดทุกกี่ tick — ถ้าไม่คุม ผู้เล่นจำลองจะชมทุกการกระทำ (800 ครั้งต่อโลก)
   *  ซึ่งคนจริงทำไม่ได้ และทำให้ค่าผูกพันเต็มจนดูไม่ออกว่าระบบสอนได้ผลแค่ไหน */
  teachEveryTicks: 12,
};

type Persona = "none" | "kind" | "wrath";
const PERSONA_NAME: Record<Persona, string> = {
  none: "ปล่อยทิ้ง", kind: "เมตตา", wrath: "พิโรธ",
};

// ───────────────────────── ผู้เล่นจำลอง ─────────────────────────

interface GodStats { cast: Record<string, number>; spent: number; denied: number;
                     praise: number; scold: number; }
const newGodStats = (): GodStats => ({ cast: {}, spent: 0, denied: 0, praise: 0, scold: 0 });

interface Plan { id: string; x: number; y: number; }

const worstNeed = (v: Village): NeedId =>
  (Object.keys(v.needs) as NeedId[]).reduce((a, b) => (v.needs[a] <= v.needs[b] ? a : b));

/** ช่องว่างที่ดินดีที่สุดและห่างจากหมู่บ้านเดิมพอ
 *  สแกนเรียงลำดับ ไม่สุ่ม — เพราะถ้าสุ่ม เซฟ/โหลดแล้วผู้เล่นจำลองจะเดินคนละทางทันที */
function emptySpot(s: GameState) {
  const minD = balance.village.minSpacing;
  let best = null, bv = 0;
  for (const t of s.tiles) {
    if (isWater(t.biome) || t.village) continue;
    // ต้องอยู่ในเขตที่คนศรัทธาท่านด้วย ผู้เล่นจริงก็ร่ายนอกเขตไม่ได้เหมือนกัน
    if (!inInfluence(s, t.x, t.y)) continue;
    if (s.villages.some((v) => Math.hypot(v.x - t.x, v.y - t.y) < minD)) continue;
    if (t.fert > bv) { bv = t.fert; best = t; }
  }
  return bv >= GOD.seedMinFert ? best : null;
}

/** เทพเมตตา: ตอบสิ่งที่ผู้คนร้องขอ โรคระบาดมาก่อนเสมอเพราะมันกินประชากรทุก tick */
function kindPlan(s: GameState): Plan | null {
  const sick = s.villages.find((v) => v.plague > 0);
  if (sick) return { id: "heal", x: sick.x, y: sick.y };

  // หมู่บ้านที่ร้องขอ เลือกที่ขาดหนักที่สุดก่อน
  const howBad = (x: Village) => x.needs[x.ask as NeedId];
  const asking = s.villages.filter((x) => x.ask).sort((a, b) => howBad(a) - howBad(b))[0];
  const target = asking ?? neediestVillage(s);
  if (target) {
    const sp = spellFor(target.ask ?? worstNeed(target));
    if (sp) return { id: sp.id, x: target.x, y: target.y };
  }

  // ทุกหมู่บ้านอิ่มแล้วและศรัทธาล้น — ขยายเผ่าพันธุ์ ไม่มีที่ให้ขยายก็ให้พรหมู่บ้านที่ใหญ่ที่สุด
  if (s.faith > faithCap(s) * GOD.seedAbove) {
    if (s.villages.length < maxVillages(s)) {
      const spot = emptySpot(s);
      if (spot) return { id: "seed", x: spot.x, y: spot.y };
    }
    const big = biggest(s);
    if (big) return { id: "bless", x: big.x, y: big.y };
  }
  return null;
}

const biggest = (s: GameState): Village | null => {
  let big: Village | null = null;
  for (const v of s.villages) if (!big || v.pop > big.pop) big = v;
  return big;
};

/** เทพพิโรธ: ลงโทษหมู่บ้านใหญ่ที่สุด ใช้ตรวจว่าคาถาดำกับแกนอธรรมทำงานจริง
 *  เดิมฟาดสายฟ้าทุกรอบจนศรัทธาไม่เคยพอร่ายธรณีพิโรธเลยสักครั้ง คาถานั้นจึงไม่มีเทสต์แตะ
 *  ตอนนี้พอศรัทธาใกล้พอแล้วจะอมไว้ก่อน */
function wrathPlan(s: GameState): Plan | null {
  const big = biggest(s);
  if (!big) return null;
  const quake = SPELLS.find((x) => x.id === "quake")!;
  const cost = spellCost(quake, s.align);
  if (s.faith >= cost) return { id: "quake", x: big.x, y: big.y };
  if (s.faith >= cost * 0.6) return null;              // ใกล้พอแล้ว เก็บต่ออีกหน่อย
  return { id: "bolt", x: big.x, y: big.y };
}

/** ทุกการตัดสินใจต้องมาจาก state ล้วน ห้ามสุ่มเอง ไม่งั้นเทสต์เซฟ/โหลดจะเพี้ยน */
function divine(g: Game, persona: Persona, st: GodStats, log: (m: string) => void): void {
  if (persona === "none") return;
  const s = g.state;
  if (s.dead) return;

  // สอนสัตว์ก่อน — หน้าต่างตัดสินเปิดแค่ไม่กี่ tick ถ้ารอรอบร่ายคาถาจะหมดเวลา
  const c = s.creature;
  if (s.tick % GOD.teachEveryTicks === 0 && c.alive && c.lastAct && c.fbTimer > 0) {
    const good = c.lastAct === "help" || c.lastAct === "worship";
    const bad = c.lastAct === "raid";
    if (good || bad) {
      const sign: 1 | -1 = persona === "kind" ? (good ? 1 : -1) : (bad ? 1 : -1);
      if (teach(s, sign, g.rng, log)) { if (sign > 0) st.praise++; else st.scold++; }
    }
  }

  if (s.tick % GOD.castEveryTicks !== 0) return;
  const plan = persona === "kind" ? kindPlan(s) : wrathPlan(s);
  if (!plan) return;
  const sp = SPELLS.find((x) => x.id === plan.id);
  if (!sp) return;
  const cost = spellCost(sp, s.align);
  if (s.faith < cost) { st.denied++; return; }
  if (castSpell(s, plan.id, plan.x, plan.y, g.rng, log)) {
    st.cast[plan.id] = (st.cast[plan.id] ?? 0) + 1;
    st.spent += cost;
  }
}

// ───────────────────────── เดินโลกหนึ่งใบ ─────────────────────────

interface Outcome {
  pop: number; peak: number; villages: number; cap: number;
  faith: number; faithCap: number; align: number; worstAlign: number;
  needs: Record<NeedId, number>; askPct: number;
  gen: number; bond: number; size: number; fit: number;
  dead: boolean; starved: boolean; year: number; overflow: number;
  won: boolean; reign: string;
  drift: string; disasters: string; god: GodStats;
}

const mkLog = (s: GameState) => (m: string) => { s.log.push(m); if (s.log.length > 60) s.log.shift(); };

function runWorld(seed: number, persona: Persona): Outcome {
  const g = createGame(seed);
  const s = g.state;
  const st = newGodStats();
  const log = mkLog(s);
  const gen0: Genes = { ...s.creature.genes };
  const seen: Record<string, number> = {};
  let peak = 0, worstAlign = 0, askTicks = 0, overflow = 0;

  for (let i = 0; i < ticks; i++) {
    const before = s.disasters.length;
    stepTick(g);
    if (s.disasters.length > before)
      for (const d of s.disasters.slice(before)) seen[d.name] = (seen[d.name] ?? 0) + 1;
    divine(g, persona, st, log);
    stepEffects(s, balance.time.tickSeconds);   // กันไม่ให้อนุภาคจากคาถาสะสมไม่รู้จบ
    peak = Math.max(peak, totalPop(s));
    if (s.villages.some((v) => v.ask)) askTicks++;
    if (Math.abs(s.align) > Math.abs(worstAlign)) worstAlign = s.align;
    // ศรัทธาต้องไม่ทะลุเพดาน เพราะเพดานคือด่านเดียวที่กั้นคาถาใหญ่อยู่
    overflow = Math.max(overflow, s.faith - faithCap(s));
  }

  const n = Math.max(1, s.villages.length);
  const needs = {} as Record<NeedId, number>;
  for (const k of NEEDS) needs[k] = s.villages.reduce((a, v) => a + v.needs[k], 0) / n;

  return {
    pop: totalPop(s), peak, villages: s.villages.length, cap: maxVillages(s),
    faith: s.faith, faithCap: faithCap(s), align: s.align, worstAlign,
    needs, askPct: (askTicks / ticks) * 100,
    gen: s.creature.gen, bond: s.creature.bond, size: bodySize(s.creature),
    fit: s.best?.fit ?? 0, dead: s.dead, overflow,
    won: s.won, reign: computeReign(s).title,
    starved: s.villages.some((v) => v.needs.food < 0.5), year: s.year,
    drift: GENES.map((k) => `${GENE_NAME[k]} ${gen0[k].toFixed(2)}→${s.creature.genes[k].toFixed(2)}`).join("  "),
    disasters: Object.entries(seen).map(([k, v]) => `${k}×${v}`).join(" ") || "ไม่มี",
    god: st,
  };
}

// ───────────────────────── รายงาน ─────────────────────────

const castList = (st: GodStats) =>
  SPELLS.filter((sp) => st.cast[sp.id]).map((sp) => `${sp.name}×${st.cast[sp.id]}`).join(" ");

function report(label: string, o: Outcome) {
  const pad = (label + "        ").slice(0, 10);
  const sign = o.align >= 0 ? "+" : "";
  console.log(`  ${pad} ประชากร ${o.pop.toFixed(0).padStart(3)} (เคยถึง ${o.peak.toFixed(0).padStart(3)})` +
              ` · หมู่บ้าน ${o.villages}/${o.cap} · ศรัทธา ${o.faith.toFixed(0)}/${o.faithCap.toFixed(0)}` +
              ` · ธรรม ${sign}${o.align.toFixed(2)}` +
              `${o.dead ? "  *** ล่มสลาย ***" : o.won ? "  ★ ถึงเป้าหมาย" : ""}`);
  console.log(`             ${NEEDS.map((k) => `${NEED_NAME[k]} ${(o.needs[k] * 100).toFixed(0)}%`).join("  ")}` +
              ` · มีคำขอค้างอยู่ ${o.askPct.toFixed(0)}% ของเวลา`);
  const spells = castList(o.god);
  if (spells)
    console.log(`             คาถา: ${spells} · ศรัทธาที่ใช้ไป ${o.god.spent.toFixed(0)}` +
                (o.god.denied ? ` · ศรัทธาไม่พอ ${o.god.denied} ครั้ง` : ""));
  if (o.god.praise || o.god.scold)
    console.log(`             สอนสัตว์: ชม ${o.god.praise} ดุ ${o.god.scold}` +
                ` · ผูกพัน ${(o.bond * 100).toFixed(0)}% · รุ่นที่ ${o.gen} ขนาด ${o.size.toFixed(2)}`);
}

console.log(`จำลอง ${RUNS} โลก × ${MINUTES} นาทีเกม (${ticks} ticks ต่อโลก) บนเกาะ ${balance.world.W}×${balance.world.H}`);
console.log(`เทียบโลกเดียวกันสามแบบ: ปล่อยทิ้ง (ไม่มีเทพ) · เมตตา (ตอบทุกคำขอ) · พิโรธ (คาถาดำล้วน)\n`);

const all: Record<Persona, Outcome[]> = { none: [], kind: [], wrath: [] };
const spellsUsed = new Set<string>();

for (let run = 1; run <= RUNS; run++) {
  const seed = 1000 + run * 7919;
  console.log(`โลกที่ ${run} (seed ${seed})`);
  for (const p of ["none", "kind", "wrath"] as Persona[]) {
    const o = runWorld(seed, p);
    all[p].push(o);
    for (const id of Object.keys(o.god.cast)) spellsUsed.add(id);
    report(PERSONA_NAME[p], o);
  }
  const k = all.kind[all.kind.length - 1];
  console.log(`             ยีน: ${k.drift}`);
  console.log(`             ภัยพิบัติ: ${k.disasters}\n`);
}

// ───────────────────────── เซฟ/โหลด ─────────────────────────
// เดินโลกด้วยเทพเมตตาก่อน เพื่อให้ตอนเซฟมีทั้งภูมิประเทศที่คาถาเปลี่ยนไปแล้วและสัตว์ที่ถูกสอนมาแล้ว
{
  const g = createGame(424242);
  const st = newGodStats();
  const log = mkLog(g.state);
  for (let i = 0; i < 700; i++) { stepTick(g); divine(g, "kind", st, log); stepEffects(g.state, balance.time.tickSeconds); }

  const snap = snapshot(g);
  const fingerprint = (x: Game) => {
    const s = x.state;
    return JSON.stringify({
      tick: s.tick, faith: s.faith.toFixed(6), align: s.align.toFixed(6),
      villages: s.villages.map((v) => [v.id, v.pop.toFixed(6), v.belief.toFixed(6)]),
      creature: [s.creature.x.toFixed(6), s.creature.y.toFixed(6), s.creature.energy.toFixed(6)],
    });
  };

  // ด่านที่เกมจริงต้องผ่านตอนกดโหลด เดิมเทสต์นี้เรียก restore() ตรงๆ เลยมองไม่เห็นว่าด่านนี้พัง
  const accepted = saveLooksValid(snap, TILES);

  const st2 = newGodStats();
  const log2 = mkLog(g.state);
  for (let i = 0; i < 300; i++) { stepTick(g); divine(g, "kind", st2, log2); stepEffects(g.state, balance.time.tickSeconds); }
  const afterDirect = fingerprint(g);

  const g2 = restore(snap);
  const linked = g2.state.villages.every((v) => tileAt(g2.state.tiles, v.x, v.y)?.village === v);
  const st3 = newGodStats();
  const log3 = mkLog(g2.state);
  for (let i = 0; i < 300; i++) { stepTick(g2); divine(g2, "kind", st3, log3); stepEffects(g2.state, balance.time.tickSeconds); }
  const afterLoad = fingerprint(g2);

  console.log("ทดสอบเซฟ/โหลด (ผ่านด่านเดียวกับที่เกมจริงใช้)");
  console.log(`  เซฟที่เพิ่งสร้างผ่าน saveLooksValid: ${accepted ? "ใช่" : "ไม่ใช่ ← พัง เกมจะโหลดไม่ขึ้นสักช่อง"}`);
  console.log(`  หมู่บ้านผูกกับช่องถูกต้องหลังโหลด: ${linked ? "ใช่" : "ไม่ใช่ ← พัง"}`);
  console.log(`  โลกเดินต่อหลังโหลดได้ผลเหมือนไม่เคยเซฟ: ${afterDirect === afterLoad ? "ใช่" : "ไม่ใช่ ← พัง"}`);
  if (!accepted || !linked || afterDirect !== afterLoad) process.exitCode = 1;
}

// ───────────────────────── สรุป ─────────────────────────

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const popOf = (p: Persona) => avg(all[p].map((o) => o.pop));
const askOf = (p: Persona) => avg(all[p].map((o) => o.askPct));
const deadOf = (p: Persona) => all[p].filter((o) => o.dead).length;

console.log("\n" + "─".repeat(64));
console.log("เทพเมตตาเปลี่ยนอะไรได้จริงไหม (โลกเดียวกัน seed เดียวกัน)");
console.log(`  ประชากรเฉลี่ยตอนจบ   ปล่อยทิ้ง ${popOf("none").toFixed(0)} → เมตตา ${popOf("kind").toFixed(0)}`);
console.log(`  เวลาที่มีคำขอค้าง    ปล่อยทิ้ง ${askOf("none").toFixed(0)}% → เมตตา ${askOf("kind").toFixed(0)}%`);
console.log(`  โลกที่ล่มสลาย        ปล่อยทิ้ง ${deadOf("none")}/${RUNS} → เมตตา ${deadOf("kind")}/${RUNS}`);
console.log("เทพพิโรธทำลายได้จริงไหม");
console.log(`  ประชากรเฉลี่ยตอนจบ   ปล่อยทิ้ง ${popOf("none").toFixed(0)} → พิโรธ ${popOf("wrath").toFixed(0)}` +
            ` · ธรรมลงไปถึง ${avg(all.wrath.map((o) => o.worstAlign)).toFixed(2)}`);

const worstOverflow = Math.max(...(["none", "kind", "wrath"] as Persona[])
  .flatMap((p) => all[p].map((o) => o.overflow)));
if (worstOverflow > 0.5)
  console.log(`ศรัทธาทะลุเพดานสูงสุด ${worstOverflow.toFixed(0)} หน่วย ← เพดานรั่ว`);

const wonOf = (p: Persona) => all[p].filter((o) => o.won).length;
const bestPop = Math.max(...all.kind.map((o) => o.peak));
console.log(`เป้าหมาย ${goalBelievers()} ผู้ศรัทธา — ถึงแล้ว: เมตตา ${wonOf("kind")}/${RUNS}` +
            ` · ปล่อยทิ้ง ${wonOf("none")}/${RUNS} · ประชากรสูงสุดที่เมตตาเคยทำได้ ${bestPop.toFixed(0)}`);
console.log(`รัชสมัยที่ได้: ${[...new Set(all.kind.map((o) => o.reign))].join(" · ")}`);

const missing = SPELLS.filter((sp) => !spellsUsed.has(sp.id));
console.log(`คาถาที่เทสต์ได้ใช้จริง ${SPELLS.length - missing.length}/${SPELLS.length}` +
            (missing.length ? ` — ยังไม่เคยแตะ: ${missing.map((sp) => sp.name).join(" ")}` : ""));

const alignExtreme = all.none.filter((o) => Math.abs(o.worstAlign) > 0.95).length;
const starved = all.kind.filter((o) => o.starved).length;
console.log("─".repeat(64));
console.log(`สรุป: ล่มสลาย(เมตตา) ${deadOf("kind")}/${RUNS} | ธรรมติดขอบเอง(ปล่อยทิ้ง) ${alignExtreme}/${RUNS} | อดอยากตอนจบ(เมตตา) ${starved}/${RUNS}`);

if (deadOf("kind") > RUNS / 2) console.log("เตือน: อารยธรรมล่มเกินครึ่งทั้งที่มีเทพคอยช่วย สมดุลโหดเกินไป");
if (alignExtreme > 0) console.log("เตือน: แกนธรรมอิ่มตัวเองโดยไม่มีใครร่ายคาถา แปลว่ามีอะไรดันทางเดียวอยู่");
if (popOf("kind") <= popOf("none"))
  console.log("เตือน: เทพเมตตาไม่ได้ทำให้อะไรดีขึ้นเลย ลูปหลักของเกมไม่ทำงาน");
if (popOf("wrath") >= popOf("none"))
  console.log("เตือน: คาถาดำไม่มีผลกับโลก");
if (missing.length) console.log("เตือน: มีคาถาที่ไม่มีเทสต์ไหนแตะเลย");
// 2 ใน 8 โลกถึงเป้าเป็นเรื่องปกติ ถ้าจำลองแค่ 3 โลกแล้วไม่ถึงเลยก็ยังไม่ได้แปลว่าเป้าพัง
if (RUNS >= 6 && wonOf("kind") === 0)
  console.log("เตือน: ไม่มีโลกไหนถึงเป้าหมายเลย เป้าอาจสูงเกินไปสำหรับความยาวที่จำลอง");
if (wonOf("none") > 0)
  console.log("เตือน: โลกที่ไม่มีเทพก็ถึงเป้าหมายได้ เป้านี้ไม่ได้วัดอะไรเลย");
if (worstOverflow > 0.5)
  console.log("เตือน: ศรัทธาทะลุ faithCap() ได้ — การร่ายรำบูชาของสัตว์ใน creature.ts บวกศรัทธาโดยไม่ clamp");
