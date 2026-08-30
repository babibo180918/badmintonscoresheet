/* report.js — the score sheet as a PDF.
 *
 * The PDF is written by hand (PDF 1.4, one A4 landscape page, base-14
 * Helvetica) so the app keeps working offline with no dependencies. It draws
 * the same layout as the report screen, from the same Sheet.model().
 *
 * Text is encoded as WinAnsi (Latin-1), which covers the Danish alphabet;
 * anything outside it is written as "?".
 */
"use strict";

const Report = (() => {
  const PAGE = { w: 841.89, h: 595.28 };  // A4 landscape, points
  const M = 22;                            // page margin
  const BLACK = [0, 0, 0];
  const GREY = [0.35, 0.35, 0.35];
  const GRID = [0.72, 0.72, 0.72];
  const SHADE = [0.9, 0.9, 0.9];

  /* Helvetica advance widths (1/1000 em) for char codes 32..126 — enough to
   * centre text and shrink it to fit without embedding font metrics. */
  const W_REG = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
  ];
  const W_BOLD = [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
    611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
  ];

  const charW = (code, bold) =>
    (code >= 32 && code <= 126 ? (bold ? W_BOLD : W_REG)[code - 32] : 556);

  function width(str, size, bold) {
    let w = 0;
    for (const ch of String(str)) w += charW(ch.codePointAt(0), bold);
    return (w * size) / 1000;
  }
  /* Largest size <= `size` at which `str` fits in `maxW`. */
  function fitSize(str, maxW, size, bold) {
    let s = size;
    while (s > 4 && width(str, s, bold) > maxW) s -= 0.25;
    return s;
  }
  /* WinAnsi bytes + PDF string escaping (one JS char = one byte). */
  function pdfStr(str) {
    let out = "";
    for (const ch of String(str)) {
      const code = ch.codePointAt(0);
      const s = String.fromCharCode(code <= 0xff ? code : 0x3f);
      out += "()\\".includes(s) ? "\\" + s : s;
    }
    return out;
  }

  /* Drawing surface. All y coordinates are measured DOWN from the page top
   * (text y = its baseline); the helpers flip them into PDF space. */
  function canvas() {
    const ops = [];
    const n = (v) => String(Math.round(v * 100) / 100);
    const col = (c, op) => `${n(c[0])} ${n(c[1])} ${n(c[2])} ${op}`;
    return {
      text(str, x, y, o = {}) {
        if (str === "" || str == null) return;
        const size = o.size ?? 8;
        const bold = !!o.bold;
        let px = x;
        if (o.align === "center") px -= width(str, size, bold) / 2;
        else if (o.align === "right") px -= width(str, size, bold);
        ops.push(
          `BT ${col(o.color || BLACK, "rg")} /${bold ? "F2" : "F1"} ${n(size)} Tf ` +
          `1 0 0 1 ${n(px)} ${n(PAGE.h - y)} Tm (${pdfStr(str)}) Tj ET`
        );
      },
      line(x1, y1, x2, y2, o = {}) {
        const dash = o.dash ? "[1 2] 0 d " : "";
        ops.push(
          `${dash}${n(o.width ?? 1)} w ${col(o.color || BLACK, "RG")} ` +
          `${n(x1)} ${n(PAGE.h - y1)} m ${n(x2)} ${n(PAGE.h - y2)} l S` +
          (o.dash ? "\n[] 0 d" : "")
        );
      },
      rect(x, y, w, h, o = {}) {
        ops.push(
          `${n(o.width ?? 1)} w ${col(o.color || BLACK, "RG")} ` +
          `${n(x)} ${n(PAGE.h - y - h)} ${n(w)} ${n(h)} re S`
        );
      },
      fill(x, y, w, h, color) {
        ops.push(`${col(color, "rg")} ${n(x)} ${n(PAGE.h - y - h)} ${n(w)} ${n(h)} re f`);
      },
      /* circles drawn round the winner, as an umpire does on paper */
      ellipse(cx, cy, rx, ry, o = {}) {
        const k = 0.5523;
        const y = PAGE.h - cy;
        ops.push(
          `${n(o.width ?? 2)} w ${col(o.color || BLACK, "RG")} ` +
          `${n(cx + rx)} ${n(y)} m ` +
          `${n(cx + rx)} ${n(y + k * ry)} ${n(cx + k * rx)} ${n(y + ry)} ${n(cx)} ${n(y + ry)} c ` +
          `${n(cx - k * rx)} ${n(y + ry)} ${n(cx - rx)} ${n(y + k * ry)} ${n(cx - rx)} ${n(y)} c ` +
          `${n(cx - rx)} ${n(y - k * ry)} ${n(cx - k * rx)} ${n(y - ry)} ${n(cx)} ${n(y - ry)} c ` +
          `${n(cx + k * rx)} ${n(y - ry)} ${n(cx + rx)} ${n(y - k * ry)} ${n(cx + rx)} ${n(y)} c S`
        );
      },
      out: () => ops.join("\n"),
    };
  }

  /* Wrap the page content stream in a minimal PDF file. */
  function pdfFile(content) {
    const objs = [
      null,
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.w.toFixed(2)} ${PAGE.h.toFixed(2)}] ` +
        `/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    ];
    let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    const offsets = [];
    for (let i = 1; i < objs.length; i++) {
      offsets[i] = out.length;
      out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
    }
    const xref = out.length;
    out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < objs.length; i++) {
      out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    }
    out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Uint8Array.from(out, (ch) => ch.charCodeAt(0) & 0xff);
  }

  /* ---------- the sheet ---------- */

  function build(state, lang) {
    const m = Sheet.model(state, lang);
    const S = (k) => t(m.L, "sheet." + k);
    const c = canvas();
    const contentW = PAGE.w - 2 * M;

    /* label + dotted fill-in line, with the value written on the line */
    const field = (label, value, x, y, labelW, w) => {
      c.text(`${label}:`, x, y, { size: 8, color: GREY });
      const lx = x + labelW;
      c.line(lx, y + 2.5, x + w, y + 2.5, { width: 0.6, color: GREY, dash: true });
      c.text(value, (lx + x + w) / 2, y, { size: 9, align: "center" });
    };

    // --- header: Match/Date, the two team boxes, the score box, the fields ---
    const headTop = 34;
    const rowH = 17;
    const boxW = 172;
    const scoreW = 76;
    const scoreX = M + 102 + boxW + 8;
    const boxX = [M + 102, scoreX + scoreW + 8];

    field(S("match"), "", M, headTop + 30, 32, 88);
    c.text(`${S("date")}:`, M, headTop + 52, { size: 8, color: GREY });
    c.text(m.header.date, M + 32, headTop + 52, { size: 9 });

    for (const side of [0, 1]) {
      const s = m.sides[side];
      const x = boxX[side];
      if (side === 1) c.fill(x, headTop, boxW, rowH * 3, SHADE);
      for (let i = 0; i < 3; i++) c.rect(x, headTop + i * rowH, boxW, rowH, { width: 0.8 });
      // end marker (R / L) in a small cell on the box's outer edge
      const mx = side === 0 ? x : x + boxW - 14;
      c.rect(mx, headTop, 14, rowH, { width: 0.8 });
      c.text(s.end, mx + 7, headTop + 12, { size: 9, align: "center" });
      const textX = side === 0 ? x + 18 : x + 4;
      const textW = boxW - 22;
      c.text(s.names[0] || "", textX, headTop + 12, {
        size: fitSize(s.names[0] || "", textW, 10, false),
      });
      c.text(s.names[1] || "", x + 4, headTop + rowH + 12, {
        size: fitSize(s.names[1] || "", textW, 10, false),
      });
      c.text(s.club, x + 4, headTop + 2 * rowH + 11, {
        size: fitSize(s.club, textW, 7.5, false), color: GREY,
      });
      if (m.winner === side) {
        c.ellipse(x + boxW / 2, headTop + rowH * 1.5, boxW / 2 + 12, rowH * 1.5 + 12, { width: 2 });
      }
    }

    // score box: one row per game of the format
    c.text(S("score"), scoreX + scoreW / 2, headTop - 4, { size: 8, align: "center" });
    m.scores.forEach((g, i) => {
      c.rect(scoreX, headTop + i * rowH, scoreW, rowH, { width: 0.8 });
      c.text(g ? `${g[0]}  :  ${g[1]}` : ":", scoreX + scoreW / 2, headTop + i * rowH + 12,
             { size: 10, align: "center" });
    });
    const shuttleY = headTop + m.scores.length * rowH + 14;
    c.text(`${S("shuttles")}:`, scoreX + scoreW / 2 - 4, shuttleY, { size: 8, align: "right", color: GREY });
    c.text(m.header.shuttles, scoreX + scoreW / 2 + 4, shuttleY, { size: 9 });

    // right-hand fields
    const fieldX = PAGE.w - M - 248;
    [
      [S("court"), m.header.court],
      [S("umpire"), ""],
      [S("serviceJudge"), ""],
      [S("begin"), m.header.begin],
      [S("end"), m.header.end],
      [S("duration"), m.header.duration],
    ].forEach(([label, value], i) => {
      field(label, value, fieldX, headTop + 6 + i * 17, 70, 248);
    });

    // --- the rally grid ---
    const nameW = 96;
    const markW = 13;
    const finW = 40;
    const gridX = M + nameW + markW;
    const cellW = (contentW - nameW - markW - finW) / m.cols;
    const gridW = cellW * m.cols;
    const finX = gridX + gridW;
    const cellH = 13;
    let top = 150;

    for (const block of m.blocks) {
      const rows = block.rows;
      const h = rows.length * cellH;
      const hasNotes = rows.some((r) => r.note != null);
      rows.forEach((r, i) => {
        if (r.shaded) c.fill(gridX, top + i * cellH, gridW + finW, cellH, SHADE);
      });
      // inner grid: light rules, suppressed across rows carrying a note
      for (let i = 1; i < rows.length; i++) {
        c.line(M, top + i * cellH, finX, top + i * cellH, { width: 0.5, color: GRID });
      }
      if (hasNotes) {
        rows.forEach((r, i) => {
          if (r.note != null) return;
          for (let k = 1; k < m.cols; k++) {
            c.line(gridX + k * cellW, top + i * cellH, gridX + k * cellW, top + (i + 1) * cellH,
                   { width: 0.5, color: GRID });
          }
        });
      } else {
        for (let k = 1; k < m.cols; k++) {
          c.line(gridX + k * cellW, top, gridX + k * cellW, top + h, { width: 0.5, color: GRID });
        }
      }
      // black block frame and the name / mark separators
      c.rect(M, top, nameW + markW + gridW + finW, h, { width: 0.9 });
      c.line(M + nameW, top, M + nameW, top + h, { width: 0.9 });
      c.line(gridX, top, gridX, top + h, { width: 0.9 });
      c.line(finX, top, finX, top + h, { width: 0.9 });

      rows.forEach((r, i) => {
        const base = top + i * cellH + cellH - 3.8;
        c.text(r.label, M + 2.5, base, { size: fitSize(r.label, nameW - 5, 7.5, false) });
        c.text(r.mark, M + nameW + markW / 2, base, { size: 7.5, bold: true, align: "center" });
        if (r.note != null) {
          c.text(r.note, gridX + 4, base, { size: fitSize(r.note, gridW - 8, 9, false) });
        } else {
          r.cells.forEach((v, k) => {
            c.text(v, gridX + k * cellW + cellW / 2, base, { size: 7.5, align: "center" });
          });
        }
      });

      // The game's final score: two numbers split by a diagonal, circled. The
      // pair sits around the block's middle so the circle hugs it (the cell
      // itself is as tall as the block).
      if (block.final) {
        const cy = top + h / 2;
        c.line(finX + 9, cy + 4, finX + finW - 9, cy - 4, { width: 0.7 });
        c.text(String(block.final[0]), finX + 12, cy - 2, { size: 8.5 });
        c.text(String(block.final[1]), finX + finW - 11, cy + 10, { size: 8.5, align: "right" });
        c.ellipse(finX + finW / 2, cy, finW / 2 - 4, 15.5, { width: 1.2 });
      }
      top += h + 7;
    }

    // --- signature lines ---
    const signY = Math.max(top + 30, PAGE.h - M - 22);
    field(S("umpire"), "", PAGE.w / 2 - 250, signY, 46, 220);
    field(S("referee"), "", PAGE.w / 2 + 30, signY, 52, 220);

    return pdfFile(c.out());
  }

  /* e.g. "badminton-court-3-2026-08-22.pdf" */
  function fileName(state) {
    const d = new Date(state.matchStartedAt || Date.now());
    const pad = (v) => String(v).padStart(2, "0");
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const court = String(state.config.court || "").replace(/[^\w-]+/g, "");
    return `badminton-${court ? `court-${court}-` : ""}${date}.pdf`;
  }

  return { build, fileName };
})();
