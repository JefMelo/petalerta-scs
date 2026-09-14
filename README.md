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
web/js/config.js         URL + chave anon do Supabase + chave VAPID pública
web/js/dados.js          acesso ao Supabase (RPC, PostgREST, auth, storage)
web/js/formularios.js    folhas de conta, publicar, avistar e raio
web/js/mapa.js           mapa dos pets procurados
web/js/perfil.js         perfil próprio e dos outros (inclui o ajuste de avisos)
web/js/admin.js          a tela do administrador: pedidos, contas, recados e padrões
web/js/area-busca.js     o modelo da área de busca — puro, sem DOM, roda em node
web/js/pwa.js            instalar na tela de início + inscrição dos avisos
web/sw.js                service worker: cache do app e recebimento dos avisos
web/manifest.webmanifest nome, ícones e atalhos do app instalado
worker.js                Worker: roteia /c/<id> e /avisar; o resto vai aos assets
wrangler.jsonc           configuração do Cloudflare
src/compartilhar.js      monta o HTML com as meta tags og:
src/avisar.js            POST /avisar: decide e dispara os avisos
src/push.js              Web Push (RFC 8291/8292) com a Web Crypto do Worker
tools/gerar-icones.py    gera os ícones do app a partir do logo
tools/gerar-vapid.js     gera o par de chaves dos avisos (uma vez só)
tools/testar-push.js     prova a criptografia contra o vetor do RFC 8291
tools/testar-papeis.js   prova as travas de papel pelos caminhos de ataque
tools/testar-desfechos.js prova a conta e o sigilo da base de calibragem
tools/testar-area.js     prova os raios contra os percentis publicados
tools/versionar.js       carimba a MESMA versão em todo ?v= (e no cache do sw)
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
| `schema-11.sql` | foto do autor no feed (`autor_avatar`) |
| `schema-12.sql` | `meu_perfil` e `atualizar_perfil`: o dono lê e edita o próprio |
| `schema-14.sql` | papéis (farejador/protetor/ONG/admin), allowlist de admin, políticas de moderação |
| `schema-15.sql` | adoção só de quem responde por ela (a mensagem; a trava é o RLS do 14) |
| `schema-16.sql` | recados do Faro + selo de papel no feed |
| `schema-17.sql` | Reencontros + conserto de `n_reencontros` no perfil |
| `schema-18.sql` | o recado ganha foto (é anúncio no meio do feed, não faixa de topo) |
| `schema-19.sql` | `acesso_rua` do gato; tabela `desfechos` — a base de calibragem local |
| `schema-20.sql` | `mapa_perdidos` devolve `acesso_rua` (as duas telas precisam do mesmo raio) |
| `schema-21.sql` | *(revertido pelo 22)* o reencontro voltava ao feed por 3 dias |
| `schema-22.sql` | o reencontro sai do feed e vira pontinho na aba: `novos_reencontros()` |
| `schema-13.sql` | avisos no celular: `push_subs` ganha o opt-in de bairro, `avisos_enviados` e `avisos_pendentes` |
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
- **Foto de perfil**, com nome e WhatsApp editáveis na mesma folha
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

### O logo na barra

Alinhamento **ótico**, não geométrico. Medido nos arquivos: o centro do pino cai
a 53,0% da altura da marca, o centro das letras a 62,9% da altura do wordmark.
Centralizando as caixas, o nome fica visivelmente baixo — daí o empurrão de
1,7px para cima no CSS.

Os PNGs foram recortados com limiar de alfa > 30, não com `getbbox()`: o método
conta pixels de alfa 1 (fantasmas de antisserrilhado) e inchava a caixa em 32%
da largura, o que era a causa real do desalinhamento.

### E-mail

Hoje o projeto usa o servidor embutido do Supabase: **2 e-mails por hora**, e os
textos chegam **em inglês**. A tradução não é uma escolha em aberto — o Supabase
recusa personalizar:

> *Email template modification is not available for free tier projects using the
> default email provider.*

Ou seja: SMTP próprio destrava as duas coisas de uma vez. Os textos em português
já estão escritos em `supabase/emails.json` e são aplicados junto:

```bash
./tools/configurar-email.sh <host> <porta> <usuário> <senha> <remetente> "Faro"
```

**Qual provedor.** Depende de já existir domínio:

| | sem domínio | com domínio |
|---|---|---|
| **Brevo** | funciona — verifica um remetente avulso | funciona |
| **Resend** | só envia para o dono da conta | 3.000/mês grátis, melhor entrega |

Sem domínio, mandar de um endereço `@gmail.com` por um terceiro costuma cair no
spam: o SPF e o DKIM não batem com o remetente. Por isso a ordem recomendada é
**domínio primeiro, e-mail depois** — a não ser que a pressa seja só testar.

### Senha

Recuperar: a tela pede o e-mail e o Supabase manda o link. Quem volta por ele
chega com uma sessão temporária, e o evento `PASSWORD_RECOVERY` abre a tela de
nova senha — não dá para detectar pela URL, porque a biblioteca já a limpou
quando o app carrega. O ouvinte guarda o evento se ele chegar antes da
inscrição, senão a tela poderia simplesmente não aparecer num fluxo que a
pessoa percorre uma vez e às cegas.

A mensagem de sucesso **não confirma se o e-mail existe** ("se existir uma conta
em X, o link chegou lá"): dizer "não achamos essa conta" entregaria a estranhos
quem tem cadastro.

Depende de `Auth → URL Configuration` no painel: `site_url` e a lista de
redirecionamentos permitidos. Estavam em `localhost:3000` e vazia — o link
seria recusado.

### Por que o dono lê o próprio perfil por RPC

O `schema-02` tirou a coluna `whatsapp` do alcance da API para ninguém ler o
telefone alheio — e isso alcançava o dono também, que não conseguia editar o
seu. A saída não foi devolver o `grant`, e sim `meu_perfil()`, uma função
`security definer` que enxerga só a linha de quem chama.

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

As fotos vão para a pasta do próprio usuário no bucket, e passam antes pelo
recorte.

#### O recorte quadrado (`web/js/recortar.js`)

Antes, o app aceitava a foto como ela vinha e o CSS resolvia: `aspect-ratio: 1/1`
mais `object-fit: cover`. O feed **parecia** certo e estava errado por baixo —
quem escolhia o recorte era o navegador, cortando pelo centro. Uma foto na
vertical, que é como todo mundo fotografa o próprio cachorro, perdia a cabeça do
animal ou as patas. Justamente o que identifica.

Agora quem enquadra é a pessoa, numa tela que abre sobre o formulário: arrastar,
aproximar (pinça, roda ou barra) e pronto. Não gira, não filtra, não ajusta
brilho — isso é trabalho de editor de foto, e quem acabou de perder um cão não
vai usar.

Três coisas de uma vez:

- **O feed fica parelho.** Todo card com a mesma altura, rolagem sem solavanco.
- **O arquivo fica pequeno.** Sai sempre em JPEG de no máximo 1080 px de lado.
  Uma foto de celular moderno tem 4 MB; esta sai perto de 200 KB. Quem publica
  está na rua, com pressa e sinal ruim.
- **A cabeça do pet aparece**, que é o ponto inteiro de ter foto.

Detalhes que valem ser ditos:

- O palco **é** o quadro: o que está dentro dele é exatamente o que vira
  arquivo. Nada de moldura desenhada por cima "sugerindo" o corte.
- O arraste é travado para o quadro nunca descobrir. `tools/testar-recorte.js`
  prova a propriedade em 6 formatos (retrato, paisagem, quadrada, panorâmica,
  minúscula, tira vertical) × 5 zooms × 25 posições de canto — porque recorte
  errado não quebra nada: gera um JPEG bonito com tarja branca na borda.
- A saída **acompanha o recorte** entre 640 e 1080 px. Esticar um pedaço de
  200 px até 1080 não inventa detalhe, só peso.
- **Teto de 25 MB na entrada.** Não é economia: decodificar uma foto de 40 MP
  num celular antigo estoura a memória da aba, e o que a pessoa vê é o app
  fechando sozinho no meio da publicação.
- Carrega pelo `<img>`, não por `createImageBitmap` — é o mesmo elemento que a
  tela já mostra, e aceita o **HEIC** que sai da câmera de metade dos iPhones.
- Fundo branco por baixo do canvas: PNG com transparência viraria mancha preta
  ao salvar em JPEG, que não tem canal alfa.
- O avatar passa pelo mesmo recorte: ele aparece **redondo** em toda tela, e um
  corte que não seja quadrado põe o rosto para fora do círculo.

O `object-fit: cover` do CSS continua onde está, para as fotos antigas que já
estão no bucket com outros formatos.

Depois do recorte, `enviarFoto` ainda reduz a 1440 px — que para uma foto já
quadrada de 1080 não muda nada, e continua valendo para o que não passar por
aqui.

### O ponto que o mapa mostra

Não é onde o pet sumiu — é **onde ele foi visto por último**. Para um caso com
rastro, `mapa_perdidos` devolve o avistamento mais recente. Quem vai à rua
procurar precisa do dado novo. O Thor, por exemplo, aparece a 909 m (último
avistamento) e não a 310 m (onde sumiu).

O mapa inclui dois tipos, porque os dois são "pet perdido" para quem olha:
anel laranja = procurado pelo tutor; anel azul = visto solto e ainda sem dono
reclamando.

### App instalável (PWA) e avisos no celular

**Instalar.** `web/manifest.webmanifest` mais `web/sw.js` fazem o Faro virar
ícone na tela de início. Há um convite dentro do app, dispensável de vez, que no
Android usa o `beforeinstallprompt` do navegador e no iPhone só ensina o caminho
(lá não existe botão — é o menu Compartilhar do Safari). Os ícones saem todos do
logo por `tools/gerar-icones.py`; o "maskable" tem margem sobrando porque o
Android recorta o ícone em círculo, losango ou squircle conforme o aparelho.

**O service worker não pré-carrega lista nenhuma.** O site não tem build, e
manter aqui uma lista de caminhos com `?v=` seria uma segunda fonte de verdade
para desencontrar de `tools/versionar.js`. Ele guarda o que a pessoa de fato
pediu. O que NUNCA é guardado: as chamadas ao Supabase — são dados vivos e
carregam o token da sessão.

> **Armadilha achada no teste:** o `+esm` do jsdelivr **não** é um pacote só. O
> `supabase-js` puxa mais nove módulos (`auth-js`, `postgrest-js`, `realtime-js`,
> `tslib`…). Faltando qualquer um, o app não SOBE sem rede. Por isso o jsdelivr
> inteiro entra no cache de CDN, não só o endereço que aparece no `import`.

E o service worker novo **espera**: não há `skipWaiting`. Trocar o app debaixo de
quem está preenchendo um formulário perde o que foi digitado; a versão nova
assume quando todas as janelas fecharem.

**Avisos.** Quatro motivos, nesta ordem de valor:

| motivo | quem recebe | quando |
|---|---|---|
| `meu_caso` | o dono do caso | alguém avistou o pet dele |
| `ajudo` | quem compartilhou ou avistou | o caso que ajudou teve novidade |
| `bairro` | quem optou, dentro do raio | sumiu ou apareceu um pet perto |
| `resolvido` | quem ajudou | o caso terminou |

Adoção **não** dispara alerta de bairro: acordar o bairro por uma adoção é o
caminho mais curto para a pessoa desligar os avisos — e aí ela também não recebe
o que importa.

**Quem dispara é o app de quem publicou**, logo depois de publicar. Não há
gatilho no banco nem fila: o evento que importa acontece na mão de alguém, e
essa pessoa está com a rede na mão. O que vai daqui é só o id do post; **quem
decide quem recebe é o banco** (`avisos_pendentes`), com três travas no Worker:
o token é conferido no Supabase, quem chama tem de ser o autor, e o post tem de
ser recente (10 min) — senão alguém varreria posts velhos e acordaria a cidade
de novo. A repetição está travada em `avisos_enviados`, então recarregar a
página depois de publicar não manda nada duas vezes.

**A criptografia é escrita à mão** (`src/push.js`), porque as bibliotecas
conhecidas são de Node e o Worker não tem `crypto` nativo. Ou está certa até o
último byte, ou o celular descarta o pacote **em silêncio** — sem erro, sem log.
Por isso `tools/testar-push.js` não confere "se parece funcionar": ele compara
os bytes com o exemplo publicado no RFC 8291 §5.

```bash
node tools/testar-push.js
```

**No iPhone os avisos só existem com o app instalado** (iOS 16.4+). É o motivo
técnico de o convite de instalação não ser enfeite.

### Papéis, e por que são quatro

| papel | vale quando | publica adoção |
|---|---|---|
| `farejador` | na hora | não |
| `protetor` | depois de aprovado | sim |
| `ong` | depois de aprovado | sim |
| `admin` | vem da lista de e-mails | sim |

O **protetor independente** existe porque a regra "só ONG publica adoção",
sozinha, expulsaria justamente quem mais resgata na cidade — gente que tira
ninhada da rua e não tem CNPJ. A porta é a mesma (pedido + aprovação), só muda
como a pessoa se apresenta. Quem não pode publicar adoção vê, no lugar da
opção, o caminho: publicar como *"Encontrei e está comigo"*, pedir cadastro, ou
falar com uma das ONGs já aprovadas (a lista aparece ali mesmo).

**Quem espera aprovação usa o app normalmente.** Só a publicação de adoção
espera — o resto (publicar caso, avisar avistamento, compartilhar) vale desde o
primeiro minuto. Decisão do fundador: travar tudo perderia alguém que podia
estar ajudando hoje.

### A regra da adoção tem TRÊS portas, não uma

Fechar só a RPC daria a sensação de estar pronto:

1. `criar_post` → a mensagem em português (`schema-15`);
2. `POST /rest/v1/posts` direto → a política de INSERT (`schema-14`);
3. `PATCH {"tipo":"adocao"}` num post já criado → a política de UPDATE.

`node tools/testar-papeis.js` bate nas três, mais nos caminhos de escalada de
privilégio. São 30 verificações, com sessões reais, e ele limpa o que criou.

### O administrador não sai do cadastro

`raw_user_meta_data` é escrito pelo **cliente**: quem se cadastra pode mandar
`papel: "admin"` no corpo da requisição. O trigger só aceita de lá `'ong'` e
`'protetor'` — e os dois nascem **pendentes**, então mentir não dá poder nenhum.
`admin` vem exclusivamente da tabela `admins_email`, que é invisível pela API.

O vetor mais direto, porém, não era esse: `profiles_self_update` deixava
qualquer um dar `PATCH` na própria linha, e **RLS filtra linha, não coluna**. Com
uma coluna `papel`, isso seria auto-promoção a administrador por uma requisição
HTTP. O `schema-14` revoga `insert/update/delete` em `profiles` por inteiro (o
app já só escrevia por RPC) e ainda põe um gatilho de reserva.

### A área do administrador é uma TELA, não um bloco no perfil

Na primeira versão a administração morava dentro do perfil, e a mesma tela
dizia duas coisas ao mesmo tempo: "estes são os SEUS casos" e "estas são as
contas de TODO MUNDO". Perfil é identidade; administração é poder sobre a
identidade dos outros — e empilhar as duas confunde justamente na hora em que
confundir custa caro: apagar, aprovar, mudar papel.

Entra-se por um escudo no topo do próprio perfil (`#ir-admin`), visível só para
quem administra, e a tela tem rota própria (`#/admin`) com três seções:
Pedidos, Contas e Recados. Vive em `web/js/admin.js`.

### Privacidade da moderação

O administrador **não** ganha leitura geral de telefone nem das inscrições de
push. O WhatsApp aparece em dois lugares: na ficha de um pedido pendente — onde
serve para conferir se a organização existe — e em `admin_contato()`, que
**registra quem olhou** em `admin_log`. Moderar não é ler a agenda da cidade.

### As três seções do topo

Saíram os cinco filtros de texto: o feed já vem ordenado por urgência, e o
filtro competia com essa ordem. No lugar, três destinos com rota própria:

| aba | rota | o que mostra | área |
|---|---|---|---|
| Buscas | `#/` | perdido, avistado, encontrado | a que você escolheu |
| Adoção | `#/adocao` | só adoção | a cidade toda |
| Reencontros | `#/reencontros` | casos que terminaram bem | a cidade toda |

Adoção e Reencontros varrem a cidade de propósito: em nenhuma das duas a
distância decide, e página vazia afasta mais que caso distante.

**Reencontros** é a página que faltava. O feed filtra `status='aberto'`, então
um caso resolvido simplesmente sumia — some a prova de que o Faro funciona e o
agradecimento a quem farejou. A ordem ali é cronológica, não por urgência:
reencontro não pede ação, pede leitura.

### O pontinho, em vez do card no feed

Por um dia o caso encerrado voltou ao feed com prazo de três dias (`schema-21`).
O fundador propôs melhor, e é o que está no ar (`schema-22`):

> o feed é só de quem precisa de ajuda **agora**; a comemoração acende um
> pontinho no ícone de Reencontros, e a pessoa vai vê-la quando quiser.

Santa Cruz do Sul não é São Paulo: são poucos casos por dia. Um reencontro no
meio de cinco cards é 20% de um feed cujo trabalho é dizer *"alguém aqui perto
precisa de você"* — e nenhum peso baixo conserta isso, porque o card ocupa a
tela do celular inteira do mesmo jeito. O pontinho ainda dá à boa notícia o que
o card nunca teve: **motivo de voltar**. Card no feed se vê passando; pontinho
no ícone se toca.

Como funciona:

- `novos_reencontros(lat, lng, desde, raio)` conta com **os mesmos filtros** de
  `reencontros`. Contar diferente do que a aba mostra seria anunciar dois e
  entregar um — e a próxima vez a pessoa não abre.
- A marca de "já vi" (`faro:reencontros-visto`) mora no **navegador**, não no
  banco: é preferência de leitura de um aparelho, não fato sobre o caso, e no
  banco visitante deslogado não teria aviso nenhum.
- Quem nunca abriu a aba começa com **72 h de história**, para a primeira visita
  já ter o que comemorar em vez de uma tela cinza.
- O pontinho **apaga ao abrir a aba**. Aviso que fica aceso para sempre vira
  papel de parede — e depois disso nem o de verdade alguém vê.
- Dentro da aba, os que chegaram depois da última visita ganham o card em tom
  verde (`.reencontro--novo`) e uma linha dizendo quantos são. As duas coisas
  somem sozinhas na visita seguinte.
- Se a consulta falhar, não há pontinho e nada mais muda: o aviso é o enfeite, o
  feed é o produto.

### A régua de cor, e por que ela tem ícone

Cada tipo pinta 3 px na borda de cima do card e colore o selo da foto. Mas cor
sozinha nunca é a única diferença: o selo carrega um **ícone** junto da
palavra, porque a forma chega antes da leitura quando se rola rápido — e chega
para quem não distingue verde de vermelho, que é uma pessoa em cada doze.

### Recados do Faro — o único link externo do app

Tabela própria (`recados`), **não** um valor novo em `post_tipo`. Um recado não
tem lugar no mapa (`posts.local` é NOT NULL), não entra na urgência, não vira
"resolvido" — e onze funções vivas consultam `posts`, de modo que bastaria
esquecer uma para um recado institucional virar alfinete no mapa ou acordar o
bairro com push.

**Onde aparece: NO MEIO do feed, como o anúncio do Instagram.** Tem a mesma
casca de um post — avatar, foto sangrando, legenda — porque é isso que faz
alguém ler em vez de pular. O que o separa não é a forma, é a etiqueta: onde um
post diz o endereço, este diz **Recado**; e tem uma barra de ação com o link,
que post nenhum tem.

Entra depois do 3º post (`DEPOIS_DE` em `app.js`), e de 6 em 6 se houver mais de
um. Com feed curto, vai para o fim — melhor no fim que empurrando o primeiro
caso urgente para baixo. Dispensável por aparelho (`faro:recados-lidos`).

> A primeira versão era uma faixa escura **fixa no topo**. Parecia banner de
> site, e banner de topo o olho aprende a pular em dois dias.

**Recado não manda aviso no celular.** É institucional, não é urgente. Está dito
na própria folha de publicação, porque é a primeira pergunta que aparece.

Sobre o link: todo texto do app passa por `esc()` e **nunca** vira `<a>` — isso é
proteção e não se afrouxa. O link do recado vem de uma **coluna** própria, o
banco só aceita `https://` (constraint), o cliente reconfere com `new URL`, e o
`<a>` sai com `rel="noopener noreferrer nofollow"` **mostrando o domínio de
destino** ao lado do rótulo. Ninguém deve tocar num link sem saber para onde vai.

### A nossa própria base — por que a coleta veio antes da tela

O Faro vai passar a estimar a **área provável de busca** de um pet perdido. Os
números de partida vêm de dois estudos:

- **Gatos** — [Huang, Coradini & Rand (2018), *Animals* 8(1):5](https://doi.org/10.3390/ani8010005), 1.210 casos:
  75% achados a até **500 m** do ponto de fuga; gato que nunca sai, **137 m**;
  gato com acesso à rua, 75% até **1.609 m**. A busca física aumentou a chance
  de achar vivo, e a **armadilha humanitária** foi o método isolado mais eficaz
  (63%), usado por só 20% das pessoas.
- **Cães** — Lord et al. (2007b), 187 casos: 71% achados a menos de **1.609 m**,
  14% entre 1,6 e 8 km, 7% além disso; mediana de recuperação de **2 dias**.

> **O que NÃO tem respaldo:** o efeito do temperamento em cães. O
> [IAABC Foundation Journal](https://journal.iaabcfoundation.org/what-we-need-to-learn-about-missing-dogs/)
> diz que é *suspeitado, não confirmado*. Por isso o app não pergunta
> temperamento de cão para mudar raio — só para mudar o conselho. A única
> pergunta que muda o cálculo é a do gato, que tem efeito de **doze vezes**.

### O modelo, e o que ele não promete

```
R(t) = R_percentil × min(1, √(t / T_saturação))
```

A raiz quadrada não é estética: deslocamento em caminhada aleatória
bidimensional cresce com a raiz do tempo, não linearmente — é por isso que
velocidade × tempo dá números absurdos. `T_saturação` é 12 h para gato (se
esconde rápido e fica) e 24 h para cão (mediana de recuperação de 2 dias).

**Cada faixa TERMINA num percentil publicado.** Só o caminho até ele é modelo,
e a tela diz isso. São duas faixas por espécie, não três, porque são dois os
números que a literatura dá:

| espécie | faixa 1 | faixa 2 | além |
|---|---|---|---|
| gato, não sai | 137 m | 500 m | 25% |
| gato, sai na rua | 500 m | 1.609 m | 25% |
| cão (e "outro") | 1.609 m | 8.046 m | 7% |

A terceira faixa **não é um círculo** — é uma frase com o percentual que fica
de fora. Uma versão anterior tinha anéis de "1 km" e "3 km" que não vinham de
lugar nenhum; saíram. Onde a literatura acaba, a tela escreve em vez de
desenhar, porque círculo grande é ruído com aparência de informação.

**Sem resposta, a curva mais apertada.** Gato sem `acesso_rua` usa a de quem
não sai. Errar para menos manda procurar perto demais — meia hora de caminhada.
Errar para mais manda varrer a cidade com o gato embaixo do carro da frente.

Os rótulos dizem **o que fazer**, nunca porcentagem de chance: "procure a pé",
"cole cartaz", "espalhe o link". Nenhum estudo sustenta "70% de chance de estar
dentro deste círculo", e quem acredita nisso **para de procurar do lado de
fora**.

`L.circle` recebe o raio em metros e projeta sozinho — as ~80 linhas de
geodésia e GeoJSON da proposta original seriam reescrever o que a biblioteca já
faz certo.

### O relógio reinicia a cada avistamento

É a regra que separa o Faro de qualquer estimativa feita a partir dos estudos —
porque eles medem "onde o pet foi achado", sem rastro pelo caminho.

Quando alguém registra um avistamento, a contagem recomeça **dali**, e o
círculo encolhe junto. Um cão sumido há 24 h tem anel interno de 1.609 m; se
alguém o viu há uma hora, o anel vira **330 m** e passa a estar centrado no
avistamento, não no sumiço. O mesmo vale no mapa da cidade: `mapa_perdidos`
devolve sempre a **última localização informada**, e o alfinete fica ali.

A regra mora em `horasDesdeUltimoPonto()`, dentro de `area-busca.js` — de
propósito, porque lá o teste alcança. Ela usa o **maior** carimbo de tempo do
rastro, não o primeiro da lista: quem registra "eu vi ontem" num caso de hoje
não faz o relógio andar para trás e inflar o círculo.

> **Armadilha do Leaflet que custou uma depuração:** o mapa do detalhe é criado
> sem vista inicial. Adicionar um `L.circle` antes de existir centro e zoom faz
> o cálculo dos próprios limites estourar — e derruba o resto da função **em
> silêncio**: mapa cinza, sem ladrilho e sem alfinete. `setView` vem primeiro,
> e o enquadramento final usa `latLng.toBounds(metros)`, que não depende de
> camada projetada.

### A camada no mapa da cidade

Interruptor **Área**, desligado por padrão e lembrado por aparelho
(`faro:camada-area`). Ligado, desenha os anéis **só do pet selecionado** —
anéis de vários casos sobrepostos viram mancha ilegível. A camada entra antes
da dos alfinetes na ordem de inserção, para ficar por baixo e não roubar o
toque, e ao selecionar um pet o mapa **enquadra** o maior anel: no zoom da
cidade, o anel de um cão sumido há dois dias é maior que a tela, e o que se
veria não seriam anéis, seria um banho de cor.

Esses números são de Ohio e da Austrália. Santa Cruz do Sul tem outro traçado,
outro trânsito, outro jeito de morar — e o dado que corrigiria isso **só existe
no instante em que alguém encerra um caso**. Daí a ordem: a tabela `desfechos`
foi construída ANTES dos anéis no mapa, porque cada dia sem ela é um caso a
menos na base.

**O que se guarda, e o que não se guarda.** `desfechos` grava o ponto onde o
pet estava, a distância e o **rumo** até ele (azimute), as horas, o tipo de
lugar e como foi achado. O ponto é guardado porque da distância não se recupera
a coordenada, e sem ela morrem as três análises que só os nossos dados podem
dar: **direção** (se os pets daqui descem para o arroio ou fogem da BR, os
anéis deixam de ser círculos), **aglomerados** e **barreiras**.

**Guardado não é publicado.** RLS ligado e sem política de leitura, mais
`revoke all`: ninguém lê `desfechos` pela API — nem o dono do caso. Só as
funções agregadas, e só para o administrador. O ponto de *origem* já é público;
onde o pet foi *achado* pode ser a garagem de um vizinho.

`especie` e `acesso_rua` são **copiadas** no registro, não lidas por join: o
post pode ser editado depois, e um registro de pesquisa não pode mudar de valor
debaixo de quem já o analisou.

**Tudo é opcional.** Nem todo encerramento é final feliz — pode ser um pet que
morreu ou um tutor que desistiu. A folha não insiste, e o caso fecha igual para
quem não quiser contar nada. Resposta dada por obrigação envenenaria a base.

A aba **Padrões**, na área do administrador, mostra os nossos números ao lado
dos publicados — e sempre com o `n`. Abaixo de 30 casos ela diz que faltam N,
em vez de apresentar mediana de três amostras como se fosse padrão.

## No ar

<https://petalerta-scs.faro-scs.workers.dev>

Publica sozinho a cada push na `main`.

## Ao trocar de endereço (subdomínio ou domínio próprio)

O endereço aparece em **dois** lugares fora do código, e esquecer o segundo
quebra a recuperação de senha em silêncio:

1. Cloudflare — o subdomínio do Worker ou o domínio personalizado.
2. **Supabase → Auth → URL Configuration**: `site_url` e a lista de
   redirecionamentos permitidos. Sem isso o link do e-mail aponta para o
   endereço velho, e o Supabase recusa o retorno.

O código não precisa mudar: o botão de compartilhar usa `location.origin` e a
prévia de link lê a origem da própria requisição.

```bash
# conferir como está
curl -s -H "Authorization: Bearer $(cat ~/.config/farejo/supabase-token)" \
  https://api.supabase.com/v1/projects/sxnyeokxkczrcdnsanbu/config/auth \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['site_url']);print(d['uri_allow_list'])"
```

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

### Onde vivem as credenciais (nenhuma no repositório)

`~/.config/farejo/`, modo 600:

| arquivo | para quê |
|---|---|
| `service_role.key` | chave de serviço do Supabase (JWT **legado**, 219 caracteres) |
| `anon.key` | chave pública do Supabase |
| `supabase-token` | PAT do Supabase (rodar SQL pela API de management) |
| `vapid.json` | o par de chaves dos avisos (`publica` + `privada`) |
| `cloudflare-token` | API token da Cloudflare — segredos do Worker e diagnóstico |
| `cloudflare-account` | o Account ID |

> **A chave de serviço é a LEGADA.** O painel do Supabase mostra em destaque as
> do formato novo (`sb_publishable_` com 46 caracteres e `sb_secret_` com 41);
> elas ficam numa seção separada de *Legacy API keys*. O Worker precisa da
> legada, de **219 caracteres**, começando com `eyJhbGciOi`. Pegar a errada
> custou uma noite: o envio falhava e o erro apontava para o post.

O token da Cloudflare precisa de **Account · Workers Scripts · Edit** para
gravar segredo. Só com *Read* toda escrita volta `code 10000 Authentication
error` — que a Cloudflare usa para dizer "sem permissão", não "token inválido".

### Os dois segredos dos avisos (uma vez só, antes do primeiro deploy com push)

O deploy vem do GitHub, então os segredos são cadastrados no painel da
Cloudflare (Worker → Settings → Variables and Secrets → **Secret**) e ficam lá:

| Segredo | De onde sai |
|---|---|
| `VAPID_PRIVADA` | `~/.config/farejo/vapid.json`, campo `privada` |
| `SUPABASE_SERVICE_ROLE` | `~/.config/farejo/service_role.key` |

Sem eles, `/avisar` responde 503 e diz que não está configurado — de propósito,
para não deixar o app achar que avisou alguém. O par VAPID **não se troca**:
gerar outro invalida todas as inscrições e cada aparelho teria de se reinscrever.
A parte pública já vai versionada em `wrangler.jsonc` e `web/js/config.js`.

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

### Travado no domínio (uma coisa depende da outra)

```
domínio próprio
   └─ SMTP próprio  (sem domínio, e-mail de @gmail cai no spam)
        ├─ e-mails em português   (o Supabase só deixa personalizar com SMTP próprio)
        ├─ volume de verdade      (hoje: 2 e-mails por hora)
        └─ CADASTRO FUNCIONANDO   ← ver abaixo
```

**Ninguém consegue criar conta hoje.** O projeto exige confirmação por e-mail
(`mailer_autoconfirm` desligado) e o servidor embutido manda 2 por hora. As
contas de teste não revelaram isso porque foram criadas pela API de
administração, que pula a confirmação.

Há uma saída provisória, se for preciso testar com gente antes do domínio:
ligar `mailer_autoconfirm`, e a conta passa a valer sem confirmar o e-mail. O
custo é aceitar e-mail não verificado — no Faro o contato que importa é o
WhatsApp, não o e-mail, que serve só para entrar e recuperar a senha. É uma
decisão do fundador, não foi tomada.

Quando o domínio existir: `./tools/configurar-email.sh` e o checklist de
"Ao trocar de endereço" mais acima.

### Primeiro passo depois deste trabalho

**Criar a conta `melo.jeferson@hotmail.com` pelo formulário do app.** A conta
ainda não existe, e é ela que vira administradora — o e-mail já está em
`admins_email`, então o papel é atribuído sozinho no cadastro. Enquanto ela não
existir, **não há nenhum administrador**: a fila de pedidos de ONG não tem quem
decida e a seção Administração não aparece para ninguém.

O servidor de e-mail embutido do Supabase manda 2 confirmações por hora — para
uma conta, dá.

### Independentes do domínio

1. Filtrar o mapa por espécie e por quão recente é o avistamento
2. Faxina de fotos órfãs no bucket: a limpeza existe no front (ao editar e ao
   apagar), mas quem mexer no banco por fora deixa arquivo para trás
3. Limpar os dados de teste antes de mostrar a alguém — hoje o feed tem
   "Pipoca (editada)", fotos de placeholder e três contas `@teste.farejo.local`

## Armadilhas encontradas, para não repetir

- **`.recado` já existia.** A classe do balão de aviso do rodapé. O card novo
  do "Recado do Faro" nasceu com o mesmo nome, herdou `position: fixed` e
  desapareceu da tela — sem erro, sem log, sem nada. Hoje é `.recado-faro`.
  Antes de criar classe, procurar se o nome já está tomado.
- **`references` sem `on delete` trava exclusão de conta.** `aprovado_por`
  nasceu assim e tornava IMPOSSÍVEL apagar um administrador que já tivesse
  aprovado alguém. Ponteiro de auditoria leva `on delete set null`.
- **Coluna nova em `profiles` nasce invisível.** O `schema-02` revogou o
  `select` da tabela e devolveu coluna a coluna. Toda coluna nova precisa de
  `grant select (nome_da_coluna)` — senão nem o front nem uma função `stable`
  comum a enxergam.
- **Trava de segurança grossa demais barra o caminho legítimo.** O gatilho que
  impede auto-promoção bloqueava também o *pedido* de cadastro (a pessoa
  mexendo no próprio papel para entrar na fila). Entrar na fila não dá poder;
  aprovar-se é que dá — a regra tem de distinguir as duas coisas.
- **Falha de autenticação disfarçada de "não encontrado".** `oPost()` devolvia
  `null` para qualquer erro, e `/avisar` respondia "post não encontrado" quando
  a chave de serviço é que estava errada. Erro de credencial e ausência de dado
  precisam de mensagens diferentes, senão a investigação começa no lugar errado.
- **Segredo colado à mão vem com lixo nas pontas.** Um `cat` no terminal já
  acrescenta a quebra de linha, e o campo do painel a preserva —
  `Bearer eyJ...\n` é recusado com 401 sem dizer por quê. Todo segredo lido do
  ambiente passa por `trim` no Worker.
- **O `+esm` do jsdelivr não é um pacote só.** O `supabase-js` puxa mais nove
  módulos por baixo. Um cache que guarde só o endereço do `import` não faz o app
  abrir sem rede — e a falha só aparece offline de verdade, nunca com o servidor
  local desligado (o CDN continua no ar).
- **Editou arquivo versionado? Carimbe.** Uma edição em `app.css` sem rodar
  `node tools/versionar.js N` some por completo: o service worker continua
  servindo a URL antiga, que para ele é imutável. Aconteceu no meio deste
  trabalho e custou três telas para entender.
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
