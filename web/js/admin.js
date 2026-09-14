/* =============================================================================
   Faro — área do administrador

   POR QUE É UMA TELA E NÃO UM BLOCO NO PERFIL
   Na primeira versão isso morava dentro do perfil, e a mesma tela dizia duas
   coisas ao mesmo tempo: "estes são os SEUS casos" e "estas são as contas de
   TODO MUNDO". Perfil é identidade; administração é poder sobre a identidade
   dos outros. Empilhar as duas no mesmo lugar confunde justamente na hora em
   que confundir custa caro — apagar, aprovar, mudar papel.

   Entra-se por um ícone no topo do próprio perfil, e só quem é administrador
   o vê. A conferência de verdade continua no servidor: toda RPC `admin_*`
   recusa quem não é, mesmo que a tela mostre o botão.
   ============================================================================= */

import { adminPendentes, adminDecidir, adminContas, adminMudarPapel,
         adminRecados, desligarRecado, apagarRecado, meuPapel,
         padroesLocais } from './dados.js?v=53';
import { abrirRecado, abrirNovoRecado } from './formularios.js?v=53';

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PAPEL_ROTULO = { farejador: 'Farejador', protetor: 'Protetor', ong: 'ONG', admin: 'Administrador' };
const PAPEIS = ['farejador', 'protetor', 'ong', 'admin'];

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

let aba = 'pedidos';
let busca = null;

export const estaAberto = () => !$('#admin-tela')?.hidden;

// --- abrir e fechar -----------------------------------------------------------

export async function abrir() {
  const papel = await meuPapel().catch(() => null);
  if (!papel?.eh_admin) {
    // Não é erro do usuário: é uma rota que ele não devia ter alcançado.
    location.hash = '#/';
    return;
  }

  $('#admin-tela').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#admin-tela').scrollTop = 0;
  await pintar();
}

export function fechar() {
  const t = $('#admin-tela');
  if (!t || t.hidden) return;
  t.hidden = true;
  document.body.style.overflow = '';
}

// --- a tela -------------------------------------------------------------------

async function pintar() {
  const corpo = $('#admin-corpo');
  corpo.innerHTML = '<p class="admin__vazio">Carregando…</p>';

  const pendentes = await adminPendentes().catch(() => []);

  corpo.innerHTML = `
    <nav class="perfil-abas" aria-label="Seções da administração">
      <button type="button" data-aba-adm="pedidos" aria-pressed="${aba === 'pedidos'}">
        Pedidos${pendentes.length ? ` (${pendentes.length})` : ''}
      </button>
      <button type="button" data-aba-adm="contas" aria-pressed="${aba === 'contas'}">Contas</button>
      <button type="button" data-aba-adm="recados" aria-pressed="${aba === 'recados'}">Recados</button>
      <button type="button" data-aba-adm="padroes" aria-pressed="${aba === 'padroes'}">Padrões</button>
    </nav>
    <div id="admin-conteudo"></div>`;

  await pintarConteudo(pendentes);
}

async function pintarConteudo(pendentes = null) {
  const alvo = $('#admin-conteudo');
  if (!alvo) return;
  alvo.innerHTML = '<p class="admin__vazio">Carregando…</p>';

  if (aba === 'pedidos') {
    const lista = pendentes || await adminPendentes().catch(() => []);
    alvo.innerHTML = lista.length
      ? `<p class="admin__rotulo">Quem pediu para publicar adoção</p>${lista.map(pedidoHTML).join('')}`
      : `<p class="admin__vazio">Nenhum pedido esperando.</p>`;
    return;
  }

  if (aba === 'contas') {
    const lista = await adminContas(busca).catch(() => []);
    alvo.innerHTML = `
      <label class="campo">
        <span class="campo__rotulo">Procurar pelo nome</span>
        <input name="busca" autocomplete="off" value="${esc(busca || '')}">
      </label>
      <div class="contas">
        ${lista.length ? lista.map(contaHTML).join('')
          : '<p class="admin__vazio">Nenhuma conta com esse nome.</p>'}
      </div>`;
    return;
  }

  if (aba === 'padroes') { await pintarPadroes(alvo); return; }

  const lista = await adminRecados().catch(() => []);
  alvo.innerHTML = `
    <p class="admin__rotulo">Aparecem no meio do feed, como anúncio</p>
    <button class="botao-fraco" type="button" data-novo-recado>Escrever um recado</button>
    <div class="contas">
      ${lista.length ? lista.map(recadoHTML).join('')
        : '<p class="admin__vazio">Nenhum recado ainda.</p>'}
    </div>`;
}

/* A ficha traz o que decide: quem é, o que diz fazer, e como falar com a
   pessoa ANTES de decidir — aprovar quem entrega animal é decisão séria. */
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

function contaHTML(c) {
  return `
  <article class="conta">
    <button class="conta__nome" type="button" data-perfil="${esc(c.id)}">${esc(c.nome)}</button>
    <p class="conta__dados">
      ${c.n_casos} ${c.n_casos === 1 ? 'caso' : 'casos'}
      ${c.cidade ? ` · ${esc(c.cidade)}` : ''}
      ${!c.aprovado ? ' · <b>esperando aprovação</b>' : ''}
    </p>
    <select class="conta__papel" data-papel-de="${esc(c.id)}" aria-label="Papel de ${esc(c.nome)}">
      ${PAPEIS.map((v) => `
        <option value="${v}" ${v === c.papel ? 'selected' : ''}>${esc(PAPEL_ROTULO[v])}</option>`).join('')}
    </select>
  </article>`;
}

function recadoHTML(r) {
  return `
  <article class="conta">
    <p class="conta__nome">${esc(r.titulo)}</p>
    <p class="conta__dados">
      ${r.ativo ? 'no ar' : '<b>desligado</b>'}
      ${r.foto_path ? ' · com foto' : ''}
      ${r.link ? ` · ${esc(hospedeiro(r.link))}` : ''}
    </p>
    <div class="conta__acoes">
      <button class="botao-fraco" type="button"
              data-recado-virar="${esc(r.id)}" data-ativo="${r.ativo ? '1' : '0'}">
        ${r.ativo ? 'Desligar' : 'Religar'}
      </button>
      <button class="botao-fraco" type="button" data-recado-apagar="${esc(r.id)}">Apagar</button>
    </div>
  </article>`;
}

const hospedeiro = (u) => { try { return new URL(u).hostname; } catch { return u; } };

// --- os nossos próprios padrões -----------------------------------------------

/* Os números de hoje vêm de Ohio (2007) e da Austrália (2018). Esta tela existe
   para o dia em que forem de Santa Cruz do Sul.

   MOSTRA O `n` SEMPRE. Mediana de três amostras não é padrão, é ruído com cara
   de conclusão — o mesmo erro do "70% de chance" que este trabalho recusou. */
const MINIMO = 30;

const PUBLICADO = {
  'gato, não sai':    { dist: '137 m (mediana)',  fonte: 'Huang 2018, n=1.210' },
  'gato, sai na rua': { dist: '1.609 m (75%)',    fonte: 'Huang 2018, n=1.210' },
  'cão':              { dist: '1.609 m (71%)',    fonte: 'Lord 2007b, n=187' },
};

const LUGAR_ROTULO = {
  quintal_alheio: 'quintal de alguém', porta_de_casa: 'porta de casa', mato: 'mato',
  varanda: 'varanda ou deck', casa_alheia: 'casa de outra pessoa',
  propria_casa: 'a própria casa', rua: 'na rua', recolhido: 'alguém recolheu', outro: 'outro',
};

const metros = (m) => (m == null ? '—' : m < 950 ? `${Math.round(m)} m`
  : `${(m / 1000).toFixed(1).replace('.', ',')} km`);

const rosa = (g) => {
  if (g == null) return '—';
  const pontos = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
  return `${pontos[Math.round(g / 45) % 8]} (${Math.round(g)}°)`;
};

async function pintarPadroes(alvo) {
  const linhas = await padroesLocais().catch(() => []);
  const total = linhas.reduce((a, l) => a + Number(l.n), 0);

  alvo.innerHTML = `
    <p class="admin__rotulo">O que os nossos casos já dizem</p>
    <p class="admin__vazio">
      ${total === 0
        ? 'Nenhum caso encerrado com resposta ainda. Cada um que chegar entra aqui.'
        : `${total} ${total === 1 ? 'caso encerrado' : 'casos encerrados'} com alguma resposta.`}
    </p>

    ${linhas.map((l) => {
      const poucos = Number(l.n) < MINIMO;
      const ref = PUBLICADO[l.faixa];
      return `
      <article class="padrao">
        <header class="padrao__topo">
          <strong>${esc(l.faixa)}</strong>
          <span class="etiqueta">n = ${l.n}</span>
        </header>
        ${poucos ? `<p class="padrao__aviso">
          Ainda não dá para concluir nada — faltam ${MINIMO - Number(l.n)} casos.
          Os números abaixo são o que temos, não um padrão.
        </p>` : ''}
        <dl class="padrao__numeros">
          <div><dt>mediana da distância</dt><dd>${metros(l.mediana_m)}</dd></div>
          <div><dt>75% até</dt><dd>${metros(l.p75_m)}</dd></div>
          <div><dt>mediana do tempo</dt><dd>${l.mediana_h == null ? '—'
            : Number(l.mediana_h) < 48 ? `${Math.round(l.mediana_h)} h`
            : `${Math.round(l.mediana_h / 24)} dias`}</dd></div>
          <div><dt>lugar mais comum</dt><dd>${LUGAR_ROTULO[l.lugar_comum] || '—'}</dd></div>
          <div><dt>rumo predominante</dt><dd>${rosa(l.rumo_medio)}</dd></div>
        </dl>
        ${ref ? `<p class="padrao__ref">Publicado: <b>${ref.dist}</b> · ${ref.fonte}</p>` : ''}
      </article>`;
    }).join('')}

    <p class="padrao__nota">
      As duas últimas linhas — <b>lugar</b> e <b>rumo</b> — são o que só nós
      podemos responder. Nenhum estudo publicado sabe dos quintais e dos arroios
      daqui. Quando houver base, estes números substituem os de fora em
      <code>area-busca.js</code>.
    </p>`;
}

// --- ações --------------------------------------------------------------------

async function decidir(botao) {
  const aprovar = botao.dataset.decidir === 'sim';
  if (!aprovar && !confirm('Recusar? A conta continua valendo como farejador.')) return;

  botao.disabled = true;
  try {
    await adminDecidir(botao.dataset.id, aprovar);
  } catch (erro) {
    abrirRecado('Não consegui decidir', erro.message);
  }
  await pintar();
}

/* UM ouvinte, registrado uma vez quando o módulo carrega. Dentro de uma função
   que roda mais de uma vez, `addEventListener` acumula — e numa tela de
   administração isso significaria a mesma aprovação disparada N vezes. */
document.addEventListener('click', async (ev) => {
  if (!ev.target.closest('#admin-tela')) return;

  const t = ev.target.closest('[data-aba-adm]');
  if (t) {
    aba = t.dataset.abaAdm;
    $$('#admin-tela [data-aba-adm]').forEach((b) => b.setAttribute('aria-pressed', b === t));
    pintarConteudo();
    return;
  }

  if (ev.target.closest('[data-acao="fechar-admin"]')) { location.hash = '#/'; return; }

  const d = ev.target.closest('[data-decidir]');
  if (d) { decidir(d); return; }

  if (ev.target.closest('[data-novo-recado]')) {
    abrirNovoRecado({ aoSalvar: () => { aba = 'recados'; pintarConteudo(); } });
    return;
  }

  const virar = ev.target.closest('[data-recado-virar]');
  if (virar) {
    virar.disabled = true;
    try { await desligarRecado(virar.dataset.recadoVirar, virar.dataset.ativo !== '1'); }
    catch (erro) { abrirRecado('Não consegui', erro.message); }
    pintarConteudo();
    return;
  }

  const apagar = ev.target.closest('[data-recado-apagar]');
  if (apagar && confirm('Apagar este recado? Não dá para desfazer.')) {
    try { await apagarRecado(apagar.dataset.recadoApagar); }
    catch (erro) { abrirRecado('Não consegui', erro.message); }
    pintarConteudo();
  }
});

document.addEventListener('change', async (ev) => {
  if (!ev.target.closest('#admin-tela')) return;
  const alvo = ev.target.closest('[data-papel-de]');
  if (!alvo) return;
  alvo.disabled = true;
  try {
    await adminMudarPapel(alvo.dataset.papelDe, alvo.value);
  } catch (erro) {
    abrirRecado('Não consegui mudar', erro.message);
  }
  alvo.disabled = false;
  pintar();                       // a fila pode ter mudado junto
});

/* Busca conforme digita, sem botão — espera a pessoa parar de teclar. */
let tempo;
document.addEventListener('input', (ev) => {
  if (!ev.target.closest('#admin-tela') || ev.target.name !== 'busca') return;
  clearTimeout(tempo);
  const termo = ev.target.value;
  tempo = setTimeout(() => { busca = termo || null; pintarConteudo(); }, 350);
});
