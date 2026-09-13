/* =============================================================================
   Camada de dados — ADAPTADOR
   Hoje: dados falsos em memória, para desenhar e testar sem banco.
   Depois: trocar só o corpo destas funções por chamadas ao Supabase.
   As assinaturas e o formato de retorno são idênticos aos das funções SQL
   em supabase/schema-01.sql, de propósito.
   ============================================================================= */

const AGORA = Date.now();
const h = (n) => new Date(AGORA - n * 3600e3).toISOString();

// Onde o usuário está (Centro de Santa Cruz do Sul). Depois vem do GPS.
export const ORIGEM = { lat: -29.7182, lng: -52.4306 };

const foto = (id) => `https://placedog.net/640/480?id=${id}`;
const gato = (n) => `https://cataas.com/cat?width=640&height=480&t=${n}`;

const POSTS = [
  {
    id: 'p1', tipo: 'perdido', status: 'aberto',
    titulo: 'Thor', especie: 'cao', raca: 'Vira-lata caramelo', cor: 'Caramelo',
    porte: 'medio', sexo: 'macho', castrado: true,
    sinais: 'Coleira azul com plaquinha. Tem uma falha de pelo na orelha esquerda.',
    texto: 'Fugiu quando o portão ficou aberto na hora da entrega do gás. Ele é medroso, corre se chamarem alto — se vir, por favor não persiga, só me avise onde.',
    endereco: 'R. Marechal Floriano, 900 · Centro',
    lat: -29.7205, lng: -52.4288, ocorrido_em: h(2),
    autor_nome: 'Jeferson M.', fotos: [foto(12)],
  },
  {
    id: 'p2', tipo: 'avistado', status: 'aberto',
    titulo: 'Cão preto, porte médio', especie: 'cao', raca: 'Sem raça definida', cor: 'Preto',
    porte: 'medio', sexo: 'desconhecido',
    texto: 'Estava parado no canteiro central, bem assustado. Sem coleira. Tentei chegar perto e ele saiu andando pro lado da rodoviária.',
    endereco: 'Av. Independência, altura do 1500',
    lat: -29.7118, lng: -52.4359, ocorrido_em: h(0.7),
    autor_nome: 'Carla T.', fotos: [foto(37)],
  },
  {
    id: 'p3', tipo: 'perdido', status: 'aberto',
    titulo: 'Mel', especie: 'gato', raca: 'SRD', cor: 'Tricolor',
    porte: 'pequeno', sexo: 'femea', castrado: true,
    sinais: 'Rabo curto e grosso. Falta um pedacinho da orelha direita.',
    texto: 'Saiu pela janela do banheiro na terça à noite. Nunca tinha saído de casa. Ela atende por "Melzinha" e é muito arisca com desconhecido.',
    endereco: 'R. Borges de Medeiros · Higienópolis',
    lat: -29.7062, lng: -52.4201, ocorrido_em: h(74),
    autor_nome: 'Ana S.', fotos: [gato(1)],
  },
  {
    id: 'p4', tipo: 'encontrado', status: 'aberto',
    titulo: 'Cadela branca com manchas', especie: 'cao', raca: 'SRD', cor: 'Branco e marrom',
    porte: 'pequeno', sexo: 'femea',
    texto: 'Está comigo em casa, segura e alimentada. Muito dócil, claramente tem dono. Só devolvo para quem descrever a coleira certinho.',
    endereco: 'R. Ramiro Barcelos · Bairro Avenida',
    lat: -29.7266, lng: -52.4245, ocorrido_em: h(19),
    autor_nome: 'Paulo R.', fotos: [foto(58)],
  },
  {
    id: 'p5', tipo: 'adocao', status: 'aberto',
    titulo: 'Nina', especie: 'gato', raca: 'SRD', cor: 'Preta',
    porte: 'pequeno', sexo: 'femea', castrado: false,
    texto: 'Resgatada do pátio da escola com mais três irmãos. Vermifugada e já usando caixinha. Entrego com termo de adoção responsável.',
    endereco: 'Bairro Universitário',
    lat: -29.7014, lng: -52.4443, ocorrido_em: h(50),
    autor_nome: 'Ana S.', fotos: [gato(2)],
  },
  {
    id: 'p6', tipo: 'adocao', status: 'aberto',
    titulo: 'Simba', especie: 'cao', raca: 'SRD', cor: 'Caramelo',
    porte: 'grande', sexo: 'macho', castrado: true,
    texto: 'Um ano, castrado, vacinado e bom com criança. Precisa de pátio — é elétrico e adora correr.',
    endereco: 'R. Gaspar Bartholomay · Santo Inácio',
    lat: -29.7325, lng: -52.4512, ocorrido_em: h(120),
    autor_nome: 'Paulo R.', fotos: [foto(91)],
  },
];

// Avistamentos ligados a um perdido: é o rastro. post_origem_id no banco.
const AVISTAMENTOS = [
  { id: 'a1', origem: 'p1', endereco: 'Praça da Bandeira, canteiro dos fundos',
    lat: -29.7189, lng: -52.4271, ocorrido_em: h(1.6), autor_nome: 'Marta L.',
    texto: 'Passou correndo em direção à praça, coleira azul batendo. Não parou quando chamei.' },
  { id: 'a2', origem: 'p1', endereco: 'R. Venâncio Aires, perto da padaria',
    lat: -29.7167, lng: -52.4243, ocorrido_em: h(0.9), autor_nome: 'Diego F.',
    texto: 'Estava bebendo água numa poça. Deixei ração no chão e ele comeu, mas não deixou chegar perto.' },
  { id: 'a3', origem: 'p1', endereco: 'R. Tenente Coronel Brito',
    lat: -29.7151, lng: -52.4219, ocorrido_em: h(0.3), autor_nome: 'Renata K.',
    texto: 'Vi agora há pouco descendo a rua sozinho, indo pro lado do arroio.' },
];

// --- utilidades que imitam o PostGIS ------------------------------------------

function distanciaM(a, b) {                       // equivale a ST_Distance
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// --- API ----------------------------------------------------------------------

/** Espelha feed_por_raio(). Ordena por urgência: perto e recente primeiro. */
export async function feedPorRaio({ lat, lng, raioM = 3000, tipos = null } = {}) {
  const origem = { lat, lng };
  return POSTS
    .filter((p) => p.status === 'aberto')
    .filter((p) => !tipos || tipos.includes(p.tipo))
    .map((p) => ({
      ...p,
      distancia_m: distanciaM(origem, p),
      n_avistados: AVISTAMENTOS.filter((a) => a.origem === p.id).length,
      n_comentarios: 0,
    }))
    .filter((p) => p.distancia_m <= raioM)
    .sort((a, b) => {
      const idade = (p) => 1 + (AGORA - Date.parse(p.ocorrido_em)) / 86400e3;
      return a.distancia_m * idade(a) - b.distancia_m * idade(b);
    });
}

export async function postPorId(id) {
  return POSTS.find((p) => p.id === id) || null;
}

/** Espelha rastro_do_post(): o post original + todos os avistamentos, em ordem. */
export async function rastroDoPost(id) {
  const base = POSTS.find((p) => p.id === id);
  if (!base) return [];
  const pontos = [
    { id: base.id, lat: base.lat, lng: base.lng, endereco: base.endereco,
      ocorrido_em: base.ocorrido_em, texto: 'Visto pela última vez pelo tutor.',
      autor_nome: base.autor_nome, ehOrigem: true },
    ...AVISTAMENTOS.filter((a) => a.origem === id),
  ];
  return pontos.sort((a, b) => Date.parse(b.ocorrido_em) - Date.parse(a.ocorrido_em));
}

/** Espelha contato_do_post(): telefone só para quem está logado. */
export async function contatoDoPost(id) {
  if (!estaLogado()) throw new Error('Entre na sua conta para ver o contato do tutor.');
  return '51999990000';
}

// Sessão de mentira enquanto não há Supabase Auth.
let logado = false;
export const estaLogado = () => logado;
export const entrarDeMentira = () => { logado = true; };
