# Box "Total Arrecadado" — Design

## Objetivo

Exibir, para todos os participantes logados, um box com o valor total
arrecadado no bolão. O cálculo é simples: cada e-mail único na planilha de
participantes representa uma pessoa que pagou R$ 20,00. O total é
`numero_de_participantes * 20`.

## Fonte dos dados

`PARTICIPANTS_CSV_URL` (definida em `data.js`) — a mesma planilha mestre já
usada por `validateEmailInSheet` para validar o login. Cada linha = um
participante inscrito/pagante.

## Onde aparece

Novo `<section id="stats-box" class="stats-box">`, primeiro elemento dentro
de `<main>`, antes de `#admin-panel`. Visível para todos os participantes,
logo abaixo do ticker de placares.

## Cálculo

Nova função `buildStatsBox()`:

1. Busca o CSV via `fetchCSV(PARTICIPANTS_CSV_URL)` e converte com
   `parseCSV`.
2. Para cada linha, extrai o e-mail usando a mesma resolução de coluna já
   usada em `validateEmailInSheet`:
   `row["Endereço de e-mail"] || row["Email"] || row["email"] || Object.values(row)[1]`.
3. Normaliza (`.trim().toLowerCase()`) e adiciona a um `Set` para deduplicar
   — e-mails vazios são ignorados.
4. `total = set.size * 20`.

## Conteúdo exibido

```
💰 R$ 240,00
12 participantes · R$ 20,00 cada
```

- Valor total formatado em reais com `toLocaleString("pt-BR", { minimumFractionDigits: 2 })`.
- Linha de detalhe: contagem de participantes + valor por pessoa (R$ 20,00).

## Estados de carregamento/erro

Segue o padrão já usado em `loadBets`:

- **Carregando:** `⏳ Calculando total arrecadado...`
- **Erro** (fetch falhar): `⚠️ Não foi possível calcular o total arrecadado.`
  (loga o erro no console, mas não interrompe o resto do app)

## Fluxo de chamada

`buildStatsBox()` é chamada em `enterApp()`, junto com `buildTicker()`,
`buildFilters()` e `buildGames()`. Cálculo é feito uma vez por sessão (sem
atualização periódica).

## Estilo (CSS)

Novo bloco `.stats-box` em `style.css`:

- Fundo `var(--blue-mid)`, borda `1px solid rgba(245,197,24,0.25)` (mesmo
  destaque amarelo do `.admin-panel-inner`), `border-radius: var(--radius)`,
  `margin-bottom: 28px`, conteúdo centralizado.
- `.stats-value`: fonte `'Bebas Neue'`, `font-size: 2rem`, `letter-spacing: 2px`,
  cor `var(--yellow)`.
- `.stats-detail`: `font-size: 0.85rem`, cor `var(--gray-400)`, `margin-top: 4px`.
- `.stats-loading` / `.stats-error`: `font-size: 0.9rem`, cor `var(--gray-400)`.

## Fora de escopo

- Não há atualização periódica/em tempo real do total.
- Não conta a partir do CSV de apostas por jogo (`csvUrl`), apenas da
  planilha mestre de participantes.
