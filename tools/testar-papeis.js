#!/usr/bin/env node
/* =============================================================================
   Faro — prova as travas de papel (schema-14/15)

       node tools/testar-papeis.js

   POR QUE ESTE TESTE EXISTE
   Autorização não se confere lendo o código: confere-se batendo na API pelos
   caminhos que um atacante usaria. A regra "só ONG publica adoção" tem TRÊS
   portas, e fechar uma só dá a sensação de estar pronto:

     1. a RPC criar_post                → mensagem em português
     2. POST /rest/v1/posts direto      → política de INSERT
     3. PATCH {"tipo":"adocao"} depois  → política de UPDATE

   O mesmo vale para virar administrador: o metadado do cadastro é escrito pelo
   cliente, e `PATCH /rest/v1/profiles {"papel":"admin"}` era o caminho mais
   curto de todos até o schema-14 revogar o UPDATE da tabela.

   Roda contra o banco DE VERDADE (não há outro), com sessões reais obtidas por
   magic link. Cria o que precisa, prova, e limpa tudo atrás de si — a última
   linha imprime o que sobrou, que tem de ser zero.

   Precisa de ~/.config/farejo/: service_role.key, anon.key e supabase-token.
   ============================================================================= */

import { readFileSync } from 'node:fs';
const H = process.env.HOME, U = 'https://sxnyeokxkczrcdnsanbu.supabase.co';
const SR = readFileSync(`${H}/.config/farejo/service_role.key`,'utf8').trim();
const AN = readFileSync(`${H}/.config/farejo/anon.key`,'utf8').trim();
const PAT = readFileSync(`${H}/.config/farejo/supabase-token`,'utf8').trim();
const CENTRO = { lat: -29.7182, lng: -52.4306 };

const sql = async (query) => {
  const r = await fetch('https://api.supabase.com/v1/projects/sxnyeokxkczrcdnsanbu/database/query',
    { method:'POST', headers:{Authorization:`Bearer ${PAT}`,'Content-Type':'application/json'},
      body: JSON.stringify({query}) });
  const t = await r.text(); if(!r.ok) throw new Error(t); return JSON.parse(t);
};

async function sessao(email) {
  const l = await (await fetch(`${U}/auth/v1/admin/generate_link`, {
    method:'POST', headers:{apikey:SR,Authorization:`Bearer ${SR}`,'Content-Type':'application/json'},
    body: JSON.stringify({type:'magiclink', email})})).json();
  const r = await fetch(`${U}/auth/v1/verify?token=${l.hashed_token}&type=magiclink&redirect_to=http://x/`,
    {headers:{apikey:AN}, redirect:'manual'});
  const tk = new URLSearchParams(r.headers.get('location').split('#')[1]).get('access_token');
  return { token: tk, id: JSON.parse(Buffer.from(tk.split('.')[1],'base64url')).sub };
}
const cab = (s) => ({ apikey: AN, Authorization:`Bearer ${s.token}`, 'Content-Type':'application/json' });

let ok = 0, falhas = 0;
function conferir(nome, condicao, detalhe='') {
  if (condicao) { ok++; console.log(`  ok      ${nome}`); }
  else { falhas++; console.log(`  FALHOU  ${nome}${detalhe ? '\n            → ' + detalhe : ''}`); }
}

const JEF = await sessao('jeferson@teste.farejo.local');
const ANA = await sessao('ana@teste.farejo.local');

const rpc = async (s, nome, corpo) => {
  const r = await fetch(`${U}/rest/v1/rpc/${nome}`, {method:'POST', headers:cab(s), body:JSON.stringify(corpo)});
  return { status: r.status, corpo: await r.text() };
};
const novoCaso = (tipo) => ({ p_tipo: tipo, p_titulo:'ZZ TESTE PAPEL', p_texto:'apagar',
  p_especie:'cao', p_lat:CENTRO.lat, p_lng:CENTRO.lng, p_endereco:'rua x', p_fotos:[] });

console.log('\n— FAREJADOR —');

let r = await rpc(JEF, 'criar_post', novoCaso('adocao'));
conferir('não publica adoção pela RPC', r.status >= 400 && /ONGs e protetores/.test(r.corpo), r.corpo.slice(0,120));
conferir('e a mensagem é em português, não erro de RLS', !/row-level security/.test(r.corpo));

r = await rpc(JEF, 'criar_post', novoCaso('perdido'));
conferir('publica perdido normalmente', r.status === 200);
const POST = JSON.parse(r.corpo);

// O caminho que a RPC não cobre: INSERT direto no PostgREST.
let d = await fetch(`${U}/rest/v1/posts`, {method:'POST', headers:{...cab(JEF), Prefer:'return=representation'},
  body: JSON.stringify({autor_id: JEF.id, tipo:'adocao', titulo:'ZZ BURLA', especie:'cao',
    local:`SRID=4326;POINT(${CENTRO.lng} ${CENTRO.lat})`})});
conferir('não publica adoção por INSERT direto na API', d.status >= 400, `${d.status} ${(await d.text()).slice(0,90)}`);

// E o caminho de virar adoção depois.
d = await fetch(`${U}/rest/v1/posts?id=eq.${POST}`, {method:'PATCH', headers:cab(JEF),
  body: JSON.stringify({tipo:'adocao'})});
const virou = await sql(`select tipo from posts where id='${POST}';`);
conferir('não vira adoção por PATCH', virou[0].tipo === 'perdido', `virou ${virou[0].tipo}`);

// A escalada de privilégio mais direta.
d = await fetch(`${U}/rest/v1/profiles?id=eq.${JEF.id}`, {method:'PATCH', headers:cab(JEF),
  body: JSON.stringify({papel:'admin'})});
const papel = await sql(`select papel from profiles where id='${JEF.id}';`);
conferir('não se promove a admin por PATCH', papel[0].papel === 'farejador', `virou ${papel[0].papel}`);

// Não enxerga o que é de moderação.
d = await fetch(`${U}/rest/v1/profiles?select=whatsapp,sobre,aprovado_em&id=eq.${ANA.id}`, {headers:cab(JEF)});
conferir('não lê whatsapp/sobre/aprovado_em de ninguém', d.status >= 400, `${d.status}`);

const ARGS = { admin_pendentes:{}, admin_contas:{}, admin_mudar_papel:{p_id:ANA.id, p_papel:'admin'},
               admin_contato:{p_perfil_id:ANA.id}, admin_decidir:{p_id:ANA.id, p_aprovar:true} };
for (const [f, args] of Object.entries(ARGS)) {
  const rr = await rpc(JEF, f, args);
  conferir(`${f} recusa quem não é admin`, rr.status >= 400 && /administrador/i.test(rr.corpo), `${rr.status} ${rr.corpo.slice(0,90)}`);
}

// Post de outra pessoa.
d = await fetch(`${U}/rest/v1/posts?id=eq.${POST}`, {method:'DELETE', headers:cab(ANA)});
const aindaExiste = await sql(`select count(*) n from posts where id='${POST}';`);
conferir('não apaga post alheio', Number(aindaExiste[0].n) === 1);

console.log('\n— O METADADO MENTIROSO —');
const mentiroso = `zz-teste-${Date.now()}@teste.farejo.local`;
const criado = await (await fetch(`${U}/auth/v1/admin/users`, {method:'POST',
  headers:{apikey:SR,Authorization:`Bearer ${SR}`,'Content-Type':'application/json'},
  body: JSON.stringify({email:mentiroso, password:'zz-teste-1234', email_confirm:true,
    user_metadata:{nome:'ZZ Mentiroso', papel:'admin'}})})).json();
const nasceu = await sql(`select papel, aprovado_em is not null ap from profiles where id='${criado.id}';`);
conferir('quem se cadastra dizendo papel:"admin" nasce farejador', nasceu[0].papel === 'farejador', `nasceu ${nasceu[0].papel}`);

console.log('\n— O PEDIDO DE QUEM JÁ TEM CONTA —');
/* Regressão: a trava `profiles_trava_papel` nasceu grossa demais e barrava o
   PRÓPRIO pedido de cadastro — a pessoa não conseguia nem entrar na fila.
   Entrar na fila não dá poder nenhum; aprovar-se é que dá. */
r = await rpc(JEF, 'pedir_para_doar', {p_papel:'protetor', p_sobre:'ZZ resgato ha anos'});
conferir('farejador consegue pedir cadastro para doar', r.status === 200 || r.status === 204,
  `${r.status} ${r.corpo.slice(0,90)}`);
let st = await sql(`select papel, aprovado_em from profiles where id='${JEF.id}';`);
conferir('e entra na fila, PENDENTE', st[0].papel === 'protetor' && st[0].aprovado_em === null,
  JSON.stringify(st[0]));
r = await rpc(JEF, 'criar_post', novoCaso('adocao'));
conferir('mas ainda não publica adoção', r.status >= 400 && /ONGs e protetores/.test(r.corpo));
r = await rpc(JEF, 'pedir_para_doar', {p_papel:'admin', p_sobre:'ZZ'});
conferir('e não vira admin pelo pedido', r.status >= 400 && /ONG ou protetor/.test(r.corpo));
await sql(`update profiles set papel='farejador', aprovado_em=now(), sobre=null where id='${JEF.id}';`);

console.log('\n— A ALLOWLIST DE ADMINISTRADOR —');
/* É por aqui que o fundador vira admin: o e-mail está em `admins_email` ANTES
   de a conta existir, e o gatilho do cadastro confere a lista. Se isto quebrar,
   ninguém vira administrador e a fila de pedidos fica sem quem decida — sem
   erro nenhum na tela. */
const daCasa = `zz-allowlist-${Date.now()}@teste.farejo.local`;
await sql(`insert into admins_email (email) values ('${daCasa}') on conflict do nothing;`);
const nasceuAdmin = await (await fetch(`${U}/auth/v1/admin/users`, {method:'POST',
  headers:{apikey:SR,Authorization:`Bearer ${SR}`,'Content-Type':'application/json'},
  body: JSON.stringify({email:daCasa, password:'zz-allowlist-1234', email_confirm:true,
    user_metadata:{nome:'ZZ Allowlist'}})})).json();
st = await sql(`select papel, aprovado_em is not null ap from profiles where id='${nasceuAdmin.id}';`);
conferir('e-mail da allowlist vira admin no cadastro', st[0]?.papel === 'admin', JSON.stringify(st[0]));
conferir('e já nasce aprovado', st[0]?.ap === true);
await fetch(`${U}/auth/v1/admin/users/${nasceuAdmin.id}`, {method:'DELETE', headers:{apikey:SR, Authorization:`Bearer ${SR}`}});
await sql(`delete from admins_email where email='${daCasa}';`);

console.log('\n— ONG / PROTETOR —');
await sql(`update profiles set papel='ong', aprovado_em=null, sobre='ZZ teste' where id='${ANA.id}';`);
r = await rpc(ANA, 'criar_post', novoCaso('adocao'));
conferir('ONG PENDENTE não publica adoção', r.status >= 400 && /ONGs e protetores/.test(r.corpo));
r = await rpc(ANA, 'criar_post', novoCaso('perdido'));
conferir('ONG pendente usa o app normalmente (publica perdido)', r.status === 200);
const P2 = r.status === 200 ? JSON.parse(r.corpo) : null;

await sql(`update profiles set aprovado_em=now() where id='${ANA.id}';`);
r = await rpc(ANA, 'criar_post', novoCaso('adocao'));
conferir('ONG APROVADA publica adoção', r.status === 200, r.corpo.slice(0,120));
const P3 = r.status === 200 ? JSON.parse(r.corpo) : null;

console.log('\n— ADMINISTRADOR —');
await sql(`update profiles set papel='admin', aprovado_em=now() where id='${JEF.id}';`);
const ADM = await sessao('jeferson@teste.farejo.local');

r = await rpc(ADM, 'admin_pendentes', {});
conferir('admin_pendentes responde ao admin', r.status === 200, r.corpo.slice(0,90));
r = await rpc(ADM, 'admin_contas', {});
conferir('admin_contas responde ao admin', r.status === 200 && JSON.parse(r.corpo).length >= 3);
r = await rpc(ADM, 'admin_contato', {p_perfil_id: ANA.id});
conferir('admin_contato devolve o telefone e registra', r.status === 200);
conferir('e o acesso ficou no admin_log',
  Number((await sql(`select count(*) n from admin_log where acao='contato';`))[0].n) === 1);
r = await rpc(ADM, 'admin_mudar_papel', {p_id: ADM.id, p_papel:'farejador'});
conferir('admin não rebaixa a si mesmo', r.status >= 400 && /próprio papel/.test(r.corpo));
r = await rpc(ADM, 'apagar_post', {p_id: P2});
conferir('admin apaga post de terceiro', r.status === 200 || r.status === 204, `${r.status} ${r.corpo.slice(0,120)}`);
conferir('e o post sumiu mesmo', Number((await sql(`select count(*) n from posts where id='${P2}';`))[0].n) === 0);

console.log('\n— APAGAR UMA CONTA QUE JÁ DECIDIU —');
/* Regressão: `aprovado_por` nasceu sem `on delete`, e a chave estrangeira
   tornava IMPOSSÍVEL apagar um administrador que já tivesse aprovado alguém.
   Um ponteiro de auditoria não pode prender uma conta no banco para sempre. */
const descartavel = `zz-apagar-${Date.now()}@teste.farejo.local`;
const dsc = await (await fetch(`${U}/auth/v1/admin/users`, {method:'POST',
  headers:{apikey:SR,Authorization:`Bearer ${SR}`,'Content-Type':'application/json'},
  body: JSON.stringify({email:descartavel, password:'zz-apagar-1234', email_confirm:true,
    user_metadata:{nome:'ZZ Descartavel'}})})).json();
await sql(`update profiles set papel='admin' where id='${dsc.id}';
           update profiles set aprovado_por='${dsc.id}' where id='${ANA.id}';`);
const del = await fetch(`${U}/auth/v1/admin/users/${dsc.id}`,
  {method:'DELETE', headers:{apikey:SR, Authorization:`Bearer ${SR}`}});
conferir('dá para apagar um admin que aprovou alguém', del.status === 200, `${del.status}`);
conferir('e quem ele aprovou continua aprovado',
  (await sql(`select aprovado_em is not null ok from profiles where id='${ANA.id}';`))[0].ok === true);

console.log('\n— LIMPEZA —');
await sql(`delete from posts where titulo like 'ZZ %';
           update profiles set papel='farejador', aprovado_em=now(), sobre=null where id in ('${ANA.id}','${JEF.id}');
           delete from admin_log;`);
await fetch(`${U}/auth/v1/admin/users/${criado.id}`, {method:'DELETE', headers:{apikey:SR,Authorization:`Bearer ${SR}`}});
const sobra = await sql(`select (select count(*) from posts where titulo like 'ZZ %') posts,
  (select count(*) from profiles where papel<>'farejador') naoFarejador,
  (select count(*) from profiles) perfis;`);
console.log('   sobrou:', JSON.stringify(sobra[0]));

console.log(`\n${falhas ? `${falhas} FALHA(S) em ${ok+falhas}` : `Tudo certo — ${ok} verificações.`}`);
process.exit(falhas ? 1 : 0);
