/* =============================================================================
   Faro — POST /avisar

   Quem dispara é o app de quem acabou de publicar: publicou um avistamento,
   chama aqui com o id do post. Não há gatilho no banco nem fila — o evento que
   importa acontece na mão de alguém, e essa pessoa está com a rede na mão.

   POR QUE ISSO NÃO É UM BURACO
   O corpo diz só "post tal aconteceu". Quem decide QUEM recebe é o banco
   (avisos_pendentes), não o app. E antes disso, três travas:

     1. o token da sessão é conferido no Supabase — não se acredita no que vem;
     2. quem chama tem de ser o AUTOR do post;
     3. o post tem de ser recente (10 min) — sem isso, alguém poderia varrer
        posts velhos e acordar a cidade inteira de novo.

   A repetição já estava travada no banco (avisos_enviados), então recarregar a
   página depois de publicar não manda nada duas vezes.
   ============================================================================= */

import { enviarPush } from './push.js';

const ESPECIE = { cao: 'cão', gato: 'gato', outro: 'pet' };

const comArtigo = (c) =>
  c.caso_sexo === 'femea' ? `a ${c.caso_titulo}`
  : c.caso_sexo === 'macho' ? `o ${c.caso_titulo}`
  : `o ${ESPECIE[c.caso_especie] || 'pet'}`;

/* A frase inteira, não só o número: sem distância conhecida "a  de você"
   ficaria com um buraco no meio. Arredondado na centena — precisão de GPS em
   celular não merece mais que isso, e "a 300 m" se lê melhor que "a 287 m". */
const aQueDistancia = (m) =>
  m == null   ? 'perto de você'
  : m < 950   ? `a ${Math.round(m / 100) * 100} m de você`
  : `a ${(m / 1000).toFixed(1).replace('.', ',')} km de você`;

const onde = (e) => (e ? ` em ${e}` : ' aqui perto');

/* O texto do aviso é quase tudo. Ele chega sozinho, fora do app, e tem uma
   linha para dizer por que vale largar o que a pessoa está fazendo. */
function redigir(a) {
  switch (a.motivo) {
    case 'meu_caso':
      return {
        titulo: `Avistaram ${comArtigo(a)}`,
        texto: `${a.quem} viu agora há pouco${onde(a.endereco)}. Toque para ver o rastro.`,
      };

    case 'ajudo':
      return {
        titulo: `Novidade sobre ${comArtigo(a)}`,
        texto: `${a.quem} avistou${onde(a.endereco)}. O caso que você ajudou andou.`,
      };

    case 'bairro':
      return a.caso_tipo === 'encontrado'
        ? {
            titulo: `Acharam um pet ${aQueDistancia(a.distancia_m)}`,
            texto: `Está a salvo${onde(a.endereco)}. Você conhece o dono?`,
          }
        : {
            titulo: `Sumiu um pet ${aQueDistancia(a.distancia_m)}`,
            texto: `${comArtigo(a)} desapareceu${onde(a.endereco)}. As primeiras horas são as que valem.`,
          };

    case 'resolvido':
      return {
        titulo: `${comArtigo(a)} está em casa`,
        texto: 'O caso que você ajudou a espalhar foi encerrado. Obrigado por farejar.',
      };

    default:
      return { titulo: 'Faro', texto: 'Há novidade em um caso que você acompanha.' };
  }
}

// --- conversa com o Supabase ---------------------------------------------------

const url = (env) => env.SUPABASE_URL || 'https://sxnyeokxkczrcdnsanbu.supabase.co';

async function rpc(env, nome, corpo) {
  const r = await fetch(`${url(env)}/rest/v1/rpc/${nome}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw new Error(`${nome}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

/** Quem está chamando? A resposta vem do Supabase, não do que o app afirma. */
async function quemChama(pedido, env) {
  const cabecalho = pedido.headers.get('Authorization') || '';
  if (!cabecalho.startsWith('Bearer ')) return null;

  const r = await fetch(`${url(env)}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON || '', Authorization: cabecalho },
  });
  if (!r.ok) return null;
  return (await r.json()).id || null;
}

/* Devolve o post, ou um MOTIVO — não um `null` que serve para tudo.

   A primeira versão devolvia null em qualquer falha, e o endpoint respondia
   "post não encontrado". Quando a chave de serviço estava errada, portanto, a
   mensagem mandava procurar o post — que existia — em vez da chave, que era o
   problema. Custou uma investigação inteira. Erro de autenticação e ausência
   são coisas diferentes e têm de ser ditas diferentes. */
async function oPost(id, env) {
  const r = await fetch(
    `${url(env)}/rest/v1/posts?id=eq.${encodeURIComponent(id)}`
    + '&select=id,autor_id,criado_em,status,resolvido_em,especie',
    { headers: { apikey: env.SUPABASE_SERVICE_ROLE,
                 Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}` } });

  if (r.status === 401 || r.status === 403) return { erroDeChave: true };
  if (!r.ok) return { erroDeLeitura: r.status };
  return { post: (await r.json())[0] || null };
}

// --- o caminho principal -------------------------------------------------------

export async function avisar(pedido, env) {
  if (!env.VAPID_PRIVADA || !env.SUPABASE_SERVICE_ROLE) {
    // Sem segredos configurados, isto não funciona — e é melhor dizer do que
    // deixar o app achar que avisou alguém.
    return resposta(503, { erro: 'avisos ainda não configurados' });
  }

  const quem = await quemChama(pedido, env);
  if (!quem) return resposta(401, { erro: 'sessão inválida' });

  let corpo;
  try { corpo = await pedido.json(); } catch { return resposta(400, { erro: 'corpo inválido' }); }
  const postId = corpo?.post_id;
  if (typeof postId !== 'string' || postId.length < 10) {
    return resposta(400, { erro: 'post_id ausente' });
  }

  const achado = await oPost(postId, env);
  if (achado.erroDeChave) {
    return resposta(503, { erro: 'a chave de serviço do Worker não é aceita pelo Supabase' });
  }
  if (achado.erroDeLeitura) {
    return resposta(502, { erro: `o Supabase respondeu ${achado.erroDeLeitura} ao ler o post` });
  }
  const post = achado.post;
  if (!post) return resposta(404, { erro: 'post não encontrado' });
  if (post.autor_id !== quem) return resposta(403, { erro: 'não é seu' });

  // "Recente" conta do que aconteceu por último: publicar ou encerrar.
  const marco = Date.parse(post.resolvido_em || post.criado_em);
  if (!(Date.now() - marco < 10 * 60 * 1000)) {
    return resposta(409, { erro: 'tarde demais para avisar sobre isto' });
  }

  const pendentes = await rpc(env, 'avisos_pendentes', { p_post_id: postId });
  if (!pendentes?.length) return resposta(200, { enviados: 0, motivos: {} });

  const vapid = {
    publica: env.VAPID_PUBLICA,
    privada: env.VAPID_PRIVADA,
    contato: env.VAPID_CONTATO || 'mailto:contato@faro.app',
  };

  const conta = {};
  const mortos = [];
  /* Falha de envio NÃO pode sumir em silêncio. Sem isto, "enviados: 0" fica
     igual a "não havia ninguém para avisar" — e são coisas muito diferentes:
     uma é normal, a outra é o app calado quando devia estar gritando. */
  const falhas = [];
  // Quem recebeu em PELO MENOS um aparelho — é o que autoriza marcar como
  // avisado. Se todos os aparelhos falharem por rede, fica sem marca e uma
  // próxima tentativa ainda alcança a pessoa.
  const alcancados = {};

  await Promise.all(pendentes.map(async (a) => {
    const { titulo, texto } = redigir({ ...a, caso_especie: post.especie });
    const carga = JSON.stringify({
      titulo, texto,
      url: `/#/post/${a.caso_id}`,
      tag: `caso-${a.caso_id}`,
      foto: a.caso_foto ? `${url(env)}/storage/v1/object/public/fotos/${a.caso_foto}` : null,
    });

    try {
      const r = await enviarPush(a, carga, vapid);
      if (r.ok) {
        conta[a.motivo] = (conta[a.motivo] || 0) + 1;
        (alcancados[a.motivo] ||= new Set()).add(a.perfil_id);
      } else if (r.morto) {
        mortos.push(a.endpoint);
        (alcancados[a.motivo] ||= new Set()).add(a.perfil_id);  // não adianta insistir
      } else {
        falhas.push(String(r.status));
      }
    } catch (erro) {
      // Sem marca: uma próxima tentativa ainda alcança esta pessoa.
      falhas.push(erro.message.slice(0, 80));
    }
  }));

  await Promise.all([
    ...Object.entries(alcancados).map(([motivo, perfis]) =>
      rpc(env, 'marcar_avisos', { p_post_id: postId, p_perfis: [...perfis], p_motivo: motivo })),
    ...mortos.map((endpoint) => rpc(env, 'push_falhou', { p_endpoint: endpoint, p_morto: true })),
  ]).catch(() => { /* já foi enviado; falhar a marcação não desfaz nada */ });

  return resposta(200, {
    enviados: Object.values(conta).reduce((a, b) => a + b, 0),
    motivos: conta,
    removidos: mortos.length,
    // Só a contagem e um exemplo: o endereço de push identifica a pessoa e
    // não tem por que voltar para quem chamou.
    falharam: falhas.length,
    ...(falhas.length ? { exemplo: falhas[0] } : {}),
  });
}

const resposta = (status, corpo) => new Response(JSON.stringify(corpo), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
