/* =============================================================================
   Faro — Web Push, do zero, com a Web Crypto do Worker

   POR QUE NÃO UMA BIBLIOTECA
   As conhecidas (`web-push`) são de Node e dependem de `crypto` nativo, que o
   Worker não tem. O que sobra é padrão: RFC 8291 (criptografia da carga) e
   RFC 8292 (VAPID, a assinatura de quem envia). São umas cem linhas e nenhuma
   dependência para envelhecer.

   COMO FUNCIONA, EM UMA FRASE
   O navegador guarda uma chave pública (`p256dh`) e um segredo (`auth`) por
   inscrição. Nós combinamos a nossa chave efêmera com a dele (ECDH), derivamos
   uma chave de uma vez só (HKDF) e fechamos a mensagem com AES-GCM. O serviço
   de push (Google, Apple, Mozilla) carrega o pacote sem conseguir ler nada —
   ele é só o carteiro.
   ============================================================================= */

const texto = new TextEncoder();

export const b64urlParaBytes = (s) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};

export const bytesParaB64url = (b) =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const juntar = (...pedacos) => {
  const total = pedacos.reduce((n, p) => n + p.length, 0);
  const saida = new Uint8Array(total);
  let i = 0;
  for (const p of pedacos) { saida.set(p, i); i += p.length; }
  return saida;
};

/** HKDF: o mesmo que o RFC chama de extract + expand, num passo só. */
async function derivar(salt, ikm, info, bytes) {
  const chave = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info }, chave, bytes * 8));
}

// --- VAPID: a assinatura de quem envia ----------------------------------------

/* O par vem de tools/gerar-vapid.js. A pública é o ponto sem compressão
   (0x04 ‖ x ‖ y); a privada é só o escalar. A Web Crypto quer JWK, então as
   coordenadas são recortadas da pública — é a mesma chave, outra embalagem. */
function jwkDaChave(publicaB64, privadaB64) {
  const pub = b64urlParaBytes(publicaB64);
  return {
    kty: 'EC', crv: 'P-256', ext: true,
    x: bytesParaB64url(pub.slice(1, 33)),
    y: bytesParaB64url(pub.slice(33, 65)),
    d: privadaB64,
  };
}

/* O cabeçalho que prova que o pacote é nosso. Vale 12 h — o serviço de push
   recusa prazo longo demais, e assinar a cada envio é barato. */
async function autorizacao(endpoint, { publica, privada, contato }) {
  const aud = new URL(endpoint).origin;
  const cabeca = { typ: 'JWT', alg: 'ES256' };
  const corpo  = { aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: contato };

  const naoAssinado = `${bytesParaB64url(texto.encode(JSON.stringify(cabeca)))}`
                    + `.${bytesParaB64url(texto.encode(JSON.stringify(corpo)))}`;

  const chave = await crypto.subtle.importKey(
    'jwk', jwkDaChave(publica, privada), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

  const assinatura = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, chave, texto.encode(naoAssinado));

  return `vapid t=${naoAssinado}.${bytesParaB64url(assinatura)}, k=${publica}`;
}

// --- a carga ------------------------------------------------------------------

/* Fecha a mensagem para UMA inscrição. Cada envio tem chave efêmera e sal
   próprios: duas pessoas recebendo o mesmo texto recebem bytes diferentes.

   `semente` existe só para o teste: fixando o sal e a chave efêmera, a saída
   vira determinística e pode ser comparada byte a byte com o exemplo do
   RFC 8291 (ver tools/testar-push.js). Em produção nunca é passada. */
export async function fechar(mensagem, p256dhB64, authB64, semente = null) {
  const clientePub = b64urlParaBytes(p256dhB64);
  const segredo    = b64urlParaBytes(authB64);

  const efemero = semente?.par || await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const efemeroPub = new Uint8Array(await crypto.subtle.exportKey('raw', efemero.publicKey));

  const deles = await crypto.subtle.importKey(
    'raw', clientePub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const compartilhado = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: deles }, efemero.privateKey, 256));

  // A ordem aqui é do RFC e não é arbitrária: quem recebe monta a mesma coisa
  // do outro lado, e um byte fora de lugar vira "erro ao descriptografar".
  const infoChave = juntar(texto.encode('WebPush: info'), new Uint8Array([0]),
                           clientePub, efemeroPub);
  const ikm = await derivar(segredo, compartilhado, infoChave, 32);

  const sal   = semente?.sal || crypto.getRandomValues(new Uint8Array(16));
  const cek   = await derivar(sal, ikm, texto.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await derivar(sal, ikm, texto.encode('Content-Encoding: nonce\0'), 12);

  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // O 0x02 no fim diz "acabou": é o delimitador do último (e único) registro.
  const claro = juntar(texto.encode(mensagem), new Uint8Array([2]));
  const cifrado = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce }, aes, claro));

  const tamanho = new Uint8Array(4);
  new DataView(tamanho.buffer).setUint32(0, 4096);      // tamanho do registro

  return juntar(sal, tamanho, new Uint8Array([efemeroPub.length]), efemeroPub, cifrado);
}

// --- o envio ------------------------------------------------------------------

/**
 * Entrega uma mensagem a uma inscrição.
 * @returns {{ok: boolean, status: number, morto: boolean}}
 *   `morto` = o serviço disse que este endereço não existe mais (404/410).
 *   É a única resposta que autoriza apagar a inscrição; o resto pode ser
 *   passageiro e apagar seria perder quem só estava com o celular desligado.
 */
export async function enviarPush(inscricao, mensagem, vapid) {
  const corpo = await fechar(mensagem, inscricao.p256dh, inscricao.auth);

  const r = await fetch(inscricao.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': await autorizacao(inscricao.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',                 // 24 h: depois disso o aviso não serve mais
      'Urgency': 'high',
    },
    body: corpo,
  });

  return { ok: r.ok, status: r.status, morto: r.status === 404 || r.status === 410 };
}
