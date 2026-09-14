/* =============================================================================
   Faro — folhas de formulário (conta, publicar, avistar, raio)
   Uma folha por vez, sobe de baixo. Toda a escrita no banco passa por aqui.
   ============================================================================= */

import * as dados from './dados.js?v=63';

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

/* Conta qual folha está em cena. Serve para o confirmar() não fechar uma folha
   que não é a dele: se o aoConfirmar abriu OUTRA folha (um aviso, por exemplo),
   o número mudou e o fechamento é abandonado. Sem isso, a folha nova era
   aberta e derrubada no mesmo instante — e a mensagem nunca aparecia. */
let numeroDaFolha = 0;

function abrir({ titulo, corpo, acao, aoConfirmar, aoAbrir }) {
  fechar();
  const minhaFolha = ++numeroDaFolha;
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
      if (numeroDaFolha === minhaFolha) fechar();   // outra folha assumiu: deixa
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

/* Os três tipos de conta, ditos pelo que a pessoa FAZ — não por um rótulo
   jurídico. "Sou uma ONG" é fácil de reconhecer; "papel: ong" não é.

   A escolha vai no metadado do cadastro, que é escrito pelo cliente. Por isso
   o banco só aceita daqui 'ong' e 'protetor', e os dois nascem esperando
   aprovação: mentir aqui não dá poder nenhum, só entra numa fila. */
const PAPEIS = [
  ['farejador', 'Quero ajudar a achar pets',
   'Publica casos, avisa quando vê um pet na rua, compartilha. É a maioria das contas.'],
  ['protetor',  'Sou protetor independente',
   'Resgata por conta própria e precisa anunciar adoção. Passa por aprovação.'],
  ['ong',       'Somos uma ONG ou abrigo',
   'Organização que cuida e dá para adoção. Passa por aprovação.'],
];

const PAPEIS_HTML = `
  <div class="campo">
    <span class="campo__rotulo">Que tipo de conta é a sua</span>
    <div class="papeis" role="radiogroup" aria-label="Tipo de conta">
      ${PAPEIS.map(([v, t, d], i) => `
        <label class="papel">
          <input type="radio" name="papel" value="${v}" ${i === 0 ? 'checked' : ''}>
          <span class="papel__corpo">
            <strong>${esc(t)}</strong>
            <em>${esc(d)}</em>
          </span>
        </label>`).join('')}
    </div>
  </div>`;

export function abrirConta(modo = 'entrar') {
  const entrando = modo === 'entrar';
  abrir({
    titulo: entrando ? 'Entrar' : 'Criar conta',
    acao: entrando ? 'Entrar' : 'Criar',
    corpo: `
      <div class="porta">
        <img class="porta__logo" src="img/faro.png" alt="Faro" width="640" height="853">
        <p class="porta__frase">
          Pets perdidos, avistados e para adoção em Santa Cruz do Sul,
          na ordem de quem está mais perto de você.
        </p>
        <p class="porta__porque">
          A conta serve para duas coisas: <strong>te avisar quando alguém vir o
          seu pet</strong> e mostrar o seu WhatsApp a quem encontrar.
          Para só olhar o mural, não precisa de conta.
        </p>
      </div>

      ${entrando ? '' : PAPEIS_HTML}
      ${entrando ? '' : campo('nome', 'Seu nome', 'required autocomplete="name"')}
      ${entrando ? '' : campo('whatsapp', 'WhatsApp', 'inputmode="tel" autocomplete="tel"',
        'É por aqui que quem achar o seu pet vai te chamar.')}
      ${entrando ? '' : `<div data-so-doador hidden>
        ${area('sobre', 'Conte sobre o seu trabalho',
               'Há quanto tempo, quantos resgates, onde ficam os animais, redes sociais…')}
        <p class="folha__ajuda">
          Um administrador lê isto antes de liberar. Até lá você já usa o Faro
          normalmente — publica, avisa avistamento, ajuda. Só a publicação de
          adoção é que espera.
        </p>
      </div>`}
      ${campo('email', 'E-mail', 'type="email" required autocomplete="email"')}
      ${campo('senha', 'Senha', `type="password" required autocomplete="${entrando ? 'current' : 'new'}-password"`)}
      <button class="botao-fraco" type="button" data-trocar>
        ${entrando ? 'Ainda não tenho conta' : 'Já tenho conta'}
      </button>
      ${entrando ? '<button class="elo" type="button" data-esqueci>Esqueci minha senha</button>' : ''}`,
    aoAbrir: (f) => {
      // "Conte sobre o seu trabalho" só faz sentido para quem vai ser avaliado.
      const caixa = $('[data-so-doador]', f);
      if (caixa) {
        f.addEventListener('change', (ev) => {
          if (ev.target.name === 'papel') caixa.hidden = ev.target.value === 'farejador';
        });
      }
      $('[data-trocar]', f).addEventListener('click', () => {
        fechar(); abrirConta(entrando ? 'criar' : 'entrar');
      });
      $('[data-esqueci]', f)?.addEventListener('click', () => {
        const email = $('[name=email]', f).value;
        fechar(); abrirEsqueci(email);
      });
    },
    aoConfirmar: async (form) => {
      const email = valor(form, 'email'), senha = valor(form, 'senha');
      if (!email || !senha) throw new Error('Preencha e-mail e senha.');
      if (entrando) {
        await dados.entrar(email, senha);
      } else {
        if (!valor(form, 'nome')) throw new Error('Diga o seu nome.');
        const papel = form.elements.papel?.value || 'farejador';
        const sobre = valor(form, 'sobre');
        if (papel !== 'farejador' && !sobre) {
          throw new Error('Conte um pouco sobre o seu trabalho — é o que o administrador lê para decidir.');
        }
        const s = await dados.criarConta({
          nome: valor(form, 'nome'), whatsapp: valor(form, 'whatsapp'), email, senha, papel, sobre });
        if (!s) throw new Error('Conta criada. Confirme o e-mail e depois entre.');
      }
      aoMudar();
    },
  });
}

/* Pedir o link por e-mail. A mensagem de sucesso NÃO confirma se o e-mail
   existe — dizer "não achamos essa conta" entrega a estranhos quem tem cadastro. */
export function abrirEsqueci(email = '') {
  abrir({
    titulo: 'Recuperar senha',
    acao: 'Enviar link',
    corpo: `
      <p class="folha__ajuda">Mandamos um link para o seu e-mail. Ao abrir,
        você define uma senha nova.</p>
      ${campo('email', 'E-mail da conta', 'type="email" required autocomplete="email"')}
      <button class="elo" type="button" data-voltar-entrar>Voltar para entrar</button>`,
    aoAbrir: (f) => {
      $('[name=email]', f).value = email;
      $('[data-voltar-entrar]', f).addEventListener('click', () => { fechar(); abrirConta('entrar'); });
    },
    aoConfirmar: async (form) => {
      const e = valor(form, 'email');
      if (!e) throw new Error('Escreva o e-mail da conta.');
      await dados.pedirNovaSenha(e);
      abrirRecado('Verifique o seu e-mail',
        `Se existir uma conta em ${e}, o link de recuperação chegou lá. ` +
        'Ele vale por uma hora. Olhe também o lixo eletrônico.');
    },
  });
}

/* Chamada quando a pessoa volta pelo link. Nesse momento ela já está com uma
   sessão temporária, então basta gravar a senha nova. */
export function abrirNovaSenha() {
  abrir({
    titulo: 'Nova senha',
    acao: 'Salvar',
    corpo: `
      <p class="folha__ajuda">Escolha uma senha nova para a sua conta.</p>
      ${campo('senha', 'Nova senha', 'type="password" required autocomplete="new-password" minlength="6"')}
      ${campo('senha2', 'Repita a senha', 'type="password" required autocomplete="new-password"')}`,
    aoConfirmar: async (form) => {
      const a = valor(form, 'senha'), b = valor(form, 'senha2');
      if (a !== b) throw new Error('As duas senhas não são iguais.');
      await dados.trocarSenha(a);
      aoMudar();
      abrirRecado('Senha trocada', 'Pronto. Você já está usando a senha nova.');
    },
  });
}

/** Trocar a senha estando logado. Abre a partir do Editar perfil. */
export function abrirTrocarSenha() {
  abrir({
    titulo: 'Trocar senha',
    acao: 'Salvar',
    corpo: `
      ${campo('senha', 'Nova senha', 'type="password" required autocomplete="new-password" minlength="6"')}
      ${campo('senha2', 'Repita a senha', 'type="password" required autocomplete="new-password"')}`,
    aoConfirmar: async (form) => {
      const a = valor(form, 'senha'), b = valor(form, 'senha2');
      if (a !== b) throw new Error('As duas senhas não são iguais.');
      await dados.trocarSenha(a);
      abrirRecado('Senha trocada', 'Pronto.');
    },
  });
}

/** Folha só de aviso, sem formulário. */
export function abrirRecado(titulo, texto) {
  abrir({
    titulo,
    corpo: `<p class="folha__ajuda folha__ajuda--paragrafos">${esc(texto)}</p>
            <button class="botao-fraco" type="button" data-fechar>Entendi</button>`,
    aoConfirmar: async () => {},
  });
}

/* Quem pode publicar adoção, para quem não pode.
   Uma lista de nomes reais resolve o problema de hoje — a ninhada que está na
   caixa agora — enquanto o cadastro, que leva dias, resolve o de sempre. */
async function ongsHTML() {
  const lista = await dados.ongsAtivas().catch(() => []);
  if (!lista.length) return '';
  return `
    <p class="campo__rotulo" style="margin-top:18px">Quem já publica adoção aqui</p>
    <div class="lista-opcoes">
      ${lista.map((o) => `
        <button class="opcao" type="button" data-perfil="${esc(o.id)}">
          ${esc(o.nome)}${o.cidade ? ` · ${esc(o.cidade)}` : ''}
        </button>`).join('')}
    </div>
    <p class="folha__ajuda">Abra o perfil e fale com eles — vão saber o caminho.</p>`;
}

/* A folha fica POR CIMA do perfil. Sem fechar antes, o toque numa ONG abre o
   perfil atrás dela e parece que o botão não fez nada. */
const fecharAoIrNoPerfil = (f) => {
  f.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-perfil]')) fechar();
  });
};

/* O pedido de quem já tem conta. Mesma pergunta do cadastro, feita depois. */
export async function abrirPedirParaDoar(papelAtual) {
  const esperando = papelAtual?.papel && papelAtual.papel !== 'farejador' && !papelAtual.aprovado;
  const ongs = await ongsHTML();

  if (esperando) {
    return abrir({
      titulo: 'Pedido em análise',
      corpo: `
        <p class="folha__ajuda">
          Seu pedido para publicar adoção está com o administrador. Enquanto isso
          você usa o Faro normalmente — e pode publicar como
          <em>“Encontrei e está comigo”</em>.
        </p>
        ${ongs}
        <button class="botao-fraco" type="button" data-fechar>Entendi</button>`,
      aoAbrir: fecharAoIrNoPerfil,
      aoConfirmar: async () => {},
    });
  }

  abrir({
    titulo: 'Cadastro para doar',
    acao: 'Enviar pedido',
    corpo: `
      <p class="folha__ajuda">
        A adoção fica com quem faz acompanhamento e busca lar responsável. Se é
        o seu caso, conte aqui — um administrador lê e libera.
      </p>
      <div class="campo">
        <span class="campo__rotulo">Você é</span>
        <div class="papeis" role="radiogroup" aria-label="Tipo de cadastro">
          ${PAPEIS.filter(([v]) => v !== 'farejador').map(([v, t, d], i) => `
            <label class="papel">
              <input type="radio" name="papel" value="${v}" ${i === 0 ? 'checked' : ''}>
              <span class="papel__corpo"><strong>${esc(t)}</strong><em>${esc(d)}</em></span>
            </label>`).join('')}
        </div>
      </div>
      ${area('sobre', 'Conte sobre o seu trabalho',
             'Há quanto tempo, quantos resgates, onde ficam os animais, redes sociais…')}
      ${ongs}`,
    aoAbrir: fecharAoIrNoPerfil,
    aoConfirmar: async (form) => {
      const sobre = valor(form, 'sobre');
      if (!sobre) throw new Error('Conte um pouco sobre o seu trabalho — é o que o administrador lê para decidir.');
      await dados.pedirParaDoar(form.elements.papel.value, sobre);
      fechar();
      abrirRecado('Pedido enviado',
        'Um administrador vai olhar. Até lá, você continua usando o Faro normalmente.');
    },
  });
}

/* Recados do Faro. É o único lugar do app que aceita link externo — por isso o
   campo é separado do texto, e não "cole o endereço no meio do recado":
   endereço no meio de texto teria de virar link por varredura, e varredura de
   link é exatamente o que o resto do app não faz de propósito. */
export function abrirNovoRecado({ aoSalvar } = {}) {
  abrir({
    titulo: 'Novo recado',
    acao: 'Publicar',
    corpo: `
      <p class="folha__ajuda">
        Aparece <strong>no meio do feed</strong>, com a mesma cara de um post e
        marcado como recado — do jeito que o Instagram mostra anúncio. Cada
        pessoa pode dispensar o seu.
        <strong>Recado não manda aviso no celular</strong> — é informação, não
        urgência.
      </p>
      ${fotosHTML(1)}
      ${campo('titulo', 'Título', 'required maxlength="90"')}
      ${area('texto', 'O recado', 'Direto ao ponto. Quem está procurando um pet não lê parágrafo longo.')}
      ${campo('link', 'Link (opcional)', 'type="url" inputmode="url" placeholder="https://"',
              'Só https. O endereço de destino aparece ao lado do botão, para ninguém clicar às cegas.')}
      ${campo('link_rotulo', 'Texto do botão', 'maxlength="40"', 'Por exemplo: "Ler o guia completo".')}`,
    aoAbrir: (f) => ligarFotos(f),
    aoConfirmar: async (form) => {
      const titulo = valor(form, 'titulo'), texto = valor(form, 'texto');
      if (!titulo || !texto) throw new Error('Título e recado são obrigatórios.');
      const link = valor(form, 'link');
      if (link && !/^https:\/\//.test(link)) throw new Error('O endereço precisa começar com https://');

      // Mesmo caminho de upload dos casos: mesmo bucket, mesma política.
      const f = $('#folha-form');
      const arq = (f._fotos || [])[0];
      const foto = arq instanceof File ? await dados.enviarFoto(arq) : arq?.path || null;

      await dados.criarRecado({ titulo, texto, link, linkRotulo: valor(form, 'link_rotulo'), foto });
      aoSalvar?.();
    },
  });
}

/* De onde vêm os números da área de busca. Um elo discreto abaixo do mapa.

   Existe por uma razão só: a diferença entre uma ferramenta e um truque é
   poder conferir. Quem quiser ler o estudo, lê. */
export function abrirFontes(fontes) {
  abrir({
    titulo: 'De onde vêm estes números',
    corpo: `
      <p class="folha__ajuda folha__ajuda--paragrafos">A área de busca não é chute nem cálculo de velocidade. Cada faixa termina num percentil medido em estudo publicado — o que varia com o tempo é só o quanto dele já se aplicou.

O que NÃO fazemos: prometer porcentagem de chance de o pet estar dentro de um círculo. Nenhum estudo sustenta isso, e quem acredita para de procurar do lado de fora.</p>

      ${Object.values(fontes).map((f) => `
        <div class="fonte">
          <p class="fonte__nome">${esc(f.curto)} <span>${esc(f.amostra)}</span></p>
          <p class="fonte__cita">${esc(f.longo)}</p>
          <a class="elo" href="${esc(f.elo)}" target="_blank" rel="noopener noreferrer">
            Ler o estudo
          </a>
        </div>`).join('')}

      <p class="folha__ajuda folha__ajuda--paragrafos"><strong>O que ainda não se sabe.</strong> Não existe estudo mostrando que cão medroso vá mais longe que cão sociável — é suspeita, não resultado. Por isso o temperamento do cão muda o conselho aqui, e não o tamanho da área.

E estes números são de Ohio e da Austrália. Santa Cruz do Sul tem outro traçado e outro jeito de morar: cada caso que alguém encerra aqui, contando onde o pet estava, aproxima o cálculo da nossa realidade.</p>
      <button class="botao-fraco" type="button" data-fechar>Entendi</button>`,
    aoConfirmar: async () => {},
  });
}

/* =============================================================================
   O ENCERRAMENTO — e a única chance de colher o dado

   Quando alguém encerra um caso, some para sempre a informação de ONDE o pet
   estava e COMO foi achado. São as duas variáveis do modelo de área de busca,
   e só existem neste instante.

   TUDO É OPCIONAL, e a folha não insiste. Nem todo encerramento é final feliz
   — pode ser um pet que morreu ou um tutor que desistiu, e uma pergunta
   obrigatória sobre "onde ele estava" nessa hora seria cruel. Além disso,
   resposta dada por obrigação envenena a base.

   As opções espelham as categorias do estudo de Huang (2018) de propósito:
   dado comparável é dado que se pode confrontar com a literatura.
   ============================================================================= */

const LUGARES = [
  ['quintal_alheio', 'No quintal de alguém'],
  ['porta_de_casa',  'Esperando na porta de casa'],
  ['mato',           'Escondido no mato'],
  ['varanda',        'Embaixo de varanda ou deck'],
  ['casa_alheia',    'Dentro da casa de outra pessoa'],
  ['propria_casa',   'Dentro da própria casa'],
  ['rua',            'Na rua'],
  ['recolhido',      'Com alguém que tinha recolhido'],
  ['outro',          'Outro'],
];

const COMOS = [
  ['voltou_sozinho',   'Voltou sozinho'],
  ['aviso_no_faro',    'Alguém avisou aqui no Faro'],
  ['busca_a_pe',       'Procurando a pé'],
  ['cartaz',           'Pelo cartaz'],
  ['vizinho',          'Um vizinho avisou'],
  ['clinica_ou_canil', 'Clínica ou canil'],
  ['redes',            'Redes sociais'],
  ['armadilha',        'Armadilha humanitária'],
  ['outro',            'Outro'],
];

export function abrirEncerrar(post, centro, { aoEncerrar } = {}) {
  abrir({
    titulo: 'Encerrar o caso',
    acao: 'Encerrar',
    corpo: `
      <p class="folha__ajuda"><strong>Que bom.</strong> Conte só o que quiser — cada caso que termina bem ajuda o Faro a calcular melhor a área de busca para o próximo tutor da cidade. Dá para encerrar sem responder nada.</p>

      ${escolha('lugar', 'Que tipo de lugar era', [['', 'Prefiro não dizer'], ...LUGARES])}
      ${escolha('como', 'Como vocês se encontraram', [['', 'Prefiro não dizer'], ...COMOS])}

      ${mapaHTML}`,

    aoAbrir: (f) => {
      // montarMapa DEVOLVE o ponto que acompanha o centro do mapa; sem guardar
      // o retorno, `f._ponto` fica vazio e a coordenada nunca chega ao banco.
      f._ponto = montarMapa(f, centro);

      /* `mapaHTML` é compartilhado com publicar e avistar, onde o rótulo certo
         é "Onde foi". Aqui a pergunta é outra, e a caixa de "não sei" precisa
         vir ANTES do mapa — senão a pessoa mexe no mapa para só depois
         descobrir que podia pular. */
      const campo = $('.mapa-escolha', f).closest('.campo');
      $('.campo__rotulo', campo).textContent = 'Onde ele estava';
      $('.mapa-escolha', f).insertAdjacentHTML('beforebegin', `
        <label class="pular-mapa">
          <input type="checkbox" name="sem_lugar">
          <span>Não sei dizer onde era</span>
        </label>`);
      // Marcar "não sei" apaga o mapa: perguntar e ignorar seria pior que não
      // perguntar, e um ponto chutado estraga a base de calibragem.
      const caixa = $('[name=sem_lugar]', f);
      const mapa = $('.mapa-escolha', f);
      caixa.addEventListener('change', () => { mapa.hidden = caixa.checked; });
    },

    aoConfirmar: async (form) => {
      const f = $('#folha-form');
      const semLugar = form.elements.sem_lugar?.checked;
      await dados.resolverPost(post.id);
      // O desfecho NUNCA derruba o encerramento: o caso fechar é o que importa
      // para a pessoa; a nossa base é o que importa para nós.
      try {
        await dados.registrarDesfecho(post.id, {
          lat: semLugar ? null : f._ponto?.lat,
          lng: semLugar ? null : f._ponto?.lng,
          lugar: valor(form, 'lugar'),
          como: valor(form, 'como'),
        });
      } catch { /* o caso está encerrado; o dado é que se perde */ }
      dados.dispararAvisos(post.id);      // quem ajudou merece saber que acabou
      aoEncerrar?.();
    },
  });
}

/* A pergunta do gato, feita DEPOIS de publicar: quem acabou de perder o bicho
   não devia ter mais um campo pela frente. É a variável com o efeito mais forte
   e melhor medido de toda a literatura — 137 m contra 1.609 m. */
export function abrirAcessoRua(post, { aoResponder } = {}) {
  abrir({
    titulo: 'Mais uma coisa',
    acao: 'Salvar',
    corpo: `
      <p class="folha__ajuda">
        Isso muda bastante a área de busca no mapa. Um estudo com 1.210 gatos
        mostrou que quem nunca sai de casa é achado a poucos metros, escondido
        — e quem já sai pode ir bem mais longe.
      </p>
      <div class="papeis" role="radiogroup" aria-label="Costuma sair de casa">
        <label class="papel">
          <input type="radio" name="acesso" value="nao_sai" checked>
          <span class="papel__corpo"><strong>Não sai de casa</strong>
            <em>Vive dentro, ou só no pátio fechado.</em></span>
        </label>
        <label class="papel">
          <input type="radio" name="acesso" value="sai">
          <span class="papel__corpo"><strong>Costuma sair</strong>
            <em>Vai à rua sozinho e volta.</em></span>
        </label>
      </div>`,
    aoConfirmar: async (form) => {
      await dados.definirAcessoRua(post.id, form.elements.acesso.value);
      aoResponder?.();
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
async function abrirCaso(centro, post) {
  if (!dados.estaLogado()) return abrirConta('entrar');
  const editando = !!post;

  // Num avistamento ligado a um caso, o tipo não se escolhe: ele já é o que é.
  const ehAvistamentoLigado = editando && post.post_origem_id;

  /* A trava de verdade é o RLS (schema-14). Aqui é só para a opção não ficar
     clicável e depois estourar um erro — barrar depois do esforço é pior que
     barrar antes. */
  const papel = await dados.meuPapel().catch(() => null);
  const podeDoar = !!papel?.pode_doar;

  abrir({
    titulo: editando ? 'Editar' : 'Publicar',
    acao: editando ? 'Salvar' : 'Publicar',
    corpo: `
      ${ehAvistamentoLigado ? '' : `
      <div class="tipos" role="radiogroup" aria-label="O que aconteceu">
        ${TIPOS.map(([v, t]) => `
          <label class="tipo">
            <input type="radio" name="tipo" value="${v}"
              ${v === 'adocao' && !podeDoar ? 'disabled' : ''}
              ${(editando ? post.tipo === v : v === 'perdido') ? 'checked' : ''}>
            <span>${esc(t)}</span>
          </label>`).join('')}
      </div>
      ${podeDoar ? '' : `
      <p class="folha__ajuda">
        <strong>A adoção é publicada por ONGs e protetores cadastrados.</strong>
        É o que evita que um anúncio vire abandono com etiqueta.<br>
        Se o pet está com você e você não sabe de quem é, use
        <em>“Encontrei e está comigo”</em> — o tutor pode estar procurando agora.
      </p>
      <button class="botao-fraco" type="button" data-quero-doar>
        ${papel?.papel && papel.papel !== 'farejador' && !papel.aprovado
          ? 'Seu pedido está em análise — ver'
          : 'Quero me cadastrar para doar'}
      </button>`}`}
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
      $('[data-quero-doar]', f)?.addEventListener('click', () => {
        fechar(); abrirPedirParaDoar(papel);
      });

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
        /* O id volta da própria criação: é com ele que o Worker descobre quem
           precisa saber. Editar NÃO avisa ninguém — corrigir a cor do pet não
           é notícia para o bairro. */
        const id = await dados.criarPost({ p_tipo: form.elements.tipo.value, ...comum });
        dados.dispararAvisos(id);

        /* A pergunta do gato vem AGORA, não no formulário: quem acabou de
           perder o bicho não devia ter mais um campo pela frente. O caso já
           está no ar; isto só refina o mapa. */
        if (form.elements.tipo.value === 'perdido' && valor(form, 'especie') === 'gato') {
          aoMudar();
          abrirAcessoRua({ id }, { aoResponder: () => { fechar(); aoMudar(); } });
          return;
        }
      }
      aoMudar();
    },
  });
}

/* Editar perfil: foto, nome e WhatsApp.
   O WhatsApp entra junto porque é o dado que mais precisa de conserto — é por
   ele que alguém devolve um pet, e um número errado torna o caso inútil. */
export function abrirEditarPerfil(perfil, { aoSalvar } = {}) {
  abrir({
    titulo: 'Editar perfil',
    acao: 'Salvar',
    corpo: `
      <div class="foto-perfil">
        <input type="file" name="avatar" accept="image/*" hidden>
        <span class="foto-perfil__previa" data-previa
              ${perfil.avatar ? `style="background-image:url('${esc(perfil.avatar)}')"` : ''}>
          ${perfil.avatar ? '' : esc(iniciaisDe(perfil.nome))}
        </span>
        <div class="foto-perfil__acoes">
          <button class="botao-fraco" type="button" data-trocar-foto>
            ${perfil.avatar ? 'Trocar foto' : 'Escolher foto'}
          </button>
          <button class="botao-fraco foto-perfil__tirar" type="button" data-tirar-foto
                  ${perfil.avatar ? '' : 'hidden'}>Remover</button>
        </div>
      </div>

      ${campo('nome', 'Seu nome', 'required maxlength="60"')}
      ${campo('whatsapp', 'WhatsApp', 'inputmode="tel" autocomplete="tel"',
              'É por aqui que quem achar o seu pet vai te chamar.')}
      <button class="botao-fraco" type="button" data-trocar-senha>Trocar senha</button>`,

    aoAbrir: (f) => {
      $('[data-trocar-senha]', f).addEventListener('click', () => { fechar(); abrirTrocarSenha(); });
      f._avatar = perfil.avatar_path ? { path: perfil.avatar_path } : null;
      $('[name=nome]', f).value = perfil.nome || '';
      $('[name=whatsapp]', f).value = perfil.whatsapp || '';

      const previa = $('[data-previa]', f);
      const tirar = $('[data-tirar-foto]', f);
      const input = $('[name=avatar]', f);

      $('[data-trocar-foto]', f).addEventListener('click', () => input.click());
      input.addEventListener('change', () => {
        const arq = input.files?.[0];
        if (!arq) return;
        f._avatar = arq;
        previa.style.backgroundImage = `url('${URL.createObjectURL(arq)}')`;
        previa.textContent = '';
        tirar.hidden = false;
        $('[data-trocar-foto]', f).textContent = 'Trocar foto';
      });
      tirar.addEventListener('click', () => {
        f._avatar = null;
        previa.style.backgroundImage = '';
        previa.textContent = iniciaisDe($('[name=nome]', f).value);
        tirar.hidden = true;
        input.value = '';
        $('[data-trocar-foto]', f).textContent = 'Escolher foto';
      });
    },

    aoConfirmar: async (form) => {
      const f = $('#folha-form');
      const nome = valor(form, 'nome');
      if (!nome) throw new Error('Diga o seu nome.');

      let avatarPath = null;
      if (f._avatar instanceof File) avatarPath = await dados.enviarFoto(f._avatar);
      else if (f._avatar) avatarPath = f._avatar.path;

      await dados.atualizarPerfil({ nome, whatsapp: valor(form, 'whatsapp'), avatarPath });

      // a foto antiga sai do bucket quando foi trocada ou removida
      if (perfil.avatar_path && perfil.avatar_path !== avatarPath) {
        await dados.apagarFotosDoBucket([perfil.avatar_path]);
      }
      aoMudar(); aoSalvar?.();
    },
  });
}

const iniciaisDe = (nome) => (nome || '?').trim().split(/\s+/).slice(0, 2)
  .map((n) => n[0]).join('').toUpperCase();

/* Menu do dono. Fica no detalhe do caso, como o "..." do Instagram. */
export async function abrirAcoesDoDono(post, { aoApagar } = {}) {
  const encerrado = post.status === 'resolvido';
  const ligados = post.post_origem_id ? 0 : await dados.avistamentosLigados(post.id);
  // Mexer no caso de outra pessoa tem de ficar dito. Um menu idêntico ao do
  // dono, sem aviso, é o jeito mais fácil de apagar algo achando que era seu.
  const deOutro = post.autor_id && post.autor_id !== dados.meuId();

  abrir({
    titulo: post.titulo,
    corpo: `
      ${deOutro ? `<p class="folha__ajuda folha__ajuda--alerta">
        Você está moderando o caso de <strong>${esc(post.autor_nome || 'outra pessoa')}</strong>.
        O que você fizer aqui vale para essa pessoa.
      </p>` : ''}
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

        if (acao === 'resolver') {
          // O encerramento é a ÚNICA chance de colher onde o pet estava.
          fechar();
          abrirEncerrar(post, dados.ORIGEM, { aoEncerrar: () => { fechar(); aoMudar(); } });
          return;
        }
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
      const idAvistamento = await dados.criarAvistamento({
        p_origem: post.id,
        p_lat: f._ponto.lat,
        p_lng: f._ponto.lng,
        p_endereco: valor(form, 'endereco'),
        p_texto: valor(form, 'texto'),
        p_ocorrido_em: quando ? new Date(quando).toISOString() : null,
        p_fotos: fotos,
      });
      // O tutor está esperando por isto. É o aviso mais importante do app.
      dados.dispararAvisos(idAvistamento);
      aoMudar();
    },
  });
}
