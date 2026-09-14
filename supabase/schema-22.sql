-- =============================================================================
-- schema 22 — o reencontro sai do feed e vira AVISO na aba
--
-- O schema-21 pôs o caso resolvido de volta no feed por três dias. Durou um
-- dia. A ideia do fundador é melhor, e é esta:
--
--     o feed é só de quem precisa de ajuda AGORA; a comemoração chama por um
--     pontinho no ícone de Reencontros, e a pessoa vai vê-la quando quiser.
--
-- POR QUE É MELHOR, E NÃO SÓ DIFERENTE
-- Santa Cruz do Sul não é São Paulo: são poucos casos por dia. Um reencontro
-- no meio de cinco cards é 20% de um feed cujo trabalho é dizer "alguém aqui
-- perto precisa de você". Nenhum peso baixo conserta isso — o card ocupa a
-- tela inteira do celular do mesmo jeito.
--
-- E o aviso ganha o que o card nunca teve: MOTIVO DE VOLTAR. Card no feed se
-- vê passando; pontinho no ícone se toca.
--
-- O QUE MUDA AQUI
-- 1. `feed_por_raio` volta a mostrar só `status='aberto'` (o resto do 21 —
--    pesos, meia-vida, divisor de distância — some junto, porque não há mais
--    caso resolvido no feed para pesar).
-- 2. `novos_reencontros` — a contagem por trás do pontinho.
--
-- `resolvido_em` CONTINUA na saída do feed. Não custa nada, e tirá-la exigiria
-- derrubar e recriar a função: mais risco do que benefício.
-- =============================================================================

set search_path = public, extensions;

create or replace function feed_por_raio(
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
    (select count(*) from comentarios c2 where c2.post_id = n.id),
    n.urgencia
  from nota n
  join profiles pr on pr.id = n.autor_id
  order by n.urgencia desc, n.mexido_em desc
  limit p_limite offset p_offset;
$$;

/* A contagem do pontinho. Os MESMOS filtros de `reencontros` — se contasse
   diferente do que a aba mostra, o pontinho anunciaria dois reencontros e a
   pessoa abriria para achar um: a próxima vez ela não abre mais.

   `p_desde` vem do aparelho (a última visita à aba, guardada no navegador).
   Não há coluna de "visto" no banco de propósito: isso é preferência de
   leitura de UM aparelho, não fato sobre o caso — e criar uma tabela para
   guardá-la significaria que visitante deslogado não teria aviso nenhum. */
create or replace function novos_reencontros(
  p_lat    double precision,
  p_lng    double precision,
  p_desde  timestamptz,
  p_raio_m integer default 20000
)
returns integer
language sql stable
set search_path = public, extensions as $$
  select count(*)::integer
    from posts p
   where p.status = 'resolvido'
     and p.post_origem_id is null
     and p.resolvido_em is not null
     and p.tipo in ('perdido', 'encontrado')
     and p.resolvido_em > p_desde
     and st_dwithin(p.local,
                    st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
                    p_raio_m);
$$;

notify pgrst, 'reload schema';
