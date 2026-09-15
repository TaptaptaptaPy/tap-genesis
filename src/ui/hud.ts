import { ACTION_NAME, GENE_NAME, NEED_NAME, SPELLS, spellCost, bodySize, maxAge, petOf,
         loyalPop, maxVillages, totalPop, tileAt, BIOMES, disasterLabel,
         type GameState, type Village } from "../sim/index";
import balance from "../../data/balance.json";

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
  private lastEra = -1;
  private lastAlignBucket = -99;
  private seenDisasters = new Set<string>();

  constructor(private eraNames: string[], private onCast: (id: string) => void) {}

  /** สร้างปุ่มคาถาใหม่เมื่อเลื่อนยุค (คาถาบางอย่างปลดล็อกตามยุค) */
  buildSpells(era: number, align: number, armed: string | null) {
    const el = $("spells");
    el.innerHTML = "";
    for (const sp of SPELLS) {
      if (sp.minEra > era) continue;
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
    for (const [id, key] of [["cStay", "stay"], ["cEat", "eatHere"], ["cGo", "goTo"]] as const) {
      const b = document.getElementById(id) as HTMLElement | null;
      if (b) b.dataset.on = cmd === key ? "1" : "0";
    }
  }

  say(msg: string) { $("ticker").textContent = msg; this.msgAt = performance.now(); }

  /** เรื่องใหญ่ (ภัยพิบัติ / คู่แข่งตื่น / เลื่อนยุค) ต้องเด้งให้เห็นชัด ไม่ใช่ไหลหายไปกับ ticker */
  alert(msg: string, kind: "good" | "bad" | "info" = "info") {
    const el = document.createElement("div");
    el.className = "alert " + kind;
    el.textContent = msg;
    $("alerts").appendChild(el);
    setTimeout(() => el.classList.add("out"), 2600);
    setTimeout(() => el.remove(), 3400);
  }

  update(s: GameState) {
    $("sFaith").textContent = String(Math.floor(s.faith));
    $("sPop").textContent = `${Math.round(loyalPop(s))}/${Math.round(totalPop(s))}`;
    $("sEra").textContent = this.eraNames[s.era];
    $("sSeason").textContent = `${balance.season.names[s.season]} · ปีที่ ${s.year}`;
    ($("alignPin") as HTMLElement).style.left = ((s.align + 1) / 2) * 100 + "%";

    const rv = $("rivalStat");
    rv.classList.toggle("hidden", !s.rival.active);
    if (s.rival.active) {
      $("sRival").textContent = String(Math.floor(s.rival.faith));
      $("sRivalName").textContent = s.rival.name;
    }

    if (s.era !== this.lastEra) {
      if (this.lastEra >= 0) this.alert(`ผู้ศรัทธาก้าวเข้าสู่${this.eraNames[s.era]}`, "good");
      this.lastEra = s.era;
    }
    for (const d of s.disasters) {
      const key = `${d.kind}@${d.x},${d.y}`;
      if (!this.seenDisasters.has(key)) { this.seenDisasters.add(key); this.alert(disasterLabel(d.kind), "bad"); }
    }
    if (this.seenDisasters.size > 40) this.seenDisasters.clear();

    if (s.log.length !== this.lastLogLen) {
      this.lastLogLen = s.log.length;
      const last = s.log[s.log.length - 1];
      if (last) this.say(last);
    }
    if (performance.now() - this.msgAt > 5200) $("ticker").textContent = "";

    // ราคาคาถาขยับตามแกนธรรม สร้างปุ่มใหม่เมื่อขยับพอสมควรเท่านั้น
    const bucket = Math.round(s.align * 10);
    if (bucket !== this.lastAlignBucket) { this.lastAlignBucket = bucket; this.refreshCosts(s); }
    for (const sp of SPELLS) {
      const b = document.getElementById("sp_" + sp.id) as HTMLButtonElement | null;
      if (b) b.disabled = s.faith < spellCost(sp, s.align);
    }

    const c = petOf(s);
    if (c) {
      $("petFace").textContent = String(c.gen);
      const act = c.act ? ACTION_NAME[c.act] : c.lastAct ? "เพิ่ง" + ACTION_NAME[c.lastAct] : "…";
      const need = c.need === "content" ? "" : ` · ${NEED_NAME[c.need]}`;
      $("petAct").textContent = c.alive
        ? `รุ่นที่ ${c.gen} · ${act}${need}${c.cmd ? " · ทำตามคำสั่ง" : ""}`
        : "สิ้นชีพ";
      ($("barE") as HTMLElement).style.width = c.energy * 100 + "%";
      ($("barA") as HTMLElement).style.width = (100 - Math.min(1, c.age / maxAge(c)) * 100) + "%";
      ($("barB") as HTMLElement).style.width = c.bond * 100 + "%";
      ($("bPraise") as HTMLElement).style.opacity = c.fbTimer > 0 ? "1" : "0.35";
      ($("bScold") as HTMLElement).style.opacity = c.fbTimer > 0 ? "1" : "0.35";
    }

    if (!$("genome").classList.contains("hidden")) this.drawGenome(s);
  }

  private refreshCosts(s: GameState) {
    for (const sp of SPELLS) {
      const b = document.getElementById("sp_" + sp.id);
      const cst = b?.querySelector(".cst");
      if (cst) cst.textContent = String(spellCost(sp, s.align));
    }
  }

  drawGenome(s: GameState) {
    const c = petOf(s);
    if (!c) return;
    const wild = s.creatures.filter((x) => !x.pet);
    let h = `<h3>สัตว์รุ่นที่ ${c.gen}${s.best ? ` · สถิติสูงสุด ${Math.round(s.best.fit)}` : ""}</h3>`;
    h += `<div class="sub">ขนาดตัวจริง ${bodySize(c).toFixed(2)} · ความผูกพัน ${pct(c.bond)} · จำสถานที่ได้ ${Object.keys(c.mem).length} แห่ง</div>`;
    for (const k of Object.keys(c.genes) as (keyof typeof c.genes)[]) {
      const v = c.genes[k];
      const avg = wild.length ? wild.reduce((a, x) => a + x.genes[k], 0) / wild.length : v;
      h += `<div class="grow-row"><em>${GENE_NAME[k]}</em>
        <div class="bar"><i style="width:${v * 100}%;background:#6aa0b5"></i>
        <u style="left:${avg * 100}%"></u></div>
        <em>${v.toFixed(2)}</em></div>`;
    }
    h += `<div class="sub">ขีดขาวคือค่าเฉลี่ยของสัตว์ป่า ${wild.length} ตัวในโลก</div>`;
    h += '<div style="height:8px"></div>';
    const mx = Math.max(...Object.values(c.w));
    for (const k of Object.keys(c.w) as (keyof typeof c.w)[]) {
      h += `<div class="grow-row"><em>${ACTION_NAME[k]}</em>
        <div class="bar"><i style="width:${(c.w[k] / mx) * 100}%;background:var(--gold)"></i></div>
        <em>${c.w[k].toFixed(2)}</em></div>`;
    }
    $("genome").innerHTML = h;
  }

  /** แผงตรวจสอบช่อง: แตะแล้วเห็นว่าดินตรงนี้เป็นยังไง หมู่บ้านนี้ขาดอะไร */
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
    if (t.village) h += this.villageBlock(s, t.village);
    el.innerHTML = h;
  }

  private villageBlock(s: GameState, v: Village) {
    const side = v.devotion > 0.2 ? "บูชาท่าน"
               : v.devotion < -0.2 ? `บูชา${s.rival.name}` : "ยังไม่เลือกข้าง";
    const bar = (label: string, val: number) =>
      `<div class="kv"><span>${label}</span>
        <div class="minibar"><i style="width:${val * 100}%;background:${val < 0.5 ? "#c4795a" : "#7fc08a"}"></i></div>
        <b>${pct(val)}</b></div>`;
    return `<hr><h3>หมู่บ้าน${v.name}</h3>
      <div class="kv"><span>ผู้คน</span><b>${Math.round(v.pop)}</b></div>
      <div class="kv"><span>ศรัทธา</span><b>${pct(v.belief)}</b></div>
      <div class="kv"><span>ใจของพวกเขา</span><b>${side}</b></div>
      ${bar("อาหาร", v.needs.food)}${bar("ไม้", v.needs.wood)}${bar("ที่อยู่", v.needs.shelter)}
      ${v.plague > 0 ? '<div class="kv bad"><span>โรคระบาด</span><b>กำลังลุกลาม</b></div>' : ""}
      <div class="sub">หมู่บ้านทั้งโลก ${s.villages.length}/${maxVillages(s)} แห่ง</div>`;
  }
}
