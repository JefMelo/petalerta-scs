-- =============================================================================
-- schema 18 — o recado vira anúncio: ganha foto
--
-- O recado nasceu como faixa fixa no topo do feed. Errado: o que o fundador
-- queria é o que o Instagram faz com anúncio — uma publicação DO ADMINISTRADOR
-- que aparece NO MEIO do feed, com a mesma cara de um post, marcada como tal.
--
-- E anúncio sem imagem, no meio de um feed que é quase só foto de pet, não se
-- parece com nada — vira um bloco de texto que o olho pula. Daí a coluna.
--
-- Reaproveita o bucket `fotos` e o mesmo caminho de upload dos casos: é o
-- mesmo tipo de arquivo, a mesma política de storage, o mesmo componente.
-- =============================================================================

set search_path = public, extensions;

alter table recados
  add column if not exists foto_path text;

/* `create or replace` não muda tipo de retorno — e o retorno muda, porque
   entra uma coluna. Derrubar antes é obrigatório, não preferência. */
drop function if exists recados_ativos(integer);
drop function if exists admin_recados();
drop function if exists criar_recado(text, text, text, text);
drop function if exists criar_recado(text, text, text, text, text);

-- A leitura do feed passa a trazer a foto.
create function recados_ativos(p_limite integer default 3)
returns table (id uuid, titulo text, texto text, link text, link_rotulo text,
               foto_path text, criado_em timestamptz, autor_nome text)
language sql stable
set search_path = public, extensions as $$
  select r.id, r.titulo, r.texto, r.link, r.link_rotulo, r.foto_path,
         r.criado_em, pr.nome
    from recados r
    join profiles pr on pr.id = r.autor_id
   where r.ativo
   order by r.criado_em desc
   limit greatest(1, least(p_limite, 10));
$$;

create function admin_recados()
returns table (id uuid, titulo text, texto text, link text, link_rotulo text,
               foto_path text, ativo boolean, criado_em timestamptz)
language plpgsql stable security definer
set search_path = public, extensions as $$
begin
  if not eh_admin() then raise exception 'Só o administrador.'; end if;
  return query
    select r.id, r.titulo, r.texto, r.link, r.link_rotulo, r.foto_path,
           r.ativo, r.criado_em
      from recados r order by r.criado_em desc;
end $$;

create function criar_recado(
  p_titulo text, p_texto text,
  p_link text default null, p_link_rotulo text default null,
  p_foto text default null)
returns uuid
language plpgsql security definer
set search_path = public, extensions as $$
declare novo uuid;
begin
  if not eh_admin() then raise exception 'Só o administrador.'; end if;

  /* A constraint já barra o formato. Esta checagem existe para a MENSAGEM:
     "violates check constraint" não ajuda ninguém a consertar o endereço. */
  if p_link is not null and p_link !~ '^https://' then
    raise exception 'O endereço precisa começar com https://';
  end if;

  insert into recados (autor_id, titulo, texto, link, link_rotulo, foto_path)
  values (auth.uid(), trim(p_titulo), trim(p_texto),
          nullif(trim(coalesce(p_link, '')), ''),
          nullif(trim(coalesce(p_link_rotulo, '')), ''),
          nullif(trim(coalesce(p_foto, '')), ''))
  returning id into novo;

  insert into admin_log (admin_id, acao, alvo, detalhe)
  values (auth.uid(), 'criar_recado', novo, left(trim(p_titulo), 60));
  return novo;
end $$;

revoke execute on function criar_recado(text, text, text, text, text) from anon;

notify pgrst, 'reload schema';
