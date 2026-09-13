/* =============================================================================
   Faro — página de compartilhamento
   Serve o conteúdo de  /c/<id-do-caso>  (ver worker.js)

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

const ESPECIE = { cao: 'cão', gato: 'gato', outro: 'pet' };

/* O texto do card é a única chance de convencer quem só passou o olho num grupo
   de bairro. Precisa dizer, em uma linha, o que se pede da pessoa. */
const CHAMADA = {
  perdido:    (c) => `Ajude a achar ${comArtigo(c)}`,
  avistado:   (c) => `Viram um ${ESPECIE[c.especie]} solto — você conhece?`,
  encontrado: (c) => `Este ${ESPECIE[c.especie]} está a salvo — você conhece o dono?`,
  adocao:     (c) => `${c.titulo} procura um lar`,
};

const PEDIDO = {
  perdido:    'Se você vir, avise pelo app — o tutor recebe na hora.',
  avistado:   'Se for seu ou você souber de quem é, avise pelo app.',
  encontrado: 'Se for seu ou você reconhecer, avise pelo app.',
  adocao:     'Fale com quem está doando pelo app.',
};

/** "o Thor" / "a Mel" / "este pet" — o artigo vem do sexo do animal. */
function comArtigo(c) {
  if (c.sexo === 'femea') return `a ${c.titulo}`;
  if (c.sexo === 'macho') return `o ${c.titulo}`;
  return `este ${ESPECIE[c.especie]}`;
}

function quandoFoi(iso) {
  const min = (Date.now() - Date.parse(iso)) / 60000;
  if (min < 60)   return 'há menos de uma hora';
  const h = Math.round(min / 60);
  if (h < 24)     return h === 1 ? 'há 1 hora' : `há ${h} horas`;
  const d = Math.round(min / 1440);
  if (d === 1)    return 'ontem';
  if (d < 30)     return `há ${d} dias`;
  return 'há mais de um mês';
}

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
  const campos = 'id,tipo,status,titulo,texto,especie,raca,cor,sexo,endereco,ocorrido_em,post_fotos(path,ordem)';
  const r = await fetch(`${base}/rest/v1/posts?id=eq.${encodeURIComponent(id)}&select=${campos}`, {
    headers: { apikey: chave, Authorization: `Bearer ${chave}` },
  });
  if (!r.ok) return null;
  const linhas = await r.json();
  return Array.isArray(linhas) && linhas.length ? linhas[0] : null;
}

/* Caso sem foto não pode virar um cartão só de texto no WhatsApp: a prévia
   sem imagem quase não é notada no meio de uma conversa. Entra o logo. */
function fotoDeReserva(origem) {
  return `${origem}/img/previa-padrao.jpg`;
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
        titulo: 'Caso não encontrado — Faro',
        descricao: 'Este caso não existe mais ou foi encerrado.',
        imagem: fotoDeReserva(origem), url: `${origem}/c/${id}`, destino: `${origem}/`,
        corpo: '<h1>Caso não encontrado</h1><p>Ele pode ter sido encerrado pelo tutor.</p>',
      }),
    };
  }

  const encerrado = caso.status === 'resolvido';

  const titulo = encerrado
    ? `${caso.titulo} já voltou para casa`
    : (CHAMADA[caso.tipo] || CHAMADA.perdido)(caso);

  const tracos = [caso.raca, caso.cor].filter(Boolean).join(', ');
  const quando = caso.tipo === 'adocao' ? '' : quandoFoi(caso.ocorrido_em);
  const verbo  = caso.tipo === 'perdido' ? 'Sumiu' : 'Visto';

  const descricao = encerrado
    ? 'Caso encerrado — o pet está de volta com a família.'
    : cortar([
        tracos && tracos.charAt(0).toUpperCase() + tracos.slice(1),
        quando && caso.endereco ? `${verbo} ${quando}, ${caso.endereco}`
                                : (caso.endereco || ''),
        PEDIDO[caso.tipo] || PEDIDO.perdido,
      ].filter(Boolean).join('. '), 190);

  return {
    status: 200,
    html: pagina({
      titulo, descricao,
      imagem: urlDaFoto(caso, base) || fotoDeReserva(origem),
      url: `${origem}/c/${id}`,
      destino,
      corpo: `
        <h1>${esc(titulo)}</h1>
        <p>${esc(descricao)}</p>
        ${caso.texto ? `<p>${esc(caso.texto)}</p>` : ''}
        <p><a href="${esc(destino)}">Abrir no Faro</a></p>`,
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
<meta property="og:site_name" content="Faro">
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
