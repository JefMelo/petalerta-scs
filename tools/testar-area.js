#!/usr/bin/env node
/* =============================================================================
   Faro — prova os números da área de busca

       node tools/testar-area.js

   POR QUE ESTE TESTE EXISTE
   Um raio errado não quebra nada: desenha um círculo bonito e manda alguém
   procurar no lugar errado, em silêncio. É o tipo de defeito que só se percebe
   quando já custou um animal.

   Então aqui não se confere se "parece razoável". Confere-se que cada zona
   termina EXATAMENTE no percentil publicado, e que as propriedades que fazem o
   modelo ser um modelo — crescer com o tempo, saturar, ordenar as espécies —
   continuam valendo.
   ============================================================================= */

import { areaDeBusca, perfilDe, conselho, FONTES,
         horasDesdeUltimoPonto } from '../web/js/area-busca.js';

let ok = 0, falhas = 0;
const conferir = (nome, condicao, detalhe = '') => {
  if (condicao) { ok++; console.log(`  ok      ${nome}`); }
  else { falhas++; console.log(`  FALHOU  ${nome}${detalhe ? `\n            → ${detalhe}` : ''}`); }
};

const raios = (especie, acessoRua, horas) =>
  areaDeBusca({ especie, acessoRua, horas }).zonas.map((z) => z.raio);

console.log('— CADA ZONA TERMINA NUM NÚMERO PUBLICADO —');
/* Com o tempo saturado, o raio TEM de ser o percentil, sem arredondamento
   criativo. Se um destes mudar, ou a fonte mudou ou alguém inventou. */
const esperado = [
  ['gato que não sai', 'gato', 'nao_sai', 48, [137, 500],   'Huang 2018'],
  ['gato que sai',     'gato', 'sai',     48, [500, 1609],  'Huang 2018'],
  ['cão',              'cao',  null,      96, [1609, 8046], 'Lord 2007'],
  ['"outro" usa a curva do cão', 'outro', null, 96, [1609, 8046], 'Lord 2007'],
];
for (const [nome, especie, acesso, h, alvo, fonte] of esperado) {
  const r = raios(especie, acesso, h);
  conferir(`${nome}: ${alvo.join(' / ')} m`, JSON.stringify(r) === JSON.stringify(alvo), `deu ${r.join(' / ')}`);
  const a = areaDeBusca({ especie, acessoRua: acesso, horas: h });
  conferir(`  └ e cita ${fonte}`, a.zonas.every((z) => z.fonte.curto === fonte));
}

console.log('\n— CRESCE COM O TEMPO, E PARA DE CRESCER —');
const cao2 = raios('cao', null, 2), cao8 = raios('cao', null, 8), cao24 = raios('cao', null, 24);
conferir('2 h < 8 h < 24 h', cao2[0] < cao8[0] && cao8[0] < cao24[0], `${cao2[0]} / ${cao8[0]} / ${cao24[0]}`);
conferir('satura em 24 h e não passa disso',
  JSON.stringify(raios('cao', null, 24)) === JSON.stringify(raios('cao', null, 240)));
conferir('e o modelo AVISA quando saturou',
  areaDeBusca({ especie: 'cao', horas: 24 }).cheio === true &&
  areaDeBusca({ especie: 'cao', horas: 2 }).cheio === false);

console.log('\n— A RAIZ QUADRADA, NÃO A RETA —');
/* Se alguém trocar por crescimento linear, este teste cai: em 1/4 do tempo de
   saturação o raio tem de ser METADE, não um quarto. */
const meio = raios('cao', null, 24 / 4)[0];
conferir('em 1/4 do tempo, metade do raio', Math.abs(meio - 1609 / 2) <= 1, `deu ${meio}, esperado ~805`);

console.log('\n— A PRIMEIRA HORA É CAMINHÁVEL —');
/* O anel interno serve para alguém sair a pé AGORA. Se às 2 h já mandar
   caminhar 1,6 km de raio, ninguém faz — e a ferramenta não serve. */
conferir('cão às 2 h: anel interno abaixo de 700 m', cao2[0] < 700, `deu ${cao2[0]} m`);
const gato2 = raios('gato', 'nao_sai', 2);
conferir('gato de dentro às 2 h: abaixo de 80 m', gato2[0] < 80, `deu ${gato2[0]} m`);

console.log('\n— A ORDEM ENTRE OS PERFIS —');
for (const h of [1, 6, 24, 72]) {
  const dentro = raios('gato', 'nao_sai', h)[1];
  const rua    = raios('gato', 'sai', h)[1];
  const cao    = raios('cao', null, h)[1];
  conferir(`às ${h} h: gato de dentro < gato de rua < cão`, dentro < rua && rua < cao,
    `${dentro} / ${rua} / ${cao}`);
}

console.log('\n— ZONAS CRESCENTES E BORDAS —');
for (const [e, a] of [['gato', 'nao_sai'], ['gato', 'sai'], ['cao', null]]) {
  for (const h of [0, 0.5, 3, 12, 48]) {
    const r = raios(e, a, h);
    conferir(`${e}/${a} às ${h} h: zona 1 < zona 2`, r[0] < r[1], r.join(' / '));
  }
}
conferir('hora zero não vira raio zero', raios('cao', null, 0)[0] > 0);
conferir('hora negativa não quebra', raios('cao', null, -5)[0] > 0);
conferir('hora absurda satura', JSON.stringify(raios('cao', null, 1e9)) === JSON.stringify([1609, 8046]));

console.log('\n— O QUE FICA FORA DO MAPA —');
const a = areaDeBusca({ especie: 'cao', horas: 48 });
conferir('cão: 7% ficam além da última zona', a.alem.porcento === 7);
conferir('gato: 25% ficam além', areaDeBusca({ especie: 'gato', horas: 48 }).alem.porcento === 25);

console.log('\n— SEM RESPOSTA, A CURVA MAIS APERTADA —');
/* Errar para menos manda procurar perto demais — meia hora de caminhada.
   Errar para mais manda varrer a cidade com o gato embaixo do carro da frente. */
conferir('gato sem resposta = gato que não sai', perfilDe('gato', null) === 'gato_nao_sai');
conferir('e é mesmo o menor', raios('gato', null, 24)[1] < raios('gato', 'sai', 24)[1]);

console.log('\n— O RELÓGIO REINICIA A CADA AVISTAMENTO —');
/* A regra que o fundador enunciou, e a que nenhum estudo publicado oferece:
   cada avistamento recomeça a contagem, e o círculo encolhe com ela. */
const AGORA = Date.parse('2026-09-14T12:00:00Z');
const em = (h) => ({ ocorrido_em: new Date(AGORA - h * 3600e3).toISOString() });

const sumiu = em(24);
conferir('sem avistamento, conta desde o sumiço',
  horasDesdeUltimoPonto(sumiu, [], AGORA) === 24);

/* rastro vem do mais NOVO para o mais antigo (é o que rastroDoPost devolve). */
const comAvistamento = [em(1), sumiu];
conferir('com avistamento de 1 h, a conta vira 1 h',
  horasDesdeUltimoPonto(sumiu, comAvistamento, AGORA) === 1);

const r24 = areaDeBusca({ especie: 'cao', horas: horasDesdeUltimoPonto(sumiu, [], AGORA) });
const r1  = areaDeBusca({ especie: 'cao', horas: horasDesdeUltimoPonto(sumiu, comAvistamento, AGORA) });
conferir('e o CÍRCULO encolhe junto',
  r1.zonas[0].raio < r24.zonas[0].raio,
  `${r24.zonas[0].raio} m sem avistamento → ${r1.zonas[0].raio} m com`);
conferir('  └ encolhe muito: de 1.609 m para menos de 400 m',
  r24.zonas[0].raio === 1609 && r1.zonas[0].raio < 400, `${r24.zonas[0].raio} → ${r1.zonas[0].raio}`);

/* Dois avistamentos: vale o mais recente, não o primeiro que chegou. */
conferir('vários avistamentos: vale o mais recente',
  horasDesdeUltimoPonto(sumiu, [em(2), em(9), sumiu], AGORA) === 2);

/* Alguém que registra "eu vi ONTEM" num caso de hoje não pode fazer o relógio
   ANDAR PARA TRÁS e inflar o círculo. */
conferir('avistamento mais ANTIGO que o sumiço não reinicia nada',
  horasDesdeUltimoPonto(em(3), [em(30), em(3)], AGORA) === 3, 'o relógio andou para trás');

/* E a ordem recebida não é fé: se um dia a consulta devolver em outra ordem,
   a conta tem de continuar certa. */
conferir('ordem trocada no rastro não muda o resultado',
  horasDesdeUltimoPonto(sumiu, [sumiu, em(2)], AGORA) === 2);

conferir('data futura não vira hora negativa',
  horasDesdeUltimoPonto(em(-5), [], AGORA) === 0);
conferir('rastro vazio ou nulo não quebra',
  horasDesdeUltimoPonto(sumiu, null, AGORA) === 24 && horasDesdeUltimoPonto(sumiu, [], AGORA) === 24);

console.log('\n— O CONSELHO CITA A FONTE —');
conferir('gato cita Huang', conselho('gato').fonte.curto === 'Huang 2018');
conferir('cão cita Lord', conselho('cao').fonte.curto === 'Lord 2007');
conferir('cão medroso ganha a linha de não perseguir',
  conselho('cao', null, 'medroso').linhas.some((l) => /não corra atrás/.test(l)));
conferir('toda fonte tem elo e amostra',
  Object.values(FONTES).every((f) => f.elo?.startsWith('https://') && f.amostra));

console.log(falhas ? `\n${falhas} FALHA(S) em ${ok + falhas}` : `\nTudo certo — ${ok} verificações.`);
process.exit(falhas ? 1 : 0);
