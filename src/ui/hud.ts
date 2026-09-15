import { ACTION_NAME, CREATURE_NEED_NAME, GENE_NAME, NEED_NAME, SPELLS, spellCost, spellFor,
         bodySize, maxAge, totalPop, faithCap, neediestVillage, tileAt, BIOMES, disasterLabel,
         goalBelievers,
         type GameState, type NeedId, type Village } from "../sim/index";
import { sfx } from "../core/audio";

const SIGIL: Record<string, string> = {
  rain:  '<path d="M5 10a4 4 0 018-1 3 3 0 011 5.8"/><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3"/>',
  grove: '<path d="M12 20v-5"/><path d="M12 15l-5-4h3L6 7h4L12 4l2 3h4l-4 4h3z"/>',
  bolt:  '<path d="M13 3L5 13h5l-1 8 8-10h-5z"/>',
  bless: '<circle cx="12" cy="12" r="3.5"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M6 6l1.5 1.5M16.5 16.5L18 18M18 6l-1.5 1.5M7.5 16.5L6 18"/>',
  seed:  '<path d="M4 12l8-7 8 7"/><path d="M6 11v8h12v-8"/><path d="M10 19v-4h4v4"/>',
  heal:  '<path d="M12 5v14M5 12h14"/><circle cx="12" cy="12" r="8.5"/>',
  quake: '<path d="M3 15h4l2-5 3 9 2.5-7 1.5 3h5"/><path d="M3 20h18"/>',
};

const $ = (id: string) => document.getElementById(id)!;
const pct = (v: number) => `${Math.round(v * 100)}%`;

export class Hud {
  private lastLogLen = 0;
  private msgAt = 0;
  private lastAlignBucket = -99;
  private seenDisasters = new Set<string>();

  constructor(private onCast: (id: string) => void) {}

  buildSpells(align: number, armed: string | null) {
    const el = $("spells");
    el.innerHTML = "";
    for (const sp of SPELLS) {
      const b = document.createElement("button");
      b.className = "sigil" + (sp.dark ? " dark" : "");
      b.id = "sp_" + sp.id;
      b.dataset.on = armed === sp.id ? "1" : "0";
      b.title = sp.hint;
      b.innerHTML = `<svg viewBox="0 0 24 24">${SIGIL[sp.id]}</svg>
        <div class="nm">${sp.name}</div><div class="cst">${spellCost(sp, align)}</div>`;
      b.onclick = () => this.onCast(sp.id);
      el.appendChild(b);
    }
  }

  setArmed(armed: string | null) {
    for (const sp of SPELLS) {
      const b = document.getElementById("sp_" + sp.id) as HTMLElement | null;
      if (b) b.dataset.on = armed === sp.id ? "1" : "0";
    }
  }
  setCommand(cmd: string | null) {
    for (const [id, key] of [["cStay", "stay"], ["cEat", "eatHere"], ["cGo", "goTo"],
                             ["cLift", "lift"]] as const) {
      const b = document.getElementById(id) as HTMLElement | null;
      if (b) b.dataset.on = cmd === key ? "1" : "0";
    }
  }

  say(msg: string) { $("ticker").textContent = msg; this.msgAt = performance.now(); }

  alert(msg: string, kind: "good" | "bad" | "info" = "info") {
    const el = document.createElement("div");
    el.className = "alert " + kind;
    el.textContent = msg;
    $("alerts").appendChild(el);
    setTimeout(() => el.classList.add("out"), 2600);
    setTimeout(() => el.remove(), 3400);
  }

  update(s: GameState) {
    const cap = faithCap(s);
    $("sFaith").textContent = String(Math.floor(s.faith));
    $("sFaithCap").textContent = `/ ${Math.floor(cap)} ศรัทธา`;
    // เดิมเลขนี้บอกแค่ "มีคนกี่คน" ไม่ได้บอกว่ากี่คนถึงจะพอ
    $("sPop").textContent = String(Math.round(totalPop(s)));
    $("sGoal").textContent = s.won ? "· ถึงเป้าแล้ว" : `/ ${goalBelievers()}`;
    $("sYear").textContent = String(s.year);
    ($("alignPin") as HTMLElement).style.left = ((s.align + 1) / 2) * 100 + "%";

    for (const d of s.disasters) {
      const key = `${d.kind}@${d.x},${d.y}`;
      if (!this.seenDisasters.has(key)) {
        this.seenDisasters.add(key);
        this.alert(disasterLabel(d.kind), "bad");
        sfx.disaster();
      }
    }
    if (this.seenDisasters.size > 40) this.seenDisasters.clear();

    if (s.log.length !== this.lastLogLen) {
      this.lastLogLen = s.log.length;
      const last = s.log[s.log.length - 1];
      if (last) this.say(last);
    }
    if (performance.now() - this.msgAt > 5200) $("ticker").textContent = "";

    const bucket = Math.round(s.align * 10);
    if (bucket !== this.lastAlignBucket) { this.lastAlignBucket = bucket; this.refreshCosts(s); }
    for (const sp of SPELLS) {
      const b = document.getElementById("sp_" + sp.id) as HTMLButtonElement | null;
      if (b) b.disabled = s.faith < spellCost(sp, s.align);
    }

    this.drawGuide(s);

    const c = s.creature;
    $("petFace").textContent = String(c.gen);
    // ความลังเลมาก่อนทุกอย่าง เพราะมันคือช่วงที่ผู้เล่นยังทำอะไรได้อยู่
    const act = c.intent ? `กำลังจะ${ACTION_NAME[c.intent]}`
              : c.act ? ACTION_NAME[c.act]
              : c.lastAct ? "เพิ่ง" + ACTION_NAME[c.lastAct] : "…";
    const need = c.need === "content" ? "" : ` · ${CREATURE_NEED_NAME[c.need]}`;
    $("petAct").textContent = c.alive
      ? `รุ่นที่ ${c.gen} · ${act}${need}${c.cmd ? " · ทำตามคำสั่ง" : ""}`
      : "สิ้นชีพ · กำลังกลับชาติมาเกิด";
    ($("petAct") as HTMLElement).classList.toggle("is-intent", !!c.intent && c.alive);
    ($("barE") as HTMLElement).style.width = c.energy * 100 + "%";
    ($("barA") as HTMLElement).style.width = (100 - Math.min(1, c.age / maxAge(c)) * 100) + "%";
    ($("barB") as HTMLElement).style.width = c.bond * 100 + "%";
    const canTeach = c.fbTimer > 0 && c.alive;
    ($("bPraise") as HTMLElement).classList.toggle("ready", canTeach);
    ($("bScold") as HTMLElement).classList.toggle("ready", canTeach);

    if (!$("genome").classList.contains("hidden")) this.drawGenome(s);
  }

  /** แถบบอกว่า "ตอนนี้ควรทำอะไร" — สิ่งเดียวที่ขาดไปแล้วทำให้เกมเล่นไม่รู้เรื่อง */
  private drawGuide(s: GameState) {
    const el = $("guide");
    const plagued = s.villages.find((v) => v.plague > 0);
    let text = "", spellId = "";

    if (plagued) {
      text = `หมู่บ้าน${plagued.name}มีโรคระบาด`;
      spellId = "heal";
    } else {
      const v = neediestVillage(s);
      if (v && v.ask) {
        text = `หมู่บ้าน${v.name}ขาด${NEED_NAME[v.ask]}`;
        spellId = spellFor(v.ask)?.id ?? "";
      }
    }
    if (!text) {
      const c = s.creature;
      if (c.alive && c.intent) {
        text = `สัตว์ของท่านกำลังจะ${ACTION_NAME[c.intent]} — ลูบเพื่อปล่อย ตีเพื่อห้าม`;
      } else if (c.alive && c.fbTimer > 0 && c.lastAct) {
        text = `สัตว์ของท่านเพิ่ง${ACTION_NAME[c.lastAct]} — ชมหรือตีได้ตอนนี้`;
      } else { el.classList.add("hidden"); return; }
    }
    const sp = SPELLS.find((x) => x.id === spellId);
    el.classList.remove("hidden");
    el.innerHTML = `<b>${text}</b>` +
      (sp ? `<span>ร่าย <em>${sp.name}</em> ลงตรงนั้น · ${spellCost(sp, s.align)} ศรัทธา</span>` : "");
  }

  private refreshCosts(s: GameState) {
    for (const sp of SPELLS) {
      const cst = document.getElementById("sp_" + sp.id)?.querySelector(".cst");
      if (cst) cst.textContent = String(spellCost(sp, s.align));
    }
  }

  drawGenome(s: GameState) {
    const c = s.creature;
    let h = `<h3>สัตว์รุ่นที่ ${c.gen}${s.best ? ` · สถิติชีวิตสูงสุด ${Math.round(s.best.fit)}` : ""}</h3>`;
    h += `<div class="sub">ขนาดตัว ${bodySize(c).toFixed(2)} · ความผูกพัน ${pct(c.bond)} · จำสถานที่ได้ ${Object.keys(c.mem).length} แห่ง</div>`;
    for (const k of Object.keys(c.genes) as (keyof typeof c.genes)[]) {
      const v = c.genes[k];
      h += `<div class="grow-row"><em>${GENE_NAME[k]}</em>
        <div class="bar"><i style="width:${v * 100}%;background:#6aa0b5"></i></div>
        <em>${v.toFixed(2)}</em></div>`;
    }
    h += '<div style="height:8px"></div><div class="sub">สิ่งที่มันชอบทำ (สอนได้ด้วย ✦ และ ✕)</div>';
    const mx = Math.max(...Object.values(c.w));
    for (const k of Object.keys(c.w) as (keyof typeof c.w)[]) {
      h += `<div class="grow-row"><em>${ACTION_NAME[k]}</em>
        <div class="bar"><i style="width:${(c.w[k] / mx) * 100}%;background:var(--gold)"></i></div>
        <em>${c.w[k].toFixed(2)}</em></div>`;
    }
    $("genome").innerHTML = h;
  }

  drawInspect(s: GameState, x: number, y: number) {
    const t = tileAt(s.tiles, x, y);
    const el = $("inspect");
    if (!t) { el.classList.add("hidden"); return; }
    el.classList.remove("hidden");
    const b = BIOMES[t.biome];
    let h = `<h3>${b.name} <small>(${x}, ${y})</small></h3>`;
    h += `<div class="kv"><span>ความอุดม</span><b>${pct(t.fert)} <small>/ เพดาน ${pct(t.cap)}</small></b></div>`;
    h += `<div class="kv"><span>ความชุ่มน้ำ</span><b>${pct(t.wet)}</b></div>`;
    if (t.burn > 0.02) h += `<div class="kv bad"><span>กำลังไหม้</span><b>${pct(t.burn)}</b></div>`;
    if (t.blight > 0.02) h += `<div class="kv bad"><span>ดินเสียจากภัยแล้ง</span><b>${pct(t.blight)}</b></div>`;
    if (t.village) h += this.villageBlock(t.village);
    el.innerHTML = h;
  }

  private villageBlock(v: Village) {
    const bar = (label: string, val: number) =>
      `<div class="kv"><span>${label}</span>
        <div class="minibar"><i style="width:${val * 100}%;background:${val < 0.5 ? "#c4795a" : "#7fc08a"}"></i></div>
        <b>${pct(val)}</b></div>`;
    const needs = (["food", "wood", "shelter"] as NeedId[])
      .map((k) => bar(NEED_NAME[k], v.needs[k])).join("");
    return `<hr><h3>หมู่บ้าน${v.name}</h3>
      <div class="kv"><span>ผู้คน</span><b>${Math.round(v.pop)}</b></div>
      <div class="kv"><span>ศรัทธาในตัวท่าน</span><b>${pct(v.belief)}</b></div>
      ${needs}
      ${v.plague > 0 ? '<div class="kv bad"><span>โรคระบาด</span><b>กำลังลุกลาม</b></div>' : ""}`;
  }
}
