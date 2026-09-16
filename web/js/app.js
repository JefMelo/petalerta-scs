/* =============================================================================
   Faro — interface
   ============================================================================= */

import { ORIGEM, feedPorRaio, reencontros, novosReencontros, postPorId, rastroDoPost, contatoDoPost,
         aoMudarSessao, estaLogado, meuId, meuNome,
         aplicarOrigem, localGuardado, permissaoDeLocal, adotarMinhaLocalizacao,
         conviteDispensado, dispensarConvite,
         registrarCompartilhamento, minhasNovidades,
         novidadesVistasEm, marcarNovidadesVistas, CENTRO,
         aoRecuperarSenha, meuPapel, recadosAtivos, recadosLidos,
         marcarRecadoLido, farejadoresAtivos, PISO_COMUNIDADE,
         varrerFotosOrfas } from './dados.js?v=90';
import * as form from './formularios.js?v=90';
import * as mapaTela from './mapa.js?v=90';
import * as perfilTela from './perfil.js?v=90';
import * as pwa from './pwa.js?v=90';
import * as adminTela from './admin.js?v=90';
import { areaDeBusca, conselho, FONTES,
         horasDesdeUltimoPonto } from './area-busca.js?v=90';

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

/* `pintado` existia como `!$('#feed').children.length` — ler o DOM para saber
   se o feed já foi pintado. Com o esqueleto ocupando o lugar, o feed nunca
   mais está vazio, e aquela pergunta passaria a responder errado. */
const estado = { raioM: 3000, aba: 'buscas', pintado: false };

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
/* `abrivel` marca a foto como porta de entrada do caso. A foto é o maior alvo
   da tela e era INERTE: quem tocava nela não ia a lugar nenhum, e a única
   forma de abrir um caso no feed era a linha "2 pessoas viram o Bidu" — que só
   existe depois do primeiro avistamento. Caso sem avistamento não tinha porta.

   Vai na FOTO e não no `<article>` inteiro para não sequestrar a seleção de
   texto da legenda nem os espaços vazios do card. As setas do carrossel são
   tratadas antes no delegador, então continuam virando a foto em vez de abrir. */
/* Ícone por tipo. Rolando o feed, a forma é lida antes da palavra — e antes
   da cor, que sozinha não serve a quem não distingue verde de vermelho. */
const IC_SELO = {
  perdido:    '<path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z"/><circle cx="12" cy="10" r="2.4"/>',
  avistado:   '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  encontrado: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/>',
  adocao:     '<path d="M12 20.5s-7-4.4-7-9.2A4.3 4.3 0 0 1 12 8a4.3 4.3 0 0 1 7 3.3c0 4.8-7 9.2-7 9.2Z"/>',
};

function fotoHTML(p, abrivel = false) {
  const selo = p.status === 'resolvido'
    ? `<span class="selo selo--voltou">${svg('<path d="M20 6 9 17l-5-5"/>')}Voltou para casa</span>`
    : `<span class="selo">${svg(IC_SELO[p.tipo] || '')}${SELO[p.tipo]}</span>`;
  const fotos = p.fotos || [];
  const porta = abrivel ? ` data-abrir="${esc(p.id)}"` : '';

  if (!fotos.length) {
    return `<div class="post__foto post__foto--sem"${porta}>
      ${selo}
      <span class="sem-foto">${svg('<path d="M3 3l18 18"/><path d="M21 15V7a2 2 0 0 0-2-2H9"/><path d="M3 7v12a2 2 0 0 0 2 2h14"/>')}
        Sem foto</span>
    </div>`;
  }

  if (fotos.length === 1) {
    return `<figure class="post__foto"${porta}>
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
          <figure class="carrossel__foto"${porta}>
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

  /* Num caso encerrado não há o que avisar nem com quem falar — oferecer a
     ação seria falso. Sobra compartilhar, que é o que se faz com boa notícia,
     e a conta de quem ajudou, que é a quem a notícia pertence. */
  if (p.status === 'resolvido')
    return `<div class="acoes">${partilhar}${farejadores}</div>`;

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
  /* Num caso encerrado não há o que avisar nem com quem falar — oferecer a
     ação seria falso. Sobra compartilhar, que é o que se faz com boa notícia,
     e a conta de quem ajudou, que é a quem a notícia pertence. */
  if (p.status === 'resolvido')
    return `<div class="acoes">${partilhar}${farejadores}</div>`;

  if (p.tipo === 'adocao') {
    return `<button class="social social--fraca" type="button" data-zap="${p.id}">
      <b>Quero adotar</b></button>`;
  }
  return '';
}

/* O feed é só de quem precisa de ajuda AGORA. Caso que termina bem não entra
   aqui (schema-22): ele acende o pontinho na aba Reencontros e espera lá. */
function postHTML(p) {
  return `
  <article class="post" data-tipo="${p.tipo}">
    ${cabecalhoHTML(p)}

    ${fotoHTML(p, true)}

    ${acoesHTML(p)}

    <div class="legenda">
      ${linhaSocialHTML(p)}
      <p><button class="legenda__pet" type="button" data-abrir="${esc(p.id)}"
           >${esc(p.titulo)}</button>
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

/* RECADO DO FARO — o anúncio.

   Tem a MESMA casca de um post de propósito: avatar, nome, foto sangrando,
   legenda. É assim que anúncio funciona no Instagram, e é o que faz alguém
   ler em vez de pular. O que o separa não é a forma, é a etiqueta: onde um
   post diz o endereço, este diz "Recado" — e não tem ações de farejador,
   porque não há pet nenhum para avistar.

   A primeira versão era uma faixa escura fixa no topo. Parecia banner de
   site, e banner de topo o olho aprende a pular em dois dias. */
function recadoHTML(r) {
  const u = linkSeguro(r.link || '');
  return `
  <article class="post post--recado">
    <header class="post__quem">
      <span class="post__autor-link">
        <span class="avatar avatar--faro" aria-hidden="true">
          <img src="img/faro-marca.png" alt="" width="600" height="668">
        </span>
        <span class="post__id">
          <span class="post__autor">Faro</span>
          <span class="post__local">Recado</span>
        </span>
      </span>
      <button class="post__menu" type="button" data-recado-fechar="${esc(r.id)}"
              aria-label="Dispensar este recado">
        ${svg('<path d="M18 6 6 18M6 6l12 12"/>')}
      </button>
    </header>

    ${r.foto ? `<figure class="post__foto">
      <img src="${esc(r.foto)}" alt="" loading="lazy" onerror="this.closest('figure').remove()">
    </figure>` : ''}

    ${u ? `<a class="recado__acao" href="${esc(u.href)}"
              target="_blank" rel="noopener noreferrer nofollow">
             <span>${esc(r.link_rotulo || 'Saiba mais')}</span>
             <em>${esc(u.hostname)}</em>
             ${svg('<path d="M9 18l6-6-6-6"/>')}
           </a>` : ''}

    <div class="legenda">
      <p><span class="legenda__pet">${esc(r.titulo)}</span></p>
      <p class="legenda__texto legenda__texto--inteiro">${esc(r.texto)}</p>
    </div>
  </article>`;
}

/* Onde o anúncio entra.

   No topo ele vira banner e o olho pula. Encostado no fim, ninguém chega. O
   Instagram põe o primeiro por volta do quarto post, e é um bom lugar: depois
   de a pessoa já ter visto que o feed vale a pena, e antes de ela sair.

   Com feed curto (menos casos que a posição), entra no fim — melhor no fim
   que empurrando o primeiro caso urgente para baixo. */
const DEPOIS_DE = 3;      // posts antes do primeiro recado
const ESPACO    = 6;      // e de quantos em quantos, se houver mais de um

function intercalar(posts, recados) {
  if (!recados.length) return posts.map(postHTML).join('');

  const saida = posts.map(postHTML);
  recados.forEach((r, i) => {
    const onde = DEPOIS_DE + i * ESPACO + i;       // +i porque cada inserção desloca
    saida.splice(Math.min(onde, saida.length), 0, recadoHTML(r));
  });
  return saida.join('');
}

/* O card que fecha o ciclo. Sem distância, sem botão de avistar, sem "falar
   com o tutor" — não há nada a fazer, e oferecer ação seria falso. O que ele
   mostra é o que a pessoa quer saber: quanto tempo o pet ficou fora e quantos
   farejadores ajudaram. */
function reencontroHTML(p, novo = false) {
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
  <article class="post reencontro ${novo ? 'reencontro--novo' : ''}" data-tipo="${p.tipo}">
    ${cabecalhoHTML(p)}
    ${fotoHTML(p, true)}
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

/* O TAMANHO DA COMUNIDADE — e o silêncio abaixo do piso.

   O banco devolve o número inteiro e honesto (schema-23); é esta linha que
   decide calar quando ele ainda é pequeno demais para ajudar. O porquê do piso,
   e o seu valor, ficam em dados.js — um lugar só, para a porta de entrada e o
   feed nunca discordarem. */
async function pintarComunidade() {
  const alvo = $('#comunidade');
  if (!alvo) return;
  const n = await farejadoresAtivos();
  if (!(n >= PISO_COMUNIDADE)) { alvo.hidden = true; return; }
  alvo.innerHTML = `${IC_PATA}<span><b>${n.toLocaleString('pt-BR')} farejadores ativos</b>
    em ${esc(MARCA.cidade)} no último mês</span>`;
  alvo.hidden = false;
}

/* O AVISO NA ABA — a comemoração sem poluir o feed.

   Uma versão anterior punha o caso resolvido de volta no feed por três dias.
   Durou um dia: numa cidade com poucos casos por dia, um reencontro entre
   cinco cards é 20% de um feed cujo trabalho é dizer "alguém aqui perto
   precisa de você" — e nenhum peso baixo conserta isso, porque o card ocupa a
   tela do celular inteira do mesmo jeito.

   O pontinho resolve os dois lados: o feed volta a ser só ação, e a boa
   notícia ganha o que o card nunca teve — motivo de VOLTAR. Card no feed se vê
   passando; pontinho no ícone se toca.

   A marca de "já vi" mora no navegador, não no banco: é preferência de leitura
   de UM aparelho, não fato sobre o caso — e no banco visitante deslogado não
   teria aviso nenhum. Quem nunca abriu a aba começa com três dias de história,
   para a primeira visita já ter o que comemorar em vez de uma tela cinza. */
const VISTO = 'faro:reencontros-visto';
const ESTREIA_H = 72;

function reencontrosVistosEm() {
  try {
    const t = Date.parse(localStorage.getItem(VISTO) || '');
    if (Number.isFinite(t)) return new Date(t).toISOString();
  } catch { /* navegador sem armazenamento: vale a estreia */ }
  return new Date(Date.now() - ESTREIA_H * 3600e3).toISOString();
}

function marcarReencontrosVistos() {
  try { localStorage.setItem(VISTO, new Date().toISOString()); } catch { /* tudo bem */ }
}

/* Nunca derruba nada: sem rede, o feed abre igual e simplesmente não há
   pontinho. Um aviso é um enfeite; o feed é o produto. */
async function pintarAvisoDeReencontros() {
  const botao = $('.abas button[data-aba="reencontros"]');
  if (!botao) return;
  try {
    const n = estado.aba === 'reencontros' ? 0 : await novosReencontros({
      ...ORIGEM, raioM: ABAS.reencontros.raio, desde: reencontrosVistosEm(),
    });
    botao.classList.toggle('tem-novos', n > 0);
    /* O número fica no rótulo para quem usa leitor de tela: o pontinho é
       visual, e "Reencontros" sozinho não diria que há novidade. */
    botao.setAttribute('aria-label', n > 0
      ? `Reencontros — ${n} ${n === 1 ? 'novo' : 'novos'}`
      : 'Reencontros');
  } catch { botao.classList.remove('tem-novos'); }
}

/* O ESQUELETO DO FEED.

   O feed nascia vazio e a abertura do app espera a geolocalização antes de
   pintar qualquer coisa — em rede ruim, que é a condição de quem está na rua
   procurando um cachorro, a tela ficava branca sem explicação.

   Reaproveita a marcação do card de verdade em vez de inventar alturas: o
   `.post__foto` vazio já é `aspect-ratio: 1/1` com fundo cinza, então a
   silhueta tem a altura exata de um card sem uma linha de CSS nova para isso.

   DOIS, não cinco. Num celular um card sozinho já passa da dobra; o segundo
   cortado ao meio é o que diz "tem mais embaixo".

   `aria-hidden` porque `#feed` é uma região `aria-live`: sem isso, o leitor de
   tela anuncia as barras cinzas e depois anuncia o conteúdo de novo. */
const ESQUELETO = `
  <article class="post post--esqueleto" aria-hidden="true">
    <header class="post__quem">
      <span class="avatar"></span>
      <span class="osso osso--nome"></span>
    </header>
    <div class="post__foto"></div>
    <div class="legenda">
      <span class="osso"></span>
      <span class="osso osso--curta"></span>
    </div>
  </article>`.repeat(2);

/* Mostra o esqueleto SÓ se a espera passar de 120 ms, e o segura por pelo menos
   300 ms depois disso. Sem a primeira trava ele pisca com o service worker
   quente; sem a segunda, pisca ao sair. */
function esqueletoDoFeed(alvo) {
  let nasceu = 0;
  const marcado = setTimeout(() => {
    nasceu = Date.now();
    alvo.setAttribute('aria-busy', 'true');
    alvo.innerHTML = ESQUELETO;
  }, 120);

  return async () => {
    clearTimeout(marcado);
    if (nasceu) {
      const falta = 300 - (Date.now() - nasceu);
      if (falta > 0) await new Promise((r) => setTimeout(r, falta));
    }
    alvo.removeAttribute('aria-busy');
  };
}

async function pintarRecados() {
  // Nunca derruba o feed: se falhar, simplesmente não há recado.
  const lidos = recadosLidos();
  return (await recadosAtivos()).filter((r) => !lidos.has(r.id));
}

async function pintarFeed() {
  const alvo = $('#feed');
  const aba = ABAS[estado.aba] || ABAS.buscas;
  const raio = aba.raio || estado.raioM;

  /* Na troca de aba, o topo primeiro. Sem isto a lista nova nasce no meio (a
     rolagem da lista anterior fica onde estava), e trocar cinco cards por dois
     de esqueleto encolhe o documento e dá um segundo salto. Em rolagem zero,
     encolher não desloca nada. */
  if (estado.pintado) window.scrollTo(0, 0);

  const esqueletoPronto = esqueletoDoFeed(alvo);
  const pintar = async (html) => { await esqueletoPronto(); alvo.innerHTML = html; };
  estado.pintado = true;

  try {
    if (estado.aba === 'reencontros') {
      /* Lê a marca ANTES de carregar e só a atualiza depois de desenhar: se a
         consulta falhar, a pessoa não perde os reencontros que ainda não viu. */
      const desde = reencontrosVistosEm();
      const lista = await reencontros({ ...ORIGEM, raioM: raio });
      /* Compara CARIMBO, não texto: o Postgres devolve "+00:00" e o navegador
         escreve "Z" — as duas datas iguais dariam desiguais como string. */
      const limite = Date.parse(desde);
      const ehNovo = (p) => Date.parse(p.resolvido_em) > limite;
      const novos = lista.filter(ehNovo).length;

      await pintar(lista.length
        ? (novos
            ? `<p class="feed__titulo">${novos === 1
                 ? 'Um reencontro desde a sua última visita'
                 : `${novos} reencontros desde a sua última visita`}</p>`
            : '')
          + lista.map((p) => reencontroHTML(p, ehNovo(p))).join('')
        : `<div class="vazio"><strong>Ainda não há reencontros por aqui</strong>
           Quando um caso terminar bem, ele aparece nesta página.</div>`);

      marcarReencontrosVistos();
      pintarAvisoDeReencontros();
      return;
    }

    const [posts, recados] = await Promise.all([
      feedPorRaio({ ...ORIGEM, raioM: raio, tipos: aba.tipos }),
      pintarRecados(),
    ]);
    await pintar(posts.length
      ? intercalar(posts, recados)
      : estado.aba === 'adocao'
        ? `<div class="vazio"><strong>Nenhum pet para adoção agora</strong>
           As adoções são publicadas por ONGs e protetores da cidade.</div>`
         + recados.map(recadoHTML).join('')
        : `<div class="vazio"><strong>Nada por aqui agora</strong>
           Nenhum caso aberto nesta área. Aumente a distância no seu perfil.</div>`
         + recados.map(recadoHTML).join(''));
  } catch (e) {
    await pintar(`<div class="vazio"><strong>Não consegui carregar</strong>${esc(e.message)}</div>`);
  }
}

// --- detalhe ------------------------------------------------------------------

let mapa = null;
let postAberto = null;

/* `renovando` = a tela já está aberta e só o conteúdo mudou (chegou um
   avistamento). Nesse caso não se mexe no foco nem na rolagem de quem está
   lendo — só o miolo é reescrito. */
async function abrirDetalhe(id, renovando = false) {
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

    ${areaHTML(p, rastro)}

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
  if (!renovando) $('#detalhe .icone-botao').focus();
  desenharMapa(rastro.length ? rastro : [p], p);
}

/* A área provável só faz sentido em caso ABERTO e do tipo `perdido`. Caso
   encontrado o pet está a salvo com alguém; caso encerrado, acabou. Desenhar
   anel de busca nos dois seria mentira desenhada. */
const temArea = (p) => p && p.tipo === 'perdido' && p.status === 'aberto';

function areaHTML(p, rastro) {
  if (!temArea(p)) return '';

  const horas = horasDesdeUltimoPonto(p, rastro);
  const a = areaDeBusca({ especie: p.especie, acessoRua: p.acesso_rua, horas });
  const c = conselho(p.especie, p.acesso_rua);
  const recente = (rastro?.length || 0) > 1;

  return `
  <div class="secao">
    <h3 class="secao__titulo">Onde procurar agora</h3>

    <ol class="zonas">
      ${a.zonas.map((z, i) => `
        <li class="zona" data-zona="${i}">
          <span class="zona__cor" aria-hidden="true"></span>
          <span class="zona__texto">
            <strong>${i === 0 ? ACOES[0] : ACOES[1]}</strong>
            <em>até ${fmtDistancia(z.raio)} — ${esc(z.mede)}</em>
          </span>
        </li>`).join('')}
      <li class="zona zona--alem">
        <span class="zona__cor" aria-hidden="true"></span>
        <span class="zona__texto">
          <strong>Espalhe o link e avise clínicas e o canil</strong>
          <em>${a.alem.porcento}% aparecem além disso — aí o mapa já não ajuda</em>
        </span>
      </li>
    </ol>

    <p class="secao__nota">
      Medido ${recente ? '<b>a partir do último avistamento</b>' : 'a partir de onde sumiu'},
      há ${fmtTempo(rastro?.[0]?.ocorrido_em || p.ocorrido_em).replace(/^há /, '')}.
      ${a.cheio ? '' : 'A área ainda está crescendo com o tempo. '}
      <button class="elo" type="button" data-acao="fontes">De onde vêm estes números</button>
    </p>

    <div class="conselho">
      <h4>${esc(c.titulo)}</h4>
      ${c.linhas.map((l) => `<p>${negrito(l)}</p>`).join('')}
    </div>
  </div>`;
}

const ACOES = ['Procure a pé, com lanterna', 'Cole cartaz e fale com os vizinhos'];

/* Os textos de conselho vêm de area-busca.js com **destaque** em markdown-ish.
   É a ÚNICA interpolação de HTML a partir de texto no app, e ela é segura
   porque o texto é nosso, constante, e passa por esc() antes: o ** vira <b> e
   mais nada. Texto de usuário continua sem esta porta. */
const negrito = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

function desenharMapa(pontos, post = null) {
  if (mapa) { mapa.remove(); mapa = null; }
  mapa = L.map('mapa', { scrollWheelZoom: false });

  /* Vista ANTES de qualquer camada. Sem centro e zoom, o Leaflet não projeta o
     que é adicionado — e um `L.circle` sem projeção estoura ao calcular os
     próprios limites, derrubando o resto desta função em silêncio: mapa cinza,
     sem ladrilho e sem alfinete. O enquadramento definitivo vem no fim. */
  mapa.setView([pontos[0].lat, pontos[0].lng], 15);

  // OpenStreetMap: sem chave. O 'cartodbpositron' do protótipo passou a exigir
  // cadastro e estampava "API KEY REQUIRED" sobre o mapa inteiro.
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(mapa);

  const coords = pontos.map((r) => [r.lat, r.lng]);

  /* Os anéis ANTES dos marcadores: o Leaflet empilha na ordem de inserção, e
     um círculo por cima rouba o clique do alfinete que ele cobre.
     `L.circle` recebe o raio em METROS e projeta sozinho — a geodésia em 64
     pontos que o documento original trazia seria reescrever o que a biblioteca
     já faz certo. */
  let menorRaio = 0;
  if (temArea(post)) {
    const a = areaDeBusca({
      especie: post.especie, acessoRua: post.acesso_rua,
      horas: horasDesdeUltimoPonto(post, pontos),
    });
    menorRaio = Math.min(...a.zonas.map((z) => z.raio));
    // Do maior para o menor, senão o externo tapa os internos.
    [...a.zonas].reverse().forEach((z, i) => {
      const dentro = i === a.zonas.length - 1;
      L.circle(coords[0], {
        radius: z.raio,
        color: dentro ? '#DD8C18' : '#15719F',
        weight: dentro ? 2 : 1.5,
        fillColor: dentro ? '#DD8C18' : '#15719F',
        fillOpacity: dentro ? .12 : .07,
        interactive: false,          // o mapa é para ver os pontos, não os anéis
      }).addTo(mapa);
    });
  }

  pontos.forEach((r, i) => {
    const ultimo = i === 0;
    L.circleMarker([r.lat, r.lng], {
      radius: ultimo ? 9 : 6, color: '#fff', weight: 2,
      fillColor: ultimo ? '#DD8C18' : '#15719F', fillOpacity: 1,
    }).addTo(mapa).bindPopup(`<strong>${esc(r.endereco || '')}</strong><br>${fmtTempo(r.ocorrido_em)}`);
  });

  if (coords.length > 1) {
    L.polyline(coords, { color: '#15719F', weight: 2, dashArray: '5,6', opacity: .75 }).addTo(mapa);
  }

  /* O ENQUADRAMENTO: O RASTRO GANHA DO ANEL.

     A primeira versão abria enquadrando o MAIOR anel. Parecia certo — "de nada
     adianta desenhar a área e cortar metade dela" — e destruía o mapa: um anel
     de 8 km põe a cidade inteira num polegar, e um rastro de trezentos metros
     vira uma linha de seis pixels debaixo do alfinete. Os pontos continuavam
     desenhados; ninguém conseguia vê-los.

     Não dá para mostrar 8 km e 300 m na mesma tela de celular — é preciso
     escolher, e a escolha é o rastro: ele é FATO (alguém viu o pet ali, e a
     rua importa), o anel é MODELO. E o anel não se perde: continua desenhado
     para quem afastar, e a legenda logo abaixo diz os raios em palavras
     ("até 1,6 km", "até 8,0 km"), que é onde um número grande se lê melhor.

     Só quando não há rastro o anel decide o zoom — e aí é o anel INTERNO, o
     que quer dizer "saia a pé agora". `toBounds` faz a conta com o raio em
     metros e não depende de camada projetada, que foi o que quebrou antes. */
  if (coords.length > 1) {
    // maxZoom: sem isto, dois pontos quase no mesmo lugar levam o mapa ao
    // zoom máximo e a pessoa perde a referência da rua.
    mapa.fitBounds(coords, { padding: [34, 34], maxZoom: 16 });
  } else if (menorRaio > 0) {
    mapa.fitBounds(L.latLng(coords[0]).toBounds(menorRaio * 2.2), { padding: [12, 12], maxZoom: 16 });
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
  if (existentes.length) {
    existentes.forEach((el) => {
      /* Bate só quando o número SOBE. Esta função é chamada em toda repintura,
         e pulsar sempre faria o feed espasmar no carregamento. O valor anterior
         mora no próprio elemento porque o `innerHTML` abaixo o destrói. */
      const subiu = Number(el.dataset.total || 0) < total;
      el.innerHTML = html;
      el.dataset.total = String(total);
      /* `animation` e não `transition`: o <b> acabou de ser recriado, não há
         valor anterior para interpolar — transição nasceria morta.

         Tirar a classe, ler o layout e pôr de volta é o que faz a animação
         RECOMEÇAR. Só acrescentar não adianta na segunda vez: a classe já está
         lá, e para o navegador nada mudou. */
      if (subiu) {
        el.classList.remove('farejadores--subiu');
        void el.offsetWidth;
        el.classList.add('farejadores--subiu');
      }
    });
    return;
  }

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
    alvo.closest('.post--recado')?.remove();
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
    case 'centralizar':  mapaTela.centralizarEmMim(alvo); return;
    case 'camada-area': mapaTela.alternarArea(alvo); return;
    case 'ir-feed':     if (!$('#detalhe').hidden) fecharDetalhe();
                        if (mapaTela.estaAberto()) { mapaTela.fechar(); history.replaceState(null, '', '#/'); }
                        marcarAba('ir-feed');
                        window.scrollTo({ top: 0, behavior: 'smooth' }); return;
    case 'conta':     estaLogado() ? (location.hash = `#/perfil/${meuId()}`) : form.abrirConta('entrar'); return;
    case 'ir-admin':  location.hash = '#/admin'; return;
    case 'fontes':    form.abrirFontes(FONTES); return;
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

  /* Área do administrador. Rota própria — dá endereço, botão voltar e história
     no navegador; e o admin.js recusa e devolve para o feed se quem chegou
     aqui não for administrador. */
  if (location.hash === '#/admin') {
    if (!$('#detalhe').hidden) fecharDetalhe();
    if (perfilTela.estaAberto()) perfilTela.fechar();
    adminTela.abrir();
    return;
  }
  if (adminTela.estaAberto()) adminTela.fechar();

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
  if (nova !== estado.aba || !estado.pintado) {
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
  pintarAvisoDeReencontros();
  carregarNovidades();
  if (perfilTela.estaAberto()) perfilTela.recarregar();

  /* O DETALHE TAMBÉM. Quem registrava um avistamento a partir da tela do caso
     voltava para ela com o rastro e o contador VELHOS — e só descobria fechando
     e abrindo de novo. A tela nunca era repintada: `aoMudar` cuidava do feed,
     das novidades e do perfil, e esquecia justamente a tela de onde a pessoa
     tinha acabado de agir. */
  if (!$('#detalhe').hidden && postAberto) abrirDetalhe(postAberto.id, true);
} });

aoMudarSessao(() => {
  const b = $('[data-conta-texto]');
  if (b) b.textContent = estaLogado() ? (meuNome().split(' ')[0] || 'Conta') : 'Entrar';
  carregarNovidades();

  souAdmin = false;
  if (estaLogado()) {
    /* Faxina do que ficou para trás numa tentativa anterior de apagar foto.
       Aqui, e não na abertura do app, porque a fila é por pessoa: antes da
       sessão existir não há o que varrer. Silenciosa por natureza — se falhar
       de novo, a fila continua e a próxima sessão tenta. */
    varrerFotosOrfas();

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

/* O esqueleto vai para a tela ANTES de tudo. A cadeia abaixo espera
   `situarUsuario()`, que pode esperar a permissão de localização — e é essa a
   espera que deixava a tela branca. Pôr o esqueleto dentro de `pintarFeed()`
   não alcançaria, porque `pintarFeed()` ainda nem foi chamada. */
$('#feed').setAttribute('aria-busy', 'true');
$('#feed').innerHTML = ESQUELETO;

situarUsuario()
  // Nada aqui pode impedir o feed de aparecer: sem localização o app funciona,
  // sem feed não funciona.
  .catch(() => {})
  .then(pintarChip)
  .then(pintarFeed)
  .then(rotear)
  // O pontinho e o contador vêm depois de tudo: são o enfeite, não o produto.
  .then(pintarAvisoDeReencontros)
  .then(pintarComunidade);

/* Service worker e convite de instalação. Fica por último de propósito: nada
   aqui é necessário para o feed aparecer. */
pwa.comecar({ aoNavegar: (url) => { location.href = url; } });
