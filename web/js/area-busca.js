/* =============================================================================
   Faro — área provável de busca

   Responde à pergunta que todo tutor faz na primeira hora, e que ele mesmo
   responde errado: "até onde ele pode ter ido?". A intuição diz velocidade ×
   tempo, o que dá números absurdos — um cão a 5 km/h não está a 30 km em 6
   horas. Animal perdido para, fareja, dá voltas, descansa e contorna obstáculo.

   COMO ESTE MODELO É CONSTRUÍDO, E POR QUE ASSIM

   Cada zona TERMINA num percentil publicado. O tempo só faz crescer até ele:

       R(t) = R_percentil × min(1, √(t / T_saturação))

   A raiz quadrada não é escolha estética: deslocamento em caminhada aleatória
   bidimensional cresce com a raiz do tempo, não linearmente. E o DESTINO de
   cada anel tem fonte — só o caminho até ele é modelo. Isso é dito na tela.

   O QUE NÃO ESTÁ AQUI, DE PROPÓSITO

   Nenhum raio inventado. Uma versão anterior deste trabalho tinha um terceiro
   anel de "1 km" e "3 km" que não vinham de lugar nenhum — saíram. Onde a
   literatura acaba, a tela passa a escrever uma frase em vez de desenhar um
   círculo, porque círculo grande é ruído com aparência de informação.

   E nenhum ajuste por temperamento de cão. O IAABC Foundation Journal é
   explícito: o efeito é SUSPEITADO, NÃO CONFIRMADO. Lá o temperamento muda o
   conselho a quem procura, não o raio.

   Este arquivo não conhece o DOM nem o Leaflet — roda em node, e é por isso
   que dá para testar os números, que é o que mais importa aqui.
   ============================================================================= */

export const FONTES = {
  huang: {
    curto: 'Huang 2018',
    longo: 'Huang, Coradini & Rand (2018). "Search Methods Used to Locate Missing '
         + 'Cats and Locations Where Missing Cats Are Found". Animals 8(1):5.',
    amostra: '1.210 gatos',
    elo: 'https://doi.org/10.3390/ani8010005',
  },
  lord: {
    curto: 'Lord 2007',
    longo: 'Lord et al. (2007). Estudo com tutores de cães perdidos em '
         + 'Montgomery County, Ohio.',
    amostra: '187 cães',
    elo: 'https://lostpetresearch.com/2019/03/lost-pet-statistics/',
  },
};

/* Tempo até o deslocamento estabilizar. Não é percentil, é a única parte
   modelada — e escolhida com razão declarada:
   · gato: se esconde rápido e FICA. A mediana de recuperação é de 5 dias, mas
     a distância quase não cresce depois das primeiras horas.
   · cão: mediana de recuperação de 2 dias (Lord 2007); um dia é onde o
     deslocamento já se acomodou. */
const SATURACAO_H = { gato: 12, cao: 24 };

/* Cada zona termina num número publicado. Trocar estes valores pelos nossos,
   quando a tabela `desfechos` tiver base, é editar aqui — e mais nada. */
const PERFIS = {
  gato_nao_sai: {
    rotulo: 'gato que não sai de casa',
    saturacaoH: SATURACAO_H.gato,
    zonas: [
      { m: 137, fonte: 'huang', mede: 'a distância típica de um gato que nunca sai' },
      { m: 500, fonte: 'huang', mede: '75% de todos os gatos do estudo' },
    ],
    alem: { porcento: 25, fonte: 'huang' },
  },
  gato_sai: {
    rotulo: 'gato acostumado à rua',
    saturacaoH: SATURACAO_H.gato,
    zonas: [
      { m: 500,  fonte: 'huang', mede: '75% de todos os gatos do estudo' },
      { m: 1609, fonte: 'huang', mede: '75% dos gatos com acesso à rua' },
    ],
    alem: { porcento: 25, fonte: 'huang' },
  },
  cao: {
    rotulo: 'cão',
    saturacaoH: SATURACAO_H.cao,
    zonas: [
      { m: 1609, fonte: 'lord', mede: '71% dos cães, mais os 8% que voltaram sozinhos' },
      { m: 8046, fonte: 'lord', mede: 'mais 14%, entre 1,6 e 8 km' },
    ],
    alem: { porcento: 7, fonte: 'lord' },
  },
};

/* Gato sem resposta usa a curva de quem NÃO sai — a mais apertada. Errar para
   menos manda procurar perto demais; errar para mais manda a pessoa varrer a
   cidade enquanto o gato está embaixo do carro da frente. O primeiro erro se
   conserta em meia hora de caminhada; o segundo custa o gato. */
export function perfilDe(especie, acessoRua) {
  if (especie === 'gato') return acessoRua === 'sai' ? 'gato_sai' : 'gato_nao_sai';
  return 'cao';                       // 'outro' também: é a curva mais larga
}

/* O RELÓGIO REINICIA A CADA AVISTAMENTO.

   É a regra mais importante deste arquivo, e a que nenhum estudo publicado tem
   como oferecer: eles medem "onde o pet foi achado", sem rastro pelo caminho.
   Aqui, quando alguém avista o pet, a contagem recomeça DALI — e o círculo
   encolhe para o tamanho real do problema. Um avistamento de dez minutos atrás
   transforma "pode estar em 8 km" em "pode estar em 300 m".

   `rastroDoPost` devolve ordenado do mais NOVO para o mais antigo, então o
   primeiro elemento é o ponto mais recente. Se um avistamento for registrado
   com data ANTERIOR à do sumiço — alguém que diz "vi ontem" — ele não vira o
   mais recente, e o relógio continua no ponto do tutor. É o certo.

   @param {{ocorrido_em: string}} post
   @param {Array<{ocorrido_em: string}>} rastro  do mais novo para o mais antigo
   @param {number} agora  só para teste; em produção é o relógio do aparelho
 */
export function horasDesdeUltimoPonto(post, rastro = [], agora = Date.now()) {
  const marcos = [...(rastro || []), post]
    .map((r) => Date.parse(r?.ocorrido_em))
    .filter((t) => Number.isFinite(t));
  if (!marcos.length) return 0;
  // O MAIOR carimbo é o ponto mais recente — não confia na ordem recebida.
  return Math.max(0, (agora - Math.max(...marcos)) / 3600e3);
}

/**
 * @param {object} p
 * @param {'cao'|'gato'|'outro'} p.especie
 * @param {'nao_sai'|'sai'|null} p.acessoRua
 * @param {number} p.horas  desde o ÚLTIMO ponto conhecido, não desde o sumiço
 */
export function areaDeBusca({ especie, acessoRua = null, horas = 0 }) {
  const chave = perfilDe(especie, acessoRua);
  const perfil = PERFIS[chave];

  // Zero hora não é zero metro: quem some agora já está a alguns passos.
  const t = Math.max(0.1, Number(horas) || 0);
  const fator = Math.min(1, Math.sqrt(t / perfil.saturacaoH));

  return {
    perfil: chave,
    rotulo: perfil.rotulo,
    // `cheio` diz se o modelo já chegou ao percentil publicado. Enquanto for
    // falso, o número na tela é interpolação e a tela precisa dizer isso.
    cheio: fator >= 1,
    zonas: perfil.zonas.map((z) => ({
      raio: Math.round(z.m * fator),
      limite: z.m,
      mede: z.mede,
      fonte: FONTES[z.fonte],
    })),
    alem: { ...perfil.alem, fonte: FONTES[perfil.alem.fonte] },
  };
}

/* O conselho é a metade que vale mais — para gato, vale mais que o círculo.
   Cada frase sai de um número, não de opinião. */
export function conselho(especie, acessoRua = null, temperamento = null) {
  if (especie === 'gato') {
    return {
      titulo: 'Gato perdido fica imóvel, não correndo',
      linhas: [
        '**Comece dentro da sua própria casa.** 4% dos gatos estão lá o tempo todo — atrás de um móvel, no forro, num armário que ninguém abriu.',
        'Depois o quintal dos vizinhos (20%) e a sua própria porta (19%): muitos só esperam ali. Olhe embaixo de varanda e deck (10%) e no mato (16%).',
        'Peça ao vizinho para abrir a **garagem** — é onde estão 28% dos gatos que entram em casa alheia.',
        'Procure com lanterna, de madrugada e em silêncio. Chamar alto costuma fazer o gato assustado se enterrar mais fundo no esconderijo.',
        'Se ele aparece mas não deixa pegar, **armadilha humanitária** foi o método isolado mais eficaz do estudo (63% de sucesso) — e só 20% das pessoas tentaram.',
      ],
      fonte: FONTES.huang,
    };
  }

  return {
    titulo: 'Cão anda, e volta a lugares conhecidos',
    linhas: [
      'Ande o percurso de sempre, chamando com a voz de todo dia. Leve algo que faça barulho familiar — a coleira, o pote, o saco de ração.',
      'Deixe do lado de fora de casa algo com o cheiro dele e o seu: a caminha, uma peça de roupa sua. Muitos voltam sozinhos ao ponto de partida.',
      '**Cartaz no bairro** foi o terceiro meio mais eficaz de recuperação no estudo, e aumentou a chance de o cão voltar.',
      'Avise clínicas veterinárias e o canil municipal: contato com esse tipo de lugar foi o meio **mais** comum de reencontro (34,8%).',
      temperamento === 'medroso'
        ? '**Se ele é medroso, não corra atrás e não grite o nome.** Cão em fuga foge de quem persegue. Sente-se de lado, evite encará-lo e ponha comida no chão à sua frente.'
        : 'Se ele fugir de você, não persiga: sente-se, evite encará-lo e ofereça comida. Correr atrás faz o cão correr mais.',
    ],
    fonte: FONTES.lord,
  };
}
