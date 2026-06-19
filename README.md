# 🏆 Bolão.Cup — Guia de uso

## Estrutura dos arquivos

```
bolao/
├── index.html   → página principal (não precisa editar)
├── style.css    → estilos (não precisa editar)
├── app.js       → lógica (não precisa editar)
└── data.js      → ⭐ EDITE AQUI para cada jogo novo
```

---

## Como adicionar um participante

Abra `data.js` e adicione na lista `PARTICIPANTS`:

```js
{ name: "Fulano Silva", email: "fulano@email.com" },
```

---

## Como adicionar um novo jogo

Copie o bloco comentado em `data.js` e edite:

```js
{
  id: "jogo2",                          // ID único, sem espaços
  phase: "Fase de Grupos",              // Nome da fase (aparece no filtro)
  phaseTag: "grupos",                   // Tag interna (sem acentos, sem espaços)
  homeTeam: { name: "Brasil",  flag: "🇧🇷" },
  awayTeam: { name: "Espanha", flag: "🇪🇸" },
  date: "2026-06-22",                   // Formato YYYY-MM-DD
  time: "15:00",                        // Horário de Brasília
  venue: "SoFi Stadium, Los Angeles",
  status: "upcoming",                   // upcoming | open | closed | finished
  result: null,                         // null ou { home: 2, away: 1 }
  sheetUrl: null,                       // link da planilha (null = botão desativado)
  betDeadline: "2026-06-22T14:59:00",   // Prazo ISO (horário local do servidor)
  prizeInfo: "R$ 20,00 por participante · Acumula se ninguém acertar",
},
```

### Status do jogo

| status       | o que aparece                          |
|--------------|----------------------------------------|
| `upcoming`   | "Em breve" (cinza azulado)             |
| `open`       | "Apostas abertas" (verde)              |
| `closed`     | "Apostas fechadas" (amarelo)           |
| `finished`   | "Encerrado" + resultado                |

> O botão "Ver apostas" só aparece quando o prazo passou OU status é `closed`/`finished`.

### Registrar resultado

```js
result: { home: 3, away: 1 },
status: "finished",
```

---

## Status automático + cronômetros (sem mexer no código)

Agora você **não precisa** editar o `status` à mão na hora do jogo. O status
mostrado é resolvido em tempo real, nesta ordem de prioridade:

1. **Override do organizador** (célula A1 da aba "Status" da planilha) —
   vence tudo, para TODOS os jogos
2. **Tempo (horário de Recife, UTC-3):**
   - quando passa de `finishAt` → vira **`finished`** automaticamente
   - quando passa de `betDeadline` → vira **`closed`** automaticamente
3. O campo `status` do `data.js` (base/padrão, ex.: `open`)

Por isso cada jogo agora tem um campo novo:

```js
betDeadline: "2026-06-13T18:59:00",  // horário de Recife
finishAt:    "2026-06-13T19:00:00",  // horário de Recife → vira "finished" às 19h
```

> ⚠️ Todas as datas/horas (`date`+`time`, `betDeadline`, `finishAt`) são
> interpretadas no **horário de Recife** — funciona igual para quem abrir de
> qualquer lugar do mundo.

Cada card também mostra **dois cronômetros regressivos** (formato `HH:mm:ss`):
**Apostas fecham em** e **Partida começa em**. Ao zerar viram "Apostas
encerradas" / "Bola rolando".

---

## Placar automático ao vivo (API da ESPN)

O **placar é atualizado sozinho**, ao vivo, buscando da API pública da ESPN
(grátis, sem chave, sem backend). Cada jogo no `data.js` tem dois campos com os
nomes dos times **em inglês** para casar com a API:

```js
espnHome: "Brazil", espnAway: "Haiti",
```

- Enquanto o jogo está **rolando ou encerrado**, o placar real aparece no card
  e no ticker, atualizando a cada ~45s — sem você fazer nada.
- Antes do apito, fica "`? × ?`".
- Se você preencher `result: { home, away }` no `data.js` (jogo finalizado),
  esse valor **fixo vence** o automático.

**Prioridade do placar:**

1. `result` fixo no `data.js` (jogo encerrado)
2. Placar ao vivo da **ESPN** (automático)
3. **C1/D1 da aba `Status`** — *fallback manual*, caso a API da ESPN caia ou
   atrase você assume o placar na mão (veja abaixo)
4. "`? × ?`" (pendente)

> 💡 Ou seja: no dia a dia você não toca em nada. Mas se a ESPN falhar, é só
> preencher os gols em **C1** (casa) e **D1** (visitante) da aba `Status` que o
> placar volta a aparecer pra todo mundo.

---

## Mudar o status (e placar de emergência) pelo site, para TODOS (override do organizador)

O **jogo ativo** pode ser controlado por uma aba chamada **`Status`** na sua
planilha — sem deploy, refletindo para todos os participantes:

> O "jogo ativo" é detectado automaticamente pelo site: é o jogo mais próximo
> da data/hora atual. Os outros jogos **não** são afetados pela aba `Status`.

| Célula | Conteúdo | Efeito |
|--------|----------|--------|
| **A1** | status do bolão | vence o cálculo automático para **todos os jogos**. Vazia (ou "Auto") = volta ao cálculo por horário. |
| **C1** | gols da casa (Brasil) | *fallback* de placar: só vale se a ESPN não trouxer placar ao vivo |
| **D1** | gols do visitante | *fallback* de placar (idem) |

> C1/D1 só entram em ação se a API da ESPN falhar — no normal, o placar é
> automático. Preencha os dois com números; vazios = sem fallback.

Valores aceitos em A1 (sem diferenciar maiúsculas/minúsculas ou acentos):

| Status interno | Aceita também |
|-----------------|---------------|
| `upcoming`  | `em breve` |
| `open`      | `aberto`, `aberta`, `abertas` |
| `closed`    | `fechado`, `fechada`, `fechadas` |
| `finished`  | `encerrado`, `encerrada`, `finalizado`, `finalizada` |

### Caminho A — editar as células direto no Google Sheets (mais simples)

1. Na sua planilha (a mesma do CSV de participantes), crie uma aba chamada
   **`Status`**.
2. **Arquivo → Compartilhar → Publicar na web** → escolha a aba **Status** →
   formato **CSV** → Publicar.
3. Copie a URL gerada e cole em `data.js`:
   ```js
   const STATUS_CONFIG_CSV_URL = "https://docs.google.com/.../pub?gid=...&single=true&output=csv";
   ```
4. Pronto. Para mudar o status do bolão (para todos), escreva um dos valores
   da tabela acima na **célula A1** dessa aba. Para registrar o placar,
   escreva os gols em **C1** (casa) e **D1** (visitante) — pelo navegador ou
   pelo app do Google Sheets no celular, de qualquer lugar. O site relê essas
   células a cada **2 minutos** (e também ao carregar a página). Para voltar
   ao status automático, apague A1; para tirar o placar, apague C1 e/ou D1.

### Caminho B — botões no site (opcional, requer Apps Script)

Quando você (`joaoaraujomn@gmail.com`) está logado, aparece um painel no topo
da página com botões: **Em breve · Abertas · Fechadas · Encerrado · Auto**.
Clicar grava o valor na mesma célula A1, via um Apps Script publicado como
"App da Web" — útil para mudar o status sem abrir a planilha.

> Sem essa configuração, os botões funcionam só **no seu navegador**
> (fallback em `localStorage`) — não refletem para os outros participantes.

1. Na planilha: **Extensões → Apps Script**.
2. Apague o conteúdo e cole:

   ```js
   function doPost(e) {
     var lock = LockService.getScriptLock();
     lock.waitLock(5000);
     try {
       var body   = JSON.parse(e.postData.contents);
       var status = (body.status || "").toString().trim();

       var ss    = SpreadsheetApp.getActiveSpreadsheet();
       var sheet = ss.getSheetByName("Status");
       if (!sheet) sheet = ss.insertSheet("Status");

       sheet.getRange("A1").setValue(status); // "" (Auto) limpa o override

       return ContentService
         .createTextOutput(JSON.stringify({ ok: true }))
         .setMimeType(ContentService.MimeType.JSON);
     } catch (err) {
       return ContentService
         .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
         .setMimeType(ContentService.MimeType.JSON);
     } finally {
       lock.releaseLock();
     }
   }
   ```

3. **Implantar → Nova implantação → Tipo: App da Web.**
   - *Executar como:* **Eu**
   - *Quem tem acesso:* **Qualquer pessoa**
4. Copie a URL que termina em **`/exec`** e cole em `data.js`:
   ```js
   const STATUS_WRITE_URL = "https://script.google.com/macros/s/.../exec";
   ```

Pronto. A partir daí, os cliques no painel gravam na célula A1 da aba `Status`
e os outros participantes veem a mudança no próximo carregamento (o site
também re-busca automaticamente a cada **2 minutos**).

> ⚠️ Esse override vale só para o **jogo ativo** (detectado automaticamente,
> veja acima) — os demais jogos não são afetados. Se no futuro houver dois
> jogos acontecendo ao mesmo tempo, esse mecanismo precisaria evoluir para
> permitir overrides simultâneos para mais de um jogo.

---

## Deploy no Vercel

1. Crie uma conta em [vercel.com](https://vercel.com)
2. Coloque os 4 arquivos numa pasta no GitHub (repositório público ou privado)
3. No Vercel, clique em "Add New → Project" e importe o repositório
4. Clique em Deploy — pronto!

Para atualizar: edite `data.js` no GitHub e o Vercel publica automaticamente.

---

## PWA (instalável no celular)

O site é um **PWA** — pode ser instalado na tela inicial do celular e abre em
tela cheia, como um app. No celular, o navegador oferece "Adicionar à tela
inicial"; no desktop, aparece um ícone de instalar na barra de endereço.

Arquivos que tornam isso possível (não precisa editar):

```
├── manifest.json   → nome, ícone, cores do app instalado
└── sw.js           → service worker (cache + funcionamento offline)
```

**Como funciona o cache:**

- Os arquivos do app (HTML/CSS/JS/ícone) ficam em cache → carrega rápido e a
  interface abre mesmo sem internet.
- Os **dados ao vivo** (planilha do Google Sheets: apostas, placar, status)
  **nunca** são cacheados — sempre vêm frescos da rede.

### Atualização automática do cache (importante)

O `CACHE_VERSION` dentro do `sw.js` é **gerado automaticamente** por um hook de
`git commit` (`.githooks/pre-commit`): toda vez que você commita uma mudança em
qualquer arquivo do app, a versão do cache muda sozinha e os usuários recebem os
arquivos novos. **Você não precisa editar o `sw.js` na mão.**

> ⚠️ O hook depende de uma configuração **local** do git. Ela já está ativa
> nesta máquina, mas se você **clonar o repositório em outro computador**, rode
> uma vez:
>
> ```sh
> git config core.hooksPath .githooks
> ```

---

## Segurança

O login é **proteção visual** (client-side). Os e-mails ficam em `data.js`.  
Para um bolão entre amigos, é mais que suficiente.  
Se quiser proteção real, a próxima evolução é um backend simples (Node/Vercel Functions).
