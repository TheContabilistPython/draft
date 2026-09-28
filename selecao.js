// Seleção: an eleven from the loaded leagues, with each player's traits, the team's style (how attacking or
// defensive, how it builds, how direct) and its chemistry: the links between neighbouring slots, stronger for
// players of the same club and for functions that complete each other. Saved in this browser.

import {
  el, state, localGet, localSet, num, euros, pctChip, chip, pctStep, metricIndex, metricShort, face, disc, country,
  roleName, playerLink, functionLabel, highlights, weakest, card, pageHead, playerRef, findRef, playerSearch,
} from "./comum.js";

export const FORMATIONS = ["4-3-3", "4-2-3-1", "4-4-2", "4-1-4-1", "3-5-2", "3-4-3", "5-3-2"];
const VALUES = [["todos", "Qualquer valor"], ["300000", "Até € 300 mil"], ["1000000", "Até € 1 mi"], ["3000000", "Até € 3 mi"],
  ["10000000", "Até € 10 mi"]];
const AGES = [["todas", "Qualquer idade"], ["21", "Até 21 anos"], ["23", "Até 23 anos"], ["25", "Até 25 anos"], ["28", "Até 28 anos"]];
const STYLE = [
  ["Ataque", ["xG/90", "xA/90", "chutes/90", "passes-chave/90", "grandes chances criadas/90", "dribles certos/90"]],
  ["Defesa", ["desarmes + interceptações/90", "recuperações/90", "cortes/90", "% duelo", "aéreos ganhos/90"]],
  ["Construção", ["passes certos/90", "% passe", "passes certos no campo rival/90"]],
  ["Verticalidade", ["conduções progressivas/90", "bolas longas certas/90", "dribles certos/90"]],
  ["Jogo aéreo", ["aéreos ganhos/90", "% aéreo"]],
  ["Intensidade", ["km/90", "sprints/90"]],
];
const TILT = 8;  // points between Ataque and Defesa that make the eleven offensive or "retranqueiro"
const local = { sel: null, pick: null, root: null };

// ---- the formation's slots, read as temporada.line_roles reads SofaScore's lineups: the ends of a line are wide

function lineRoles(index, size, lines) {
  const fill = (role, n) => Array(Math.max(0, n)).fill(role);
  if (index === 0) return size <= 3 ? fill("ZAG", size) : ["LAT", ...fill("ZAG", size - 2), "LAT"];
  if (index === lines.length - 1) return size <= 2 ? fill("ATA", size) : ["PON", ...fill("ATA", size - 2), "PON"];
  if (index === 1) {
    if (lines[0] === 3 && size >= 4) return ["LAT", ...fill("VOL", size - 2), "LAT"];
    if (size <= 2) return fill("VOL", size);
    if (size === 3) return ["MEI", "VOL", "MEI"];
    return ["PON", ...fill("VOL", size - 2), "PON"];
  }
  return size <= 2 ? fill("MEI", size) : ["PON", ...fill("MEI", size - 2), "PON"];
}

export function formationSlots(formation) {
  const lines = formation.split("-").map(Number);
  const slots = [{ role: "GOL", line: 0, x: 0.5 }];
  lines.forEach((size, li) => lineRoles(li, size, lines).forEach((role, k) => slots.push({ role, line: li + 1, x: (k + 1) / (size + 1) })));
  return slots;
}

// ---- the selection, saved in this browser

function load() {
  let saved = null;
  try { saved = JSON.parse(localGet("selecao") || "null"); } catch (_) {}
  // Profiles are measured within each league, so a new eleven starts in the league chosen at the top.
  const sel = Object.assign({ formation: "4-3-3", pool: state.league || "todas", idade: "todas", valor: "todos", slots: [], shape: [] }, saved || {});
  if (!FORMATIONS.includes(sel.formation)) sel.formation = "4-3-3";
  if (sel.pool !== "todas" && !state.data[sel.pool]) sel.pool = "todas";
  fit(sel);
  sel.fresh = !saved;
  return sel;
}

function fit(sel) {  // slots follow the formation; a chosen player keeps a slot of his role when there is one
  const shape = formationSlots(sel.formation);
  const kept = (sel.slots || []).map((ref, i) => ({ ref, role: (sel.shape || [])[i]?.role })).filter((s) => s.ref && findRef(s.ref));
  sel.slots = shape.map(() => null);
  for (const s of kept) {
    const i = shape.findIndex((slot, k) => slot.role === s.role && !sel.slots[k]);
    if (i >= 0) sel.slots[i] = s.ref;
  }
  sel.shape = shape;
}

function save() {
  const { formation, pool, idade, valor, slots, shape } = local.sel;
  localSet("selecao", JSON.stringify({ formation, pool, idade, valor, slots, shape }));
}

function eligible(slug, p) {
  const sel = local.sel;
  if (p.perfil == null || (sel.pool !== "todas" && slug !== sel.pool)) return false;
  if (sel.idade !== "todas" && (p.idade == null || p.idade > Number(sel.idade))) return false;
  if (sel.valor !== "todos" && (p.valor == null || p.valor > Number(sel.valor))) return false;
  return true;
}

function candidates(role) {
  const used = new Set(local.sel.slots.filter(Boolean)), found = [];
  for (const [slug, data] of Object.entries(state.data)) {
    for (const p of data.jogadores) {
      if (p.pos === role && eligible(slug, p) && !used.has(playerRef(slug, p))) found.push({ slug, p });
    }
  }
  return found.sort((a, b) => b.p.perfil - a.p.perfil);
}

function suggest() {
  const sel = local.sel;
  sel.slots = sel.shape.map(() => null);
  sel.shape.forEach((slot, i) => {
    const best = candidates(slot.role)[0];
    if (best) sel.slots[i] = playerRef(best.slug, best.p);
  });
  local.pick = null;
  save();
}

// ---- chemistry: links between neighbouring slots

function links(shape) {  // along each line, and from each slot to the nearest slot(s) of the next line
  const lines = {}, found = [], seen = new Set();
  shape.forEach((slot, i) => (lines[slot.line] ||= []).push(i));
  const add = (a, b) => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (!seen.has(key)) { seen.add(key); found.push([a, b]); }
  };
  for (const [line, members] of Object.entries(lines)) {
    for (let k = 0; k + 1 < members.length; k += 1) add(members[k], members[k + 1]);
    const next = lines[Number(line) + 1];
    if (!next) continue;
    for (const i of members) {
      const near = next.map((j) => [Math.abs(shape[j].x - shape[i].x), j]).sort((a, b) => a[0] - b[0]);
      add(i, near[0][1]);
      if (near[1] && near[1][0] - near[0][0] < 0.05) add(i, near[1][1]);
    }
  }
  return found;
}

function functionPair(a, b) {  // [points, reason] for two neighbours' functions, or null
  const pair = (r1, r2) => (a.pos === r1 && b.pos === r2) || (a.pos === r2 && b.pos === r1);
  const of = (role) => (a.pos === role ? a.fn : b.fn);
  if (a.pos === "ZAG" && b.pos === "ZAG") {
    const fns = new Set([a.fn, b.fn]);
    if (fns.has("construtor") && fns.has("defensivo")) return [2, "zagueiros que se completam: um sai jogando, o outro protege"];
    if (a.fn === "defensivo" && b.fn === "defensivo") return [-1, "dois zagueiros defensivos: pouca saída de bola"];
    return [0, null];
  }
  if (pair("LAT", "PON")) {
    const lat = of("LAT"), pon = of("PON");
    if (lat === "ofensivo" && pon === "tatico") return [2, "lateral que apoia com ponta que recompõe"];
    if (lat === "defensivo" && (pon === "agudo" || pon === "organizador")) return [2, "lateral que segura com ponta que ataca"];
    if (lat === "ofensivo" && pon === "agudo") return [-1, "lateral e ponta que só atacam: o corredor fica exposto"];
    return [0, null];
  }
  if (pair("LAT", "ZAG") && of("LAT") === "ofensivo" && of("ZAG") === "defensivo") return [1, "zagueiro que cobre o lateral que sobe"];
  const middle = ["VOL", "MEI"];
  if (middle.includes(a.pos) && middle.includes(b.pos)) {
    const markers = [a, b].filter((p) => p.fn === "marcador").length;
    if (markers === 1) return [2, "um marca, o outro joga"];
    if (markers === 2) return [0, "dois marcadores: sólido, mas pouco criativo"];
    if ([a, b].every((p) => p.fn === "box" || p.fn === "atacante")) return [-1, "dois que chegam à frente e ninguém protege"];
    return [0, null];
  }
  if (a.pos === "ATA" && b.pos === "ATA") {
    if (a.fn === "finalizador" && b.fn === "finalizador") return [0, "dois finalizadores disputam o mesmo espaço"];
    if (a.fn !== b.fn && a.fn !== "equilibrado" && b.fn !== "equilibrado") return [2, "dupla de ataque com funções diferentes"];
    return [0, null];
  }
  if (a.pos === "ATA" || b.pos === "ATA") {
    const ata = a.pos === "ATA" ? a : b, other = a.pos === "ATA" ? b : a;
    if ((ata.fn === "finalizador" || ata.fn === "pivo") && other.fn === "organizador") return [2, "quem cria abastece quem finaliza"];
    if (ata.fn === "pivo" && other.pos === "PON" && other.fn === "agudo") return [1, "o pivô segura a bola para o ponta atacar"];
    if (ata.fn === "segundo" && other.pos === "MEI" && other.fn === "atacante") return [-1, "segundo atacante e meia atacante na mesma faixa"];
    return [0, null];
  }
  if (pair("GOL", "ZAG") && of("GOL") === "libero" && of("ZAG") === "construtor") return [1, "goleiro e zagueiro que saem jogando"];
  return null;
}

function linkScore(a, b) {  // 0 to 10, with the reasons
  let score = 5;
  const reasons = [], pa = a.player, pb = b.player;
  if (pa.time === pb.time) { score += 3; reasons.push([3, `jogam juntos no ${pa.time}`]); }
  else if (a.slug !== b.slug) { score -= 1; reasons.push([-1, "ligas diferentes"]); }
  if (pa.pais && pa.pais === pb.pais && pa.pais !== "Brazil") { score += 1; reasons.push([1, `mesmo país (${country(pa.pais)})`]); }
  const fn = functionPair(pa, pb);
  if (fn && fn[1]) { score += fn[0]; reasons.push(fn); }
  return { score: Math.max(0, Math.min(10, score)), reasons };
}

export function chemistry(refs, shape = local.sel.shape) {  // also the Draft's
  const found = links(shape).filter(([i, j]) => refs[i] && refs[j])
    .map(([i, j]) => ({ i, j, ...linkScore(refs[i], refs[j]) }));
  const perSlot = refs.map((ref, i) => {
    const mine = found.filter((l) => l.i === i || l.j === i);
    return mine.length ? mine.reduce((s, l) => s + l.score, 0) / mine.length : null;
  });
  const team = found.length ? Math.round((found.reduce((s, l) => s + l.score, 0) / found.length) * 10) : null;
  return { links: found, perSlot, team };
}

const dotsFor = (value) => (value == null ? 0 : value >= 7 ? 3 : value >= 5.5 ? 2 : value >= 4 ? 1 : 0);
export const dots = (value) => el("span", { class: "sc-dots", title: value == null ? "sem ligações" : `química ${num(value, 1)} de 10` },
  [0, 1, 2].map((k) => el("i", { class: k < dotsFor(value) ? "is-on" : null })));

// ---- the team's style: each dimension is the eleven's mean percentile over its metrics (outfield players)

function styleOf(players) {
  return STYLE.map(([name, metrics]) => {
    const values = players.map((p) => {
      const found = metrics.map((m) => p.p[metricIndex(m)]).filter((x) => x != null);
      return found.length ? found.reduce((s, x) => s + x, 0) / found.length : null;
    }).filter((x) => x != null);
    return { name, metrics, value: values.length ? Math.round(values.reduce((s, x) => s + x, 0) / values.length) : null };
  });
}

function styleWords(style) {
  const get = (name) => style.find((s) => s.name === name).value;
  const attack = get("Ataque"), defence = get("Defesa");
  if (attack == null || defence == null) return { label: "–", text: "" };
  const tilt = attack - defence;
  const label = tilt >= TILT ? "Ofensivo" : tilt <= -TILT ? "Retranqueiro" : "Equilibrado";
  const traits = [];
  const build = get("Construção"), direct = get("Verticalidade"), air = get("Jogo aéreo"), pace = get("Intensidade");
  if (build != null && build >= 60) traits.push("gosta de ter a bola");
  if (direct != null && direct >= 60) traits.push("é vertical");
  if (build != null && direct != null && build < 45 && direct >= 50) traits.push("joga mais direto");
  if (air != null && air >= 60) traits.push("é forte no jogo aéreo");
  if (pace != null && pace >= 60) traits.push("é intenso");
  if (pace != null && pace <= 40) traits.push("corre pouco");
  const lead = tilt >= TILT ? `ataque ${attack} contra defesa ${defence}` : tilt <= -TILT ? `defesa ${defence} contra ataque ${attack}`
    : `ataque ${attack} e defesa ${defence}`;
  return { label, text: `${label}: ${lead}${traits.length ? `; ${traits.join(", ")}` : ""}.` };
}

// ---- the view

function slotNode(i, ref, chem) {
  const slot = local.sel.shape[i], active = local.pick === i;
  const open = () => { local.pick = i; draw(); };
  const clear = () => { local.sel.slots[i] = null; if (local.pick === i) local.pick = null; save(); draw(); };
  if (!ref) {
    return el("div", { class: "ooyl-player slot" + (active ? " active" : "") },
      el("span", { class: "ooyl-player__disc is-empty", text: slot.role }),
      el("span", { class: "empty-slot", text: `${state.meta.papeis[slot.role].singular} (vazio)` }),
      el("div", { class: "slot-actions" }, el("button", { class: "ooyl-btn ooyl-btn--sm", text: "Escolher", onclick: open })));
  }
  const p = ref.player;
  return el("div", { class: "ooyl-player slot" + (active ? " active" : "") },
    el("span", { class: "ooyl-player__disc" }, disc(ref.slug, p)),
    el("a", { class: "ooyl-player__name", href: playerLink(ref.slug, p), text: p.nome, title: `${p.time} · ${ref.league}` }),
    el("span", { class: "ooyl-player__meta" }, pctChip(p.perfil, "Perfil"),
      el("span", { class: "ooyl-player__marks", text: functionLabel(p).toLowerCase() })),
    dots(chem),
    el("div", { class: "slot-actions" },
      el("button", { class: "ooyl-btn ooyl-btn--sm", text: "Trocar", onclick: open }),
      el("button", { class: "ooyl-btn ooyl-btn--sm", text: "×", title: "esvaziar a vaga", "aria-label": "esvaziar a vaga", onclick: clear })));
}

function picker() {
  const i = local.pick, role = local.sel.shape[i].role, used = new Set(local.sel.slots.filter(Boolean));
  const assign = (slug, p) => { local.sel.slots[i] = playerRef(slug, p); local.pick = null; save(); draw(); };
  return el("div", { class: "picker" },
    el("div", { class: "ooyl-card__head" }, el("div", { class: "ooyl-card__titles" },
      el("h2", { class: "ooyl-headline ooyl-headline--sm", text: `Escolher ${state.meta.papeis[role].singular}` }),
      el("p", { class: "ooyl-sub", text: "Sem busca, os maiores perfis da posição dentro dos filtros. Busque pelo nome ou pelo time." })),
      el("div", { class: "ooyl-card__actions" },
        el("button", { class: "ooyl-btn ooyl-btn--ghost ooyl-btn--sm", text: "Fechar", onclick: () => { local.pick = null; draw(); } }))),
    playerSearch("Buscar jogador ou time", assign, { pos: role, id: -1 },
      (slug, p) => p.pos === role && eligible(slug, p) && !used.has(playerRef(slug, p))));
}

function controls() {
  const sel = local.sel;
  const select = (label, options, value, change) => el("span", { class: "ooyl-field" },
    el("label", { class: "ctl", text: label }),
    el("select", { class: "sc-select", "aria-label": label, onchange: (ev) => change(ev.target.value) },
      options.map(([v, t]) => el("option", { value: v, text: t, selected: v === value }))));
  const leagues = [["todas", "Todas as ligas"], ...state.leagues.map((l) => [l.slug, l.nome])];
  return el("div", { class: "filter-row sc-filters" },
    select("Formação", FORMATIONS.map((f) => [f, f]), sel.formation, (v) => { sel.formation = v; fit(sel); local.pick = null; save(); draw(); }),
    select("Ligas", leagues, sel.pool, (v) => { sel.pool = v; save(); draw(); }),
    select("Idade", AGES, sel.idade, (v) => { sel.idade = v; save(); draw(); }),
    select("Valor", VALUES, sel.valor, (v) => { sel.valor = v; save(); draw(); }),
    el("button", { class: "ooyl-btn ooyl-btn--primary ooyl-btn--sm", text: "Sugerir pelos perfis", onclick: () => { suggest(); draw(); } }),
    el("button", { class: "ooyl-btn ooyl-btn--ghost ooyl-btn--sm", text: "Limpar",
                   onclick: () => { sel.slots = sel.shape.map(() => null); local.pick = null; save(); draw(); } }));
}

function draw() {
  const sel = local.sel;
  const refs = sel.slots.map((ref) => findRef(ref));
  const chem = chemistry(refs);
  const players = refs.filter(Boolean);
  const outfield = players.filter((r) => r.player.pos !== "GOL").map((r) => r.player);
  const style = styleOf(outfield), words = styleWords(style);

  const lines = [...new Set(sel.shape.map((s) => s.line))].sort((a, b) => b - a);  // attack on top
  const pitch = el("div", { class: "ooyl-pitch sel-pitch" },
    el("div", { class: "ooyl-pitch__turf", "aria-hidden": "true" },
      el("i", { class: "c" }), el("i", { class: "box top" }), el("i", { class: "six top" }),
      el("i", { class: "box bottom" }), el("i", { class: "six bottom" })),
    lines.map((line) => el("div", { class: "ooyl-pitch__row" },
      sel.shape.map((slot, i) => [slot, i]).filter(([slot]) => slot.line === line).map(([, i]) => slotNode(i, refs[i], chem.perSlot[i])))));

  const values = players.map((r) => r.player.valor).filter(Boolean);
  const ages = players.map((r) => r.player.idade).filter((x) => x != null);
  const clubs = new Set(players.map((r) => r.player.time));
  const summary = players.length
    ? `${players.length} de 11 escalados · perfil médio ${Math.round(players.reduce((s, r) => s + r.player.perfil, 0) / players.length)}`
      + ` · idade média ${ages.length ? num(ages.reduce((s, x) => s + x, 0) / ages.length, 1) : "–"}`
      + ` · valor somado ${euros(values.reduce((s, x) => s + x, 0))} · ${clubs.size} ${clubs.size === 1 ? "clube" : "clubes"}`
    : "Nenhum jogador escalado: use Sugerir pelos perfis ou escolha vaga por vaga.";

  const tiles = el("div", { class: "ooyl-tiles sc-tiles" },
    el("div", { class: "ooyl-tile" }, el("span", { class: "ooyl-tile__label", text: "Estilo" }),
      el("span", { class: "ooyl-tile__value is-text", text: words.label }), el("span", { class: "ooyl-tile__note", text: words.text || "escale jogadores de linha" })),
    el("div", { class: "ooyl-tile" }, el("span", { class: "ooyl-tile__label", text: "Química" }),
      el("span", { class: "ooyl-tile__value", text: chem.team == null ? "–" : String(chem.team) }),
      el("span", { class: "ooyl-tile__note", text: `de 100 · ${chem.links.length} ligações entre vizinhos` })));

  const styleBars = el("div", { class: "sc-bars" }, style.map((s) => el("div", { class: "sc-fn" },
    el("span", { class: "sc-bar__label", text: s.name }),
    el("span", { class: "sc-bar__track" }, el("span", { class: `sc-bar__fill sc-step-${pctStep(s.value ?? 0)}`, style: `width: ${s.value ?? 0}%` })),
    el("span", { class: "sc-bar__pct", text: s.value ?? "–" }),
    el("p", { class: "sc-fn__metrics", text: s.metrics.map(metricShort).join(" · ") }))));

  const describe = (l) => {
    const a = refs[l.i].player, b = refs[l.j].player;
    return el("div", { class: "sc-link" },
      chip(num(l.score, 0), pctStep(l.score * 10), "força da ligação, de 0 a 10"),
      el("div", {}, el("strong", { text: `${a.nome} e ${b.nome}` }),
        el("small", { text: l.reasons.length ? l.reasons.map(([pts, why]) => `${pts > 0 ? "+" : pts < 0 ? "−" : "·"} ${why}`).join("; ")
          : "sem ligação especial" })));
  };
  const sorted = [...chem.links].sort((a, b) => b.score - a.score);
  const linkList = chem.links.length
    ? el("div", { class: "sc-columns sc-links" },
        el("div", {}, el("h3", { class: "sc-subhead", text: "Ligações mais fortes" }), sorted.slice(0, 5).map(describe)),
        el("div", {}, el("h3", { class: "sc-subhead", text: "Ligações mais fracas" }), sorted.slice(-4).reverse().map(describe)))
    : el("p", { class: "sc-note", text: "Escale jogadores vizinhos para ver a química." });

  const traits = el("div", { class: "scroll" }, el("table", { class: "sc-table" },
    el("thead", {}, el("tr", {}, ["Vaga", "Jogador", "Função", "Pontos fortes", "Ponto fraco", "Perfil", "Química"]
      .map((h, k) => el("th", { class: k === 1 || k === 2 || k === 3 || k === 4 ? "left" : null, text: h })))),
    el("tbody", {}, sel.shape.map((slot, i) => [slot, refs[i], i]).filter(([, ref]) => ref).map(([slot, ref, i]) => el("tr", {
      onclick: () => { location.hash = playerLink(ref.slug, ref.player); } },
      el("td", { class: "muted", text: slot.role }),
      el("td", { class: "left" }, el("div", { class: "sc-who" }, face(ref.slug, ref.player, "lg"),
        el("div", {}, el("a", { href: playerLink(ref.slug, ref.player), text: ref.player.nome, onclick: (ev) => ev.stopPropagation() }),
          el("small", { text: `${ref.player.time} · ${ref.league} · ${ref.player.idade ?? "?"} anos · ${euros(ref.player.valor)}` })))),
      el("td", { class: "left sc-fn-cell", text: functionLabel(ref.player) }),
      el("td", { class: "left sc-marks", text: highlights(ref.player, 2) || "–" }),
      el("td", { class: "left sc-marks", text: weakest(ref.player) }),
      el("td", {}, pctChip(ref.player.perfil, "Perfil")),
      el("td", {}, dots(chem.perSlot[i])))))));

  local.root.replaceChildren(
    pageHead("Seleção", "Monte um time com os jogadores das ligas carregadas. Cada vaga pede a posição dela, lida da formação. "
      + "Os números vêm dos percentis de cada jogador na posição e na liga dele."),
    controls(),
    el("div", { class: "sc-selecao" },
      el("div", { class: "ooyl-card sc-selecao__pitch" }, el("p", { class: "ooyl-sub", text: summary }),
        sel.pool === "todas" ? el("p", { class: "sc-note sc-warn", text: "Ligas juntas: o perfil é medido dentro de cada liga, "
          + "então um 80 na Série B não equivale a um 80 na Série A. A sugestão compara perfis, não o nível das ligas." }) : null,
        pitch,
        local.pick != null ? picker() : null),
      el("div", { class: "sc-selecao__side" }, tiles,
        card("Estilo do time", `Média dos percentis dos jogadores de linha em cada dimensão (50 = o regular mediano). Ofensivo ou `
          + `retranqueiro quando ataque e defesa se afastam ${TILT} pontos ou mais.`, styleBars))),
    card("Química", "Cada ligação entre vizinhos no campo vale de 0 a 10: começa em 5, sobe 3 para quem joga no mesmo clube e "
      + "ganha ou perde pontos pelas funções (um zagueiro que constrói ao lado de um que protege soma; lateral e ponta que só "
      + "atacam pelo mesmo lado tiram). Ligas diferentes tiram 1. A química do time é a média, de 0 a 100.", linkList),
    card("Características", "Função, os dois pontos mais fortes e o mais fraco de cada escalado, em percentis da posição.", traits));
}

export function selectionView() {
  if (!local.sel) local.sel = load();
  local.root = el("section", { class: "view" });
  if (local.sel.fresh) { local.sel.fresh = false; suggest(); }
  draw();
  return local.root;
}
