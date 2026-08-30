/* match.js — pure match logic (BWF rally scoring, singles & doubles, best of 3 to 21).
 * No DOM access here; app.js renders the state this module produces.
 *
 * State shape:
 * {
 *   config: {
 *     mode: 'singles'|'doubles',
 *     names: [str, str]                    // singles: one name per side
 *          | [[str, str], [str, str]],     // doubles: two names per side
 *     teams: [str, str], firstServer: 0|1, leftPlayer: 0|1, lang: 'en',
 *     // doubles only (indexes within the side):
 *     firstServerPlayer: 0|1, firstReceiverPlayer: 0|1,
 *   },
 *   gameIndex: 0..2,
 *   score: [a, b],               // current game, indexed by player
 *   games: [ [a, b], ... ],      // completed games, indexed by player
 *   gamesWon: [x, y],
 *   server: 0|1,                 // serving SIDE
 *   serverPlayer: 0|1,           // doubles: serving player within that side
 *   courts: [0|1, 0|1],          // doubles: per side, which player stands in the RIGHT service court
 *   leftPlayer: 0|1,             // side currently on the umpire's left
 *   intervalTaken: bool,         // 11-point interval taken in current game
 *   phase: 'playing' | 'interval' | 'between_games' | 'finished',
 *   timerEndsAt: ms-epoch|null,  // countdown target for interval phases
 *   winner: 0|1|null,
 *   announcement: str,           // the call the umpire reads out
 *   history: [snapshots]         // for undo (snapshots exclude history)
 * }
 */
"use strict";

/* Default (BWF) rules; a match can carry overrides in config.rules. */
const RULES = {
  gamePoints: 21,
  maxPoints: 30,      // 29-all → first to 30
  bestOf: 3,
  gamesToWin: 2,
  intervalAt: 11,     // leading score triggering the mid-game interval
  intervalMs: 60 * 1000,
  betweenGamesMs: 120 * 1000,
};

const Match = {
  create(config) {
    const state = {
      config,
      gameIndex: 0,
      score: [0, 0],
      games: [],
      gamesWon: [0, 0],
      server: config.firstServer,
      leftPlayer: config.leftPlayer,
      intervalTaken: false,
      phase: "playing",
      timerEndsAt: null,
      winner: null,
      announcement: t(config.lang, "call.loveAll"),
      history: [],
    };
    if (config.mode === "doubles") {
      state.serverPlayer = config.firstServerPlayer;
      state.courts = [];
      state.courts[config.firstServer] = config.firstServerPlayer;      // server starts right (score 0, even)
      state.courts[1 - config.firstServer] = config.firstReceiverPlayer; // receiver starts right too (diagonal)
    }
    return state;
  },

  /* Effective rules for a match: defaults + per-match overrides. */
  rules(state) {
    return { ...RULES, ...(state.config.rules || {}) };
  },

  /* Display name of a side: the player, or "A / B" for a doubles pair. */
  sideName(config, side) {
    const n = config.names[side];
    return Array.isArray(n) ? n.join(" / ") : n;
  },

  _snapshot(state) {
    const { history, ...rest } = state;
    state.history.push(JSON.parse(JSON.stringify(rest)));
  },

  undo(state) {
    const prev = state.history.pop();
    if (!prev) return state;
    return { ...prev, history: state.history };
  },

  /* Rally won by player `w` (0|1). Mutates and returns state. */
  point(state, w) {
    if (state.phase !== "playing") return state;
    this._snapshot(state);

    const R = this.rules(state);
    const L = state.config.lang;
    const call = [];

    const serviceOver = w !== state.server;
    state.server = w;
    state.score[w] += 1;

    if (state.config.mode === "doubles") {
      if (!serviceOver) {
        state.courts[w] = 1 - state.courts[w]; // same server serves again from the other court: partners swap
      } else {
        // new serving side keeps positions; whoever stands in the parity-correct court serves
        state.serverPlayer = state.score[w] % 2 === 0 ? state.courts[w] : 1 - state.courts[w];
      }
    }

    const [a, b] = state.score;
    const other = 1 - w;

    // --- game finished? ---
    const won =
      (state.score[w] >= R.gamePoints && state.score[w] - state.score[other] >= 2) ||
      state.score[w] === R.maxPoints;

    if (won) {
      state.gamesWon[w] += 1;
      state.games.push([a, b]);
      const name = this.sideName(state.config, w);
      if (state.gamesWon[w] === R.gamesToWin) {
        state.phase = "finished";
        state.winner = w;
        const scores = state.games
          .map(([x, y]) => (w === 0 ? `${x}-${y}` : `${y}-${x}`))
          .join(", ");
        state.announcement = t(L, "call.matchWonBy", { name, scores });
      } else {
        state.phase = "between_games";
        state.timerEndsAt = Date.now() + R.betweenGamesMs;
        const score = w === 0 ? `${a}-${b}` : `${b}-${a}`;
        state.announcement =
          t(L, state.gameIndex === 0 ? "call.firstGameWonBy" : "call.secondGameWonBy", { name }) +
          "\n" + score;
        if (state.gamesWon[0] === 1 && state.gamesWon[1] === 1) {
          state.announcement += "\n" + t(L, "call.oneGameAll");
        }
      }
      return state;
    }

    // --- build the score call (server's score first) ---
    if (serviceOver) call.push(t(L, "call.serviceOver"));

    const sw = t(L, "call.scoreWord");
    const sServer = state.score[state.server];
    const sReceiver = state.score[1 - state.server];

    // game/match point phrase, inserted after the holder's score.
    // Announced only on the rally that first brings a side to 20 (p === w:
    // later calls at 20 stay plain), or at 29 (29-28 and 29-all) — never at
    // the in-between deuce scores like 22-21.
    const holderPhrase = (p) => {
      const s = state.score[p];
      const o = state.score[1 - p];
      const holds =
        (s === R.gamePoints - 1 && o < R.gamePoints - 1 && p === w) ||
        s === R.maxPoints - 1;
      if (!holds) return null;
      const isMatch = state.gamesWon[p] === R.gamesToWin - 1;
      return t(L, isMatch ? "call.matchPoint" : "call.gamePoint");
    };

    if (sServer === sReceiver) {
      // e.g. "10 all", or "29 game point 29" at 29-all; if the sides hold
      // different phrases there (one is a game up), match point outranks
      const p0 = holderPhrase(0), p1 = holderPhrase(1);
      const mp = t(L, "call.matchPoint");
      const phrase = p0 === mp || p1 === mp ? mp : (p0 || p1);
      call.push(
        phrase ? `${sw(sServer)} ${phrase} ${sw(sReceiver)}`
               : t(L, "call.allScore", { n: sw(sServer) })
      );
    } else {
      const ps = holderPhrase(state.server);
      const pr = holderPhrase(1 - state.server);
      // e.g. "20 game point 14"  /  "14, 20 game point" style kept simple:
      let text = ps
        ? `${sw(sServer)} ${ps} ${sw(sReceiver)}`
        : `${sw(sServer)}-${sw(sReceiver)}`;
      if (pr) text += ` ${pr}`;
      call.push(text);
    }

    // --- mid-game interval at 11 (leading score) ---
    const leader = a === b ? null : (a > b ? 0 : 1);
    if (!state.intervalTaken && leader !== null && state.score[leader] === R.intervalAt) {
      state.intervalTaken = true;
      state.phase = "interval";
      state.timerEndsAt = Date.now() + R.intervalMs;
      call.push(t(L, "call.interval"));
      // deciding game: announce change of ends; the actual swap happens
      // when play resumes (see resume())
      if (state.gameIndex === R.bestOf - 1) call.push(t(L, "call.changeEnds"));
    }

    state.announcement = call.join("; ");
    return state;
  },

  /* Resume after the 11-point interval. */
  resume(state) {
    if (state.phase !== "interval") return state;
    this._snapshot(state);
    // deciding game: the sides change ends coming out of this interval
    if (state.gameIndex === this.rules(state).bestOf - 1) {
      state.leftPlayer = 1 - state.leftPlayer;
    }
    const L = state.config.lang;
    const sw = t(L, "call.scoreWord");
    const sServer = state.score[state.server];
    const sReceiver = state.score[1 - state.server];
    const scoreText = sServer === sReceiver
      ? t(L, "call.allScore", { n: sw(sServer) })
      : `${sw(sServer)}-${sw(sReceiver)}`;
    state.phase = "playing";
    state.timerEndsAt = null;
    state.announcement = `${scoreText}; ${t(L, "call.play")}`;
    return state;
  },

  /* Start game 2 or the deciding game.
   * Doubles: `choices` = {serverPlayer, receiverPlayer} — BWF lets either player
   * of the winning side serve first, and either player of the losing side receive. */
  nextGame(state, choices = {}) {
    if (state.phase !== "between_games") return state;
    this._snapshot(state);
    const L = state.config.lang;
    const lastWinner = state.gamesWon[0] > state.gamesWon[1] ? 0 : 1;
    state.gameIndex += 1;
    state.score = [0, 0];
    state.server = lastWinner;          // game winner serves first next game
    if (state.config.mode === "doubles") {
      const sp = choices.serverPlayer ?? 0;
      state.serverPlayer = sp;
      state.courts = [];
      state.courts[lastWinner] = sp;                          // server starts right (love all)
      state.courts[1 - lastWinner] = choices.receiverPlayer ?? 0;
    }
    state.intervalTaken = false;
    state.leftPlayer = 1 - state.leftPlayer; // change ends between games
    state.phase = "playing";
    state.timerEndsAt = null;
    state.announcement = t(L,
      state.gameIndex === this.rules(state).bestOf - 1 ? "call.finalGame" : "call.secondGame");
    return state;
  },

  /* Rally-by-rally reconstruction for the score sheet, rebuilt from the undo
   * history so it follows the corrected path. One entry per game:
   *   { index, server, serverPlayer, receiverPlayer, score, rallies: [...] }
   * Each rally records who won it and which player serves next — on the paper
   * sheet the new score is written in that player's row. */
  timeline(state) {
    const steps = [...(state.history || []), state].map(({ history, ...rest }) => rest);
    const doubles = state.config.mode === "doubles";
    const games = [];
    let cur = null;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (!cur || s.gameIndex !== cur.index) {
        cur = {
          index: s.gameIndex,
          server: s.server,
          serverPlayer: doubles ? (s.serverPlayer ?? 0) : 0,
          receiverPlayer: doubles ? this.receiverPlayer(s) : 0,
          score: [...s.score],
          rallies: [],
        };
        games.push(cur);
      }
      const next = steps[i + 1];
      if (!next || next.gameIndex !== s.gameIndex) continue;
      // interval/resume snapshots repeat the score; only rallies advance it
      if (next.score[0] + next.score[1] !== s.score[0] + s.score[1] + 1) continue;
      const w = next.score[0] > s.score[0] ? 0 : 1;
      cur.rallies.push({
        winner: w,
        player: doubles ? (next.serverPlayer ?? 0) : 0, // serves the next rally
        value: next.score[w],
      });
      cur.score = [...next.score];
    }
    return games;
  },

  /* Service court for the current server: 'R' when server's score is even. */
  serviceCourt(state) {
    return state.score[state.server] % 2 === 0 ? "R" : "L";
  },

  /* Doubles: the receiving player (index within the receiving side) —
   * whoever stands in the service court diagonal to the server. */
  receiverPlayer(state) {
    const recv = 1 - state.server;
    return this.serviceCourt(state) === "R" ? state.courts[recv] : 1 - state.courts[recv];
  },
};
