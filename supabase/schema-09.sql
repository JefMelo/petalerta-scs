-- =============================================================================
-- schema 09 — nova regra de ordem do feed
--
-- A regra antiga era distância penalizada pela idade do caso. Dois problemas:
-- ignorava que um caso pode ter sido ATUALIZADO (alguém avistou o pet agora), e
-- tratava todos os tipos igual — um anúncio de adoção competia de igual para
-- igual com um cão solto na esquina.
--
-- A alternativa óbvia seria faixas rígidas por tipo (avistado > perdido >
-- encontrado > adoção). Testada, ela produz dois absurdos:
--   • um avistamento de 6 dias a 4 km sobe ao 2º lugar, só por ser "avistado";
--   • adoção fica sempre por último, então uma adoção na mesma rua nunca aparece.
--
-- Aqui a ordem é UMA NOTA contínua:
--
--     nota = peso_do_tipo  ×  decaimento(idade)  ×  proximidade(distância)
--
-- O que era faixa vira peso e meia-vida. A meia-vida curta do avistamento é o
-- que traduz a intuição certa: pista de rua é perecível — nasce no topo e
-- some sozinha em horas, sem precisar de faixa.
-- =============================================================================

set search_path = public, extensions;

-- Os números que governam o feed, num lugar só. Mexer aqui muda a ordem.
--   peso        quanto o tipo importa de saída
--   meia_vida_h em quantas horas a nota cai pela metade
--   ALCANCE_M   distância em que a nota cai pela metade (abaixo, na função)
--
--   avistado    1.00 / 10h    perecível: some do topo no mesmo dia
--   perdido     1.00 / 96h    continua valendo por dias
--   encontrado  0.90 / 96h    o contrário do perdido, quase tão urgente
--   adocao      0.45 / 720h   não é urgência, é navegação

drop function if exists feed_por_raio(double precision, double precision, integer, post_tipo[], integer, integer);

create function feed_por_raio(
  p_lat    double precision,
  p_lng    double precision,
  p_raio_m integer default 5000,
  p_tipos  post_tipo[] default array['perdido','avistado','encontrado','adocao']::post_tipo[],
  p_limite integer default 20,
  p_offset integer default 0
)
returns table (
  id            uuid,
  tipo          post_tipo,
  status        post_status,
  titulo        text,
  texto         text,
  especie       especie,
  raca          text,
  cor           text,
  porte         porte,
  sexo          sexo,
  endereco      text,
  ocorrido_em   timestamptz,
  atualizado_em timestamptz,
  distancia_m   double precision,
  autor_id      uuid,
  autor_nome    text,
  fotos         text[],
  n_avistados   bigint,
  n_comentarios bigint,
  urgencia      double precision
)
language sql stable
set search_path = public, extensions as $$
  with origem as (select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as g),
  caso as (
    select
      p.*,
      st_distance(p.local, o.g) as dist,
      -- ÚLTIMA ATIVIDADE: o caso em si, ou o avistamento mais novo ligado a ele.
      -- É o que faz um caso antigo voltar ao topo quando alguém acabou de ver
      -- o pet — a informação mais valiosa do app, e que a regra antiga perdia.
      greatest(
        p.ocorrido_em,
        coalesce((select max(a.ocorrido_em) from posts a
                   where a.post_origem_id = p.id and a.tipo = 'avistado'),
                 p.ocorrido_em)
      ) as mexido_em
    from posts p
    cross join origem o
    where p.status = 'aberto'
      and p.post_origem_id is null
      and p.tipo = any(p_tipos)
      and st_dwithin(p.local, o.g, p_raio_m)
  ),
  nota as (
    select c.*,
      (case c.tipo when 'avistado' then 1.00 when 'perdido' then 1.00
                   when 'encontrado' then 0.90 else 0.45 end)
      * exp(-ln(2) * (extract(epoch from now() - c.mexido_em) / 3600.0)
                   / (case c.tipo when 'avistado' then 10.0
                                  when 'adocao'   then 720.0
                                  else 96.0 end))
      * (1.0 / (1.0 + c.dist / 600.0))       -- ALCANCE_M = 600
      as urgencia
    from caso c
  )
  select
    n.id, n.tipo, n.status, n.titulo, n.texto, n.especie, n.raca, n.cor,
    n.porte, n.sexo, n.endereco, n.ocorrido_em, n.mexido_em, n.dist,
    n.autor_id, pr.nome,
    coalesce((select array_agg(f.path order by f.ordem) from post_fotos f where f.post_id = n.id), '{}'),
    (select count(*) from posts a where a.post_origem_id = n.id and a.tipo = 'avistado'),
    (select count(*) from comentarios c2 where c2.post_id = n.id),
    n.urgencia
  from nota n
  join profiles pr on pr.id = n.autor_id
  order by n.urgencia desc, n.mexido_em desc
  limit p_limite offset p_offset;
$$;

notify pgrst, 'reload schema';
