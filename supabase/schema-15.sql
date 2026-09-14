-- =============================================================================
-- schema 15 — adoção só de quem responde por ela
--
-- A TRAVA DE VERDADE NÃO ESTÁ AQUI. Ela está no schema-14, na política
-- `posts_autor_cria` (e na de UPDATE, que impede virar adoção por edição).
-- Isso é deliberado: `posts` aceita INSERT direto pelo PostgREST, então uma
-- regra que morasse só nesta função seria contornável com um curl.
--
-- O que ESTE arquivo acrescenta é a única coisa que o RLS não sabe fazer:
-- falar português. Sem isto, quem tentar publicar adoção recebe
--   "new row violates row-level security policy for table posts"
-- numa folha de formulário, e vai embora achando que o app quebrou.
--
-- ATENÇÃO A QUEM FOR MEXER: `criar_post` é INVOKER de propósito (schema-06),
-- e isso é uma QUALIDADE, não um descuido. Se alguém a transformar em
-- `security definer` para "validar melhor", o RLS deixa de valer para ela e a
-- política de adoção vira enfeite.
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

  -- A rede de segurança é o RLS; isto aqui é a explicação.
  if p_tipo = 'adocao' and not pode_doar(auth.uid()) then
    raise exception 'A adoção é publicada por ONGs e protetores cadastrados. Se o pet está com você e você não sabe de quem é, publique como "Encontrei e está comigo" — o tutor pode estar procurando agora.';
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

notify pgrst, 'reload schema';
