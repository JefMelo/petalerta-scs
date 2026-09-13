/* =============================================================================
   Camada de dados — SUPABASE
   As funções espelham, uma a uma, as funções SQL de supabase/schema-*.sql.
   ============================================================================= */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON } from './config.js?v=23';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

/* Onde o usuário está.
   ehReal diz se veio do GPS ou se ainda é o palpite do Centro. Importa: sem
   isso o feed escreve "310 m de você" para quem pode estar a 5 km dali. */
export const ORIGEM = { lat: -29.7182, lng: -52.4306, ehReal: false };

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
  return data.map(normalizar);
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
    .select('*, post_fotos(path, ordem), profiles!posts_autor_id_fkey(nome)')
    .eq('id', id)
    .single();
  if (error) throw error;
  const fotos = (data.post_fotos || []).sort((a, b) => a.ordem - b.ordem);
  return {
    ...data,
    autor_nome: data.profiles?.nome ?? '',
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
  return data?.[0] || null;
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
  // Tira as imagens do bucket antes: depois do delete não dá mais para saber
  // quais eram, e elas ficariam ocupando espaço para sempre.
  let paths = [];
  try {
    const { data } = await sb.from('post_fotos').select('path').eq('post_id', id);
    paths = (data || []).map((f) => f.path);
  } catch { /* sem as fotos ainda dá para apagar o post */ }

  const { error } = await sb.rpc('apagar_post', { p_id: id });
  if (error) throw new Error(error.message);
  await apagarFotosDoBucket(paths);
}

export async function resolverPost(id) {
  const { error } = await sb.rpc('resolver_post', { p_post_id: id });
  if (error) throw new Error(error.message);
}

export async function reabrirPost(id) {
  const { error } = await sb.rpc('reabrir_post', { p_id: id });
  if (error) throw new Error(error.message);
}

/** Só apaga o que está no bucket; URL externa (dado de teste) não é nossa. */
export async function apagarFotosDoBucket(paths = []) {
  const nossas = paths.filter((p) => p && !/^https?:\/\//.test(p));
  if (!nossas.length) return;
  try { await sb.storage.from('fotos').remove(nossas); } catch { /* não bloqueia */ }
}

// --- sessão -------------------------------------------------------------------

let sessao = null;
const ouvintes = new Set();

export const aoMudarSessao = (fn) => { ouvintes.add(fn); fn(sessao); };
const avisar = () => ouvintes.forEach((fn) => fn(sessao));

sb.auth.getSession().then(({ data }) => { sessao = data.session; avisar(); });
sb.auth.onAuthStateChange((_e, s) => { sessao = s; avisar(); });

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

export async function criarConta({ nome, whatsapp, email, senha }) {
  const { data, error } = await sb.auth.signUp({
    email, password: senha,
    options: { data: { nome, whatsapp: (whatsapp || '').replace(/\D/g, '') } },
  });
  if (error) throw new Error(traduzErroAuth(error.message));
  sessao = data.session; avisar();
  return sessao;                       // null se o projeto exigir confirmar e-mail
}

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
  return msg;
}
