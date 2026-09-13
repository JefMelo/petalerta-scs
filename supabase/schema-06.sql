-- =============================================================================
-- schema 06 — publicar caso e avistamento
--
-- Por que RPC e não INSERT direto do cliente:
--   1. autor_id sai de auth.uid() no servidor. O cliente não escolhe quem assina.
--   2. o ponto entra como lat/lng comum; o cliente não precisa montar EWKT.
--   3. post + fotos numa transação só.
-- Rodam como INVOKER (sem security definer), então o RLS continua valendo.
-- =============================================================================

set search_path = public, extensions;

create or replace function criar_post(
  p_tipo        post_tipo,
  p_titulo      text,
  p_texto       text,
  p_lat         double precision,
  p_lng         double precision,
  p_endereco    text,
  p_especie     especie   default 'cao',
  p_raca        text      default null,
  p_cor         text      default null,
  p_porte       porte     default null,
  p_sexo        sexo      default 'desconhecido',
  p_castrado    boolean   default null,
  p_sinais      text      default null,
  p_ocorrido_em timestamptz default null,
  p_fotos       text[]    default '{}',
  p_origem      uuid      default null
)
returns uuid
language plpgsql
set search_path = public, extensions as $$
declare
  novo uuid;
  f    text;
  i    smallint := 0;
begin
  if auth.uid() is null then
    raise exception 'Entre na sua conta para publicar.';
  end if;
  if coalesce(trim(p_titulo), '') = '' then
    raise exception 'O caso precisa de um título.';
  end if;
  if p_lat is null or p_lng is null then
    raise exception 'Marque no mapa onde foi.';
  end if;

  -- Avistamento ligado a um caso não carrega pet próprio (regra do schema-01).
  insert into posts (autor_id, tipo, titulo, texto, especie, raca, cor, porte,
                     sexo, castrado, sinais, local, endereco, ocorrido_em, post_origem_id)
  values (auth.uid(), p_tipo, trim(p_titulo), nullif(trim(coalesce(p_texto, '')), ''),
          p_especie, nullif(trim(coalesce(p_raca, '')), ''), nullif(trim(coalesce(p_cor, '')), ''),
          p_porte, p_sexo, p_castrado, nullif(trim(coalesce(p_sinais, '')), ''),
          st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
          nullif(trim(coalesce(p_endereco, '')), ''),
          coalesce(p_ocorrido_em, now()), p_origem)
  returning id into novo;

  foreach f in array coalesce(p_fotos, '{}') loop
    insert into post_fotos (post_id, path, ordem) values (novo, f, i);
    i := i + 1;
  end loop;

  return novo;
end $$;

-- Avistamento de um caso já publicado: herda espécie e título do caso de origem,
-- para o rastro ficar coerente sem obrigar quem viu a redigitar tudo.
create or replace function criar_avistamento(
  p_origem      uuid,
  p_lat         double precision,
  p_lng         double precision,
  p_endereco    text,
  p_texto       text,
  p_ocorrido_em timestamptz default null,
  p_fotos       text[]      default '{}'
)
returns uuid
language plpgsql
set search_path = public, extensions as $$
declare
  base posts%rowtype;
begin
  select * into base from posts where id = p_origem;
  if not found then
    raise exception 'Esse caso não existe mais.';
  end if;

  return criar_post(
    'avistado'::post_tipo,
    base.titulo || ' (avistado)',
    p_texto, p_lat, p_lng, p_endereco,
    base.especie, base.raca, base.cor, base.porte, base.sexo,
    null, null, p_ocorrido_em, p_fotos, p_origem
  );
end $$;
