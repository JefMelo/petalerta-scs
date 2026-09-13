# Faro — pets perdidos em Santa Cruz do Sul

Reescrita do protótipo Streamlit `petalerta-scs` como web app (PWA) com feed local.

> **Identidade.** O logo vive em `web/img/`: `faro-marca.png` (o pino), 
> `faro-texto.png` (o wordmark) e `faro.png` (os dois). As cores saíram dele:
> âmbar `#DD8C18` e escuro `#15171C`. Para texto, o âmbar escurecido `#A66912`,
> que é o mais claro que ainda passa AA no branco.
>
> O projeto Cloudflare e o repositório ainda se chamam `petalerta-scs` — trocar
> muda a URL de produção, então fica para quando houver domínio próprio.

## Isolamento de projetos — regra do fundador

Este app **não compartilha nada** com o VadeOn:

| Recurso | VadeOn | Faro |
|---|---|---|
| Conta Supabase | outra conta | conta própria, com **1 único projeto** |
| Projeto Supabase | o existente | `Faro` · ref `sxnyeokxkczrcdnsanbu` · us-east-1 |
| Projeto Cloudflare | o existente | **um projeto Pages novo** — a criar |
| Repositório | — | `JefMelo/petalerta-scs` |
| Pasta local | `~/Desktop/Claude/LexFlow` | `~/Desktop/Claude/PetAlerta` |

A conta do Supabase usada aqui tem **um projeto só** — o VadeOn está em outra conta.
O isolamento é estrutural, não depende de cuidado manual.

Segredos ficam em `~/.config/farejo/` — nome antigo do projeto, mantido para não quebrar os scripts locais — (fora do repositório): `supabase-token`,
`service_role.key`, `anon.key`. A chave **anon** também vive em `web/js/config.js`,
o que é correto: ela é pública por design e quem protege os dados é o RLS.
A **service_role nunca** pode ir para `web/`.

## Estrutura

```
supabase/schema-0*.sql   migrations, em ordem
web/index.html           casca do app
web/css/app.css          folha única, tokens no :root
web/js/config.js         URL + chave anon do Supabase
web/js/dados.js          acesso ao Supabase (RPC, PostgREST, auth, storage)
web/js/formularios.js    folhas de conta, publicar, avistar e raio
web/js/mapa.js           mapa dos pets procurados
web/js/perfil.js         perfil próprio e dos outros
worker.js                Worker: roteia /c/<id>, o resto vai para os assets
wrangler.jsonc           configuração do Cloudflare
src/compartilhar.js      monta o HTML com as meta tags og:
web/js/app.js            feed, detalhe, rastro, mapa
legado/app.py            o protótipo Streamlit, guardado para consulta
legado/dados-falso.js    o adaptador de dados em memória, guardado para consulta
assets/                  logo e banner antigos (fora de escopo por ora)
```

## Direção visual

Um **feed**, não um painel. As decisões que tiram a cara de "app gerado":

- Sem card flutuante com sombra. Foto sangrando de ponta a ponta e um fio de 1px
  separando os posts, como o Instagram. Coluna de 470px no desktop.
- **Uma pessoa no topo de cada post** (avatar de iniciais, nome, endereço). É isso
  que humaniza; antes o topo era uma etiqueta e dois números.
- **Uma família tipográfica só** (Archivo). Duas fontes mais uma mono para os
  números era o que dava aparência de dashboard.
- Ações em linha de ícones, sem botão preenchido. Sem curtida e sem comentário —
  as ações são "Vi esse pet", "Falar" e compartilhar.
- Texto por extenso: "há 2 horas", "310 m de você", "3 pessoas viram o Thor",
  "Como o Thor é", "Por onde o Thor passou". Nada de `FICHA` em caixa alta.
- Contraste conferido na tela: os 8 pares reais passam WCAG AA.

## Migrations aplicadas

| Arquivo | O que faz |
|---|---|
| `schema-01.sql` | base: PostGIS em `extensions`, 7 tabelas, RLS, storage, 5 funções |
| `schema-02.sql` | corrige leitura de perfis (RLS de linha → privilégio de coluna) |
| `schema-03.sql` | avistamento ligado a um caso sai do feed e vive no rastro |
| `schema-04.sql` | `sexo`/`castrado`/`sinais` passam para `posts` (avistamento não tem pet) |
| `schema-05.sql` | `sexo` e `porte` entram no retorno de `feed_por_raio` (a legenda precisa) |
| `schema-06.sql` | `criar_post` e `criar_avistamento`: o `autor_id` sai de `auth.uid()` no servidor |
| `schema-07.sql` | `mapa_perdidos`: um ponto por caso, na **última** localização conhecida |
| `schema-08.sql` | perfil: `perfil_publico`, `posts_do_perfil`, `editar_post`, `apagar_post`, `reabrir_post` |
| `schema-09.sql` | nova ordem do feed: nota de urgência contínua, com última atividade |
| `schema-10.sql` | farejadores (pessoas distintas ajudando) e `minhas_novidades` |
| `seed-teste.sql` | 6 casos + 3 avistamentos + 3 usuários `@teste.farejo.local` |

## Rodar

```bash
python3 -m http.server 8510 --directory ~/Desktop/Claude/PetAlerta
```

Abrir <http://localhost:8510/web/>. Lê do Supabase de verdade.
O adaptador de dados falsos ficou guardado em `legado/dados-falso.js`.

Conta de teste: `jeferson@teste.farejo.local` / `teste-1234`.

## O que já funciona

- Feed ordenado por **urgência** (distância penalizada pela idade do caso)
- Filtro por raio (1/3/5 km) e por tipo
- Post no formato do Instagram: autor, foto quadrada sangrando, ações, legenda
- Tela de detalhe com ficha, mapa e **rastro**: a sequência de avistamentos
- Contato do tutor exigindo login (mesma regra do protótipo, agora no banco)
- **Criar conta e entrar** (Supabase Auth)
- **Publicar um caso**: quatro tipos, foto com upload para o Storage, escolha do
  ponto no mapa e campos que mudam conforme o tipo
- **Até 3 fotos por caso**, com carrossel de arrastar no feed; avistamento
  continua com uma foto só, para não poluir
- **Avisar um avistamento**, que entra no rastro do caso
- **Mapa dos pets procurados**: cada caso aberto vira um alfinete com a foto do
  pet; tocar abre um cartão, tocar no cartão abre o caso
- **Perfil** (o próprio e o dos outros): grade de três colunas com tudo que a
  pessoa publicou, incluindo os avisos que deu nos casos alheios
- **Editar, encerrar, reabrir e apagar** os próprios casos, pelo "···" do post
- **Prévia de link** para WhatsApp e redes, via `/c/<id>`, com chamada de ação
  ("Ajude a achar o Thor") em vez de rótulo descritivo
- **Farejadores**: contador de pessoas ajudando cada caso
- **Novidades**: sino no topo com os avistamentos nos seus casos
- **Localização real**: o app convida antes de disparar o pedido do navegador,
  guarda a última posição e diz de onde mediu — "de você" ou "do Centro"

### Por que o link compartilhado é /c/&lt;id&gt; e não #/post/&lt;id&gt;

O app roteia por hash, e **o hash nunca é enviado ao servidor**: o robô do
WhatsApp pediria só `/` e receberia a página genérica, sem foto nem nome do pet.
Como o compartilhamento em grupo de bairro é o principal jeito de um pet perdido
ser achado, isso custa caro.

`functions/c/[id].js` responde em `/c/<id>` com as meta tags `og:` preenchidas a
partir do caso, e manda a pessoa para `/#/post/<id>` em seguida. Roda só no
Cloudflare Pages — no `http.server` local esse caminho não existe.

### A barra de cima

O chip diz **de onde** se mede e **até onde** se olha — `Centro · 3 km` ou
`Você · 3 km`, com o ponto cheio e pulsando quando a origem é a pessoa. Antes
era só "3 km", um número que não respondia nem uma coisa nem outra.

Tocar abre um popover (não uma folha de tela cheia, que era pesada demais para
duas escolhas) com a origem e os raios — **cada raio mostrando quantos casos
caem nele**. "5 km" é abstrato; "5 km · 8 casos" é uma decisão. A contagem sai
de uma consulta só, na maior distância, agrupada no cliente.

### Farejadores

Quantas **pessoas** estão ajudando um caso — não quantos avistamentos houve.
Gente distinta, cada uma contada uma vez, tenha avistado ou apenas espalhado o
link. O Thor, por exemplo, tem 3 avistamentos e 2 farejadores: a mesma pessoa
o viu duas vezes.

Podia ser um número inventado, e ficaria mais bonito. Mas num app onde alguém
confia a busca do próprio cachorro, número inflado é o tipo de coisa que,
descoberta uma vez, derruba a confiança no resto. Este só cresce quando alguém
age: compartilhar registra em `compartilhamentos` (tabela que existia desde o
schema-01 e estava sem uso).

### Novidades

O sino do topo lista o que outras pessoas fizeram nos **seus** casos — por ora,
avistamentos. O "não visto" é um carimbo de tempo no próprio aparelho, sem
coluna nova no banco; o custo é não sincronizar entre aparelhos, aceitável para
um aviso.

### A ordem do feed

Não é cronológica nem por faixas de tipo. É uma **nota de urgência**:

```
nota = peso_do_tipo × decaimento(idade) × proximidade(distância)
```

| tipo | peso | meia-vida |
|---|---|---|
| avistado | 1,00 | **24 h** |
| perdido | 1,00 | 96 h |
| encontrado | 0,90 | 96 h |
| adoção | 0,45 | 720 h |

Os números vivem em `schema-09.sql`, num bloco só.

A meia-vida curta do avistamento é o ponto: **pista de rua é perecível** — vale
o dia, não a semana. Nasce no topo e desce sozinha. Adoção quase não decai, porque não é urgência,
mas também nunca fica permanentemente invisível.

A **idade contada é a da última atividade**, não a da publicação: um caso de 3
dias que acabou de receber um avistamento volta ao topo. Foi medido — a "Mel"
subiu de 6º para 4º quando alguém a avistou.

**Por que não faixas rígidas por tipo** (avistado > perdido > encontrado >
adoção), que é a ideia intuitiva: testada, ela põe um avistamento de 6 dias a
4 km em 2º lugar, empurra o pet perdido a 90 m para 4º, e enterra para sempre
uma adoção na mesma rua. Faixa ignora distância e idade na comparação entre
tipos.

### Fotos

Um caso aceita até 3 (de frente, de lado, a marca que identifica); a primeira é
a capa. Um avistamento aceita 1 — três fotos do mesmo cachorro visto de longe
seriam só ruído no feed. O limite é aplicado no `slice(0, max)` do seletor, não
na confiança de que o celular respeite o `multiple`.

O carrossel é **scroll-snap nativo**, sem biblioteca: o arrasto com inércia do
celular sai de graça, funciona pelo teclado, e `scroll-snap-stop: always` impede
que um arrasto rápido pule uma foto. Contador `1/3` no canto e pontinhos abaixo,
atualizados por **um único** ouvinte de `scroll` em modo de captura no
documento — `scroll` não borbulha, mas é capturável, e assim o ouvinte sobrevive
a cada repintura do feed.

As fotos são reduzidas a 1440px no navegador antes de subir (as de teste caíram
de 21 KB para 13 KB) e vão para a pasta do próprio usuário no bucket.

### O ponto que o mapa mostra

Não é onde o pet sumiu — é **onde ele foi visto por último**. Para um caso com
rastro, `mapa_perdidos` devolve o avistamento mais recente. Quem vai à rua
procurar precisa do dado novo. O Thor, por exemplo, aparece a 909 m (último
avistamento) e não a 310 m (onde sumiu).

O mapa inclui dois tipos, porque os dois são "pet perdido" para quem olha:
anel laranja = procurado pelo tutor; anel azul = visto solto e ainda sem dono
reclamando.

## No ar

<https://petalerta-scs.melo-jeferson.workers.dev>

Publica sozinho a cada push na `main`.

## Deploy (Cloudflare Workers ligado ao GitHub)

**Não existe `dist/`.** Não há compilação: `web/` é servido como está pela camada
de assets do Cloudflare. O `wrangler.jsonc` diz tudo:

| Chave | Valor | Por quê |
|---|---|---|
| `main` | `worker.js` | o Worker só existe para `/c/<id>` |
| `assets.directory` | `./web` | o site |
| `assets.run_worker_first` | `["/c/*"]` | todo o resto vai direto dos assets |
| `assets.not_found_handling` | `single-page-application` | caminho desconhecido cai no app |

O comando de deploy do projeto é `npx wrangler deploy`, o padrão dos Workers
Builds. Não mexer nele.

### Verificado em produção (13/09/2026)

Site e assets em 200 servindo v=16; mapa com 5 alfinetes; perfil de outro
usuário sem o botão "Sair"; e a prévia de link respondendo com
`summary_large_image`, `og:image` que abre em 200, e 404 para id inexistente.

### Por que o primeiro deploy falhou (13/09/2026)

O código novo ainda não estava no GitHub — a `main` tinha só o protótipo de
março. O Cloudflare clonou aquilo, viu `requirements.txt` na raiz, concluiu que
era projeto Python e instalou o Streamlit; depois o `wrangler deploy` não achou
pasta de estáticos e parou com *"Could not detect a directory containing static
files"*.

Três arquivos do protótipo foram para `legado/` justamente para a detecção não
se confundir de novo: `requirements.txt`, `app.py` e `.devcontainer/`.

## O que falta

1. Filtrar o mapa por espécie e por quão recente é o avistamento
2. PWA: manifest, service worker, web push
3. Recuperar senha
4. Imagem de reserva para a prévia de link quando o caso não tem foto
   (hoje o WhatsApp mostra um cartão só de texto)
5. Editar o próprio perfil (nome, WhatsApp, foto)
6. Faxina de fotos órfãs no bucket: a limpeza existe no front (ao editar e ao
   apagar), mas quem mexer no banco por fora deixa arquivo para trás

## Versões dos módulos

Todo `?v=` em `web/` tem de ser o **mesmo número**:

```bash
node tools/versionar.js       # confere
node tools/versionar.js 16    # carimba 16 em tudo
```

Para o navegador, `dados.js?v=8` e `dados.js?v=9` são **módulos diferentes**: ele
instancia o arquivo duas vezes, com estado separado. Isso já aconteceu aqui —
dois clientes Supabase, duas sessões e dois `ORIGEM`, o que fazia o "centralizar
em mim" do mapa não mexer nas distâncias do feed. Bumpar à mão, arquivo por
arquivo, é o que causa.

## Armadilhas encontradas, para não repetir

- **`img { display: block }` anula o atributo `hidden`.** Uma prévia de foto
  "escondida" ocupava 438px de altura. A folha declara `[hidden] { display: none
  !important }` logo abaixo da regra de imagem.
- **Ouvintes de evento acumulavam na folha de formulário.** Como `fechar()` só
  limpava o `innerHTML`, o `<form>` antigo continuava vivo desanexado, com os
  valores preenchidos — e confirmar uma folha reenviava a anterior, criando post
  duplicado. Cada folha agora tem um `AbortController` que desliga tudo.
- **RLS filtra linha, não coluna.** Ver `schema-02.sql`.
- **PostgREST recusa embed ambíguo** entre `posts` e `profiles`: é preciso nomear
  a relação (`profiles!posts_autor_id_fkey`).
- **A API de management do Supabase bloqueia o cliente do `urllib`** (Cloudflare
  1010). Usar `curl`.
- **Função nova não aparece na API na hora.** O PostgREST guarda um cache de
  schema; depois de criar uma função é preciso `notify pgrst, 'reload schema';`
  senão a chamada volta `PGRST202`.
- **Os `z-index` internos do Leaflet (400 a 800) passam por cima de overlays.**
  O contêiner do mapa leva `z-index: 0` para criar contexto de empilhamento e
  conter os painéis dele.
- Um 400 do Supabase pode aparecer no console ao carregar a página: é a
  renovação do token de sessão. A biblioteca se recupera sozinha e o app segue
  logado — não é erro do app.

## Dívidas herdadas do protótipo

- **Chave da API do ImgBB exposta** em `legado/app.py` — revogar no painel do ImgBB.
  Está num repositório público desde março.
- `assets/Banner.png` e `assets/banner.png` são **arquivos diferentes com o mesmo
  nome**. Em Linux coexistem; em macOS um sobrescreve o outro no checkout. O
  minúsculo (4128×1024) tem o quadriculado de transparência gravado nos pixels;
  o maiúsculo (730×183) é o correto. Apagar o minúsculo do git.
- `requirements.txt` sem versão fixada foi o que quebrou o CSS do protótipo
  sozinho ao longo do tempo.
