-- =============================================================================
-- schema 13 — avisos no celular (web push)
--
-- A tabela push_subs existe desde o schema-01 e nunca foi usada. Aqui ela ganha
-- o que faltava (o opt-in do alerta de bairro e o controle de endereço morto),
-- mais a consulta que responde a única pergunta que o envio precisa fazer:
-- QUEM deve saber disto, e ainda não soube?
--
-- QUATRO MOTIVOS, nesta ordem de valor:
--   meu_caso   alguém avistou o pet que EU publiquei
--   ajudo      novidade num caso que eu compartilhei ou avistei
--   bairro     sumiu um pet dentro do raio que eu escolhi
--   resolvido  um caso que eu ajudei terminou bem
--
-- POR QUE A TABELA avisos_enviados
-- Quem dispara o envio é o app de quem publicou, logo depois de publicar. Se a
-- pessoa recarregar a página, ou se a rede der um soluço e o app tentar de novo,
-- o mesmo aviso sairia duas vezes. A trava é aqui, no banco, não na boa vontade
-- de quem chama.
--
-- E POR QUE NÃO É POR APARELHO
-- A trava é por PESSOA. Quem tem celular e computador recebe nos dois: a lista
-- inteira sai numa consulta só, e a marca é gravada depois de enviar a todos.
-- =============================================================================

set search_path = public, extensions;

-- 1. O QUE FALTAVA EM push_subs -------------------------------------------------

alter table push_subs
  add column if not exists quer_bairro boolean     not null default true,
  add column if not exists visto_em    timestamptz not null default now(),
  -- Endereço de push morre calado: o navegador desinstalado devolve 404/410 e
  -- nunca mais nada. Contar as falhas é o que permite varrer depois.
  add column if not exists falhas      smallint    not null default 0;

-- 2. O QUE JÁ FOI AVISADO -------------------------------------------------------

create table if not exists avisos_enviados (
  post_id   uuid not null references posts(id) on delete cascade,
  perfil_id uuid not null references profiles(id) on delete cascade,
  motivo    text not null check (motivo in ('meu_caso','ajudo','bairro','resolvido')),
  criado_em timestamptz not null default now(),
  primary key (post_id, perfil_id, motivo)
);

alter table avisos_enviados enable row level security;
-- Ninguém, pela API pública, tem o que fazer aqui. Só o envio (service_role,
-- que passa por cima do RLS) escreve. Sem política = sem acesso.

-- 3. QUEM PRECISA SABER ---------------------------------------------------------

/* As pessoas que ajudam um caso: quem compartilhou mais quem avistou. É a
   mesma definição de "farejadores" que o feed mostra — se um dia mudar lá,
   muda aqui junto, porque é a mesma ideia. */
create or replace function farejadores_ids(p_caso_id uuid)
returns setof uuid
language sql stable
set search_path = public, extensions as $$
  select perfil_id from compartilhamentos where post_id = p_caso_id
  union
  select autor_id from posts where post_origem_id = p_caso_id and tipo = 'avistado';
$$;

create or replace function foto_do_post(p_post_id uuid)
returns text
language sql stable
set search_path = public, extensions as $$
  select path from post_fotos where post_id = p_post_id order by ordem limit 1;
$$;

create or replace function enviado(p_post_id uuid, p_perfil_id uuid, p_motivo text)
returns boolean
language sql stable
set search_path = public, extensions as $$
  select exists (select 1 from avisos_enviados
                  where post_id = p_post_id and perfil_id = p_perfil_id and motivo = p_motivo);
$$;

/* Uma chamada, uma resposta: todas as inscrições que devem receber aviso por
   causa deste post, com o texto já resolvido do lado do banco (nome do caso,
   quem mexeu, onde) — menos quem já foi avisado.

   security definer porque o envio roda fora de qualquer sessão, e porque a
   consulta precisa enxergar inscrição de terceiro, que o RLS esconde. */
create or replace function avisos_pendentes(p_post_id uuid)
returns table (
  motivo       text,
  perfil_id    uuid,
  sub_id       uuid,
  endpoint     text,
  p256dh       text,
  auth         text,
  caso_id      uuid,
  caso_titulo  text,
  caso_tipo    post_tipo,
  caso_sexo    sexo,
  caso_foto    text,
  quem         text,
  endereco     text,
  distancia_m  double precision
)
language plpgsql stable security definer
set search_path = public, extensions as $$
declare
  p        posts;
  o        posts;          -- o caso de origem, quando p é um avistamento
  quem_fez text;
begin
  select * into p from posts where id = p_post_id;
  if not found then return; end if;

  select nome into quem_fez from profiles where id = p.autor_id;

  ---------------------------------------------------------------------------
  -- CASO ENCERRADO: quem ajudou merece saber que terminou.
  ---------------------------------------------------------------------------
  if p.status = 'resolvido' then
    return query
      select 'resolvido'::text, s.perfil_id, s.id, s.endpoint, s.p256dh, s.auth,
             p.id, p.titulo, p.tipo, p.sexo, foto_do_post(p.id),
             quem_fez, p.endereco, null::double precision
        from push_subs s
       where s.perfil_id in (select * from farejadores_ids(p.id))
         and s.perfil_id <> p.autor_id
         and not enviado(p.id, s.perfil_id, 'resolvido');
    return;
  end if;

  ---------------------------------------------------------------------------
  -- AVISTAMENTO LIGADO A UM CASO: o dono primeiro, depois quem ajuda.
  ---------------------------------------------------------------------------
  if p.tipo = 'avistado' and p.post_origem_id is not null then
    select * into o from posts where id = p.post_origem_id;
    if not found then return; end if;

    return query
      select 'meu_caso'::text, s.perfil_id, s.id, s.endpoint, s.p256dh, s.auth,
             o.id, o.titulo, o.tipo, o.sexo, foto_do_post(o.id),
             quem_fez, p.endereco, null::double precision
        from push_subs s
       where s.perfil_id = o.autor_id
         and s.perfil_id <> p.autor_id          -- quem registrou já sabe
         and not enviado(p.id, s.perfil_id, 'meu_caso');

    return query
      select 'ajudo'::text, s.perfil_id, s.id, s.endpoint, s.p256dh, s.auth,
             o.id, o.titulo, o.tipo, o.sexo, foto_do_post(o.id),
             quem_fez, p.endereco, null::double precision
        from push_subs s
       where s.perfil_id in (select * from farejadores_ids(o.id))
         and s.perfil_id <> p.autor_id
         and s.perfil_id <> o.autor_id          -- o dono já recebeu, por 'meu_caso'
         and not enviado(p.id, s.perfil_id, 'ajudo');
    return;
  end if;

  ---------------------------------------------------------------------------
  -- CASO NOVO: alerta de bairro.
  --
  -- Só 'perdido' e 'encontrado'. Adoção não é urgente — acordar o bairro por
  -- uma adoção é o caminho mais curto para a pessoa desligar os avisos, e aí
  -- ela também não recebe o que importa.
  ---------------------------------------------------------------------------
  if p.post_origem_id is null and p.tipo in ('perdido','encontrado') then
    return query
      select 'bairro'::text, s.perfil_id, s.id, s.endpoint, s.p256dh, s.auth,
             p.id, p.titulo, p.tipo, p.sexo, foto_do_post(p.id),
             quem_fez, p.endereco, st_distance(s.centro, p.local)
        from push_subs s
       where s.quer_bairro
         and s.centro is not null
         and s.perfil_id <> p.autor_id
         and st_dwithin(s.centro, p.local, s.raio_m)
         and not enviado(p.id, s.perfil_id, 'bairro');
  end if;
end $$;

-- 4. DEPOIS DE ENVIAR -----------------------------------------------------------

/* Marca de uma vez só, para o lote inteiro. Chamado pelo envio, com a chave de
   serviço — por isso não olha auth.uid(). */
create or replace function marcar_avisos(p_post_id uuid, p_perfis uuid[], p_motivo text)
returns void
language sql security definer
set search_path = public, extensions as $$
  insert into avisos_enviados (post_id, perfil_id, motivo)
  select p_post_id, unnest(p_perfis), p_motivo
  on conflict do nothing;
$$;

/* 404 ou 410 do serviço de push é sentença: aquele endereço não existe mais.
   Qualquer outro erro pode ser passageiro, então só conta e deixa viver. */
create or replace function push_falhou(p_endpoint text, p_morto boolean default false)
returns void
language plpgsql security definer
set search_path = public, extensions as $$
begin
  if p_morto then
    delete from push_subs where endpoint = p_endpoint;
  else
    update push_subs set falhas = falhas + 1 where endpoint = p_endpoint;
  end if;
end $$;

-- 5. O QUE O APP CHAMA ----------------------------------------------------------

/* Guarda (ou atualiza) a inscrição deste aparelho.

   O endereço de push é a identidade: o mesmo navegador reinscrito devolve o
   mesmo endpoint, e trocar de conta no mesmo aparelho tem de TROCAR o dono da
   inscrição — senão a pessoa nova recebe os avisos da antiga. Daí o upsert por
   endpoint, com perfil_id vindo de auth.uid(). */
create or replace function salvar_push(
  p_endpoint    text,
  p_p256dh      text,
  p_auth        text,
  p_lat         double precision default null,
  p_lng         double precision default null,
  p_raio_m      integer          default null,
  p_quer_bairro boolean          default true
)
returns void
language plpgsql security definer
set search_path = public, extensions as $$
begin
  if auth.uid() is null then
    raise exception 'Entre na sua conta para receber avisos.';
  end if;

  insert into push_subs (perfil_id, endpoint, p256dh, auth, centro, raio_m, quer_bairro)
  values (
    auth.uid(), p_endpoint, p_p256dh, p_auth,
    case when p_lat is null then null
         else st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end,
    coalesce(p_raio_m, 3000),
    p_quer_bairro
  )
  on conflict (endpoint) do update set
    perfil_id   = auth.uid(),
    p256dh      = excluded.p256dh,
    auth        = excluded.auth,
    -- Sem localização nova, mantém a que já havia: o aparelho pode estar
    -- reinscrevendo sem GPS no momento, e zerar o centro desligaria o bairro.
    centro      = coalesce(excluded.centro, push_subs.centro),
    raio_m      = excluded.raio_m,
    quer_bairro = excluded.quer_bairro,
    visto_em    = now(),
    falhas      = 0;
end $$;

create or replace function apagar_push(p_endpoint text)
returns void
language sql security definer
set search_path = public, extensions as $$
  delete from push_subs where endpoint = p_endpoint and perfil_id = auth.uid();
$$;

/* O app precisa saber, ao abrir a tela, se ESTE aparelho já está inscrito e
   com que preferência — a permissão do navegador não conta essa parte. */
create or replace function meu_push(p_endpoint text)
returns table (quer_bairro boolean, raio_m integer, tem_centro boolean)
language sql stable security definer
set search_path = public, extensions as $$
  select s.quer_bairro, s.raio_m, s.centro is not null
    from push_subs s
   where s.endpoint = p_endpoint and s.perfil_id = auth.uid();
$$;

-- Só o app entra por aqui; as funções de envio ficam fora do alcance da API.
revoke execute on function avisos_pendentes(uuid)              from anon, authenticated;
revoke execute on function marcar_avisos(uuid, uuid[], text)   from anon, authenticated;
revoke execute on function push_falhou(text, boolean)          from anon, authenticated;

notify pgrst, 'reload schema';
