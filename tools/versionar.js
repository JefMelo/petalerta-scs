#!/usr/bin/env node
/* =============================================================================
   Farejo — carimba a MESMA versão em todo ?v= de web/

       node tools/versionar.js          # confere e lista divergências
       node tools/versionar.js 15       # carimba 15 em tudo

   POR QUE ISTO EXISTE
   Para o navegador, "dados.js?v=8" e "dados.js?v=9" são módulos DIFERENTES: ele
   baixa e instancia o arquivo duas vezes, com estado separado. Aconteceu de
   verdade — dois clientes Supabase, duas sessões e dois ORIGEM, o que fazia o
   "centralizar em mim" do mapa não mexer nas distâncias do feed.
   Bumpar versão à mão, arquivo por arquivo, é o que causa isso.
   ============================================================================= */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const PADRAO = /(\.(?:js|css))\?v=([0-9]+)/g;

async function arquivos(dir) {
  const saida = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, item.name);
    if (item.isDirectory()) saida.push(...await arquivos(p));
    else if (/\.(js|css|html)$/.test(item.name)) saida.push(p);
  }
  return saida;
}

const nova = process.argv[2];
const lista = await arquivos(web);
const achadas = new Map();   // versão → [onde]

for (const arq of lista) {
  const txt = await readFile(arq, 'utf8');
  for (const m of txt.matchAll(PADRAO)) {
    const curto = arq.slice(web.length + 1);
    achadas.set(m[2], [...(achadas.get(m[2]) || []), curto]);
  }
  if (nova) {
    const novo = txt.replace(PADRAO, `$1?v=${nova}`);
    if (novo !== txt) await writeFile(arq, novo);
  }
}

if (nova) {
  console.log(`Todos os ?v= carimbados com ${nova}.`);
} else if (achadas.size <= 1) {
  console.log(`Tudo na mesma versão (v=${[...achadas.keys()][0] ?? '—'}). Ok.`);
} else {
  console.log('DIVERGÊNCIA — o mesmo módulo será carregado mais de uma vez:');
  for (const [v, onde] of [...achadas].sort()) {
    console.log(`  v=${v}: ${[...new Set(onde)].join(', ')}`);
  }
  process.exitCode = 1;
}
