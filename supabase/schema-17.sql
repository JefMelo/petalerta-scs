-- =============================================================================
-- schema 17 — Reencontros
--
-- O feed nunca mostrou um final feliz. `feed_por_raio` filtra `status='aberto'`,
-- então um caso resolvido simplesmente DESAPARECE — do feed e do mapa. A única
-- pessoa que via o desfecho era quem entrava no perfil do autor e reparava numa
-- fita cinza escrito "Encerrado".
--
-- Isso é uma perda dupla: some a prova de que o Faro funciona, e some o
-- agradecimento a quem farejou. O número de farejadores que o feed exibe o caso
-- todo não tinha onde fechar o ciclo.
--
-- POR QUE NÃO É f(urgência)
-- A ordem do feed existe para fazer alguém sair de casa AGORA. Reencontro não
-- pede ação, pede leitura: um caso encerrado ontem a 8 km importa mais que um
-- de três meses atrás a 300 m. Aqui a ordem é cronológica e a distância é só
-- filtro — com padrão de 20 km (a cidade toda), porque página de comemoração
-- vazia é pior que caso distante.
-- =============================================================================

set search_path = public, extensions;

create or replace function reencontros(
  p_lat    double precision,
  p_lng    double precision,
  p_raio_m integer default 20000,
  p_limite integer default 30,
  p_offset integer default 0
)
returns table (
  id            uuid,
  tipo          post_tipo,
  titulo        text,
  texto         text,
  especie       especie,
  raca          text,
  porte         porte,
  sexo          sexo,
  endereco      text,
  ocorrido_em   timestamptz,
  resolvido_em  timestamptz,
  dias_fora     double precision,
  distancia_m   double precision,
  autor_id      uuid,
  autor_nome    text,
  autor_avatar  text,
  fotos         text[],
  n_farejadores bigint
)
language sql stable
set search_path = public, extensions as $$
  with origem as (select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as g)
  select
    p.id, p.tipo, p.titulo, p.texto, p.especie, p.raca, p.porte, p.sexo,
    p.endereco, p.ocorrido_em, p.resolvido_em,
    extract(epoch from p.resolvido_em - p.ocorrido_em) / 86400.0,
    st_distance(p.local, o.g),
    p.autor_id, pr.nome, pr.avatar_path,
    coalesce((select array_agg(f.path order by f.ordem)
                from post_fotos f where f.post_id = p.id), '{}'),
    farejadores_do_post(p.id)
  from posts p
  cross join origem o
  join profiles pr on pr.id = p.autor_id
  where p.status = 'resolvido'
    and p.post_origem_id is null           -- avistamento encerrado não é reencontro
    and p.resolvido_em is not null
    -- Adoção encerrada também é final feliz, mas a história é outra: "achou um
    -- lar", não "voltou para casa". Fica de fora até ter texto próprio.
    and p.tipo in ('perdido', 'encontrado')
    and st_dwithin(p.local, o.g, p_raio_m)
  order by p.resolvido_em desc
  limit p_limite offset p_offset;
$$;

-- =============================================================================
-- E o número do perfil, que contava errado
--
-- `perfil_publico.n_reencontros` (schema-08) conta `status='resolvido'` SEM
-- filtrar `post_origem_id is null` — as outras duas métricas filtram. Ou seja,
-- um AVISTAMENTO encerrado contava como reencontro.
--
-- Passava despercebido porque não havia onde conferir. Com a aba nova, "3
-- reencontros" no perfil e 2 cards na tela seria a primeira coisa que alguém
-- notaria.
-- =============================================================================

create or replace function perfil_publico(p_id uuid)
returns table (
  id uuid, nome text, cidade text, avatar_path text, desde timestamptz,
  n_casos bigint, n_avistamentos bigint, n_reencontros bigint
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
      where p.autor_id = pr.id
        and p.post_origem_id is null            -- ← o que faltava
        and p.status = 'resolvido')
  from profiles pr
  where pr.id = p_id;
$$;

notify pgrst, 'reload schema';
