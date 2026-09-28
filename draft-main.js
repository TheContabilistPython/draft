// The Draft's own page (draft.html): the scouting's data files (api/*.json), faces and crests, and the draft alone.
// Locally painel.py serves it at /draft.html; scouting/publicar.py --draft publishes it as
// outofyourleague.com.br/draft/, where a player's full numbers link to the scouting (../scouting/). Routes: #/ the
// draft, #/copa the cup of the finished draft.

import { $, el, state, getJSON } from "./comum.js";
import { draftView, copaView } from "./draft.js";

async function start() {
  try {
    state.meta = await getJSON("api/meta.json");
    state.leagues = await getJSON("api/ligas.json");
    await Promise.all(state.leagues.map(async (l) => { state.data[l.slug] = await getJSON(`api/liga/${l.slug}.json`); }));
  } catch (err) {
    $("#app").replaceChildren(el("div", { class: "empty", text: `Não consegui ler os dados (${err.message}).` }));
    return;
  }
  document.body.classList.toggle("is-local", !!state.meta.local);  // the local page says so; the published one does not
  state.playerBase = state.meta.local ? "./" : "../scouting/";
  $("#meta").textContent = [state.leagues.map((l) => l.nome).join(" + "), state.meta.local ? "uso interno" : null].filter(Boolean).join(" · ");
  addEventListener("hashchange", render);
  render();
}

function render() {  // #/copa: the cup of the finished draft; anything else: the draft
  document.body.classList.remove("sc-has-dialog");
  $("#app").replaceChildren(location.hash.replace(/^#\/?/, "") === "copa" ? copaView() : draftView());
  window.scrollTo(0, 0);
}

// The brand's two editions, as in the dashboards: with nothing saved the page follows the OS; Tema flips and remembers.
$("#theme").addEventListener("click", () => {
  const light = matchMedia("(prefers-color-scheme: light)").matches;
  const now = document.documentElement.getAttribute("data-theme") || (light ? "broadsheet" : "floodlight");
  const next = now === "floodlight" ? "broadsheet" : "floodlight";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("tema", next); } catch (_) {}
});

start();
