# Responsividade — Bolão.Melo (celular, tablet, desktop)

## Contexto

O app é uma SPA estática (`index.html` + `style.css` + `app.js`) já com
viewport meta tag e uma media query única em `max-width: 600px`. O grid de
jogos (`.games-section`) já usa `repeat(auto-fill, minmax(320px, 1fr))`, o
que se adapta razoavelmente entre tablet e desktop. Faltam ajustes
específicos para a faixa de tablet e para o header, que usa um título longo
("🏆 🇧🇷🇧🇷🇧🇷 BOLÃO.Melo 🇧🇷🇧🇷🇧🇷") em fonte condensada (Bebas Neue) dentro de
um flex `space-between` sem wrap — risco real de overflow/aperto em telas
estreitas (celular e tablets em retrato).

## Objetivo

Garantir que o app fique utilizável e visualmente equilibrado em três
perfis de tela, sem reescrever a arquitetura CSS existente (desktop-first +
media queries):

- **Celular** (~320px–480px)
- **Tablet** (~481px–1024px)
- **Desktop** (>1024px, já coberto pelo `.main { max-width: 1100px }`)

## Mudanças

### 1. Header responsivo

- `.header-inner` passa a permitir `flex-wrap: wrap` em ≤768px, com
  `.header-brand` ocupando a linha de cima e `.header-right` (badge +
  botão Sair) a linha de baixo, alinhados à esquerda/direita normalmente.
- Em ≤480px, `.header-logo` reduz `font-size`/`letter-spacing`.
- As bandeiras repetidas no título (`🇧🇷🇧🇷🇧🇷` antes e depois de
  "BOLÃO.Melo") são movidas para um `<span class="header-flags">` em
  `index.html`, escondido via `display: none` em ≤480px — mantendo só
  "🏆 BOLÃO.Melo" nesse tamanho de tela.

### 2. Novo breakpoint tablet (`max-width: 1024px`)

- Ajusta `.main` padding para um valor intermediário entre mobile e
  desktop.
- Aplica o comportamento de header em wrap (item 1) a partir desse
  breakpoint.
- Grid de jogos continua usando `auto-fill, minmax(320px, 1fr)` (já
  produz 2 colunas nessa faixa); sem mudança estrutural no grid.

### 3. Breakpoint celular ajustado (`max-width: 480px`, substitui o atual `600px`)

- Mantém os ajustes já existentes (grid 1 coluna, paddings reduzidos,
  `.login-card`, `.logo-title`, `.game-result`, `.team-flag`,
  `.user-badge`).
- Reduz adicionalmente o padding do `.game-card` e o `font-size` da
  `.bets-table` para telas bem estreitas.
- Esconde `.header-flags` (ver item 1).

### 4. Polimentos gerais

- `.screen { min-height: 100vh }` passa a usar `min-height: 100dvh` com
  fallback `100vh` (para evitar saltos de layout com a barra de endereço
  retrátil em navegadores mobile).
- Botões de toque (`.filter-btn`, `.admin-status-btn`,
  `.btn-check-winners`, `.btn-sheet`) recebem `min-height` ~40-44px onde
  necessário para área de toque confortável.

## Fora de escopo

- Não há reescrita mobile-first do CSS.
- Não há mudanças na lógica de `app.js` além do necessário para o
  `<span class="header-flags">` em `index.html` (puramente estrutural,
  sem novo JS).
- Não há novos breakpoints para "desktop grande" (>1440px) — o
  `max-width: 1100px` existente já resolve isso.

## Verificação

Após a implementação, abrir o app localmente (servidor estático) e
verificar visualmente em larguras representativas: 360px, 414px (celular),
768px, 1024px (tablet) e 1440px (desktop). Confirmar:

- Header não quebra/overflow em nenhuma largura.
- Grid de jogos com 1 coluna (celular), 2 colunas (tablet), 3 colunas
  (desktop).
- Tabela de apostas legível e com scroll horizontal quando necessário.
- Botões com área de toque confortável em celular/tablet.
