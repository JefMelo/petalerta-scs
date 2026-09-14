#!/usr/bin/env node
/* =============================================================================
   Faro — prova a conta do recorte

       node tools/testar-recorte.js

   POR QUE ESTE TESTE EXISTE
   Recorte errado não quebra nada: gera um JPEG bonito com uma tarja branca na
   borda, ou com a cabeça do pet cortada fora. Ninguém vê o defeito até a foto
   estar publicada — e a foto é a única coisa que faz alguém reconhecer o animal
   na rua.

   O que se prova aqui é uma propriedade, não uma aparência: COM O ARRASTE
   TRAVADO, O QUADRADO RECORTADO NUNCA SAI DE DENTRO DA IMAGEM. Nem um pixel.
   ============================================================================= */

import { escalaDeCobertura, limiteDoArraste, travar, fonteDoRecorte,
         ladoDaSaida, problemaNoArquivo,
         LADO, LADO_MINIMO, ENTRADA_MAXIMA_MB, ZOOM_MAXIMO } from '../web/js/recortar.js';

let ok = 0, falhas = 0;
const conferir = (nome, condicao, detalhe = '') => {
  if (condicao) { ok++; console.log(`  ok      ${nome}`); }
  else { falhas++; console.log(`  FALHOU  ${nome}${detalhe ? `\n            → ${detalhe}` : ''}`); }
};

const QUADRO = 360;                       // o palco, em pixels de tela

/* Formatos reais: retrato de celular, paisagem, quadrada, panorâmica e uma
   foto minúscula de print de tela. */
const FOTOS = [
  ['retrato 3:4',   3024, 4032],
  ['paisagem 4:3',  4032, 3024],
  ['quadrada',      2000, 2000],
  ['panorâmica',    6000, 1200],
  ['pequena',        320,  240],
  ['tira vertical',  800, 5000],
];

console.log('— O RECORTE NUNCA SAI DA IMAGEM —');
/* O caso perigoso é o canto: arraste no máximo, nos dois eixos, nos dois
   sentidos, em todo zoom. É ali que um sinal trocado na conta vazaria. */
for (const [nome, L, A] of FOTOS) {
  let pior = 0;
  for (const zoom of [1, 1.0001, 1.37, 2, ZOOM_MAXIMO]) {
    const escala = escalaDeCobertura(L, A, QUADRO) * zoom;
    const lim = limiteDoArraste(L, A, QUADRO, escala);
    for (const sx of [-1, -0.5, 0, 0.5, 1]) {
      for (const sy of [-1, -0.5, 0, 0.5, 1]) {
        const x = travar(lim.x * sx * 3, lim.x);   // empurra ALÉM do limite
        const y = travar(lim.y * sy * 3, lim.y);
        const f = fonteDoRecorte({ largura: L, altura: A, quadro: QUADRO, escala, x, y });
        // Folga de 1e-9 só para o ruído de ponto flutuante.
        const dentro = f.sx >= -1e-9 && f.sy >= -1e-9
                    && f.sx + f.lado <= L + 1e-9 && f.sy + f.lado <= A + 1e-9;
        if (!dentro) pior = Math.max(pior, 1);
      }
    }
  }
  conferir(`${nome} (${L}×${A}): nenhum vazio em 125 posições`, pior === 0);
}

console.log('\n— O QUADRO FICA SEMPRE COBERTO —');
/* O outro lado da mesma moeda: no zoom 1 a imagem tem de cobrir o quadro
   inteiro, senão sobra borda. O menor lado é quem manda. */
for (const [nome, L, A] of FOTOS) {
  const e = escalaDeCobertura(L, A, QUADRO);
  conferir(`${nome}: os dois lados cobrem o quadro no zoom 1`,
    L * e >= QUADRO - 1e-9 && A * e >= QUADRO - 1e-9,
    `${(L * e).toFixed(1)} × ${(A * e).toFixed(1)} para um quadro de ${QUADRO}`);
  conferir(`  └ e o menor lado bate EXATAMENTE no quadro (não sobra zoom morto)`,
    Math.abs(Math.min(L, A) * e - QUADRO) < 1e-9);
}

console.log('\n— O EIXO SEM FOLGA NÃO ARRASTA —');
/* Numa foto 3:4, o lado estreito cabe justo: arrastar nele só mostraria branco.
   O limite tem de ser ZERO, nunca um negativo que deixe a foto escapar. */
const e34 = escalaDeCobertura(3024, 4032, QUADRO);
const l34 = limiteDoArraste(3024, 4032, QUADRO, e34);
conferir('retrato: não anda na horizontal', l34.x === 0, `deu ${l34.x}`);
conferir('retrato: anda na vertical', l34.y > 0);
const lQ = limiteDoArraste(2000, 2000, QUADRO, escalaDeCobertura(2000, 2000, QUADRO));
conferir('quadrada: não anda em eixo nenhum', lQ.x === 0 && lQ.y === 0);
conferir('nenhum limite é negativo',
  FOTOS.every(([, L, A]) => {
    const l = limiteDoArraste(L, A, QUADRO, escalaDeCobertura(L, A, QUADRO));
    return l.x >= 0 && l.y >= 0;
  }));

console.log('\n— APROXIMAR ENCOLHE O QUE ENTRA —');
const semZoom = fonteDoRecorte({ largura: 2000, altura: 2000, quadro: QUADRO,
  escala: escalaDeCobertura(2000, 2000, QUADRO), x: 0, y: 0 });
const comZoom = fonteDoRecorte({ largura: 2000, altura: 2000, quadro: QUADRO,
  escala: escalaDeCobertura(2000, 2000, QUADRO) * 2, x: 0, y: 0 });
conferir('zoom 2× pega metade do lado', Math.abs(comZoom.lado - semZoom.lado / 2) < 1e-9);
conferir('e a foto quadrada inteira entra no zoom 1',
  Math.abs(semZoom.lado - 2000) < 1e-9 && Math.abs(semZoom.sx) < 1e-9);

console.log('\n— O ARQUIVO QUE SAI —');
conferir(`nunca passa de ${LADO} px`, ladoDaSaida(4000) === LADO);
conferir(`nunca fica abaixo de ${LADO_MINIMO} px`, ladoDaSaida(90) === LADO_MINIMO);
conferir('no meio, acompanha o recorte (não estica pixel que não existe)',
  ladoDaSaida(812) === 812);
conferir('é sempre inteiro', Number.isInteger(ladoDaSaida(812.4)));

console.log('\n— O QUE NEM CHEGA A ABRIR —');
const arq = (type, mb) => ({ type, size: mb * 1024 * 1024, name: 'x' });
conferir('PDF é recusado', /não é uma imagem/i.test(problemaNoArquivo(arq('application/pdf', 1))));
conferir(`acima de ${ENTRADA_MAXIMA_MB} MB é recusado`,
  /grande demais/i.test(problemaNoArquivo(arq('image/jpeg', ENTRADA_MAXIMA_MB + 1))));
conferir('no limite exato, passa', problemaNoArquivo(arq('image/jpeg', ENTRADA_MAXIMA_MB)) === null);
conferir('foto comum passa', problemaNoArquivo(arq('image/jpeg', 4)) === null);
conferir('HEIC do iPhone passa', problemaNoArquivo(arq('image/heic', 3)) === null);
/* Alguns navegadores entregam File com type vazio (arquivo sem extensão, ou
   vindo de um app que não informa). Recusar por isso seria bloquear foto boa —
   quem decide é o decodificador, logo depois. */
conferir('arquivo sem tipo declarado passa (quem decide é o decodificador)',
  problemaNoArquivo({ type: '', size: 1024, name: 'foto' }) === null);
conferir('nada escolhido não quebra', typeof problemaNoArquivo(null) === 'string');

console.log('\n— A MENSAGEM É PARA GENTE, NÃO PARA PROGRAMADOR —');
const msg = problemaNoArquivo(arq('image/jpeg', 40));
conferir('diz o tamanho da foto e o limite', /40 MB/.test(msg) && /25 MB/.test(msg));
conferir('e diz o que fazer', /câmera/i.test(msg));

console.log(falhas ? `\n${falhas} FALHA(S) em ${ok + falhas}` : `\nTudo certo — ${ok} verificações.`);
process.exit(falhas ? 1 : 0);
