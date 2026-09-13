-- =============================================================================
-- schema 02 — corrige a leitura de perfis
--
-- Problema encontrado ao testar com a chave anônima: feed_por_raio() e
-- rastro_do_post() fazem join com profiles, mas a política do schema-01 era
-- `id = auth.uid()`. Visitante deslogado não via perfil nenhum, o join zerava
-- e o feed voltava VAZIO — justo para quem chega pelo link do WhatsApp.
--
-- Causa raiz: RLS filtra LINHA, não COLUNA. Para esconder só o telefone, o
-- mecanismo certo é privilégio de coluna (GRANT), não política de linha.
-- O PostgREST respeita GRANT de coluna, então o telefone continua invisível
-- na API mesmo com a leitura de perfis liberada.
-- =============================================================================

-- 1. Perfil passa a ser legível por todos (o feed precisa do nome do autor).
drop policy if exists profiles_self_select on profiles;
create policy profiles_leitura on profiles for select using (true);

-- 2. O telefone sai do alcance da API pública, coluna a coluna.
--    Não dá para revogar uma coluna de um GRANT de tabela: revoga a tabela
--    e concede de volta só as colunas seguras.
revoke select on profiles from anon, authenticated;
grant  select (id, nome, cidade, avatar_path, criado_em) on profiles to anon, authenticated;

-- 3. O único caminho para o telefone continua sendo contato_do_post(),
--    que é security definer e exige auth.uid() não nulo.
