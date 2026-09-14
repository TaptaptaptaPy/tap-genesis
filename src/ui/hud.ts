import { ACTION_NAME, GENE_NAME, maxAge, SPELLS, spellCost, totalPop, type GameState }
  from "../sim/index";

const SIGIL: Record<string, string> = {
  rain:  '<path d="M5 10a4 4 0 018-1 3 3 0 011 5.8"/><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3"/>',
  grove: '<path d="M12 20v-5"/><path d="M12 15l-5-4h3L6 7h4L12 4l2 3h4l-4 4h3z"/>',
  bolt:  '<path d="M13 3L5 13h5l-1 8 8-10h-5z"/>',
  bless: '<circle cx="12" cy="12" r="3.5"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M6 6l1.5 1.5M16.5 16.5L18 18M18 6l-1.5 1.5M7.5 16.5L6 18"/>',
  seed:  '<path d="M4 12l8-7 8 7"/><path d="M6 11v8h12v-8"/><path d="M10 19v-4h4v4"/>',
  quake: '<path d="M3 15h4l2-5 3 9 2.5-7 1.5 3h5"/><path d="M3 20h18"/>',
};

const $ = (id: string) => document.getElementById(id)!;

export class Hud {
  private lastLogLen = 0;
  private msgAt = 0;

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

  say(msg: string) { $("ticker").textContent = msg; this.msgAt = performance.now(); }

  update(s: GameState) {
    $("sFaith").textContent = String(Math.floor(s.faith));
    $("sPop").textContent = String(Math.round(totalPop(s)));
    $("sEra").textContent = this.eraNames[s.era];
    ($("alignPin") as HTMLElement).style.left = ((s.align + 1) / 2) * 100 + "%";

    if (s.log.length !== this.lastLogLen) {
      this.lastLogLen = s.log.length;
      const last = s.log[s.log.length - 1];
      if (last) this.say(last);
    }
    if (performance.now() - this.msgAt > 5200) $("ticker").textContent = "";

    for (const sp of SPELLS) {
      const b = document.getElementById("sp_" + sp.id) as HTMLButtonElement | null;
      if (!b) continue;
      const c = spellCost(sp, s.align);
      b.disabled = s.faith < c;
      const cst = b.querySelector(".cst");
      if (cst) cst.textContent = String(c);
    }

    const c = s.creature;
    $("petFace").textContent = String(c.gen);
    const act = c.act ? ACTION_NAME[c.act] : c.lastAct ? "เพิ่ง" + ACTION_NAME[c.lastAct] : "…";
    $("petAct").textContent = c.alive ? `รุ่นที่ ${c.gen} · ${act}` : "สิ้นชีพ";
    ($("barE") as HTMLElement).style.width = c.energy * 100 + "%";
    ($("barA") as HTMLElement).style.width = (100 - Math.min(1, c.age / maxAge(c)) * 100) + "%";
    ($("bPraise") as HTMLElement).style.opacity = c.fbTimer > 0 ? "1" : "0.35";
    ($("bScold") as HTMLElement).style.opacity = c.fbTimer > 0 ? "1" : "0.35";

    if (!$("genome").classList.contains("hidden")) this.drawGenome(s);
  }

  drawGenome(s: GameState) {
    const c = s.creature;
    let h = `<h3>สัตว์รุ่นที่ ${c.gen}${s.best ? ` · สถิติสูงสุด ${Math.round(s.best.fit)}` : ""}</h3>`;
    for (const k of Object.keys(c.genes) as (keyof typeof c.genes)[]) {
      const v = c.genes[k];
      h += `<div class="grow-row"><em>${GENE_NAME[k]}</em>
        <div class="bar"><i style="width:${v * 100}%;background:#6aa0b5"></i></div>
        <em>${v.toFixed(2)}</em></div>`;
    }
    h += '<div style="height:8px"></div>';
    const mx = Math.max(...Object.values(c.w));
    for (const k of Object.keys(c.w) as (keyof typeof c.w)[]) {
      h += `<div class="grow-row"><em>${ACTION_NAME[k]}</em>
        <div class="bar"><i style="width:${(c.w[k] / mx) * 100}%;background:var(--gold)"></i></div>
        <em>${c.w[k].toFixed(2)}</em></div>`;
    }
    $("genome").innerHTML = h;
  }
}
