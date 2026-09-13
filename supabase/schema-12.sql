-- =============================================================================
-- schema 12 — o dono lê e edita o próprio perfil
--
-- O schema-02 tirou a coluna whatsapp do alcance da API (revoke select), para
-- que ninguém leia o telefone alheio. Correto — mas o próprio dono também
-- ficou sem conseguir ler o seu para editar.
--
-- A saída NÃO é devolver o grant: é uma função que só enxerga a linha de quem
-- chama. A restrição continua valendo para todo o resto.
-- =============================================================================

set search_path = public, extensions;

create or replace function meu_perfil()
returns table (
  id          uuid,
  nome        text,
  whatsapp    text,
  cidade      text,
  avatar_path text
)
language sql stable security definer
set search_path = public, extensions as $$
  select p.id, p.nome, p.whatsapp, p.cidade, p.avatar_path
    from profiles p
   where p.id = auth.uid();      -- e só ela
$$;

/* Atualiza nome, WhatsApp e foto. O id sai de auth.uid(): quem chama não
   escolhe de quem é o perfil. p_avatar_path nulo remove a foto. */
create or replace function atualizar_perfil(
  p_nome        text,
  p_whatsapp    text default null,
  p_avatar_path text default null
)
returns void
language plpgsql security definer
set search_path = public, extensions as $$
begin
  if auth.uid() is null then
    raise exception 'Entre na sua conta.';
  end if;
  if coalesce(trim(p_nome), '') = '' then
    raise exception 'O perfil precisa de um nome.';
  end if;

  update profiles set
    nome        = trim(p_nome),
    whatsapp    = nullif(regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g'), ''),
    avatar_path = p_avatar_path
  where id = auth.uid();
end $$;

notify pgrst, 'reload schema';
