-- =============================================================================
-- schema 05 — sexo e porte no retorno do feed
--
-- A legenda do card ("cão · vira-lata caramelo, macho, porte médio") e o artigo
-- da frase do rastro ("3 pessoas viram O Thor" / "A Mel") dependem do sexo.
-- feed_por_raio() não devolvia nem sexo nem porte, então a legenda saía cortada.
-- =============================================================================

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
  distancia_m   double precision,
  autor_id      uuid,
  autor_nome    text,
  fotos         text[],
  n_avistados   bigint,
  n_comentarios bigint
)
language sql stable
set search_path = public, extensions as $$
  with origem as (select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as g)
  select
    p.id, p.tipo, p.status, p.titulo, p.texto, p.especie, p.raca, p.cor,
    p.porte, p.sexo, p.endereco, p.ocorrido_em,
    st_distance(p.local, o.g) as distancia_m,
    p.autor_id, pr.nome,
    coalesce((select array_agg(f.path order by f.ordem) from post_fotos f where f.post_id = p.id), '{}'),
    (select count(*) from posts a where a.post_origem_id = p.id and a.tipo = 'avistado'),
    (select count(*) from comentarios c where c.post_id = p.id)
  from posts p
  cross join origem o
  join profiles pr on pr.id = p.autor_id
  where p.status = 'aberto'
    and p.post_origem_id is null
    and p.tipo = any(p_tipos)
    and st_dwithin(p.local, o.g, p_raio_m)
  order by
    st_distance(p.local, o.g) * (1 + extract(epoch from now() - p.ocorrido_em) / 86400.0),
    p.ocorrido_em desc
  limit p_limite offset p_offset;
$$;
