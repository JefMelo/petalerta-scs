#!/usr/bin/env node
/* =============================================================================
   Faro — prova a rede de segurança da limpeza de fotos (schema-24)

       node tools/testar-fotos-orfas.js

   POR QUE ESTE TESTE EXISTE
   O nome de um arquivo no Storage existe em UM lugar só: uma linha de
   `post_fotos`. Apagar o caso mata essa linha. Se a remoção do arquivo falhar
   naquele segundo — sem rede, app fechado, aba morta — o arquivo fica lá para
   sempre e ninguém nunca mais descobre que ele existe. A varredura de
   15/09/2026 encontrou um assim.

   A fila `fotos_orfas` conserta isso fazendo o NOME sobreviver ao caso. O que
   precisa continuar verdadeiro:

     1. APAGAR UM CASO ENFILEIRA as fotos dele — e as dos avistamentos que o
        cascade leva junto.
     2. A FILA É DE CADA UM. Uma pessoa não vê nem apaga a fila de outra; se
        visse, o caminho do arquivo diria em que pasta ela pode mexer.
     3. ESQUECER SÓ APAGA O QUE FOI PEDIDO — quem falha continua na fila, que
        é o que faz a rede ser rede.
     4. NINGUÉM LÊ A TABELA pela API, nem deslogado nem logado.

   Roda contra o banco de verdade, com sessões reais. Limpa o que cria.
   Precisa de ~/.config/farejo/: service_role.key, anon.key e supabase-token.
   ============================================================================= */

import { readFileSync } from 'node:fs';

const H = process.env.HOME, U = 'https://sxnyeokxkczrcdnsanbu.supabase.co';
const SR = readFileSync(`${H}/.config/farejo/service_role.key`, 'utf8').trim();
const AN = readFileSync(`${H}/.config/farejo/anon.key`, 'utf8').trim();
const PAT = readFileSync(`${H}/.config/farejo/supabase-token`, 'utf8').trim();

const sql = async (q) => {
  const r = await fetch('https://api.supabase.com/v1/projects/sxnyeokxkczrcdnsanbu/database/query',
    { method: 'POST', headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q }) });
  const t = await r.text();
  if (!r.ok) throw new Error(t);
  return JSON.parse(t);
};

async function sessao(email) {
  const l = await (await fetch(`${U}/auth/v1/admin/generate_link`, { method: 'POST',
    headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email }) })).json();
  const r = await fetch(`${U}/auth/v1/verify?token=${l.hashed_token}&type=magiclink&redirect_to=http://x/`,
    { headers: { apikey: AN }, redirect: 'manual' });
  const tk = new URLSearchParams(r.headers.get('location').split('#')[1]).get('access_token');
  return { token: tk, id: JSON.parse(Buffer.from(tk.split('.')[1], 'base64url')).sub };
}
const cab = (s) => ({ apikey: AN, Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' });
const rpc = async (s, nome, corpo) => {
  const r = await fetch(`${U}/rest/v1/rpc/${nome}`,
    { method: 'POST', headers: cab(s), body: JSON.stringify(corpo || {}) });
  return { status: r.status, corpo: await r.text() };
};

let ok = 0, mau = 0;
const conferir = (n, c, d = '') => {
  if (c) { ok++; console.log(`  ok      ${n}`); }
  else { mau++; console.log(`  FALHOU  ${n}${d ? `\n            → ${d}` : ''}`); }
};

const MARCA = 'zz-orfas';
const limpar = () => sql(`
  delete from fotos_orfas where path like '${MARCA}%';
  delete from posts where titulo like '${MARCA}%';
`);

const JEF = await sessao('jeferson@teste.farejo.local');
const ANA = await sessao('ana@teste.farejo.local');
const fila = async (s) => JSON.parse((await rpc(s, 'minhas_fotos_orfas')).corpo);

await limpar();
try {
  console.log('— APAGAR UM CASO ENFILEIRA AS FOTOS —');

  /* Um caso com foto e um avistamento com foto, para provar que o cascade não
     leva a pista embora. A foto externa (https://) entra de propósito: não é
     nossa e não pode ir para a fila. */
  const [{ id: caso }] = await sql(`
    insert into posts (autor_id, tipo, titulo, especie, local, ocorrido_em)
    values ('${JEF.id}', 'perdido', '${MARCA} caso', 'cao',
            st_setsrid(st_makepoint(-52.4306, -29.7182), 4326)::geography, now())
    returning id;`);
  const [{ id: avist }] = await sql(`
    insert into posts (autor_id, tipo, titulo, especie, local, ocorrido_em, post_origem_id)
    values ('${JEF.id}', 'avistado', '${MARCA} avistamento', 'cao',
            st_setsrid(st_makepoint(-52.4306, -29.7182), 4326)::geography, now(), '${caso}')
    returning id;`);
  await sql(`
    insert into post_fotos (post_id, path, ordem) values
      ('${caso}',  '${MARCA}/capa.jpg', 0),
      ('${caso}',  'https://exemplo.invalido/nao-e-nossa.jpg', 1),
      ('${avist}', '${MARCA}/avistado.jpg', 0);`);

  const apagou = await rpc(JEF, 'apagar_post', { p_id: caso });
  // função `void` responde 204 sem corpo; 200 só se um dia devolver algo.
  conferir('o caso foi apagado', apagou.status === 204 || apagou.status === 200,
    `${apagou.status} ${apagou.corpo}`);

  const f1 = await fila(JEF);
  conferir('a foto do CASO entrou na fila', f1.includes(`${MARCA}/capa.jpg`), JSON.stringify(f1));
  conferir('a foto do AVISTAMENTO também — o cascade levaria a pista junto',
    f1.includes(`${MARCA}/avistado.jpg`), JSON.stringify(f1));
  conferir('a URL externa NÃO entrou (não é nossa para apagar)',
    !f1.some((p) => p.startsWith('http')), JSON.stringify(f1));
  conferir('e o caso sumiu mesmo',
    (await sql(`select count(*) n from posts where id = '${caso}'`))[0].n === 0);

  console.log('\n— A FILA É DE CADA UM —');
  const f2 = await fila(ANA);
  conferir('outra pessoa não vê a fila alheia',
    !f2.some((p) => p.startsWith(MARCA)), JSON.stringify(f2));

  const tentou = await rpc(ANA, 'esquecer_fotos_orfas', { p_paths: [`${MARCA}/capa.jpg`] });
  conferir('nem consegue esvaziar a fila alheia', tentou.status === 204 || tentou.status === 200);
  conferir('  └ e a linha continua lá',
    (await fila(JEF)).includes(`${MARCA}/capa.jpg`),
    'apagou a foto de outra pessoa da fila');

  console.log('\n— ESQUECER SÓ APAGA O QUE FOI PEDIDO —');
  await rpc(JEF, 'esquecer_fotos_orfas', { p_paths: [`${MARCA}/capa.jpg`] });
  const f3 = await fila(JEF);
  conferir('a que saiu do bucket some da fila', !f3.includes(`${MARCA}/capa.jpg`));
  conferir('a que NÃO saiu continua esperando a próxima tentativa',
    f3.includes(`${MARCA}/avistado.jpg`),
    'a fila esvaziou sozinha — a rede de segurança não seguraria nada');

  console.log('\n— MARCAR À MÃO (troca de avatar, edição de caso) —');
  await rpc(JEF, 'marcar_fotos_orfas', { p_paths: [`${MARCA}/avatar.jpg`, '', null, 'https://x/y.jpg'] });
  const f4 = await fila(JEF);
  conferir('o caminho válido entrou', f4.includes(`${MARCA}/avatar.jpg`));
  conferir('vazio, nulo e URL externa foram ignorados',
    f4.filter((p) => p.startsWith(MARCA)).length === 2, JSON.stringify(f4));
  await rpc(JEF, 'marcar_fotos_orfas', { p_paths: [`${MARCA}/avatar.jpg`] });
  conferir('marcar duas vezes não duplica nem quebra',
    (await fila(JEF)).filter((p) => p === `${MARCA}/avatar.jpg`).length === 1);

  console.log('\n— A FILA NÃO ENTREGA O QUE AINDA ESTÁ EM USO —');
  /* O erro que deu origem a esta trava: varri o bucket cruzando só com
     `post_fotos` e apaguei o que era a foto de PERFIL de alguém. A fila é uma
     lista de candidatos, não uma ordem de execução. */
  await rpc(JEF, 'marcar_fotos_orfas', { p_paths: [`${MARCA}/em-uso.jpg`] });
  conferir('entra na fila como candidata', (await fila(JEF)).includes(`${MARCA}/em-uso.jpg`));

  await sql(`update profiles set avatar_path = '${MARCA}/em-uso.jpg' where id = '${JEF.id}'`);
  conferir('mas NÃO é entregue enquanto for a foto de perfil de alguém',
    !(await fila(JEF)).includes(`${MARCA}/em-uso.jpg`),
    'a fila mandaria apagar o avatar de uma pessoa');

  await sql(`update profiles set avatar_path = null where id = '${JEF.id}'`);
  conferir('  └ e volta a ser entregue quando ninguém mais aponta para ela',
    (await fila(JEF)).includes(`${MARCA}/em-uso.jpg`));

  const [{ id: outro }] = await sql(`
    insert into posts (autor_id, tipo, titulo, especie, local, ocorrido_em)
    values ('${JEF.id}', 'perdido', '${MARCA} guarda', 'cao',
            st_setsrid(st_makepoint(-52.4306, -29.7182), 4326)::geography, now())
    returning id;`);
  await sql(`insert into post_fotos (post_id, path, ordem)
               values ('${outro}', '${MARCA}/em-uso.jpg', 0)`);
  conferir('o mesmo vale para a foto de um caso',
    !(await fila(JEF)).includes(`${MARCA}/em-uso.jpg`));

  console.log('\n— NINGUÉM LÊ A TABELA PELA API —');
  const anon = await fetch(`${U}/rest/v1/fotos_orfas?select=*`, { headers: { apikey: AN } });
  conferir('deslogado não lê', anon.status === 401, String(anon.status));
  const logado = await fetch(`${U}/rest/v1/fotos_orfas?select=*`, { headers: cab(JEF) });
  conferir('logado também não lê', logado.status === 401 || logado.status === 403,
    String(logado.status));
  const semConta = await fetch(`${U}/rest/v1/rpc/minhas_fotos_orfas`,
    { method: 'POST', headers: { apikey: AN, 'Content-Type': 'application/json' }, body: '{}' });
  conferir('e a função é negada a quem não tem conta',
    semConta.status === 401 || semConta.status === 403, String(semConta.status));

  console.log('\n— A CONTAGEM É SÓ DO ADMINISTRADOR —');
  const conta = await rpc(JEF, 'fotos_orfas_pendentes');
  conferir('quem não é administrador recebe vazio, não o número',
    conta.corpo.trim() === 'null', conta.corpo);
} finally {
  await limpar();
  console.log(`\nlimpeza: ${JSON.stringify((await sql(
    `select (select count(*) from fotos_orfas where path like '${MARCA}%') f,
            (select count(*) from posts where titulo like '${MARCA}%') p`))[0])}`);
}

console.log(mau ? `\n${mau} FALHA(S) em ${ok + mau}` : `\nTudo certo — ${ok} verificações.`);
process.exit(mau ? 1 : 0);
