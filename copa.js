// Copa: a knockout cup to close a draft, in the Copa do Brasil's format: from the round of 16, two legs, penalties
// on a level aggregate, the stronger side at home in the second leg. The drafted eleven meets 15 clubs of the draft's
// leagues, drawn with the stronger ones more likely.
//
// Strength = overall + (chemistry - 50) / 10, so chemistry is worth up to five points either way. A club plays its
// eleven with the most minutes, without the players on the drafted team, and with CLUB_CHEMISTRY: they play together.
// Goals are Poisson: an even match gives the home side GOALS * e^HOME and the visitors GOALS * e^-HOME, and each point
// of strength between the sides moves both by K. Chances come from TRIALS simulated cups. It is a draw of lots, not a
// forecast.

import { el, num, playerRef } from "./comum.js";

export const ROUNDS = ["Oitavas", "Quartas", "Semifinal", "Final"];
const GOALS = 1.25;  // a side's goals in an even match on neutral ground
const K = 0.06;  // per point of strength: 10 points make the favourite score ~1.8x and the other ~0.55x
const HOME = 0.1;
const CLUB_CHEMISTRY = 80;
const TRIALS = 4000;
const SPREAD = 4;  // the cup's draw: a club 4 points stronger is e (2.7) times as likely to be in it

export const strength = (overall, chemistry) => overall + ((chemistry ?? 50) - 50) / 10;
const mean = (list) => list.reduce((s, x) => s + x, 0) / list.length;
const FEMININE = new Set(["Chapecoense", "Ponte Preta", "Ferroviária", "Portuguesa"]);  // "a Chapecoense", "o Flamengo"
const the = (name, of) => (FEMININE.has(name) ? { pelo: "pela", do: "da", o: "a" } : { pelo: "pelo", do: "do", o: "o" })[of];

// ---- the teams

// The clubs of the given cards (slug, player, league), each with its eleven of most minutes, the drafted players out.
export function clubsOf(cards, drafted) {
  const found = new Map();
  for (const c of cards) {
    if (c.player.clube == null || drafted.has(playerRef(c.slug, c.player))) continue;
    const key = `${c.slug}:${c.player.clube}`;
    if (!found.has(key)) found.set(key, { slug: c.slug, id: c.player.clube, name: c.player.time, escudo: c.player.escudo, league: c.league, players: [] });
    found.get(key).players.push(c.player);
  }
  return [...found.values()].map(({ players, ...club }) => {
    const eleven = players.sort((a, b) => b.min - a.min).slice(0, 11);
    const overall = mean(eleven.map((p) => p.carta.geral));
    return { ...club, size: eleven.length, overall, strength: strength(overall, CLUB_CHEMISTRY) };
  }).filter((club) => club.size >= 8);  // a club with fewer regulars leaves the draw
}

// 15 clubs and the drafted team in a random bracket.
export function newCup(clubs, team) {
  const average = mean(clubs.map((c) => c.strength));
  const drawn = clubs.map((c) => ({ c, key: Math.random() ** (1 / Math.exp((c.strength - average) / SPREAD)) }))
    .sort((a, b) => b.key - a.key).slice(0, 15).map(({ c }) => c);
  const teams = [...drawn, { user: true, name: "Seu time", overall: team.overall, chemistry: team.chemistry, strength: strength(team.overall, team.chemistry) }];
  for (let i = teams.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [teams[i], teams[j]] = [teams[j], teams[i]];
  }
  return { teams, results: [] };
}

// ---- the matches

function poisson(lambda) {
  const limit = Math.exp(-lambda);
  let k = 0, p = Math.random();
  while (p > limit) { k += 1; p *= Math.random(); }
  return k;
}

const expected = (att, def, home) => GOALS * Math.exp(K * (att - def) + (home ? HOME : -HOME));

function shootout() {  // five each, then one each until one misses alone
  const kick = () => Math.random() < 0.75;
  let a = 0, b = 0;
  for (let k = 0; k < 5; k += 1) { a += kick(); b += kick(); }
  while (a === b) { a += kick(); b += kick(); }
  return [a, b];
}

// A tie between teams a and b (indices): the weaker hosts the first leg. Each leg is {home, away, goals: [h, a]}.
function playTie(teams, a, b) {
  const [first, second] = teams[a].strength <= teams[b].strength ? [a, b] : [b, a];
  const leg = (home, away) => ({ home, away, goals: [poisson(expected(teams[home].strength, teams[away].strength, true)),
    poisson(expected(teams[away].strength, teams[home].strength, false))] });
  const legs = [leg(first, second), leg(second, first)];
  const total = (t) => legs.reduce((s, l) => s + (l.home === t ? l.goals[0] : l.goals[1]), 0);
  let winner = total(a) > total(b) ? a : total(b) > total(a) ? b : null, pens = null;
  if (winner == null) {
    pens = shootout();
    winner = pens[0] > pens[1] ? a : b;
  }
  return { a, b, legs, pens, winner };
}

export function entrants(cup, round) {  // the teams of a round, in bracket order
  return round === 0 ? cup.teams.map((_, i) => i) : cup.results[round - 1].map((tie) => tie.winner);
}

export function playRound(cup) {
  const round = cup.results.length, teams = entrants(cup, round), ties = [];
  for (let k = 0; k < teams.length; k += 2) ties.push(playTie(cup.teams, teams[k], teams[k + 1]));
  cup.results.push(ties);
}

// The drafted team's chance to lift the cup from where it stands, and to get through its next tie (kept per round).
const odds = new WeakMap();
export function chances(cup) {
  const kept = odds.get(cup);
  if (kept && kept.round === cup.results.length) return kept;
  const found = simulate(cup);
  odds.set(cup, { round: cup.results.length, ...found });
  return found;
}

function simulate(cup) {
  const user = cup.teams.findIndex((t) => t.user), round = cup.results.length;
  const alive = entrants(cup, round);
  if (round >= ROUNDS.length) return { title: cup.results[ROUNDS.length - 1][0].winner === user ? 1 : 0, tie: null };
  if (!alive.includes(user)) return { title: 0, tie: null };
  let titles = 0, through = 0;
  for (let t = 0; t < TRIALS; t += 1) {
    let teams = alive;
    for (let r = round; r < ROUNDS.length && teams.includes(user); r += 1) {
      const next = [];
      for (let k = 0; k < teams.length; k += 2) next.push(playTie(cup.teams, teams[k], teams[k + 1]).winner);
      if (r === round && next.includes(user)) through += 1;
      teams = next;
    }
    if (teams.length === 1 && teams[0] === user) titles += 1;
  }
  return { title: titles / TRIALS, tie: through / TRIALS };
}

// ---- the view

const mark = () => {  // the drafted team plays under the brand's mark: the ring and the point that left it
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.setAttribute("class", "sc-copa__crest");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = '<circle cx="26" cy="38" r="18" style="fill: none; stroke: var(--data-dot); stroke-width: 8"/>'
    + '<circle cx="51" cy="13" r="9" style="fill: var(--accent)"/>';
  return svg;
};
const crest = (team) => (team.user ? mark() : team.escudo
  ? el("img", { class: "sc-copa__crest", src: `escudos/${team.slug}/${team.id}.png`, alt: "" })
  : el("span", { class: "sc-copa__crest is-code", text: team.name.slice(0, 3).toUpperCase() }));
const pct = (p) => (p >= 0.995 ? ">99%" : p > 0 && p < 0.005 ? "<1%" : `${Math.round(p * 100)}%`);
const scoreFor = (tie, team) => tie.legs.map((leg) => (leg.home === team ? leg.goals[0] : leg.goals[1]));

function tieBox(cup, tie, chance) {
  const row = (team) => {
    const t = cup.teams[team], goals = tie.legs ? scoreFor(tie, team) : null, won = tie.winner === team, lost = tie.winner != null && !won;
    return el("div", { class: "sc-copa__row" + (won ? " is-winner" : "") + (lost ? " is-out" : "") + (t.user ? " is-user" : "") },
      crest(t),
      el("span", { class: "sc-copa__name", text: t.name, title: t.user ? "Seu time" : `${t.name} · ${t.league.replace(/ \d{4}$/, "")}` }),
      el("span", { class: "sc-copa__force", text: num(t.strength, 1), title: "força: geral + (química − 50) ÷ 10" }),
      goals ? [el("span", { class: "sc-copa__leg", text: goals[0] }), el("span", { class: "sc-copa__leg", text: goals[1] }),
        el("span", { class: "sc-copa__total", text: goals[0] + goals[1] })] : el("span", { class: "sc-copa__wait" }));
  };
  return el("div", { class: "sc-copa__tie" + (cup.teams[tie.a]?.user || cup.teams[tie.b]?.user ? " has-user" : "") },
    row(tie.a), row(tie.b),
    tie.pens ? el("span", { class: "sc-copa__note", text: `pênaltis ${tie.pens[0]}–${tie.pens[1]}` }) : null,
    chance != null ? el("span", { class: "sc-copa__note is-chance", text: `chance de o seu time passar: ${pct(chance)}` }) : null);
}

function bracket(cup, next) {
  return el("div", { class: "sc-copa__bracket" }, ROUNDS.map((name, r) => {
    let ties;
    if (r < cup.results.length) ties = cup.results[r];
    else if (r === cup.results.length) {
      const teams = entrants(cup, r);
      ties = [];
      for (let k = 0; k < teams.length; k += 2) ties.push({ a: teams[k], b: teams[k + 1] });
    } else ties = Array.from({ length: 2 ** (ROUNDS.length - 1 - r) }, () => null);
    return el("div", { class: "sc-copa__round" }, el("h3", { class: "sc-subhead", text: name }),
      el("div", { class: "sc-copa__ties" }, ties.map((tie) => (tie ? tieBox(cup, tie, r === cup.results.length && next != null
        && (cup.teams[tie.a].user || cup.teams[tie.b].user) ? next : null) : el("div", { class: "sc-copa__tie is-empty" },
        el("span", { class: "sc-copa__note", text: "a definir" }))))));
  }));
}

function lastTie(cup) {  // the drafted team's latest tie played, with its round
  const user = cup.teams.findIndex((t) => t.user);
  for (let round = cup.results.length - 1; round >= 0; round -= 1) {
    const tie = cup.results[round].find((t) => t.a === user || t.b === user);
    if (tie) return { round, tie, user };
  }
  return null;
}

function story(cup) {  // what happened to the drafted team in its latest tie
  const last = lastTie(cup);
  if (!last) return null;
  const { round, tie, user } = last;
  const other = cup.teams[tie.a === user ? tie.b : tie.a].name;
  const legs = tie.legs.map((leg) => `${leg.home === user ? leg.goals[0] : leg.goals[1]}–${leg.home === user ? leg.goals[1] : leg.goals[0]} ${leg.home === user ? "em casa" : "fora"}`).join(" e ");
  const pens = tie.pens ? `, e nos pênaltis ${tie.a === user ? tie.pens[0] : tie.pens[1]}–${tie.a === user ? tie.pens[1] : tie.pens[0]}` : "";
  const stage = round === ROUNDS.length - 1 ? "na final" : round === 2 ? "na semifinal" : `nas ${ROUNDS[round].toLowerCase()}`;
  if (tie.winner !== user) return `Seu time caiu ${stage} diante ${the(other, "do")} ${other}: ${legs}${pens}.`;
  if (round === ROUNDS.length - 1) return `Seu time é campeão da Copa: ${legs} contra ${the(other, "o")} ${other} na final${pens}.`;
  return `Seu time passou ${the(other, "pelo")} ${other} ${stage}: ${legs}${pens}.`;
}

function outcome(cup) {  // how far the drafted team went, once the cup is over: [tile value, words]
  const last = lastTie(cup);
  if (last.tie.winner === last.user) return ["Campeão", "levantou a taça"];
  if (last.round === ROUNDS.length - 1) return ["Vice", "caiu na final"];
  return [ROUNDS[last.round], `caiu ${last.round === 2 ? "na semifinal" : `nas ${ROUNDS[last.round].toLowerCase()}`}`];
}

// The cup's card. `onPlay(all)` plays the next round (or every round left), `onNew()` draws a new cup.
export function cupCard(cup, { onPlay, onNew }) {
  const round = cup.results.length, done = round >= ROUNDS.length, luck = chances(cup);
  const user = cup.teams.find((t) => t.user), champion = done ? cup.teams[cup.results[ROUNDS.length - 1][0].winner] : null;
  const label = ["Jogar as oitavas", "Jogar as quartas", "Jogar a semifinal", "Jogar a final"][round];
  const leagues = new Map();  // "12 da Série A e 3 da Série B"
  for (const t of cup.teams) if (!t.user) { const name = t.league.replace(/ \d{4}$/, ""); leagues.set(name, (leagues.get(name) || 0) + 1); }
  const from = [...leagues].sort((a, b) => b[1] - a[1]).map(([name, n]) => `${n} da ${name}`).join(" e ");
  return el("div", { class: "ooyl-card sc-copa" },
    el("div", { class: "ooyl-card__head" }, el("div", { class: "ooyl-card__titles" },
      el("p", { class: "ooyl-kicker", text: "Simulação" }),
      el("h2", { class: "ooyl-headline", text: done ? `Campeão: ${champion.name}` : "Copa simulada" }),
      el("p", { class: "ooyl-sub", text: "Mata-mata no formato da Copa do Brasil: das oitavas à final, ida e volta, pênaltis se o agregado "
        + `empatar, o mais forte decide em casa. Seu time contra 15 clubes (${from}), `
        + "cada um com o onze que mais jogou, sem os jogadores que estão no seu time. É sorteio: cada simulação dá outro resultado." })),
      el("div", { class: "ooyl-card__actions" },
        done ? el("button", { class: "ooyl-btn ooyl-btn--primary ooyl-btn--sm", type: "button", text: "Nova Copa", onclick: onNew })
          : [el("button", { class: "ooyl-btn ooyl-btn--primary ooyl-btn--sm", type: "button", text: label, onclick: () => onPlay(false) }),
            el("button", { class: "ooyl-btn ooyl-btn--ghost ooyl-btn--sm", type: "button", text: "Jogar tudo", onclick: () => onPlay(true) })])),
    el("div", { class: "ooyl-tiles sc-copa__tiles" },
      el("div", { class: "ooyl-tile" }, el("span", { class: "ooyl-tile__label", text: "Força do seu time" }),
        el("span", { class: "ooyl-tile__value", text: num(user.strength, 1) }),
        el("span", { class: "ooyl-tile__note", text: `geral ${Math.round(user.overall)}, química ${user.chemistry ?? "–"}` })),
      el("div", { class: "ooyl-tile" }, el("span", { class: "ooyl-tile__label", text: done ? "Resultado" : "Chance de título" }),
        el("span", { class: "ooyl-tile__value", text: done ? outcome(cup)[0] : pct(luck.title) }),
        el("span", { class: "ooyl-tile__note", text: done ? (champion.user ? outcome(cup)[1] : `${outcome(cup)[1]} · campeão: ${champion.name}`)
          : luck.title === 0 ? "seu time já caiu" : `em ${num(TRIALS, 0)} Copas simuladas` }))),
    story(cup) ? el("p", { class: "sc-copa__story", text: story(cup) }) : null,
    bracket(cup, done ? null : luck.tie),
    el("p", { class: "sc-note", text: "Força = geral + (química − 50) ÷ 10. Os clubes jogam juntos, então entram com química "
      + `${CLUB_CHEMISTRY}. Números de cada confronto: ida, volta e total.` }));
}
