/* =============================================================================
   Faro — Worker
   O site é estático (web/), servido pela camada de assets do Cloudflare.
   Este Worker existe por um motivo só: responder /c/<id> com as meta tags og:,
   para o link compartilhado gerar prévia no WhatsApp.

   O wrangler.jsonc manda só /c/* passar por aqui (run_worker_first); o resto
   vai direto dos assets, sem invocar o Worker.
   ============================================================================= */

import { buscarCaso, paginaDeCompartilhamento } from './src/compartilhar.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const casa = url.pathname.match(/^\/c\/([^/]+)\/?$/);

    // Qualquer outra coisa que chegue aqui é arquivo do site.
    if (!casa) return env.ASSETS.fetch(request);

    const id = casa[1];
    const caso = await buscarCaso(id, env).catch(() => null);
    const { status, html } = paginaDeCompartilhamento(caso, id, url.origin, env);

    return new Response(html, {
      status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // Curto: um caso pode ser encerrado a qualquer momento.
        'cache-control': 'public, max-age=120, s-maxage=120',
        'x-content-type-options': 'nosniff',
      },
    });
  },
};
