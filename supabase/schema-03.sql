-- =============================================================================
-- schema 03 — avistamento ligado a um caso sai do feed
--
-- Visto no teste: os 3 avistamentos do Thor apareciam como cards próprios,
-- competindo com o caso do Thor e repetindo o mesmo pet 4 vezes no feed.
-- Avistamento com post_origem_id pertence ao caso: seu lugar é o rastro,
-- não a lista. Avistamento SEM origem (alguém viu um cão que ninguém
-- procurou ainda) continua sendo um card de primeira classe.
-- =============================================================================

create or replace function feed_por_raio(
  p_lat    double precision,
  p_lng    double precision,
  p_raio_m integer default 5000,
  p_tipos  post_tipo[] default array['perdido','avistado','encontrado','adocao']::post_tipo[],
  p_limite integer default 20,
  p_offset integer default 0
)
returns table (
  id           uuid,
  tipo         post_tipo,
  status       post_status,
  titulo       text,
  texto        text,
  especie      especie,
  raca         text,
  cor          text,
  endereco     text,
  ocorrido_em  timestamptz,
  distancia_m  double precision,
  autor_id     uuid,
  autor_nome   text,
  fotos        text[],
  n_avistados  bigint,
  n_comentarios bigint
)
language sql stable
set search_path = public, extensions as $$
  with origem as (select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as g)
  select
    p.id, p.tipo, p.status, p.titulo, p.texto, p.especie, p.raca, p.cor,
    p.endereco, p.ocorrido_em,
    st_distance(p.local, o.g) as distancia_m,
    p.autor_id, pr.nome,
    coalesce((select array_agg(f.path order by f.ordem) from post_fotos f where f.post_id = p.id), '{}'),
    (select count(*) from posts a where a.post_origem_id = p.id and a.tipo = 'avistado'),
    (select count(*) from comentarios c where c.post_id = p.id)
  from posts p
  cross join origem o
  join profiles pr on pr.id = p.autor_id
  where p.status = 'aberto'
    and p.post_origem_id is null          -- <<< avistamento de um caso vive no rastro
    and p.tipo = any(p_tipos)
    and st_dwithin(p.local, o.g, p_raio_m)
  order by
    st_distance(p.local, o.g) * (1 + extract(epoch from now() - p.ocorrido_em) / 86400.0),
    p.ocorrido_em desc
  limit p_limite offset p_offset;
$$;
