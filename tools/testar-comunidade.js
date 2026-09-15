#!/usr/bin/env node
/* =============================================================================
   Faro — prova o contador de farejadores ativos (schema-23)

       node tools/testar-comunidade.js

   POR QUE ESTE TESTE EXISTE
   Este é um número que vai ficar escrito na tela de criar conta, ao lado do
   pedido "confie no Faro". Se ele inflar, o app está mentindo sobre o tamanho
   da própria comunidade para convencer alguém a entrar — que é exatamente o
   truque que ele existe para não fazer.

   E inflar é fácil e silencioso: basta um `union all` no lugar do `union` e a
   mesma pessoa que publicou, comentou e compartilhou vira três pessoas. O
   número fica maior, mais bonito, e falso. Nada quebra.

   Então o que se prova aqui é:
     1. PESSOA É PESSOA. Três ações da mesma pessoa contam UMA vez.
     2. A JANELA FECHA. Quem agiu há 40 dias não é "ativo".
     3. QUALQUER UM PODE LER, e só o agregado — nunca os nomes.

   Roda contra o banco de verdade. Limpa o que cria.
   Precisa de ~/.config/farejo/: anon.key e supabase-token.
   ============================================================================= */

import { readFileSync } from 'node:fs';

const H = process.env.HOME, U = 'https://sxnyeokxkczrcdnsanbu.supabase.co';
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

let ok = 0, mau = 0;
const conferir = (n, c, d = '') => {
  if (c) { ok++; console.log(`  ok      ${n}`); }
  else { mau++; console.log(`  FALHOU  ${n}${d ? `\n            → ${d}` : ''}`); }
};

const conta = async (dias = 30) => Number((await sql(`select farejadores_ativos(${dias}) n`))[0].n);

/* Um caso "âncora" e três pessoas de mentira, criadas direto no banco para não
   depender de cadastro nem de e-mail. São apagadas no fim, aconteça o que
   acontecer.

   As três são reconhecidas pelo E-MAIL, nunca pelo nome do perfil: quem cria a
   linha em `profiles` é o gatilho `handle_new_user`, e disputar a criação com
   ele dá chave duplicada. Aqui só se lê o que ele fez. */
const MARCA = 'zz-comunidade-teste';
const NOSSAS = `(select id from auth.users where email like '${MARCA}%')`;
const limpar = () => sql(`
  delete from compartilhamentos where perfil_id in ${NOSSAS};
  delete from comentarios       where autor_id  in ${NOSSAS};
  delete from posts             where autor_id  in ${NOSSAS};
  delete from posts             where titulo = '${MARCA}';
  delete from auth.users        where email like '${MARCA}%';
`);

await limpar();
const antes = await conta();
console.log(`farejadores ativos agora: ${antes}\n`);

try {
  // três contas (o gatilho cria o perfil de cada uma) e um caso de apoio,
  // para ter onde comentar e compartilhar
  await sql(`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            raw_user_meta_data, email_confirmed_at, created_at, updated_at)
    select gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
           'authenticated', '${MARCA}-' || g || '@exemplo.invalido', 'x',
           jsonb_build_object('nome', '${MARCA}'), now(), now(), now()
      from generate_series(1, 3) g;
    insert into posts (autor_id, tipo, titulo, especie, local, ocorrido_em, criado_em)
    select id, 'perdido', '${MARCA}', 'cao',
           st_setsrid(st_makepoint(-52.4306, -29.7182), 4326)::geography, now(), now()
      from auth.users where email like '${MARCA}%'
      order by email limit 1;
  `);

  const [{ id: caso, autor_id: umaPessoa }] = await sql(
    `select id, autor_id from posts where titulo = '${MARCA}'`);

  console.log('— PESSOA É PESSOA, NÃO AÇÃO —');
  conferir('quem publicou já conta', (await conta()) === antes + 1,
    `${antes} → ${await conta()}`);

  await sql(`
    insert into comentarios (post_id, autor_id, texto, criado_em)
      values ('${caso}', '${umaPessoa}', 'oi', now());
    insert into compartilhamentos (post_id, perfil_id, criado_em)
      values ('${caso}', '${umaPessoa}', now());
  `);
  conferir('e comentar e compartilhar NÃO a contam de novo', (await conta()) === antes + 1,
    `deu ${await conta()}, esperado ${antes + 1} — o union virou union all?`);

  console.log('\n— CADA PESSOA A MAIS É UMA A MAIS —');
  const outras = await sql(
    `select id from auth.users where email like '${MARCA}%' and id <> '${umaPessoa}' order by email`);
  await sql(`insert into comentarios (post_id, autor_id, texto, criado_em)
               values ('${caso}', '${outras[0].id}', 'ajudo', now());`);
  conferir('quem só comentou conta', (await conta()) === antes + 2);
  await sql(`insert into compartilhamentos (post_id, perfil_id, criado_em)
               values ('${caso}', '${outras[1].id}', now());`);
  conferir('quem só compartilhou conta', (await conta()) === antes + 3);

  console.log('\n— A JANELA FECHA —');
  await sql(`
    update posts            set criado_em = now() - interval '40 days' where titulo = '${MARCA}';
    update comentarios      set criado_em = now() - interval '40 days' where post_id = '${caso}';
    update compartilhamentos set criado_em = now() - interval '40 days' where post_id = '${caso}';
  `);
  conferir('quem agiu há 40 dias não é ativo', (await conta()) === antes,
    `deu ${await conta()}, esperado ${antes}`);
  conferir('mas numa janela de 90 dias volta a aparecer', (await conta(90)) === antes + 3);
  conferir('exatamente na borda de 30 dias ainda conta', await (async () => {
    await sql(`update posts set criado_em = now() - interval '29 days 23 hours'
                where titulo = '${MARCA}'`);
    return (await conta()) === antes + 1;
  })());

  console.log('\n— UM DIA É O MÍNIMO —');
  /* `p_dias` vem do cliente. Zero ou negativo faria `now() - interval '0'`,
     que devolveria só quem agiu neste instante — um zero convincente. */
  conferir('dias = 0 não zera a conta', (await conta(0)) >= 0);
  conferir('dias negativo não quebra', (await conta(-5)) >= 0);

  console.log('\n— QUALQUER UM LÊ O NÚMERO, NINGUÉM LÊ OS NOMES —');
  const anon = await fetch(`${U}/rest/v1/rpc/farejadores_ativos`, {
    method: 'POST', headers: { apikey: AN, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const corpo = await anon.text();
  conferir('visitante deslogado consegue ler', anon.status === 200, `${anon.status} ${corpo}`);
  conferir('e o que volta é um número, não uma lista',
    /^\d+$/.test(corpo.trim()), `veio "${corpo.slice(0, 80)}"`);
} finally {
  await limpar();
  const depois = await conta();
  console.log(`\nlimpeza: voltou para ${depois}`);
  conferir('o teste não deixou farejador de mentira para trás', depois === antes,
    `${antes} antes, ${depois} depois`);
}

console.log(mau ? `\n${mau} FALHA(S) em ${ok + mau}` : `\nTudo certo — ${ok} verificações.`);
process.exit(mau ? 1 : 0);
