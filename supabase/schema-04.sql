-- =============================================================================
-- schema 04 — a ficha do caso vive no post
--
-- Visto ao ligar a tela de detalhe no banco: sexo, castrado e sinais só
-- existiam em 'pets'. Mas avistamento não tem pet (pet_id é nulo por regra),
-- e é justamente quem viu o animal na rua que consegue descrever sexo, porte
-- e marcas. Estes campos são a OBSERVAÇÃO daquele momento, não o cadastro do
-- pet — então pertencem ao post.
-- =============================================================================

alter table posts
  add column if not exists sexo     sexo not null default 'desconhecido',
  add column if not exists castrado boolean,
  add column if not exists sinais   text;

-- Backfill dos dados de teste
update posts set sexo='macho', castrado=true,
  sinais='Coleira azul com plaquinha. Tem uma falha de pelo na orelha esquerda.'
 where id='11111111-1111-4111-8111-000000000001';
update posts set sexo='femea', castrado=true,
  sinais='Rabo curto e grosso. Falta um pedacinho da orelha direita.'
 where id='11111111-1111-4111-8111-000000000003';
update posts set sexo='femea' where id='11111111-1111-4111-8111-000000000004';
update posts set sexo='femea', castrado=false where id='11111111-1111-4111-8111-000000000005';
update posts set sexo='macho', castrado=true where id='11111111-1111-4111-8111-000000000006';
