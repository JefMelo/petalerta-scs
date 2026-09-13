-- =============================================================================
-- schema 10 — farejadores e novidades
--
-- FAREJADORES
-- Quantas pessoas estão ajudando este caso. NÃO é o número de avistamentos:
-- é gente distinta, e cada uma conta uma vez só, tenha avistado ou apenas
-- espalhado o link.
--
--     farejadores = quem compartilhou  ∪  quem registrou avistamento
--
-- Podia ser um número inventado ("137 pessoas viram"), e seria mais bonito.
-- Mas num app onde alguém confia a busca do próprio cachorro, número inflado é
-- o tipo de coisa que, descoberta uma vez, derruba a confiança no resto.
-- Este cresce só quando alguém age de verdade.
--
-- NOVIDADES
-- O que aconteceu nos MEUS casos enquanto eu não estava olhando.
-- =============================================================================

set search_path = public, extensions;

-- 1. REGISTRAR COMPARTILHAMENTO ------------------------------------------------
-- Chamado quando a pessoa usa o botão de compartilhar. Deslogado não conta,
-- mas também não quebra: compartilhar tem de funcionar sem conta.
create or replace function registrar_compartilhamento(p_post_id uuid)
returns bigint
language plpgsql
set search_path = public, extensions as $$
begin
  if auth.uid() is not null then
    insert into compartilhamentos (post_id, perfil_id)
    values (p_post_id, auth.uid())
    on conflict (post_id, perfil_id) do nothing;
  end if;
  return farejadores_do_post(p_post_id);
end $$;

-- 2. CONTAGEM ------------------------------------------------------------------
create or replace function farejadores_do_post(p_id uuid)
returns bigint
language sql stable
set search_path = public, extensions as $$
  select count(*) from (
    select perfil_id as quem from compartilhamentos where post_id = p_id
    union
    select autor_id     from posts
     where post_origem_id = p_id and tipo = 'avistado'
  ) gente;
$$;

-- 3. FEED com farejadores ------------------------------------------------------
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
  n_farejadores bigint,
  n_comentarios bigint,
  urgencia      double precision
)
language sql stable
set search_path = public, extensions as $$
  with origem as (select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as g),
  caso as (
    select p.*,
      st_distance(p.local, o.g) as dist,
      greatest(p.ocorrido_em,
        coalesce((select max(a.ocorrido_em) from posts a
                   where a.post_origem_id = p.id and a.tipo = 'avistado'),
                 p.ocorrido_em)) as mexido_em
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
                   / (case c.tipo when 'avistado' then 24.0
                                  when 'adocao'   then 720.0
                                  else 96.0 end))
      * (1.0 / (1.0 + c.dist / 600.0))
      as urgencia
    from caso c
  )
  select
    n.id, n.tipo, n.status, n.titulo, n.texto, n.especie, n.raca, n.cor,
    n.porte, n.sexo, n.endereco, n.ocorrido_em, n.mexido_em, n.dist,
    n.autor_id, pr.nome,
    coalesce((select array_agg(f.path order by f.ordem) from post_fotos f where f.post_id = n.id), '{}'),
    (select count(*) from posts a where a.post_origem_id = n.id and a.tipo = 'avistado'),
    farejadores_do_post(n.id),
    (select count(*) from comentarios c2 where c2.post_id = n.id),
    n.urgencia
  from nota n
  join profiles pr on pr.id = n.autor_id
  order by n.urgencia desc, n.mexido_em desc
  limit p_limite offset p_offset;
$$;

-- 4. NOVIDADES -----------------------------------------------------------------
-- O que outras pessoas fizeram nos meus casos. Só avistamento por ora — é o
-- que de fato muda a vida de quem está procurando.
create or replace function minhas_novidades(p_limite integer default 30)
returns table (
  id           uuid,
  caso_id      uuid,
  caso_titulo  text,
  caso_foto    text,
  quem_id      uuid,
  quem         text,
  endereco     text,
  texto        text,
  quando       timestamptz
)
language sql stable
set search_path = public, extensions as $$
  select
    a.id, o.id, o.titulo,
    (select f.path from post_fotos f where f.post_id = o.id order by f.ordem limit 1),
    a.autor_id, pr.nome, a.endereco, a.texto, a.ocorrido_em
  from posts a
  join posts o    on o.id = a.post_origem_id
  join profiles pr on pr.id = a.autor_id
  where a.tipo = 'avistado'
    and o.autor_id = auth.uid()      -- casos MEUS
    and a.autor_id <> auth.uid()     -- o que eu mesmo registrei não é novidade
  order by a.ocorrido_em desc
  limit p_limite;
$$;

notify pgrst, 'reload schema';
