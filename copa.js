// Copa: the knockout cup after a draft, in the Copa do Brasil's format: from the round of 16, two legs, penalties on
// a level aggregate, the stronger side at home in the second leg. The drafted eleven meets 15 clubs of the draft's
// leagues. Each club lines up its most-used regulars in the formation it started most matches in (painel.py counts
// them; lineup falls back to the one that fits them best), with the Seleção's chemistry for that eleven: they play
// together, so it runs high.
//
// Strength = overall + (chemistry - 50) / 10. Goals are Poisson: an even match gives the home side GOALS * e^HOME and
// the visitors GOALS * e^-HOME, and each point of strength between the sides moves both by K. Each goal goes to a
// player of the side, weighted by his position (SCORING) and his finishing. The drafted team plays its tie leg by
// leg, each after a pre-match with both line-ups; the round's other ties are played with its second leg. Chances
// come from TRIALS simulated cups. It is a draw of lots, not a forecast.

import { el, num, state, playerRef, findRef } from "./comum.js";
import { FORMATIONS, formationSlots, chemistry } from "./selecao.js";
import { shortName, lineupPitch } from "./carta.js";

export const ROUNDS = ["Oitavas", "Quartas", "Semifinal", "Final"];
const STAGES = ["Oitavas de final", "Quartas de final", "Semifinal", "Final"];
const INTO = ["às oitavas", "às quartas", "à semifinal", "à final"];
const GOALS = 1.25;  // a side's goals in an even match on neutral ground
const K = 0.06;  // per point of strength: 10 points make the favourite score ~1.8x and the other ~0.55x
const HOME = 0.1;
const TRIALS = 4000;
const SPREAD = 4;  // the cup's draw: a club 4 points stronger is e (2.7) times as likely to be in it
const SCORING = { GOL: 0, ZAG: 0.15, LAT: 0.18, VOL: 0.25, MEI: 0.55, PON: 0.7, ATA: 1 };
const FALLBACK = { GOL: [], ZAG: ["VOL", "LAT"], LAT: ["ZAG", "VOL", "PON"], VOL: ["MEI", "ZAG"], MEI: ["VOL", "PON", "ATA"],
  PON: ["MEI", "ATA", "LAT"], ATA: ["PON", "MEI"] };  // who fills a slot when the club has no one of its position left
const OUTFIELD = ["ZAG", "LAT", "VOL", "MEI", "PON", "ATA"];
const FEMININE = new Set(["Chapecoense", "Ponte Preta", "Ferroviária", "Portuguesa"]);  // "a Chapecoense", "o Flamengo"
const the = (name, of) => (FEMININE.has(name) ? { pelo: "pela", do: "da", o: "a" } : { pelo: "pelo", do: "do", o: "o" })[of];

export const strength = (overall, chem) => overall + ((chem ?? 50) - 50) / 10;
const mean = (list) => list.reduce((s, x) => s + x, 0) / list.length;
const refOf = (c) => playerRef(c.slug, c.player);

// ---- the teams

function fill(cards, formation) {  // the formation's slots, each with the most-used player of its position, or a neighbour's
  const shape = formationSlots(formation), used = new Set(), slots = shape.map(() => null);
  const take = (i, roles) => {
    const found = cards.find((c) => roles.includes(c.player.pos) && !used.has(c));
    if (found) { slots[i] = found; used.add(found); }
    return !!found;
  };
  let exact = 0;
  shape.forEach((slot, i) => { exact += take(i, [slot.role]); });
  shape.forEach((slot, i) => { if (!slots[i]) take(i, FALLBACK[slot.role] || []); });
  shape.forEach((slot, i) => { if (!slots[i] && slot.role !== "GOL") take(i, OUTFIELD); });  // anyone left, but in goal
  if (!slots.every(Boolean)) return null;
  return { formation, slots, score: exact * 1e6 + slots.reduce((s, c) => s + c.player.min, 0) };
}

function lineup(cards, usual) {  // the club's usual formation; else the one with the most players in their own position
  const found = usual && /^\d(-\d)+$/.test(usual) ? fill(cards, usual) : null;
  if (found) return found;
  return FORMATIONS.map((formation) => fill(cards, formation)).filter(Boolean).sort((a, b) => b.score - a.score)[0] || null;
}

// The clubs of the given cards ({slug, player, league}), each with its eleven, the drafted players out.
export function clubsOf(cards, drafted) {
  const found = new Map();
  for (const c of cards) {
    if (c.player.clube == null || drafted.has(refOf(c))) continue;
    const key = `${c.slug}:${c.player.clube}`;
    if (!found.has(key)) found.set(key, { slug: c.slug, id: c.player.clube, name: c.player.time, escudo: c.player.escudo, league: c.league, cards: [] });
    found.get(key).cards.push(c);
  }
  const clubs = [];
  for (const { cards, ...club } of found.values()) {
    const usual = state.data[club.slug]?.clubes?.[club.id]?.formacao;
    const eleven = lineup(cards.sort((a, b) => b.player.min - a.player.min), usual);
    if (!eleven) continue;  // no goalkeeper with a card: the club can't field eleven
    const overall = mean(eleven.slots.map((c) => c.player.carta.geral));
    const chem = chemistry(eleven.slots, formationSlots(eleven.formation)).team;
    const coach = state.data[club.slug]?.clubes?.[club.id]?.tecnico?.nome || null;
    clubs.push({ ...club, formation: eleven.formation, xi: eleven.slots.map(refOf), coach, overall, chemistry: chem, strength: strength(overall, chem) });
  }
  return clubs;
}

// 15 clubs, the stronger more likely, and the drafted team ({formation, xi, captain, overall, chemistry}) in a random bracket.
export function newCup(clubs, team) {
  const average = mean(clubs.map((c) => c.strength));
  const drawn = clubs.map((c) => ({ c, key: Math.random() ** (1 / Math.exp((c.strength - average) / SPREAD)) }))
    .sort((a, b) => b.key - a.key).slice(0, 15).map(({ c }) => c);
  const teams = [...drawn, { user: true, name: "Seu time", ...team, strength: strength(team.overall, team.chemistry) }];
  for (let i = teams.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [teams[i], teams[j]] = [teams[j], teams[i]];
  }
  return { v: 2, teams, results: [], live: null, seen: 0 };
}

// ---- the matches

function poisson(lambda) {
  const limit = Math.exp(-lambda);
  let k = 0, p = Math.random();
  while (p > limit) { k += 1; p *= Math.random(); }
  return k;
}

const expected = (att, def, home) => GOALS * Math.exp(K * (att - def) + (home ? HOME : -HOME));

function scorer(team) {  // who scored for a side: by position and finishing
  const refs = team.xi.map(findRef).filter(Boolean);
  const weights = refs.map((r) => (SCORING[r.player.pos] || 0) * ((r.player.carta.atr[1] || 50) / 70) ** 3);
  let pick = Math.random() * weights.reduce((s, w) => s + w, 0);
  for (let k = 0; k < refs.length; k += 1) {
    pick -= weights[k];
    if (pick <= 0 && weights[k] > 0) return refOf(refs[k]);
  }
  return refs.length ? refOf(refs[refs.length - 1]) : null;
}

function playLeg(teams, home, away, detail) {
  const goals = [poisson(expected(teams[home].strength, teams[away].strength, true)),
    poisson(expected(teams[away].strength, teams[home].strength, false))];
  const leg = { home, away, goals };
  if (detail) {
    leg.scorers = [home, away].map((t, side) => Array.from({ length: goals[side] },
      () => ({ ref: scorer(teams[t]), minute: 1 + Math.floor(Math.random() * 90) })).sort((x, y) => x.minute - y.minute));
  }
  return leg;
}

const hosts = (teams, a, b) => (teams[a].strength <= teams[b].strength ? [a, b] : [b, a]);  // the weaker hosts the first leg

function shootout() {  // five each, then one each until one misses alone
  const kick = () => Math.random() < 0.75;
  let a = 0, b = 0;
  for (let k = 0; k < 5; k += 1) { a += kick(); b += kick(); }
  while (a === b) { a += kick(); b += kick(); }
  return [a, b];
}

const total = (legs, team) => legs.reduce((s, l) => s + (l.home === team ? l.goals[0] : l.goals[1]), 0);

function settle(a, b, legs) {
  let winner = total(legs, a) > total(legs, b) ? a : total(legs, b) > total(legs, a) ? b : null, pens = null;
  if (winner == null) {
    pens = shootout();
    winner = pens[0] > pens[1] ? a : b;
  }
  return { a, b, legs, pens, winner };
}

function playTie(teams, a, b, known = [], detail = false) {
  const [first, second] = hosts(teams, a, b), legs = [...known];
  if (legs.length < 1) legs.push(playLeg(teams, first, second, detail));
  if (legs.length < 2) legs.push(playLeg(teams, second, first, detail));
  return settle(a, b, legs);
}

// ---- the cup, round by round

export const userIndex = (cup) => cup.teams.findIndex((t) => t.user);
export const finished = (cup) => cup.results.length >= ROUNDS.length;

export function entrants(cup, round) {  // the teams of a round, in bracket order
  return round === 0 ? cup.teams.map((_, i) => i) : cup.results[round - 1].map((tie) => tie.winner);
}

function userTie(cup) {  // the drafted team's tie in the round being played, or null when it is out
  if (finished(cup)) return null;
  const teams = entrants(cup, cup.results.length), user = userIndex(cup);
  for (let k = 0; k < teams.length; k += 2) {
    if (teams[k] === user || teams[k + 1] === user) {
      const [first, second] = hosts(cup.teams, teams[k], teams[k + 1]);
      return { a: teams[k], b: teams[k + 1], first, second };
    }
  }
  return null;
}

function closeRound(cup) {  // every tie of the round, the drafted team's from the legs it played
  const teams = entrants(cup, cup.results.length), user = userIndex(cup), ties = [];
  for (let k = 0; k < teams.length; k += 2) {
    const [a, b] = [teams[k], teams[k + 1]], mine = a === user || b === user;
    ties.push(playTie(cup.teams, a, b, mine && cup.live ? cup.live.legs : [], true));
  }
  cup.results.push(ties);
  cup.live = null;
}

export function playNext(cup) {  // the drafted team's next leg; its second closes the round
  const tie = userTie(cup);
  if (!tie) return closeRound(cup);
  if (!cup.live) cup.live = { legs: [playLeg(cup.teams, tie.first, tie.second, true)] };
  else closeRound(cup);
}

export function playRest(cup) {  // the rounds left, once the drafted team is out
  while (!finished(cup)) closeRound(cup);
  cup.seen = cup.results.length;
}

// The drafted team's chance to lift the cup from where it stands, and to get through its tie (kept per step).
const odds = new WeakMap();
export function chances(cup) {
  const step = `${cup.results.length}:${cup.live ? cup.live.legs.length : 0}`, kept = odds.get(cup);
  if (kept && kept.step === step) return kept;
  const found = { step, ...simulate(cup) };
  odds.set(cup, found);
  return found;
}

function simulate(cup) {
  const user = userIndex(cup), round = cup.results.length;
  if (finished(cup)) return { title: cup.results[ROUNDS.length - 1][0].winner === user ? 1 : 0, tie: null };
  const alive = entrants(cup, round);
  if (!alive.includes(user)) return { title: 0, tie: null };
  let titles = 0, through = 0;
  for (let t = 0; t < TRIALS; t += 1) {
    let teams = alive;
    for (let r = round; r < ROUNDS.length && teams.includes(user); r += 1) {
      const next = [];
      for (let k = 0; k < teams.length; k += 2) {
        const [a, b] = [teams[k], teams[k + 1]];
        const known = r === round && cup.live && (a === user || b === user) ? cup.live.legs : [];
        next.push(playTie(cup.teams, a, b, known).winner);
      }
      if (r === round && next.includes(user)) through += 1;
      teams = next;
    }
    if (teams.length === 1 && teams[0] === user) titles += 1;
  }
  return { title: titles / TRIALS, tie: through / TRIALS };
}

// ---- the view

const mark = (cls) => {  // the drafted team plays under the brand's mark: the ring and the point that left it
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = '<circle cx="26" cy="38" r="18" style="fill: none; stroke: var(--data-dot); stroke-width: 8"/>'
    + '<circle cx="51" cy="13" r="9" style="fill: var(--accent)"/>';
  return svg;
};
const crest = (team, cls = "sc-copa__crest") => (team.user ? mark(cls) : team.escudo
  ? el("img", { class: cls, src: `escudos/${team.slug}/${team.id}.png`, alt: "" })
  : el("span", { class: `${cls} is-code`, text: team.name.slice(0, 3).toUpperCase() }));
const pct = (p) => (p >= 0.995 ? ">99%" : p > 0 && p < 0.005 ? "<1%" : `${Math.round(p * 100)}%`);
const leagueOf = (team) => (team.league || "").replace(/ \d{4}$/, "");

function scorersLine(leg, side) {  // "Pedro 23' 67' · Arrascaeta 81'"
  const found = new Map();
  for (const goal of (leg.scorers || [])[side] || []) {
    const ref = findRef(goal.ref), name = ref ? shortName(ref.player) : "?";
    found.set(name, [...(found.get(name) || []), `${goal.minute}'`]);
  }
  return [...found].map(([name, minutes]) => `${name} ${minutes.join(" ")}`).join(" · ");
}

function legBlock(cup, leg, label) {
  const home = cup.teams[leg.home], away = cup.teams[leg.away];
  const title = `${label} · ${home.user ? "seu time em casa" : `em casa ${the(home.name, "do")} ${home.name}`}`;
  if (!leg.goals) return el("div", { class: "sc-leg is-next" }, el("span", { class: "sc-subhead", text: title }), el("span", { class: "sc-leg__wait", text: "a jogar" }));  // one line
  const side = (team, goals, k) => el("div", { class: "sc-leg__side" + (team.user ? " is-user" : "") },
    el("span", { class: "sc-leg__team", text: team.name }), el("span", { class: "sc-leg__goals", text: goals }),
    el("span", { class: "sc-leg__scorers", text: scorersLine(leg, k) }));
  return el("div", { class: "sc-leg" }, el("span", { class: "sc-subhead", text: title }),
    side(home, leg.goals[0], 0), side(away, leg.goals[1], 1));
}

function teamHead(team) {
  return el("div", { class: "sc-match__team" + (team.user ? " is-user" : "") }, crest(team, "sc-match__crest"),
    el("span", { class: "sc-match__name", text: team.name, style: `--len: ${Math.max(8, team.name.length)}` }),
    el("span", { class: "sc-match__meta", text: team.user ? `força ${num(team.strength, 1)}` : `${leagueOf(team)} · força ${num(team.strength, 1)}` }),
    el("span", { class: "sc-match__meta", text: `geral ${num(team.overall, 1)} · química ${team.chemistry ?? "–"}` }),
    team.coach ? el("span", { class: "sc-match__meta", text: `técnico ${team.coach}` }) : null);
}

function lineups(cup, a, b) {
  const side = (team) => el("div", { class: "sc-lineups__side" },
    el("h3", { class: "sc-subhead", text: `${team.name} · ${team.formation}` }),
    lineupPitch(team.formation, team.xi.map(findRef), { captain: team.user ? team.captain : null, boosts: (team.user && team.boosts) || [] }));
  const user = cup.teams[a].user ? a : b;
  return el("div", { class: "ooyl-card sc-lineups" }, el("div", { class: "ooyl-card__head" }, el("div", { class: "ooyl-card__titles" },
    el("h2", { class: "ooyl-headline ooyl-headline--sm", text: "Escalações" }),
    el("p", { class: "ooyl-sub", text: "Os clubes entram com os titulares de mais minutos na temporada, na formação que melhor os encaixa, "
      + "sem os jogadores que estão no seu time." }))),
    el("div", { class: "sc-lineups__grid" }, side(cup.teams[user]), side(cup.teams[user === a ? b : a])));
}

function roundList(cup, round) {  // the other ties of a round, played
  const user = userIndex(cup);
  const ties = cup.results[round].filter((t) => t.a !== user && t.b !== user);
  if (!ties.length) return null;
  const row = (tie) => {
    const team = (k) => el("span", { class: "sc-round__team" + (tie.winner === k ? " is-winner" : "") }, crest(cup.teams[k]),
      el("span", { class: "sc-round__name", text: cup.teams[k].name }), el("b", { text: total(tie.legs, k) }));
    return el("div", { class: "sc-round__tie" }, team(tie.a), team(tie.b),
      tie.pens ? el("span", { class: "sc-copa__note", text: `pênaltis ${tie.pens[0]}–${tie.pens[1]}` }) : null);
  };
  return el("div", { class: "ooyl-card sc-round" }, el("h2", { class: "ooyl-headline ooyl-headline--sm", text: `Outros jogos: ${STAGES[round].toLowerCase()}` }),
    el("p", { class: "ooyl-sub", text: "Placar agregado da ida e da volta." }), el("div", { class: "sc-round__list" }, ties.map(row)));
}

function bracket(cup) {  // every round, with its results, in a box that opens
  const rounds = ROUNDS.map((name, r) => {
    let pairs;
    if (r < cup.results.length) pairs = cup.results[r];
    else if (r === cup.results.length) {
      const teams = entrants(cup, r);
      pairs = [];
      for (let k = 0; k < teams.length; k += 2) pairs.push({ a: teams[k], b: teams[k + 1] });
    } else pairs = Array.from({ length: 2 ** (ROUNDS.length - 1 - r) }, () => null);
    return el("div", { class: "sc-copa__round" }, el("h3", { class: "sc-subhead", text: name }),
      el("div", { class: "sc-copa__ties" }, pairs.map((tie) => {
        if (!tie) return el("div", { class: "sc-copa__tie is-empty" }, el("span", { class: "sc-copa__note", text: "a definir" }));
        const row = (k) => {
          const t = cup.teams[k], done = !!tie.legs, won = done && tie.winner === k;
          return el("div", { class: "sc-copa__row" + (won ? " is-winner" : done ? " is-out" : "") + (t.user ? " is-user" : "") },
            crest(t), el("span", { class: "sc-copa__name", text: t.name }), el("span", { class: "sc-copa__force", text: num(t.strength, 1) }),
            done ? el("span", { class: "sc-copa__total", text: total(tie.legs, k) }) : el("span"));
        };
        return el("div", { class: "sc-copa__tie" + (cup.teams[tie.a].user || cup.teams[tie.b].user ? " has-user" : "") },
          row(tie.a), row(tie.b), tie.pens ? el("span", { class: "sc-copa__note", text: `pênaltis ${tie.pens[0]}–${tie.pens[1]}` }) : null);
      })));
  });
  return el("details", { class: "ooyl-card sc-bracket" }, el("summary", { class: "sc-bracket__summary" },
    el("span", { class: "ooyl-headline ooyl-headline--sm", text: "Chaveamento" }), el("span", { class: "sc-copa__note", text: "as quatro fases" })),
  el("div", { class: "sc-copa__bracket" }, rounds));
}

function verdictOf(cup, round, tie, user) {  // the headline once the drafted team's tie is over
  const rival = tie.a === user ? tie.b : tie.a, other = cup.teams[rival].name;
  const agg = `${total(tie.legs, user)}–${total(tie.legs, rival)} no agregado`;
  const pens = tie.pens ? `, ${tie.a === user ? tie.pens[0] : tie.pens[1]}–${tie.a === user ? tie.pens[1] : tie.pens[0]} nos pênaltis` : "";
  if (tie.winner !== user) {
    const where = round === 3 ? "na final" : round === 2 ? "na semifinal" : `nas ${ROUNDS[round].toLowerCase()}`;
    return { head: `Seu time caiu ${where}`, text: `Eliminado ${the(other, "pelo")} ${other}: ${agg}${pens}.` };
  }
  if (round === 3) return { head: "Seu time é campeão da Copa", text: `Na final, ${agg} contra ${the(other, "o")} ${other}${pens}.` };
  return { head: `Seu time passou ${the(other, "pelo")} ${other}`, text: `${agg}${pens}. Agora, ${STAGES[round + 1].toLowerCase()}.` };
}

// The cup's screen: the drafted team's match of the moment (a pre-match with both line-ups, played leg by leg), its
// result, or how the cup ended. on.change(fn) runs fn on the cup, saves and redraws; on.back() returns to the draft;
// on.again() draws a new cup.
export function cupScreen(cup, on) {
  const user = userIndex(cup), luck = chances(cup), parts = [];
  const last = cup.results.length - 1;
  const lastTie = last >= 0 ? cup.results[last].find((t) => t.a === user || t.b === user) : null;
  const pending = cup.results.length > (cup.seen || 0);  // a round just closed: its result shows before moving on
  const button = (text, onclick, primary = true) => el("button", { class: `ooyl-btn ${primary ? "ooyl-btn--primary" : "ooyl-btn--ghost"}`, type: "button", text, onclick });
  const actions = (...buttons) => el("div", { class: "sc-actions sc-match__actions" }, buttons);
  const seen = (c) => { c.seen = c.results.length; };
  let stage, sub;
  if (pending && lastTie) {  // the drafted team's tie just ended
    const words = verdictOf(cup, last, lastTie, user), out = lastTie.winner !== user;
    stage = words.head;
    sub = words.text;
    const next = out ? [button("Ver o resto da Copa", () => on.change(playRest))]  // "Nova Copa" and "Voltar ao time" close the page
      : last === 3 ? [] : [button(`Avançar ${INTO[last + 1]}`, () => on.change(seen))];
    parts.push(el("div", { class: "ooyl-card sc-match" + (out ? " is-out" : " is-through") },
      el("div", { class: "sc-match__teams" }, teamHead(cup.teams[lastTie.a]), el("span", { class: "sc-match__x", text: "×" }), teamHead(cup.teams[lastTie.b])),
      el("div", { class: "sc-match__legs" }, lastTie.legs.map((leg, k) => legBlock(cup, leg, k === 0 ? "Ida" : "Volta"))),
      lastTie.pens ? el("p", { class: "sc-match__agg", text: `Pênaltis: ${cup.teams[lastTie.a].name} ${lastTie.pens[0]}–${lastTie.pens[1]} ${cup.teams[lastTie.b].name}.` }) : null,
      actions(...next)));
    parts.push(roundList(cup, last));
  } else if (finished(cup)) {  // the end: the champion
    const final = cup.results[3][0], champion = cup.teams[final.winner];
    stage = champion.user ? "Seu time é campeão da Copa" : `Campeão: ${champion.name}`;
    sub = `Final: ${cup.teams[final.a].name} ${total(final.legs, final.a)}–${total(final.legs, final.b)} ${cup.teams[final.b].name} no agregado`
      + (final.pens ? `, ${final.pens[0]}–${final.pens[1]} nos pênaltis.` : ".");
    parts.push(el("div", { class: "ooyl-card sc-match is-end" },
      el("div", { class: "sc-match__teams" }, teamHead(cup.teams[final.a]), el("span", { class: "sc-match__x", text: "×" }), teamHead(cup.teams[final.b])),
      el("div", { class: "sc-match__legs" }, final.legs.map((leg, k) => legBlock(cup, leg, k === 0 ? "Ida" : "Volta"))),
      el("p", { class: "sc-match__agg", text: "Uma nova Copa sorteia outros adversários para o mesmo time." })));
  } else {  // the pre-match of the drafted team's next leg
    const tie = userTie(cup), round = cup.results.length, rival = tie.a === user ? tie.b : tie.a;
    stage = STAGES[round];
    sub = "Ida e volta, o mais forte decide em casa. Pênaltis se o agregado empatar.";
    const played = cup.live ? cup.live.legs : [];
    const legs = [played[0] || { home: tie.first, away: tie.second }, played[1] || { home: tie.second, away: tie.first }];
    parts.push(el("div", { class: "ooyl-card sc-match" },
      el("div", { class: "sc-match__teams" }, teamHead(cup.teams[tie.a]), el("span", { class: "sc-match__x", text: "×" }), teamHead(cup.teams[tie.b])),
      // still alive, so never a flat zero: no win among the simulated cups doesn't make it impossible
      el("p", { class: "sc-match__chance", text: `Chance de o seu time passar: ${luck.tie ? pct(luck.tie) : "<1%"} · `
        + `de ser campeão: ${luck.title ? pct(luck.title) : "<1%"}` }),
      el("div", { class: "sc-match__legs" }, legs.map((leg, k) => legBlock(cup, leg, k === 0 ? "Ida" : "Volta"))),
      played.length ? el("p", { class: "sc-match__agg", text: `Depois da ida: seu time ${total(played, user)}, ${cup.teams[rival].name} ${total(played, rival)}.` }) : null,
      actions(button(played.length ? "Jogar a volta" : "Jogar a ida", () => on.change(playNext)))));
    parts.push(lineups(cup, tie.a, tie.b));
  }
  return el("section", { class: "view sc-cup" },
    el("div", { class: "sc-head" }, el("p", { class: "ooyl-kicker", text: "Copa simulada" }),
      el("h1", { class: "ooyl-headline ooyl-headline--lg", text: stage }), el("p", { class: "ooyl-sub", text: sub })),
    parts, bracket(cup),
    el("div", { class: "sc-actions" }, button("Voltar ao time", on.back, false), button("Nova Copa", on.again, false)),
    el("p", { class: "sc-note", text: `Mata-mata no formato da Copa do Brasil contra 15 clubes. É sorteio, não previsão: gols por Poisson pela força `
      + `de cada lado, com vantagem de quem joga em casa; força = geral + (química − 50) ÷ 10; chances em ${num(TRIALS, 0)} Copas simuladas.` }));
}
