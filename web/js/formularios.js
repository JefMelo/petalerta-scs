/* =============================================================================
   Faro — folhas de formulário (conta, publicar, avistar, raio)
   Uma folha por vez, sobe de baixo. Toda a escrita no banco passa por aqui.
   ============================================================================= */

import * as dados from './dados.js?v=23';

const $ = (s, r = document) => r.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let aoMudar = () => {};
export function configurar({ aoMudar: fn }) { if (fn) aoMudar = fn; }

// --- casca da folha -----------------------------------------------------------

let mapaForm = null;
/* Um AbortController por folha. Sem ele os ouvintes de clique se acumulavam em
   #folha-form — e como o <form> antigo continua vivo desanexado, com os valores
   ainda preenchidos, confirmar uma folha reenviava a anterior. Dava post duplicado. */
let controle = null;

function abrir({ titulo, corpo, acao, aoConfirmar, aoAbrir }) {
  fechar();
  controle = new AbortController();
  const { signal } = controle;
  const f = $('#folha-form');
  f.innerHTML = `
    <div class="folha__topo">
      <div class="interno">
        <button class="icone-botao" type="button" data-fechar aria-label="Fechar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
        <h2 class="folha__nome">${esc(titulo)}</h2>
        ${acao ? `<button class="folha__acao" type="button" data-confirmar>${esc(acao)}</button>` : ''}
      </div>
    </div>
    <form class="formulario" novalidate>
      ${corpo}
      <p class="erro" hidden></p>
    </form>`;

  f.hidden = false;
  document.body.style.overflow = 'hidden';

  const form = $('form', f);
  form.addEventListener('submit', (ev) => { ev.preventDefault(); confirmar(); }, { signal });

  f.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-fechar]')) fechar();
    if (ev.target.closest('[data-confirmar]')) confirmar();
  }, { signal });

  let enviando = false;
  async function confirmar() {
    if (enviando) return;                 // duplo toque não vira dois posts
    enviando = true;
    const botao = $('[data-confirmar]', f);
    const erro = $('.erro', f);
    erro.hidden = true;
    if (botao) { botao.disabled = true; botao.dataset.antes = botao.textContent; botao.textContent = 'Enviando…'; }
    try {
      await aoConfirmar(form);
      fechar();
    } catch (e) {
      erro.textContent = e.message || String(e);
      erro.hidden = false;
      erro.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } finally {
      enviando = false;
      if (botao) { botao.disabled = false; botao.textContent = botao.dataset.antes; }
    }
  }

  document.addEventListener('keydown',
    (ev) => { if (ev.key === 'Escape') fechar(); }, { signal });

  aoAbrir?.(f);
  setTimeout(() => $('input, select, textarea', f)?.focus(), 80);
}

export function fechar() {
  if (controle) { controle.abort(); controle = null; }   // desliga TUDO da folha
  const f = $('#folha-form');
  f.hidden = true;
  f.innerHTML = '';
  document.body.style.overflow = '';
  if (mapaForm) { mapaForm.remove(); mapaForm = null; }
}

// --- peças reutilizáveis ------------------------------------------------------

const campo = (nome, rotulo, attrs = '', dica = '') => `
  <label class="campo">
    <span class="campo__rotulo">${esc(rotulo)}</span>
    <input name="${nome}" ${attrs}>
    ${dica ? `<span class="campo__dica">${esc(dica)}</span>` : ''}
  </label>`;

const area = (nome, rotulo, ph = '') => `
  <label class="campo">
    <span class="campo__rotulo">${esc(rotulo)}</span>
    <textarea name="${nome}" rows="4" placeholder="${esc(ph)}"></textarea>
  </label>`;

const escolha = (nome, rotulo, opcoes) => `
  <label class="campo">
    <span class="campo__rotulo">${esc(rotulo)}</span>
    <select name="${nome}">
      ${opcoes.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}
    </select>
  </label>`;

const ICONE_FOTO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/>
  <path d="m21 16-5-5L5 19"/></svg>`;

/* Uma foto (avistamento) ou até três (caso novo). Três ajudam a reconhecer o
   pet — de frente, de lado, a marca particular. Num avistamento seria poluição. */
const fotosHTML = (max = 1) => `
  <div class="campo">
    <span class="campo__rotulo">${max > 1 ? `Fotos <span class="campo__contador" data-contador>0 de ${max}</span>` : 'Foto'}</span>
    <input type="file" name="foto" accept="image/*" ${max > 1 ? 'multiple' : ''} hidden>
    <div class="fotos" data-fotos data-max="${max}"></div>
    ${max > 1 ? '<span class="campo__dica">De frente, de lado e a marca que identifica. A primeira vira a capa.</span>' : ''}
  </div>`;

const mapaHTML = `
  <div class="campo">
    <span class="campo__rotulo">Onde foi</span>
    <div class="mapa-escolha">
      <div id="mapa-form"></div>
      <div class="mapa-escolha__pino" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="#DD8C18" stroke="#fff" stroke-width="1.5">
          <path d="M12 23s7-6.4 7-11.4a7 7 0 1 0-14 0C5 16.6 12 23 12 23Z"/>
          <circle cx="12" cy="11" r="2.4" fill="#fff" stroke="none"/></svg>
      </div>
    </div>
    <button class="botao-fraco" type="button" data-gps>Usar minha localização</button>
    <input name="endereco" placeholder="Rua, número, bairro" autocomplete="off">
  </div>`;

/** Liga o Leaflet dentro da folha. O ponto é sempre o centro do mapa. */
function montarMapa(f, centro) {
  const ponto = { ...centro };
  mapaForm = L.map('mapa-form', { zoomControl: false, attributionControl: false })
    .setView([centro.lat, centro.lng], 15);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapaForm);
  mapaForm.on('move', () => {
    const c = mapaForm.getCenter();
    ponto.lat = c.lat; ponto.lng = c.lng;
  });
  setTimeout(() => mapaForm.invalidateSize(), 120);

  $('[data-gps]', f)?.addEventListener('click', async (ev) => {
    const b = ev.currentTarget;
    b.disabled = true; b.textContent = 'Procurando…';
    try {
      const p = await dados.usarMinhaLocalizacao({ preciso: true });
      mapaForm.setView([p.lat, p.lng], 17);
      const end = await enderecoDe(p);
      if (end && !$('[name=endereco]', f).value) $('[name=endereco]', f).value = end;
      b.textContent = 'Usar minha localização';
    } catch {
      b.textContent = 'Não consegui — mova o mapa';
    } finally { b.disabled = false; }
  });

  return ponto;
}

/** Só para dar uma sugestão de endereço; se falhar, a pessoa digita. */
async function enderecoDe({ lat, lng }) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`,
      { headers: { 'Accept-Language': 'pt-BR' } });
    const d = await r.json();
    const a = d.address || {};
    return [a.road, a.house_number, a.suburb || a.neighbourhood].filter(Boolean).join(', ');
  } catch { return ''; }
}

/* f._fotos guarda dois tipos de item, na ordem: um File recém-escolhido ou
   { path, url } de uma foto que já está no banco. Quem grava resolve os dois. */
function ligarFotos(f, jaExistem = []) {
  const input = $('[name=foto]', f);
  const caixa = $('[data-fotos]', f);
  if (!input || !caixa) return;
  const max = +caixa.dataset.max || 1;
  f._fotos = [...jaExistem];

  const pintar = () => {
    caixa.innerHTML = f._fotos.map((item, i) => `
      <div class="foto-item">
        <img src="${item instanceof File ? URL.createObjectURL(item) : esc(item.url)}" alt="">
        ${i === 0 && max > 1 ? '<span class="foto-item__capa">Capa</span>' : ''}
        <button class="foto-item__tirar" type="button" data-tirar="${i}" aria-label="Remover foto ${i + 1}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
               stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>`).join('')
      + (f._fotos.length < max ? `
        <button class="foto-add" type="button" data-add>
          ${ICONE_FOTO}
          <span>${f._fotos.length ? 'Mais uma' : (max > 1 ? 'Escolher fotos' : 'Escolher uma foto')}</span>
        </button>` : '');

    const contador = $('[data-contador]', f);
    if (contador) contador.textContent = `${f._fotos.length} de ${max}`;
  };

  caixa.addEventListener('click', (ev) => {
    const tirar = ev.target.closest('[data-tirar]');
    if (tirar) { f._fotos.splice(+tirar.dataset.tirar, 1); pintar(); return; }
    if (ev.target.closest('[data-add]')) input.click();
  });

  input.addEventListener('change', () => {
    const novos = [...(input.files || [])];
    // O celular manda tudo de uma vez; o limite é aqui, não na confiança.
    f._fotos = [...f._fotos, ...novos].slice(0, max);
    input.value = '';                  // permite reescolher o mesmo arquivo
    pintar();
  });

  pintar();
}

const valor = (f, n) => (f.elements[n]?.value || '').trim();

// --- conta --------------------------------------------------------------------

export function abrirConta(modo = 'entrar') {
  const entrando = modo === 'entrar';
  abrir({
    titulo: entrando ? 'Entrar' : 'Criar conta',
    acao: entrando ? 'Entrar' : 'Criar',
    corpo: `
      ${entrando ? '' : campo('nome', 'Seu nome', 'required autocomplete="name"')}
      ${entrando ? '' : campo('whatsapp', 'WhatsApp', 'inputmode="tel" autocomplete="tel"',
        'É por aqui que quem achar o seu pet vai te chamar.')}
      ${campo('email', 'E-mail', 'type="email" required autocomplete="email"')}
      ${campo('senha', 'Senha', `type="password" required autocomplete="${entrando ? 'current' : 'new'}-password"`)}
      <button class="botao-fraco" type="button" data-trocar>
        ${entrando ? 'Ainda não tenho conta' : 'Já tenho conta'}
      </button>`,
    aoAbrir: (f) => {
      $('[data-trocar]', f).addEventListener('click', () => {
        fechar(); abrirConta(entrando ? 'criar' : 'entrar');
      });
    },
    aoConfirmar: async (form) => {
      const email = valor(form, 'email'), senha = valor(form, 'senha');
      if (!email || !senha) throw new Error('Preencha e-mail e senha.');
      if (entrando) {
        await dados.entrar(email, senha);
      } else {
        if (!valor(form, 'nome')) throw new Error('Diga o seu nome.');
        const s = await dados.criarConta({
          nome: valor(form, 'nome'), whatsapp: valor(form, 'whatsapp'), email, senha });
        if (!s) throw new Error('Conta criada. Confirme o e-mail e depois entre.');
      }
      aoMudar();
    },
  });
}

// --- publicar -----------------------------------------------------------------

const TIPOS = [
  ['perdido',    'Perdi meu pet'],
  ['avistado',   'Vi um pet na rua'],
  ['encontrado', 'Encontrei e está comigo'],
  ['adocao',     'Quero doar'],
];

export const abrirPublicar = (centro) => abrirCaso(centro, null);
export const abrirEditar    = (post, centro) => abrirCaso(centro, post);

/* Publicar e editar são o mesmo formulário. A única diferença é de onde vêm os
   valores iniciais e qual função do banco recebe o resultado. */
function abrirCaso(centro, post) {
  if (!dados.estaLogado()) return abrirConta('entrar');
  const editando = !!post;

  // Num avistamento ligado a um caso, o tipo não se escolhe: ele já é o que é.
  const ehAvistamentoLigado = editando && post.post_origem_id;

  abrir({
    titulo: editando ? 'Editar' : 'Publicar',
    acao: editando ? 'Salvar' : 'Publicar',
    corpo: `
      ${ehAvistamentoLigado ? '' : `
      <div class="tipos" role="radiogroup" aria-label="O que aconteceu">
        ${TIPOS.map(([v, t]) => `
          <label class="tipo">
            <input type="radio" name="tipo" value="${v}"
              ${(editando ? post.tipo === v : v === 'perdido') ? 'checked' : ''}>
            <span>${esc(t)}</span>
          </label>`).join('')}
      </div>`}
      ${fotosHTML(ehAvistamentoLigado ? 1 : 3)}
      ${campo('titulo', 'Nome do pet', 'required maxlength="60"')}
      ${escolha('especie', 'Espécie', [['cao', 'Cão'], ['gato', 'Gato'], ['outro', 'Outro']])}
      ${campo('raca', 'Raça', 'maxlength="60"', 'Se não souber, escreva "sem raça definida".')}
      ${campo('cor', 'Cor', 'maxlength="40"')}
      ${escolha('porte', 'Porte', [['', 'Não sei'], ['pequeno', 'Pequeno'], ['medio', 'Médio'], ['grande', 'Grande']])}
      ${escolha('sexo', 'Sexo', [['desconhecido', 'Não sei'], ['macho', 'Macho'], ['femea', 'Fêmea']])}
      ${escolha('castrado', 'Castrado', [['', 'Não sei'], ['sim', 'Sim'], ['nao', 'Não']])}
      ${area('sinais', 'Sinais que identificam', 'Coleira, cicatriz, falha de pelo, jeito de andar…')}
      ${area('texto', 'Conte o que aconteceu', 'Quanto mais detalhe, mais fácil alguém reconhecer.')}
      ${mapaHTML}
      ${campo('quando', 'Quando foi', 'type="datetime-local"')}`,

    aoAbrir: (f) => {
      const jaExistem = editando
        ? (post.fotos_path || []).map((path, i) => ({ path, url: post.fotos[i] }))
        : [];
      f._originais = jaExistem.map((x) => x.path);
      ligarFotos(f, jaExistem);

      f._ponto = montarMapa(f, editando && post.lat != null
        ? { lat: post.lat, lng: post.lng } : centro);

      const localHora = (d) =>
        new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      $('[name=quando]', f).value = localHora(editando ? new Date(post.ocorrido_em) : new Date());

      if (editando) {
        const põe = (n, v) => { const e = $(`[name=${n}]`, f); if (e) e.value = v ?? ''; };
        põe('titulo', post.titulo);
        põe('especie', post.especie);
        põe('raca', post.raca);
        põe('cor', post.cor);
        põe('porte', post.porte || '');
        põe('sexo', post.sexo || 'desconhecido');
        põe('castrado', post.castrado == null ? '' : (post.castrado ? 'sim' : 'nao'));
        põe('sinais', post.sinais);
        põe('texto', post.texto);
        põe('endereco', post.endereco);
      }

      // Cada tipo pede coisas diferentes. Avistamento não tem nome nem sinais.
      const ajustar = () => {
        const t = f.querySelector('[name=tipo]:checked')?.value || post?.tipo || 'perdido';
        const campoTitulo = $('[name=titulo]', f);
        const rotulo = campoTitulo.closest('.campo').querySelector('.campo__rotulo');
        const nomeavel = t === 'perdido' || t === 'adocao';
        rotulo.textContent = nomeavel ? 'Nome do pet' : 'Como era o pet';
        campoTitulo.placeholder = nomeavel ? '' : 'Ex.: cão preto, porte médio';
        const mostrar = (nome, sim) => {
          const el = $(`[name=${nome}]`, f);
          if (el) el.closest('.campo').hidden = !sim;
        };
        mostrar('sinais',   t === 'perdido');
        mostrar('castrado', nomeavel);
        mostrar('quando',   t !== 'adocao');
      };
      f.querySelectorAll('[name=tipo]').forEach((r) => r.addEventListener('change', ajustar));
      ajustar();
    },

    aoConfirmar: async (form) => {
      const f = $('#folha-form');
      const titulo = valor(form, 'titulo');
      if (!titulo) throw new Error('Diga o nome do pet, ou como ele é.');

      // File novo sobe agora; foto que já existia devolve o caminho dela.
      const fotos = [];
      for (const item of (f._fotos || [])) {
        fotos.push(item instanceof File ? await dados.enviarFoto(item) : item.path);
      }

      const castrado = valor(form, 'castrado');
      const quando = valor(form, 'quando');
      const comum = {
        p_titulo: titulo,
        p_texto: valor(form, 'texto'),
        p_lat: f._ponto.lat,
        p_lng: f._ponto.lng,
        p_endereco: valor(form, 'endereco'),
        p_especie: valor(form, 'especie'),
        p_raca: valor(form, 'raca'),
        p_cor: valor(form, 'cor'),
        p_porte: valor(form, 'porte') || null,
        p_sexo: valor(form, 'sexo'),
        p_castrado: castrado === '' ? null : castrado === 'sim',
        p_sinais: valor(form, 'sinais'),
        p_ocorrido_em: quando ? new Date(quando).toISOString() : null,
        p_fotos: fotos,
      };

      if (editando) {
        await dados.editarPost({ p_id: post.id, ...comum });
        // O que saiu da lista sai também do bucket, senão fica ocupando espaço.
        const sobraram = new Set(fotos);
        await dados.apagarFotosDoBucket((f._originais || []).filter((p) => !sobraram.has(p)));
      } else {
        await dados.criarPost({ p_tipo: form.elements.tipo.value, ...comum });
      }
      aoMudar();
    },
  });
}

/* Menu do dono. Fica no detalhe do caso, como o "..." do Instagram. */
export async function abrirAcoesDoDono(post, { aoApagar } = {}) {
  const encerrado = post.status === 'resolvido';
  const ligados = post.post_origem_id ? 0 : await dados.avistamentosLigados(post.id);

  abrir({
    titulo: post.titulo,
    corpo: `
      <div class="lista-opcoes">
        <button class="opcao" type="button" data-fazer="editar">Editar</button>
        <button class="opcao" type="button" data-fazer="${encerrado ? 'reabrir' : 'resolver'}">
          ${encerrado ? 'Reabrir o caso' : 'Encerrar · o pet apareceu'}
        </button>
        <button class="opcao opcao--perigo" type="button" data-fazer="apagar">Apagar</button>
      </div>
      ${ligados > 0 ? `<p class="folha__ajuda">Apagar este caso leva junto
        ${ligados === 1 ? 'o avistamento que alguém registrou' :
          `os ${ligados} avistamentos que outras pessoas registraram`}.</p>` : ''}`,
    aoAbrir: (f) => {
      f.addEventListener('click', async (ev) => {
        const b = ev.target.closest('[data-fazer]');
        if (!b) return;
        const acao = b.dataset.fazer;

        if (acao === 'editar') { fechar(); abrirEditar(post, dados.ORIGEM); return; }

        if (acao === 'apagar') {
          const aviso = ligados > 0
            ? `Apagar "${post.titulo}" e ${ligados} avistamento(s) ligado(s)? Não dá para desfazer.`
            : `Apagar "${post.titulo}"? Não dá para desfazer.`;
          if (!confirm(aviso)) return;
          await dados.apagarPost(post.id);
          fechar(); aoMudar(); aoApagar?.();
          return;
        }

        if (acao === 'resolver') await dados.resolverPost(post.id);
        if (acao === 'reabrir')  await dados.reabrirPost(post.id);
        fechar(); aoMudar();
      });
    },
    aoConfirmar: async () => {},
  });
}

// --- avistamento --------------------------------------------------------------

export function abrirAvistar(post, centro) {
  if (!dados.estaLogado()) return abrirConta('entrar');

  abrir({
    titulo: `Vi ${post.titulo}`,
    acao: 'Avisar',
    corpo: `
      <p class="folha__ajuda">O tutor recebe o aviso e o ponto entra no rastro.
        Se o pet estiver assustado, não persiga — só diga onde viu.</p>
      ${fotosHTML(1)}
      ${area('texto', 'O que você viu', 'Para que lado foi, como estava, se deixou chegar perto…')}
      ${mapaHTML}
      ${campo('quando', 'Quando foi', 'type="datetime-local"')}`,
    aoAbrir: (f) => {
      ligarFotos(f);
      f._ponto = montarMapa(f, centro);
      const agora = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
      $('[name=quando]', f).value = agora.toISOString().slice(0, 16);
    },
    aoConfirmar: async (form) => {
      const f = $('#folha-form');
      const fotos = [];
      for (const arq of (f._fotos || [])) fotos.push(await dados.enviarFoto(arq));
      const quando = valor(form, 'quando');
      await dados.criarAvistamento({
        p_origem: post.id,
        p_lat: f._ponto.lat,
        p_lng: f._ponto.lng,
        p_endereco: valor(form, 'endereco'),
        p_texto: valor(form, 'texto'),
        p_ocorrido_em: quando ? new Date(quando).toISOString() : null,
        p_fotos: fotos,
      });
      aoMudar();
    },
  });
}

// --- raio ---------------------------------------------------------------------

export function abrirRaio(atual, aoEscolher) {
  const opcoes = [[1000, '1 km'], [3000, '3 km'], [5000, '5 km'], [20000, 'A cidade toda']];
  abrir({
    titulo: 'Até que distância',
    corpo: `
      <p class="folha__ajuda">Santa Cruz do Sul</p>
      <div class="lista-opcoes">
        ${opcoes.map(([v, t]) => `
          <button class="opcao" type="button" data-raio="${v}" ${v === atual ? 'aria-current="true"' : ''}>
            ${esc(t)}
          </button>`).join('')}
      </div>`,
    aoAbrir: (f) => {
      f.querySelectorAll('[data-raio]').forEach((b) =>
        b.addEventListener('click', () => { aoEscolher(+b.dataset.raio); fechar(); }));
    },
    aoConfirmar: async () => {},
  });
}
