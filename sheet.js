/* sheet.js — the official-style score sheet.
 *
 * Sheet.model() turns a match state into the paper sheet's layout (header
 * fields, the two team boxes, the rally grid, notes); Sheet.render() draws it
 * into the report screen and report.js draws the same model into a PDF.
 */
"use strict";

const Sheet = (() => {
  const MIN_COLS = 45;   // rally columns on a blank sheet
  const BLOCKS = 5;      // game blocks printed on the sheet

  const byId = (id) => document.getElementById(id);

  function fmtClock(ts, L) {
    return ts ? new Date(ts).toLocaleTimeString(L, { hour: "2-digit", minute: "2-digit" }) : "";
  }
  function fmtDate(ts, L) {
    return new Date(ts || Date.now()).toLocaleDateString(L, {
      weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
    });
  }
  function fmtDuration(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const pad = (v) => String(v).padStart(2, "0");
    const h = Math.floor(s / 3600);
    return h ? `${h}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
             : `${Math.floor(s / 60)}:${pad(s % 60)}`;
  }

  /* ---------- the sheet as data ---------- */
  function model(state, lang) {
    const L = lang || state.config.lang || "en";
    const cfg = state.config;
    const doubles = cfg.mode === "doubles";
    const R = Match.rules(state);
    const games = Match.timeline(state);
    const perSide = doubles ? 2 : 1;
    const cols = Math.max(MIN_COLS, ...games.map((g) => g.rallies.length + 1));

    const clubOf = (side, p) => {
      const c = cfg.teams?.[side];
      return (Array.isArray(c) ? c[p] : c) || "";
    };
    // the two header boxes: players, club(s) and the end each side started at
    const sides = [0, 1].map((side) => {
      const names = doubles ? cfg.names[side].slice() : [cfg.names[side]];
      const clubs = names.map((_, p) => clubOf(side, p)).filter(Boolean);
      const club = clubs.length && clubs.every((c) => c === clubs[0])
        ? clubs[0] : clubs.join(" / ");
      return { names, club, end: cfg.leftPlayer === side ? "L" : "R" };
    });

    // grid rows: side 0's players, then side 1's (shaded, as on paper)
    const labels = [];
    for (const side of [0, 1]) {
      for (let p = 0; p < perSide; p++) {
        labels.push({ label: doubles ? cfg.names[side][p] : cfg.names[side], shaded: side === 1 });
      }
    }
    const rowOf = (side, p) => side * perSide + (doubles ? p : 0);
    const blankRows = () =>
      labels.map((r) => ({ ...r, mark: "", cells: new Array(cols).fill(""), note: null }));

    // one block per game: the serve/receive marks, the starting 0s and every
    // rally written in the row of the player who served next
    const blocks = games.map((g) => {
      const rows = blankRows();
      const s = rowOf(g.server, g.serverPlayer);
      const r = rowOf(1 - g.server, g.receiverPlayer);
      rows[s].mark = "S"; rows[s].cells[0] = "0";
      rows[r].mark = "R"; rows[r].cells[0] = "0";
      g.rallies.forEach((rally, i) => {
        rows[rowOf(rally.winner, rally.player)].cells[i + 1] = String(rally.value);
      });
      return { rows, final: g.score.slice() };
    });
    while (blocks.length < BLOCKS) blocks.push({ rows: blankRows(), final: null });

    // the umpire's notes fill the rows of the block after the last game
    const notes = (state.notes || []).slice();
    let bi = games.length;
    while (notes.length) {
      if (bi >= blocks.length) blocks.push({ rows: blankRows(), final: null });
      for (const row of blocks[bi].rows) {
        if (!notes.length) break;
        row.note = notes.shift();
      }
      bi += 1;
    }

    const scores = [];
    for (let i = 0; i < R.bestOf; i++) scores.push(state.games[i] ? state.games[i].slice() : null);

    return {
      L, doubles, cols, perSide, sides, blocks, scores,
      winner: state.winner,
      rules: R,
      header: {
        date: fmtDate(state.matchStartedAt, L),
        court: cfg.court || "",
        begin: fmtClock(state.matchStartedAt, L),
        end: fmtClock(state.matchEndedAt, L),
        duration: state.matchStartedAt
          ? fmtDuration((state.matchEndedAt || Date.now()) - state.matchStartedAt) : "",
        shuttles: String(state.shuttles || 1),
      },
    };
  }

  /* ---------- the sheet as DOM ---------- */
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const S = (L, k) => t(L, "sheet." + k);

  function teamBox(m, side) {
    // wrapper carries the winner's circle (an ::after ellipse over the box)
    const wrap = el("div", "sh-teamwrap" + (m.winner === side ? " winner" : ""));
    const box = el("table", "sh-team" + (side === 1 ? " shaded" : ""));
    const body = el("tbody");
    const s = m.sides[side];
    // first row carries the end marker (R / L) on the outer edge
    const r1 = el("tr");
    const mark = el("td", "sh-end", s.end);
    const n1 = el("td", "sh-name", s.names[0] || "");
    if (side === 0) { r1.append(mark, n1); } else { r1.append(n1, mark); }
    body.append(r1);
    for (const text of [s.names[1] || "", s.club]) {
      const tr = el("tr");
      const td = el("td", text === s.club ? "sh-club" : "sh-name", text);
      td.colSpan = 2;
      tr.append(td);
      body.append(tr);
    }
    box.append(body);
    wrap.append(box);
    return wrap;
  }

  function scoreBox(m) {
    const wrap = el("div", "sh-scorecol");
    wrap.append(el("div", "sh-scoretitle", S(m.L, "score")));
    const table = el("table", "sh-score");
    const body = el("tbody");
    for (const g of m.scores) {
      const tr = el("tr");
      tr.append(el("td", null, g ? `${g[0]}  :  ${g[1]}` : ":"));
      body.append(tr);
    }
    table.append(body);
    wrap.append(table);
    const sh = el("div", "sh-shuttles");
    sh.append(el("span", "lb", S(m.L, "shuttles") + ":"), el("b", null, m.header.shuttles));
    wrap.append(sh);
    return wrap;
  }

  function fieldRows(m) {
    const wrap = el("div", "sh-right");
    const rows = [
      ["court", m.header.court],
      ["umpire", ""],
      ["serviceJudge", ""],
      ["begin", m.header.begin],
      ["end", m.header.end],
      ["duration", m.header.duration],
    ];
    for (const [key, value] of rows) {
      const row = el("div", "sh-f");
      row.append(el("span", "lb", S(m.L, key) + ":"));
      const line = el("span", "ln");
      line.append(el("span", "vl", value));
      row.append(line);
      wrap.append(row);
    }
    return wrap;
  }

  function blockTable(m, block) {
    const table = el("table", "sh-block");
    const body = el("tbody");
    block.rows.forEach((row, i) => {
      const tr = el("tr", row.shaded ? "shaded" : null);
      tr.append(el("td", "nm", row.label), el("td", "mk", row.mark));
      if (row.note != null) {
        const td = el("td", "note", row.note);
        td.colSpan = m.cols;
        tr.append(td);
      } else {
        for (const value of row.cells) tr.append(el("td", "c", value));
      }
      if (i === 0) {
        const fin = el("td", "fin" + (block.final ? " circled" : ""));
        fin.rowSpan = block.rows.length;
        if (block.final) {
          fin.append(el("span", "fa", String(block.final[0])),
                     el("span", "fb", String(block.final[1])));
        }
        tr.append(fin);
      }
      body.append(tr);
    });
    table.append(body);
    return table;
  }

  /* Draw the whole sheet into #sheet-doc. */
  function render(state, lang) {
    const m = model(state, lang);
    const doc = byId("sheet-doc");
    doc.textContent = "";

    const head = el("div", "sh-head");
    const left = el("div", "sh-left");
    for (const [key, value] of [["match", ""], ["date", m.header.date]]) {
      const row = el("div", "sh-f");
      row.append(el("span", "lb", S(m.L, key) + ":"));
      row.append(key === "date" ? el("span", "vl", value) : el("span", "ln"));
      left.append(row);
    }
    const boxes = el("div", "sh-boxes");
    boxes.append(teamBox(m, 0), scoreBox(m), teamBox(m, 1));
    head.append(left, boxes, fieldRows(m));
    doc.append(head);

    const grid = el("div", "sh-grid");
    for (const block of m.blocks) grid.append(blockTable(m, block));
    doc.append(grid);

    const sign = el("div", "sh-sign");
    for (const key of ["umpire", "referee"]) {
      const row = el("div", "sh-f");
      row.append(el("span", "lb", S(m.L, key) + ":"), el("span", "ln"));
      sign.append(row);
    }
    doc.append(sign);
    return m;
  }

  return { model, render, MIN_COLS, BLOCKS };
})();
