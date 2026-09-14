/* =============================================================================
   Faro — service worker

   Faz duas coisas e nada além disso:

   1. GUARDA O APP  para abrir rápido e para abrir sem rede. Quem procura um pet
      costuma estar na rua, com sinal ruim; a tela não pode depender de baixar
      tudo de novo.
   2. RECEBE OS AVISOS  (web push) quando o aparelho está com o app fechado.

   POR QUE NÃO HÁ LISTA DE ARQUIVOS PARA PRÉ-CARREGAR
   O site não tem build. Manter aqui uma lista de caminhos com `?v=` seria uma
   segunda fonte de verdade para desencontrar da primeira (ver tools/versionar.js).
   Em vez disso, guarda-se o que a pessoa de fato pediu: ao abrir o app pela
   primeira vez ele já busca todos os módulos, e a partir daí eles estão aqui.

   O QUE NUNCA É GUARDADO
   As chamadas ao Supabase. São dados vivos e carregam o token da sessão —
   servir uma cópia velha mostraria caso encerrado como aberto, ou pior, dado de
   outra conta. Passam direto, sem tocar aqui.
   ============================================================================= */

const VERSAO = '46';                       // carimbada por tools/versionar.js
const CASCA  = `faro-casca-${VERSAO}`;     // html, css, js, ícones, Leaflet
const FOTOS  = 'faro-fotos';               // fotos dos casos, com teto
const FOTOS_TETO = 60;

/* Uma cópia que nunca é apagada seria pior que um erro: a pessoa ficaria
   olhando um app quebrado sem entender. Isto aqui é o "sem conexão" honesto. */
const SEM_REDE = `<!doctype html><html lang="pt-BR"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Faro — sem conexão</title>
<style>
  body{margin:0;min-height:100dvh;display:grid;place-content:center;gap:1rem;
       padding:2rem;text-align:center;font:400 1rem/1.5 system-ui,sans-serif;color:#15171C}
  h1{margin:0;font-size:1.25rem}p{margin:0;color:#5A6069;max-width:26ch}
  button{justify-self:center;padding:.7rem 1.4rem;border:0;border-radius:999px;
         background:#15171C;color:#fff;font:inherit;font-weight:600;cursor:pointer}
</style>
<h1>Sem conexão</h1>
<p>O Faro precisa de internet para buscar os casos perto de você.</p>
<button onclick="location.reload()">Tentar de novo</button>`;

// --- instalação e limpeza -----------------------------------------------------

/* Sem skipWaiting de propósito: trocar o app debaixo de quem está no meio de um
   formulário perde o que foi digitado. A versão nova assume na próxima abertura. */
self.addEventListener('install', () => { /* nada a pré-carregar */ });

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    for (const nome of await caches.keys()) {
      if (nome.startsWith('faro-casca-') && nome !== CASCA) await caches.delete(nome);
    }
    await self.clients.claim();
  })());
});

// --- estratégias --------------------------------------------------------------

/* O Cloudflare responde caminho inexistente com o index.html (single-page-
   application). Sem esta checagem, um 404 de módulo gravaria HTML no lugar do
   arquivo — e o app quebraria com um erro de sintaxe sem explicação nenhuma. */
function ehHtml(resposta) {
  return (resposta.headers.get('content-type') || '').includes('text/html');
}

async function guardar(cache, pedido, resposta) {
  if (resposta && resposta.ok) await cache.put(pedido, resposta.clone());
  return resposta;
}

/** Imutável: a URL carrega a versão, então o conteúdo daquela URL nunca muda. */
async function primeiroOCache(pedido, nomeDoCache, { recusarHtml = false } = {}) {
  const cache = await caches.open(nomeDoCache);
  const guardado = await cache.match(pedido);
  if (guardado) return guardado;

  const resposta = await fetch(pedido);
  if (recusarHtml && ehHtml(resposta)) return resposta;   // é 404 disfarçado: não grava
  return guardar(cache, pedido, resposta);
}

/** A casca do app: rede manda, cache é a rede de segurança. */
async function primeiroARede(pedido) {
  const cache = await caches.open(CASCA);
  try {
    return await guardar(cache, pedido, await fetch(pedido));
  } catch (erro) {
    const guardado = await cache.match(pedido) || await cache.match('/');
    if (guardado) return guardado;
    throw erro;
  }
}

/* As fotos dos casos vivem no Storage do Supabase e não mudam de endereço.
   Guardá-las evita rebaixar a mesma imagem a cada rolagem — mas com teto, senão
   um feed de meses enche a cota do navegador e o próprio app é despejado. */
async function foto(pedido) {
  const cache = await caches.open(FOTOS);
  const guardado = await cache.match(pedido);
  if (guardado) return guardado;

  const resposta = await fetch(pedido);
  await guardar(cache, pedido, resposta);

  const chaves = await cache.keys();
  if (chaves.length > FOTOS_TETO) {
    // As mais antigas saem primeiro: a ordem das chaves é a de inserção.
    for (const velha of chaves.slice(0, chaves.length - FOTOS_TETO)) await cache.delete(velha);
  }
  return resposta;
}

/* O jsdelivr está aqui porque é de lá que vem o próprio cliente do Supabase
   (dados.js). Sem ele guardado, o app não SOBE sem rede — e aí todo o resto
   deste arquivo teria sido em vão. */
const CDNS = new Set([
  'cdnjs.cloudflare.com',     // Leaflet
  'cdn.jsdelivr.net',         // supabase-js
  'fonts.googleapis.com',
  'fonts.gstatic.com',
]);

/* O que vem de CDN chega OPACO: a marca `<script src>` pede sem CORS, e uma
   resposta opaca esconde até o código de status. Guardar às cegas tem um risco —
   se um dia vier um erro disfarçado, ele ficaria no cache para sempre.
   Daí a revalidação: entrega o que está guardado na hora (rápido, e funciona
   sem rede) e busca de novo por trás, de modo que um erro se conserta sozinho
   na visita seguinte. */
async function revalidando(pedido) {
  const cache = await caches.open(CASCA);
  const guardado = await cache.match(pedido);

  const daRede = fetch(pedido)
    .then((r) => { if (r.ok || r.type === 'opaque') cache.put(pedido, r.clone()); return r; })
    .catch(() => null);

  return guardado || await daRede || Response.error();
}

self.addEventListener('fetch', (ev) => {
  const pedido = ev.request;
  if (pedido.method !== 'GET') return;

  const url = new URL(pedido.url);
  const mesmaCasa = url.origin === self.location.origin;

  // Dado vivo do Supabase (API, auth, realtime): não é da conta deste arquivo.
  const supabase = url.hostname.endsWith('.supabase.co');
  if (supabase && !url.pathname.startsWith('/storage/')) return;

  if (supabase) { ev.respondWith(foto(pedido)); return; }

  // Navegação: a casca do app, sempre a mais nova que a rede permitir.
  if (pedido.mode === 'navigate') {
    ev.respondWith(primeiroARede(pedido).catch(() =>
      new Response(SEM_REDE, { headers: { 'content-type': 'text/html; charset=utf-8' } })));
    return;
  }

  // Módulos e folha de estilo: a URL tem `?v=`, logo é imutável.
  if (mesmaCasa && url.searchParams.has('v')) {
    ev.respondWith(primeiroOCache(pedido, CASCA, { recusarHtml: true }));
    return;
  }

  // Ícones e o logo da marca.
  if (mesmaCasa && url.pathname.startsWith('/img/')) {
    ev.respondWith(primeiroOCache(pedido, CASCA, { recusarHtml: true }));
    return;
  }

  // O que vem de CDN: sem isso o app não sobe, o mapa não desenha e o texto
  // troca de cara no meio da leitura.
  if (CDNS.has(url.hostname)) {
    ev.respondWith(revalidando(pedido));
    return;
  }

  // Ladrilhos do mapa e o resto: direto para a rede. Guardar mapa inteiro é
  // encher o disco de quem só passou por ali.
});

// --- avisos (web push) --------------------------------------------------------

/* O corpo vem da função que envia, no Supabase. Se vier vazio ou ilegível, um
   aviso genérico ainda é melhor que silêncio — o navegador exige que todo push
   recebido vire notificação visível. */
self.addEventListener('push', (ev) => {
  let d = {};
  try { d = ev.data ? ev.data.json() : {}; } catch { /* aviso genérico */ }

  const titulo = d.titulo || 'Faro';
  ev.waitUntil(self.registration.showNotification(titulo, {
    body:  d.texto || 'Há novidade em um caso que você acompanha.',
    icon:  d.foto || '/img/icone-192.png',
    badge: '/img/badge-96.png',
    tag:   d.tag || 'faro',          // aviso novo do mesmo caso substitui o velho
    renotify: true,
    data:  { url: d.url || '/' },
    // Vibra curto: é aviso de bairro, não alarme.
    vibrate: [80, 40, 80],
  }));
});

/* Tocar no aviso tem de levar ao caso, e reaproveitar a janela que já estiver
   aberta — abrir uma segunda cópia do app confunde e perde a rolagem. */
self.addEventListener('notificationclick', (ev) => {
  ev.notification.close();
  const destino = new URL(ev.notification.data?.url || '/', self.location.origin);

  ev.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const janela of janelas) {
      if (new URL(janela.url).origin === destino.origin) {
        await janela.focus();
        janela.navigate ? await janela.navigate(destino.href)
                        : janela.postMessage({ tipo: 'ir', url: destino.href });
        return;
      }
    }
    await self.clients.openWindow(destino.href);
  })());
});

/* O navegador pode trocar a inscrição sozinho (chave girada, limpeza). Quando
   isso acontece o servidor fica com um endereço morto — a página reinscreve na
   próxima abertura, e este aviso serve para o app saber que precisa. */
self.addEventListener('pushsubscriptionchange', (ev) => {
  ev.waitUntil((async () => {
    for (const janela of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
      janela.postMessage({ tipo: 'reinscrever' });
    }
  })());
});
