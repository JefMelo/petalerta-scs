-- =============================================================================
-- schema 14 — papéis: farejador, protetor, ONG e administrador
--
-- Até aqui o Faro tinha um papel só. Toda política de RLS era
-- `autor_id = auth.uid()` ou `using (true)`, e a consequência prática é que
-- NINGUÉM conseguia consertar nada: um caso com telefone errado, uma foto
-- indevida ou uma conta abusiva só se resolvia abrindo o SQL editor à mão.
--
-- São QUATRO papéis, não três:
--   farejador  qualquer pessoa. Vale na hora.
--   protetor   pessoa física que resgata. Espera aprovação. Publica adoção.
--   ong        organização. Espera aprovação. Publica adoção.
--   admin      modera contas e postagens.
--
-- O protetor existe porque a regra "só ONG publica adoção" sozinha expulsaria
-- justamente quem mais resgata na cidade — gente que tira ninhada da rua e não
-- tem CNPJ. A porta é a mesma (pedido + aprovação), só muda como se apresenta.
--
-- POR QUE O ADMIN NÃO PODE SAIR DO CADASTRO
-- `raw_user_meta_data` é escrito pelo CLIENTE. Quem se cadastra pode mandar
-- `papel: "admin"` no corpo da requisição. Por isso o trigger só aceita de lá
-- 'ong' e 'protetor' — que nascem PENDENTES, logo mentir não dá poder nenhum —
-- e 'admin' vem exclusivamente da lista de e-mails abaixo.
--
-- RODAR ESTE ARQUIVO INTEIRO DE UMA VEZ. Ele derruba e recria as políticas de
-- `posts`; colado em pedaços, existe uma janela em que a tabela fica sem
-- política de INSERT e NINGUÉM consegue publicar.
-- =============================================================================

set search_path = public, extensions;

-- 1. O PAPEL --------------------------------------------------------------------

do $$ begin
  create type papel_perfil as enum ('farejador', 'protetor', 'ong', 'admin');
exception when duplicate_object then null; end $$;

alter table profiles
  add column if not exists papel        papel_perfil not null default 'farejador',
  -- Nulo = esperando o administrador. É o registro da decisão, com data e
  -- autor, não um booleano solto que não conta a história.
  add column if not exists aprovado_em  timestamptz,
  /* `on delete set null` não é detalhe: sem ele, apagar um administrador que
     já aprovou alguém é IMPOSSÍVEL — a chave estrangeira barra, e a conta fica
     presa no banco para sempre. Um ponteiro de auditoria não pode travar a
     exclusão de uma conta; quem guarda o rastro é o admin_log. */
  add column if not exists aprovado_por uuid references profiles(id) on delete set null,
  add column if not exists sobre        text;

-- Quem já existia é farejador aprovado: ninguém perde acesso com este schema.
update profiles set aprovado_em = coalesce(aprovado_em, criado_em)
 where papel = 'farejador' and aprovado_em is null;

create index if not exists profiles_pendentes_idx
  on profiles (papel) where aprovado_em is null;

/* ARMADILHA DO schema-02: lá o `select` em profiles foi revogado e devolvido
   COLUNA A COLUNA, para esconder o whatsapp. Toda coluna nova nasce, portanto,
   invisível para a API — inclusive para funções `stable` comuns como
   perfil_publico(), que rodam como quem chama.

   `papel` é informação pública (é o selo "ONG" ao lado do nome). Já
   `aprovado_em`, `aprovado_por` e `sobre` são material de moderação e ficam
   de fora, alcançáveis só pelas funções da seção 8. */
grant select (papel) on profiles to anon, authenticated;

-- 2. QUEM É ADMINISTRADOR -------------------------------------------------------

/* Lista de e-mails, não de contas: o administrador pode ainda não ter se
   cadastrado. Assim funciona nos dois sentidos — promove quem já existe e
   promove quem se cadastrar depois. */
create table if not exists admins_email (
  email     text primary key,
  criado_em timestamptz not null default now()
);

insert into admins_email (email) values ('melo.jeferson@hotmail.com')
  on conflict do nothing;

-- RLS ligado e SEM política, mais revoke: esta lista não é da conta de ninguém.
alter table admins_email enable row level security;
revoke all on admins_email from anon, authenticated;

-- 3. O TRIGGER DE CADASTRO ------------------------------------------------------

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  pedido      text := lower(trim(coalesce(new.raw_user_meta_data->>'papel', '')));
  eh_da_casa  boolean;
  papel_final papel_perfil;
begin
  select exists (select 1 from admins_email a
                  where a.email = lower(trim(new.email)))
    into eh_da_casa;

  papel_final := case
    -- Só a lista decide quem é administrador. O metadado NUNCA.
    when eh_da_casa                    then 'admin'::papel_perfil
    when pedido in ('ong', 'protetor') then pedido::papel_perfil
    else 'farejador'::papel_perfil
  end;

  insert into profiles (id, nome, whatsapp, papel, sobre, aprovado_em)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
    nullif(regexp_replace(coalesce(new.raw_user_meta_data->>'whatsapp', ''), '\D', '', 'g'), ''),
    papel_final,
    nullif(trim(coalesce(new.raw_user_meta_data->>'sobre', '')), ''),
    -- ONG e protetor entram na fila; o resto já vale.
    case when papel_final in ('ong', 'protetor') then null else now() end
  );
  return new;
end $$;

/* Promove quem JÁ existe com um e-mail da lista. Idempotente: rodar o schema
   duas vezes não faz diferença. */
update profiles p set papel = 'admin', aprovado_em = coalesce(p.aprovado_em, now())
  from auth.users u, admins_email a
 where u.id = p.id and lower(trim(u.email)) = a.email and p.papel <> 'admin';

-- 4. O BURACO QUE ISTO ABRIRIA, FECHADO NA MESMA HORA ---------------------------

/* `profiles_self_update` (schema-01) deixa qualquer um dar PATCH na própria
   linha, e RLS filtra LINHA, não COLUNA. Com uma coluna `papel`, isso seria
   AUTO-PROMOÇÃO A ADMINISTRADOR por uma requisição HTTP — um vetor mais direto
   que o do metadado.

   O app já escreve perfil só por `atualizar_perfil()` (schema-12, definer), ou
   seja, a escrita direta não é usada por ninguém. Então ela simplesmente sai. */
drop policy if exists profiles_self_update on profiles;
revoke insert, update, delete on profiles from anon, authenticated;

/* Cinto e suspensório. Se um dia alguém devolver o grant por engano — e é o
   tipo de engano que não dá erro nenhum — o que dá PODER continua fora de
   alcance.

   O que é proibido a quem não é administrador, e nada além disso:
     · virar 'admin';
     · APROVAR a si mesmo (pôr data em aprovado_em);
     · mexer na linha de outra pessoa.

   O que continua permitido, porque é justamente o pedido de cadastro:
   trocar o PRÓPRIO papel para 'ong'/'protetor' deixando aprovado_em NULO —
   isto é, entrar na fila. Entrar na fila não dá poder nenhum. */
create or replace function profiles_trava_papel()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null
     or exists (select 1 from profiles where id = auth.uid() and papel = 'admin') then
    return new;                                   -- administrador ou service_role
  end if;

  if new.papel = 'admin' and old.papel <> 'admin' then
    raise exception 'Só um administrador muda papel.';
  end if;
  if new.aprovado_em is distinct from old.aprovado_em and new.aprovado_em is not null then
    raise exception 'Só um administrador aprova um cadastro.';
  end if;
  if new.id <> auth.uid() then
    raise exception 'Isso é de outra pessoa.';
  end if;

  return new;
end $$;

drop trigger if exists profiles_trava_papel_t on profiles;
create trigger profiles_trava_papel_t before update on profiles
  for each row execute function profiles_trava_papel();

-- 5. AS DUAS PERGUNTAS QUE O RESTO DO BANCO FAZ ---------------------------------

/* security definer NÃO é enfeite aqui: uma política de `profiles` que chame
   uma função INVOKER que lê `profiles` entra em recursão infinita. Como
   definer roda com o dono da tabela, o RLS não é reavaliado.

   Corolário que vale escrever: NUNCA `alter table profiles force row level
   security`. Isso faz o RLS valer até para o dono e reintroduz a recursão. */
create or replace function eh_admin(p_id uuid default auth.uid())
returns boolean
language sql stable security definer
set search_path = public, extensions as $$
  select exists (select 1 from profiles where id = p_id and papel = 'admin');
$$;

create or replace function pode_doar(p_id uuid default auth.uid())
returns boolean
language sql stable security definer
set search_path = public, extensions as $$
  select exists (
    select 1 from profiles
     where id = p_id
       and (papel = 'admin'
            or (papel in ('ong', 'protetor') and aprovado_em is not null)));
$$;

/* O que o app precisa saber sobre a PRÓPRIA conta para montar a tela. */
create or replace function meu_papel()
returns table (papel papel_perfil, aprovado boolean, pode_doar boolean, eh_admin boolean)
language sql stable security definer
set search_path = public, extensions as $$
  select p.papel,
         p.aprovado_em is not null,
         pode_doar(p.id),
         p.papel = 'admin'
    from profiles p
   where p.id = auth.uid();
$$;

-- 6. POLÍTICAS ------------------------------------------------------------------

/* `(select eh_admin())` e não `eh_admin()` solto: dentro de política, a forma
   com subselect vira InitPlan e é avaliada UMA vez por consulta, em vez de uma
   vez por linha candidata. */

/* POSTS.
   A regra da adoção vive AQUI, não só na RPC: `posts_autor_cria` permite
   INSERT direto pelo PostgREST, então uma trava que morasse só em criar_post()
   seria contornável com um curl. */
drop policy if exists posts_autor_cria  on posts;
drop policy if exists posts_autor_edita on posts;
drop policy if exists posts_autor_apaga on posts;

create policy posts_autor_cria on posts for insert to authenticated
  with check (
    autor_id = auth.uid()
    and (tipo <> 'adocao' or (select pode_doar(auth.uid())))
  );

create policy posts_autor_edita on posts for update to authenticated
  using ((autor_id = auth.uid() or (select eh_admin())))
  with check (
    (autor_id = auth.uid() or (select eh_admin()))
    /* Sem esta linha, a trava da criação seria teatro: bastava publicar
       'perdido' e depois dar PATCH {"tipo":"adocao"}.
       É `pode_doar(autor_id)`, não `auth.uid()`, para o administrador
       conseguir editar o post de uma ONG sem ser barrado. */
    and (tipo <> 'adocao' or pode_doar(autor_id))
  );

create policy posts_autor_apaga on posts for delete to authenticated
  using (autor_id = auth.uid() or (select eh_admin()));

-- PETS: o mesmo poder, senão o admin apaga o caso e o pet fica órfão no banco.
drop policy if exists pets_dono_edita on pets;
drop policy if exists pets_dono_apaga on pets;
create policy pets_dono_edita on pets for update to authenticated
  using (dono_id = auth.uid() or (select eh_admin()))
  with check (dono_id = auth.uid() or (select eh_admin()));
create policy pets_dono_apaga on pets for delete to authenticated
  using (dono_id = auth.uid() or (select eh_admin()));

/* FOTOS: tirar uma foto indevida do ar sem apagar o caso inteiro. */
drop policy if exists fotos_autor       on post_fotos;
drop policy if exists fotos_autor_apaga on post_fotos;

create policy fotos_autor on post_fotos for insert to authenticated
  with check (exists (select 1 from posts p
                       where p.id = post_id and p.autor_id = auth.uid())
              or (select eh_admin()));

create policy fotos_autor_apaga on post_fotos for delete to authenticated
  using (exists (select 1 from posts p
                  where p.id = post_id and p.autor_id = auth.uid())
         or (select eh_admin()));

-- COMENTÁRIOS: moderação.
drop policy if exists comentarios_apaga on comentarios;
create policy comentarios_apaga on comentarios for delete to authenticated
  using (autor_id = auth.uid() or (select eh_admin()));

/* STORAGE — o buraco que passa despercebido. `fotos_remocao` (schema-01) exige
   que a pasta seja o uid de quem chama. Sem esta política, o administrador
   apaga o post e as imagens ficam no bucket PARA SEMPRE, sem meio de saber
   quais eram depois que as linhas sumiram. */
drop policy if exists fotos_remocao_admin on storage.objects;
create policy fotos_remocao_admin on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and (select eh_admin()));

-- push_subs e avisos_enviados ficam como estão, de propósito: moderar não é
-- ler a agenda da cidade.

-- 7. AS RPCs DE POST PASSAM A ACEITAR O ADMINISTRADOR ---------------------------

/* O administrador age pelo MESMO caminho do dono, não por um caminho paralelo.
   Uma segunda porta seria uma segunda chance de errar. Sem isto, as políticas
   acima liberam o RLS mas as funções continuam dizendo "Só quem publicou
   pode…" — e o administrador conclui que o painel está quebrado. */

create or replace function resolver_post(p_post_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  update posts set status = 'resolvido', resolvido_em = now()
   where id = p_post_id and (autor_id = auth.uid() or eh_admin());
  if not found then
    raise exception 'Só quem publicou pode encerrar este caso.';
  end if;
end $$;

create or replace function reabrir_post(p_id uuid)
returns void
language plpgsql
set search_path = public, extensions as $$
begin
  update posts set status = 'aberto', resolvido_em = null
   where id = p_id and (autor_id = auth.uid() or eh_admin());
  if not found then
    raise exception 'Só quem publicou pode reabrir este caso.';
  end if;
end $$;

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
  where id = p_id and (autor_id = auth.uid() or eh_admin());

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

create or replace function apagar_post(p_id uuid)
returns void
language plpgsql
set search_path = public, extensions as $$
begin
  delete from posts where id = p_id and (autor_id = auth.uid() or eh_admin());
  if not found then
    raise exception 'Só quem publicou pode apagar este caso.';
  end if;
end $$;

-- 8. O QUE SÓ O ADMINISTRADOR CHAMA ---------------------------------------------

/* Registro do que o administrador fez. Poder sem rastro é o tipo de coisa que
   só incomoda no dia em que alguém pergunta "quem apagou aquilo?". */
create table if not exists admin_log (
  id        bigserial primary key,
  admin_id  uuid not null references profiles(id),
  acao      text not null,
  alvo      uuid,
  detalhe   text,
  criado_em timestamptz not null default now()
);
alter table admin_log enable row level security;   -- sem política: só definer escreve
revoke all on admin_log from anon, authenticated;

/* Todas começam pela mesma pergunta. Repetir a checagem em cada uma é chato e
   é certo: a função é a fronteira, e fronteira não se presume. */

create or replace function admin_pendentes()
returns table (id uuid, nome text, papel papel_perfil, cidade text,
               whatsapp text, sobre text, criado_em timestamptz)
language plpgsql stable security definer
set search_path = public, extensions as $$
begin
  if not eh_admin() then raise exception 'Só o administrador.'; end if;
  return query
    /* O telefone aparece AQUI e só aqui: é com ele que se confere se a
       organização existe de verdade. Não é leitura geral de agenda — não há
       nenhuma função que devolva a lista de telefones da base. */
    select p.id, p.nome, p.papel, p.cidade, p.whatsapp, p.sobre, p.criado_em
      from profiles p
     where p.papel in ('ong', 'protetor') and p.aprovado_em is null
     order by p.criado_em;
end $$;

create or replace function admin_decidir(p_id uuid, p_aprovar boolean)
returns void
language plpgsql security definer
set search_path = public, extensions as $$
begin
  if not eh_admin() then raise exception 'Só o administrador.'; end if;

  if p_aprovar then
    update profiles set aprovado_em = now(), aprovado_por = auth.uid()
     where id = p_id and papel in ('ong', 'protetor');
  else
    -- Recusar não apaga a conta: vira farejador e continua ajudando.
    update profiles set papel = 'farejador', aprovado_em = now(), aprovado_por = auth.uid()
     where id = p_id and papel in ('ong', 'protetor');
  end if;

  if not found then raise exception 'Esse pedido não está mais na fila.'; end if;

  insert into admin_log (admin_id, acao, alvo, detalhe)
  values (auth.uid(), 'decidir_pedido', p_id, case when p_aprovar then 'aprovado' else 'recusado' end);
end $$;

create or replace function admin_contas(p_busca text default null, p_limite integer default 50)
returns table (id uuid, nome text, papel papel_perfil, cidade text,
               aprovado boolean, criado_em timestamptz, n_casos bigint)
language plpgsql stable security definer
set search_path = public, extensions as $$
begin
  if not eh_admin() then raise exception 'Só o administrador.'; end if;
  return query
    select p.id, p.nome, p.papel, p.cidade, p.aprovado_em is not null, p.criado_em,
           (select count(*) from posts o where o.autor_id = p.id and o.post_origem_id is null)
      from profiles p
     where coalesce(trim(p_busca), '') = ''
        or p.nome ilike '%' || trim(p_busca) || '%'
     order by p.criado_em desc
     limit greatest(1, least(p_limite, 200));
end $$;

create or replace function admin_mudar_papel(p_id uuid, p_papel papel_perfil)
returns void
language plpgsql security definer
set search_path = public, extensions as $$
begin
  if not eh_admin() then raise exception 'Só o administrador.'; end if;
  if p_id = auth.uid() then
    /* Com uma conta de administrador só, um rebaixamento por engano deixa o
       sistema SEM administrador e sem caminho de volta pelo app — só um update
       à mão no painel do Supabase resolveria. */
    raise exception 'Não dá para mudar o próprio papel.';
  end if;

  update profiles set
    papel        = p_papel,
    aprovado_em  = case when p_papel in ('ong','protetor') then null else now() end,
    aprovado_por = auth.uid()
   where id = p_id;

  if not found then raise exception 'Conta não encontrada.'; end if;

  insert into admin_log (admin_id, acao, alvo, detalhe)
  values (auth.uid(), 'mudar_papel', p_id, p_papel::text);
end $$;

/* O contato de alguém que nunca publicou — `contato_do_post` só serve para
   autores. Registra quem olhou: é o que torna o acesso auditável. */
create or replace function admin_contato(p_perfil_id uuid)
returns text
language plpgsql security definer
set search_path = public, extensions as $$
declare tel text;
begin
  if not eh_admin() then raise exception 'Só o administrador.'; end if;
  select regexp_replace(coalesce(whatsapp, ''), '\D', '', 'g') into tel
    from profiles where id = p_perfil_id;
  insert into admin_log (admin_id, acao, alvo) values (auth.uid(), 'contato', p_perfil_id);
  return nullif(tel, '');
end $$;

-- 9. O PEDIDO DE QUEM JÁ TEM CONTA ----------------------------------------------

/* Não é o administrador que chama — é a pessoa que quer publicar adoção. */
create or replace function pedir_para_doar(p_papel papel_perfil, p_sobre text)
returns void
language plpgsql security definer
set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.'; end if;
  if p_papel not in ('ong', 'protetor') then
    raise exception 'Escolha ONG ou protetor.';
  end if;
  if coalesce(trim(p_sobre), '') = '' then
    raise exception 'Conte um pouco sobre o seu trabalho — é o que o administrador lê para decidir.';
  end if;
  if eh_admin() then raise exception 'O administrador já pode publicar adoção.'; end if;

  update profiles set papel = p_papel, sobre = trim(p_sobre), aprovado_em = null
   where id = auth.uid();
end $$;

/* Quem já está aprovado para doar. Público: é a lista que o app oferece a quem
   resgatou uma ninhada e não pode publicar adoção sozinho. */
create or replace function ongs_ativas()
returns table (id uuid, nome text, papel papel_perfil, cidade text, avatar_path text)
language sql stable security definer
set search_path = public, extensions as $$
  select p.id, p.nome, p.papel, p.cidade, p.avatar_path
    from profiles p
   where p.papel in ('ong', 'protetor') and p.aprovado_em is not null
   order by p.nome;
$$;

revoke execute on function admin_pendentes()                     from anon;
revoke execute on function admin_decidir(uuid, boolean)          from anon;
revoke execute on function admin_contas(text, integer)           from anon;
revoke execute on function admin_mudar_papel(uuid, papel_perfil) from anon;
revoke execute on function admin_contato(uuid)                   from anon;
revoke execute on function pedir_para_doar(papel_perfil, text)   from anon;
revoke execute on function meu_papel()                           from anon;

notify pgrst, 'reload schema';
