// ============================================================
//  APP.JS — Lógica da aplicação
//  Login valida contra CSV publicado do Google Sheets
// ============================================================

const STORAGE_KEY = "bolao_user_email";
const STORAGE_NAME = "bolao_user_name";
const OVERRIDE_LOCAL_KEY = "bolao_status_override";

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

// Status efetivo da última renderização — usado para detectar transições
// e re-renderizar só quando algo realmente muda.
let lastRenderedStatuses = {};

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

// Status efetivo do jogo: override global do organizador vence; senão, o tempo.
function resolveStatus(game) {
  if (GLOBAL_STATUS_OVERRIDE) return GLOBAL_STATUS_OVERRIDE;
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

// Placar efetivo do jogo: usa o "result" fixo do data.js se existir; senão,
// cai no override lido das células C1/D1 da aba "Status" (ou null = pendente).
function resolveResult(game) {
  return game.result || GLOBAL_RESULT_OVERRIDE || null;
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
  if (!STATUS_CONFIG_CSV_URL) {
    GLOBAL_STATUS_OVERRIDE = loadLocalOverride();
    return;
  }
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
  setInterval(refreshOverrides, 120000); // re-fetch compartilhado a cada 2 min
}

// ---------- TICKER ----------

function buildTicker() {
  const track = document.getElementById("ticker-track");
  const items = GAMES.map(g => {
    const result = resolveResult(g);
    return result
      ? `${g.homeTeam.flag} ${g.homeTeam.name} ${result.home} × ${result.away} ${g.awayTeam.name} ${g.awayTeam.flag}`
      : `${g.homeTeam.flag} ${g.homeTeam.name} × ${g.awayTeam.name} ${g.awayTeam.flag} — ${formatDate(g.date)}`;
  });
  const html = items.map(i => `<span class="ticker-item">${i}</span>`).join("  <span class='ticker-sep'>|</span>  ");
  track.innerHTML = html + "  <span class='ticker-sep'>|</span>  " + html;
}

// ---------- PHASE FILTERS ----------

let activePhase = "all";

function buildFilters() {
  const container = document.getElementById("phase-filters");
  const phases = ["all", ...new Set(GAMES.map(g => g.phaseTag))];
  const labels = { all: "Todos" };
  GAMES.forEach(g => { labels[g.phaseTag] = g.phase; });

  container.innerHTML = phases.map(ph =>
    `<button class="filter-btn ${ph === activePhase ? "active" : ""}" data-phase="${ph}">${labels[ph]}</button>`
  ).join("");

  container.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      activePhase = btn.dataset.phase;
      buildFilters();
      buildGames();
    });
  });
}

// ---------- BETS TABLE ----------

// ---------- BUSCAR APOSTAS DO CSV ----------

async function fetchBetRows(game) {
  const text = await fetchCSV(game.csvUrl);
  const rows = parseCSV(text);
  const keys = Object.keys(rows[0] || {});
  return rows.map(row => ({
    nome:     row["Nome :"] || row["Nome"] || row[keys[2]] || "—",
    golsCasa: parseInt(row["Numero de gols do Brasil"] || row[keys[3]]),
    golsFora: parseInt(row["Numero de gols do Marrocos"] || row[keys[4]]),
  }));
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

  const summaryHtml = hasResult
    ? `<div class="bets-summary ${winners.length === 0 ? "no-winners" : "has-winners"}">
        ${winners.length === 0
          ? "😬 Ninguém acertou o placar — prêmio acumula!"
          : `🎉 ${winners.length === 1 ? "Ganhador" : "Ganhadores"}: <strong>${winners.join(", ")}</strong>`}
       </div>`
    : "";

  // Botão "Ver ganhadores" só aparece quando há resultado configurado no data.js
  // e o prazo já passou — permite varrer ao vivo durante o jogo
  const winnerBtnHtml = game.csvUrl
    ? `<button class="btn-check-winners" data-game="${game.id}">
        🏆 Ver ganhadores agora
       </button>
       <div class="winners-result" id="winners-${game.id}"></div>`
    : "";

  section.innerHTML = `
    ${summaryHtml}
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
  const filtered = activePhase === "all"
    ? GAMES
    : GAMES.filter(g => g.phaseTag === activePhase);

  const isAdmin = CURRENT_USER && CURRENT_USER.email &&
    CURRENT_USER.email.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase();
  updateAdminPanel(isAdmin);

  if (filtered.length === 0) {
    section.innerHTML = `<div class="empty-state">Nenhum jogo nesta fase ainda.</div>`;
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
        <div class="game-prize">💰 ${game.prizeInfo}</div>
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

// Só aceita e-mails terminados em @gmail.com (evita números soltos, "asd",
// "teste123" etc. sendo digitados no campo de login).
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@gmail\.com$/i;

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
    error.textContent = "Digite um e-mail válido do Gmail (ex: nome@gmail.com).";
    input.classList.add("input-shake");
    setTimeout(() => input.classList.remove("input-shake"), 500);
    input.focus();
    return;
  }

  setLoginLoading(true);

  try {
    const result = await validateEmailInSheet(email);

    if (!result.valid) {
      error.textContent = "E-mail não encontrado. Verifique se você se inscreveu e o pagamento foi confirmado.";
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
  startClocks();

  // Carrega os overrides compartilhados e re-renderiza já com eles aplicados.
  await refreshOverrides();
  buildGames();
  buildTicker();
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

// ---------- INIT ----------

document.addEventListener("DOMContentLoaded", () => {
  const savedEmail = sessionStorage.getItem(STORAGE_KEY);
  const savedName  = sessionStorage.getItem(STORAGE_NAME);
  if (savedEmail && savedName) {
    enterApp({ email: savedEmail, name: savedName });
  }

  document.getElementById("login-btn").addEventListener("click", doLogin);
  document.getElementById("logout-btn").addEventListener("click", doLogout);
  document.getElementById("email-input").addEventListener("keydown", e => {
    if (e.key === "Enter") doLogin();
  });
});