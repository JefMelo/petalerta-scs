/* =============================================================================
   Faro — interface
   ============================================================================= */

import { ORIGEM, feedPorRaio, reencontros, postPorId, rastroDoPost, contatoDoPost,
         aoMudarSessao, estaLogado, meuId, meuNome,
         aplicarOrigem, localGuardado, permissaoDeLocal, adotarMinhaLocalizacao,
         conviteDispensado, dispensarConvite,
         registrarCompartilhamento, minhasNovidades,
         novidadesVistasEm, marcarNovidadesVistas, CENTRO,
         aoRecuperarSenha, meuPapel, recadosAtivos, recadosLidos,
         marcarRecadoLido } from './dados.js?v=46';
import * as form from './formularios.js?v=46';
import * as mapaTela from './mapa.js?v=46';
import * as perfilTela from './perfil.js?v=46';
import * as pwa from './pwa.js?v=46';

// MARCA — nome de trabalho. Trocar aqui e em .marca no CSS/HTML. -------------
export const MARCA = { nome: 'Faro', cidade: 'Santa Cruz do Sul' };

/* Três destinos, não um filtro. `rotear()` é a ÚNICA coisa que muda `aba` —
   antes, `tipo` era mutável por clique solto, e um toque na legenda de um post
   trocava o filtro do feed em silêncio (o `<article class="post" data-tipo>`
   casava com o mesmo seletor do delegador). */
const ABAS = {
  buscas: {
    hash: '#/', rotulo: 'Buscas',
    tipos: ['perdido', 'avistado', 'encontrado'],
  },
  adocao: {
    hash: '#/adocao', rotulo: 'Adoção',
    tipos: ['adocao'],
    // Adotar não é urgência de quarteirão, e página vazia afasta mais que
    // caso distante. Estas duas abas varrem a cidade inteira.
    raio: 20000,
  },
  reencontros: {
    hash: '#/reencontros', rotulo: 'Reencontros',
    tipos: null,                                  // função própria
    raio: 20000,
  },
};

const estado = { raioM: 3000, aba: 'buscas' };

/* Se ESTA conta modera. Só muda o que a tela oferece — a autorização de
   verdade está no RLS e nas RPCs, que recusam mesmo com o botão na mão. */
let souAdmin = false;

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// --- linguagem ----------------------------------------------------------------

/* Sem GPS, a origem é o Centro — e dizer "de você" seria mentira para quem
   está a 5 km dali. O rótulo conta de onde a conta foi feita. */
const deOndeVem = () => (ORIGEM.ehReal ? 'de você' : 'do Centro');

function fmtDistancia(m) {
  if (m < 950) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

/** Por extenso, como uma pessoa escreveria. "há 2 h" é abreviação de painel. */
function fmtTempo(iso) {
  const min = (Date.now() - Date.parse(iso)) / 60000;
  if (min < 2)    return 'agora mesmo';
  if (min < 60)   return `há ${Math.round(min)} minutos`;
  const h = Math.round(min / 60);
  if (h < 24)     return h === 1 ? 'há 1 hora' : `há ${h} horas`;
  const d = Math.round(min / 1440);
  if (d === 1)    return 'ontem';
  if (d < 30)     return `há ${d} dias`;
  const mes = Math.round(d / 30);
  return mes === 1 ? 'há 1 mês' : `há ${mes} meses`;
}

/* Um caso com avistamento tem duas datas: quando sumiu e quando foi visto pela
   última vez. Mostrar "sumiu há 3 dias" num pet avistado há 20 minutos esconde
   justamente a informação que faz alguém sair de casa. */
function quando(p) {
  return p.n_avistados > 0 && p.atualizado_em
    ? `visto ${fmtTempo(p.atualizado_em)}`
    : fmtTempo(p.ocorrido_em);
}

const fmtData = (iso) => new Date(iso).toLocaleString('pt-BR',
  { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const SELO    = { perdido: 'Perdido', avistado: 'Avistado', encontrado: 'Encontrado', adocao: 'Adoção' };

/* Sem isto, a regra "só ONG publica adoção" é invisível: some uma opção do
   formulário e nada aparece em troca. O selo é o que a explica ao leitor.
   Farejador não tem selo — o normal não precisa de etiqueta. */
const SELO_PAPEL = { ong: 'ONG', protetor: 'Protetor', admin: 'Faro' };
const ESPECIE = { cao: 'cão', gato: 'gato', outro: 'pet' };
const PORTE   = { pequeno: 'porte pequeno', medio: 'porte médio', grande: 'porte grande' };
const SEXO    = { macho: 'macho', femea: 'fêmea', desconhecido: '' };

function tracos(p) {
  const cauda = [p.raca, SEXO[p.sexo], PORTE[p.porte]].filter(Boolean).join(', ');
  return cauda ? `${ESPECIE[p.especie]} · ${cauda.toLowerCase()}` : ESPECIE[p.especie];
}

/** "o Thor" / "a Mel" / "esse pet" — o artigo vem do sexo do animal. */
function comArtigo(p) {
  if (p.sexo === 'femea') return `a ${p.titulo}`;
  if (p.sexo === 'macho') return `o ${p.titulo}`;
  return 'esse pet';
}

const iniciais = (nome) => (nome || '?').trim().split(/\s+/).slice(0, 2)
  .map((n) => n[0]).join('').toUpperCase();

const TONS = ['#FCE9D8', '#DDEDF7', '#DCEFE5', '#EFE4F5', '#F6E7E7', '#E7EBF0'];
const corAvatar = (nome) =>
  TONS[[...(nome || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % TONS.length];

// --- ícones -------------------------------------------------------------------

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const IC = {
  olho:     svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'),
  conversa: svg('<path d="M21 11.5a8.4 8.4 0 0 1-12.9 7.2L3.5 20.5l1.8-4.5A8.4 8.4 0 1 1 21 11.5Z"/>'),
  partilha: svg('<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2.5v13"/>'),
  casa:     svg('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z"/>'),
};

/* Pata: marca os farejadores. O sino, no topo, é das novidades — ícones
   diferentes de propósito, porque são coisas diferentes. */
const IC_PATA = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
  <ellipse cx="6.4" cy="9.4" rx="2.1" ry="2.7"/><ellipse cx="10.9" cy="6.7" rx="2.1" ry="2.8"/>
  <ellipse cx="15.7" cy="7.4" rx="2" ry="2.6"/><ellipse cx="19.2" cy="11.3" rx="1.9" ry="2.3"/>
  <path d="M12.4 12.3c2.6 0 4.8 2 4.8 4.3 0 1.9-1.5 3.2-3.4 3.2-1 0-1.7-.3-2.4-.3s-1.4.3-2.4.3c-1.9 0-3.4-1.3-3.4-3.2 0-2.3 2.2-4.3 4.8-4.3Z"/></svg>`;

/* Caso sem foto existe — quem acha um cão na rua nem sempre consegue fotografar.
   Um quadrado cinza vazio seria pior que assumir a ausência. */
function fotoHTML(p) {
  const selo = `<span class="selo">${SELO[p.tipo]}</span>`;
  const fotos = p.fotos || [];

  if (!fotos.length) {
    return `<div class="post__foto post__foto--sem">
      ${selo}
      <span class="sem-foto">${svg('<path d="M3 3l18 18"/><path d="M21 15V7a2 2 0 0 0-2-2H9"/><path d="M3 7v12a2 2 0 0 0 2 2h14"/>')}
        Sem foto</span>
    </div>`;
  }

  if (fotos.length === 1) {
    return `<figure class="post__foto">
      <img src="${esc(fotos[0])}" alt="Foto de ${esc(p.titulo)}" loading="lazy" onerror="this.remove()">
      ${selo}
    </figure>`;
  }

  /* Carrossel: rolagem nativa com scroll-snap. Dá o arrasto com inércia do
     celular de graça e continua funcionando pelo teclado, sem biblioteca. */
  const n = fotos.length;
  return `
  <div class="carrossel">
    <div class="carrossel__janela">
      <div class="carrossel__trilho" tabindex="0" role="group"
           aria-label="${n} fotos de ${esc(p.titulo)}">
        ${fotos.map((f, i) => `
          <figure class="carrossel__foto">
            <img src="${esc(f)}" alt="Foto ${i + 1} de ${n} de ${esc(p.titulo)}"
                 loading="lazy" onerror="this.closest('.carrossel__foto').remove()">
          </figure>`).join('')}
      </div>
      ${selo}
      <span class="carrossel__conta" data-conta>1/${n}</span>
      <button class="carrossel__seta carrossel__seta--tras" type="button"
              data-passo="-1" aria-label="Foto anterior" hidden>
        ${svg('<path d="m15 18-6-6 6-6"/>')}
      </button>
      <button class="carrossel__seta carrossel__seta--frente" type="button"
              data-passo="1" aria-label="Próxima foto">
        ${svg('<path d="m9 18 6-6-6-6"/>')}
      </button>
    </div>
    <div class="carrossel__pontos" aria-hidden="true">
      ${fotos.map((_, i) => `<i${i === 0 ? ' data-ativo' : ''}></i>`).join('')}
    </div>
  </div>`;
}

/** Mantém contador, pontinhos e setas em dia com a rolagem. */
function atualizarCarrossel(trilho) {
  const carrossel = trilho.closest('.carrossel');
  if (!carrossel) return;
  const total = trilho.children.length;
  const i = Math.min(total - 1, Math.round(trilho.scrollLeft / trilho.clientWidth));

  const conta = carrossel.querySelector('[data-conta]');
  if (conta) conta.textContent = `${i + 1}/${total}`;

  carrossel.querySelectorAll('.carrossel__pontos i').forEach((ponto, j) =>
    ponto.toggleAttribute('data-ativo', j === i));

  const tras = carrossel.querySelector('.carrossel__seta--tras');
  const frente = carrossel.querySelector('.carrossel__seta--frente');
  if (tras)   tras.hidden = i === 0;
  if (frente) frente.hidden = i === total - 1;
}

/* scroll não borbulha, mas pode ser capturado: um ouvinte só, que sobrevive a
   cada repintura do feed. */
document.addEventListener('scroll', (ev) => {
  const alvo = ev.target;
  if (alvo instanceof Element && alvo.classList.contains('carrossel__trilho')) {
    atualizarCarrossel(alvo);
  }
}, true);

/* Avatar: foto quando existe, iniciais quando não. As iniciais continuam no
   HTML mesmo com foto — se a imagem falhar, sobra algo legível. */
function avatarHTML(nome, foto, classe = 'avatar') {
  const fundo = foto
    ? ` background-image:url('${esc(foto)}');`
    : '';
  return `<span class="${classe}" ${foto ? 'data-foto' : ''}
                style="--av:${corAvatar(nome)};${fundo}" aria-hidden="true">${esc(iniciais(nome))}</span>`;
}

/* Quem publicou é um link para o perfil. O "..." só aparece para o dono. */
function cabecalhoHTML(p, comMenu = false) {
  // O administrador vê o mesmo "..." em qualquer caso: um caminho só, o do dono,
  // em vez de uma segunda porta de moderação para manter em dia.
  const dono = comMenu && ((p.autor_id && p.autor_id === meuId()) || souAdmin);
  return `
    <header class="post__quem">
      <button class="post__autor-link" type="button" data-perfil="${p.autor_id || ''}"
              aria-label="Ver o perfil de ${esc(p.autor_nome)}">
        ${avatarHTML(p.autor_nome, p.autor_avatar)}
        <span class="post__id">
          <span class="post__autor">
            ${esc(p.autor_nome)}
            ${SELO_PAPEL[p.autor_papel] ? `<span class="etiqueta" data-papel="${p.autor_papel}"
              >${SELO_PAPEL[p.autor_papel]}</span>` : ''}
          </span>
          <span class="post__local">${esc(p.endereco || MARCA.cidade)}</span>
        </span>
      </button>
      ${dono ? `<button class="post__menu" type="button" data-menu="${p.id}"
        aria-label="Opções deste caso">${svg('<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>')}</button>` : ''}
    </header>`;
}

// --- post ---------------------------------------------------------------------

/* Ações só com ícone, como no Instagram. O que cada uma faz é dito na linha
   logo abaixo, que ocupa o lugar do "curtido por" — nada de rótulo em botão. */
function acoesHTML(p) {
  const b = (dado, id, rotulo, icone) =>
    `<button class="acao" type="button" data-${dado}="${id}" aria-label="${rotulo}" title="${rotulo}">${icone}</button>`;

  const partilhar = b('partilhar', p.id, 'Compartilhar', IC.partilha);

  /* Quantas PESSOAS estão ajudando este caso — quem avistou e quem espalhou,
     cada uma contada uma vez. É diferente do número de avistamentos, que conta
     episódios: a mesma pessoa pode ver o pet três vezes. */
  const farejadores = p.n_farejadores > 0
    ? `<span class="farejadores" data-farejadores="${p.id}"
             title="Pessoas ajudando a procurar">${IC_PATA}
         <b>${p.n_farejadores}</b> ${p.n_farejadores === 1 ? 'farejador' : 'farejadores'}
       </span>`
    : '';

  if (p.tipo === 'adocao')
    return `<div class="acoes">${b('zap', p.id, 'Falar com quem está doando', IC.conversa)}${partilhar}${farejadores}</div>`;
  if (p.tipo === 'encontrado')
    return `<div class="acoes">${b('zap', p.id, 'É o meu pet', IC.casa)}${partilhar}${farejadores}</div>`;
  return `<div class="acoes">
    ${b('vi', p.id, `Avisar que vi ${p.titulo}`, IC.olho)}
    ${b('zap', p.id, 'Falar com o tutor', IC.conversa)}
    ${partilhar}${farejadores}</div>`;
}

/** O slot do "curtido por": prova social quando há, chamada para agir quando não há. */
function linhaSocialHTML(p) {
  const n = p.n_avistados;
  if (n > 0) {
    return `<button class="social" type="button" data-abrir="${p.id}">
      ${n === 1 ? '1 pessoa viu' : `${n} pessoas viram`} ${esc(comArtigo(p))}</button>`;
  }
  if (p.tipo === 'perdido') {
    return `<button class="social social--fraca" type="button" data-vi="${p.id}">
      Ninguém avisou ainda · <b>avise se você viu</b></button>`;
  }
  if (p.tipo === 'adocao') {
    return `<button class="social social--fraca" type="button" data-zap="${p.id}">
      <b>Quero adotar</b></button>`;
  }
  return '';
}

function postHTML(p) {
  return `
  <article class="post" data-tipo="${p.tipo}">
    ${cabecalhoHTML(p)}

    ${fotoHTML(p)}

    ${acoesHTML(p)}

    <div class="legenda">
      ${linhaSocialHTML(p)}
      <p><span class="legenda__pet">${esc(p.titulo)}</span>
         <span class="legenda__tracos">${esc(tracos(p))}</span></p>
      <p class="legenda__texto">${esc(p.texto || '')}</p>
      <p class="legenda__quando">${fmtDistancia(p.distancia_m)} ${deOndeVem()} · ${quando(p)}</p>
    </div>
  </article>`;
}

/* O ÚNICO link clicável do app.
   Todo texto de caso passa por esc() e nunca vira `<a>` — isso é proteção, não
   descuido, e não se afrouxa. Aqui o endereço vem de uma COLUNA própria, já
   barrado no banco a https, e ainda assim é reconferido: `new URL` rejeita
   lixo, e o protocolo é testado à mão porque a constraint pode um dia mudar. */
function linkSeguro(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u : null;
  } catch { return null; }
}

/* Não é um `.post`: sem avatar, sem distância, sem selo de tipo, sem ações de
   farejador. Um card que se parece com caso e não se comporta como caso é pior
   que um aviso assumidamente diferente. */
function recadoHTML(r) {
  const u = linkSeguro(r.link || '');
  return `
  <article class="recado-faro">
    <div class="recado-faro__marca">
      <img src="img/faro-marca.png" alt="" width="600" height="668">
      <span>Recado do Faro</span>
      <button class="recado-faro__fechar" type="button" data-recado-fechar="${esc(r.id)}"
              aria-label="Dispensar este recado">
        ${svg('<path d="M18 6 6 18M6 6l12 12"/>')}
      </button>
    </div>
    <h2 class="recado-faro__titulo">${esc(r.titulo)}</h2>
    <p class="recado-faro__texto">${esc(r.texto)}</p>
    ${u ? `<a class="recado-faro__elo" href="${esc(u.href)}"
              target="_blank" rel="noopener noreferrer nofollow">
             ${esc(r.link_rotulo || u.hostname)}
             <em>${esc(u.hostname)}</em>
           </a>` : ''}
  </article>`;
}

async function pintarRecados() {
  // Nunca derruba o feed: se falhar, simplesmente não há recado.
  const lidos = recadosLidos();
  const lista = (await recadosAtivos()).filter((r) => !lidos.has(r.id));
  return lista.map(recadoHTML).join('');
}

/* O card que fecha o ciclo. Sem distância, sem botão de avistar, sem "falar
   com o tutor" — não há nada a fazer, e oferecer ação seria falso. O que ele
   mostra é o que a pessoa quer saber: quanto tempo o pet ficou fora e quantos
   farejadores ajudaram. */
function reencontroHTML(p) {
  const dias = Math.max(0, Math.round(p.dias_fora || 0));
  const tempo = dias === 0 ? 'no mesmo dia'
    : dias === 1 ? 'depois de 1 dia'
    : `depois de ${dias} dias`;

  const ajuda = p.n_farejadores > 0
    ? `<span class="farejadores">${IC_PATA}
         <b>${p.n_farejadores}</b> ${p.n_farejadores === 1 ? 'farejador ajudou' : 'farejadores ajudaram'}
       </span>`
    : '';

  return `
  <article class="post reencontro" data-tipo="${p.tipo}">
    ${cabecalhoHTML(p)}
    ${fotoHTML({ ...p, tipo: p.tipo })}
    <div class="legenda">
      <p class="reencontro__fita">
        ${svg('<path d="M20 6 9 17l-5-5"/>')}
        ${esc(comArtigo(p))} voltou para casa ${tempo}
      </p>
      <p class="legenda__tracos">${tracos(p)}</p>
      ${p.texto ? `<p class="legenda__texto">${esc(p.texto)}</p>` : ''}
      <p class="legenda__quando">${fmtTempo(p.resolvido_em)}${ajuda ? ' · ' : ''}</p>
      ${ajuda}
    </div>
  </article>`;
}

async function pintarFeed() {
  const alvo = $('#feed');
  const aba = ABAS[estado.aba] || ABAS.buscas;
  const raio = aba.raio || estado.raioM;

  try {
    if (estado.aba === 'reencontros') {
      const lista = await reencontros({ ...ORIGEM, raioM: raio });
      alvo.innerHTML = lista.length
        ? lista.map(reencontroHTML).join('')
        : `<div class="vazio"><strong>Ainda não há reencontros por aqui</strong>
           Quando um caso terminar bem, ele aparece nesta página.</div>`;
      return;
    }

    const [posts, recados] = await Promise.all([
      feedPorRaio({ ...ORIGEM, raioM: raio, tipos: aba.tipos }),
      pintarRecados(),
    ]);
    alvo.innerHTML = recados + (posts.length
      ? posts.map(postHTML).join('')
      : estado.aba === 'adocao'
        ? `<div class="vazio"><strong>Nenhum pet para adoção agora</strong>
           As adoções são publicadas por ONGs e protetores da cidade.</div>`
        : `<div class="vazio"><strong>Nada por aqui agora</strong>
           Nenhum caso aberto nesta área. Aumente a distância no seu perfil.</div>`);
  } catch (e) {
    alvo.innerHTML = `<div class="vazio"><strong>Não consegui carregar</strong>${esc(e.message)}</div>`;
  }
}

// --- detalhe ------------------------------------------------------------------

let mapa = null;
let postAberto = null;

async function abrirDetalhe(id) {
  const p = await postPorId(id);
  if (!p) return;
  postAberto = p;
  const rastro = await rastroDoPost(id);
  const base = rastro.find((r) => r.ehOrigem) || rastro[0] || p;
  const dist = fmtDistancia(
    Math.hypot((base.lat - ORIGEM.lat) * 111320, (base.lng - ORIGEM.lng) * 96500));

  const ficha = [
    ['Espécie',  ESPECIE[p.especie]],
    ['Raça',     p.raca],
    ['Cor',      p.cor],
    ['Porte',    (PORTE[p.porte] || '').replace('porte ', '')],
    ['Sexo',     SEXO[p.sexo]],
    ['Castrado', p.castrado == null ? null : p.castrado ? 'sim' : 'não'],
  ].filter(([, v]) => v);

  $('#detalhe-nome').textContent = p.titulo;
  $('#detalhe-corpo').innerHTML = `
    <article class="post" data-tipo="${p.tipo}">
      ${cabecalhoHTML(p, true)}
      ${fotoHTML(p)}
      ${acoesHTML(p)}
      <div class="legenda">
        <p><span class="legenda__pet">${esc(p.titulo)}</span>
           <span class="legenda__tracos">${esc(tracos(p))}</span></p>
        <p>${esc(p.texto || '')}</p>
        <p class="legenda__quando">${dist} ${deOndeVem()} · ${fmtTempo(p.ocorrido_em)}</p>
      </div>
    </article>

    ${ficha.length ? `
    <div class="secao">
      <h3 class="secao__titulo">Como ${esc(comArtigo(p))} é</h3>
      <dl class="ficha">
        ${ficha.map(([r, v]) => `<div><dt>${r}</dt><dd>${esc(v)}</dd></div>`).join('')}
      </dl>
      ${p.sinais ? `<p class="secao__nota">${esc(p.sinais)}</p>` : ''}
    </div>` : ''}

    <div class="secao secao--limpa"><div id="mapa"></div></div>

    ${rastro.length > 1 ? `
    <div class="secao">
      <h3 class="secao__titulo">Por onde ${esc(comArtigo(p))} passou
        <small>· ${rastro.length} pontos</small></h3>
      <ol class="linha">
        ${rastro.map((r) => `
          <li>
            <div class="linha__onde">${esc(r.endereco || '—')}</div>
            <p class="linha__texto">${esc(r.texto || '')}</p>
            <div class="linha__quem">${r.ehOrigem ? 'Visto pelo tutor' : `${esc(r.autor_nome)} viu`}
              ${fmtTempo(r.ocorrido_em)} · ${fmtData(r.ocorrido_em)}</div>
          </li>`).join('')}
      </ol>
    </div>` : ''}

    <p class="aviso" id="aviso" hidden></p>`;

  $('#detalhe').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#detalhe .icone-botao').focus();
  desenharMapa(rastro.length ? rastro : [p]);
}

function desenharMapa(pontos) {
  if (mapa) { mapa.remove(); mapa = null; }
  mapa = L.map('mapa', { scrollWheelZoom: false });

  // OpenStreetMap: sem chave. O 'cartodbpositron' do protótipo passou a exigir
  // cadastro e estampava "API KEY REQUIRED" sobre o mapa inteiro.
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(mapa);

  const coords = pontos.map((r) => [r.lat, r.lng]);
  pontos.forEach((r, i) => {
    const ultimo = i === 0;
    L.circleMarker([r.lat, r.lng], {
      radius: ultimo ? 9 : 6, color: '#fff', weight: 2,
      fillColor: ultimo ? '#DD8C18' : '#15719F', fillOpacity: 1,
    }).addTo(mapa).bindPopup(`<strong>${esc(r.endereco || '')}</strong><br>${fmtTempo(r.ocorrido_em)}`);
  });

  if (coords.length > 1) {
    L.polyline(coords, { color: '#15719F', weight: 2, dashArray: '5,6', opacity: .75 }).addTo(mapa);
    // maxZoom: sem isto, dois pontos quase no mesmo lugar levam o mapa ao
    // zoom máximo e a pessoa perde a referência da rua.
    mapa.fitBounds(coords, { padding: [34, 34], maxZoom: 16 });
  } else {
    mapa.setView(coords[0], 15);
  }
  setTimeout(() => mapa.invalidateSize(), 60);
}

function fecharDetalhe() {
  $('#detalhe').hidden = true;
  postAberto = null;
  if (mapa) { mapa.remove(); mapa = null; }
  // Quem chegou ao caso pelo mapa volta para o mapa, não para o feed.
  const perfilId = perfilTela.perfilAberto();
  const voltandoAoMapa = mapaTela.estaAberto();
  const destino = perfilId ? `#/perfil/${perfilId}` : voltandoAoMapa ? '#/mapa' : '#/';
  document.body.style.overflow = (perfilId || voltandoAoMapa) ? 'hidden' : '';
  history.replaceState(null, '', destino);
}

// --- ações --------------------------------------------------------------------

function avisar(msg) {
  const el = $('#aviso');
  if (el && !$('#detalhe').hidden) {
    el.textContent = msg; el.hidden = false;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } else alert(msg);
}

async function falarComTutor(id) {
  try {
    const tel = await contatoDoPost(id);
    if (!tel) return recado('Esta pessoa ainda não cadastrou um WhatsApp.', 4000);
    window.open(`https://wa.me/55${tel}`, '_blank', 'noopener');
  } catch (e) {
    if (!estaLogado()) form.abrirConta('entrar');
    else avisar(e.message);
  }
}

async function partilhar(id) {
  const url = `${location.origin}/c/${id}`;

  if (navigator.share) {
    try { await navigator.share({ url, title: MARCA.nome }); }
    catch { return; }               // cancelou de propósito: não conta
  } else {
    /* Falhar ao copiar não anula o compartilhamento: a pessoa pediu e recebeu
       o link na tela. Abortar aqui escondia a contagem inteira. */
    try { await navigator.clipboard.writeText(url); recado('Link copiado'); }
    catch { recado(url, 6000); }
  }

  const total = await registrarCompartilhamento(id);
  if (total != null) pintarFarejadores(id, total);
}

/* Aviso curto no rodapé. Melhor que alert() para confirmar uma ação pequena:
   não interrompe, não exige toque, some sozinho. */
let recadoTempo = null;
function recado(texto, ms = 2600) {
  let el = $('#recado');
  if (!el) {
    el = document.createElement('div');
    el.id = 'recado';
    el.className = 'recado';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = texto;
  el.classList.add('recado--visivel');
  clearTimeout(recadoTempo);
  recadoTempo = setTimeout(() => el.classList.remove('recado--visivel'), ms);
}

/* Atualiza o contador — e o CRIA quando o caso vai de 0 para 1, caso em que o
   elemento ainda não existe no card. Sem isto, o primeiro farejador de um caso
   não aparecia até a próxima repintura. */
function pintarFarejadores(id, total) {
  if (!total) return;
  const html = `${IC_PATA} <b>${total}</b> ${total === 1 ? 'farejador' : 'farejadores'}`;
  const existentes = document.querySelectorAll(`[data-farejadores="${id}"]`);
  if (existentes.length) { existentes.forEach((el) => { el.innerHTML = html; }); return; }

  document.querySelectorAll(`.acoes [data-partilhar="${id}"]`).forEach((botao) => {
    const span = document.createElement('span');
    span.className = 'farejadores';
    span.dataset.farejadores = id;
    span.title = 'Pessoas ajudando a procurar';
    span.innerHTML = html;
    botao.closest('.acoes').append(span);
  });
}

async function avistar(id) {
  const p = postAberto?.id === id ? postAberto : await postPorId(id);
  form.abrirAvistar(p, ORIGEM);
}

document.addEventListener('click', (ev) => {
  if (ev.target.closest('[data-fechar-cartao]')) { mapaTela.esconderCartao(); return; }

  const origem = ev.target.closest('[data-origem]');
  if (origem) { escolherOrigem(origem.dataset.origem, origem); return; }

  const raio = ev.target.closest('[data-raio]');
  if (raio) {
    estado.raioM = +raio.dataset.raio;
    pintarChip(); pintarLugar(); pintarFeed();
    return;
  }

  // clique fora fecha o popover
  if (!ev.target.closest('#popover-lugar, .lugar-chip')) fecharLugar();

  const passo = ev.target.closest('[data-passo]');
  if (passo) {
    const trilho = passo.closest('.carrossel').querySelector('.carrossel__trilho');
    trilho.scrollBy({ left: +passo.dataset.passo * trilho.clientWidth, behavior: 'smooth' });
    return;
  }
  /* Toda chave tratada no bloco abaixo precisa estar AQUI também — senão o
     closest() não casa e o clique morre em silêncio. Já aconteceu com
     data-perfil e data-menu: o link do autor e o "..." do dono ficaram inertes. */
  const alvo = ev.target.closest(
    '[data-abrir],[data-vi],[data-zap],[data-partilhar],[data-acao],[data-aba],[data-perfil],[data-menu],[data-recado-fechar]');
  if (!alvo) return;
  const d = alvo.dataset;

  if (d.perfil)    { location.hash = `#/perfil/${d.perfil}`; return; }
  if (d.menu)      { abrirMenuDono(d.menu); return; }
  if (d.abrir)     {
    if (!$('#novidades-tela').hidden) fecharNovidades();
    location.hash = `#/post/${d.abrir}`;
    return;
  }
  if (d.recadoFechar) {
    marcarRecadoLido(d.recadoFechar);
    alvo.closest('.recado-faro')?.remove();
    return;
  }
  if (d.aba)       { location.hash = ABAS[d.aba]?.hash || '#/'; return; }
  if (d.zap)       { falarComTutor(d.zap); return; }
  if (d.partilhar) { partilhar(d.partilhar); return; }
  if (d.vi)        { avistar(d.vi); return; }

  switch (d.acao) {
    case 'fechar':        fecharDetalhe(); return;
    case 'novidades':         abrirNovidades(); return;
    case 'fechar-novidades':  fecharNovidades(); return;
    case 'fechar-perfil': perfilTela.fechar();
                          history.replaceState(null, '', mapaTela.estaAberto() ? '#/mapa' : '#/');
                          marcarAba(mapaTela.estaAberto() ? 'ir-mapa' : 'ir-feed'); return;
    case 'publicar':    form.abrirPublicar(ORIGEM); return;
    case 'ir-mapa':     location.hash = '#/mapa'; return;
    case 'centralizar': mapaTela.centralizarEmMim(alvo); return;
    case 'ir-feed':     if (!$('#detalhe').hidden) fecharDetalhe();
                        if (mapaTela.estaAberto()) { mapaTela.fechar(); history.replaceState(null, '', '#/'); }
                        marcarAba('ir-feed');
                        window.scrollTo({ top: 0, behavior: 'smooth' }); return;
    case 'conta':     estaLogado() ? (location.hash = `#/perfil/${meuId()}`) : form.abrirConta('entrar'); return;
    case 'instalar':           pwa.instalar(alvo); return;
    case 'dispensar-instalar': pwa.dispensarInstalar(); return;
    case 'usar-local':      pedirLocal(alvo); return;
    case 'dispensar-local': dispensarConvite(); $('#convite-local').hidden = true; return;
    case 'lugar':     alternarLugar(); return;
  }

});

/* Só chega aqui por toque explícito no convite. O pedido do navegador aparece
   depois disso, já com o motivo explicado na tela. */
async function pedirLocal(botao) {
  const antes = botao.textContent;
  botao.disabled = true;
  botao.textContent = 'Procurando…';
  try {
    await adotarMinhaLocalizacao();
    $('#convite-local').hidden = true;
    pintarChip();
    await pintarFeed();
  } catch {
    botao.textContent = 'Não consegui — segue pelo Centro';
    setTimeout(() => { botao.textContent = antes; botao.disabled = false; }, 3000);
    return;
  }
  botao.disabled = false;
  botao.textContent = antes;
}

// --- de onde e até onde -------------------------------------------------------

const RAIOS = [[1000, '1 km'], [3000, '3 km'], [5000, '5 km'], [20000, 'A cidade toda']];

const nomeDoRaio = (m) => (m >= 20000 ? 'a cidade' : `${m / 1000} km`);

/* O chip responde as duas perguntas que o número solto não respondia:
   de onde se mede e até onde se olha. */
function pintarChip() {
  const t = $('[data-chip-texto]');
  if (!t) return;
  t.textContent = `${ORIGEM.ehReal ? 'Você' : 'Centro'} · ${nomeDoRaio(estado.raioM)}`;
  $('[data-chip-ponto]')?.toggleAttribute('data-vivo', ORIGEM.ehReal);
  $('.lugar-chip')?.setAttribute('aria-label',
    ORIGEM.ehReal
      ? `Medindo da sua localização, até ${nomeDoRaio(estado.raioM)}. Tocar para mudar.`
      : `Medindo do Centro, até ${nomeDoRaio(estado.raioM)}. Tocar para mudar.`);
}

function fecharLugar() {
  const pop = $('#popover-lugar');
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  $('.lugar-chip')?.setAttribute('aria-expanded', 'false');
}

function alternarLugar() {
  const pop = $('#popover-lugar');
  if (!pop.hidden) return fecharLugar();
  pop.hidden = false;
  $('.lugar-chip').setAttribute('aria-expanded', 'true');
  pintarLugar();
}

/* Conta quantos casos caem em cada raio. Um número abstrato ("5 km") vira uma
   decisão ("5 km, 7 casos"). Uma consulta só, na maior distância. */
async function pintarLugar(contagem = null) {
  const corpo = $('#popover-corpo');
  const marcado = (sim) => (sim ? 'data-marcado' : '');

  corpo.innerHTML = `
    <p class="popover__titulo">De onde</p>
    <div class="popover__lista">
      <button class="popover__item" type="button" data-origem="eu" ${marcado(ORIGEM.ehReal)}>
        <span>Sua localização</span>
        ${ORIGEM.ehReal ? '<em>usando agora</em>' : '<em class="popover__acao">usar</em>'}
      </button>
      <button class="popover__item" type="button" data-origem="centro" ${marcado(!ORIGEM.ehReal)}>
        <span>${esc(CENTRO.nome)}</span>
      </button>
    </div>

    <p class="popover__titulo">Até que distância</p>
    <div class="popover__lista">
      ${RAIOS.map(([m, rotulo]) => `
        <button class="popover__item" type="button" data-raio="${m}" ${marcado(estado.raioM === m)}>
          <span>${rotulo}</span>
          <em>${contagem ? `${contagem[m]} ${contagem[m] === 1 ? 'caso' : 'casos'}` : '…'}</em>
        </button>`).join('')}
    </div>`;

  if (contagem) return;
  try {
    // A contagem é da aba em que a pessoa está: "5 km, 7 casos" tem de bater
    // com o que ela vai ver ao escolher 5 km.
    const todos = await feedPorRaio({ ...ORIGEM, raioM: 20000, tipos: (ABAS[estado.aba] || ABAS.buscas).tipos });
    const conta = {};
    for (const [m] of RAIOS) conta[m] = todos.filter((p) => p.distancia_m <= m).length;
    if (!$('#popover-lugar').hidden) pintarLugar(conta);
  } catch { /* fica com as reticências */ }
}

async function escolherOrigem(qual, botao) {
  if (qual === 'centro') {
    aplicarOrigem(CENTRO, false);
  } else if (!ORIGEM.ehReal) {
    const antes = botao.querySelector('em');
    if (antes) antes.textContent = 'procurando…';
    try { await adotarMinhaLocalizacao(); }
    catch { if (antes) antes.textContent = 'não consegui'; return; }
    $('#convite-local').hidden = true;
  }
  pintarChip();
  pintarLugar();
  pintarFeed();
}

// --- novidades ----------------------------------------------------------------

/* O que outras pessoas fizeram nos seus casos. O "não visto" é guardado no
   próprio aparelho: um carimbo de tempo, e conta o que é mais novo que ele.
   Simples e sem coluna nova no banco — o custo é não sincronizar entre
   aparelhos, o que para um aviso é aceitável. */
let novidades = [];

function naoVistas() {
  const carimbo = novidadesVistasEm();
  if (!carimbo) return novidades.length;
  return novidades.filter((n) => n.quando > carimbo).length;
}

async function carregarNovidades() {
  const sino = $('.sino');
  if (!sino) return;
  if (!estaLogado()) { sino.hidden = true; return; }
  try { novidades = await minhasNovidades(); } catch { novidades = []; }
  sino.hidden = false;
  const n = naoVistas();
  const ponto = $('[data-ponto]', sino);
  ponto.hidden = n === 0;
  ponto.textContent = n > 9 ? '9+' : String(n || '');
  sino.setAttribute('aria-label',
    n ? `${n} novidade${n > 1 ? 's' : ''} nos seus casos` : 'Novidades nos seus casos');
}

function abrirNovidades() {
  const corpo = $('#novidades-corpo');
  const carimbo = novidadesVistasEm();

  corpo.innerHTML = novidades.length ? `
    <ul class="novidades">
      ${novidades.map((n) => `
        <li class="novidade ${!carimbo || n.quando > carimbo ? 'novidade--nova' : ''}">
          <button type="button" data-abrir="${n.caso_id}">
            <span class="novidade__foto" ${n.caso_foto ? `style="background-image:url('${esc(n.caso_foto)}')"` : ''}></span>
            <span class="novidade__texto">
              <span><strong>${esc(n.quem)}</strong> viu ${esc(n.caso_titulo)}</span>
              <span class="novidade__onde">${esc(n.endereco || 'sem endereço')}</span>
              ${n.texto ? `<span class="novidade__fala">“${esc(n.texto)}”</span>` : ''}
              <span class="novidade__quando">${fmtTempo(n.quando)}</span>
            </span>
          </button>
        </li>`).join('')}
    </ul>` : `
    <div class="vazio">
      <strong>Nada novo por aqui</strong>
      Quando alguém avistar um pet que você publicou, o aviso aparece aqui.
    </div>`;

  $('#novidades-tela').hidden = false;
  document.body.style.overflow = 'hidden';
  marcarNovidadesVistas();
  const ponto = $('.sino [data-ponto]');
  if (ponto) ponto.hidden = true;
}

function fecharNovidades() {
  $('#novidades-tela').hidden = true;
  document.body.style.overflow = '';
}

async function abrirMenuDono(id) {
  const p = postAberto?.id === id ? postAberto : await postPorId(id);
  form.abrirAcoesDoDono(p, {
    aoApagar: () => {
      if (!$('#detalhe').hidden) fecharDetalhe();
      if (perfilTela.estaAberto()) perfilTela.recarregar();
    },
  });
}

document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  if (!$('#popover-lugar').hidden) { fecharLugar(); return; }
  if (!$('#detalhe').hidden) fecharDetalhe();
});

// --- rotas --------------------------------------------------------------------

function marcarAba(acao) {
  $$('.barra button').forEach((b) => {
    if (b.dataset.acao === acao) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
}

function rotear() {
  const m = location.hash.match(/^#\/post\/(.+)$/);
  if (m) { abrirDetalhe(m[1]); return; }

  /* Atalho do ícone instalado: /#/publicar. Abre a folha e limpa o endereço,
     senão o botão "voltar" reabriria o formulário para sempre. */
  if (location.hash === '#/publicar') {
    history.replaceState(null, '', '#/');
    form.abrirPublicar(ORIGEM);
    return;
  }

  const perfil = location.hash.match(/^#\/perfil\/(.+)$/);
  if (perfil) {
    if (!$('#detalhe').hidden) fecharDetalhe();
    marcarAba(perfil[1] === meuId() ? 'conta' : null);
    perfilTela.abrir(perfil[1]);
    return;
  }
  if (perfilTela.estaAberto()) perfilTela.fechar();

  if (!$('#detalhe').hidden) fecharDetalhe();

  if (location.hash === '#/mapa') {
    marcarAba('ir-mapa');
    mapaTela.abrir();
    return;
  }
  if (mapaTela.estaAberto()) mapaTela.fechar();
  marcarAba('ir-feed');

  // As três seções do topo. Todas são "feed" para a barra de baixo.
  const nova = Object.keys(ABAS).find((a) => ABAS[a].hash === (location.hash || '#/')) || 'buscas';
  if (nova !== estado.aba || !$('#feed').children.length) {
    estado.aba = nova;
    marcarSecao();
    pintarFeed();
  }
}

function marcarSecao() {
  $$('.abas button').forEach((b) => {
    if (b.dataset.aba === estado.aba) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
}
window.addEventListener('hashchange', rotear);

// --- início -------------------------------------------------------------------

document.title = `${MARCA.nome} — pets perdidos em ${MARCA.cidade}`;

// Quem volta pelo link do e-mail cai direto na tela de nova senha.
aoRecuperarSenha(() => form.abrirNovaSenha());

form.configurar({ aoMudar: () => {
  pintarFeed();
  carregarNovidades();
  if (perfilTela.estaAberto()) perfilTela.recarregar();
} });

aoMudarSessao(() => {
  const b = $('[data-conta-texto]');
  if (b) b.textContent = estaLogado() ? (meuNome().split(' ')[0] || 'Conta') : 'Entrar';
  carregarNovidades();

  souAdmin = false;
  if (estaLogado()) {
    meuPapel().then((p) => {
      souAdmin = !!p?.eh_admin;
      // Repinta só se mudou algo: quem não modera não paga por isto.
      if (souAdmin) pintarFeed();
    }).catch(() => {});
  }
});

/* Ordem importa: situar antes de pintar, senão o primeiro feed sai com as
   distâncias medidas do Centro e muda debaixo do usuário um segundo depois. */
async function situarUsuario() {
  const guardado = localGuardado();
  if (guardado) aplicarOrigem(guardado, true);   // distância certa já na abertura

  const permissao = await permissaoDeLocal();
  if (permissao === 'granted') {
    try { await adotarMinhaLocalizacao(); } catch { /* fica com o guardado, ou o Centro */ }
    return;
  }
  if (permissao === 'denied') return;            // já disse não: não insiste

  if (!guardado && !conviteDispensado()) $('#convite-local').hidden = false;
}

situarUsuario()
  // Nada aqui pode impedir o feed de aparecer: sem localização o app funciona,
  // sem feed não funciona.
  .catch(() => {})
  .then(pintarChip)
  .then(pintarFeed)
  .then(rotear);

/* Service worker e convite de instalação. Fica por último de propósito: nada
   aqui é necessário para o feed aparecer. */
pwa.comecar({ aoNavegar: (url) => { location.href = url; } });
