// Shared by every view of the scouting page: the state, the data helpers and the small pieces of UI.

export const $ = (selector, root = document) => root.querySelector(selector);

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const state = { meta: null, leagues: [], data: {}, league: null, sort: { key: "perfil", dir: -1 }, back: "#/ranking" };

export function localGet(key) { try { return localStorage.getItem("scouting-" + key); } catch (_) { return null; } }
export function localSet(key, value) { try { localStorage.setItem("scouting-" + key, value); } catch (_) {} }

export const num = (v, d = 2) => v == null ? "–"
  : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
export const euros = (v) => !v ? "–" : v >= 1e6 ? `€ ${num(v / 1e6, 1)} mi` : `€ ${Math.round(v / 1e3)} mil`;
export const rateStep = (r) => r >= 7.5 ? 5 : r >= 7 ? 4 : r >= 6.5 ? 3 : r >= 6 ? 2 : 1;  // as the dashboards
export const pctStep = (p) => p >= 80 ? 5 : p >= 60 ? 4 : p >= 40 ? 3 : p >= 20 ? 2 : 1;
export const chip = (text, step, title) => el("span", { class: `ooyl-rating ooyl-rating--${step}`, title, text });
export const ratingChip = (r) => r == null ? el("span", { class: "sc-none", text: "–" }) : chip(num(r, 1), rateStep(r));
export const pctChip = (p, title) => p == null ? el("span", { class: "sc-none", text: "–", title }) : chip(String(p), pctStep(p), title);
export const plain = (s) => (s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export const GROUPS = [
  ["Finalização", ["gols/90", "xG/90", "chutes/90", "xG/chute"]],
  ["Criação", ["xA/90", "passes-chave/90", "grandes chances criadas/90", "cruzamentos certos/90"]],
  ["Passe", ["passes certos/90", "% passe", "passes certos no campo rival/90", "bolas longas certas/90"]],
  ["Condução e drible", ["dribles certos/90", "% drible", "conduções progressivas/90", "perdas de posse/90"]],
  ["Defesa", ["desarmes + interceptações/90", "recuperações/90", "cortes/90", "aéreos ganhos/90", "% aéreo", "% duelo"]],
  ["Goleiro", ["defesas/90", "gols evitados/90", "saídas do gol/90"]],
  ["Físico", ["km/90", "sprints/90"]],
];

export const metricIndex = (name) => state.meta.metricas.findIndex((m) => m.nome === name);
export const metricShort = (name) => state.meta.metricas[metricIndex(name)]?.curto || name;
export function metricValue(player, name) {
  const v = player.m[metricIndex(name)];
  if (v == null) return "–";
  return name.startsWith("%") ? `${Math.round(v * 100)}%` : num(v, 2);
}

const initials = (name) => (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
export function face(slug, player, size = "") {
  if (player.foto) return el("img", { class: `face ${size}`, src: `faces/${slug}/${player.id}.png`, alt: "" });
  return el("span", { class: `face ${size} sc-initials`, "aria-hidden": "true", text: initials(player.nome) });
}
export function disc(slug, player) {  // the round picture on the pitch
  return player.foto ? el("img", { src: `faces/${slug}/${player.id}.png`, alt: "" }) : initials(player.nome);
}

const COUNTRIES = { Brazil: "Brasil", Uruguay: "Uruguai", Colombia: "Colômbia", Paraguay: "Paraguai", Ecuador: "Equador",
  Venezuela: "Venezuela", Peru: "Peru", Chile: "Chile", Bolivia: "Bolívia", Argentina: "Argentina", Portugal: "Portugal",
  Spain: "Espanha", Italy: "Itália", France: "França", Germany: "Alemanha", England: "Inglaterra", Netherlands: "Holanda",
  Belgium: "Bélgica", Mexico: "México", USA: "EUA", Japan: "Japão", Angola: "Angola", Nigeria: "Nigéria", Ghana: "Gana" };
export const country = (name) => COUNTRIES[name] || name;
export const roleName = (pos) => pos ? state.meta.papeis[pos].nome : "Sem posição definida";
export const playerLink = (slug, player) => `#/jogador/${slug}/${player.id}`;

export const functionsOf = (pos) => (pos && state.meta.papeis[pos].funcoes) || [];
export function functionShort(pos, name) {  // "zagueiro construtor" -> "Construtor"; "segundo atacante" stays whole
  const noun = state.meta.papeis[pos].singular;
  const text = name.startsWith(noun + " ") ? name.slice(noun.length + 1) : name;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
export function functionLabel(player) {
  if (!player.pos || !player.fn) return "–";
  if (player.fn === "equilibrado") return "Equilibrado";
  const found = functionsOf(player.pos).find((f) => f.chave === player.fn);
  return found ? functionShort(player.pos, found.nome) : "–";
}
export function functionScores(player) {  // "construtor 80 · defensivo 78", best first
  return functionsOf(player.pos).map((f, i) => [player.fs[i], functionShort(player.pos, f.nome).toLowerCase()])
    .filter(([score]) => score != null).sort((a, b) => b[0] - a[0]).map(([score, name]) => `${name} ${score}`).join(" · ");
}

function roleRanks(player) {  // [percentile, metric] of his role's metrics, best first
  const names = player.pos ? state.meta.papeis[player.pos].metricas : [];
  return names.map((n) => [player.p[metricIndex(n)], n]).filter(([p]) => p != null).sort((a, b) => b[0] - a[0]);
}
export function highlights(player, count = 3) {
  return roleRanks(player).slice(0, count).map(([p, n]) => `${metricShort(n)} ${p}`).join(" · ");
}
export function weakest(player) {
  const ranks = roleRanks(player);
  return ranks.length ? `${metricShort(ranks[ranks.length - 1][1])} ${ranks[ranks.length - 1][0]}` : "–";
}

export async function getJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

export function bars(player, names) {
  return el("div", { class: "sc-bars" }, names.map((name) => {
    const p = player.p[metricIndex(name)];
    return el("div", { class: "sc-bar", title: name },
      el("span", { class: "sc-bar__label", text: metricShort(name) }),
      el("span", { class: "sc-bar__value", text: metricValue(player, name) }),
      el("span", { class: "sc-bar__track" }, el("span", { class: `sc-bar__fill sc-step-${pctStep(p ?? 0)}`, style: `width: ${p ?? 0}%` })),
      el("span", { class: "sc-bar__pct", text: p ?? "–" }));
  }));
}

export const card = (title, sub, ...body) => el("div", { class: "ooyl-card" },
  el("div", { class: "ooyl-card__head" }, el("div", { class: "ooyl-card__titles" },
    el("h2", { class: "ooyl-headline ooyl-headline--sm", text: title }), sub ? el("p", { class: "ooyl-sub", text: sub }) : null)),
  body);

export const pageHead = (title, sub) => el("div", { class: "sc-head" },
  el("h1", { class: "ooyl-headline ooyl-headline--lg", text: title }), el("p", { class: "ooyl-sub", text: sub }));

// "serie-a-2026:12345": a player anywhere in the loaded leagues.
export const playerRef = (slug, player) => `${slug}:${player.id}`;
export function findRef(text) {
  if (!text) return null;
  const [slug, id] = String(text).split(":");
  const data = state.data[slug], player = data && data.jogadores.find((p) => p.id === Number(id));
  return player ? { slug, player, league: data.nome } : null;
}

// A search across every loaded league, by player or team, the best profiles first. With `like` and an
// empty box it lists the best players of that player's position instead.
export function playerSearch(placeholder, onPick, like = null, keep = () => true) {
  const results = el("div", { class: "sc-list sc-results" });
  const input = el("input", { class: "sc-search", type: "search", placeholder, "aria-label": placeholder, oninput: () => draw() });
  function draw() {
    const text = plain(input.value.trim()), found = [];
    for (const [slug, data] of Object.entries(state.data)) {
      for (const p of data.jogadores) {
        if (!keep(slug, p) || (like && p.id === like.id)) continue;
        const hit = text.length >= 2 ? plain(p.nome).includes(text) || plain(p.time).includes(text)
          : like && p.pos === like.pos && p.perfil != null;
        if (hit) found.push({ slug, p, league: data.nome });
      }
    }
    found.sort((a, b) => (b.p.perfil ?? -1) - (a.p.perfil ?? -1) || b.p.min - a.p.min);
    results.replaceChildren(...found.slice(0, 8).map(({ slug, p, league }) => el("div", {
      class: "sc-row", tabindex: "0", role: "button", onclick: () => onPick(slug, p),
      onkeydown: (ev) => { if (ev.key === "Enter") onPick(slug, p); } },
      face(slug, p, "lg"),
      el("div", { class: "sc-who" }, el("div", {}, el("strong", { class: "sc-name", text: p.nome }),
        el("small", { text: [p.time, league, p.pos ? roleName(p.pos).toLowerCase() : null, p.fn ? functionLabel(p).toLowerCase() : null,
          p.idade != null ? `${p.idade} anos` : null].filter(Boolean).join(" · ") }))),
      el("span", { class: "sc-meta", text: euros(p.valor) }), pctChip(p.perfil, "Perfil"))));
    if (!found.length && text.length >= 2) results.replaceChildren(el("p", { class: "sc-note", text: "Nenhum jogador encontrado." }));
  }
  draw();
  return el("div", { class: "sc-picker" }, input, results);
}
