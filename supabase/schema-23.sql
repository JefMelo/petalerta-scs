-- =============================================================================
-- schema 23 — quantos farejadores a cidade tem de verdade
--
-- O PEDIDO: um contador de comunidade, para passar credibilidade.
-- A RESSALVA QUE MUDOU O DESENHO: um contador que diz "4" prova o contrário do
-- que se quer provar. Por isso o número existe aqui inteiro e honesto, e quem
-- decide MOSTRAR é a tela — que o esconde abaixo de um piso (50, hoje, em
-- `app.js`). O banco nunca mente sobre o tamanho; a tela é que sabe calar.
--
-- O QUE É "ATIVO"
-- Quem AGIU nos últimos 30 dias: publicou um caso, avisou um avistamento
-- (que também é um post), comentou ou compartilhou.
--
-- Não é quem tem conta, e não é quem abriu o app. Duas razões:
--
-- 1. A palavra já tem dono. "Farejador" significa, em toda a interface,
--    a pessoa que AJUDOU um caso — é o que `farejadores_do_post` conta desde o
--    schema-10. Se aqui passasse a significar "quem se cadastrou", a mesma
--    palavra teria dois sentidos na mesma tela, e o maior dos dois seria o
--    menos verdadeiro.
-- 2. Cadastro acumulado é o número que toda rede social infla. Ele só sobe,
--    inclusive quando a cidade inteira parou de usar o app. Uma janela de 30
--    dias pode ENCOLHER — e é justamente por poder encolher que ela mede
--    alguma coisa.
--
-- POR QUE NÃO É `security definer`
-- As três tabelas já têm `select using (true)`: qualquer visitante pode contar
-- isto sozinho. Elevar privilégio para devolver um agregado público seria
-- criar uma porta sem precisar dela.
--
-- POR QUE NÃO TEM RAIO
-- O Faro é de uma cidade só. "128 farejadores em Santa Cruz do Sul" é a frase;
-- recortar por bairro daria um número menor e uma frase pior.
-- =============================================================================

set search_path = public, extensions;

create or replace function farejadores_ativos(p_dias integer default 30)
returns integer
language sql stable
set search_path = public, extensions as $$
  -- `union` (e não `union all`) é o coração da conta: a MESMA pessoa que
  -- publicou, comentou e compartilhou é uma pessoa, não três.
  select count(*)::integer from (
    select p.autor_id as quem
      from posts p
     where p.criado_em > now() - make_interval(days => greatest(p_dias, 1))
    union
    select c.autor_id
      from comentarios c
     where c.criado_em > now() - make_interval(days => greatest(p_dias, 1))
    union
    select s.perfil_id
      from compartilhamentos s
     where s.criado_em > now() - make_interval(days => greatest(p_dias, 1))
  ) gente;
$$;

notify pgrst, 'reload schema';
