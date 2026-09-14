#!/usr/bin/env node
/* =============================================================================
   Faro — prova a coleta de desfechos (schema-19)

       node tools/testar-desfechos.js

   POR QUE ESTE TESTE EXISTE
   `desfechos` é a nossa base de calibragem: é dela que sairão, um dia, os
   números de Santa Cruz do Sul no lugar dos de Ohio e da Austrália. Duas
   coisas precisam continuar verdadeiras para sempre:

     1. A CONTA — distância, rumo e horas medidos a partir do ÚLTIMO ponto
        conhecido. Se isso silenciosamente errar, a base inteira apodrece sem
        ninguém perceber, e só se descobre quando já não dá para refazer.

     2. O SIGILO — a tabela guarda ONDE um pet foi achado, que pode ser o
        quintal ou a garagem de um vizinho. Nem o dono do caso a lê pela API.
        Só as funções agregadas, e só para o administrador.

   E uma terceira, de gentileza: responder é OPCIONAL. Nem todo encerramento é
   final feliz, e o caso tem de fechar igual para quem não quiser contar nada.

   Roda contra o banco de verdade, com sessões reais. Limpa o que cria.
   Precisa de ~/.config/farejo/: service_role.key, anon.key e supabase-token.
   ============================================================================= */

import { readFileSync } from 'node:fs';

const H=process.env.HOME, U='https://sxnyeokxkczrcdnsanbu.supabase.co';
const SR=readFileSync(`${H}/.config/farejo/service_role.key`,'utf8').trim();
const AN=readFileSync(`${H}/.config/farejo/anon.key`,'utf8').trim();
const PAT=readFileSync(`${H}/.config/farejo/supabase-token`,'utf8').trim();
const sql=async(q)=>{const r=await fetch('https://api.supabase.com/v1/projects/sxnyeokxkczrcdnsanbu/database/query',
 {method:'POST',headers:{Authorization:`Bearer ${PAT}`,'Content-Type':'application/json'},body:JSON.stringify({query:q})});
 const t=await r.text(); if(!r.ok) throw new Error(t); return JSON.parse(t);};
async function sessao(email){
  const l=await(await fetch(`${U}/auth/v1/admin/generate_link`,{method:'POST',
    headers:{apikey:SR,Authorization:`Bearer ${SR}`,'Content-Type':'application/json'},
    body:JSON.stringify({type:'magiclink',email})})).json();
  const r=await fetch(`${U}/auth/v1/verify?token=${l.hashed_token}&type=magiclink&redirect_to=http://x/`,
    {headers:{apikey:AN},redirect:'manual'});
  const tk=new URLSearchParams(r.headers.get('location').split('#')[1]).get('access_token');
  return {token:tk,id:JSON.parse(Buffer.from(tk.split('.')[1],'base64url')).sub};}
const cab=(s)=>({apikey:AN,Authorization:`Bearer ${s.token}`,'Content-Type':'application/json'});
const rpc=async(s,n,b)=>{const r=await fetch(`${U}/rest/v1/rpc/${n}`,{method:'POST',headers:cab(s),body:JSON.stringify(b)});
  return {status:r.status, corpo: await r.text()};};

let ok=0, mau=0;
const conferir=(n,c,d='')=>{ if(c){ok++;console.log('  ok      '+n);} else {mau++;console.log('  FALHOU  '+n+(d?'\n            → '+d:''));} };

const JEF = await sessao('jeferson@teste.farejo.local');
const ANA = await sessao('ana@teste.farejo.local');
const C = {lat:-29.7182, lng:-52.4306};

// caso perdido, 6 horas atrás
const criar = await rpc(JEF,'criar_post',{p_tipo:'perdido',p_titulo:'ZZ DESFECHO',p_texto:'t',
  p_especie:'gato',p_lat:C.lat,p_lng:C.lng,p_endereco:'rua x',p_fotos:[],
  p_ocorrido_em:new Date(Date.now()-6*3600e3).toISOString()});
const POST = JSON.parse(criar.corpo);
console.log('caso de teste:', POST, '\n');

console.log('— A PERGUNTA DO GATO —');
let r = await rpc(JEF,'definir_acesso_rua',{p_post_id:POST,p_valor:'nao_sai'});
conferir('o dono responde', r.status===200||r.status===204, `${r.status} ${r.corpo.slice(0,80)}`);
conferir('e grava', (await sql(`select acesso_rua from posts where id='${POST}';`))[0].acesso_rua==='nao_sai');
r = await rpc(ANA,'definir_acesso_rua',{p_post_id:POST,p_valor:'sai'});
conferir('estranho não responde', r.status>=400 && /Só quem publicou/.test(r.corpo));

console.log('\n— O DESFECHO —');
// ponto a ~400 m ao NORTE do ponto de origem
const achado = {lat: C.lat + 0.0036, lng: C.lng};
r = await rpc(JEF,'registrar_desfecho',{p_post_id:POST,p_lat:achado.lat,p_lng:achado.lng,
  p_lugar:'quintal_alheio',p_como:'busca_a_pe'});
conferir('o dono registra', r.status===200||r.status===204, `${r.status} ${r.corpo.slice(0,110)}`);

const d = (await sql(`select round(distancia_m::numeric,1) dist, round(rumo_graus::numeric,1) rumo,
  round(horas::numeric,2) horas, lugar, como, especie, acesso_rua, local is not null tem_ponto
  from desfechos where post_id='${POST}';`))[0];
console.log('   gravado:', JSON.stringify(d));
conferir('distância bate com ~400 m', Math.abs(d.dist-400)<15, `deu ${d.dist}`);
conferir('rumo aponta para o NORTE (~0°)', d.rumo<5 || d.rumo>355, `deu ${d.rumo}`);
conferir('horas ~6', Math.abs(d.horas-6)<0.2, `deu ${d.horas}`);
conferir('espécie e acesso_rua copiados', d.especie==='gato' && d.acesso_rua==='nao_sai');
conferir('o ponto foi guardado', d.tem_ponto===true);

console.log('\n— GUARDADO NÃO É PUBLICADO —');
for (const [quem, s] of [['o dono', JEF], ['outra pessoa', ANA]]) {
  const rr = await fetch(`${U}/rest/v1/desfechos?select=*`, {headers:cab(s)});
  conferir(`${quem} NÃO lê a tabela`, rr.status>=400, `${rr.status} ${(await rr.text()).slice(0,70)}`);
}
const anon = await fetch(`${U}/rest/v1/desfechos?select=*`, {headers:{apikey:AN}});
conferir('anônimo NÃO lê a tabela', anon.status>=400, `${anon.status}`);
r = await rpc(JEF,'padroes_locais',{});
conferir('padroes_locais recusa quem não é admin', r.status>=400 && /administrador/i.test(r.corpo));

console.log('\n— PULAR É PULAR —');
const c2 = await rpc(JEF,'criar_post',{p_tipo:'perdido',p_titulo:'ZZ DESFECHO 2',p_texto:'t',p_especie:'cao',
  p_lat:C.lat,p_lng:C.lng,p_endereco:'y',p_fotos:[]});
const P2 = JSON.parse(c2.corpo);
r = await rpc(JEF,'registrar_desfecho',{p_post_id:P2});
conferir('registra sem nenhuma resposta', r.status===200||r.status===204, `${r.status} ${r.corpo.slice(0,80)}`);
const d2 = (await sql(`select distancia_m, rumo_graus, lugar, como from desfechos where post_id='${P2}';`))[0];
conferir('e deixa tudo nulo, menos o tempo', d2.distancia_m===null && d2.rumo_graus===null && d2.lugar===null);

console.log('\n— APAGAR O CASO LEVA O DESFECHO —');
await sql(`delete from posts where id='${P2}';`);
conferir('cascade funciona', Number((await sql(`select count(*) n from desfechos where post_id='${P2}';`))[0].n)===0);

await sql(`delete from posts where titulo like 'ZZ DESFECHO%'; update posts set acesso_rua=null where acesso_rua is not null;`);
const sobra = await sql(`select (select count(*) from desfechos) d, (select count(*) from posts where titulo like 'ZZ %') p;`);
console.log('\nlimpeza:', JSON.stringify(sobra[0]));
console.log(mau ? `\n${mau} FALHA(S) em ${ok+mau}` : `\nTudo certo — ${ok} verificações.`);
process.exit(mau?1:0);
