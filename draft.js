// Draft: an eleven built as in the football games' draft mode, with a budget. Pick a formation, the leagues and the
// budget, then a captain among five stars; then click each position and keep one of five players drawn for it. A card
// costs the player's market value (SofaScore), and every draw holds at least two cards the budget allows while keeping
// enough for the positions still empty, so the eleven always closes. The cards (overall, six attributes, tier) come
// from draft.py (printed by carta.js); the chemistry is the Seleção's. A finished draft shows its best buy and starts
// a simulated cup, on its own screen (#/copa, copa.js). The draft is saved in this browser, draws and cup included, so
// reloading the page never draws again.

import { el, state, localGet, localSet, num, euros, country, playerLink, functionLabel, highlights, card, pageHead, playerRef, findRef } from "./comum.js";
import { FORMATIONS, formationSlots, chemistry, dots } from "./selecao.js";
import { playerCard, crest } from "./carta.js";
import { clubsOf, newCup, cupScreen } from "./copa.js";

const OFFER = 5;  // players drawn for each position
const AFFORDABLE = 2;  // at least this many of them within the budget
const CAPTAINS = 40;  // the captain's five come from the best 40 cards of the positions the formation uses
const TILT = 6;  // a card 6 points better is drawn e (2.7) times as often
// Budgets as shares of what the pool's stars cost: 11 times the mean value of its best fifth by overall, about € 83 mi
// for both leagues, € 100 mi for the Série A and € 9 mi for the Série B. With no limit, keeping the best card of each
// draw spends about € 100 mi for a team of 84.
const BUDGETS = [["apertado", "Apertado", 0.2], ["medio", "Médio", 0.4], ["folgado", "Folgado", 0.7], ["livre", "Sem limite", null]];
// The team's overall on the Série A's scale, whose average regular prints 78.
const VERDICTS = [[84, "Time de campeão"], [82, "Briga pelo título"], [80, "Vaga na Libertadores"], [78, "Meio de tabela"],
  [76, "Luta contra o rebaixamento"], [0, "Série B à vista"]];
const STEPS = ["inicio", "capitao", "campo"];
const local = { draft: null, root: null, open: null, show: null, confirmNew: false };

const refOf = (c) => playerRef(c.slug, c.player);
const byOverall = (a, b) => b.player.carta.geral - a.player.carta.geral;
const byPrice = (a, b) => a.player.valor - b.player.valor;
const sum = (list) => list.reduce((s, x) => s + x, 0);
const money = (v) => (v >= 1e6 ? `€ ${num(v / 1e6, Number.isInteger(Math.round(v / 1e5) / 10) ? 0 : 1)} mi`
  : v >= 1e3 ? `€ ${Math.round(v / 1e3)} mil` : "€ 0");

// ---- the draft, saved in this browser

function blank(formation = "4-3-3", pool = "todas", tier = "medio") {
  const shape = formationSlots(formation);
  return { v: 2, formation, pool, tier, budget: null, step: "inicio", shape, slots: shape.map(() => null), captain: null,
           offers: {}, captains: [], cup: null };
}

function load() {
  let saved = null;
  try { saved = JSON.parse(localGet("draft") || "null"); } catch (_) {}
  if (!saved || ![1, 2].includes(saved.v) || !FORMATIONS.includes(saved.formation)) return blank();
  // a draft saved before budgets (v 1) goes on without one
  const draft = blank(saved.formation, saved.pool, BUDGETS.some(([key]) => key === saved.tier) ? saved.tier : "livre");
  if (draft.pool !== "todas" && !state.data[draft.pool]) draft.pool = "todas";
  draft.budget = typeof saved.budget === "number" && saved.budget > 0 ? saved.budget : null;
  // A player gone from the data (a new build, fewer minutes, another position, no value under a budget) frees his
  // slot and voids his draw.
  const fits = (ref, role) => {
    const found = findRef(ref);
    return !!(found && found.player.carta && (!role || found.player.pos === role) && (draft.budget == null || found.player.valor));
  };
  draft.slots = draft.shape.map((slot, i) => (fits((saved.slots || [])[i], slot.role) ? saved.slots[i] : null));
  for (const [i, refs] of Object.entries(saved.offers || {})) {
    const slot = draft.shape[i];
    if (slot && !draft.slots[i] && Array.isArray(refs) && refs.every((ref) => fits(ref, slot.role))) draft.offers[i] = refs;
  }
  draft.captain = draft.slots[saved.captain] ? saved.captain : null;
  const cup = saved.cup;  // a cup belongs to a finished draft; one saved before the line-ups (no xi) is dropped
  if (draft.slots.every(Boolean) && cup && cup.v === 2 && Array.isArray(cup.teams) && cup.teams.length === 16
      && cup.teams.some((t) => t.user) && cup.teams.every((t) => Array.isArray(t.xi) && t.xi.every((ref) => findRef(ref)))
      && Array.isArray(cup.results) && cup.results.length <= 4) draft.cup = cup;
  draft.step = STEPS.includes(saved.step) ? saved.step : "inicio";
  if (draft.step === "capitao") {
    draft.captains = Array.isArray(saved.captains) && saved.captains.every((ref) => fits(ref)) ? saved.captains : drawCaptains(draft);
  }
  return draft;
}

function save() { localSet("draft", JSON.stringify(local.draft)); }

// ---- the pool, the money and the draws

function pool(draft, priced = draft.budget != null) {  // every card within the chosen leagues: {slug, player, league}
  const found = [];
  for (const [slug, data] of Object.entries(state.data)) {
    if (draft.pool !== "todas" && slug !== draft.pool) continue;
    for (const player of data.jogadores) {
      if (player.carta && (!priced || player.valor)) found.push({ slug, player, league: data.nome });  // a price is his value
    }
  }
  return found;
}

function budgetOf(draft, tier) {  // the budget a tier gives the chosen leagues, rounded to a plain figure; null: no limit
  const share = BUDGETS.find(([key]) => key === tier)?.[2];
  if (share == null) return null;
  const cards = pool(draft, true).sort(byOverall);
  const stars = cards.slice(0, Math.max(11, Math.floor(cards.length / 5)));
  const target = share * 11 * sum(stars.map((c) => c.player.valor)) / stars.length;
  const power = 10 ** Math.floor(Math.log10(target)), steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10];
  return steps.reduce((best, s) => (Math.abs(s * power - target) < Math.abs(best * power - target) ? s : best)) * power;
}

const spent = (draft) => sum(draft.slots.filter(Boolean).map((ref) => findRef(ref).player.valor || 0));

// (card) => whether slot i can take it: its price, plus the cheapest players left for the other empty slots, fits
// what is left of the budget. So whatever the pick, the eleven can still be closed.
function budgetCheck(draft, i) {
  if (draft.budget == null) return () => true;
  const onPitch = new Set(draft.slots.filter(Boolean)), need = {};
  draft.shape.forEach((slot, k) => { if (k !== i && !draft.slots[k]) need[slot.role] = (need[slot.role] || 0) + 1; });
  const prices = {};
  for (const c of pool(draft)) {
    if (need[c.player.pos] && !onPitch.has(refOf(c))) (prices[c.player.pos] ||= []).push([c.player.valor, refOf(c)]);
  }
  Object.values(prices).forEach((list) => list.sort((a, b) => a[0] - b[0]));
  const left = draft.budget - spent(draft);
  return (c) => {
    const me = refOf(c);
    let reserve = 0;
    for (const [role, n] of Object.entries(need)) {
      const cheapest = (prices[role] || []).filter(([, ref]) => ref !== me).slice(0, n);
      if (cheapest.length < n) return false;
      reserve += sum(cheapest.map(([v]) => v));
    }
    return c.player.valor <= left - reserve;
  };
}

function slotLimit(draft, i) {  // the most slot i can cost, keeping the cheapest players for the other empty slots
  const need = draft.shape.filter((slot, k) => k !== i && !draft.slots[k]).map((slot) => slot.role);
  const onPitch = new Set(draft.slots.filter(Boolean));
  let reserve = 0;
  for (const role of new Set(need)) {
    const prices = pool(draft).filter((c) => c.player.pos === role && !onPitch.has(refOf(c))).map((c) => c.player.valor).sort((a, b) => a - b);
    reserve += sum(prices.slice(0, need.filter((r) => r === role).length));
  }
  return draft.budget - spent(draft) - reserve;
}

function taken(draft, except = null) {  // players on the pitch or waiting in another slot's draw
  const refs = new Set(draft.slots.filter(Boolean));
  for (const [i, offer] of Object.entries(draft.offers)) if (Number(i) !== except) offer.forEach((ref) => refs.add(ref));
  return refs;
}

// k of the candidates, without repeats, the better cards more often (weighted sampling by the keys u^(1/w)).
function drawFrom(candidates, k) {
  const weight = (c) => Math.exp((c.player.carta.geral - state.meta.carta.media) / TILT);
  return candidates.map((c) => ({ c, key: Math.random() ** (1 / weight(c)) }))
    .sort((a, b) => b.key - a.key).slice(0, k).map((x) => x.c).sort(byOverall);
}

// Five cards the budget allows at least AFFORDABLE of: out-of-reach ones, the dearest first, make room for cheaper
// draws. Called with the five already drawn, it only mends them (a player since taken elsewhere, a budget since spent).
function mend(five, candidates, ok) {
  const short = Math.min(AFFORDABLE, candidates.filter(ok).length) - five.filter(ok).length;
  if (short <= 0) return five;
  const cheap = drawFrom(candidates.filter((c) => ok(c) && !five.includes(c)), short);
  return [...five.filter(ok), ...five.filter((c) => !ok(c)).sort(byPrice)].slice(0, OFFER - cheap.length).concat(cheap).sort(byOverall);
}

function fillSlot(draft, i) {
  const role = draft.shape[i].role, busy = taken(draft, i), onPitch = new Set(draft.slots.filter(Boolean));
  const candidates = pool(draft).filter((c) => c.player.pos === role && !onPitch.has(refOf(c)));
  let five = (draft.offers[i] || []).map(findRef).filter((c) => c && !onPitch.has(refOf(c)));
  const fresh = candidates.filter((c) => !busy.has(refOf(c)) && !five.some((f) => refOf(f) === refOf(c)));
  if (five.length < OFFER) five = five.concat(drawFrom(fresh, OFFER - five.length));
  five = five.map((c) => candidates.find((x) => refOf(x) === refOf(c)) || c);
  // the budget's two come from players no other draw holds, or from another slot's draw when nothing else fits
  const ok = budgetCheck(draft, i);
  five = mend(mend(five, candidates.filter((c) => !busy.has(refOf(c))), ok), candidates, ok);
  draft.offers[i] = five.map(refOf);
}

const captainSlot = (draft, c) => draft.shape.findIndex((slot, k) => slot.role === c.player.pos && !draft.slots[k]);

function drawCaptains(draft) {
  const roles = new Set(draft.shape.map((s) => s.role));
  const fit = pool(draft).filter((c) => roles.has(c.player.pos)).sort(byOverall);
  return mend(drawFrom(fit.slice(0, CAPTAINS), OFFER), fit, captainCheck(draft)).map(refOf);
}

function captainCheck(draft) {  // (card) => the budget allows him as captain, in the first empty slot of his position
  const checks = {};
  return (c) => {
    const i = captainSlot(draft, c);
    return i >= 0 && (checks[i] ||= budgetCheck(draft, i))(c);
  };
}

// ---- the best buy: the pick that saved the most against what a card of his overall usually costs in this draw

function typicalPrice(draft) {  // (overall) => the median price of the draw's cards of that overall (widening to ±4)
  const cards = pool(draft, true);
  return (overall) => {
    for (const reach of [0, 1, 2, 4]) {
      const prices = cards.filter((c) => Math.abs(c.player.carta.geral - overall) <= reach).map((c) => c.player.valor).sort((a, b) => a - b);
      if (prices.length >= 5) return prices[Math.floor((prices.length - 1) / 2)];
    }
    return null;
  };
}

function buys(draft, refs) {  // the priced picks, each with the typical price of his overall and what he saved on it
  const typical = typicalPrice(draft);
  return refs.filter((ref) => ref && ref.player.valor).map((ref) => ({ ref, typical: typical(ref.player.carta.geral) }))
    .filter((b) => b.typical).map((b) => ({ ...b, saved: b.typical - b.ref.player.valor, share: b.ref.player.valor / b.typical }));
}

function bestBuy(draft, refs) {
  const list = buys(draft, refs);
  if (!list.length) return null;
  // most money saved; when nobody came cheap, the one closest to his typical price
  const best = list.reduce((a, b) => (b.saved > a.saved ? b : a));
  const worst = list.reduce((a, b) => (b.saved < a.saved ? b : a));
  const p = best.ref.player;
  const why = best.saved > 0 ? `Economia de ${euros(best.saved)}: saiu por ${Math.round(best.share * 100)}% do preço típico.`
    : "Ninguém saiu abaixo do preço típico; esta foi a que mais se aproximou.";
  return el("div", { class: "sc-buy" },
    el("button", { class: "sc-buy__card", type: "button", "aria-label": `Ver a carta de ${p.nome}`,
      onclick: () => { local.show = local.draft.slots.indexOf(playerRef(best.ref.slug, p)); draw(); } }, playerCard(best.ref)),
    el("div", { class: "sc-buy__text" },
      el("h3", { class: "sc-subhead", text: "Melhor compra" }),
      el("p", { class: "sc-buy__name", text: `${p.nome} · ${euros(p.valor)}` }),
      el("p", { class: "sc-note", text: `Uma carta de geral ${p.carta.geral} costuma custar ${euros(best.typical)} neste sorteio (a mediana). ${why}` }),
      worst !== best && worst.share >= 1.25 ? el("p", { class: "sc-note", text: `A mais salgada: ${worst.ref.player.nome}, ${euros(worst.ref.player.valor)}, `
        + `${num(worst.share, 1)} vezes o preço típico de uma carta ${worst.ref.player.carta.geral}.` }) : null));
}

const leagueName = (ref) => ref.league.replace(/ \d{4}$/, "");  // "Série A 2026" -> "Série A"

// ---- actions

function pick(i, ref) {
  const draft = local.draft;
  draft.slots[i] = ref;
  delete draft.offers[i];
  local.open = null;
  save();
  draw();
}

function pickCaptain(ref) {
  const draft = local.draft, i = captainSlot(draft, findRef(ref));
  if (i < 0) return;
  Object.assign(draft, { captain: i, captains: [], step: "campo" });
  draft.slots[i] = ref;
  save();
  draw();
}

function openSlot(i) {
  const draft = local.draft;
  if (draft.slots[i]) return;
  const before = JSON.stringify(draft.offers[i] || null);
  fillSlot(draft, i);  // a new draw, or the saved one mended
  if (JSON.stringify(draft.offers[i]) !== before) save();
  local.open = i;
  draw();
}

function start() {
  const draft = local.draft;
  Object.assign(draft, { budget: budgetOf(draft, draft.tier), step: "capitao" });
  draft.captains = drawCaptains(draft);
  save();
  draw();
}

function close() { local.open = null; local.show = null; draw(); }

// ---- the view

function teamRating(refs) {
  const cards = refs.filter(Boolean).map((r) => r.player.carta.geral);
  return cards.length ? Math.round(sum(cards) / cards.length) : null;
}

const verdict = (rating) => VERDICTS.find(([floor]) => rating >= floor)[1];

function offerMeta(ref) {
  const p = ref.player, best = p.carta.nivel === "destaque";
  return el("div", { class: "sc-offer__meta" },
    best ? el("span", { class: "sc-offer__badge", text: `Melhor ${state.meta.papeis[p.pos].singular} da ${leagueName(ref)}` }) : null,
    el("span", { class: "sc-offer__name", text: p.nome }),
    el("span", { class: "sc-offer__price", text: p.valor ? euros(p.valor) : "sem valor de mercado" }),
    el("span", { class: "sc-offer__line" }, crest(ref.slug, p, "sc-offer__crest"), el("span", { text: `${p.time} · ${leagueName(ref)}` })),
    el("span", { class: "sc-offer__line", text: [country(p.pais), p.idade != null ? `${p.idade} anos` : null].filter(Boolean).join(" · ") }),
    el("span", { class: "sc-offer__line is-muted", text: functionLabel(p) }),
    highlights(p, 2) ? el("span", { class: "sc-offer__line is-muted", text: `Destaques: ${highlights(p, 2)}` }) : null);
}

function offerList(refs, onPick, ok = () => true) {
  const fits = new Map(refs.map((text) => [text, ok(findRef(text))]));
  const shown = [...refs].sort((a, b) => fits.get(b) - fits.get(a));  // the ones the balance allows first, then by overall
  return el("div", { class: "sc-offers" }, shown.map((text) => {
    const ref = findRef(text), meta = offerMeta(ref), fit = fits.get(text);
    if (!fit) meta.prepend(el("span", { class: "sc-offer__over", text: "Acima do saldo desta vaga" }));
    return el("button", { class: "sc-offer" + (fit ? "" : " is-over"), type: "button", disabled: !fit, onclick: () => onPick(text),
      "aria-label": `${fit ? "Escolher" : "Fora do orçamento:"} ${ref.player.nome}, geral ${ref.player.carta.geral}` },
      playerCard(ref), meta);
  }));
}

function dialog(title, sub, body, closable, action = null, wide = true) {
  const box = el("div", { class: "sc-draft-dialog", role: "dialog", "aria-modal": "true", "aria-label": title },
    el("div", { class: "sc-draft-dialog__panel" + (wide ? "" : " is-narrow") },
      el("div", { class: "sc-draft-dialog__head" },
        el("div", { class: "sc-draft-dialog__titles" }, el("p", { class: "ooyl-kicker", text: "Draft" }),
          el("h2", { class: "ooyl-headline", text: title }), sub ? el("p", { class: "ooyl-sub", text: sub }) : null),
        closable ? el("button", { class: "ooyl-btn ooyl-btn--ghost ooyl-btn--sm", type: "button", text: "Fechar", onclick: close }) : action),
      body));
  if (closable) {
    box.addEventListener("keydown", (ev) => { if (ev.key === "Escape") close(); });
    box.addEventListener("click", (ev) => { if (ev.target === box) close(); });
  }
  return box;
}

function segmented(label, options, value, change) {
  return el("div", { class: "sc-draft-choice" },
    el("span", { class: "sc-subhead", text: label }),
    el("div", { class: "ooyl-tabs ooyl-tabs--segmented", role: "tablist", "aria-label": label },
      options.map(([v, t]) => el("button", { class: "ooyl-tab", type: "button", role: "tab", "aria-selected": String(v === value),
        text: t, onclick: () => change(v) }))));
}

function startScreen() {
  const draft = local.draft;
  const short = (l) => l.nome.replace(/ \d{4}$/, "");
  const leagues = [["todas", state.leagues.map(short).join(" e ")], ...state.leagues.map((l) => [l.slug, `Só a ${short(l)}`])];
  const budgets = BUDGETS.map(([key, name]) => { const value = budgetOf(draft, key); return [key, value == null ? name : `${name} · ${money(value)}`]; });
  const unpriced = pool(draft, false).length - pool(draft, true).length;
  const limited = BUDGETS.find(([key]) => key === draft.tier)[2] != null;
  return el("div", { class: "ooyl-card sc-draft-start" },
    segmented("Formação", FORMATIONS.map((f) => [f, f]), draft.formation, (v) => { Object.assign(draft, blank(v, draft.pool, draft.tier)); save(); draw(); }),
    segmented("Jogadores de", leagues, draft.pool, (v) => { draft.pool = v; save(); draw(); }),
    segmented("Orçamento", budgets, draft.tier, (v) => { draft.tier = v; save(); draw(); }),
    el("p", { class: "sc-note", text: `${num(pool(draft, limited).length, 0)} cartas no sorteio: os jogadores com ${num(state.meta.minimo, 0)}+ `
      + "minutos na temporada. Cada carta custa o valor de mercado do jogador no SofaScore"
      + (limited && unpriced ? `; ${unpriced} ${unpriced === 1 ? "jogador sem valor fica" : "jogadores sem valor ficam"} de fora` : "")
      + ". Primeiro vem o capitão, entre cinco dos melhores; depois clique em cada posição e fique com um de cinco sorteados para ela." }),
    el("div", { class: "sc-actions" }, el("button", { class: "ooyl-btn ooyl-btn--primary", type: "button", text: "Começar o draft", onclick: start })));
}

function slotNode(i, ref, chem) {
  const draft = local.draft, slot = draft.shape[i];
  if (!ref) {
    return el("button", { class: "sc-draft-slot is-empty", type: "button", onclick: () => openSlot(i),
      "aria-label": `Escolher ${state.meta.papeis[slot.role].singular}`, disabled: draft.step !== "campo" },
      el("span", { class: "sc-draft-slot__box" },
        el("span", { class: "sc-draft-slot__plus", text: "+" }), el("span", { class: "sc-draft-slot__role", text: slot.role })));
  }
  return el("button", { class: "sc-draft-slot", type: "button", title: `${ref.player.nome} · ${ref.player.time}`,
    "aria-label": `Ver a carta de ${ref.player.nome}`, onclick: () => { local.show = i; draw(); } },
    playerCard(ref, { captain: draft.captain === i }),
    el("span", { class: "sc-draft-slot__foot" }, dots(chem), el("span", { class: "sc-draft-slot__price", text: ref.player.valor ? euros(ref.player.valor) : "–" })));
}

function pitch(refs, chem) {
  const draft = local.draft;
  const lines = [...new Set(draft.shape.map((s) => s.line))].sort((a, b) => b - a);  // attack on top
  const widest = Math.max(...lines.map((line) => draft.shape.filter((s) => s.line === line).length));
  return el("div", { class: "ooyl-pitch sc-draft-pitch", style: `--cols: ${widest}` },  // every card as wide as the widest line allows
    el("div", { class: "ooyl-pitch__turf", "aria-hidden": "true" },
      el("i", { class: "c" }), el("i", { class: "box top" }), el("i", { class: "six top" }),
      el("i", { class: "box bottom" }), el("i", { class: "six bottom" })),
    lines.map((line) => el("div", { class: "ooyl-pitch__row" },
      draft.shape.map((slot, i) => [slot, i]).filter(([slot]) => slot.line === line).map(([, i]) => slotNode(i, refs[i], chem.perSlot[i])))));
}

function newButton(primary) {
  return el("button", { class: `ooyl-btn ${primary ? "ooyl-btn--primary" : "ooyl-btn--ghost"} ooyl-btn--sm`, type: "button",
    text: local.confirmNew ? "Apagar este e começar outro" : "Novo draft",
    onclick: () => {
      const draft = local.draft, midway = draft.slots.some(Boolean) && draft.slots.some((s) => !s);
      if (midway && !local.confirmNew) {  // one more click to throw away a draft in progress
        local.confirmNew = true;
        draw();
        setTimeout(() => { if (local.confirmNew) { local.confirmNew = false; draw(); } }, 4000);
        return;
      }
      local.confirmNew = false;
      local.draft = blank(draft.formation, draft.pool, draft.tier);
      save();
      draw();
    } });
}

function tiles(refs, chem) {
  const draft = local.draft, count = refs.filter(Boolean).length, rating = teamRating(refs), done = count === draft.shape.length;
  const used = spent(draft);
  const tile = (label, value, note) => el("div", { class: "ooyl-tile" }, el("span", { class: "ooyl-tile__label", text: label }),
    el("span", { class: "ooyl-tile__value", text: value }), el("span", { class: "ooyl-tile__note", text: note }));
  return el("div", { class: "ooyl-tiles sc-draft-tiles" },
    tile("Geral", rating == null ? "–" : String(rating), count ? `média de ${count} ${count === 1 ? "carta" : "cartas"}` : "nenhuma carta ainda"),
    tile("Química", chem.team == null ? "–" : String(chem.team), `de 100 · ${chem.links.length} ${chem.links.length === 1 ? "ligação" : "ligações"}`),
    draft.budget == null ? tile("Gasto", money(used), "sem limite de orçamento")
      : tile("Saldo", money(draft.budget - used), `de ${money(draft.budget)} · gastou ${money(used)}`),
    tile("Escalados", `${count}/${draft.shape.length}`, done ? "time completo" : "clique numa posição vazia"));
}

function explain() {
  const c = state.meta.carta;
  const item = (title, text) => el("p", { class: "sc-note" }, el("strong", { text: `${title}: ` }), text);
  return card("Como funciona", null, el("div", { class: "sc-draft-rules" },
    item("Geral", "o perfil de scouting (percentis nas métricas da posição), a nota média do SofaScore e o valor de mercado, "
      + `comparados com os regulares da mesma posição e da mesma liga. A média das cartas da Série A é ${c.media}, e a Série B `
      + "fica 8 pontos abaixo."),
    item("Atributos", "o perfil do jogador contra os de linha da liga (goleiros entre goleiros), em volta da nota geral: "
      + `um ponto forte sobe menos do que um ponto fraco desce. Ouro a partir de ${c.ouro}, prata a partir de ${c.prata}, bronze `
      + "abaixo; o destaque é o melhor de cada posição em cada liga."),
    item("Preço", "o valor de mercado do jogador no SofaScore, em euros, do dia em que o jogo dele foi baixado. O orçamento é uma "
      + "parte do que custam as estrelas das ligas escolhidas. Cada sorteio traz pelo menos duas cartas que cabem no saldo, "
      + "guardando o mínimo para as vagas que faltam, então o time sempre fecha."),
    item("Química", "a mesma da Seleção, pelas ligações entre vizinhos no campo.")));
}

function draw() {
  const draft = local.draft;
  const refs = draft.slots.map((ref) => findRef(ref));
  const chem = chemistry(refs, draft.shape);
  const parts = [pageHead("Draft", "Monte um time como no modo draft dos games de futebol, com orçamento: cada posição sorteia "
    + "cinco cartas e você fica com uma. As cartas saem dos números de cada jogador na temporada, e o preço é o valor de "
    + "mercado, ambos do SofaScore.")];
  if (draft.step === "inicio") {
    parts.push(startScreen(), explain());
  } else {
    const rating = teamRating(refs), done = refs.every(Boolean);
    const budgetText = draft.budget == null ? "sem limite" : `orçamento de ${money(draft.budget)}`;
    parts.push(el("div", { class: "sc-draft-bar" },
      el("span", { class: "sc-meta", text: `${draft.formation} · ${draft.pool === "todas" ? "todas as ligas" : state.data[draft.pool].nome} · ${budgetText}` }),
      newButton(false)));
    parts.push(tiles(refs, chem));
    if (done) {
      const cost = draft.budget == null ? `gastou ${money(spent(draft))}` : `gastou ${money(spent(draft))} de ${money(draft.budget)}`;
      parts.push(el("div", { class: "ooyl-card sc-draft-done" },
        el("div", { class: "sc-draft-done__verdict" },
          el("p", { class: "ooyl-kicker", text: "Draft completo" }),
          el("h2", { class: "ooyl-headline", text: verdict(rating) }),
          el("p", { class: "ooyl-sub", text: `${draft.formation} · geral ${rating} · química ${chem.team ?? "–"} · ${cost}.` }),
          el("div", { class: "sc-actions" },
            el("a", { class: "ooyl-btn ooyl-btn--primary", href: "#/copa", text: draft.cup ? "Continuar a Copa" : "Iniciar a Copa" }),
            newButton(false))),
        bestBuy(draft, refs)));
    }
    parts.push(el("div", { class: "sc-draft-field" }, pitch(refs, chem),
      el("p", { class: "sc-note", text: "Clique numa carta escalada para vê-la inteira, com clube, idade e valor." })));
    parts.push(explain());
    if (draft.step === "capitao") {
      const ok = captainCheck(draft);
      const sub = "Cinco dos melhores do sorteio, de posições que a formação usa. Ele entra na vaga dele"
        + (draft.budget == null ? "." : ` e sai do orçamento de ${money(draft.budget)}.`);
      parts.push(dialog("Escolha o capitão", sub, offerList(draft.captains, pickCaptain, ok), false,
        el("button", { class: "ooyl-btn ooyl-btn--ghost ooyl-btn--sm", type: "button", text: "Voltar",
          onclick: () => { Object.assign(draft, blank(draft.formation, draft.pool, draft.tier)); save(); draw(); } })));
    } else if (local.open != null && draft.offers[local.open]) {
      const i = local.open, role = draft.shape[i].role, empty = draft.slots.filter((s) => !s).length - 1;
      const ok = budgetCheck(draft, i), fit = draft.offers[i].filter((ref) => ok(findRef(ref))).length;
      const rest = empty === 0 ? "" : `, guardando o mínimo para ${empty === 1 ? "a outra vaga" : `as outras ${empty} vagas`}`;
      const sub = draft.budget == null ? "Cinco cartas sorteadas para esta posição; as melhores saem mais."
        : `Você pode gastar até ${money(slotLimit(draft, i))} aqui${rest}. `
          + (fit === OFFER ? "Todas as cinco cabem." : `${fit === 1 ? "Uma cabe" : `${fit} cabem`} no saldo.`);
      parts.push(dialog(`Escolha o ${state.meta.papeis[role].singular}`, sub, offerList(draft.offers[i], (ref) => pick(i, ref), ok), true));
    } else if (local.show != null && refs[local.show]) {
      const ref = refs[local.show];
      parts.push(dialog(ref.player.nome, null, el("div", { class: "sc-detail" },
        playerCard(ref, { captain: draft.captain === local.show }),
        el("div", { class: "sc-detail__side" }, offerMeta(ref),
          el("div", { class: "sc-actions" }, el("a", { class: "ooyl-btn ooyl-btn--sm", href: (state.playerBase || "") + playerLink(ref.slug, ref.player),
            text: "Ver todos os números", onclick: () => { state.back = "#/draft"; local.show = null; } })))), true, null, false));
    }
  }
  local.root.replaceChildren(...parts);
  document.body.classList.toggle("sc-has-dialog", !!local.root.querySelector(".sc-draft-dialog"));
  (local.root.querySelector(".sc-draft-dialog .sc-offer:not([disabled])") || local.root.querySelector(".sc-draft-dialog .ooyl-btn"))
    ?.focus({ preventScroll: true });
}

// ---- the cup's screen (#/copa)

function ensureCup() {  // the finished draft's cup, drawn the first time: its clubs play without the drafted players
  const draft = local.draft, refs = draft.slots.map((ref) => findRef(ref));
  if (!refs.every(Boolean)) return null;
  if (!draft.cup) {
    const overall = refs.reduce((s, r) => s + r.player.carta.geral, 0) / refs.length;
    const team = { formation: draft.formation, xi: [...draft.slots], captain: draft.captain, overall, chemistry: chemistry(refs, draft.shape).team };
    draft.cup = newCup(clubsOf(pool(draft, false), new Set(draft.slots)), team);
    save();
  }
  return draft.cup;
}

export function copaView() {
  if (!local.draft) local.draft = load();
  const root = el("div", {});
  const redraw = () => {
    const cup = ensureCup();
    if (!cup) {  // no finished draft in this browser: back to it
      root.replaceChildren(el("section", { class: "view" }, pageHead("Copa simulada", "A Copa começa quando o seu time estiver completo."),
        el("div", { class: "sc-actions" }, el("a", { class: "ooyl-btn ooyl-btn--primary", href: "#/", text: "Montar o time" }))));
      return;
    }
    root.replaceChildren(cupScreen(cup, {
      change: (fn) => {
        const step = `${cup.results.length}:${cup.seen}`;
        fn(cup);
        save();
        redraw();
        if (`${cup.results.length}:${cup.seen}` !== step) window.scrollTo(0, 0);  // a new stage starts at the top
      },
      back: () => { location.hash = "#/"; },
      again: () => { local.draft.cup = null; ensureCup(); redraw(); window.scrollTo(0, 0); },
    }));
  };
  redraw();
  return root;
}

export function draftView() {
  if (!local.draft) local.draft = load();
  local.open = null;
  local.show = null;
  local.confirmNew = false;
  local.root = el("section", { class: "view" });
  draw();
  return local.root;
}
