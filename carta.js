// A player's card, as the Draft prints it (numbers from draft.py), and a read-only eleven of cards on a pitch: the
// draws and the pitch of the draft (draft.js) and the line-ups before each match of the cup (copa.js).

import { el, state, country } from "./comum.js";
import { formationSlots } from "./selecao.js";

const initials = (name) => (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

// SofaScore's short name ("L. Acosta"), unless the full one is shorter ("David", not "D. M. d. S. Arcanjo")
export const shortName = (p) => [p.curto, p.nome].filter(Boolean).sort((x, y) => x.length - y.length)[0] || "?";

export function crest(slug, p, cls) {  // the club's crest of a player, or its first letters on a plate
  return p.escudo ? el("img", { class: cls, src: `escudos/${slug}/${p.clube}.png`, alt: p.time, title: p.time })
    : el("span", { class: `${cls} is-code`, text: (p.time || "?").slice(0, 3).toUpperCase(), title: p.time });
}

// The card: overall, position, crest and nationality down the side, the photo, the name and six attributes. A card
// narrower than 100px on a pitch (phones, the line-ups side by side) keeps overall, position, photo and name.
// `boost`: points the Draft's coach adds to the overall of the players of his club, shown beside it.
export function playerCard(ref, { captain = false, boost = 0 } = {}) {
  const p = ref.player, c = p.carta, keeper = p.pos === "GOL";
  const labels = keeper ? state.meta.carta.goleiro : state.meta.carta.linha;
  const name = shortName(p);
  return el("div", {
    class: `sc-carta is-${c.nivel}`, role: "img",
    "aria-label": `${p.nome}, ${p.pos}, geral ${c.geral + boost}${boost ? ` (${c.geral} e mais ${boost} do técnico)` : ""}, carta ${c.nivel}. `
      + labels.map((l, k) => `${state.meta.carta.nomes[l]} ${c.atr[k]}`).join(", "),
  }, el("div", { class: "sc-carta__in" },  // the card is the size container: everything inside is sized in cqw
    el("div", { class: "sc-carta__top" },
      el("div", { class: "sc-carta__side" },
        el("span", { class: "sc-carta__ovr", text: c.geral + boost }),
        el("span", { class: "sc-carta__pos", text: p.pos }),
        boost ? el("span", { class: "sc-carta__boost", title: `+${boost} do técnico`, text: `+${boost}` }) : null,
        crest(ref.slug, p, "sc-carta__crest"),
        el("span", { class: "sc-carta__nation", text: p.pais3 || "–", title: country(p.pais) })),
      el("div", { class: "sc-carta__photo" }, p.foto ? el("img", { src: `faces/${ref.slug}/${p.id}.png`, alt: "" })
        : el("span", { class: "sc-carta__initials", text: initials(p.nome) })),
      captain ? el("span", { class: "sc-carta__captain", text: "C", title: "Capitão" }) : null),
    el("div", { class: "sc-carta__name", text: name, style: `--len: ${Math.max(9, name.length)}` }),
    el("div", { class: "sc-carta__attrs" }, labels.map((label, k) => el("span", { class: "sc-carta__attr", title: state.meta.carta.nomes[label] },
      el("b", { text: c.atr[k] }), el("i", { text: label }))))));
}

// An eleven on a pitch, attack on top, one card per slot of the formation (refs: {slug, player, league}, in slot order;
// boosts: the coach's points per slot).
export function lineupPitch(formation, refs, { captain = null, boosts = [] } = {}) {
  const shape = formationSlots(formation);
  const lines = [...new Set(shape.map((s) => s.line))].sort((a, b) => b - a);
  const widest = Math.max(...lines.map((line) => shape.filter((s) => s.line === line).length));
  return el("div", { class: "sc-draft-field" }, el("div", { class: "ooyl-pitch sc-draft-pitch sc-lineup", style: `--cols: ${widest}` },
    el("div", { class: "ooyl-pitch__turf", "aria-hidden": "true" },
      el("i", { class: "c" }), el("i", { class: "box top" }), el("i", { class: "six top" }),
      el("i", { class: "box bottom" }), el("i", { class: "six bottom" })),
    lines.map((line) => el("div", { class: "ooyl-pitch__row" }, shape.map((slot, i) => [slot, i]).filter(([slot]) => slot.line === line)
      .map(([, i]) => el("div", { class: "sc-draft-slot is-static", title: refs[i] ? `${refs[i].player.nome} · ${refs[i].player.time}` : null },
        refs[i] ? playerCard(refs[i], { captain: captain === i, boost: boosts[i] || 0 }) : null))))));
}
