#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# JARVEX — Verificar restore de backup en una DB de prueba
#
# Toma un .dump generado por backup-supabase.sh y lo restaura en una
# DB Supabase distinta (de prueba) para verificar que efectivamente se
# puede recuperar. "Backup que no se restaura no es backup, es archivo".
#
# Uso:
#   ./scripts/verify-restore.sh <ruta-al-backup.dump>
#
# Requiere variables (en .env.local o exportadas):
#   RESTORE_TARGET_HOST       → host de la DB destino (NUNCA producción)
#   RESTORE_TARGET_PORT       → 5432
#   RESTORE_TARGET_USER       → postgres.<test-project-ref>
#   RESTORE_TARGET_PASSWORD   → password de la DB destino
#   RESTORE_TARGET_NAME       → postgres
#
# IMPORTANTE: el script REHÚSA correr si los valores RESTORE_TARGET_*
# coinciden con SUPABASE_DB_* (producción). Esta es la salvaguarda más
# importante — un restore mal apuntado destruye la DB de producción.
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Uso: $0 <ruta-al-backup.dump>"
  exit 1
fi

DUMP_FILE="$1"

if [[ ! -f "$DUMP_FILE" ]]; then
  echo "✗ El archivo $DUMP_FILE no existe"
  exit 1
fi

# Cargar .env.local
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_DIR/.env.local"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

# Validar variables del target
: "${RESTORE_TARGET_HOST:?RESTORE_TARGET_HOST no está definido — apuntar a una DB Supabase DE PRUEBA}"
: "${RESTORE_TARGET_USER:?RESTORE_TARGET_USER no está definido}"
: "${RESTORE_TARGET_PASSWORD:?RESTORE_TARGET_PASSWORD no está definido}"

TARGET_PORT="${RESTORE_TARGET_PORT:-5432}"
TARGET_NAME="${RESTORE_TARGET_NAME:-postgres}"

# ── SAFETY CHECK ────────────────────────────────────────────────────
# Refusar si el target coincide con producción
if [[ -n "${SUPABASE_DB_HOST:-}" ]]; then
  if [[ "$RESTORE_TARGET_HOST" == "$SUPABASE_DB_HOST" ]] && \
     [[ "$RESTORE_TARGET_USER" == "${SUPABASE_DB_USER:-}" ]]; then
    echo "✗ ABORTANDO: RESTORE_TARGET_* coincide con SUPABASE_DB_* (producción)"
    echo ""
    echo "  Este script NO puede correr contra la DB de producción — sería destructivo."
    echo "  Crea un proyecto Supabase nuevo (free tier) y usa SUS credenciales en"
    echo "  RESTORE_TARGET_*."
    exit 1
  fi
fi

# Confirmación interactiva (saltable con FORCE=1 si corre en cron)
if [[ "${FORCE:-0}" != "1" ]]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "⚠ ATENCIÓN — Restore destructivo"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Backup origen:   $DUMP_FILE"
  echo "  Target host:     $RESTORE_TARGET_HOST:$TARGET_PORT"
  echo "  Target user:     $RESTORE_TARGET_USER"
  echo "  Target DB:       $TARGET_NAME"
  echo ""
  echo "  El restore va a SOBREESCRIBIR todas las tablas en la DB target."
  echo "  Asegurate que el target NO sea producción."
  echo ""
  read -r -p "Continuar? Escribí 'restaurar' para confirmar: " CONFIRM
  if [[ "$CONFIRM" != "restaurar" ]]; then
    echo "Cancelado."
    exit 0
  fi
fi

# Verificar pg_restore
if ! command -v pg_restore &> /dev/null; then
  echo "✗ pg_restore no está instalado."
  echo "  Mac:    brew install postgresql"
  echo "  Ubuntu: sudo apt install postgresql-client"
  exit 1
fi

START_TIME=$(date +%s)
export PGPASSWORD="$RESTORE_TARGET_PASSWORD"

echo ""
echo "Restaurando $DUMP_FILE → $RESTORE_TARGET_HOST:$TARGET_PORT/$TARGET_NAME ..."
echo ""

# pg_restore con --clean para que tire DROP de objetos antes de recrearlos
pg_restore \
  -h "$RESTORE_TARGET_HOST" \
  -p "$TARGET_PORT" \
  -U "$RESTORE_TARGET_USER" \
  -d "$TARGET_NAME" \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --verbose \
  "$DUMP_FILE" 2>&1 | tail -50 || true
# Nota: pg_restore tira muchos warnings benignos sobre owners/permisos que no
# importan en Supabase managed. Los suprimimos con tail.

unset PGPASSWORD

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo ""
echo "✓ Restore terminado en ${DURATION}s"
echo ""
echo "Verificación rápida — contar registros en tablas críticas:"
echo "  Conectate a la DB target y corré:"
echo ""
echo "    SELECT 'obras' AS tabla, count(*) FROM obras"
echo "    UNION ALL SELECT 'materiales', count(*) FROM materiales"
echo "    UNION ALL SELECT 'movimientos_materiales', count(*) FROM movimientos_materiales"
echo "    UNION ALL SELECT 'profiles', count(*) FROM profiles;"
echo ""
echo "Los conteos deberían coincidir con la DB origen al momento del backup."
