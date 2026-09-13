/* =============================================================================
   Farejo — perfil
   O próprio e o dos outros usam a MESMA tela. A diferença é só o que aparece
   de ações: quem é dono vê "Sair"; as ações de cada caso ficam no detalhe.
   ============================================================================= */

import { ORIGEM, perfilPublico, postsDoPerfil, meuId, sair } from './dados.js?v=17';

const $ = (s, r = document) => r.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let idAtual = null;
let filtro = 'tudo';
let cache = [];

const SELO = { perdido: 'Perdido', avistado: 'Avistado', encontrado: 'Encontrado', adocao: 'Adoção' };

const iniciais = (nome) => (nome || '?').trim().split(/\s+/).slice(0, 2)
  .map((n) => n[0]).join('').toUpperCase();

const TONS = ['#FCE9D8', '#DDEDF7', '#DCEFE5', '#EFE4F5', '#F6E7E7', '#E7EBF0'];
const corAvatar = (nome) =>
  TONS[[...(nome || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % TONS.length];

function fmtTempo(iso) {
  const min = (Date.now() - Date.parse(iso)) / 60000;
  if (min < 60)   return `há ${Math.max(1, Math.round(min))} min`;
  const h = Math.round(min / 60);
  if (h < 24)     return `há ${h} h`;
  const d = Math.round(min / 1440);
  if (d === 1)    return 'ontem';
  if (d < 30)     return `há ${d} dias`;
  return new Date(iso).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
}

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const IC_PILHA = svg('<rect x="8" y="3" width="13" height="13" rx="2"/><path d="M16 19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2"/>');
const IC_SEMFOTO = svg('<path d="M3 3l18 18"/><path d="M21 15V7a2 2 0 0 0-2-2H9"/><path d="M3 7v12a2 2 0 0 0 2 2h14"/>');

// --- grade --------------------------------------------------------------------

function celulaHTML(p) {
  const resolvido = p.status === 'resolvido';
  const fundo = p.foto
    ? `<span class="celula__foto" style="background-image:url('${esc(p.foto)}')"></span>`
    : `<span class="celula__foto celula__foto--sem">${IC_SEMFOTO}</span>`;

  return `
  <button class="celula ${resolvido ? 'celula--resolvida' : ''}" type="button"
          data-abrir="${p.id}" aria-label="${esc(p.titulo)}">
    ${fundo}
    <span class="celula__tipo" data-tipo="${p.tipo}">${SELO[p.tipo]}</span>
    ${p.n_fotos > 1 ? `<span class="celula__pilha" aria-hidden="true">${IC_PILHA}</span>` : ''}
    ${resolvido ? '<span class="celula__fita">Encerrado</span>' : ''}
    <span class="celula__rodape">
      <strong>${esc(p.titulo)}</strong>
      <em>${p.post_origem_id ? `em ${esc(p.origem_titulo || 'outro caso')}` : fmtTempo(p.ocorrido_em)}</em>
    </span>
  </button>`;
}

function pintarGrade() {
  const lista = cache.filter((p) =>
    filtro === 'tudo' ? true
    : filtro === 'abertos' ? p.status === 'aberto'
    : filtro === 'encerrados' ? p.status === 'resolvido'
    : p.post_origem_id != null);

  const grade = $('#perfil-grade');
  if (!lista.length) {
    grade.innerHTML = `<p class="perfil-vazio">${
      filtro === 'tudo' ? 'Ainda não publicou nada.' : 'Nada nesta aba.'}</p>`;
    return;
  }
  grade.innerHTML = `<div class="grade">${lista.map(celulaHTML).join('')}</div>`;
}

// --- tela ---------------------------------------------------------------------

export async function abrir(id) {
  const tela = $('#perfil-tela');
  tela.hidden = false;
  document.body.style.overflow = 'hidden';
  idAtual = id;
  filtro = 'tudo';

  $('#perfil-corpo').innerHTML = '<p class="perfil-vazio">Carregando…</p>';

  let perfil, posts;
  try {
    [perfil, posts] = await Promise.all([perfilPublico(id), postsDoPerfil(id, ORIGEM)]);
  } catch (e) {
    $('#perfil-corpo').innerHTML = `<p class="perfil-vazio">Não consegui abrir este perfil.<br>${esc(e.message)}</p>`;
    return;
  }
  if (!perfil) {
    $('#perfil-corpo').innerHTML = '<p class="perfil-vazio">Esse perfil não existe mais.</p>';
    return;
  }

  cache = posts;
  const souEu = meuId() === id;
  $('#perfil-nome').textContent = perfil.nome;

  $('#perfil-corpo').innerHTML = `
    <header class="perfil-topo">
      <span class="perfil-avatar" style="--av:${corAvatar(perfil.nome)}" aria-hidden="true">${esc(iniciais(perfil.nome))}</span>
      <dl class="perfil-numeros">
        <div><dt>casos</dt><dd>${perfil.n_casos}</dd></div>
        <div><dt>avisos</dt><dd>${perfil.n_avistamentos}</dd></div>
        <div><dt>reencontros</dt><dd>${perfil.n_reencontros}</dd></div>
      </dl>
    </header>

    <div class="perfil-id">
      <strong>${esc(perfil.nome)}</strong>
      <span>${esc(perfil.cidade || '')} · desde ${new Date(perfil.desde)
        .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</span>
    </div>

    ${souEu ? `
      <div class="perfil-acoes">
        <button class="botao-fraco" type="button" data-acao="sair">Sair da conta</button>
      </div>
    ` : `
      <p class="perfil-ajuda">Para falar com ${esc(perfil.nome.split(' ')[0])},
         abra um dos casos abaixo — o contato fica lá.</p>
    `}

    <nav class="perfil-abas" aria-label="Filtrar">
      <button type="button" data-filtro="tudo" aria-pressed="true">Tudo</button>
      <button type="button" data-filtro="abertos">Abertos</button>
      <button type="button" data-filtro="encerrados">Encerrados</button>
      <button type="button" data-filtro="avisos">Avisos que deu</button>
    </nav>

    <div id="perfil-grade"></div>`;

  $('#perfil-corpo').addEventListener('click', (ev) => {
    const aba = ev.target.closest('[data-filtro]');
    if (aba) {
      filtro = aba.dataset.filtro;
      $('#perfil-corpo').querySelectorAll('[data-filtro]').forEach((b) =>
        b.setAttribute('aria-pressed', b === aba));
      pintarGrade();
      return;
    }
    if (ev.target.closest('[data-acao="sair"]')) {
      if (confirm('Sair da conta?')) sair().then(() => { fechar(); location.hash = '#/'; });
    }
  });

  pintarGrade();
  $('#perfil-tela').scrollTop = 0;
}

export function fechar() {
  $('#perfil-tela').hidden = true;
  document.body.style.overflow = '';
  idAtual = null;
}

export const estaAberto = () => !$('#perfil-tela')?.hidden;
export const perfilAberto = () => idAtual;

/** Rechama a carga depois de editar, encerrar ou apagar algo. */
export async function recarregar() {
  if (idAtual) await abrir(idAtual);
}
