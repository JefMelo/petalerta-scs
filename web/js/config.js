/* Conexão com o Supabase do Faro.
   A chave 'anon' é pública por natureza — quem protege os dados é o RLS,
   não o segredo da chave. NUNCA colocar aqui a service_role. */
export const SUPABASE_URL  = 'https://sxnyeokxkczrcdnsanbu.supabase.co';
export const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4bnllb2t4a2N6cmNkbnNhbmJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4MTc4MDIsImV4cCI6MjEwNDM5MzgwMn0.uDtW_mSW4B8C--RAJWXHsH2ts6B8854oXxv0QAayVk0';

/* Chave pública dos avisos (VAPID). É com ela que o navegador se inscreve, e
   ela é pública por definição — a privada vive só como segredo do Worker.
   Gerada por tools/gerar-vapid.js. TROCAR AQUI DERRUBA TODAS AS INSCRIÇÕES. */
export const VAPID_PUBLICA = 'BCsSDuAe-dnWTr1LvdHMk0Q7dOI2HLbPWoV7VfXK3qerPC4HmGG-MIebEnmw0I70hknVNzVo-OArQbnq9sctVCw';
