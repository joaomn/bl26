# SPEC — Bolão.Cup

Site estático de bolão da Copa do Mundo 2026, hospedado no Vercel. Acesso restrito por e-mail validado ao vivo contra uma planilha do Google Sheets publicada como CSV.

---

## Estrutura de arquivos

```
bolao/
├── index.html   # Estrutura HTML (telas de login e app)
├── style.css    # Estilos (tema Copa: verde/amarelo/azul escuro)
├── data.js      # Configuração dos jogos e URLs dos CSVs
└── app.js       # Toda a lógica: login, fetch CSV, render
```

Sem bundler, sem framework, sem build step. HTML/CSS/JS puro.

---

## Fluxo da aplicação

### Login
1. Usuário digita o e-mail
2. `doLogin()` chama `validateEmailInSheet(email)`
3. `validateEmailInSheet` faz `fetchCSV(PARTICIPANTS_CSV_URL)` → parseia → procura o e-mail na coluna B (`Endereço de e-mail`)
4. Se encontrado → salva em `sessionStorage` (`bolao_user_email`, `bolao_user_name`) → chama `enterApp()`
5. Se não encontrado → exibe erro e animação de shake no input
6. Admin (`joaoaraujomn@gmail.com`) entra diretamente sem checar a planilha

### Tela principal
- Header com logo + badge do usuário logado + botão de sair
- Ticker animado (CSS) com os jogos da lista `GAMES`
- Filtros de fase gerados dinamicamente a partir dos `phaseTag` únicos em `GAMES`
- Grid de cards de jogos — um card por entrada em `GAMES`

### Card de jogo
- Badge de status: `upcoming` / `open` / `closed` / `finished`
- Placar: `? × ?` enquanto `result === null`, ou `N × N` quando preenchido
- Informações: data, horário, local, prêmio, prazo de aposta
- Seção de apostas: **visível apenas se `betDeadline` já passou OU `status` é `closed`/`finished`**
  - Busca o CSV de apostas via `loadBets(game)`
  - Renderiza tabela com: Nome | Palpite | ✅/❌ (se resultado disponível)
  - Banner de acertos: "Ninguém acertou — acumula!" ou "X acertaram!"

---

## Fetch CSV e CORS

O Google Sheets bloqueia fetch direto do browser. Solução atual: proxy público com fallback em cadeia.

```js
async function fetchCSV(url) {
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
    `https://thingproxy.freeboard.io/fetch/${url}`,
  ];
  // Tenta cada proxy com timeout de 8s; retorna o primeiro que funcionar
}
```

**Problema conhecido:** proxies públicos são instáveis. Se o login falhar com "Erro de conexão", é provável que todos os 3 proxies estejam fora. Solução definitiva seria uma Vercel Function (`/api/csv.js`) que faz o fetch server-side e retorna o CSV, eliminando CORS completamente.

---

## Estrutura de dados — `data.js`

### `PARTICIPANTS_CSV_URL`
URL pública do CSV da planilha mestre de participantes (Google Forms → Sheets → Publicar na web → CSV).

Colunas esperadas:
| Col | Header no CSV | Conteúdo |
|-----|---------------|----------|
| A | `Carimbo de data/hora` | Timestamp do Forms |
| B | `Endereço de e-mail` | E-mail do participante ← usado no login |
| C | `Nome :` | Nome do participante |
| D | `Numero de gols do Brasil` | Palpite gols mandante |
| E | `Numero de gols do Marrocos` | Palpite gols visitante |
| F | `Estou ciente...` | Confirmação regulamento |

### `GAMES[]`
Array de objetos, um por jogo. Campos:

```js
{
  id: "jogo1",              // string única, sem espaços
  phase: "Fase de Grupos",  // label exibida no filtro e no card
  phaseTag: "grupos",       // slug para filtro (sem acentos/espaços)
  homeTeam: { name: "Brasil",   flag: "🇧🇷" },
  awayTeam: { name: "Marrocos", flag: "🇲🇦" },
  date: "2026-06-17",       // YYYY-MM-DD
  time: "18:00",            // horário local de Brasília
  venue: "MetLife Stadium, Nova Jersey",
  status: "open",           // "upcoming" | "open" | "closed" | "finished"
  result: null,             // null ou { home: N, away: N }
  csvUrl: "https://...",    // URL CSV da aba de apostas deste jogo (null = botão oculto)
  betDeadline: "2026-06-17T18:59:00",  // ISO sem timezone (local)
  prizeInfo: "R$ 20,00 por participante · Acumula se ninguém acertar",
}
```

---

## Design e CSS

- **Paleta:** `--blue-dark: #0D1B2A` (fundo), `--blue-mid: #162840` (cards), `--green-mid: #1A8A4A`, `--yellow: #F5C518`
- **Tipografia:** `Bebas Neue` (display/títulos/placares) + `Inter` (corpo)
- **Fonte via Google Fonts** — precisa de internet no primeiro load
- **Responsivo:** mobile-first, breakpoint em 600px
- **Acessibilidade:** `prefers-reduced-motion` respeita ticker e animações

---

## Sessão

Usa `sessionStorage` (não `localStorage`) — sessão expira ao fechar o browser. Chaves:
- `bolao_user_email`
- `bolao_user_name`

---

## Deploy

Vercel, zero config. Apenas arrasta a pasta ou conecta o repositório GitHub. Sem `vercel.json` necessário para site estático puro.

---

## Melhorias pendentes / próximos passos

### Alta prioridade
- [ ] **Vercel Function para proxy CSV** (`/api/csv.js`) — elimina dependência de proxies públicos instáveis que causam falha de login
  - Recebe `?url=` como query param, faz fetch server-side, retorna o CSV com `Content-Type: text/csv`
  - No `app.js`, substituir `fetchCSV` para chamar `/api/csv?url=...` em vez dos proxies externos

### Funcionalidades futuras
- [ ] Ranking de participantes acumulado entre todos os jogos (pontuação por acerto exato)
- [ ] Contador regressivo até o prazo de apostas no card
- [ ] Página de regulamento / como funciona
- [ ] Notificação visual quando resultado é registrado

---

## Contexto operacional

- **Organizador:** João (`joaoaraujomn@gmail.com`) — acesso admin hardcoded
- **Planilha mestre:** Google Sheets vinculado ao Google Forms
- **Participantes:** entram via Forms, pagam R$20 via Pix (`joaoaraujomn@gmail.com`), confirmação manual pelo organizador (não há validação de pagamento automática)
- **Jogos:** Brasil na Copa do Mundo 2026, fases de grupos e eliminatórias conforme o torneio avança