-- =============================================================================
-- schema 08 — perfil do usuário
--
-- Um perfil público (sem telefone — ver schema-02) e a lista de tudo que a
-- pessoa publicou: casos e avistamentos, abertos e encerrados.
-- Mais editar e apagar, sempre checando o dono no servidor.
-- =============================================================================

set search_path = public, extensions;

-- 1. CABEÇALHO DO PERFIL -------------------------------------------------------
-- Números que dizem algo sobre a pessoa na comunidade: quantos casos abriu,
-- quantas vezes ajudou avisando, quantos reencontros.
create or replace function perfil_publico(p_id uuid)
returns table (
  id             uuid,
  nome           text,
  cidade         text,
  avatar_path    text,
  desde          timestamptz,
  n_casos        bigint,
  n_avistamentos bigint,
  n_reencontros  bigint
)
language sql stable
set search_path = public, extensions as $$
  select
    pr.id, pr.nome, pr.cidade, pr.avatar_path, pr.criado_em,
    (select count(*) from posts p
      where p.autor_id = pr.id and p.post_origem_id is null),
    (select count(*) from posts p
      where p.autor_id = pr.id and p.post_origem_id is not null),
    (select count(*) from posts p
      where p.autor_id = pr.id and p.status = 'resolvido')
  from profiles pr
  where pr.id = p_id;
$$;

-- 2. TUDO QUE A PESSOA PUBLICOU ------------------------------------------------
-- Inclui os avistamentos que ela fez nos casos dos outros: é parte do histórico
-- dela na comunidade, e é o que ela precisa ver para poder corrigir ou apagar.
create or replace function posts_do_perfil(
  p_perfil_id uuid,
  p_lat       double precision default null,
  p_lng       double precision default null
)
returns table (
  id             uuid,
  tipo           post_tipo,
  status         post_status,
  titulo         text,
  texto          text,
  especie        especie,
  endereco       text,
  ocorrido_em    timestamptz,
  resolvido_em   timestamptz,
  foto           text,
  n_fotos        bigint,
  n_avistados    bigint,
  post_origem_id uuid,
  origem_titulo  text,
  distancia_m    double precision
)
language sql stable
set search_path = public, extensions as $$
  select
    p.id, p.tipo, p.status, p.titulo, p.texto, p.especie, p.endereco,
    p.ocorrido_em, p.resolvido_em,
    (select f.path from post_fotos f where f.post_id = p.id order by f.ordem limit 1),
    (select count(*) from post_fotos f where f.post_id = p.id),
    (select count(*) from posts a where a.post_origem_id = p.id and a.tipo = 'avistado'),
    p.post_origem_id,
    o.titulo,
    case when p_lat is null then null
         else st_distance(p.local,
                st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography)
    end
  from posts p
  left join posts o on o.id = p.post_origem_id
  where p.autor_id = p_perfil_id
  order by p.ocorrido_em desc;
$$;

-- 3. EDITAR --------------------------------------------------------------------
-- Substitui a ficha inteira e refaz a lista de fotos na ordem recebida.
-- O dono é checado aqui: quem chama não escolhe de quem é o post.
create or replace function editar_post(
  p_id          uuid,
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
  p_fotos       text[]    default '{}'
)
returns uuid
language plpgsql
set search_path = public, extensions as $$
declare
  f text;
  i smallint := 0;
begin
  if auth.uid() is null then
    raise exception 'Entre na sua conta para editar.';
  end if;
  if coalesce(trim(p_titulo), '') = '' then
    raise exception 'O caso precisa de um título.';
  end if;

  update posts set
    titulo      = trim(p_titulo),
    texto       = nullif(trim(coalesce(p_texto, '')), ''),
    especie     = p_especie,
    raca        = nullif(trim(coalesce(p_raca, '')), ''),
    cor         = nullif(trim(coalesce(p_cor, '')), ''),
    porte       = p_porte,
    sexo        = p_sexo,
    castrado    = p_castrado,
    sinais      = nullif(trim(coalesce(p_sinais, '')), ''),
    local       = st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
    endereco    = nullif(trim(coalesce(p_endereco, '')), ''),
    ocorrido_em = coalesce(p_ocorrido_em, ocorrido_em)
  where id = p_id and autor_id = auth.uid();

  if not found then
    raise exception 'Só quem publicou pode editar este caso.';
  end if;

  delete from post_fotos where post_id = p_id;
  foreach f in array coalesce(p_fotos, '{}') loop
    insert into post_fotos (post_id, path, ordem) values (p_id, f, i);
    i := i + 1;
  end loop;

  return p_id;
end $$;

-- 4. APAGAR --------------------------------------------------------------------
-- Apagar um caso leva junto os avistamentos ligados a ele (cascade do
-- schema-01). A função devolve quantos foram, para a tela poder avisar ANTES.
create or replace function avistamentos_ligados(p_id uuid)
returns bigint
language sql stable
set search_path = public, extensions as $$
  select count(*) from posts where post_origem_id = p_id;
$$;

create or replace function apagar_post(p_id uuid)
returns void
language plpgsql
set search_path = public, extensions as $$
begin
  delete from posts where id = p_id and autor_id = auth.uid();
  if not found then
    raise exception 'Só quem publicou pode apagar este caso.';
  end if;
end $$;

-- 5. REABRIR -------------------------------------------------------------------
-- resolver_post() já existe desde o schema-01. Faltava o caminho de volta,
-- para quem encerrou por engano ou para o pet que sumiu de novo.
create or replace function reabrir_post(p_id uuid)
returns void
language plpgsql
set search_path = public, extensions as $$
begin
  update posts set status = 'aberto', resolvido_em = null
   where id = p_id and autor_id = auth.uid();
  if not found then
    raise exception 'Só quem publicou pode reabrir este caso.';
  end if;
end $$;

notify pgrst, 'reload schema';
