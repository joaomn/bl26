// ============================================================
//  DATA.JS — Edite aqui para cada novo jogo
//  NÃO precisa mais adicionar participantes aqui!
//  O login agora valida direto na planilha publicada.
// ============================================================

// ------------------------------------------------------------------
// PLANILHA MESTRE DE PARTICIPANTES
// URL do CSV publicado (Arquivo → Publicar na web → CSV)
// O login busca a coluna de e-mail desta planilha ao vivo.
// Coluna B (índice 1) = e-mails dos inscritos
// Coluna C (índice 2) = nomes
// ------------------------------------------------------------------
const PARTICIPANTS_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQX-yNRzhISzZXr5lWGLfqjj37pCYqSq5KMRArLRrKG04xdjQaBw1EyLXRnDlykvCKiX2LNhjIkA9_O/pub?output=csv";

// E-mail do organizador — sempre tem acesso
const ADMIN_EMAIL = "joaoaraujomn@gmail.com";

// ------------------------------------------------------------------
// OVERRIDE DE STATUS E PLACAR COMPARTILHADOS (sem deploy)
//
// O status e o placar do "jogo ativo" podem ser atualizados ao vivo — e a
// mudança vale para TODOS os participantes — editando células da planilha,
// sem mexer no código.
//
// O "jogo ativo" é detectado automaticamente: é o jogo já iniciado mais
// recentemente (kickoff <= agora) ou, se nenhum jogo começou ainda, o
// próximo da lista a começar. Os demais jogos NÃO são afetados por esse
// override — continuam com seu próprio status/placar ("? × ?" até terem
// um result no data.js).
//
// Como funciona:
//   • LEITURA  → aba "Status" da planilha, publicada como CSV.
//                Célula A1 = status (vazia = automático).
//                Valores aceitos: upcoming | open | closed | finished
//                (ou em português: "em breve" | "aberto" | "fechado" | "encerrado")
//                Célula C1 = gols do time da casa (Brasil)
//                Célula D1 = gols do time visitante
//                (C1/D1 vazias = placar ainda pendente "? × ?")
//   • ESCRITA  → opcional: Google Apps Script publicado como "App da Web",
//                que os botões do organizador no site usam para gravar
//                o status na célula A1. Sem essa configuração, os botões
//                gravam só em localStorage (no navegador do organizador).
//
// Você também pode simplesmente editar as células A1/C1/D1 direto pelo app
// do Google Sheets, de qualquer lugar — o site relê a cada 2 minutos.
//
// Passo a passo de configuração está no README (seção "Override de status").
// ------------------------------------------------------------------

// CSV publicado da aba "Status" (Arquivo → Publicar na web → aba Status → CSV)
const STATUS_CONFIG_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQX-yNRzhISzZXr5lWGLfqjj37pCYqSq5KMRArLRrKG04xdjQaBw1EyLXRnDlykvCKiX2LNhjIkA9_O/pub?gid=362647876&single=true&output=csv";

// URL do Apps Script publicado como App da Web (termina em /exec) — opcional
const STATUS_WRITE_URL = "";

// ------------------------------------------------------------------
// JOGOS DO BOLÃO
// Para cada novo jogo:
//   1. Publique a aba correspondente no Sheets como CSV
//      (Arquivo → Publicar na web → escolha a aba → CSV)
//   2. Cole a URL em csvUrl abaixo
//
// Colunas esperadas no CSV de apostas:
//   A = Carimbo de data/hora
//   B = E-mail
//   C = Nome
//   D = Gols time da casa (Brasil)
//   E = Gols time visitante
//   F = Ciente do regulamento
//
// status: "upcoming" | "open" | "closed" | "finished"
//
// Datas/horas (date+time, betDeadline, finishAt) são interpretadas no
// fuso de Recife (UTC-3, sem horário de verão). O status efetivo é
// resolvido em tempo real, nesta ordem de prioridade:
//   1. Override do organizador (aba "Status" da planilha) — vence tudo
//   2. Tempo: agora ≥ finishAt → "finished"; agora ≥ betDeadline → "closed"
//   3. O campo "status" abaixo (base/padrão)
// ------------------------------------------------------------------
const GAMES = [
  {
    id: "jogo1",
    phase: "Fase de Grupos",
    phaseTag: "grupos",
    homeTeam: { name: "Brasil",   flag: "🇧🇷" },
    awayTeam: { name: "Marrocos", flag: "🇲🇦" },
    date: "2026-06-13",
    time: "19:00",
    venue: "MetLife Stadium, Nova Jersey",
    status: "open",           // "upcoming" antes do prazo, "open" durante o período de apostas, "closed" após o prazo, "finished" depois do jogo
    result: { home: 1, away: 1 },             // { home: 2, away: 1 } quando terminar
    csvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRoeT2lNWxbabBUhx8sB-oDBnh3f-wkxUucmwp7fSDbOvsL2FHawgY6RVXUCMgNavaqT8wlbSR__4TV/pub?output=csv",
    formUrl: "",
    betDeadline: "2026-06-13T18:59:00",  // horário de Recife
    finishAt: "2026-06-13T19:00:00",     // horário de Recife: vira "finished" às 19h
    prizeInfo: "R$ 20,00 por participante · Acumula se ninguém acertar",
    totalPrize: 200,  // fixo: total arrecadado neste jogo (preencher após encerramento)
  },
   {
    id: "jogo2",
    phase: "Fase de Grupos",
    phaseTag: "grupos",
    homeTeam: { name: "Brasil",   flag: "🇧🇷" },
    awayTeam: { name: "Haiti", flag: "🇭🇹" },
    date: "2026-06-19",
    time: "21:30",
    venue: "Estádio da Filadélfia, Filadélfia",
    status: "open",           // "upcoming" antes do prazo, "open" durante o período de apostas, "closed" após o prazo, "finished" depois do jogo
    result: null,             // { home: 2, away: 1 } quando terminar
    csvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQX-yNRzhISzZXr5lWGLfqjj37pCYqSq5KMRArLRrKG04xdjQaBw1EyLXRnDlykvCKiX2LNhjIkA9_O/pub?output=csv",
    formUrl: "https://forms.gle/YHQvHJqi6Z9thpR98",
    betDeadline: "2026-06-19T21:29:00",  // horário de Recife
    finishAt: "2026-06-19T21:30:00",     // horário de Recife: vira "finished" às 19h
    prizeInfo: "R$ 20,00 por participante · Acumula se ninguém acertar",
  },{
    id: "jogo3",
    phase: "Fase de Grupos",
    phaseTag: "grupos",
    homeTeam: { name: "Brasil",   flag: "🇧🇷" },
    awayTeam: { name: "Escócia", flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿" },
    date: "2026-06-24",
    time: "19:00",
    venue: "Estádio da Miami, Miami Gardens",
    status: "upcoming",           // "upcoming" antes do prazo, "open" durante o período de apostas, "closed" após o prazo, "finished" depois do jogo
    result: null,             // { home: 2, away: 1 } quando terminar
    csvUrl: "",
    formUrl: "",
    betDeadline: "2026-06-24T18:59:00",  // horário de Recife
    finishAt: "2026-06-24T19:00:00",     // horário de Recife: vira "finished" às 19h
    prizeInfo: "R$ 20,00 por participante · Acumula se ninguém acertar",
  },

  // ------------------------------------------------------------------
  // MODELO PARA PRÓXIMOS JOGOS — copie e edite:
  // ------------------------------------------------------------------
  // {
  //   id: "jogo2",
  //   phase: "Fase de Grupos",
  //   phaseTag: "grupos",
  //   homeTeam: { name: "Brasil",  flag: "🇧🇷" },
  //   awayTeam: { name: "Espanha", flag: "🇪🇸" },
  //   date: "2026-06-22",
  //   time: "15:00",
  //   venue: "SoFi Stadium, Los Angeles",
  //   status: "upcoming",
  //   result: null,
  //   csvUrl: null,   // cole aqui o CSV da aba deste jogo quando publicar
  //   betDeadline: "2026-06-22T14:59:00",  // horário de Recife
  //   finishAt: "2026-06-22T17:00:00",     // horário de Recife: quando vira "finished"
  //   prizeInfo: "R$ 20,00 por participante · Acumula se ninguém acertar",
  // },
];