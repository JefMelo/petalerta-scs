/* =============================================================================
   Faro — perfil
   O próprio e o dos outros usam a MESMA tela. A diferença é só o que aparece
   de ações: quem é dono vê "Sair"; as ações de cada caso ficam no detalhe.
   ============================================================================= */

import { ORIGEM, perfilPublico, postsDoPerfil, meuId, sair, meuPerfil,
         meuPapel, adminPendentes, adminDecidir, adminContas, adminMudarPapel,
         adminContato, adminRecados } from './dados.js?v=44';
import { abrirEditarPerfil, abrirRecado,
         abrirContas as abrirFolhaContas,
         abrirNovoRecado, abrirRecadosDoFaro } from './formularios.js?v=44';
import * as pwa from './pwa.js?v=44';
import { RAIO_AVISO_PADRAO } from './pwa.js?v=44';

const $ = (s, r = document) => r.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let idAtual = null;
let filtro = 'tudo';
let cache = [];

const SELO = { perdido: 'Perdido', avistado: 'Avistado', encontrado: 'Encontrado', adocao: 'Adoção' };

/* A cidade inteira NÃO entra aqui de propósito: alerta municipal não é alerta
   de bairro, é spam com outro nome — e quem o recebe desliga os avisos, e aí
   perde também o aviso do próprio pet, que é a razão de tudo isto existir. */
const RAIOS_AVISO = [[1000, '1 km'], [3000, '3 km'], [5000, '5 km']];

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
      <span class="perfil-avatar" ${perfil.avatar ? 'data-foto' : ''}
            style="--av:${corAvatar(perfil.nome)};${perfil.avatar ? ` background-image:url('${esc(perfil.avatar)}');` : ''}"
            aria-hidden="true">${esc(iniciais(perfil.nome))}</span>
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
      <section class="avisos" id="avisos-bloco" hidden>
        <div class="avisos__linha">
          <p class="avisos__texto">
            <strong>Avisos no celular</strong>
            <span data-avisos-nota></span>
          </p>
          <button class="interruptor" type="button" role="switch" aria-checked="false"
                  data-acao="avisos" aria-label="Receber avisos no celular"><i></i></button>
        </div>
        <div class="avisos__linha avisos__linha--filha" data-bairro hidden>
          <p class="avisos__texto">
            <strong>Alerta de bairro</strong>
            <span>Quando somem pets perto de onde você está.</span>
          </p>
          <button class="interruptor" type="button" role="switch" aria-checked="true"
                  data-acao="bairro" aria-label="Alerta de bairro"><i></i></button>
        </div>
        <div class="avisos__linha avisos__linha--filha" data-area hidden>
          <p class="avisos__texto">
            <strong>Área de aviso</strong>
            <span>Cada aparelho tem a sua — este mede de onde você estava na
                  última vez que abriu o Faro.</span>
          </p>
          <div class="segmentos" role="radiogroup" aria-label="Área de aviso">
            ${RAIOS_AVISO.map(([m, r]) => `
              <button type="button" role="radio" aria-checked="false"
                      data-area-raio="${m}">${r}</button>`).join('')}
          </div>
        </div>
      </section>

      <section class="admin" id="admin-bloco" hidden></section>

      <div class="perfil-acoes">
        <button class="botao-fraco" type="button" data-acao="editar-perfil">Editar perfil</button>
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

  pintarGrade();
  $('#perfil-tela').scrollTop = 0;
  if (souEu) { pintarAvisos(); pintarAdmin(); }
}

// --- administração ------------------------------------------------------------

const PAPEL_ROTULO = { farejador: 'Farejador', protetor: 'Protetor', ong: 'ONG', admin: 'Administrador' };

/* Só aparece para quem é administrador, e a conferência de verdade está no
   servidor: toda RPC admin_* recusa quem não é, mesmo que a tela mostre. */
async function pintarAdmin() {
  const bloco = $('#admin-bloco');
  if (!bloco) return;

  const papel = await meuPapel().catch(() => null);
  if (!papel?.eh_admin) { bloco.hidden = true; return; }

  const pendentes = await adminPendentes().catch(() => []);
  bloco.hidden = false;
  bloco.innerHTML = `
    <h3 class="admin__titulo">Administração</h3>

    <div class="admin__fila">
      <p class="admin__rotulo">
        Pedidos para publicar adoção
        ${pendentes.length ? `<b>${pendentes.length}</b>` : ''}
      </p>
      ${pendentes.length ? pendentes.map(pedidoHTML).join('')
        : '<p class="admin__vazio">Nenhum pedido esperando.</p>'}
    </div>

    <div class="admin__acoes">
      <button class="botao-fraco" type="button" data-admin="contas">Contas</button>
      <button class="botao-fraco" type="button" data-admin="recados">Recados do Faro</button>
    </div>`;
}

/* A ficha traz o que decide: quem é, o que diz fazer e como falar com a pessoa.
   O telefone aparece AQUI e só aqui — é com ele que se confere se a
   organização existe de verdade, e o acesso fica registrado no banco. */
function pedidoHTML(p) {
  return `
  <article class="pedido">
    <header class="pedido__topo">
      <button class="pedido__nome" type="button" data-perfil="${esc(p.id)}">${esc(p.nome)}</button>
      <span class="etiqueta" data-papel="${esc(p.papel)}">${esc(PAPEL_ROTULO[p.papel] || p.papel)}</span>
    </header>
    ${p.cidade ? `<p class="pedido__onde">${esc(p.cidade)}</p>` : ''}
    <p class="pedido__sobre">${esc(p.sobre || 'Não contou nada — vale perguntar antes de aprovar.')}</p>
    <div class="pedido__acoes">
      <button class="botao-fraco" type="button" data-decidir="sim" data-id="${esc(p.id)}">Aprovar</button>
      <button class="botao-fraco" type="button" data-decidir="nao" data-id="${esc(p.id)}">Recusar</button>
      ${p.whatsapp ? `<a class="elo" href="https://wa.me/55${esc(p.whatsapp)}"
           target="_blank" rel="noopener noreferrer">Falar antes</a>` : ''}
    </div>
  </article>`;
}

async function decidir(botao) {
  const aprovar = botao.dataset.decidir === 'sim';
  const id = botao.dataset.id;
  if (!aprovar && !confirm('Recusar? A conta continua valendo como farejador.')) return;

  botao.disabled = true;
  try {
    await adminDecidir(id, aprovar);
  } catch (erro) {
    abrirRecado('Não consegui decidir', erro.message);
  }
  await pintarAdmin();
}

async function verRecados() {
  const lista = await adminRecados().catch((erro) => {
    abrirRecado('Não consegui listar', erro.message);
    return [];
  });
  abrirRecadosDoFaro(lista, {
    aoMudar: verRecados,
    aoNovo: () => abrirNovoRecado({ aoSalvar: verRecados }),
  });
}

/** Abre (ou reabre, depois de uma busca) a folha de contas. */
async function verContas(busca = null) {
  const lista = await adminContas(busca).catch((erro) => {
    abrirRecado('Não consegui listar', erro.message);
    return [];
  });
  abrirFolhaContas(lista, {
    aoBuscar: (termo) => verContas(termo || null),
    aoMudarPapel: async (id, papel) => {
      await adminMudarPapel(id, papel);
      pintarAdmin();            // um pedido a menos na fila, talvez
    },
  });
}

// --- avisos no celular --------------------------------------------------------

/* Um interruptor que mente é pior que não existir: ele fica onde o APARELHO
   está de fato, conferido no navegador e no banco, e não onde a última ação
   do usuário sugeriu. */
async function pintarAvisos() {
  const bloco = $('#avisos-bloco');
  if (!bloco) return;

  const e = await pwa.estadoDosAvisos().catch(() => null);
  if (!e) return;
  bloco.hidden = false;

  const chave  = bloco.querySelector('[data-acao="avisos"]');
  const nota   = bloco.querySelector('[data-avisos-nota]');
  const bairro = bloco.querySelector('[data-bairro]');

  if (!e.suportado) {
    chave.disabled = true;
    chave.setAttribute('aria-checked', 'false');
    nota.textContent = e.motivo;
    bairro.hidden = true;
    return;
  }

  if (e.bloqueado) {
    chave.disabled = true;
    chave.setAttribute('aria-checked', 'false');
    nota.textContent = 'Bloqueado neste navegador. Para reverter, é nas configurações do site.';
    bairro.hidden = true;
    return;
  }

  chave.disabled = false;
  chave.setAttribute('aria-checked', String(!!e.ligado));
  nota.textContent = e.ligado
    ? 'Quando avistarem um pet seu, ou um caso que você ajuda andar.'
    : 'Saber na hora em que alguém vir o seu pet.';

  bairro.hidden = !e.ligado;
  bairro.querySelector('.interruptor').setAttribute('aria-checked', String(!!e.querBairro));

  /* O raio já vinha do banco em estadoDosAvisos() e a tela o IGNORAVA — o texto
     dizia "3 km" fixo mesmo para quem tivesse outro valor gravado. */
  const area = bloco.querySelector('[data-area]');
  area.hidden = !(e.ligado && e.querBairro);
  area.querySelectorAll('[data-area-raio]').forEach((b) => {
    b.setAttribute('aria-checked', String(Number(b.dataset.areaRaio) === (e.raioM || RAIO_AVISO_PADRAO)));
  });
}

/** O raio que está marcado na tela; o padrão quando ainda não há nenhum. */
function raioMarcado() {
  const m = $('#avisos-bloco [data-area-raio][aria-checked="true"]');
  return m ? Number(m.dataset.areaRaio) : RAIO_AVISO_PADRAO;
}

/* Mudar a área grava na hora. Enquanto o banco não responde, os três botões
   ficam travados — senão dois toques rápidos mandam dois valores e o último a
   chegar vence, que não é necessariamente o último tocado. */
async function mudarArea(botao) {
  const novo = Number(botao.dataset.areaRaio);
  const grupo = botao.closest('.segmentos');
  grupo.querySelectorAll('button').forEach((b) => { b.disabled = true; });

  try {
    await pwa.mudarBairro(true, novo);
  } catch (erro) {
    abrirRecado('Não consegui mudar a área', erro.message);
  }
  grupo.querySelectorAll('button').forEach((b) => { b.disabled = false; });
  await pintarAvisos();
}

async function virarChave(botao) {
  const ligado = botao.getAttribute('aria-checked') === 'true';
  botao.disabled = true;

  try {
    if (botao.dataset.acao === 'bairro') {
      await pwa.mudarBairro(!ligado, raioMarcado());
    } else if (ligado) {
      await pwa.desligarAvisos();
    } else {
      const r = await pwa.ligarAvisos({ raioM: raioMarcado() });
      if (!r.ok && r.motivo === 'bloqueado') {
        abrirRecado('Avisos bloqueados',
          'Este navegador já tinha recusado os avisos do Faro. Dá para reverter nas '
          + 'configurações do site, no cadeado ao lado do endereço.');
      }
    }
  } catch (erro) {
    abrirRecado('Não consegui mudar isso', erro.message);
  }

  botao.disabled = false;
  await pintarAvisos();
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

// --- cliques ------------------------------------------------------------------

/* UM ouvinte, no documento, registrado uma vez quando o módulo carrega.
   Antes ele era registrado dentro de abrir() — e como recarregar() chama
   abrir() de novo, eles se acumulavam: depois de N aberturas do perfil, um
   toque em "Sair" empilhava N confirmações, e um toque numa ação de
   administrador a executaria N vezes. Um `addEventListener` dentro de uma
   função que roda mais de uma vez é sempre isto. */
document.addEventListener('click', (ev) => {
  if (!ev.target.closest('#perfil-corpo')) return;

  const aba = ev.target.closest('[data-filtro]');
  if (aba) {
    filtro = aba.dataset.filtro;
    $('#perfil-corpo').querySelectorAll('[data-filtro]').forEach((b) =>
      b.setAttribute('aria-pressed', b === aba));
    pintarGrade();
    return;
  }

  if (ev.target.closest('[data-acao="editar-perfil"]')) {
    meuPerfil().then((eu) => abrirEditarPerfil(eu, { aoSalvar: recarregar }));
    return;
  }

  const chave = ev.target.closest('[data-acao="avisos"],[data-acao="bairro"]');
  if (chave) { virarChave(chave); return; }

  const area = ev.target.closest('[data-area-raio]');
  if (area) { mudarArea(area); return; }

  const decisao = ev.target.closest('[data-decidir]');
  if (decisao) { decidir(decisao); return; }

  if (ev.target.closest('[data-admin="contas"]'))  { verContas(); return; }
  if (ev.target.closest('[data-admin="recados"]')) { verRecados(); return; }

  if (ev.target.closest('[data-acao="sair"]')) {
    if (confirm('Sair da conta?')) sair().then(() => { fechar(); location.hash = '#/'; });
  }
});
