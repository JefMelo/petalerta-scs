#!/usr/bin/env node
/* =============================================================================
   Faro — gera o par de chaves VAPID dos avisos

       node tools/gerar-vapid.js

   O QUE É VAPID
   O navegador não aceita um aviso de qualquer um: o servidor tem de assinar
   cada envio com uma chave que prova ser o mesmo servidor de sempre. A pública
   vai no app (é dela que sai a inscrição do aparelho), a privada fica só no
   Worker.

   GERA UMA VEZ SÓ. Trocar a chave invalida TODAS as inscrições existentes —
   cada aparelho teria de se reinscrever, e até lá ninguém recebe nada.
   ============================================================================= */

import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

// A pública no formato que o navegador espera: ponto não comprimido, 65 bytes.
const spki = publicKey.export({ type: 'spki', format: 'der' });
const publicaCrua = spki.subarray(spki.length - 65);

// A privada: o escalar de 32 bytes, que é o que o JWK chama de "d".
const jwk = privateKey.export({ format: 'jwk' });

const pasta = join(homedir(), '.config', 'farejo');
if (!existsSync(pasta)) mkdirSync(pasta, { recursive: true, mode: 0o700 });

const alvo = join(pasta, 'vapid.json');
if (existsSync(alvo)) {
  console.error(`Já existe ${alvo}. Trocar a chave derruba todas as inscrições.`);
  console.error('Apague o arquivo à mão se for mesmo para gerar outro par.');
  process.exit(1);
}

const par = { publica: b64url(publicaCrua), privada: jwk.d, criada_em: new Date().toISOString() };
writeFileSync(alvo, JSON.stringify(par, null, 2) + '\n');
chmodSync(alvo, 0o600);

console.log(`Par gravado em ${alvo}\n`);
console.log('Pública  (vai em web/js/config.js, é pública mesmo):');
console.log(`  ${par.publica}\n`);
console.log('Privada  (NUNCA no repositório — vira segredo do Worker):');
console.log('  wrangler secret put VAPID_PRIVADA');
