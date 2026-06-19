// ============================================================
//  APP.JS — Lógica da aplicação
//  Login valida contra CSV publicado do Google Sheets
// ============================================================

const STORAGE_KEY = "bolao_user_email";
const STORAGE_NAME = "bolao_user_name";
const OVERRIDE_LOCAL_KEY = "bolao_status_override";

// Valor (em reais) que cada participante deposita.
const BET_VALUE_PER_PERSON = 20;

// Usuário logado nesta sessão (preenchido em enterApp)
let CURRENT_USER = null;

// Override global de status (vale para TODOS os jogos), lido da célula A1
// da aba "Status" da planilha — ou do localStorage como fallback local.
// Valores: "upcoming" | "open" | "closed" | "finished" | null (= automático)
let GLOBAL_STATUS_OVERRIDE = null;

// Override global de placar, lido das células C1 (gols do Brasil/casa) e
// D1 (gols do visitante) da aba "Status". null = sem placar ainda (C1/D1
// vazias ou inválidas) -> mostra "? × ?".
let GLOBAL_RESULT_OVERRIDE = null;

// Total de participantes por jogo, derivado do próprio CSV de apostas do jogo.
// game.id → { winners: string[], betsCount: number } | null
let CACHED_BETS_WINNERS = {};

// Status efetivo da última renderização — usado para detectar transições
// e re-renderizar só quando algo realmente muda.
let lastRenderedStatuses = {};

// Placar ao vivo lido da API da ESPN. game.id → { home, away, state }
// state: "pre" (antes) | "in" (rolando) | "post" (encerrado).
let LIVE_SCORES = {};
// Assinatura do último placar renderizado, p/ rebuild só quando muda um gol.
let lastLiveSig = "";

// Garante que os timers globais sejam registrados uma única vez.
let clocksStarted = false;

// ---------- FUSO DE RECIFE (UTC-3, sem horário de verão) ----------

const RECIFE_OFFSET = "-03:00";

// Interpreta uma string ISO "2026-06-13T19:00:00" como horário de Recife
// e devolve o instante absoluto (epoch ms), independente do fuso de quem abre.
function recifeEpoch(iso) {
  if (!iso) return NaN;
  return new Date(iso + RECIFE_OFFSET).getTime();
}

// Instante de início da partida (date + time) em horário de Recife.
function kickoffEpoch(game) {
  if (!game.date || !game.time) return NaN;
  return recifeEpoch(`${game.date}T${game.time}:00`);
}

// ---------- CSV PARSER ----------

function splitCSVLine(line) {
  const cols = [];
  let cur = "", inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; continue; }
      inQuote = !inQuote;
      continue;
    }
    if (ch === "," && !inQuote) { cols.push(cur); cur = ""; continue; }
    cur += ch;
  }
  cols.push(cur);
  return cols;
}

function parseCSV(text) {
  // Remove BOM e normaliza quebras de linha
  text = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = splitCSVLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const cols = splitCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => obj[h] = (cols[i] || "").trim());
    return obj;
  });
}

// ---------- FETCH CSV (direto — sem proxy) ----------
// Planilhas publicadas no Google Sheets aceitam fetch direto com mode: "cors"
// desde que a URL seja a de publicação (/pub?output=csv), não a de edição.

async function fetchCSV(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Erro ao buscar CSV: HTTP ${res.status}`);
  return res.text();
}

// ---------- VALIDAR LOGIN NO CSV ----------

async function validateEmailInSheet(email) {
  const normalized = email.trim().toLowerCase();

  // Admin sempre passa
  if (normalized === ADMIN_EMAIL.toLowerCase()) {
    return { valid: true, name: "João (organizador)" };
  }

  const text = await fetchCSV(PARTICIPANTS_CSV_URL);
  const rows = parseCSV(text);

  console.log("Linhas encontradas no CSV:", rows.length);
  if (rows.length > 0) console.log("Headers:", Object.keys(rows[0]));

  for (const row of rows) {
    const rowEmail = (
      row["Endereço de e-mail"] ||
      row["Email"] ||
      row["email"] ||
      Object.values(row)[1] ||
      ""
    ).trim().toLowerCase();

    console.log("Comparando:", JSON.stringify(rowEmail), "===", JSON.stringify(normalized));

    if (rowEmail === normalized) {
      const name =
        row["Nome :"] ||
        row["Nome"] ||
        row["nome"] ||
        Object.values(row)[2] ||
        email;
      return { valid: true, name };
    }
  }

  return { valid: false };
}

// ---------- HELPERS ----------

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

function formatDeadline(isoStr) {
  return new Date(isoStr).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function isDeadlinePassed(isoStr) {
  return Date.now() > recifeEpoch(isoStr);
}

// Status calculado só pelo tempo (Recife), sem considerar override do admin.
function autoStatus(game) {
  const now = Date.now();
  const finish = recifeEpoch(game.finishAt);
  const deadline = recifeEpoch(game.betDeadline);
  if (!isNaN(finish) && now >= finish) return "finished";
  if (!isNaN(deadline) && now >= deadline) return "closed";
  return game.status;
}

// Jogo "ativo" para fins do override da aba Status: o jogo já iniciado mais
// recentemente (kickoff <= agora) ou, se nenhum jogo começou ainda, o
// próximo a começar. O status/placar da aba Status (e os botões do
// organizador) valem só para esse jogo — assim a atualização de um jogo não
// "vaza" para os cards de jogos futuros.
function getActiveGame() {
  const now = Date.now();
  let started = null;
  let next = null;
  for (const g of GAMES) {
    const kickoff = kickoffEpoch(g);
    if (isNaN(kickoff)) continue;
    if (kickoff <= now) {
      if (!started || kickoff > kickoffEpoch(started)) started = g;
    } else if (!next || kickoff < kickoffEpoch(next)) {
      next = g;
    }
  }
  return started || next || GAMES[0];
}

// Jogo padrão ao carregar a página: o mais próximo da data/hora atual,
// seja passado ou futuro. Diferente de getActiveGame() que prioriza o
// mais recentemente iniciado para fins de override de status/placar.
function getDefaultGame() {
  const now = Date.now();
  let closest = GAMES[0];
  let minDiff = Infinity;
  for (const g of GAMES) {
    const kickoff = kickoffEpoch(g);
    if (isNaN(kickoff)) continue;
    const diff = Math.abs(kickoff - now);
    if (diff < minDiff) { minDiff = diff; closest = g; }
  }
  return closest;
}

// Jogo que recebe o override da aba "Status" (A1 = status, C1/D1 = placar):
// o mais próximo da data/hora atual. Assim, no dia do jogo, o placar ao vivo
// cai no card certo o dia inteiro — não só depois do pontapé inicial.
function getOverrideTargetGame() {
  return getDefaultGame();
}

// Status efetivo do jogo: override global do organizador vence (só para o
// jogo alvo do override); senão, o tempo.
function resolveStatus(game) {
  if (GLOBAL_STATUS_OVERRIDE && game.id === getOverrideTargetGame().id) return GLOBAL_STATUS_OVERRIDE;
  return autoStatus(game);
}

// Sinônimos aceitos na célula de override (PT e EN), para digitar direto
// pelo app do Google Sheets sem precisar lembrar o valor exato em inglês.
const STATUS_SYNONYMS = {
  upcoming: "upcoming", "em breve": "upcoming",
  open: "open", aberta: "open", abertas: "open", aberto: "open", abertos: "open",
  closed: "closed", fechada: "closed", fechadas: "closed", fechado: "closed", fechados: "closed",
  finished: "finished", encerrado: "finished", encerrada: "finished", finalizado: "finished", finalizada: "finished",
};

// Normaliza o valor da célula de override para um status interno, ou
// null se vazio/"auto"/não reconhecido (= automático).
function normalizeStatusValue(raw) {
  // normalize("NFD") separa acentos das letras (ex.: "á" -> "a" + U+0301);
  // o filtro abaixo descarta esses diacríticos (U+0300–U+036F).
  const v = (raw || "").toString().trim().toLowerCase()
    .normalize("NFD")
    .split("")
    .filter(ch => { const c = ch.codePointAt(0); return c < 0x0300 || c > 0x036F; })
    .join("");
  if (!v || v === "auto" || v === "automatico") return null;
  return STATUS_SYNONYMS[v] || null;
}

// Placar efetivo do jogo, nesta ordem de prioridade:
//   1. "result" fixo no data.js (jogo encerrado e fechado pelo organizador)
//   2. placar AO VIVO da ESPN (quando o jogo está rolando ou já terminou)
//   3. C1/D1 da aba "Status" — FALLBACK manual, caso a API da ESPN falhe/atrase
//      (só para o jogo alvo do override)
//   4. "? × ?" (pendente)
function resolveResult(game) {
  if (game.result) return game.result;

  const live = LIVE_SCORES[game.id];
  if (live && (live.state === "in" || live.state === "post") &&
      !isNaN(live.home) && !isNaN(live.away)) {
    return { home: live.home, away: live.away };
  }

  // Fallback manual: a ESPN não trouxe placar utilizável → usa C1/D1 se o
  // organizador tiver preenchido (vale só para o jogo alvo do override).
  if (GLOBAL_RESULT_OVERRIDE && game.id === getOverrideTargetGame().id) {
    return GLOBAL_RESULT_OVERRIDE;
  }

  return null;
}

function statusLabel(status) {
  if (status === "finished") return { text: "Encerrado", cls: "badge-finished" };
  if (status === "closed")   return { text: "Apostas fechadas", cls: "badge-closed" };
  if (status === "open")     return { text: "Apostas abertas", cls: "badge-open" };
  return { text: "Em breve", cls: "badge-upcoming" };
}

// ---------- CRONÔMETROS REGRESSIVOS ----------

// Formata uma duração em ms como HH:mm:ss. Retorna null se já passou.
function formatCountdown(ms) {
  if (ms <= 0) return null;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = n => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// Atualiza, a cada segundo, todos os elementos .countdown na tela.
function tickCountdowns() {
  const now = Date.now();
  document.querySelectorAll(".countdown").forEach(el => {
    const target = Number(el.dataset.target);
    const txt = formatCountdown(target - now);
    if (txt === null) {
      el.textContent = el.dataset.done || "Encerrado";
      el.classList.add("countdown-done");
    } else {
      el.textContent = txt;
      el.classList.remove("countdown-done");
    }
  });
}

// Re-renderiza os cards só quando o status efetivo de algum jogo muda
// (ex.: cruzou o betDeadline ou o finishAt). Evita rebuild a cada segundo.
function checkStatusTransitions() {
  const changed = GAMES.some(g => lastRenderedStatuses[g.id] !== resolveStatus(g));
  if (changed) {
    buildGames();
    buildTicker();
  }
}

// ---------- OVERRIDE GLOBAL DE STATUS (compartilhado / local) ----------

function loadLocalOverride() {
  return localStorage.getItem(OVERRIDE_LOCAL_KEY) || null;
}

function saveLocalOverride(status) {
  if (status === null) localStorage.removeItem(OVERRIDE_LOCAL_KEY);
  else localStorage.setItem(OVERRIDE_LOCAL_KEY, status);
}

// Converte uma célula em número de gols (inteiro >= 0), ou null se
// vazia/inválida (= placar ainda pendente).
function parseGoals(raw) {
  const v = (raw || "").toString().trim();
  if (v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

// Lê o placar das células C1 (gols do time da casa) e D1 (gols do
// visitante). Só retorna um placar se AMBAS forem números válidos.
function parseResultOverride(homeRaw, awayRaw) {
  const home = parseGoals(homeRaw);
  const away = parseGoals(awayRaw);
  if (home === null || away === null) return null;
  return { home, away };
}

// Busca o override compartilhado (aba "Status": A1 = status, C1/D1 =
// placar); se não houver URL configurada, usa o fallback local
// (localStorage) só para o status.
async function refreshOverrides() {
  const before = `${GLOBAL_STATUS_OVERRIDE}|${JSON.stringify(GLOBAL_RESULT_OVERRIDE)}`;

  if (!STATUS_CONFIG_CSV_URL) {
    GLOBAL_STATUS_OVERRIDE = loadLocalOverride();
  } else {
    try {
      const text = await fetchCSV(STATUS_CONFIG_CSV_URL);
      const clean = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
      const firstLine = clean.split(/\r?\n/)[0] || "";
      const cols = splitCSVLine(firstLine);
      GLOBAL_STATUS_OVERRIDE = normalizeStatusValue(cols[0] || "");
      GLOBAL_RESULT_OVERRIDE = parseResultOverride(cols[2], cols[3]);
    } catch (err) {
      console.warn("Falha ao buscar override de status/placar da planilha:", err);
      // mantém o que já tínhamos em memória
    }
  }

  // Se o status OU o placar manual (fallback C1/D1) mudou, repinta a tela.
  const after = `${GLOBAL_STATUS_OVERRIDE}|${JSON.stringify(GLOBAL_RESULT_OVERRIDE)}`;
  if (after !== before && clocksStarted) {
    buildGames();
    buildTicker();
  }
}

// ---------- PLACAR AO VIVO (API pública da ESPN, grátis e sem chave) ----------
// Endpoint da Copa (fifa.world). CORS liberado → chamado direto do navegador,
// sem backend nem proxy. Casa cada jogo pelos nomes em inglês (espnHome/espnAway).
const ESPN_SCOREBOARD_URL =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";

async function fetchLiveScore(game) {
  if (!game.espnHome || !game.espnAway || !game.date) return;
  const dateStr = game.date.replace(/-/g, ""); // YYYY-MM-DD → YYYYMMDD
  try {
    const res = await fetch(`${ESPN_SCOREBOARD_URL}?dates=${dateStr}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return;
    const data = await res.json();
    const norm = (s) => (s || "").trim().toLowerCase();
    for (const ev of data.events || []) {
      const comp = (ev.competitions || [])[0];
      if (!comp || !comp.competitors) continue;
      const homeC = comp.competitors.find((c) => norm(c.team?.displayName) === norm(game.espnHome));
      const awayC = comp.competitors.find((c) => norm(c.team?.displayName) === norm(game.espnAway));
      if (!homeC || !awayC) continue;
      const state = ev.status?.type?.state || comp.status?.type?.state || "pre";
      LIVE_SCORES[game.id] = {
        home: parseInt(homeC.score),
        away: parseInt(awayC.score),
        state,
      };
      return;
    }
  } catch (err) {
    console.warn("Falha ao buscar placar ao vivo da ESPN:", err);
  }
}

// Atualiza o placar ao vivo de todos os jogos sem resultado fixo e re-renderiza
// só quando algum gol muda (gols são raros, então o rebuild é barato).
async function refreshLiveScores() {
  const alvos = GAMES.filter((g) => !g.result && g.espnHome && g.espnAway);
  await Promise.all(alvos.map(fetchLiveScore));
  const sig = JSON.stringify(LIVE_SCORES);
  if (sig !== lastLiveSig) {
    lastLiveSig = sig;
    buildGames();
    buildTicker();
  }
}

// Grava o override global (admin). "auto" limpa o override e volta ao automático.
async function setGlobalStatus(rawStatus) {
  const value = normalizeStatusValue(rawStatus);

  if (STATUS_WRITE_URL) {
    try {
      // text/plain evita preflight CORS no Apps Script (fire-and-forget)
      await fetch(STATUS_WRITE_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ status: value || "" }),
      });
    } catch (err) {
      console.error("Erro ao gravar status na planilha:", err);
    }
  }

  // Espelho local: atualiza a tela na hora (e persiste se não houver planilha).
  GLOBAL_STATUS_OVERRIDE = value;
  saveLocalOverride(value);

  buildGames();
  buildTicker();
}

// Liga os timers globais (cronômetros + checagem de transição + re-fetch).
function startClocks() {
  if (clocksStarted) return;
  clocksStarted = true;
  setInterval(() => {
    tickCountdowns();
    checkStatusTransitions();
  }, 1000);
  setInterval(refreshOverrides, 120000);   // re-fetch status (aba A1) a cada 2 min
  setInterval(refreshLiveScores, 45000);   // re-fetch placar ao vivo (ESPN) a cada 45s
  setInterval(refreshArrecadado, 30000);   // total arrecadado ao vivo a cada 30s
}

// ---------- TICKER ----------

function buildTicker() {
  const track = document.getElementById("ticker-track");
  const bar = track.parentElement;
  const items = GAMES.map(g => {
    const result = resolveResult(g);
    return result
      ? `${g.homeTeam.flag} ${g.homeTeam.name} ${result.home} × ${result.away} ${g.awayTeam.name} ${g.awayTeam.flag}`
      : `${g.homeTeam.flag} ${g.homeTeam.name} × ${g.awayTeam.name} ${g.awayTeam.flag} — ${formatDate(g.date)}`;
  });
  const buildPass = arr => arr.map(i => `<span class="ticker-item">${i}</span>`).join("  <span class='ticker-sep'>|</span>  ");

  // Repete os jogos até que uma "passada" seja larga o suficiente para
  // cobrir a barra inteira — com poucos jogos, sem isso o loop de
  // rolagem deixava um vão vazio (ou quase parado) na tela.
  let pass = items;
  track.innerHTML = buildPass(pass);
  while (track.getBoundingClientRect().width < bar.getBoundingClientRect().width && pass.length < items.length * 10) {
    pass = pass.concat(items);
    track.innerHTML = buildPass(pass);
  }

  const html = buildPass(pass);
  track.innerHTML = html + "  <span class='ticker-sep'>|</span>  " + html;
}

// ---------- GAME SELECTOR TABS ----------

let activeGameId = null;

function buildFilters() {
  if (activeGameId === null) activeGameId = getDefaultGame().id;

  const container = document.getElementById("phase-filters");
  container.innerHTML = GAMES.map((g, i) => {
    const isActive = g.id === activeGameId;
    const [y, m, d] = g.date.split("-");
    const dateShort = `${d}/${m}`;
    return `<button class="filter-btn ${isActive ? "active" : ""}" data-game="${g.id}">
      <span class="filter-btn-flags">${g.homeTeam.flag} vs ${g.awayTeam.flag}</span>
      <span class="filter-btn-meta">Jogo ${i + 1} · ${dateShort}</span>
    </button>`;
  }).join("");

  container.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      activeGameId = btn.dataset.game;
      buildFilters();
      buildGames();
    });
  });
}

// ---------- TOTAL ARRECADADO ----------

// Conta e-mails únicos na planilha de participantes e exibe o total
// arrecadado (cada e-mail = 1 pessoa = R$ 20,00).
function buildStatsBox() {
  const box = document.getElementById("stats-box");
  if (!box) return;

  const game = GAMES.find(g => g.id === activeGameId) || getActiveGame();
  if (!game) return;

  const [y, m, d] = game.date.split("-");
  const dateShort = `${d}/${m}`;

  const total = game.totalPrize != null
    ? game.totalPrize
    : (CACHED_BETS_COUNT[game.id] != null ? CACHED_BETS_COUNT[game.id] * BET_VALUE_PER_PERSON : null);

  if (total === null) {
    box.innerHTML = `<div class="stats-loading">⏳ Calculando prêmio...</div>`;
    return;
  }

  const count = game.totalPrize != null
    ? Math.round(game.totalPrize / BET_VALUE_PER_PERSON)
    : (CACHED_BETS_COUNT[game.id] ?? 0);

  const totalStr = `R$ ${total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

  box.innerHTML = `
    <div class="stats-value">💰 ${totalStr} arrecadados</div>
    <div class="stats-detail">${count} ${count === 1 ? "participante" : "participantes"} · Bolão de ${dateShort}</div>
  `;
}

// ---------- BETS TABLE ----------

// ---------- BUSCAR APOSTAS DO CSV ----------

async function fetchBetRows(game) {
  const text = await fetchCSV(game.csvUrl);
  const rows = parseCSV(text);
  const keys = Object.keys(rows[0] || {});
  return rows.map(row => ({
    email:    (row["Endereço de e-mail"] || row["Email"] || row[keys[1]] || "").trim().toLowerCase(),
    nome:     row["Nome :"] || row["Nome"] || row[keys[2]] || "—",
    golsCasa: parseInt(row["Numero de gols do Brasil"] || row[keys[3]]),
    golsFora: parseInt(row["Numero de gols do Marrocos"] || row[keys[4]]),
  }));
}

// Palpite do usuário logado por jogo. game.id → {golsCasa, golsFora} | null
let CACHED_MY_BETS = {};
// Contagem de apostas por jogo (para calcular prêmio dinâmico). game.id → number
let CACHED_BETS_COUNT = {};

// Busca as apostas do jogo e atualiza a contagem (total arrecadado) + o meu
// palpite. SEM cache-guard: pode ser chamada repetidamente para manter o total
// arrecadado sempre ao vivo, independente do status do jogo.
async function refreshGameBets(game) {
  if (!game.csvUrl) {
    renderMyBet();
    renderGamePrize(game);
    return;
  }
  try {
    const bets = await fetchBetRows(game);
    const userEmail = CURRENT_USER?.email?.trim().toLowerCase();
    const mine = bets.find(b => b.email === userEmail) || null;
    CACHED_MY_BETS[game.id] = mine ? { golsCasa: mine.golsCasa, golsFora: mine.golsFora } : null;
    CACHED_BETS_COUNT[game.id] = bets.length;
  } catch {
    if (CACHED_MY_BETS[game.id] === undefined) CACHED_MY_BETS[game.id] = null;
  }
  renderMyBet();
  renderGamePrize(game);
}

// Usado na renderização: se já temos em cache, só repinta (rápido); senão busca.
async function loadMyBet(game) {
  if (!game.csvUrl || CACHED_MY_BETS[game.id] !== undefined) {
    renderMyBet();
    renderGamePrize(game);
    return;
  }
  await refreshGameBets(game);
}

// Mantém o TOTAL ARRECADADO atualizado o tempo todo (mesmo antes do jogo
// começar), re-buscando as apostas do jogo selecionado periodicamente.
function refreshArrecadado() {
  const game = GAMES.find(g => g.id === activeGameId);
  if (game && game.csvUrl && game.totalPrize == null) refreshGameBets(game);
}

function renderGamePrize(game) {
  const el = document.getElementById(`prize-info-${game.id}`);
  if (!el) return;
  const [y, m, d] = game.date.split("-");
  const dateShort = `${d}/${m}`;
  const total = game.totalPrize != null
    ? game.totalPrize
    : (CACHED_BETS_COUNT[game.id] != null ? CACHED_BETS_COUNT[game.id] * BET_VALUE_PER_PERSON : null);
  if (total === null) return;
  const totalStr = `R$ ${total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
  el.textContent = `💰 ${totalStr} arrecadados para o Bolão de ${dateShort}`;
  buildStatsBox();
}

function renderMyBet() {
  const el = document.getElementById("my-bet-badge");
  if (!el) return;
  const game = GAMES.find(g => g.id === activeGameId);
  if (!game) { el.style.display = "none"; return; }
  const bet = CACHED_MY_BETS[game.id];
  if (!bet || isNaN(bet.golsCasa) || isNaN(bet.golsFora)) {
    el.style.display = "none";
    return;
  }
  el.textContent = `${game.homeTeam.flag} ${bet.golsCasa} × ${bet.golsFora} ${game.awayTeam.flag}`;
  el.style.display = "";
}

// ---------- BLOCO DE PRÊMIO DINÂMICO ----------

function buildPrizeBlockHtml(winners, betsCount, game) {
  // Jogos legados com totalPrize fixo usam esse valor; demais calculam pelo
  // próprio CSV de apostas do jogo (uma linha = um participante).
  const total = (game && game.totalPrize != null)
    ? game.totalPrize
    : betsCount * BET_VALUE_PER_PERSON;

  if (winners.length === 0) {
    return `<div class="prize-block no-winners">
      <span class="prize-block-label">😬 Ninguém acertou o placar — prêmio acumula!</span>
    </div>`;
  }

  const totalStr = `R$ ${total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
  const perWinnerStr = `R$ ${(total / winners.length).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

  const chips = winners.map(n => `<span class="prize-winner-chip">🏅 ${n}</span>`).join("");
  const divisao = winners.length > 1
    ? `<span class="prize-divisao">${totalStr} ÷ ${winners.length} = ${perWinnerStr} cada</span>`
    : `<span class="prize-divisao">${totalStr} para o ganhador</span>`;

  return `<div class="prize-block has-winners">
    <div class="prize-block-top">
      <span class="prize-block-label">🏆 ${winners.length === 1 ? "Ganhador" : `${winners.length} Ganhadores`}</span>
      ${divisao}
    </div>
    <div class="prize-winner-chips">${chips}</div>
  </div>`;
}

function refreshPrizeBlock(gameId, { winners, betsCount }) {
  const el = document.getElementById(`prize-block-${gameId}`);
  const game = GAMES.find(g => g.id === gameId);
  if (el) el.innerHTML = buildPrizeBlockHtml(winners, betsCount, game);
}

// ---------- RENDERIZA TABELA DE APOSTAS ----------

async function loadBets(game) {
  const section = document.getElementById(`bets-${game.id}`);
  if (!section) return;

  section.innerHTML = `<div class="bets-loading">⏳ Carregando apostas...</div>`;

  try {
    const bets = await fetchBetRows(game);

    if (bets.length === 0) {
      section.innerHTML = `<div class="bets-empty">Nenhuma aposta registrada ainda.</div>`;
      return;
    }

    renderBetsTable(section, game, bets);
  } catch (err) {
    section.innerHTML = `<div class="bets-error">⚠️ Não foi possível carregar as apostas. Tente novamente.</div>`;
    console.error(err);
  }
}

function renderBetsTable(section, game, bets) {
  const result = resolveResult(game);
  const hasResult = result !== null;
  let winners = [];

  const rowsHtml = bets.map(bet => {
    let acertoHtml = "";
    if (hasResult) {
      const ok = bet.golsCasa === result.home && bet.golsFora === result.away;
      if (ok) {
        winners.push(bet.nome);
        acertoHtml = `<span class="bet-hit">✅ Acertou!</span>`;
      } else {
        acertoHtml = `<span class="bet-miss">❌</span>`;
      }
    }
    return `
      <tr>
        <td class="bet-name">${bet.nome}</td>
        <td class="bet-score">${game.homeTeam.flag} ${bet.golsCasa} × ${bet.golsFora} ${game.awayTeam.flag}</td>
        ${hasResult ? `<td>${acertoHtml}</td>` : ""}
      </tr>`;
  }).join("");

  CACHED_BETS_WINNERS[game.id] = hasResult ? { winners, betsCount: bets.length } : null;

  const prizeBlockHtml = hasResult
    ? `<div id="prize-block-${game.id}">${buildPrizeBlockHtml(winners, bets.length, game)}</div>`
    : "";

  // Botão "Ver ganhadores" só aparece quando não há resultado definitivo
  const winnerBtnHtml = (!hasResult && game.csvUrl)
    ? `<button class="btn-check-winners" data-game="${game.id}">
        🏆 Ver ganhadores agora
       </button>
       <div class="winners-result" id="winners-${game.id}"></div>`
    : `<div class="winners-result" id="winners-${game.id}"></div>`;

  section.innerHTML = `
    ${prizeBlockHtml}
    ${winnerBtnHtml}
    <div class="bets-table-wrap">
      <table class="bets-table">
        <thead>
          <tr>
            <th>Participante</th>
            <th>Palpite</th>
            ${hasResult ? "<th>Resultado</th>" : ""}
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;

  // Bind do botão
  const btn = section.querySelector(".btn-check-winners");
  if (btn) btn.addEventListener("click", () => checkWinnersNow(game));
}

// ---------- VERIFICAR GANHADORES AO VIVO ----------

async function checkWinnersNow(game) {
  const resultEl = document.getElementById(`winners-${game.id}`);
  const btn = document.querySelector(`[data-game="${game.id}"].btn-check-winners`);

  if (!resultEl) return;

  // Pede o placar atual via prompt simples
  const input = prompt(
    `Qual o placar ATUAL?\n${game.homeTeam.flag} ${game.homeTeam.name} × ${game.awayTeam.name} ${game.awayTeam.flag}\n\nDigite no formato:  2-1`
  );

  if (!input) return;

  const match = input.trim().match(/^(\d+)\s*[-x×]\s*(\d+)$/i);
  if (!match) {
    resultEl.innerHTML = `<div class="winners-error">⚠️ Formato inválido. Use algo como: 2-1</div>`;
    return;
  }

  const currentHome = parseInt(match[1]);
  const currentAway = parseInt(match[2]);

  resultEl.innerHTML = `<div class="bets-loading">⏳ Varrendo apostas...</div>`;
  if (btn) { btn.disabled = true; btn.textContent = "Verificando..."; }

  try {
    const bets = await fetchBetRows(game);
    const winners = bets.filter(b => b.golsCasa === currentHome && b.golsFora === currentAway);

    if (winners.length === 0) {
      resultEl.innerHTML = `
        <div class="winners-box no-winners">
          <div class="winners-score">Placar consultado: ${game.homeTeam.flag} ${currentHome} × ${currentAway} ${game.awayTeam.flag}</div>
          <div class="winners-names">😬 Ninguém apostou neste placar ainda.</div>
        </div>`;
    } else {
      const nomes = winners.map(w => `<span class="winner-name">🏅 ${w.nome}</span>`).join("");
      resultEl.innerHTML = `
        <div class="winners-box has-winners">
          <div class="winners-score">Placar: ${game.homeTeam.flag} ${currentHome} × ${currentAway} ${game.awayTeam.flag}</div>
          <div class="winners-label">${winners.length === 1 ? "Ganhador" : "Ganhadores"}:</div>
          <div class="winners-names">${nomes}</div>
        </div>`;
    }
  } catch (err) {
    resultEl.innerHTML = `<div class="winners-error">⚠️ Erro ao buscar apostas. Tente novamente.</div>`;
    console.error(err);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "🏆 Ver ganhadores agora"; }
  }
}

// ---------- GAMES ----------

function buildGames() {
  const section = document.getElementById("games-section");
  if (activeGameId === null) activeGameId = getDefaultGame().id;
  const filtered = GAMES.filter(g => g.id === activeGameId);

  const isAdmin = CURRENT_USER && CURRENT_USER.email &&
    CURRENT_USER.email.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase();
  updateAdminPanel(isAdmin);

  if (filtered.length === 0) {
    section.innerHTML = `<div class="empty-state">Nenhum jogo encontrado.</div>`;
    return;
  }

  const showBets = (g) => {
    const s = resolveStatus(g);
    return s === "closed" || s === "finished";
  };

  section.innerHTML = filtered.map(game => {
    const status = resolveStatus(game);
    const { text, cls } = statusLabel(status);
    const result = resolveResult(game);
    const resultHtml = result
      ? `<div class="game-result">${result.home} <span class="result-x">×</span> ${result.away}</div>`
      : `<div class="game-result pending">? <span class="result-x">×</span> ?</div>`;

    const betsBlock = showBets(game) && game.csvUrl
      ? `<div class="bets-section" id="bets-${game.id}"><div class="bets-loading">⏳ Carregando apostas...</div></div>`
      : `<div class="bets-locked">🔒 Apostas visíveis após o encerramento</div>`;

    return `
      <div class="game-card" data-id="${game.id}">
        <div class="game-card-header">
          <span class="badge ${cls}">${text}</span>
          <span class="game-phase-label">${game.phase}</span>
        </div>
        <div class="game-matchup">
          <div class="team">
            <span class="team-flag">${game.homeTeam.flag}</span>
            <span class="team-name">${game.homeTeam.name}</span>
          </div>
          ${resultHtml}
          <div class="team">
            <span class="team-flag">${game.awayTeam.flag}</span>
            <span class="team-name">${game.awayTeam.name}</span>
          </div>
        </div>
        <div class="game-meta">
          <span>📅 ${formatDate(game.date)} às ${game.time}</span>
          <span>📍 ${game.venue}</span>
        </div>
        <div class="game-prize" id="prize-info-${game.id}">${(() => {
          if (game.totalPrize != null) {
            const [y, m, d] = game.date.split("-");
            return `💰 R$ ${game.totalPrize.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} arrecadados para o Bolão de ${d}/${m}`;
          }
          return `💰 ${game.prizeInfo}`;
        })()}</div>
        <div class="game-deadline">⏰ Apostas até: <strong>${formatDeadline(game.betDeadline)}</strong></div>
        ${renderCountdowns(game)}
        ${betsBlock}
      </div>`;
  }).join("");

  // Sincroniza o status renderizado de TODOS os jogos (não só os filtrados),
  // para a checagem de transição não disparar rebuilds desnecessários.
  GAMES.forEach(g => { lastRenderedStatuses[g.id] = resolveStatus(g); });

  filtered.forEach(game => {
    if (showBets(game) && game.csvUrl) loadBets(game);
    if (game.csvUrl) loadMyBet(game);
  });

  tickCountdowns(); // preenche os cronômetros imediatamente após renderizar
}

// Markup dos dois cronômetros regressivos (apostas e início da partida).
function renderCountdowns(game) {
  const betEpoch = recifeEpoch(game.betDeadline);
  const matchEpoch = kickoffEpoch(game);
  const rows = [];
  if (!isNaN(betEpoch)) {
    rows.push(`
      <div class="countdown-row">
        <span class="countdown-label">⏳ Apostas fecham em</span>
        <span class="countdown" data-target="${betEpoch}" data-done="Apostas encerradas">--:--:--</span>
      </div>`);
  }
  if (!isNaN(matchEpoch)) {
    rows.push(`
      <div class="countdown-row">
        <span class="countdown-label">🏟️ Partida começa em</span>
        <span class="countdown" data-target="${matchEpoch}" data-done="Bola rolando">--:--:--</span>
      </div>`);
  }
  if (rows.length === 0) return "";
  return `<div class="game-countdowns">${rows.join("")}</div>`;
}

// Painel do organizador — override global de status, visível só para o
// admin logado. Para os demais participantes fica vazio (escondido via CSS).
function updateAdminPanel(isAdmin) {
  const panel = document.getElementById("admin-panel");
  if (!panel) return;

  if (!isAdmin) {
    panel.innerHTML = "";
    return;
  }

  const activeVal = GLOBAL_STATUS_OVERRIDE || "auto";
  const opts = [
    { v: "upcoming", label: "Em breve" },
    { v: "open",     label: "Abertas" },
    { v: "closed",   label: "Fechadas" },
    { v: "finished", label: "Encerrado" },
    { v: "auto",     label: "Auto" },
  ];
  const btns = opts.map(o =>
    `<button class="admin-status-btn ${o.v === activeVal ? "active" : ""}" data-set="${o.v}">${o.label}</button>`
  ).join("");

  panel.innerHTML = `
    <div class="admin-panel-inner">
      <span class="admin-label">⚙️ Organizador · status do bolão (${GLOBAL_STATUS_OVERRIDE ? "manual" : "automático"})</span>
      <div class="admin-status-btns">${btns}</div>
    </div>`;

  panel.querySelectorAll(".admin-status-btn").forEach(btn => {
    btn.addEventListener("click", () => setGlobalStatus(btn.dataset.set));
  });
}

// ---------- LOGIN ----------

// Aceita qualquer e-mail com formato válido (evita números soltos, "asd",
// "teste123" etc. sendo digitados no campo de login).
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/i;

function setLoginLoading(loading) {
  const btn = document.getElementById("login-btn");
  btn.disabled = loading;
  btn.textContent = loading ? "Verificando..." : "Entrar no Bolão";
}

async function doLogin() {
  const input = document.getElementById("email-input");
  const error = document.getElementById("email-error");
  const email = input.value.trim();

  error.textContent = "";

  if (!email) {
    error.textContent = "Digite seu e-mail.";
    input.focus();
    return;
  }

  if (!EMAIL_REGEX.test(email)) {
    error.textContent = "Digite um e-mail válido (ex: nome@exemplo.com).";
    input.classList.add("input-shake");
    setTimeout(() => input.classList.remove("input-shake"), 500);
    input.focus();
    return;
  }

  setLoginLoading(true);

  try {
    const result = await validateEmailInSheet(email);

    if (!result.valid) {
      const registerBtn = document.getElementById("register-btn");
      const hasForm = registerBtn && registerBtn.style.display !== "none";
      error.innerHTML = hasForm
        ? `E-mail não encontrado. Se ainda não fez sua aposta, clique em <strong>"Fazer minha aposta"</strong> abaixo para participar e ter acesso.`
        : `E-mail não encontrado. Verifique se você se inscreveu e o pagamento foi confirmado.`;
      input.classList.add("input-shake");
      setTimeout(() => input.classList.remove("input-shake"), 500);
      return;
    }

    sessionStorage.setItem(STORAGE_KEY, email);
    sessionStorage.setItem(STORAGE_NAME, result.name);
    enterApp({ email, name: result.name });

  } catch (err) {
    error.textContent = "Erro de conexão ao verificar e-mail. Tente novamente.";
    console.error("Erro no login:", err);
  } finally {
    setLoginLoading(false);
  }
}

async function enterApp(participant) {
  CURRENT_USER = participant;
  document.getElementById("login-screen").classList.remove("active");
  document.getElementById("app-screen").classList.add("active");
  document.getElementById("user-badge").textContent = `👤 ${participant.name}`;
  buildTicker();
  buildFilters();
  buildGames();
  buildStatsBox();
  startClocks();

  // Carrega os overrides compartilhados e re-renderiza já com eles aplicados.
  await refreshOverrides();
  buildGames();
  buildTicker();

  // Busca o placar ao vivo da ESPN (re-renderiza sozinho quando chega).
  refreshLiveScores();
}

function doLogout() {
  CURRENT_USER = null;
  sessionStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_NAME);
  document.getElementById("app-screen").classList.remove("active");
  document.getElementById("login-screen").classList.add("active");
  document.getElementById("email-input").value = "";
  document.getElementById("email-error").textContent = "";
}

// ---------- PIX COPIA E COLA (BR Code do Banco Central, client-side) ----------

// Monta um campo no formato EMV/TLV: id(2) + tamanho(2) + valor.
function pixTLV(id, value) {
  return id + String(value.length).padStart(2, "0") + value;
}

// CRC16-CCITT (polinômio 0x1021, init 0xFFFF) exigido no fim do BR Code.
function pixCRC16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

// Gera o código "copia e cola" do PIX (estático, com valor fixo).
function gerarPixCopiaECola({ chave, nome, cidade, valor }) {
  const merchant = pixTLV("26", pixTLV("00", "br.gov.bcb.pix") + pixTLV("01", chave));
  const payload =
    pixTLV("00", "01") +              // formato do payload
    merchant +                        // conta do recebedor (GUI + chave)
    pixTLV("52", "0000") +            // categoria do estabelecimento (não usada)
    pixTLV("53", "986") +             // moeda: BRL
    (valor ? pixTLV("54", valor) : "") +
    pixTLV("58", "BR") +              // país
    pixTLV("59", nome) +              // nome do recebedor
    pixTLV("60", cidade) +            // cidade do recebedor
    pixTLV("62", pixTLV("05", "***")) + // txid (estático)
    "6304";                           // id+tamanho do CRC (valor calculado abaixo)
  return payload + pixCRC16(payload);
}

// Código gerado uma vez (config fixa em data.js).
const PIX_COPIA_COLA = gerarPixCopiaECola(PIX_CONFIG);

// Liga os botões de PIX (login e arrecadação): revela o código e copia.
function setupPix() {
  document.querySelectorAll(".pix-code").forEach(el => { el.textContent = PIX_COPIA_COLA; });

  [["pix-btn-login", "pix-box-login"], ["pix-btn-stats", "pix-box-stats"]].forEach(([btnId, boxId]) => {
    const btn = document.getElementById(btnId);
    const box = document.getElementById(boxId);
    if (btn && box) {
      btn.addEventListener("click", () => {
        box.style.display = box.style.display === "none" ? "" : "none";
      });
    }
  });

  document.querySelectorAll(".btn-pix-copy").forEach(btn => {
    btn.addEventListener("click", async () => {
      const original = btn.textContent;
      try {
        await navigator.clipboard.writeText(PIX_COPIA_COLA);
        btn.textContent = "✅ Copiado!";
      } catch {
        btn.textContent = "Selecione e copie o código acima";
      }
      setTimeout(() => { btn.textContent = original; }, 2200);
    });
  });
}

// ---------- INIT ----------

document.addEventListener("DOMContentLoaded", () => {
  setupPix();
  const savedEmail = sessionStorage.getItem(STORAGE_KEY);
  const savedName  = sessionStorage.getItem(STORAGE_NAME);
  if (savedEmail && savedName) {
    enterApp({ email: savedEmail, name: savedName });
  }

  // Botão de registro: primeiro jogo com formUrl e apostas abertas
  const registerBtn = document.getElementById("register-btn");
  const openGame = GAMES.find(g => g.formUrl && autoStatus(g) === "open");
  if (openGame) {
    registerBtn.href = openGame.formUrl;
    registerBtn.style.display = "";
  }

  document.getElementById("login-btn").addEventListener("click", doLogin);
  document.getElementById("logout-btn").addEventListener("click", doLogout);
  document.getElementById("email-input").addEventListener("keydown", e => {
    if (e.key === "Enter") doLogin();
  });
});