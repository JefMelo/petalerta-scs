-- =============================================================================
-- schema 16 — recados do Faro, e o selo de quem publica adoção
--
-- POR QUE UMA TABELA E NÃO UM VALOR NOVO EM post_tipo
-- Um recado do administrador não é uma ocorrência com um pet. Enfiá-lo em
-- `posts` custaria caro em três frentes:
--
--   1. `posts.local` é NOT NULL. Um recado não tem lugar — teria de ganhar um
--      ponto falso (o Centro), e aí apareceria no mapa, entraria no st_dwithin
--      e contaria nos raios do seletor.
--   2. ONZE funções vivas consultam `posts` (feed_por_raio, mapa_perdidos,
--      perfil_publico, posts_do_perfil, minhas_novidades, avisos_pendentes,
--      farejadores_ids, rastro_do_post, criar_post, editar_post, resolver_post).
--      Todas teriam de ser reauditadas contra o valor novo, e bastaria esquecer
--      UMA para um recado institucional virar alfinete no mapa ou acordar o
--      bairro com push.
--   3. `alter type ... add value` não pode ser usado na mesma transação em que
--      o tipo é alterado — e o editor SQL do Supabase envolve o script inteiro
--      numa transação.
--
-- Fora de `posts`, nada disso pode acontecer por descuido futuro. O preço é
-- que recado NÃO gera aviso no celular — o que é o certo: é institucional, não
-- é urgente, e vale dizer isso na tela de publicação.
--
-- O LINK EXTERNO
-- Este é o ÚNICO lugar do app onde existe um link clicável. Todo texto de caso
-- passa por esc() e nunca vira `<a>` — isso é uma proteção, não um descuido, e
-- não se afrouxa. Aqui o link vem de uma COLUNA própria, nunca do texto, e só
-- aceita https.
-- =============================================================================

set search_path = public, extensions;

create table if not exists recados (
  id          uuid primary key default gen_random_uuid(),
  autor_id    uuid not null references profiles(id) on delete cascade,
  titulo      text not null check (length(trim(titulo)) between 3 and 90),
  texto       text not null check (length(trim(texto)) between 3 and 1200),
  -- https e nada mais: fecha javascript:, data: e http em claro de uma vez.
  link        text check (link ~ '^https://[^\s<>"'']+$' and length(link) <= 300),
  link_rotulo text check (length(trim(link_rotulo)) <= 40),
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now(),
  editado_em  timestamptz,
  constraint rotulo_pede_link check (link_rotulo is null or link is not null)
);
create index if not exists recados_ativos_idx on recados (ativo, criado_em desc);

alter table recados enable row level security;

drop policy if exists recados_leitura on recados;
drop policy if exists recados_admin   on recados;

-- Quem lê o feed vê os ativos. O administrador vê também os desligados, para
-- poder religar sem ter de lembrar de cor o que existia.
create policy recados_leitura on recados for select
  using (ativo or (select eh_admin()));

create policy recados_admin on recados for all to authenticated
  using ((select eh_admin()))
  with check (autor_id = auth.uid() and (select eh_admin()));

/* O que o feed busca. Teto baixo de propósito: recado é recado, não mural.
   Dois já é o limite do que alguém lê antes de rolar até os pets. */
create or replace function recados_ativos(p_limite integer default 2)
returns table (id uuid, titulo text, texto text, link text, link_rotulo text,
               criado_em timestamptz, autor_nome text)
language sql stable
set search_path = public, extensions as $$
  select r.id, r.titulo, r.texto, r.link, r.link_rotulo, r.criado_em, pr.nome
    from recados r
    join profiles pr on pr.id = r.autor_id
   where r.ativo
   order by r.criado_em desc
   limit greatest(1, least(p_limite, 10));
$$;

create or replace function criar_recado(
  p_titulo text, p_texto text,
  p_link text default null, p_link_rotulo text default null)
returns uuid
language plpgsql security definer
set search_path = public, extensions as $$
declare novo uuid;
begin
  if not eh_admin() then raise exception 'Só o administrador.'; end if;

  /* A constraint já barra o formato. Esta checagem existe para a MENSAGEM:
     "violates check constraint" não ajuda ninguém a consertar o endereço. */
  if p_link is not null and p_link !~ '^https://' then
    raise exception 'O endereço precisa começar com https://';
  end if;

  insert into recados (autor_id, titulo, texto, link, link_rotulo)
  values (auth.uid(), trim(p_titulo), trim(p_texto),
          nullif(trim(coalesce(p_link, '')), ''),
          nullif(trim(coalesce(p_link_rotulo, '')), ''))
  returning id into novo;

  insert into admin_log (admin_id, acao, alvo, detalhe)
  values (auth.uid(), 'criar_recado', novo, left(trim(p_titulo), 60));
  return novo;
end $$;

create or replace function desligar_recado(p_id uuid, p_ativo boolean default false)
returns void
language plpgsql security definer
set search_path = public, extensions as $$
begin
  if not eh_admin() then raise exception 'Só o administrador.'; end if;
  update recados set ativo = p_ativo, editado_em = now() where id = p_id;
  if not found then raise exception 'Recado não encontrado.'; end if;
  insert into admin_log (admin_id, acao, alvo, detalhe)
  values (auth.uid(), 'recado', p_id, case when p_ativo then 'religado' else 'desligado' end);
end $$;

create or replace function apagar_recado(p_id uuid)
returns void
language plpgsql security definer
set search_path = public, extensions as $$
begin
  if not eh_admin() then raise exception 'Só o administrador.'; end if;
  delete from recados where id = p_id;
  if not found then raise exception 'Recado não encontrado.'; end if;
  insert into admin_log (admin_id, acao, alvo) values (auth.uid(), 'apagar_recado', p_id);
end $$;

/* Todos os recados, ligados e desligados — a tela de administração. */
create or replace function admin_recados()
returns table (id uuid, titulo text, texto text, link text, link_rotulo text,
               ativo boolean, criado_em timestamptz)
language plpgsql stable security definer
set search_path = public, extensions as $$
begin
  if not eh_admin() then raise exception 'Só o administrador.'; end if;
  return query
    select r.id, r.titulo, r.texto, r.link, r.link_rotulo, r.ativo, r.criado_em
      from recados r order by r.criado_em desc;
end $$;

revoke execute on function criar_recado(text, text, text, text)  from anon;
revoke execute on function desligar_recado(uuid, boolean)        from anon;
revoke execute on function apagar_recado(uuid)                   from anon;
revoke execute on function admin_recados()                       from anon;

-- =============================================================================
-- O SELO DE QUEM PUBLICA ADOÇÃO
--
-- A restrição do schema-14 só faz sentido aos olhos de quem lê o feed se o
-- leitor VIR que aquela adoção é de uma ONG. Sem o selo, a regra é invisível:
-- some uma opção do formulário e nada aparece em troca.
--
-- Custa uma coluna a mais no retorno de feed_por_raio, e portanto um
-- drop+create da função (o tipo de retorno muda).
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
  atualizado_em timestamptz,
  distancia_m   double precision,
  autor_id      uuid,
  autor_nome    text,
  autor_avatar  text,
  autor_papel   papel_perfil,
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
    n.autor_id, pr.nome, pr.avatar_path, pr.papel,
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

notify pgrst, 'reload schema';
