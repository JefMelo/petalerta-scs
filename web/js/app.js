/* =============================================================================
   Farejo — interface
   ============================================================================= */

import { ORIGEM, feedPorRaio, postPorId, rastroDoPost, contatoDoPost,
         aoMudarSessao, estaLogado, meuId, meuNome,
         aplicarOrigem, localGuardado, permissaoDeLocal, adotarMinhaLocalizacao,
         conviteDispensado, dispensarConvite } from './dados.js?v=17';
import * as form from './formularios.js?v=17';
import * as mapaTela from './mapa.js?v=17';
import * as perfilTela from './perfil.js?v=17';

// MARCA — nome de trabalho. Trocar aqui e em .marca no CSS/HTML. -------------
export const MARCA = { nome: 'farejo', cidade: 'Santa Cruz do Sul' };

const estado = { raioM: 3000, tipo: 'todos' };

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

const fmtData = (iso) => new Date(iso).toLocaleString('pt-BR',
  { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const SELO    = { perdido: 'Perdido', avistado: 'Avistado', encontrado: 'Encontrado', adocao: 'Adoção' };
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

const PINO = `<svg class="marca__pino" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M12 22s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z" fill="currentColor"/>
  <circle cx="12" cy="10.5" r="2.6" fill="#fff"/></svg>`;

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

/* Quem publicou é um link para o perfil. O "..." só aparece para o dono. */
function cabecalhoHTML(p, comMenu = false) {
  const dono = comMenu && p.autor_id && p.autor_id === meuId();
  return `
    <header class="post__quem">
      <button class="post__autor-link" type="button" data-perfil="${p.autor_id || ''}"
              aria-label="Ver o perfil de ${esc(p.autor_nome)}">
        <span class="avatar" style="--av:${corAvatar(p.autor_nome)}" aria-hidden="true">${esc(iniciais(p.autor_nome))}</span>
        <span class="post__id">
          <span class="post__autor">${esc(p.autor_nome)}</span>
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

  if (p.tipo === 'adocao')
    return `<div class="acoes">${b('zap', p.id, 'Falar com quem está doando', IC.conversa)}${partilhar}</div>`;
  if (p.tipo === 'encontrado')
    return `<div class="acoes">${b('zap', p.id, 'É o meu pet', IC.casa)}${partilhar}</div>`;
  return `<div class="acoes">
    ${b('vi', p.id, `Avisar que vi ${p.titulo}`, IC.olho)}
    ${b('zap', p.id, 'Falar com o tutor', IC.conversa)}
    ${partilhar}</div>`;
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
      <p class="legenda__quando">${fmtDistancia(p.distancia_m)} ${deOndeVem()} · ${fmtTempo(p.ocorrido_em)}</p>
    </div>
  </article>`;
}

async function pintarFeed() {
  const alvo = $('#feed');
  try {
    const tipos = estado.tipo === 'todos' ? null : [estado.tipo];
    const posts = await feedPorRaio({ ...ORIGEM, raioM: estado.raioM, tipos });
    alvo.innerHTML = posts.length
      ? posts.map(postHTML).join('')
      : `<div class="vazio"><strong>Nada por aqui agora</strong>
         Nenhum caso aberto neste raio. Aumente a distância ou troque o filtro.</div>`;
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
      fillColor: ultimo ? '#F07824' : '#15719F', fillOpacity: 1,
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
    if (!tel) return avisar('Esta pessoa ainda não cadastrou um WhatsApp.');
    window.open(`https://wa.me/55${tel}`, '_blank', 'noopener');
  } catch (e) {
    if (!estaLogado()) form.abrirConta('entrar');
    else avisar(e.message);
  }
}

async function partilhar(id) {
  /* /c/<id> em vez de #/post/<id>: o hash não chega ao servidor, e sem isso o
     WhatsApp não monta a prévia com a foto do pet. Quem abre o link é levado
     para o app em seguida. Ver functions/c/[id].js.
     Em desenvolvimento (http.server) esse caminho não existe — só no Pages. */
  const url = `${location.origin}/c/${id}`;
  if (navigator.share) {
    try { await navigator.share({ url, title: MARCA.nome }); return; } catch { /* cancelado */ }
  }
  try { await navigator.clipboard.writeText(url); avisar('Link copiado.'); }
  catch { avisar(url); }
}

async function avistar(id) {
  const p = postAberto?.id === id ? postAberto : await postPorId(id);
  form.abrirAvistar(p, ORIGEM);
}

document.addEventListener('click', (ev) => {
  if (ev.target.closest('[data-fechar-cartao]')) { mapaTela.esconderCartao(); return; }

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
    '[data-abrir],[data-vi],[data-zap],[data-partilhar],[data-acao],[data-tipo],[data-perfil],[data-menu]');
  if (!alvo) return;
  const d = alvo.dataset;

  if (d.perfil)    { location.hash = `#/perfil/${d.perfil}`; return; }
  if (d.menu)      { abrirMenuDono(d.menu); return; }
  if (d.abrir)     { location.hash = `#/post/${d.abrir}`; return; }
  if (d.zap)       { falarComTutor(d.zap); return; }
  if (d.partilhar) { partilhar(d.partilhar); return; }
  if (d.vi)        { avistar(d.vi); return; }

  switch (d.acao) {
    case 'fechar':        fecharDetalhe(); return;
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
    case 'usar-local':      pedirLocal(alvo); return;
    case 'dispensar-local': dispensarConvite(); $('#convite-local').hidden = true; return;
    case 'raio':      form.abrirRaio(estado.raioM, (v) => {
                        estado.raioM = v;
                        $('[data-raio-texto]').textContent = v >= 20000 ? 'tudo' : `${v / 1000} km`;
                        pintarFeed();
                      }); return;
  }

  if (d.tipo) {
    estado.tipo = d.tipo;
    $$('.filtros button').forEach((b) => b.setAttribute('aria-pressed', b === alvo));
    pintarFeed();
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
    await pintarFeed();
  } catch {
    botao.textContent = 'Não consegui — segue pelo Centro';
    setTimeout(() => { botao.textContent = antes; botao.disabled = false; }, 3000);
    return;
  }
  botao.disabled = false;
  botao.textContent = antes;
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
  if (ev.key === 'Escape' && !$('#detalhe').hidden) fecharDetalhe();
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
  } else if (mapaTela.estaAberto()) {
    mapaTela.fechar();
    marcarAba('ir-feed');
  }
}
window.addEventListener('hashchange', rotear);

// --- início -------------------------------------------------------------------

$('.marca').innerHTML = `${PINO}<span class="marca__texto">${MARCA.nome}</span>`;
document.title = `${MARCA.nome} — pets perdidos em ${MARCA.cidade}`;

form.configurar({ aoMudar: () => {
  pintarFeed();
  if (perfilTela.estaAberto()) perfilTela.recarregar();
} });

aoMudarSessao(() => {
  const b = $('[data-conta-texto]');
  if (b) b.textContent = estaLogado() ? (meuNome().split(' ')[0] || 'Conta') : 'Entrar';
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
  .then(pintarFeed)
  .then(rotear);
