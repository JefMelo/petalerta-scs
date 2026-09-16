/* =============================================================================
   Camada de dados — SUPABASE
   As funções espelham, uma a uma, as funções SQL de supabase/schema-*.sql.
   ============================================================================= */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON } from './config.js?v=84';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

/* Onde o usuário está.
   ehReal diz se veio do GPS ou se ainda é o palpite do Centro. Importa: sem
   isso o feed escreve "310 m de você" para quem pode estar a 5 km dali. */
export const CENTRO = { lat: -29.7182, lng: -52.4306, nome: 'Centro de Santa Cruz do Sul' };
export const ORIGEM = { ...CENTRO, ehReal: false };

const GUARDADO = 'faro:local';
const DISPENSADO = 'faro:local-dispensado';

export function aplicarOrigem({ lat, lng }, ehReal = true) {
  ORIGEM.lat = lat; ORIGEM.lng = lng; ORIGEM.ehReal = ehReal;
  if (ehReal) {
    try { localStorage.setItem(GUARDADO, JSON.stringify({ lat, lng, em: Date.now() })); }
    catch { /* navegador sem armazenamento: só não guarda */ }
  }
}

/** Última posição conhecida, se recente. Evita esperar o GPS a cada abertura. */
export function localGuardado(validadeHoras = 12) {
  try {
    const g = JSON.parse(localStorage.getItem(GUARDADO) || 'null');
    if (!g || Date.now() - g.em > validadeHoras * 3600e3) return null;
    return { lat: g.lat, lng: g.lng };
  } catch { return null; }
}

export const conviteDispensado = () => {
  try { return localStorage.getItem(DISPENSADO) === '1'; } catch { return false; }
};
export const dispensarConvite = () => {
  try { localStorage.setItem(DISPENSADO, '1'); } catch { /* ok */ }
};

/** Estado da permissão SEM disparar o pedido do navegador. */
export async function permissaoDeLocal() {
  if (!navigator.permissions?.query) return 'desconhecida';
  try {
    const s = await navigator.permissions.query({ name: 'geolocation' });
    return s.state;                       // granted | denied | prompt
  } catch { return 'desconhecida'; }
}

/* preciso=false usa a rede: responde em segundos e erra por alguns quarteirões,
   o bastante para "o que está perto de mim". O formulário, que marca o ponto
   exato onde o pet foi visto, pede preciso=true e aceita esperar. */
export async function usarMinhaLocalizacao({ preciso = false } = {}) {
  if (!navigator.geolocation) throw new Error('Este navegador não informa a localização.');
  const pos = await new Promise((ok, erro) =>
    navigator.geolocation.getCurrentPosition(ok, erro, {
      enableHighAccuracy: preciso,
      timeout: preciso ? 15000 : 8000,
      maximumAge: preciso ? 0 : 120000,
    }));
  return { lat: pos.coords.latitude, lng: pos.coords.longitude };
}

/** Pede, adota como origem do app e guarda. É o caminho usado pelo convite. */
export async function adotarMinhaLocalizacao(opcoes) {
  const p = await usarMinhaLocalizacao(opcoes);
  aplicarOrigem(p, true);
  return p;
}

/* Fotos: o banco guarda o caminho dentro do bucket 'fotos'. Os dados de teste
   guardam URL completa — por isso os dois casos são resolvidos aqui. */
function montarFoto(path) {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  return `${SUPABASE_URL}/storage/v1/object/public/fotos/${path}`;
}

const normalizar = (r) => ({ ...r, fotos: (r.fotos || []).map(montarFoto) });

// --- leitura ------------------------------------------------------------------

export async function feedPorRaio({ lat, lng, raioM = 3000, tipos = null } = {}) {
  const { data, error } = await sb.rpc('feed_por_raio', {
    p_lat: lat, p_lng: lng, p_raio_m: raioM,
    ...(tipos ? { p_tipos: tipos } : {}),
  });
  if (error) throw error;
  return data.map((r) => ({ ...normalizar(r), autor_avatar: montarFoto(r.autor_avatar) }));
}

/* Reencontros: casos que terminaram bem. Ordem cronológica, não urgência —
   ver o cabeçalho do schema-17. */
export async function reencontros({ lat, lng, raioM = 20000 } = {}) {
  const { data, error } = await sb.rpc('reencontros', {
    p_lat: lat, p_lng: lng, p_raio_m: raioM,
  });
  if (error) throw new Error(error.message);
  return data.map((r) => ({ ...normalizar(r), autor_avatar: montarFoto(r.autor_avatar) }));
}

/* Quantas fotos ficaram para trás na base inteira — só para o administrador.
   Número, nunca a lista: o caminho do arquivo já diz de quem é a pasta. */
export async function fotosOrfasPendentes() {
  const { data, error } = await sb.rpc('fotos_orfas_pendentes', {});
  if (error) return null;
  return data == null ? null : Number(data);
}

/* QUANTOS FAREJADORES A CIDADE TEM — pessoas distintas que agiram nos últimos
   30 dias (ver o cabeçalho do schema-23).

   Guardado pela sessão inteira: é um número de credibilidade, não de urgência.
   Ninguém precisa que ele mude no meio da rolagem, e refazer a conta a cada
   repintura do feed seria pagar uma consulta por nada.

   Devolve `null` — não zero — quando a consulta falha. Zero é uma afirmação
   ("não há ninguém aqui"); null é a ausência de resposta, e é o que deixa a
   tela simplesmente não mostrar nada em vez de mentir. */
/* O PISO. Contador de comunidade só constrói credibilidade acima de um certo
   número: abaixo dele, "4 farejadores em Santa Cruz do Sul" não diz "entre para
   o grupo", diz "aqui não tem ninguém" — e quem lê isso na primeira visita não
   volta. 50 é escolha do fundador; não é estatística, é onde um número deixa de
   parecer sala vazia e passa a parecer bairro.

   Mora aqui, e não em cada tela, porque duas cópias viram dois valores: o app
   dizendo uma coisa na porta de entrada e outra no feed. */
export const PISO_COMUNIDADE = 50;

let comunidade = null;
export function farejadoresAtivos() {
  if (!comunidade) {
    comunidade = sb.rpc('farejadores_ativos', {})
      .then(({ data, error }) => (error ? null : Number(data)))
      .catch(() => null);
  }
  return comunidade;
}

/* A contagem por trás do pontinho na aba Reencontros. Os mesmos filtros da
   função acima — se contasse diferente do que a aba mostra, o aviso mentiria.
   Nunca derruba nada: sem rede, sem pontinho. */
export async function novosReencontros({ lat, lng, desde, raioM = 20000 } = {}) {
  const { data, error } = await sb.rpc('novos_reencontros', {
    p_lat: lat, p_lng: lng, p_desde: desde, p_raio_m: raioM,
  });
  if (error) throw new Error(error.message);
  return Number(data) || 0;
}

/** mapa_perdidos() — um ponto por caso aberto, na última localização conhecida. */
export async function mapaPerdidos({ lat, lng, raioM = 20000 } = {}) {
  const { data, error } = await sb.rpc('mapa_perdidos', {
    p_lat: lat, p_lng: lng, p_raio_m: raioM,
  });
  if (error) throw new Error(error.message);
  return data.map((r) => ({ ...r, foto: montarFoto(r.foto) }));
}

export async function postPorId(id) {
  const { data, error } = await sb
    .from('posts')
    // A relação precisa ser nomeada: o PostgREST enxerga tanto
    // posts.autor_id -> profiles quanto o caminho indireto por pets (PGRST201).
    .select('*, post_fotos(path, ordem), profiles!posts_autor_id_fkey(nome, avatar_path)')
    .eq('id', id)
    .single();
  if (error) throw error;
  const fotos = (data.post_fotos || []).sort((a, b) => a.ordem - b.ordem);
  return {
    ...data,
    autor_nome: data.profiles?.nome ?? '',
    autor_avatar: montarFoto(data.profiles?.avatar_path),
    fotos: fotos.map((f) => montarFoto(f.path)),
    // o caminho cru também: a edição precisa devolvê-lo ao banco, não a URL
    fotos_path: fotos.map((f) => f.path),
  };
}

export async function rastroDoPost(id) {
  const { data, error } = await sb.rpc('rastro_do_post', { p_post_id: id });
  if (error) throw error;
  return data
    .map((r) => ({ ...r, ehOrigem: r.id === id }))
    .sort((a, b) => Date.parse(b.ocorrido_em) - Date.parse(a.ocorrido_em));
}

export async function contatoDoPost(id) {
  const { data, error } = await sb.rpc('contato_do_post', { p_post_id: id });
  if (error) throw new Error(error.message);
  return data;
}

// --- perfil -------------------------------------------------------------------

export async function perfilPublico(id) {
  const { data, error } = await sb.rpc('perfil_publico', { p_id: id });
  if (error) throw new Error(error.message);
  const p = data?.[0];
  return p ? { ...p, avatar: montarFoto(p.avatar_path) } : null;
}

/** Nome, WhatsApp e foto. A política profiles_self_update cuida do dono. */
export async function atualizarPerfil({ nome, whatsapp, avatarPath }) {
  const { error } = await sb.rpc('atualizar_perfil', {
    p_nome: nome, p_whatsapp: whatsapp || null, p_avatar_path: avatarPath || null,
  });
  if (error) throw new Error(error.message);
  // mantém o nome do menu em dia sem precisar recarregar a página
  await sb.auth.updateUser({ data: { nome: (nome || '').trim() } });
}

/* Vai por RPC, não por select direto: o schema-02 tirou a coluna whatsapp do
   alcance da API para ninguém ler o telefone alheio — e isso alcança o dono
   também. meu_perfil() é security definer e só enxerga a linha de quem chama. */
export async function meuPerfil() {
  if (!meuId()) return null;
  const { data, error } = await sb.rpc('meu_perfil');
  if (error) throw new Error(error.message);
  const p = data?.[0];
  return p ? { ...p, avatar: montarFoto(p.avatar_path) } : null;
}

export async function postsDoPerfil(id, origem = ORIGEM) {
  const { data, error } = await sb.rpc('posts_do_perfil', {
    p_perfil_id: id, p_lat: origem?.lat ?? null, p_lng: origem?.lng ?? null,
  });
  if (error) throw new Error(error.message);
  return data.map((r) => ({ ...r, foto: montarFoto(r.foto) }));
}

// --- escrita ------------------------------------------------------------------

/** Encolhe a foto antes de subir: celular entrega 4 MB, o feed não precisa disso. */
async function encolher(arquivo, lado = 1440, qualidade = 0.82) {
  const bitmap = await createImageBitmap(arquivo);
  const escala = Math.min(1, lado / Math.max(bitmap.width, bitmap.height));
  const l = Math.round(bitmap.width * escala);
  const a = Math.round(bitmap.height * escala);
  const tela = document.createElement('canvas');
  tela.width = l; tela.height = a;
  tela.getContext('2d').drawImage(bitmap, 0, 0, l, a);
  const blob = await new Promise((ok) => tela.toBlob(ok, 'image/jpeg', qualidade));
  bitmap.close?.();
  return blob || arquivo;
}

/** Sobe para o bucket 'fotos'. A política exige a pasta com o id do usuário. */
export async function enviarFoto(arquivo) {
  const uid = sessao?.user?.id;
  if (!uid) throw new Error('Entre na sua conta para enviar foto.');
  const blob = await encolher(arquivo);
  const caminho = `${uid}/${crypto.randomUUID()}.jpg`;
  const { error } = await sb.storage.from('fotos')
    .upload(caminho, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error(error.message);
  return caminho;
}

/** Conta uma pessoa a mais farejando. Deslogado não conta, mas não falha. */
export async function registrarCompartilhamento(id) {
  const { data, error } = await sb.rpc('registrar_compartilhamento', { p_post_id: id });
  if (error) return null;
  return data;
}

/** O que outras pessoas fizeram nos MEUS casos. */
export async function minhasNovidades() {
  if (!sessao) return [];
  const { data, error } = await sb.rpc('minhas_novidades', {});
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({ ...r, caso_foto: montarFoto(r.caso_foto) }));
}

const VISTAS = 'faro:novidades-vistas';
export const novidadesVistasEm = () => {
  try { return localStorage.getItem(VISTAS) || null; } catch { return null; }
};
export const marcarNovidadesVistas = () => {
  try { localStorage.setItem(VISTAS, new Date().toISOString()); } catch { /* ok */ }
};

// --- avisos no celular (web push) ---------------------------------------------

/* A inscrição é do APARELHO, não da conta: o mesmo endereço de push reaparece
   igual a cada visita do mesmo navegador. Por isso `endpoint` é a chave de
   tudo aqui — inclusive para trocar o dono, quando alguém entra com outra
   conta no mesmo celular. */
export async function salvarPush({ endpoint, p256dh, auth, lat, lng, raioM, querBairro }) {
  const { error } = await sb.rpc('salvar_push', {
    p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth,
    p_lat: lat ?? null, p_lng: lng ?? null,
    p_raio_m: raioM ?? null, p_quer_bairro: querBairro !== false,
  });
  if (error) throw new Error(error.message);
}

export async function apagarPush(endpoint) {
  const { error } = await sb.rpc('apagar_push', { p_endpoint: endpoint });
  if (error) throw new Error(error.message);
}

/** O que o banco sabe sobre ESTE aparelho. Null = nunca se inscreveu. */
export async function meuPush(endpoint) {
  const { data, error } = await sb.rpc('meu_push', { p_endpoint: endpoint });
  if (error) throw new Error(error.message);
  return data?.[0] || null;
}

/* Pede ao Worker que mande os avisos deste post. Quem decide quem recebe é o
   banco; daqui só vai o id e o token da sessão, que o Worker confere.

   Nada aqui pode derrubar o que já deu certo: o caso foi publicado, e se o
   aviso falhar o caso continua no feed, no mapa e no link compartilhado. */
export async function dispararAvisos(postId) {
  if (!postId || !sessao?.access_token) return;
  try {
    await fetch('/avisar', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessao.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ post_id: postId }),
    });
  } catch { /* o caso está publicado; o aviso é o que se perde */ }
}

export async function criarPost(campos) {
  const { data, error } = await sb.rpc('criar_post', campos);
  if (error) throw new Error(error.message);
  return data;
}

export async function criarAvistamento(campos) {
  const { data, error } = await sb.rpc('criar_avistamento', campos);
  if (error) throw new Error(error.message);
  return data;
}

export async function editarPost(campos) {
  const { data, error } = await sb.rpc('editar_post', campos);
  if (error) throw new Error(error.message);
  return data;
}

export async function avistamentosLigados(id) {
  const { data, error } = await sb.rpc('avistamentos_ligados', { p_id: id });
  if (error) throw new Error(error.message);
  return data ?? 0;
}

export async function apagarPost(id) {
  /* `apagar_post` copia os nomes dos arquivos para a fila de órfãs ANTES de
     apagar o caso (schema-24) — é o que faz o nome sobreviver à linha que o
     guardava. A limpeza do bucket vem depois e pode falhar sem prejuízo: o que
     ficar para trás é varrido na próxima abertura do app. */
  const { error } = await sb.rpc('apagar_post', { p_id: id });
  if (error) throw new Error(error.message);
  await varrerFotosOrfas();
}

export async function resolverPost(id) {
  const { error } = await sb.rpc('resolver_post', { p_post_id: id });
  if (error) throw new Error(error.message);
}

export async function reabrirPost(id) {
  const { error } = await sb.rpc('reabrir_post', { p_id: id });
  if (error) throw new Error(error.message);
}

/* A LIMPEZA DO BUCKET, COM REDE.

   O problema que isto resolve: o nome do arquivo no Storage só existe em uma
   linha do banco. Apagar o caso (ou trocar a foto do perfil) mata essa linha, e
   se a remoção do arquivo falhar naquele exato segundo — sem rede, app fechado,
   aba morta — ninguém nunca mais descobre que o arquivo existe. A varredura de
   15/09/2026 achou um assim.

   Então o nome é ANOTADO antes, apagado depois, e só esquecido quando o arquivo
   de fato saiu. Uma tentativa que falha deixa a linha na fila, e a próxima
   abertura do app tenta de novo. Sem cron e sem serviço extra: quem criou a
   sobra é exatamente quem volta.

   Só cuida do que é nosso; URL externa (dado de teste) não entra. */
export async function apagarFotosDoBucket(paths = []) {
  const nossas = (paths || []).filter((p) => p && !/^https?:\/\//.test(p));
  if (!nossas.length) return;
  try { await sb.rpc('marcar_fotos_orfas', { p_paths: nossas }); } catch { /* segue */ }
  await varrerFotosOrfas();
}

/* Tira do bucket tudo o que está na fila desta pessoa e só então esquece.
   Nunca lança: é faxina, não pode atrapalhar o que a pessoa veio fazer. */
export async function varrerFotosOrfas() {
  if (!sessao) return 0;
  try {
    const { data, error } = await sb.rpc('minhas_fotos_orfas', {});
    if (error || !data?.length) return 0;

    const { error: falhou } = await sb.storage.from('fotos').remove(data);
    if (falhou) return 0;                 // fica na fila para a próxima vez

    await sb.rpc('esquecer_fotos_orfas', { p_paths: data });
    return data.length;
  } catch { return 0; }
}

// --- sessão -------------------------------------------------------------------

let sessao = null;
let papelCache = null;      // ver meuPapel(), mais abaixo
const ouvintes = new Set();

export const aoMudarSessao = (fn) => { ouvintes.add(fn); fn(sessao); };
const avisar = () => {
  // O papel é da CONTA. Trocar de conta no mesmo navegador sem esquecer isto
  // faria a pessoa nova herdar os poderes da anterior — inclusive os de admin.
  papelCache = null;
  ouvintes.forEach((fn) => fn(sessao));
};

sb.auth.getSession().then(({ data }) => { sessao = data.session; avisar(); });
sb.auth.onAuthStateChange((evento, s) => {
  sessao = s;
  avisar();
  if (evento === 'PASSWORD_RECOVERY') {
    if (ouvintesRecuperacao.size) ouvintesRecuperacao.forEach((fn) => fn());
    else recuperacaoPendente = true;
  }
});

export const estaLogado = () => !!sessao;
export const meuId = () => sessao?.user?.id || null;
export const meuNome = () => sessao?.user?.user_metadata?.nome
  || sessao?.user?.email?.split('@')[0] || '';

export async function entrar(email, senha) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });
  if (error) throw new Error(traduzErroAuth(error.message));
  sessao = data.session; avisar();
  return sessao;
}

/* `papel` e `sobre` vão no metadado, que é escrito pelo CLIENTE — então o
   banco não acredita neles para nada que dê poder. O trigger do schema-14 só
   aceita 'ong' e 'protetor' daqui, e os dois nascem PENDENTES. Administrador
   vem exclusivamente de uma lista de e-mails no servidor. */
export async function criarConta({ nome, whatsapp, email, senha, papel, sobre }) {
  const { data, error } = await sb.auth.signUp({
    email, password: senha,
    options: { data: {
      nome,
      whatsapp: (whatsapp || '').replace(/\D/g, ''),
      ...(papel && papel !== 'farejador' ? { papel, sobre: sobre || '' } : {}),
    } },
  });
  if (error) throw new Error(traduzErroAuth(error.message));
  sessao = data.session; avisar();
  return sessao;                       // null se o projeto exigir confirmar e-mail
}

// --- papel da conta -----------------------------------------------------------

/* O que ESTA conta é. Nulo quando ninguém está logado.
   Guardado em memória porque a tela pergunta várias vezes por carga; zerado a
   cada troca de sessão (ver `avisar`), senão o papel da conta anterior vaza
   para a próxima pessoa que entrar no mesmo navegador. */
export async function meuPapel() {
  if (!sessao) return null;
  if (papelCache) return papelCache;
  const { data, error } = await sb.rpc('meu_papel', {});
  if (error) throw new Error(error.message);
  papelCache = data?.[0] || null;
  return papelCache;
}

export const esquecerPapel = () => { papelCache = null; };

/** Pedido de quem já tem conta e agora quer publicar adoção. */
export async function pedirParaDoar(papel, sobre) {
  const { error } = await sb.rpc('pedir_para_doar', { p_papel: papel, p_sobre: sobre });
  if (error) throw new Error(error.message);
  esquecerPapel();
}

// --- área de busca e desfechos ------------------------------------------------

/* A única pergunta com evidência forte na literatura: gato que não sai de casa
   é achado a 137 m; com acesso à rua, a até 1.609 m (Huang 2018). */
export async function definirAcessoRua(postId, valor) {
  const { error } = await sb.rpc('definir_acesso_rua', { p_post_id: postId, p_valor: valor });
  if (error) throw new Error(error.message);
}

/* O que vira a NOSSA base de calibragem. Tudo opcional — ver o cabeçalho do
   schema-19 para o porquê de nada aqui ser obrigatório. */
export async function registrarDesfecho(postId, { lat, lng, lugar, como } = {}) {
  const { error } = await sb.rpc('registrar_desfecho', {
    p_post_id: postId,
    p_lat: lat ?? null, p_lng: lng ?? null,
    p_lugar: lugar || null, p_como: como || null,
  });
  if (error) throw new Error(error.message);
}

/** Só o administrador. Números agregados, nunca linhas. */
export async function padroesLocais() {
  const { data, error } = await sb.rpc('padroes_locais', {});
  if (error) throw new Error(error.message);
  return data || [];
}

// --- recados do Faro ----------------------------------------------------------

export async function recadosAtivos() {
  const { data, error } = await sb.rpc('recados_ativos', {});
  if (error) return [];          // recado é acessório: nunca derruba o feed
  return (data || []).map((r) => ({ ...r, foto: montarFoto(r.foto_path) }));
}

export async function criarRecado({ titulo, texto, link, linkRotulo, foto }) {
  const { data, error } = await sb.rpc('criar_recado', {
    p_titulo: titulo, p_texto: texto,
    p_link: link || null, p_link_rotulo: linkRotulo || null, p_foto: foto || null });
  if (error) throw new Error(error.message);
  return data;
}

export async function adminRecados() {
  const { data, error } = await sb.rpc('admin_recados', {});
  if (error) throw new Error(error.message);
  return data || [];
}

export async function desligarRecado(id, ativo = false) {
  const { error } = await sb.rpc('desligar_recado', { p_id: id, p_ativo: ativo });
  if (error) throw new Error(error.message);
}

export async function apagarRecado(id) {
  const { error } = await sb.rpc('apagar_recado', { p_id: id });
  if (error) throw new Error(error.message);
}

/* Dispensar é POR APARELHO. Um recado que não se fecha vira cegueira: em duas
   semanas ninguém enxerga mais nada no topo do feed, inclusive o que importa. */
const LIDOS = 'faro:recados-lidos';
export const recadosLidos = () => {
  try { return new Set(JSON.parse(localStorage.getItem(LIDOS) || '[]')); }
  catch { return new Set(); }
};
export const marcarRecadoLido = (id) => {
  try {
    const s = recadosLidos(); s.add(id);
    // Teto: a lista não pode crescer para sempre no armazenamento.
    localStorage.setItem(LIDOS, JSON.stringify([...s].slice(-40)));
  } catch { /* ok */ }
};

// --- administração ------------------------------------------------------------

/* Todas estas RPCs conferem `eh_admin()` na primeira linha, no servidor. O que
   o front faz aqui é só não mostrar botão que vai dar erro — a autorização
   nunca depende do que a tela decidiu esconder. */
export async function adminPendentes() {
  const { data, error } = await sb.rpc('admin_pendentes', {});
  if (error) throw new Error(error.message);
  return data || [];
}

export async function adminDecidir(id, aprovar) {
  const { error } = await sb.rpc('admin_decidir', { p_id: id, p_aprovar: aprovar });
  if (error) throw new Error(error.message);
}

export async function adminContas(busca = null) {
  const { data, error } = await sb.rpc('admin_contas', { p_busca: busca });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function adminMudarPapel(id, papel) {
  const { error } = await sb.rpc('admin_mudar_papel', { p_id: id, p_papel: papel });
  if (error) throw new Error(error.message);
}

/** O telefone de quem nunca publicou. Fica registrado em admin_log. */
export async function adminContato(id) {
  const { data, error } = await sb.rpc('admin_contato', { p_perfil_id: id });
  if (error) throw new Error(error.message);
  return data || null;
}

/** Quem já está aprovado para doar — a lista que o app oferece a quem não pode. */
export async function ongsAtivas() {
  const { data, error } = await sb.rpc('ongs_ativas', {});
  if (error) throw new Error(error.message);
  return (data || []).map((o) => ({ ...o, avatar: montarFoto(o.avatar_path) }));
}

/* Manda o e-mail com o link de volta. redirectTo precisa estar na lista de
   permitidos do projeto (Auth → URL Configuration), senão o link é recusado. */
export async function pedirNovaSenha(email) {
  const { error } = await sb.auth.resetPasswordForEmail((email || '').trim(), {
    redirectTo: `${location.origin}${location.pathname}`,
  });
  if (error) throw new Error(traduzErroAuth(error.message));
}

/** Vale tanto para quem voltou pelo link quanto para quem já está logado. */
export async function trocarSenha(nova) {
  if (!nova || nova.length < 6) throw new Error('A senha precisa de pelo menos 6 caracteres.');
  const { error } = await sb.auth.updateUser({ password: nova });
  if (error) throw new Error(traduzErroAuth(error.message));
}

/* O Supabase avisa com um evento próprio quando a pessoa chega pelo link de
   recuperação. É por aqui que a tela de nova senha aparece — não dá para
   detectar pela URL, porque a biblioteca já a limpou quando o app carrega. */
const ouvintesRecuperacao = new Set();
let recuperacaoPendente = false;

/* Se o evento chegar antes do app registrar o ouvinte, ele fica guardado e é
   entregue na inscrição. Sem isso a tela de nova senha poderia simplesmente
   não aparecer, num fluxo que a pessoa só percorre uma vez e às cegas. */
export const aoRecuperarSenha = (fn) => {
  ouvintesRecuperacao.add(fn);
  if (recuperacaoPendente) { recuperacaoPendente = false; fn(); }
};

export async function sair() {
  await sb.auth.signOut();
  sessao = null; avisar();
}

/* O Supabase responde em inglês; quem usa o app, não fala inglês. */
function traduzErroAuth(msg = '') {
  const m = msg.toLowerCase();
  if (m.includes('invalid login')) return 'E-mail ou senha não conferem.';
  if (m.includes('already registered')) return 'Esse e-mail já tem conta. Tente entrar.';
  if (m.includes('password') && m.includes('6')) return 'A senha precisa de pelo menos 6 caracteres.';
  if (m.includes('email') && m.includes('invalid')) return 'Esse e-mail não parece válido.';
  if (m.includes('rate limit') || m.includes('too many'))
    return 'Muitas tentativas em pouco tempo. Espere alguns minutos.';
  if (m.includes('should be different') || m.includes('same as the old'))
    return 'A senha nova precisa ser diferente da antiga.';
  if (m.includes('redirect') && m.includes('not allowed'))
    return 'O endereço de retorno não está liberado no projeto.';
  return msg;
}
