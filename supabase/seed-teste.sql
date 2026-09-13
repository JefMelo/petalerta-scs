-- =============================================================================
-- Dados de TESTE — os mesmos casos de web/js/dados.js, agora como linhas reais.
-- Serve para provar feed_por_raio() e rastro_do_post() contra o banco.
-- Para apagar tudo: ver o final do arquivo.
-- =============================================================================

set search_path = public, extensions;

-- Atalho: ponto a partir de lat/lng
create or replace function pt(lat double precision, lng double precision)
returns geography language sql immutable
set search_path = public, extensions as $$
  select st_setsrid(st_makepoint(lng, lat), 4326)::geography
$$;

with u as (
  select
    (select id from profiles where nome = 'Jeferson Melo')  as jef,
    (select id from profiles where nome = 'Ana Souza')      as ana,
    (select id from profiles where nome = 'Carla Teixeira') as carla
)
insert into posts (id, autor_id, tipo, titulo, texto, especie, raca, cor, porte,
                   local, endereco, ocorrido_em)
select * from (values
  ('11111111-1111-4111-8111-000000000001'::uuid, (select jef from u), 'perdido'::post_tipo,
   'Thor',
   'Fugiu quando o portão ficou aberto na hora da entrega do gás. Ele é medroso, corre se chamarem alto — se vir, por favor não persiga, só me avise onde.',
   'cao'::especie, 'Vira-lata caramelo', 'Caramelo', 'medio'::porte,
   pt(-29.7205, -52.4288), 'R. Marechal Floriano, 900 · Centro', now() - interval '2 hours'),

  ('11111111-1111-4111-8111-000000000002'::uuid, (select carla from u), 'avistado'::post_tipo,
   'Cão preto, porte médio',
   'Estava parado no canteiro central, bem assustado. Sem coleira. Tentei chegar perto e ele saiu andando pro lado da rodoviária.',
   'cao'::especie, 'Sem raça definida', 'Preto', 'medio'::porte,
   pt(-29.7118, -52.4359), 'Av. Independência, altura do 1500', now() - interval '42 minutes'),

  ('11111111-1111-4111-8111-000000000003'::uuid, (select ana from u), 'perdido'::post_tipo,
   'Mel',
   'Saiu pela janela do banheiro na terça à noite. Nunca tinha saído de casa. Ela atende por "Melzinha" e é muito arisca com desconhecido.',
   'gato'::especie, 'SRD', 'Tricolor', 'pequeno'::porte,
   pt(-29.7062, -52.4201), 'R. Borges de Medeiros · Higienópolis', now() - interval '3 days'),

  ('11111111-1111-4111-8111-000000000004'::uuid, (select carla from u), 'encontrado'::post_tipo,
   'Cadela branca com manchas',
   'Está comigo em casa, segura e alimentada. Muito dócil, claramente tem dono. Só devolvo para quem descrever a coleira certinho.',
   'cao'::especie, 'SRD', 'Branco e marrom', 'pequeno'::porte,
   pt(-29.7266, -52.4245), 'R. Ramiro Barcelos · Bairro Avenida', now() - interval '19 hours'),

  ('11111111-1111-4111-8111-000000000005'::uuid, (select ana from u), 'adocao'::post_tipo,
   'Nina',
   'Resgatada do pátio da escola com mais três irmãos. Vermifugada e já usando caixinha. Entrego com termo de adoção responsável.',
   'gato'::especie, 'SRD', 'Preta', 'pequeno'::porte,
   pt(-29.7014, -52.4443), 'Bairro Universitário', now() - interval '2 days'),

  ('11111111-1111-4111-8111-000000000006'::uuid, (select jef from u), 'adocao'::post_tipo,
   'Simba',
   'Um ano, castrado, vacinado e bom com criança. Precisa de pátio — é elétrico e adora correr.',
   'cao'::especie, 'SRD', 'Caramelo', 'grande'::porte,
   pt(-29.7325, -52.4512), 'R. Gaspar Bartholomay · Santo Inácio', now() - interval '5 days')
) as v;

-- Os três avistamentos do Thor: é isso que forma o rastro.
with u as (
  select (select id from profiles where nome = 'Carla Teixeira') as carla,
         (select id from profiles where nome = 'Ana Souza')      as ana
)
insert into posts (autor_id, tipo, titulo, texto, especie, local, endereco,
                   ocorrido_em, post_origem_id)
select * from (values
  ((select carla from u), 'avistado'::post_tipo, 'Thor (avistado)',
   'Passou correndo em direção à praça, coleira azul batendo. Não parou quando chamei.',
   'cao'::especie, pt(-29.7189, -52.4271), 'Praça da Bandeira, canteiro dos fundos',
   now() - interval '96 minutes', '11111111-1111-4111-8111-000000000001'::uuid),

  ((select ana from u), 'avistado'::post_tipo, 'Thor (avistado)',
   'Estava bebendo água numa poça. Deixei ração no chão e ele comeu, mas não deixou chegar perto.',
   'cao'::especie, pt(-29.7167, -52.4243), 'R. Venâncio Aires, perto da padaria',
   now() - interval '54 minutes', '11111111-1111-4111-8111-000000000001'::uuid),

  ((select carla from u), 'avistado'::post_tipo, 'Thor (avistado)',
   'Vi agora há pouco descendo a rua sozinho, indo pro lado do arroio.',
   'cao'::especie, pt(-29.7151, -52.4219), 'R. Tenente Coronel Brito',
   now() - interval '18 minutes', '11111111-1111-4111-8111-000000000001'::uuid)
) as v;

-- Para limpar depois:
--   delete from posts;
--   -- e os usuários de teste pelo painel Auth (e-mails @teste.farejo.local)
