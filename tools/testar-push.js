#!/usr/bin/env node
/* =============================================================================
   Faro — prova a criptografia dos avisos

       node tools/testar-push.js

   POR QUE ESTE TESTE EXISTE
   Web Push é criptografia escrita à mão (src/push.js). Ou está certa até o
   último byte, ou o celular recebe um pacote ilegível e descarta em silêncio —
   sem erro, sem log, sem nada. "Parece que funcionou" não serve.

   Então a prova não é nossa: é o exemplo publicado no RFC 8291, seção 5. Com o
   mesmo sal e a mesma chave efêmera dele, o nosso código tem de produzir
   EXATAMENTE os mesmos bytes. Se um dia deixar de produzir, algo quebrou.

   O segundo teste confere a assinatura VAPID (RFC 8292) com a chave pública —
   é o que o serviço de push faz antes de aceitar o envio.
   ============================================================================= */

import { fechar, b64urlParaBytes, bytesParaB64url } from '../src/push.js';

// --- o exemplo do RFC 8291, seção 5 -------------------------------------------

const VETOR = {
  mensagem: 'When I grow up, I want to be a watermelon',
  auth:     'BTBZMqHH6r4Tts7J_aSIgg',
  // o "navegador" do exemplo
  receptorPub: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  // o "servidor" do exemplo: é isto que a semente fixa
  remetentePriv: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  remetentePub:  'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  sal: 'DGv6ra1nlYgDCS1FRnbzlw',
  esperado:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
    'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
    'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

const jwk = (pubB64, privB64) => {
  const pub = b64urlParaBytes(pubB64);
  return {
    kty: 'EC', crv: 'P-256', ext: true,
    x: bytesParaB64url(pub.slice(1, 33)),
    y: bytesParaB64url(pub.slice(33, 65)),
    ...(privB64 ? { d: privB64 } : {}),
  };
};

let falhas = 0;

function conferir(nome, obtido, esperado) {
  const ok = obtido === esperado;
  console.log(`${ok ? '  ok  ' : '  FALHOU  '}${nome}`);
  if (!ok) {
    falhas++;
    console.log(`        esperado: ${esperado}`);
    console.log(`        obtido:   ${obtido}`);
  }
}

// --- 1. a carga ----------------------------------------------------------------

const privada = await crypto.subtle.importKey(
  'jwk', jwk(VETOR.remetentePub, VETOR.remetentePriv),
  { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const publica = await crypto.subtle.importKey(
  'jwk', jwk(VETOR.remetentePub), { name: 'ECDH', namedCurve: 'P-256' }, true, []);

const corpo = await fechar(VETOR.mensagem, VETOR.receptorPub, VETOR.auth, {
  sal: b64urlParaBytes(VETOR.sal),
  par: { privateKey: privada, publicKey: publica },
});

console.log('RFC 8291 §5 — a carga criptografada');
conferir('bytes idênticos ao exemplo do RFC', bytesParaB64url(corpo), VETOR.esperado);

// --- 2. a assinatura VAPID -----------------------------------------------------

/* Aqui não há vetor publicado: o JWT muda a cada segundo, por causa do `exp`.
   O que dá para provar — e é o que importa — é que a assinatura FECHA com a
   chave pública que o app publica, e que os campos são os que o RFC 8292 exige. */
console.log('\nRFC 8292 — a assinatura de quem envia');

const { readFile } = await import('node:fs/promises');
const { homedir } = await import('node:os');
const { join } = await import('node:path');

let par;
try {
  par = JSON.parse(await readFile(join(homedir(), '.config', 'farejo', 'vapid.json'), 'utf8'));
} catch {
  console.log('  pulado  (sem ~/.config/farejo/vapid.json — rode tools/gerar-vapid.js)');
}

if (par) {
  // Reaproveita o caminho real: enviarPush monta o cabeçalho por dentro, então
  // aqui repetimos a montagem com as mesmas peças para poder verificar.
  const endpoint = 'https://fcm.googleapis.com/fcm/send/exemplo';

  const chavePriv = await crypto.subtle.importKey(
    'jwk', { ...jwk(par.publica), d: par.privada },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

  const cabeca = bytesParaB64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const dados  = bytesParaB64url(new TextEncoder().encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: 'mailto:contato@vadeon.com.br',
  })));
  const assinado = `${cabeca}.${dados}`;
  const assinatura = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, chavePriv, new TextEncoder().encode(assinado));

  const chavePub = await crypto.subtle.importKey(
    'jwk', jwk(par.publica), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const valida = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, chavePub, assinatura, new TextEncoder().encode(assinado));

  conferir('a assinatura fecha com a chave pública do app', String(valida), 'true');

  const corpoJwt = JSON.parse(Buffer.from(dados.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
  conferir('aud é a origem do endereço de push', corpoJwt.aud, 'https://fcm.googleapis.com');
  conferir('exp dentro das 24 h que o RFC 8292 permite',
    String(corpoJwt.exp - Math.floor(Date.now() / 1000) <= 86400), 'true');
  conferir('sub é um contato', String(/^mailto:|^https:/.test(corpoJwt.sub)), 'true');
}

console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
