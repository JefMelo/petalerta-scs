/* =============================================================================
   Faro — Worker
   O site é estático (web/), servido pela camada de assets do Cloudflare.
   Este Worker existe por dois motivos, e nenhum a mais:

     /c/<id>   as meta tags og: do link compartilhado, para o WhatsApp montar a
               prévia com a foto e o nome do pet;
     /avisar   o envio dos avisos no celular (web push), que precisa de segredo
               e de criptografia — coisa que não pode viver no navegador.

   O wrangler.jsonc manda só esses dois caminhos passarem por aqui
   (run_worker_first); o resto vai direto dos assets, sem invocar o Worker.
   ============================================================================= */

import { buscarCaso, paginaDeCompartilhamento } from './src/compartilhar.js';
import { avisar } from './src/avisar.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/avisar') {
      if (request.method !== 'POST') return new Response('método', { status: 405 });
      return avisar(request, env);
    }

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
