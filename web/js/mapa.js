/* =============================================================================
   Farejo — mapa dos pets procurados
   Um alfinete por caso aberto, na ÚLTIMA localização conhecida. Tocar no
   alfinete abre um cartão; tocar no cartão abre o caso inteiro.
   ============================================================================= */

import { ORIGEM, mapaPerdidos, adotarMinhaLocalizacao } from './dados.js?v=21';

const $ = (s, r = document) => r.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let mapa = null;
let camadaPets = null;
let marcaVoce = null;
let pets = [];
let selecionado = null;

// --- linguagem (espelha app.js; o mapa fala a mesma língua do feed) ------------

const fmtDistancia = (m) => (m < 950
  ? `${Math.round(m / 10) * 10} m`
  : `${(m / 1000).toFixed(1).replace('.', ',')} km`);

function fmtTempo(iso) {
  const min = (Date.now() - Date.parse(iso)) / 60000;
  if (min < 2)  return 'agora mesmo';
  if (min < 60) return `há ${Math.round(min)} minutos`;
  const h = Math.round(min / 60);
  if (h < 24)   return h === 1 ? 'há 1 hora' : `há ${h} horas`;
  const d = Math.round(min / 1440);
  if (d === 1)  return 'ontem';
  if (d < 30)   return `há ${d} dias`;
  const mes = Math.round(d / 30);
  return mes === 1 ? 'há 1 mês' : `há ${mes} meses`;
}

const ESPECIE = { cao: 'cão', gato: 'gato', outro: 'pet' };
const SEXO    = { macho: 'macho', femea: 'fêmea', desconhecido: '' };

const tracos = (p) => {
  const cauda = [p.raca, SEXO[p.sexo]].filter(Boolean).join(', ');
  return cauda ? `${ESPECIE[p.especie]} · ${cauda.toLowerCase()}` : ESPECIE[p.especie];
};

// --- alfinete -----------------------------------------------------------------

/* O alfinete é a cara do pet. Numa busca de rua é a foto que a pessoa compara
   com o que está vendo — não um pino genérico. */
function alfinete(p) {
  const miolo = p.foto
    ? `<span class="pino__foto" style="background-image:url('${esc(p.foto)}')"></span>`
    : `<span class="pino__foto pino__foto--sem">${p.especie === 'gato' ? '🐈' : '🐕'}</span>`;
  return L.divIcon({
    className: 'pino-envoltorio',
    html: `<span class="pino" data-tipo="${p.tipo}">${miolo}</span>`,
    iconSize: [46, 55],
    iconAnchor: [23, 55],
  });
}

// --- cartão de baixo ----------------------------------------------------------

function mostrarCartao(p) {
  selecionado = p.id;
  const c = $('#cartao-mapa');
  const quando = p.desde_tutor
    ? `Sumiu ${fmtTempo(p.visto_em)}`
    : `Visto ${fmtTempo(p.visto_em)}`;

  c.innerHTML = `
    <button class="cartao__fechar" type="button" data-fechar-cartao aria-label="Fechar">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
    </button>
    <button class="cartao__corpo" type="button" data-abrir="${p.id}">
      <span class="cartao__foto" ${p.foto ? `style="background-image:url('${esc(p.foto)}')"` : ''}>
        ${p.foto ? '' : (p.especie === 'gato' ? '🐈' : '🐕')}
      </span>
      <span class="cartao__texto">
        <span class="cartao__selo" data-tipo="${p.tipo}">${p.tipo === 'perdido' ? 'Perdido' : 'Avistado'}</span>
        <strong class="cartao__nome">${esc(p.titulo)}</strong>
        <span class="cartao__tracos">${esc(tracos(p))}</span>
        <span class="cartao__onde">${quando} · ${esc(p.endereco || '')}</span>
        <span class="cartao__dist">${fmtDistancia(p.distancia_m)} ${ORIGEM.ehReal ? 'de você' : 'do Centro'}${
          p.n_avistados > 0 ? ` · ${p.n_avistados} ${p.n_avistados === 1 ? 'avistamento' : 'avistamentos'}` : ''}</span>
      </span>
      <svg class="cartao__seta" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m9 18 6-6-6-6"/></svg>
    </button>`;
  c.hidden = false;
}

export function esconderCartao() {
  const c = $('#cartao-mapa');
  if (c) { c.hidden = true; c.innerHTML = ''; }
  selecionado = null;
}

// --- montagem -----------------------------------------------------------------

function desenharVoce() {
  if (marcaVoce) marcaVoce.remove();
  marcaVoce = L.circleMarker([ORIGEM.lat, ORIGEM.lng], {
    radius: 7, color: '#fff', weight: 3,
    fillColor: '#1D74D4', fillOpacity: 1,
  }).addTo(mapa).bindTooltip('Você está aqui');
}

async function carregarPets() {
  const aviso = $('#mapa-aviso');
  try {
    pets = await mapaPerdidos({ ...ORIGEM, raioM: 20000 });
  } catch (e) {
    aviso.textContent = `Não consegui carregar o mapa: ${e.message}`;
    aviso.hidden = false;
    return;
  }

  camadaPets.clearLayers();
  pets.forEach((p) => {
    L.marker([p.lat, p.lng], { icon: alfinete(p), riseOnHover: true })
      .addTo(camadaPets)
      .on('click', () => { mostrarCartao(p); mapa.panTo([p.lat, p.lng]); });
  });

  $('#mapa-conta').textContent = pets.length === 1
    ? '1 pet procurado por aqui'
    : `${pets.length} pets procurados por aqui`;

  if (pets.length) {
    const pontos = pets.map((p) => [p.lat, p.lng]).concat([[ORIGEM.lat, ORIGEM.lng]]);
    mapa.fitBounds(pontos, { padding: [50, 110], maxZoom: 15 });
  }
  aviso.hidden = true;
}

export async function abrir() {
  const tela = $('#mapa-tela');
  tela.hidden = false;
  document.body.style.overflow = 'hidden';

  if (!mapa) {
    mapa = L.map('mapa-todos', { zoomControl: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(mapa);
    L.control.zoom({ position: 'topright' }).addTo(mapa);
    camadaPets = L.layerGroup().addTo(mapa);
    mapa.setView([ORIGEM.lat, ORIGEM.lng], 14);
    mapa.on('click', esconderCartao);
  }

  setTimeout(() => mapa.invalidateSize(), 60);
  desenharVoce();
  await carregarPets();
}

export function fechar() {
  $('#mapa-tela').hidden = true;
  document.body.style.overflow = '';
  esconderCartao();
}

export const estaAberto = () => !$('#mapa-tela')?.hidden;

/** Move o mapa (e o app inteiro) para a localização real da pessoa. */
export async function centralizarEmMim(botao) {
  const antes = botao?.getAttribute('aria-label');
  botao?.classList.add('procurando');
  try {
    // adotar em vez de só ler: grava a posição e marca ORIGEM.ehReal,
    // para o feed passar a dizer "de você" em vez de "do Centro".
    const p = await adotarMinhaLocalizacao();
    mapa.setView([p.lat, p.lng], 15);
    desenharVoce();
    await carregarPets();
    return true;
  } catch {
    const aviso = $('#mapa-aviso');
    aviso.textContent = 'Não consegui a sua localização. O mapa está no centro da cidade.';
    aviso.hidden = false;
    return false;
  } finally {
    botao?.classList.remove('procurando');
    if (antes) botao.setAttribute('aria-label', antes);
  }
}
