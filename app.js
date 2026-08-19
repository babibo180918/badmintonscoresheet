/* app.js — DOM wiring, rendering, persistence, service-worker registration. */
"use strict";

const STORAGE_KEY = "badmintonscoresheet.state";
const WARMUP_KEY = "badmintonscoresheet.warmup"; // ms-epoch the warm-up ends at
const WARMUP_MS = 2 * 60 * 1000;
const WARMUP_WARN_MS = 30 * 1000; // last 30 s blink red

let state = null;
let timerHandle = null;
let warmupHandle = null;
let clockHandle = null;

const $ = (id) => document.getElementById(id);
const uiLang = () => state?.config.lang || $("lang").value || "en";
const ui = (path, vars) => t(uiLang(), "ui." + path, vars);
const isDoubles = () => state?.config.mode === "doubles";
/* mode chosen on the setup form (state may not exist yet) */
const formMode = () =>
  document.querySelector('input[name="mode"]:checked')?.value || "singles";

/* Translate every element carrying data-i18n, plus input placeholders. */
function applyStaticI18n(lang) {
  const doubles = formMode() === "doubles";
  // side 2's first player is "Player 2" in singles but "Player 3" in doubles
  $("lbl-name1").dataset.i18n = doubles ? "ui.player3" : "ui.player2";
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(lang, el.dataset.i18n);
  });
  $("name0").placeholder = t(lang, "ui.player1");
  $("name0b").placeholder = t(lang, "ui.player2");
  $("name1").placeholder = t(lang, doubles ? "ui.player3" : "ui.player2");
  $("name1b").placeholder = t(lang, "ui.player4");
}

/* ---------- persistence ---------- */
function save() {
  const { history, ...rest } = state;
  // keep undo history across reloads too (it's small: max ~90 rallies)
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...rest, history }));
}
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function clearSaved() {
  localStorage.removeItem(STORAGE_KEY);
}

/* ---------- warm-up timer (runs across setup + pre-match popup) ---------- */
function warmupEndsAt() {
  const v = Number(localStorage.getItem(WARMUP_KEY));
  return v || null;
}
function fmtCountdown(remainingMs) {
  const s = Math.ceil(Math.max(0, remainingMs) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function startWarmupTicker() {
  stopWarmupTicker();
  const el = $("warmup-time");
  const tick = () => {
    let end = warmupEndsAt();
    // expired on the setup page → reset, ready to start again
    if (end && end - Date.now() <= 0) { localStorage.removeItem(WARMUP_KEY); end = null; }
    el.textContent = end ? fmtCountdown(end - Date.now()) : fmtCountdown(WARMUP_MS);
    el.classList.toggle("warning", !!end && end - Date.now() <= WARMUP_WARN_MS);
  };
  tick();
  warmupHandle = setInterval(tick, 250);
}
function stopWarmupTicker() {
  if (warmupHandle) { clearInterval(warmupHandle); warmupHandle = null; }
}

/* Warm-up block inside the pre-match announcement popup:
 * not started → 2:00 + Start button; running → countdown (blinks red
 * in the last 30 s); reached 0:00 → the whole block disappears. */
function tickOverlayWarmup() {
  const block = $("overlay-warmup");
  const timeEl = $("overlay-warmup-time");
  const btn = $("overlay-warmup-start");
  const end = warmupEndsAt();
  if (end) {
    const remaining = end - Date.now();
    if (remaining <= 0) { block.classList.add("hidden"); return; }
    block.classList.remove("hidden");
    btn.classList.add("hidden");
    timeEl.textContent = fmtCountdown(remaining);
    timeEl.classList.toggle("warning", remaining <= WARMUP_WARN_MS);
  } else {
    block.classList.remove("hidden");
    btn.classList.remove("hidden");
    timeEl.textContent = fmtCountdown(WARMUP_MS);
    timeEl.classList.remove("warning");
  }
}

/* ---------- screens ---------- */
function showSetup() {
  stopTimer();
  stopClock();
  $("match").classList.add("hidden");
  $("setup").classList.remove("hidden");
  startWarmupTicker();
  const saved = load();
  $("resume-match").classList.toggle("hidden", !saved || saved.phase === "finished");
}

function showMatch() {
  stopWarmupTicker();
  applyStaticI18n(uiLang()); // overlay legends follow the match language
  $("setup").classList.add("hidden");
  $("match").classList.remove("hidden");
  startClock();
  render();
}

/* ---------- rendering ---------- */
function render() {
  const left = state.leftPlayer;
  const right = 1 - left;
  renderZone($("zone-left"), left);
  renderZone($("zone-right"), right);

  $("announcement-text").textContent = state.announcement;

  // games summary in the top bar, e.g. "21-15 | 11-8"
  const parts = state.games.map(([a, b]) => `${a}-${b}`);
  if (state.phase !== "finished") parts.push(`${state.score[0]}-${state.score[1]}`);
  $("games-summary").textContent = parts.join("  |  ");

  $("btn-undo").disabled = state.history.length === 0;

  renderOverlay();
}

function renderZone(zone, player) {
  const nameEl = zone.querySelector(".tz-name");
  if (isDoubles()) {
    // one row per player: court letter (R/L) + name; mark server and receiver
    nameEl.textContent = "";
    const live = state.phase === "playing" || state.phase === "interval";
    const recvSide = 1 - state.server;
    const receiver = Match.receiverPlayer(state);
    for (const p of [0, 1]) {
      const row = document.createElement("div");
      row.className = "tz-player";
      if (live && player === state.server && p === state.serverPlayer) row.classList.add("server");
      if (live && player === recvSide && p === receiver) row.classList.add("receiver");
      const chip = document.createElement("span");
      chip.className = "tz-court";
      chip.textContent = state.courts[player] === p ? ui("rightCourt") : ui("leftCourt");
      const nm = document.createElement("span");
      nm.textContent = state.config.names[player][p];
      row.append(chip, nm);
      nameEl.append(row);
    }
  } else {
    nameEl.textContent = state.config.names[player];
  }
  const team = state.config.teams?.[player] || "";
  const teamEl = zone.querySelector(".tz-team");
  teamEl.textContent = team;
  teamEl.classList.toggle("hidden", !team);
  zone.querySelector(".tz-score").textContent = state.score[player];
  zone.querySelector(".tz-games").textContent = "●".repeat(state.gamesWon[player]);

  const serveEl = zone.querySelector(".tz-serve");
  const isServer = state.server === player && state.phase !== "finished";
  serveEl.classList.toggle("hidden", !isServer);
  if (isServer) {
    const court = Match.serviceCourt(state) === "R" ? ui("rightCourt") : ui("leftCourt");
    serveEl.textContent = `${ui("serving")} · ${court}`;
  }
  zone.disabled = state.phase !== "playing";
  zone.classList.toggle("winner", state.phase === "finished" && state.winner === player);
}

function renderOverlay() {
  const overlay = $("overlay");
  // interval/break popups can be closed early; their timer then runs in the
  // yellow announcement bar instead
  const timed = state.phase === "interval" || state.phase === "between_games";
  const inOverlay = (state.preMatch || timed || state.phase === "finished") &&
    !(timed && state.overlayClosed);
  overlay.classList.toggle("hidden", !inOverlay);
  overlay.classList.toggle("pre-match", !!state.preMatch);
  $("overlay-close").classList.toggle("hidden", !timed);
  if (!timed) $("announcement-timer").classList.add("hidden");
  if (!inOverlay) {
    if (timed) startTimer(); else stopTimer();
    return;
  }

  const title = $("overlay-title");
  const action = $("overlay-action");
  const text = $("overlay-text");
  $("overlay-doubles").classList.add("hidden");

  if (state.preMatch) {
    title.textContent = ui("announcementTitle");
    text.textContent = openingAnnouncement();
    text.classList.remove("hidden");
    action.textContent = ui("play");
    startTimer(); // drives the popup's warm-up block too
    return;
  }
  $("overlay-warmup").classList.add("hidden");

  if (state.phase === "interval") {
    title.textContent = ui("intervalTitle");
    action.textContent = ui("resumePlay");
    // same call as the yellow bar, e.g. "11-6; interval"
    text.textContent = state.announcement;
    text.classList.remove("hidden");
  } else if (state.phase === "between_games") {
    title.textContent = ui("betweenGamesTitle");
    action.textContent = ui("startNextGame");
    // "First set won by X" / score / "One game all" — built in match.js
    text.textContent = state.announcement;
    text.classList.remove("hidden");
    if (isDoubles()) {
      // winning side picks its next server, losing side its receiver
      const winner = state.gamesWon[0] > state.gamesWon[1] ? 0 : 1;
      $("ngs0").textContent = state.config.names[winner][0];
      $("ngs1").textContent = state.config.names[winner][1];
      $("ngr0").textContent = state.config.names[1 - winner][0];
      $("ngr1").textContent = state.config.names[1 - winner][1];
      $("overlay-doubles").classList.remove("hidden");
    }
  } else {
    title.textContent = ui("matchOverTitle");
    action.textContent = ui("newMatch");
    text.textContent = state.announcement; // "Match won by X" + game scores
    text.classList.remove("hidden");
  }
  startTimer();
}

/* BWF-style pre-match announcement, built from the current sides/server. */
function openingAnnouncement() {
  const L = uiLang();
  const { names, teams = [] } = state.config;
  const left = state.leftPlayer;
  if (isDoubles()) {
    const pair = (s) => {
      const joined = `${names[s][0]} ${t(L, "call.and")} ${names[s][1]}`;
      return teams[s] ? `${joined}, ${teams[s]}` : joined;
    };
    return t(L, "call.announceDoubles", {
      right: pair(1 - left),
      left: pair(left),
      server: names[state.server][state.serverPlayer],
      receiver: names[1 - state.server][Match.receiverPlayer(state)],
    });
  }
  const withTeam = (p) => (teams[p] ? `${names[p]}, ${teams[p]}` : names[p]);
  return t(L, "call.announce", {
    right: withTeam(1 - left),
    left: withTeam(left),
    server: names[state.server],
  });
}

/* "Court 3 twenty seconds; court 3 twenty seconds" — called near the end of
 * the 11-point interval and the between-games break. */
function twentySecondsCall() {
  const court = state.config.court;
  return court
    ? t(uiLang(), "call.twentySeconds", { court })
    : t(uiLang(), "call.twentySecondsShort");
}

/* countdown for pre-match warm-up / interval / between-games.
 * Runs while the popup is open AND after it is closed early (the countdown
 * then shows in the yellow bar). At 0:00 the phase auto-advances exactly as
 * if "Resume play" / "Start next game" had been tapped. */
function startTimer() {
  stopTimer();
  const el = $("overlay-timer");
  const msg = $("overlay-20s");
  const barEl = $("announcement-timer");
  const tick = () => {
    if (state.preMatch) {
      el.textContent = "";
      el.classList.remove("warning");
      msg.classList.add("hidden");
      barEl.classList.add("hidden");
      tickOverlayWarmup();
      return;
    }
    if (!state.timerEndsAt) {
      el.textContent = "";
      el.classList.remove("warning");
      msg.classList.add("hidden");
      barEl.classList.add("hidden");
      return;
    }
    const remaining = Math.max(0, state.timerEndsAt - Date.now());
    if (remaining === 0) { onTimerExpired(); return; }
    el.textContent = fmtCountdown(remaining);
    // last 20 s of an interval: umpire's "twenty seconds" call, blinking red
    const show20 = remaining <= 20 * 1000 &&
      (state.phase === "interval" || state.phase === "between_games");
    el.classList.toggle("warning", show20);
    msg.classList.toggle("hidden", !show20);
    if (show20) msg.textContent = twentySecondsCall();
    // popup closed early → countdown lives in the yellow bar instead
    barEl.classList.toggle("hidden", !state.overlayClosed);
    if (state.overlayClosed) {
      barEl.textContent = fmtCountdown(remaining);
      barEl.classList.toggle("warning", show20);
    }
  };
  tick();
  timerHandle = setInterval(tick, 250);
}
function stopTimer() {
  if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
}

/* running match clock in the top bar; starts when "Play" is tapped */
function startClock() {
  stopClock();
  const el = $("match-clock");
  const tick = () => {
    if (!state?.matchStartedAt) { el.textContent = ""; return; }
    const end = state.matchEndedAt || Date.now();
    const s = Math.floor(Math.max(0, end - state.matchStartedAt) / 1000);
    el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  tick();
  clockHandle = setInterval(tick, 1000);
}
function stopClock() {
  if (clockHandle) { clearInterval(clockHandle); clockHandle = null; }
}

/* ---------- actions ---------- */
function onPoint(side) {
  const player = side === "left" ? state.leftPlayer : 1 - state.leftPlayer;
  state = Match.point(state, player);
  if (state.phase === "finished" && !state.matchEndedAt) state.matchEndedAt = Date.now();
  save();
  render();
}

function onUndo() {
  state = Match.undo(state);
  if (state.phase !== "finished") state.matchEndedAt = null;
  save();
  render();
}

/* Leave interval/between-games and play on — used by the popup's action
 * button and by the countdown reaching 0:00. */
function advancePhase() {
  if (state.phase === "interval") state = Match.resume(state);
  else if (state.phase === "between_games") {
    const choices = isDoubles() ? {
      serverPlayer: Number(document.querySelector('input[name="ngServer"]:checked').value),
      receiverPlayer: Number(document.querySelector('input[name="ngReceiver"]:checked').value),
    } : undefined;
    state = Match.nextGame(state, choices);
  }
  state.overlayClosed = false;
  save();
  render();
}

function onTimerExpired() {
  stopTimer();
  advancePhase();
}

function onOverlayAction() {
  if (state.preMatch) {
    // "Play": close the announcement, end the warm-up, start the match clock
    state.preMatch = false;
    state.matchStartedAt = Date.now();
    localStorage.removeItem(WARMUP_KEY);
    save();
    render();
    return;
  }
  if (state.phase === "finished") { clearSaved(); showSetup(); return; }
  advancePhase();
}

/* Close the interval/break popup early; the countdown moves to the yellow bar. */
function onOverlayClose() {
  state.overlayClosed = true;
  save();
  render();
}

function onNewMatch() {
  if (state && state.phase !== "finished" && !confirm(ui("confirmNew"))) return;
  clearSaved();
  showSetup();
}

/* ---------- setup form ---------- */
function initSetup() {
  const n0 = $("name0"), n0b = $("name0b"), n1 = $("name1"), n1b = $("name1b");
  /* the four entered names with per-mode fallbacks (Player 1..4 / Player 1..2) */
  const enteredNames = (lang) => {
    const doubles = formMode() === "doubles";
    return [
      n0.value.trim() || t(lang, "ui.player1"),
      n0b.value.trim() || t(lang, "ui.player2"),
      n1.value.trim() || t(lang, doubles ? "ui.player3" : "ui.player2"),
      n1b.value.trim() || t(lang, "ui.player4"),
    ];
  };
  const syncNames = () => {
    const [a, ab, b, bb] = enteredNames(uiLang());
    if (formMode() === "doubles") {
      $("ds00").textContent = a; $("ds01").textContent = ab;
      $("ds10").textContent = b; $("ds11").textContent = bb;
      // receivers are the players of the side NOT serving first
      const srvSide = Number(document.querySelector('input[name="dblServer"]:checked').value[0]);
      $("dr0").textContent = srvSide === 0 ? b : a;
      $("dr1").textContent = srvSide === 0 ? bb : ab;
      $("rs0").textContent = `${a} / ${ab}`;
      $("rs1").textContent = `${b} / ${bb}`;
    } else {
      $("fs0").textContent = a; $("rs0").textContent = a;
      $("fs1").textContent = b; $("rs1").textContent = b;
    }
  };
  [n0, n0b, n1, n1b].forEach((el) => el.addEventListener("input", syncNames));
  document.querySelectorAll('input[name="dblServer"]').forEach((el) =>
    el.addEventListener("change", syncNames));
  document.querySelectorAll('input[name="mode"]').forEach((el) =>
    el.addEventListener("change", () => {
      $("setup-form").classList.toggle("doubles", formMode() === "doubles");
      applyStaticI18n($("lang").value);
      syncNames();
    }));
  $("lang").addEventListener("change", () => {
    applyStaticI18n($("lang").value);
    syncNames();
  });

  $("setup-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const lang = $("lang").value;
    const doubles = formMode() === "doubles";
    const [a, ab, b, bb] = enteredNames(lang);
    const config = {
      mode: doubles ? "doubles" : "singles",
      court: $("court-number").value.trim(),
      names: doubles ? [[a, ab], [b, bb]] : [a, b],
      teams: [$("team0").value.trim(), $("team1").value.trim()],
      // the form asks who starts on the umpire's RIGHT; match state tracks the left player
      leftPlayer: 1 - Number(document.querySelector('input[name="rightPlayer"]:checked').value),
      lang,
    };
    if (doubles) {
      const [srvSide, srvPlayer] =
        document.querySelector('input[name="dblServer"]:checked').value.split("-").map(Number);
      config.firstServer = srvSide;
      config.firstServerPlayer = srvPlayer;
      config.firstReceiverPlayer =
        Number(document.querySelector('input[name="dblReceiver"]:checked').value);
    } else {
      config.firstServer = Number(document.querySelector('input[name="firstServer"]:checked').value);
    }
    state = Match.create(config);
    // app-level pre-match fields: announcement popup + match clock
    state.preMatch = true;
    state.matchStartedAt = null;
    state.matchEndedAt = null;
    save();
    showMatch();
  });

  $("warmup-start").addEventListener("click", () => {
    localStorage.setItem(WARMUP_KEY, String(Date.now() + WARMUP_MS));
  });
  $("overlay-warmup-start").addEventListener("click", () => {
    localStorage.setItem(WARMUP_KEY, String(Date.now() + WARMUP_MS));
  });

  $("resume-match").addEventListener("click", () => {
    const saved = load();
    if (!saved) return;
    state = saved;
    showMatch();
  });
}

/* ---------- boot ---------- */
document.addEventListener("DOMContentLoaded", () => {
  initSetup();
  applyStaticI18n($("lang").value);
  $("zone-left").addEventListener("click", () => onPoint("left"));
  $("zone-right").addEventListener("click", () => onPoint("right"));
  $("btn-undo").addEventListener("click", onUndo);
  $("btn-new").addEventListener("click", onNewMatch);
  $("overlay-action").addEventListener("click", onOverlayAction);
  $("overlay-close").addEventListener("click", onOverlayClose);
  // tapping the yellow bar reopens a popup that was closed early
  $("announcement").addEventListener("click", () => {
    if (state?.overlayClosed) { state.overlayClosed = false; save(); render(); }
  });

  const saved = load();
  if (saved && saved.phase !== "finished") {
    state = saved;
    showMatch();
  } else {
    showSetup();
  }
});

/* PWA offline support (needs http(s); harmless no-op when opened as file://) */
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
