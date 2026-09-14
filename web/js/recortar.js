/* =============================================================================
   Faro — recortar a foto antes de publicar

   POR QUE ISTO EXISTE

   Até aqui o app aceitava a foto como ela vinha e o CSS resolvia o resto:
   `aspect-ratio: 1/1` mais `object-fit: cover`. O feed PARECIA certo, e estava
   errado por baixo — quem escolhia o recorte era o navegador, cortando pelo
   centro. Uma foto na vertical, que é como todo mundo fotografa o próprio
   cachorro, perdia a cabeça do animal ou as patas. Justamente o que identifica.

   Agora quem enquadra é a pessoa, e o que sobe já é o que se vê: um quadrado.
   Três coisas de uma vez:

   · O FEED FICA PAREJO. Todo card tem a mesma altura, e rolar deixa de ter
     solavanco. É a razão de o Instagram ter feito isto em 2010.
   · O ARQUIVO FICA PEQUENO. Sai sempre em JPEG de no máximo 1080 px de lado.
     Uma foto de celular moderno tem 4 MB; esta sai perto de 200 KB. Quem
     publica um caso está na rua, com pressa e com sinal ruim — cada megabyte
     é tempo com o celular na mão em vez de procurando.
   · A CABEÇA DO PET APARECE. Que é o ponto inteiro de ter foto.

   O QUE ESTE ARQUIVO NÃO FAZ, DE PROPÓSITO
   Não gira, não filtra, não ajusta brilho. Isso é trabalho de editor de foto, e
   quem acabou de perder um cão não vai usar. Arrastar e aproximar, e pronto.

   A CONTA fica separada da tela (`fonteDoRecorte`, `limiteDoArraste`) para ser
   provável em node, sem navegador: `node tools/testar-recorte.js`.
   ============================================================================= */

/* 1080 é o lado que o Instagram usa e o que a tela de um celular bom mostra sem
   ampliar. Acima disso é peso que ninguém vê. */
export const LADO = 1080;

/* Piso de resolução: quem aproxima muito recorta um pedacinho da foto original.
   Esticar 200 px para 1080 não inventa detalhe nenhum, só peso — então a saída
   acompanha o recorte, respeitando este mínimo para não virar tarja borrada. */
export const LADO_MINIMO = 640;

/* Teto do arquivo de ENTRADA. Não é economia: é o app não morrer. Decodificar
   uma foto de 40 MP num celular antigo estoura a memória da aba, e o que a
   pessoa vê é o app fechando sozinho no meio da publicação. */
export const ENTRADA_MAXIMA_MB = 25;

export const ZOOM_MAXIMO = 4;

/* Escala que faz a foto COBRIR o quadro sem sobrar buraco: o menor lado da
   imagem é o que tem de caber. Daí para cima é aproximação. */
export function escalaDeCobertura(largura, altura, quadro) {
  return quadro / Math.min(largura, altura);
}

/* Até onde o arraste pode ir sem descobrir o quadro. Se a imagem é exatamente
   do tamanho do quadro naquele eixo, não há folga nenhuma — e o valor é zero,
   não um número negativo que deixaria a foto escapar. */
export function limiteDoArraste(largura, altura, quadro, escala) {
  return {
    x: Math.max(0, (largura * escala - quadro) / 2),
    y: Math.max(0, (altura * escala - quadro) / 2),
  };
}

export const travar = (v, limite) => Math.min(limite, Math.max(-limite, v));

/* O quadrado da imagem ORIGINAL que está aparecendo dentro do quadro.
   É o que o canvas desenha, e o que prova que o recorte nunca inclui vazio:
   com o arraste travado, `sx` e `sy` nunca ficam negativos nem passam da borda.

   Um ponto p da imagem aparece na tela em (p - meio) * escala + meio do quadro
   + deslocamento. Igualando a zero sai o canto de cima à esquerda. */
export function fonteDoRecorte({ largura, altura, quadro, escala, x, y }) {
  const lado = quadro / escala;
  return {
    sx: largura / 2 - (quadro / 2 + x) / escala,
    sy: altura / 2 - (quadro / 2 + y) / escala,
    lado,
  };
}

/* O lado do arquivo que sai. Acompanha o recorte para não esticar pixel que
   não existe, mas nunca abaixo do piso nem acima do teto. */
export function ladoDaSaida(ladoDaFonte) {
  return Math.round(Math.max(LADO_MINIMO, Math.min(LADO, ladoDaFonte)));
}

/* Antes de abrir qualquer tela. Devolve a frase que a pessoa vai ler — não um
   código de erro, porque quem vai ler é alguém com o cão na rua. */
export function problemaNoArquivo(arquivo) {
  if (!arquivo) return 'Nenhuma imagem escolhida.';
  if (arquivo.type && !arquivo.type.startsWith('image/')) {
    return 'Isso não é uma imagem. Escolha uma foto do seu celular.';
  }
  if (arquivo.size > ENTRADA_MAXIMA_MB * 1024 * 1024) {
    const mb = (arquivo.size / 1024 / 1024).toFixed(0);
    return `Essa imagem tem ${mb} MB e é grande demais para o celular abrir `
         + `(o limite é ${ENTRADA_MAXIMA_MB} MB). Tire a foto pelo próprio app da câmera.`;
  }
  return null;
}

// --- a tela -------------------------------------------------------------------

const $ = (s, r = document) => r.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ic = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

/* Carrega pelo <img>, não por createImageBitmap: é o mesmo elemento que a tela
   já precisa mostrar, e aceita HEIC do iPhone em todo navegador que saiba
   exibir HEIC — que é o formato que sai da câmera de metade dos aparelhos. */
function carregarImagem(url) {
  return new Promise((ok, erro) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => erro(new Error('imagem ilegível'));
    img.decoding = 'sync';
    img.src = url;
  });
}

/**
 * Abre a tela de recorte e devolve um File quadrado, ou null se a pessoa
 * desistir. Nunca lança: problema de arquivo vira recado na própria tela.
 *
 * @param {File} arquivo
 * @param {{rotulo?: string}} opcoes  rotulo = "Foto 2 de 3", quando há várias
 * @returns {Promise<File|null>}
 */
export function recortar(arquivo, { rotulo = '' } = {}) {
  return new Promise((resolver) => {
    const caixa = document.createElement('div');
    caixa.className = 'recorte';
    caixa.setAttribute('role', 'dialog');
    caixa.setAttribute('aria-modal', 'true');
    caixa.setAttribute('aria-label', 'Ajustar a foto');

    const controle = new AbortController();
    const { signal } = controle;
    let url = '';

    let olho = null;                    // ResizeObserver, quando a imagem carregar

    const encerrar = (valor) => {
      controle.abort();
      olho?.disconnect();
      if (url) URL.revokeObjectURL(url);
      caixa.remove();
      resolver(valor);
    };

    const recado = (texto) => {
      caixa.innerHTML = `
        <div class="recorte__aviso">
          <p>${esc(texto)}</p>
          <button class="recorte__sair" type="button" data-fechar>Escolher outra</button>
        </div>`;
      $('[data-fechar]', caixa).addEventListener('click', () => encerrar(null), { signal });
    };

    const problema = problemaNoArquivo(arquivo);
    document.body.appendChild(caixa);
    if (problema) { recado(problema); return; }

    caixa.innerHTML = `
      <div class="recorte__topo">
        <button class="recorte__texto" type="button" data-cancelar>Cancelar</button>
        <h2 class="recorte__nome">${rotulo ? esc(rotulo) : 'Ajuste a foto'}</h2>
        <button class="recorte__texto recorte__texto--forte" type="button" data-usar>Usar</button>
      </div>
      <div class="recorte__palco" data-palco>
        <img data-img alt="" draggable="false">
        <div class="recorte__grade" aria-hidden="true"></div>
      </div>
      <div class="recorte__baixo">
        <label class="recorte__zoom">
          ${ic('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>')}
          <input type="range" data-zoom min="1" max="${ZOOM_MAXIMO}" step="0.01" value="1"
                 aria-label="Aproximar a foto">
        </label>
        <p class="recorte__dica">Arraste para enquadrar e aproxime se precisar.
          Toda foto do Faro é quadrada — assim o feed fica parelho e a foto
          sobe rápido mesmo com sinal ruim.</p>
      </div>`;

    const palco = $('[data-palco]', caixa);
    const img = $('[data-img]', caixa);
    const zoom = $('[data-zoom]', caixa);

    url = URL.createObjectURL(arquivo);

    let L = 0, A = 0;              // tamanho natural da imagem
    let quadro = 0;                // lado do palco, em pixels de tela
    let escalaBase = 1, ampliacao = 1;
    let x = 0, y = 0;

    const escala = () => escalaBase * ampliacao;

    function desenhar() {
      const s = escala();
      const lim = limiteDoArraste(L, A, quadro, s);
      x = travar(x, lim.x);
      y = travar(y, lim.y);
      img.style.width = `${L}px`;
      img.style.height = `${A}px`;
      img.style.transform =
        `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(${s})`;
    }

    /* O palco muda de tamanho quando o teclado do celular sobe ou a tela gira.
       A conta é refeita em cima do MESMO enquadramento relativo, senão a foto
       salta para outro lugar debaixo da mão de quem estava arrastando. */
    function medir() {
      const novo = palco.getBoundingClientRect().width;
      if (!novo) return;
      const razao = quadro ? novo / quadro : 1;
      quadro = novo;
      escalaBase = escalaDeCobertura(L, A, quadro);
      x *= razao; y *= razao;
      desenhar();
    }

    carregarImagem(url).then((carregada) => {
      L = carregada.naturalWidth;
      A = carregada.naturalHeight;
      if (!L || !A) throw new Error('imagem sem tamanho');
      img.src = url;
      medir();
      olho = new ResizeObserver(medir);
      olho.observe(palco);
    }).catch(() => {
      recado('Não consegui abrir essa imagem. Tente escolher outra foto.');
    });

    // --- arrastar e aproximar ---------------------------------------------------

    /* Pointer Events cobrem dedo, caneta e mouse com um código só. O mapa de
       ponteiros ativos é o que permite a pinça: com dois dedos na tela, o que
       manda é a distância entre eles, não o movimento de cada um. */
    const dedos = new Map();
    let arrastando = null;
    let pincaAnterior = 0;

    const distancia = () => {
      const [a, b] = [...dedos.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    palco.addEventListener('pointerdown', (ev) => {
      palco.setPointerCapture(ev.pointerId);
      dedos.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (dedos.size === 1) arrastando = { x: ev.clientX, y: ev.clientY };
      if (dedos.size === 2) { arrastando = null; pincaAnterior = distancia(); }
    }, { signal });

    palco.addEventListener('pointermove', (ev) => {
      if (!dedos.has(ev.pointerId)) return;
      dedos.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

      if (dedos.size === 2 && pincaAnterior > 0) {
        const agora = distancia();
        aplicarZoom(ampliacao * (agora / pincaAnterior));
        pincaAnterior = agora;
        return;
      }
      if (!arrastando) return;
      x += ev.clientX - arrastando.x;
      y += ev.clientY - arrastando.y;
      arrastando = { x: ev.clientX, y: ev.clientY };
      desenhar();
    }, { signal });

    const soltar = (ev) => {
      dedos.delete(ev.pointerId);
      if (dedos.size < 2) pincaAnterior = 0;
      if (dedos.size === 1) {
        const [p] = [...dedos.values()];
        arrastando = { x: p.x, y: p.y };       // continua com o dedo que ficou
      }
      if (dedos.size === 0) arrastando = null;
    };
    palco.addEventListener('pointerup', soltar, { signal });
    palco.addEventListener('pointercancel', soltar, { signal });

    function aplicarZoom(valor) {
      ampliacao = Math.min(ZOOM_MAXIMO, Math.max(1, valor));
      zoom.value = String(ampliacao);
      desenhar();
    }

    zoom.addEventListener('input', () => aplicarZoom(+zoom.value), { signal });
    palco.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      aplicarZoom(ampliacao * (ev.deltaY > 0 ? 0.92 : 1.08));
    }, { signal, passive: false });

    // --- sair -------------------------------------------------------------------

    $('[data-cancelar]', caixa).addEventListener('click', () => encerrar(null), { signal });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') encerrar(null);
    }, { signal });

    $('[data-usar]', caixa).addEventListener('click', async (ev) => {
      const b = ev.currentTarget;
      b.disabled = true; b.textContent = 'Cortando…';
      try {
        encerrar(await gerar());
      } catch {
        b.disabled = false; b.textContent = 'Usar';
        recado('Não consegui cortar essa imagem. Tente escolher outra foto.');
      }
    }, { signal });

    async function gerar() {
      const { sx, sy, lado } = fonteDoRecorte({
        largura: L, altura: A, quadro, escala: escala(), x, y,
      });
      const saida = ladoDaSaida(lado);

      const tela = document.createElement('canvas');
      tela.width = saida; tela.height = saida;
      const ctx = tela.getContext('2d');
      /* Fundo branco por baixo: PNG e HEIC com transparência virariam manchas
         pretas ao salvar em JPEG, que não tem canal de transparência. */
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, saida, saida);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, lado, lado, 0, 0, saida, saida);

      const blob = await new Promise((ok) => tela.toBlob(ok, 'image/jpeg', 0.85));
      if (!blob) throw new Error('canvas vazio');
      const nome = (arquivo.name || 'foto').replace(/\.[^.]+$/, '');
      return new File([blob], `${nome}.jpg`, { type: 'image/jpeg' });
    }
  });
}

/**
 * Recorta uma fila de arquivos, um de cada vez, e devolve só os aprovados.
 * Quem cancela um não perde os anteriores.
 */
export async function recortarVarias(arquivos) {
  const prontas = [];
  const total = arquivos.length;
  for (let i = 0; i < total; i++) {
    const pronta = await recortar(arquivos[i], {
      rotulo: total > 1 ? `Foto ${i + 1} de ${total}` : '',
    });
    if (pronta) prontas.push(pronta);
  }
  return prontas;
}
