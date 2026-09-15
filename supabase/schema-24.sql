-- =============================================================================
-- schema 24 — três consertos achados na varredura de 15/09/2026
--
-- 1. O TELEFONE VOLTA A SER PEDIDO, NÃO ENTREGUE
--    `admin_pendentes` devolvia o `whatsapp` de todo mundo na fila, de uma vez
--    e sem registrar nada. `admin_contato` existe justamente para isso — e
--    grava em `admin_log` quem olhou o telefone de quem — mas nunca era
--    chamada: a trilha de auditoria estava escrita e morta (`admin_log` vazio).
--
--    Não é desconfiança do administrador de hoje, que é o fundador. É que um
--    dia haverá outro, e "quem viu o telefone de quem" é a única pergunta que
--    não se responde depois, se ninguém guardou.
--
-- 2. `fotos_orfas` — A REDE DE SEGURANÇA DA LIMPEZA
--    Apagar um caso apaga a linha de `post_fotos`, e com ela o ÚNICO registro
--    do nome do arquivo no bucket. A limpeza roda no navegador, depois do
--    delete: se o aparelho perder a rede ou a pessoa fechar o app naquele
--    segundo, o arquivo fica no Storage para sempre e ninguém consegue mais
--    descobrir que ele existe. A varredura achou um desses.
--
--    Agora o nome do arquivo SOBREVIVE ao caso: `apagar_post` o copia para
--    `fotos_orfas` antes de apagar. O app limpa o bucket e só então esquece a
--    linha. O que sobrar de uma tentativa que falhou é varrido na próxima vez
--    que a pessoa abrir o app. Sem cron, sem serviço extra: a fila se resolve
--    sozinha porque quem a criou volta.
--
-- 3. `n_comentarios` SAI DO FEED
--    Comentário não existe em lugar nenhum da interface — nenhum arquivo do
--    cliente menciona a palavra. Mesmo assim, toda abertura do feed rodava um
--    `count(*)` correlacionado por post para um número que ninguém lê.
--    A TABELA `comentarios` FICA (apagá-la seria destruir o que talvez um dia
--    se use); o que sai é o trabalho por consulta.
-- =============================================================================

set search_path = public, extensions;

-- 1. O TELEFONE -----------------------------------------------------------------

/* Mesma função, menos uma coluna. Quem precisa do telefone pede por
   `admin_contato`, que devolve UM número e deixa registro de quem pediu. */
drop function if exists admin_pendentes();

create function admin_pendentes()
returns table (id uuid, nome text, papel papel_perfil, cidade text,
               sobre text, criado_em timestamptz)
language plpgsql stable security definer
set search_path = public, extensions as $$
begin
  if not eh_admin() then raise exception 'Só o administrador.'; end if;
  return query
    select p.id, p.nome, p.papel, p.cidade, p.sobre, p.criado_em
      from profiles p
     where p.papel in ('ong', 'protetor') and p.aprovado_em is null
     order by p.criado_em;
end $$;

revoke execute on function admin_pendentes() from anon;

-- 2. A FILA DE FOTOS ÓRFÃS -------------------------------------------------------

create table if not exists fotos_orfas (
  path      text primary key,
  dono      uuid references auth.users on delete cascade,
  criado_em timestamptz not null default now()
);

alter table fotos_orfas enable row level security;
-- Ninguém lê nem escreve direto: só pelas três funções abaixo.
revoke all on fotos_orfas from anon, authenticated;

/* Anota nomes de arquivo que estão para ser apagados do bucket. Usada pelo
   app antes de trocar a foto do perfil ou tirar uma foto na edição de um caso
   — os dois lugares onde o nome também morre com a atualização.

   URL externa (dado de teste, `https://…`) não é nossa e não entra. */
create or replace function marcar_fotos_orfas(p_paths text[])
returns void
language sql security definer
set search_path = public, extensions as $$
  insert into fotos_orfas (path, dono)
  select x, auth.uid()
    from unnest(coalesce(p_paths, '{}')) x
   where x is not null and x <> '' and x not like 'http%'
  on conflict (path) do nothing;
$$;

/* O que ainda ficou para trás DESTA pessoa. O app pergunta ao abrir. */
create or replace function minhas_fotos_orfas()
returns setof text
language sql stable security definer
set search_path = public, extensions as $$
  select path from fotos_orfas where dono = auth.uid() order by criado_em limit 100;
$$;

/* Chamada só DEPOIS de o arquivo sair do bucket. Se o apagar falhar, a linha
   fica — e é isso que faz a fila ser uma rede e não um enfeite. */
create or replace function esquecer_fotos_orfas(p_paths text[])
returns void
language sql security definer
set search_path = public, extensions as $$
  delete from fotos_orfas
   where dono = auth.uid()
     and path = any(coalesce(p_paths, '{}'));
$$;

/* Quantas sobraram na base inteira — para a tela do administrador. Número, não
   lista: o caminho do arquivo diz de quem é a pasta. */
create or replace function fotos_orfas_pendentes()
returns integer
language sql stable security definer
set search_path = public, extensions as $$
  select case when eh_admin() then (select count(*)::integer from fotos_orfas) end;
$$;

/* O nome do arquivo passa a sobreviver ao caso. A cópia vem ANTES do delete,
   porque o `on delete cascade` de `post_fotos` leva a única pista junto.

   A anotação passa por `marcar_fotos_orfas`, que é `security definer`, em vez
   de um insert direto. Não é rodeio: `apagar_post` roda como QUEM CHAMA, e
   quem chama não tem privilégio nenhum sobre `fotos_orfas` — um insert direto
   aqui derruba o apagar inteiro com "permission denied" (foi o que o
   testar-fotos-orfas.js pegou antes de isto ir ao ar). Emprestar o privilégio
   só para a anotação é melhor do que tornar `apagar_post` definer, o que
   tiraria o RLS de cima do delete. */
create or replace function apagar_post(p_id uuid)
returns void
language plpgsql
set search_path = public, extensions as $$
begin
  if not exists (select 1 from posts
                  where id = p_id and (autor_id = auth.uid() or eh_admin())) then
    raise exception 'Só quem publicou pode apagar este caso.';
  end if;

  /* Inclui as fotos dos AVISTAMENTOS ligados a este caso: o cascade de
     `posts.post_origem_id` apaga os filhos, e as fotos deles sumiriam do
     registro do mesmo jeito. */
  perform marcar_fotos_orfas(array(
    select f.path
      from post_fotos f
      join posts p on p.id = f.post_id
     where p.id = p_id or p.post_origem_id = p_id));

  delete from posts where id = p_id and (autor_id = auth.uid() or eh_admin());
end $$;

/* `revoke ... from anon` sozinho não fecha nada: o Postgres dá EXECUTE a
   PUBLIC por padrão, e `anon` continua entrando por essa porta. Fechar é tirar
   de PUBLIC e devolver a quem deve ter. */
revoke execute on function marcar_fotos_orfas(text[])   from public, anon;
revoke execute on function minhas_fotos_orfas()         from public, anon;
revoke execute on function esquecer_fotos_orfas(text[]) from public, anon;
revoke execute on function fotos_orfas_pendentes()      from public, anon;

grant execute on function marcar_fotos_orfas(text[])    to authenticated;
grant execute on function minhas_fotos_orfas()          to authenticated;
grant execute on function esquecer_fotos_orfas(text[])  to authenticated;
grant execute on function fotos_orfas_pendentes()       to authenticated;

-- 3. O FEED SEM O CONTADOR MORTO -------------------------------------------------

/* Recriada a partir da versão do schema-22, tirando `n_comentarios` do retorno
   e o `count(*)` que o alimentava. Todo o resto — pesos, meia-vida, `mexido_em`
   e o filtro de `aberto` — é igual, palavra por palavra. */
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
  resolvido_em  timestamptz,
  distancia_m   double precision,
  autor_id      uuid,
  autor_nome    text,
  autor_avatar  text,
  autor_papel   papel_perfil,
  fotos         text[],
  n_avistados   bigint,
  n_farejadores bigint,
  urgencia      double precision
)
language sql stable
set search_path = public, extensions as $$
  with origem as (select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as g),
  caso as (
    select p.*,
      st_distance(p.local, o.g) as dist,
      -- Caso que recebe avistamento volta ao topo: a idade que conta é a da
      -- última atividade, não a da publicação.
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
    n.porte, n.sexo, n.endereco, n.ocorrido_em, n.mexido_em, n.resolvido_em, n.dist,
    n.autor_id, pr.nome, pr.avatar_path, pr.papel,
    coalesce((select array_agg(f.path order by f.ordem) from post_fotos f where f.post_id = n.id), '{}'),
    (select count(*) from posts a where a.post_origem_id = n.id and a.tipo = 'avistado'),
    farejadores_do_post(n.id),
    n.urgencia
  from nota n
  join profiles pr on pr.id = n.autor_id
  order by n.urgencia desc, n.mexido_em desc
  limit p_limite offset p_offset;
$$;

notify pgrst, 'reload schema';
