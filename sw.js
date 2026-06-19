// ============================================================
//  SERVICE WORKER — Bolão Melo PWA
//  Estratégia:
//   • App shell (HTML/CSS/JS/ícone) → network-first com fallback ao cache.
//     Sempre pega a versão mais nova quando online; funciona offline pelo cache.
//   • Dados ao vivo (Google Sheets) e fontes externas → NUNCA passam pelo SW
//     (deixa o navegador buscar direto, sempre fresco).
//
//  O CACHE_VERSION abaixo é gerado AUTOMATICAMENTE pelo hook de pre-commit
//  (.githooks/pre-commit) a partir do hash do conteúdo do app — não edite à mão.
// ============================================================

const CACHE_VERSION = "bolao-b1825336";

// Arquivos do app que compõem o "shell" (carregados na primeira visita).
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./data.js",
  "./manifest.json",
  "./copa-do-mundo.png",
];

// Instala: pré-cacheia o app shell.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Ativa: limpa versões antigas do cache.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first só para requisições GET do próprio app (mesma origem).
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Só intercepta GET; deixa POST etc. passarem direto.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Só intercepta requisições da própria origem (não os dados do Google Sheets
  // nem as fontes do Google) — assim os dados ao vivo nunca são cacheados.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Atualiza o cache com a resposta fresca (clone, pois só pode ler uma vez).
        const copy = response.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() =>
        // Offline: serve do cache; se for navegação e não houver match, cai no index.
        caches.match(request).then((cached) => cached || caches.match("./index.html"))
      )
  );
});
