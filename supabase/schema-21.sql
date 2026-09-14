-- =============================================================================
-- schema 21 — o reencontro volta ao feed, por três dias
--
-- Até aqui, um caso encerrado SUMIA do feed no mesmo instante. Some com ele a
-- única prova pública de que o Faro funciona, e some o agradecimento a quem
-- farejou: quem ajudou a procurar nunca via o fim da história.
--
-- Agora ele volta — e SÓ POR TRÊS DIAS. Passado o prazo vive na aba
-- Reencontros, e o feed torna a ser só o que precisa de ação. Comemoração que
-- fica parada vira poluição, e poluição no topo é o que faz alguém parar de
-- abrir o app.
--
-- O PESO 0,70
-- Põe o reencontro acima de uma adoção (0,45) e abaixo de QUALQUER caso aberto
-- fresco (0,90 a 1,00). Ele aparece, mas nunca empurra para baixo alguém que
-- ainda está procurando o próprio cão às três da manhã.
--
-- E o relógio dele conta do `resolvido_em`, não da última atividade: o que
-- aconteceu por último num reencontro é o próprio encerramento.
-- =============================================================================

set search_path = public, extensions;

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
  n_comentarios bigint,
  urgencia      double precision
)
language sql stable
set search_path = public, extensions as $$
  with origem as (select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as g),
  caso as (
    select p.*,
      st_distance(p.local, o.g) as dist,
      /* Para um reencontro, o que "aconteceu por último" é o próprio
         encerramento — não o avistamento que veio antes dele. */
      coalesce(
        case when p.status = 'resolvido' then p.resolvido_em end,
        greatest(p.ocorrido_em,
          coalesce((select max(a.ocorrido_em) from posts a
                     where a.post_origem_id = p.id and a.tipo = 'avistado'),
                   p.ocorrido_em))) as mexido_em
    from posts p
    cross join origem o
    where (
        p.status = 'aberto'
        /* Reencontro recente volta ao feed: é a prova de que isto funciona, e
           quem ajudou merece ver o fim. Só por POUCO tempo — passado o prazo,
           ele vive na aba Reencontros, e o feed volta a ser só o que precisa
           de ação. Casa com `DIAS_NO_FEED` em area-busca.js. */
        or (p.status = 'resolvido'
            and p.tipo in ('perdido', 'encontrado')
            and p.resolvido_em > now() - interval '3 days')
      )
      and p.post_origem_id is null
      and p.tipo = any(p_tipos)
      and st_dwithin(p.local, o.g, p_raio_m)
  ),
  nota as (
    select c.*,
      /* Reencontro tem peso próprio: 0.70 o põe acima de uma adoção e abaixo
         de qualquer caso aberto FRESCO — nunca empurra para baixo alguém que
         ainda está procurando. */
      (case when c.status = 'resolvido' then 0.70
            else (case c.tipo when 'avistado' then 1.00 when 'perdido' then 1.00
                              when 'encontrado' then 0.90 else 0.45 end) end)
      * exp(-ln(2) * (extract(epoch from now() - c.mexido_em) / 3600.0)
                   / (case when c.status = 'resolvido' then 24.0
                           else (case c.tipo when 'avistado' then 24.0
                                             when 'adocao'   then 720.0
                                             else 96.0 end) end))
      /* A distância pesa DIFERENTE num reencontro. Num caso aberto ela diz se
         você consegue sair de casa e ajudar — por isso cai rápido. Numa
         comemoração ela só diz o quanto aquilo é "do seu bairro", e isso decai
         devagar: um pet que voltou para casa do outro lado da cidade ainda é
         uma boa notícia para quem lê. */
      * (1.0 / (1.0 + c.dist / (case when c.status = 'resolvido' then 2500.0 else 600.0 end)))
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
    (select count(*) from comentarios c2 where c2.post_id = n.id),
    n.urgencia
  from nota n
  join profiles pr on pr.id = n.autor_id
  order by n.urgencia desc, n.mexido_em desc
  limit p_limite offset p_offset;
$$;

notify pgrst, 'reload schema';

notify pgrst, 'reload schema';
