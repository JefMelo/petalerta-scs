-- =============================================================================
-- schema 25 — a fila de faxina não apaga o que ainda está em uso
--
-- POR QUE ISTO EXISTE, E É UM ERRO MEU
-- Ao varrer o bucket à mão, cruzei os arquivos com `post_fotos` e chamei de
-- órfão tudo o que não estava lá. Um deles não era órfão: era o `avatar_path`
-- de um perfil — a foto de perfil não mora em `post_fotos`. Apaguei a foto de
-- alguém achando que fazia faxina.
--
-- O código não tinha esse defeito (a troca de avatar só apaga a foto velha
-- DEPOIS que o perfil novo é gravado). Mas a fila `fotos_orfas` aceitava
-- qualquer caminho e mandava apagar sem perguntar, então bastava um caminho
-- entrar nela por engano — por um bug futuro, ou por uma mão como a minha —
-- para o arquivo sumir de um caso ou de um perfil que ainda o mostra.
--
-- Agora a fila é uma LISTA DE CANDIDATOS, não uma ordem de execução. Antes de
-- entregar um caminho para apagar, confere-se que nada mais aponta para ele:
-- nenhuma foto de caso, nenhum avatar, nenhum recado. Um caminho que voltou a
-- ser usado simplesmente não é entregue, e fica na fila sem fazer mal a
-- ninguém.
--
-- É mais barato do que parece: são três buscas por índice num punhado de
-- caminhos, e só quando há fila — que no dia normal está vazia.
-- =============================================================================

set search_path = public, extensions;

create or replace function minhas_fotos_orfas()
returns setof text
language sql stable security definer
set search_path = public, extensions as $$
  select o.path
    from fotos_orfas o
   where o.dono = auth.uid()
     -- Voltou a ser a foto de um caso? Então não é órfã.
     and not exists (select 1 from post_fotos f where f.path = o.path)
     -- É a foto de perfil de alguém? Foi assim que eu apaguei a de um.
     and not exists (select 1 from profiles p where p.avatar_path = o.path)
     -- Recado do Faro também tem foto própria (schema-18).
     and not exists (select 1 from recados r where r.foto_path = o.path)
   order by o.criado_em
   limit 100;
$$;

/* Os índices que fazem a conferência acima custar quase nada. `post_fotos.path`
   e `recados.foto_path` nunca tiveram índice porque ninguém buscava por eles —
   agora busca. */
create index if not exists post_fotos_path_idx  on post_fotos (path);
create index if not exists profiles_avatar_idx  on profiles (avatar_path);
create index if not exists recados_foto_idx     on recados (foto_path);

notify pgrst, 'reload schema';
