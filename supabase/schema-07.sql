-- =============================================================================
-- schema 07 — mapa dos pets procurados
--
-- Devolve UM ponto por caso aberto: o mais recente que se sabe dele.
-- Para um pet com rastro, esse ponto é o último AVISTAMENTO, não o lugar onde
-- sumiu — quem vai à rua procurar precisa do dado novo, não do antigo.
--
-- Inclui dois tipos, porque os dois são "pet perdido" para quem olha o mapa:
--   perdido  → tem tutor procurando
--   avistado → alguém viu um pet solto e ninguém reivindicou ainda
-- =============================================================================

set search_path = public, extensions;

create or replace function mapa_perdidos(
  p_lat    double precision,
  p_lng    double precision,
  p_raio_m integer default 20000
)
returns table (
  id           uuid,
  tipo         post_tipo,
  titulo       text,
  especie      especie,
  raca         text,
  cor          text,
  sexo         sexo,
  foto         text,
  endereco     text,
  lat          double precision,
  lng          double precision,
  visto_em     timestamptz,
  desde_tutor  boolean,
  n_avistados  bigint,
  distancia_m  double precision,
  autor_nome   text
)
language sql stable
set search_path = public, extensions as $$
  with origem as (
    select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as g
  ),
  caso as (
    select p.*,
           -- o avistamento mais recente ligado a este caso, se houver
           a.local       as a_local,
           a.ocorrido_em as a_quando,
           a.endereco    as a_onde,
           (a.id is null) as sem_avistamento
    from posts p
    left join lateral (
      select s.id, s.local, s.ocorrido_em, s.endereco
        from posts s
       where s.post_origem_id = p.id and s.tipo = 'avistado'
       order by s.ocorrido_em desc
       limit 1
    ) a on true
    where p.status = 'aberto'
      and p.tipo in ('perdido', 'avistado')
      and p.post_origem_id is null
  )
  select
    c.id, c.tipo, c.titulo, c.especie, c.raca, c.cor, c.sexo,
    (select f.path from post_fotos f where f.post_id = c.id order by f.ordem limit 1),
    coalesce(c.a_onde, c.endereco),
    st_y(coalesce(c.a_local, c.local)::geometry),
    st_x(coalesce(c.a_local, c.local)::geometry),
    coalesce(c.a_quando, c.ocorrido_em),
    c.sem_avistamento,
    (select count(*) from posts s where s.post_origem_id = c.id and s.tipo = 'avistado'),
    st_distance(coalesce(c.a_local, c.local), o.g),
    pr.nome
  from caso c
  cross join origem o
  join profiles pr on pr.id = c.autor_id
  where st_dwithin(coalesce(c.a_local, c.local), o.g, p_raio_m)
  order by st_distance(coalesce(c.a_local, c.local), o.g);
$$;
