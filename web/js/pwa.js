/* =============================================================================
   Faro — instalar na tela de início

   O Faro é usado na rua, com uma mão só, por quem acabou de perder um cão.
   Abrir o navegador, lembrar o endereço e digitar é atrito demais para essa
   hora. Instalado, vira um ícone ao lado do WhatsApp.

   E há um motivo técnico que não dá para contornar: **no iPhone, aviso de
   notificação só existe em app instalado.** Sem isto, metade dos aparelhos da
   cidade nunca receberia "avistaram seu cão a 800 m".

   O convite aparece uma vez, é dispensável, e nunca volta se for dispensado.
   ============================================================================= */

import { VAPID_PUBLICA } from './config.js?v=59';
import { salvarPush, apagarPush, meuPush, ORIGEM, estaLogado } from './dados.js?v=59';

const DISPENSADO = 'faro:instalar-dispensado';
const VISITAS    = 'faro:visitas';

let pedido = null;          // o beforeinstallprompt guardado (Android/desktop)

const $ = (s) => document.querySelector(s);

const dispensado = () => {
  try { return localStorage.getItem(DISPENSADO) === 'sim'; } catch { return false; }
};
const dispensar = () => {
  try { localStorage.setItem(DISPENSADO, 'sim'); } catch { /* ok */ }
};

/* Convidar alguém a instalar um app que ele acabou de abrir pela primeira vez é
   pedir compromisso antes de mostrar serviço. O convite do iPhone — o único que
   depende só de nós — espera a segunda visita. */
function contarVisita() {
  try {
    const n = Number(localStorage.getItem(VISITAS) || 0) + 1;
    localStorage.setItem(VISITAS, String(n));
    return n;
  } catch { return 1; }
}

/** Já está instalado? Então não há nada a convidar. */
export const jaInstalado = () =>
  matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

const ehIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  // iPad moderno se diz Macintosh; o toque é o que o denuncia.
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// --- o convite ----------------------------------------------------------------

function mostrar(comoInstalar) {
  const caixa = $('#convite-instalar');
  if (!caixa || dispensado() || jaInstalado()) return;

  // No iPhone não existe botão: o caminho é pelo menu Compartilhar do Safari.
  // Dizer o passo a passo é mais honesto que um botão que não faz nada.
  $('#convite-instalar [data-instalar-texto]').innerHTML = comoInstalar === 'ios'
    ? '<strong>Deixe o Faro na tela de início</strong>'
      + 'Toque em Compartilhar, embaixo, e depois em “Adicionar à Tela de Início”.'
    : '<strong>Deixe o Faro na tela de início</strong>'
      + 'Abre como aplicativo, sem passar pelo navegador.';

  $('#convite-instalar [data-acao="instalar"]').hidden = comoInstalar === 'ios';
  caixa.hidden = false;
}

/** Chamado pelo botão do convite. */
export async function instalar(botao) {
  if (!pedido) return;
  botao.disabled = true;
  pedido.prompt();
  await pedido.userChoice.catch(() => {});
  pedido = null;                       // o navegador só deixa usar uma vez
  $('#convite-instalar').hidden = true;
  dispensar();                         // aceitando ou não, não insistir
}

export function dispensarInstalar() {
  dispensar();
  $('#convite-instalar').hidden = true;
}

// --- o service worker ---------------------------------------------------------

/* Registrar cedo é o certo: o primeiro acesso não ganha nada com isso, mas todos
   os outros abrem do cache. Falha aqui não pode derrubar o app — sem service
   worker o Faro funciona igual, só perde o modo offline e os avisos. */
export function comecar({ aoNavegar } = {}) {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('/sw.js').catch(() => { /* segue sem */ });

  navigator.serviceWorker.addEventListener('message', (ev) => {
    const { tipo, url } = ev.data || {};
    // Veio de um toque no aviso, com o app já aberto numa aba antiga.
    if (tipo === 'ir' && url && aoNavegar) aoNavegar(url);
  });

  // Android e desktop: o navegador avisa quando considera o app instalável.
  addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault();               // sem isto o Chrome mostra a barra dele
    pedido = ev;
    mostrar('botao');
  });

  addEventListener('appinstalled', () => {
    dispensar();
    const caixa = $('#convite-instalar');
    if (caixa) caixa.hidden = true;
  });

  // iPhone nunca dispara beforeinstallprompt: o convite é por conta do app.
  const visita = contarVisita();
  if (ehIOS() && !jaInstalado() && visita >= 2) mostrar('ios');
}

/* =============================================================================
   AVISOS NO CELULAR (web push)

   A permissão de notificação é das que só se pede uma vez: negada, o navegador
   não pergunta de novo e a pessoa teria de ir nas configurações do sistema.
   Por isso NUNCA se pede na abertura — só quando alguém toca o interruptor no
   perfil, ou logo depois de publicar um caso, que é quando o "quero saber"
   está claro.
   ============================================================================= */

const bytesDaChave = (b64) => {
  const s = b64.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s.padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
};

const paraB64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/* O raio do alerta de bairro, um lugar só. Estava escrito à mão em quatro:
   aqui, duas vezes no perfil.js e mais uma em prosa ("3 km") no texto da tela
   — que mentia para quem tivesse outro valor gravado no banco. */
export const RAIO_AVISO_PADRAO = 3000;

export const avisosSuportados = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Como está este aparelho, sem pedir nada a ninguém. */
export async function estadoDosAvisos() {
  if (!avisosSuportados()) {
    return {
      suportado: false,
      // O iPhone só entrega aviso em app instalado. Dizer isso é mais útil que
      // um interruptor cinza sem explicação.
      motivo: ehIOS() && !jaInstalado()
        ? 'No iPhone, os avisos só funcionam com o Faro na tela de início.'
        : 'Este navegador não recebe avisos.',
    };
  }

  const registro = await navigator.serviceWorker.ready;
  const inscricao = await registro.pushManager.getSubscription();
  const permissao = Notification.permission;

  if (!inscricao || permissao !== 'granted') {
    return { suportado: true, ligado: false, bloqueado: permissao === 'denied' };
  }

  // A inscrição pode existir no navegador e não no banco (outra conta, base
  // limpa). Quem manda é o banco: é de lá que sai o envio.
  const noBanco = estaLogado() ? await meuPush(inscricao.endpoint).catch(() => null) : null;
  return {
    suportado: true,
    ligado: !!noBanco,
    bloqueado: false,
    querBairro: noBanco ? noBanco.quer_bairro : true,
    raioM: noBanco ? noBanco.raio_m : RAIO_AVISO_PADRAO,
  };
}

/**
 * Liga os avisos neste aparelho. Pede a permissão se ainda não houver.
 * @returns {{ok: boolean, motivo?: string}}
 */
export async function ligarAvisos({ raioM = RAIO_AVISO_PADRAO, querBairro = true } = {}) {
  if (!avisosSuportados()) return { ok: false, motivo: 'sem suporte' };
  if (!estaLogado())      return { ok: false, motivo: 'entre na sua conta' };

  const permissao = await Notification.requestPermission();
  if (permissao !== 'granted') {
    return { ok: false, motivo: permissao === 'denied' ? 'bloqueado' : 'adiado' };
  }

  const registro = await navigator.serviceWorker.ready;
  const inscricao = await registro.pushManager.getSubscription()
    || await registro.pushManager.subscribe({
         userVisibleOnly: true,             // exigido: todo push vira aviso na tela
         applicationServerKey: bytesDaChave(VAPID_PUBLICA),
       });

  const chaves = inscricao.toJSON().keys || {};
  await salvarPush({
    endpoint: inscricao.endpoint,
    p256dh: chaves.p256dh || paraB64url(inscricao.getKey('p256dh')),
    auth:   chaves.auth   || paraB64url(inscricao.getKey('auth')),
    // O alerta de bairro mede a partir de onde a pessoa realmente está. Sem
    // GPS, sobra o Centro — e avisar "a 2 km do Centro" para quem mora longe
    // seria barulho, então nesse caso o bairro fica desligado.
    lat: ORIGEM.ehReal ? ORIGEM.lat : null,
    lng: ORIGEM.ehReal ? ORIGEM.lng : null,
    raioM,
    querBairro: querBairro && ORIGEM.ehReal,
  });

  return { ok: true };
}

/* Desligar apaga a inscrição dos DOIS lados. Deixar no banco faria o envio
   continuar batendo num endereço que ninguém lê — e a pessoa que desligou
   merece que a gente pare de verdade. */
export async function desligarAvisos() {
  const registro = await navigator.serviceWorker.ready;
  const inscricao = await registro.pushManager.getSubscription();
  if (!inscricao) return;

  await apagarPush(inscricao.endpoint).catch(() => {});
  await inscricao.unsubscribe().catch(() => {});
}

/** Só a preferência do bairro, sem mexer no resto. */
export async function mudarBairro(querBairro, raioM = RAIO_AVISO_PADRAO) {
  const registro = await navigator.serviceWorker.ready;
  const inscricao = await registro.pushManager.getSubscription();
  if (!inscricao) return;

  const chaves = inscricao.toJSON().keys || {};
  await salvarPush({
    endpoint: inscricao.endpoint,
    // Mesmo caminho do ligar: nem todo navegador preenche toJSON().keys, e
    // mandar nulo aqui quebraria a coluna, não a preferência.
    p256dh: chaves.p256dh || paraB64url(inscricao.getKey('p256dh')),
    auth:   chaves.auth   || paraB64url(inscricao.getKey('auth')),
    lat: ORIGEM.ehReal ? ORIGEM.lat : null,
    lng: ORIGEM.ehReal ? ORIGEM.lng : null,
    raioM, querBairro,
  });
}
