-- =============================================================================
-- schema 19 — a área provável de busca, e o nosso próprio banco de padrões
--
-- DUAS COISAS, E A SEGUNDA É A QUE NÃO PODE ESPERAR
--
-- 1. `acesso_rua` — a única pergunta com evidência forte na literatura.
--    Gato que nunca sai de casa é encontrado a 137 m; gato com acesso à rua,
--    a até 1.609 m (Huang, Coradini & Rand, 2018, Animals 8(1):5, n=1.210).
--    Doze vezes de diferença — maior que qualquer efeito COMPROVADO em cães.
--    Para cão não se pergunta temperamento: o IAABC Foundation Journal diz
--    que o efeito é suspeitado, não confirmado. Lá o temperamento muda o
--    conselho, não o raio.
--
-- 2. `desfechos` — onde o pet estava, quando encerram o caso.
--    Hoje `resolver_post` grava `status` e `resolvido_em`. Só. Onde o animal
--    foi achado e como NÃO são registrados — e são exatamente as duas
--    variáveis do modelo. Esse dado só existe no instante em que alguém
--    encerra um caso; depois não volta mais. Por isso a coleta vem antes da
--    visualização: cada dia sem esta tabela é um caso a menos na nossa base.
--
-- POR QUE GUARDAR O PONTO, E NÃO SÓ A DISTÂNCIA
-- Da distância não se recupera a coordenada. Descartá-la seria irreversível e
-- mataria as três análises que SÓ os nossos dados podem dar, porque nenhum
-- estudo publicado fala de Santa Cruz do Sul:
--   · direção — se os pets daqui descem para o arroio ou fogem da BR, os anéis
--     deixam de ser círculos e viram manchas com forma;
--   · aglomerados — o mapa dos lugares onde pets de fato aparecem;
--   · barreiras — se a ferrovia e a BR-471 realmente limitam o deslocamento.
--
-- GUARDADO NÃO É PUBLICADO
-- `desfechos` fica com RLS ligado e SEM política de leitura: ninguém lê pela
-- API. Só as funções agregadas, e só para o administrador. O ponto de ORIGEM
-- de um caso já é público (todo mundo vê no mapa onde o pet sumiu), mas onde
-- ele foi ACHADO pode ser o quintal ou a garagem de um vizinho.
-- =============================================================================

set search_path = public, extensions;

-- 1. A PERGUNTA DO GATO ---------------------------------------------------------

do $$ begin
  create type acesso_rua as enum ('nao_sai', 'sai');
exception when duplicate_object then null; end $$;

alter table posts add column if not exists acesso_rua acesso_rua;

/* Perguntada DEPOIS de publicar, de propósito: quem acabou de perder o gato
   não devia ter mais um campo pela frente. Por isso `criar_post` e
   `editar_post` NÃO são tocadas — o que também evita reescrevê-las por
   inteiro e o risco de copiar a versão errada, revertendo a trava de adoção
   (schema-15) ou o `or eh_admin()` (schema-14). */
create or replace function definir_acesso_rua(p_post_id uuid, p_valor acesso_rua)
returns void
language plpgsql security definer
set search_path = public, extensions as $$
begin
  update posts set acesso_rua = p_valor
   where id = p_post_id and (autor_id = auth.uid() or eh_admin());
  if not found then
    raise exception 'Só quem publicou pode responder isso.';
  end if;
end $$;

-- 2. OS DESFECHOS ---------------------------------------------------------------

/* As categorias espelham as do Huang 2018 de propósito: dado comparável é dado
   que se pode confrontar com o estudo, em vez de ficar numa ilha.
   Os percentuais de lá, para referência: quintal de alguém 20%, esperando na
   própria porta 19%, escondido no mato 16%, dentro da casa de outra pessoa 11%
   (destes: garagem 28%, atrás de móvel 22%), embaixo de varanda 10%, dentro da
   PRÓPRIA casa 4%, em árvore 1%. */
do $$ begin
  create type tipo_lugar as enum ('quintal_alheio', 'porta_de_casa', 'mato', 'varanda',
                                  'casa_alheia', 'propria_casa', 'rua', 'recolhido', 'outro');
exception when duplicate_object then null; end $$;

/* 'armadilha' está aqui porque o Huang 2018 achou que ela foi o método isolado
   MAIS eficaz (63% de sucesso) — e só 20% das pessoas tentaram. Se isso se
   confirmar aqui, vira conselho de primeira linha. */
do $$ begin
  create type como_achou as enum ('voltou_sozinho', 'aviso_no_faro', 'busca_a_pe',
                                  'cartaz', 'vizinho', 'clinica_ou_canil', 'redes',
                                  'armadilha', 'outro');
exception when duplicate_object then null; end $$;

create table if not exists desfechos (
  post_id       uuid primary key references posts(id) on delete cascade,
  -- Onde o pet estava. NUNCA sai pela API — ver a seção de RLS abaixo.
  local         geography(point, 4326),
  /* especie e acesso_rua são COPIADAS aqui, não lidas por join: o post pode
     ser editado depois, e um registro de pesquisa não pode mudar de valor
     sozinho debaixo de quem já o analisou. */
  especie       especie not null,
  acesso_rua    acesso_rua,
  distancia_m   double precision,   -- do último ponto conhecido até onde estava
  rumo_graus    double precision,   -- azimute 0-360; é o que revela direção preferencial
  horas         double precision,   -- do último ponto conhecido até o encontro
  lugar         tipo_lugar,
  como          como_achou,
  registrado_em timestamptz not null default now()
);
create index if not exists desfechos_local_idx on desfechos using gist (local);

alter table desfechos enable row level security;
-- Sem política de leitura e sem grant: a tabela não existe para a API pública.
revoke all on desfechos from anon, authenticated;

/* O último ponto conhecido de um caso: o avistamento mais recente, ou — se não
   houver nenhum — o ponto do próprio tutor. É a MESMA âncora que o modelo da
   área de busca usa, para que o medido e o previsto falem da mesma coisa. */
create or replace function ultimo_ponto(p_post_id uuid)
returns table (local geography, quando timestamptz)
language sql stable
set search_path = public, extensions as $$
  select coalesce(a.local, p.local), coalesce(a.ocorrido_em, p.ocorrido_em)
    from posts p
    left join lateral (
      select a.local, a.ocorrido_em
        from posts a
       where a.post_origem_id = p.id and a.tipo = 'avistado'
       order by a.ocorrido_em desc
       limit 1
    ) a on true
   where p.id = p_post_id;
$$;

/* Tudo é opcional. Nem todo encerramento é final feliz — pode ser um pet que
   morreu ou um tutor que desistiu, e uma pergunta obrigatória sobre "onde ele
   estava" nessa hora seria cruel. Além de envenenar a base com resposta dada
   por obrigação. */
create or replace function registrar_desfecho(
  p_post_id uuid,
  p_lat     double precision default null,
  p_lng     double precision default null,
  p_lugar   tipo_lugar       default null,
  p_como    como_achou       default null
)
returns void
language plpgsql security definer
set search_path = public, extensions as $$
declare
  o_post   posts;
  ancora   geography;
  quando   timestamptz;
  ponto    geography;
begin
  select * into o_post from posts where id = p_post_id;
  if not found then raise exception 'Caso não encontrado.'; end if;
  if not (o_post.autor_id = auth.uid() or eh_admin()) then
    raise exception 'Só quem publicou pode encerrar este caso.';
  end if;

  select u.local, u.quando into ancora, quando from ultimo_ponto(p_post_id) u;

  ponto := case when p_lat is null or p_lng is null then null
                else st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end;

  insert into desfechos (post_id, local, especie, acesso_rua, distancia_m,
                         rumo_graus, horas, lugar, como)
  values (
    p_post_id, ponto, o_post.especie, o_post.acesso_rua,
    case when ponto is null then null else st_distance(ancora, ponto) end,
    -- st_azimuth devolve radianos; graus são o que se lê numa rosa dos ventos.
    case when ponto is null or st_distance(ancora, ponto) < 1 then null
         else degrees(st_azimuth(ancora::geometry, ponto::geometry)) end,
    extract(epoch from now() - quando) / 3600.0,
    p_lugar, p_como
  )
  on conflict (post_id) do update set
    local       = excluded.local,
    acesso_rua  = excluded.acesso_rua,
    distancia_m = excluded.distancia_m,
    rumo_graus  = excluded.rumo_graus,
    horas       = excluded.horas,
    lugar       = excluded.lugar,
    como        = excluded.como;
end $$;

-- 3. OS PADRÕES QUE FOREM NASCENDO ----------------------------------------------

/* Números agregados, nunca linhas. Devolve também o `n` de cada faixa, porque
   mediana de três amostras não é padrão — é ruído com cara de conclusão, o
   mesmo erro do "70% de chance" que este trabalho recusou. Quem chama decide o
   que fazer com um n pequeno; a função não esconde o tamanho da amostra. */
create or replace function padroes_locais()
returns table (
  faixa        text,
  n            bigint,
  mediana_m    double precision,
  p75_m        double precision,
  mediana_h    double precision,
  lugar_comum  tipo_lugar,
  rumo_medio   double precision
)
language plpgsql stable security definer
set search_path = public, extensions as $$
begin
  if not eh_admin() then raise exception 'Só o administrador.'; end if;
  return query
    with marcado as (
      select d.*,
        case when d.especie = 'gato' and d.acesso_rua = 'nao_sai' then 'gato, não sai'
             when d.especie = 'gato' and d.acesso_rua = 'sai'     then 'gato, sai na rua'
             when d.especie = 'gato'                              then 'gato, não perguntado'
             when d.especie = 'cao'                               then 'cão'
             else 'outro' end as f
      from desfechos d
    )
    select
      m.f,
      count(*),
      percentile_cont(0.5)  within group (order by m.distancia_m),
      percentile_cont(0.75) within group (order by m.distancia_m),
      percentile_cont(0.5)  within group (order by m.horas),
      mode() within group (order by m.lugar),
      /* Rumo é ângulo: média aritmética de 350° e 10° daria 180°, que é o lado
         oposto. A média correta passa pelos vetores unitários. */
      case when count(m.rumo_graus) = 0 then null else
        mod((degrees(atan2(avg(sind(m.rumo_graus)), avg(cosd(m.rumo_graus)))) + 360)::numeric,
            360::numeric)::double precision
      end
    from marcado m
    group by m.f
    order by count(*) desc;
end $$;

revoke execute on function definir_acesso_rua(uuid, acesso_rua)                     from anon;
revoke execute on function registrar_desfecho(uuid, double precision, double precision,
                                              tipo_lugar, como_achou)                from anon;
revoke execute on function padroes_locais()                                          from anon;

notify pgrst, 'reload schema';
