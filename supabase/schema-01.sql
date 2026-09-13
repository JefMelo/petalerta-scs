-- =============================================================================
-- PetAlerta SCS — schema 01 (base)
--
-- ATENÇÃO: rodar SOMENTE num projeto Supabase NOVO e VAZIO, criado só para o
-- PetAlerta. Este schema NÃO deve ser aplicado no projeto do VadeOn.
--
-- Ordem: extensões → tipos → tabelas → índices → views → funções → RLS → storage
-- =============================================================================

-- 1. EXTENSÕES -----------------------------------------------------------------
-- No schema 'extensions', não em 'public': é a convenção do Supabase. Se o PostGIS
-- for para public, ele expõe spatial_ref_sys e companhia na API REST sem necessidade.
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;  -- consulta por raio
create extension if not exists pg_trgm with schema extensions;  -- busca tolerante a erro

-- Vale para o resto do script: permite escrever geography/ST_* sem qualificar.
set search_path = public, extensions;

-- 2. TIPOS ---------------------------------------------------------------------
create type especie      as enum ('cao', 'gato', 'outro');
create type porte        as enum ('pequeno', 'medio', 'grande');
create type sexo         as enum ('macho', 'femea', 'desconhecido');
create type post_tipo    as enum ('perdido', 'avistado', 'encontrado', 'adocao');
create type post_status  as enum ('aberto', 'resolvido', 'arquivado');

-- 3. PERFIS --------------------------------------------------------------------
-- Estende auth.users. O whatsapp NÃO é público: ver a view profiles_publico
-- e a função contato_do_post() mais abaixo.
create table profiles (
  id          uuid primary key references auth.users on delete cascade,
  nome        text not null,
  whatsapp    text,
  cidade      text default 'Santa Cruz do Sul',
  avatar_path text,
  criado_em   timestamptz not null default now()
);

-- Cria o perfil automaticamente quando alguém se cadastra.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, nome, whatsapp)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
    regexp_replace(coalesce(new.raw_user_meta_data->>'whatsapp', ''), '\D', '', 'g')
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- 4. PETS ----------------------------------------------------------------------
-- Só existe para pet com tutor. Um avistamento na rua NÃO cria pet.
create table pets (
  id        uuid primary key default gen_random_uuid(),
  dono_id   uuid not null references profiles(id) on delete cascade,
  nome      text not null,
  especie   especie not null default 'cao',
  raca      text,
  cor       text,
  porte     porte,
  sexo      sexo not null default 'desconhecido',
  castrado  boolean,
  microchip text,
  sinais    text,                       -- marcas particulares, o que identifica de verdade
  criado_em timestamptz not null default now()
);
create index pets_dono_idx on pets (dono_id);

-- 5. POSTS — o feed ------------------------------------------------------------
-- pet_id é NULO de propósito: quem vê um cachorro na rua não sabe o nome dele.
-- post_origem_id liga um 'avistado' ao 'perdido' correspondente = o rastro.
create table posts (
  id             uuid primary key default gen_random_uuid(),
  autor_id       uuid not null references profiles(id) on delete cascade,
  pet_id         uuid references pets(id) on delete set null,
  tipo           post_tipo not null,
  status         post_status not null default 'aberto',
  titulo         text,                  -- nome do pet, ou "Cão caramelo" num avistamento
  texto          text,
  especie        especie not null default 'cao',
  raca           text,
  cor            text,
  porte          porte,
  local          geography(point, 4326) not null,
  endereco       text,
  ocorrido_em    timestamptz not null default now(),
  resolvido_em   timestamptz,
  post_origem_id uuid references posts(id) on delete cascade,
  criado_em      timestamptz not null default now(),

  constraint avistamento_sem_pet check (tipo <> 'avistado' or pet_id is null),
  constraint resolvido_tem_data  check (status <> 'resolvido' or resolvido_em is not null)
);
create index posts_local_idx  on posts using gist (local);
create index posts_feed_idx   on posts (status, ocorrido_em desc);
create index posts_origem_idx on posts (post_origem_id);
create index posts_autor_idx  on posts (autor_id);

-- 6. FOTOS ---------------------------------------------------------------------
create table post_fotos (
  id      uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  path    text not null,               -- caminho no bucket 'fotos'
  ordem   smallint not null default 0
);
create index post_fotos_post_idx on post_fotos (post_id, ordem);

-- 7. COMENTÁRIOS ---------------------------------------------------------------
create table comentarios (
  id        uuid primary key default gen_random_uuid(),
  post_id   uuid not null references posts(id) on delete cascade,
  autor_id  uuid not null references profiles(id) on delete cascade,
  texto     text not null check (length(trim(texto)) > 0),
  criado_em timestamptz not null default now()
);
create index comentarios_post_idx on comentarios (post_id, criado_em);

-- 8. COMPARTILHAMENTOS ---------------------------------------------------------
-- Não é curtida. Mede alcance real: quem levou o caso pra fora do app.
create table compartilhamentos (
  post_id   uuid not null references posts(id) on delete cascade,
  perfil_id uuid not null references profiles(id) on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (post_id, perfil_id)
);

-- 9. PUSH ----------------------------------------------------------------------
create table push_subs (
  id         uuid primary key default gen_random_uuid(),
  perfil_id  uuid not null references profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  centro     geography(point, 4326),   -- onde a pessoa quer ser avisada
  raio_m     integer not null default 3000,
  criado_em  timestamptz not null default now()
);
create index push_subs_centro_idx on push_subs using gist (centro);

-- 10. VIEW PÚBLICA DE PERFIL ---------------------------------------------------
-- RLS não filtra coluna, então o telefone fica fora daqui.
create view profiles_publico
with (security_invoker = true) as
  select id, nome, cidade, avatar_path from profiles;

-- 11. FEED POR RAIO ------------------------------------------------------------
-- A consulta central do app. Ordena por urgência: perto + recente primeiro.
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
    and p.tipo = any(p_tipos)
    and st_dwithin(p.local, o.g, p_raio_m)
  order by
    -- urgência = distância penalizada pela idade do caso
    st_distance(p.local, o.g) * (1 + extract(epoch from now() - p.ocorrido_em) / 86400.0),
    p.ocorrido_em desc
  limit p_limite offset p_offset;
$$;

-- 12. RASTRO DE UM PET PERDIDO -------------------------------------------------
-- É isto que o botão "Rota" do protótipo tentava ser.
create or replace function rastro_do_post(p_post_id uuid)
returns table (
  id          uuid,
  ordem       bigint,
  lat         double precision,
  lng         double precision,
  endereco    text,
  ocorrido_em timestamptz,
  texto       text,
  autor_nome  text
)
language sql stable
set search_path = public, extensions as $$
  select
    p.id,
    row_number() over (order by p.ocorrido_em),
    st_y(p.local::geometry), st_x(p.local::geometry),
    p.endereco, p.ocorrido_em, p.texto, pr.nome
  from posts p
  join profiles pr on pr.id = p.autor_id
  where p.id = p_post_id or p.post_origem_id = p_post_id
  order by p.ocorrido_em;
$$;

-- 13. CONTATO DO TUTOR ---------------------------------------------------------
-- Telefone só para quem está logado. Mesma regra do protótipo, agora no banco.
create or replace function contato_do_post(p_post_id uuid)
returns text
language plpgsql stable security definer set search_path = public as $$
declare tel text;
begin
  if auth.uid() is null then
    raise exception 'Entre na sua conta para ver o contato do tutor.';
  end if;
  select regexp_replace(coalesce(pr.whatsapp, ''), '\D', '', 'g')
    into tel
    from posts p join profiles pr on pr.id = p.autor_id
   where p.id = p_post_id;
  return tel;
end $$;

-- 14. MARCAR COMO RESOLVIDO ----------------------------------------------------
create or replace function resolver_post(p_post_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update posts
     set status = 'resolvido', resolvido_em = now()
   where id = p_post_id and autor_id = auth.uid();
  if not found then
    raise exception 'Só quem publicou pode encerrar este caso.';
  end if;
end $$;

-- 15. RLS ----------------------------------------------------------------------
alter table profiles          enable row level security;
alter table pets              enable row level security;
alter table posts             enable row level security;
alter table post_fotos        enable row level security;
alter table comentarios       enable row level security;
alter table compartilhamentos enable row level security;
alter table push_subs         enable row level security;

-- profiles: cada um lê e edita o próprio registro completo.
-- O resto do mundo lê pela view profiles_publico (sem telefone).
create policy profiles_self_select on profiles for select using (id = auth.uid());
create policy profiles_self_update on profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- pets: público para leitura (o feed precisa), escrita só do dono.
create policy pets_leitura on pets for select using (true);
create policy pets_dono_insere on pets for insert with check (dono_id = auth.uid());
create policy pets_dono_edita  on pets for update using (dono_id = auth.uid()) with check (dono_id = auth.uid());
create policy pets_dono_apaga  on pets for delete using (dono_id = auth.uid());

-- posts: qualquer um lê (inclusive deslogado — é o que faz o link do WhatsApp funcionar),
-- só autenticado publica, só o autor edita.
create policy posts_leitura     on posts for select using (true);
create policy posts_autor_cria  on posts for insert with check (autor_id = auth.uid());
create policy posts_autor_edita on posts for update using (autor_id = auth.uid()) with check (autor_id = auth.uid());
create policy posts_autor_apaga on posts for delete using (autor_id = auth.uid());

create policy fotos_leitura on post_fotos for select using (true);
create policy fotos_autor   on post_fotos for insert
  with check (exists (select 1 from posts p where p.id = post_id and p.autor_id = auth.uid()));
create policy fotos_autor_apaga on post_fotos for delete
  using (exists (select 1 from posts p where p.id = post_id and p.autor_id = auth.uid()));

create policy comentarios_leitura on comentarios for select using (true);
create policy comentarios_cria    on comentarios for insert with check (autor_id = auth.uid());
create policy comentarios_apaga   on comentarios for delete using (autor_id = auth.uid());

create policy compart_leitura on compartilhamentos for select using (true);
create policy compart_cria    on compartilhamentos for insert with check (perfil_id = auth.uid());

create policy push_self on push_subs for all using (perfil_id = auth.uid()) with check (perfil_id = auth.uid());

-- 16. STORAGE ------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('fotos', 'fotos', true)
on conflict (id) do nothing;

create policy fotos_publicas on storage.objects for select
  using (bucket_id = 'fotos');

-- Cada usuário escreve só na própria pasta: fotos/<uid>/<arquivo>
create policy fotos_envio on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy fotos_remocao on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);
