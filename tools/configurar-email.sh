#!/usr/bin/env bash
# =============================================================================
# Faro — liga o SMTP próprio e aplica os e-mails em português
#
#   ./tools/configurar-email.sh <host> <porta> <usuário> <senha> <remetente> ["Nome"]
#
# Exemplo (Brevo):
#   ./tools/configurar-email.sh smtp-relay.brevo.com 587 8a1b2c@smtp-brevo.com \
#       SUA_SENHA contato@seudominio.com.br "Faro"
#
# POR QUE OS DOIS JUNTOS
# O Supabase recusa personalizar os e-mails enquanto o projeto usa o servidor
# embutido: "Email template modification is not available for free tier projects
# using the default email provider". Então o SMTP próprio destrava as duas
# coisas de uma vez — o volume e o português.
# =============================================================================
set -euo pipefail

[ $# -ge 5 ] || { sed -n '3,12p' "$0"; exit 1; }
HOST=$1; PORTA=$2; USUARIO=$3; SENHA=$4; REMETENTE=$5; NOME=${6:-Faro}

REF=sxnyeokxkczrcdnsanbu
TOKEN=$(cat ~/.config/farejo/supabase-token)
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/3  ligando o SMTP…"
curl -sS -f --max-time 30 -X PATCH \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "$(python3 - "$HOST" "$PORTA" "$USUARIO" "$SENHA" "$REMETENTE" "$NOME" <<'PY'
import json, sys
h, p, u, s, rem, nome = sys.argv[1:7]
print(json.dumps({
  "smtp_host": h, "smtp_port": p, "smtp_user": u, "smtp_pass": s,
  "smtp_admin_email": rem, "smtp_sender_name": nome,
  # com servidor próprio o teto do Supabase deixa de valer
  "rate_limit_email_sent": 100,
  # quantos segundos entre dois e-mails para o mesmo endereço
  "smtp_max_frequency": 60,
}))
PY
)" "https://api.supabase.com/v1/projects/$REF/config/auth" > /dev/null
echo "     ok"

echo "2/3  aplicando os e-mails em português…"
curl -sS -f --max-time 30 -X PATCH \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data-binary "@$RAIZ/supabase/emails.json" \
  "https://api.supabase.com/v1/projects/$REF/config/auth" > /dev/null
echo "     ok"

echo "3/3  conferindo…"
curl -sS --max-time 25 -H "Authorization: Bearer $TOKEN" \
  "https://api.supabase.com/v1/projects/$REF/config/auth" \
| python3 -c "
import sys, json
d = json.load(sys.stdin)
print('     servidor :', d.get('smtp_host'), 'porta', d.get('smtp_port'))
print('     remetente:', d.get('smtp_sender_name'), '<' + str(d.get('smtp_admin_email')) + '>')
print('     assunto  :', repr(d.get('mailer_subjects_recovery')))
print('     limite   :', d.get('rate_limit_email_sent'), 'e-mails/hora')
ok = d.get('mailer_subjects_recovery','').startswith('Recuperar')
print()
print('     ' + ('TUDO CERTO — teste pedindo uma recuperação de senha no app.'
                 if ok else 'ATENÇÃO: os e-mails NÃO ficaram em português. Confira o plano do projeto.'))
"
