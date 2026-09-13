/* =============================================================================
   Farejo — página de compartilhamento  (Cloudflare Pages Function)
   Responde em  /c/<id-do-caso>

   POR QUE ISTO EXISTE
   O app roteia por hash (#/post/<id>) e o hash NUNCA é enviado ao servidor.
   O robô do WhatsApp que busca a pré-visualização pediria só "/" e receberia a
   página genérica — sem foto, sem nome do pet. Como o compartilhamento em grupo
   de bairro é o principal jeito de um pet perdido ser achado, a falta da prévia
   custa caro.

   Então o botão de compartilhar gera /c/<id>:
     • robô  → recebe HTML com as meta tags og: preenchidas
     • gente → é levada em seguida para /#/post/<id>, o app de verdade
   ============================================================================= */

const PADRAO = {
  SUPABASE_URL: 'https://sxnyeokxkczrcdnsanbu.supabase.co',
  SUPABASE_ANON: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4bnllb2t4a2N6cmNkbnNhbmJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4MTc4MDIsImV4cCI6MjEwNDM5MzgwMn0.uDtW_mSW4B8C--RAJWXHsH2ts6B8854oXxv0QAayVk0',   // pública por natureza; quem protege é o RLS
};

const ESPECIE = { cao: 'Cão', gato: 'Gato', outro: 'Pet' };
const TIPO = {
  perdido:    (e) => `${e} perdido`,
  avistado:   (e) => `${e} avistado`,
  encontrado: (e) => `${e} encontrado`,
  adocao:     (e) => `${e} para adoção`,
};

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const cortar = (t, n) => {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim();
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
};

/** Busca o caso pela API pública. Sem sessão: o RLS já deixa posts legíveis. */
export async function buscarCaso(id, env = {}) {
  const base = env.SUPABASE_URL || PADRAO.SUPABASE_URL;
  const chave = env.SUPABASE_ANON || PADRAO.SUPABASE_ANON;
  const campos = 'id,tipo,status,titulo,texto,especie,raca,cor,endereco,ocorrido_em,post_fotos(path,ordem)';
  const r = await fetch(`${base}/rest/v1/posts?id=eq.${encodeURIComponent(id)}&select=${campos}`, {
    headers: { apikey: chave, Authorization: `Bearer ${chave}` },
  });
  if (!r.ok) return null;
  const linhas = await r.json();
  return Array.isArray(linhas) && linhas.length ? linhas[0] : null;
}

function urlDaFoto(caso, base) {
  const fotos = [...(caso?.post_fotos || [])].sort((a, b) => a.ordem - b.ordem);
  const path = fotos[0]?.path;
  if (!path) return '';
  return /^https?:\/\//.test(path)
    ? path
    : `${base}/storage/v1/object/public/fotos/${path}`;
}

/** Monta o HTML. Função pura, de propósito: dá para testar sem Cloudflare. */
export function paginaDeCompartilhamento(caso, id, origem, env = {}) {
  const base = env.SUPABASE_URL || PADRAO.SUPABASE_URL;
  const destino = `${origem}/#/post/${id}`;

  if (!caso) {
    return {
      status: 404,
      html: pagina({
        titulo: 'Caso não encontrado — Farejo',
        descricao: 'Este caso não existe mais ou foi encerrado.',
        imagem: '', url: `${origem}/c/${id}`, destino: `${origem}/`,
        corpo: '<h1>Caso não encontrado</h1><p>Ele pode ter sido encerrado pelo tutor.</p>',
      }),
    };
  }

  const especie = ESPECIE[caso.especie] || 'Pet';
  const rotulo = (TIPO[caso.tipo] || TIPO.perdido)(especie);
  const encerrado = caso.status === 'resolvido';

  const titulo = encerrado
    ? `${caso.titulo} já foi encontrado — Farejo`
    : `${caso.titulo} — ${rotulo} em Santa Cruz do Sul`;

  const traços = [caso.raca, caso.cor].filter(Boolean).join(', ');
  const descricao = cortar([
    encerrado ? 'Caso encerrado: o pet voltou para casa.' : caso.texto,
    traços,
    caso.endereco,
  ].filter(Boolean).join(' · '), 180)
    || 'Ajude a encontrar este pet em Santa Cruz do Sul.';

  return {
    status: 200,
    html: pagina({
      titulo, descricao,
      imagem: urlDaFoto(caso, base),
      url: `${origem}/c/${id}`,
      destino,
      corpo: `
        <h1>${esc(caso.titulo)}</h1>
        <p><strong>${esc(rotulo)}</strong>${caso.endereco ? ` · ${esc(caso.endereco)}` : ''}</p>
        ${caso.texto ? `<p>${esc(caso.texto)}</p>` : ''}
        <p><a href="${esc(destino)}">Abrir no Farejo</a></p>`,
    }),
  };
}

function pagina({ titulo, descricao, imagem, url, destino, corpo }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(descricao)}">

<meta property="og:type" content="article">
<meta property="og:site_name" content="Farejo">
<meta property="og:locale" content="pt_BR">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="${esc(descricao)}">
<meta property="og:url" content="${esc(url)}">
${imagem ? `<meta property="og:image" content="${esc(imagem)}">
<meta property="og:image:width" content="640">
<meta property="og:image:height" content="640">` : ''}
<meta name="twitter:card" content="${imagem ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(titulo)}">
<meta name="twitter:description" content="${esc(descricao)}">
${imagem ? `<meta name="twitter:image" content="${esc(imagem)}">` : ''}

<link rel="canonical" href="${esc(url)}">
<!-- Gente vai para o app. O robô fica com o HTML acima. -->
<meta http-equiv="refresh" content="0; url=${esc(destino)}">
<style>
  body { margin:0; padding:40px 20px; font-family: system-ui, sans-serif;
         color:#0D1418; max-width:600px; margin-inline:auto; line-height:1.5; }
  h1 { font-size:1.5rem; margin:0 0 6px; }
  a { color:#15719F; }
</style>
</head>
<body>
${corpo}
<script>location.replace(${JSON.stringify(destino)});</script>
</body>
</html>`;
}

export async function onRequest({ params, request, env }) {
  const id = params.id;
  const origem = new URL(request.url).origin;
  const caso = await buscarCaso(id, env).catch(() => null);
  const { status, html } = paginaDeCompartilhamento(caso, id, origem, env);

  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Curto: um caso pode ser encerrado a qualquer momento.
      'cache-control': 'public, max-age=120, s-maxage=120',
    },
  });
}
