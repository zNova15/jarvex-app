#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# JARVEX — Backup de Supabase con pg_dump
#
# Uso:
#   ./scripts/backup-supabase.sh
#
# Variables requeridas (en .env.local o exportadas):
#   SUPABASE_DB_HOST       → ej: aws-0-sa-east-1.pooler.supabase.com
#   SUPABASE_DB_PORT       → 5432 (session pooler) o 6543 (transaction pooler)
#   SUPABASE_DB_USER       → postgres.<project-ref>
#   SUPABASE_DB_PASSWORD   → tu DB password
#   SUPABASE_DB_NAME       → postgres
#   BACKUP_DIR             → opcional, default ~/jarvex-backups
#
# Salida: <BACKUP_DIR>/jarvex-backup-YYYYMMDD-HHMM.dump
#
# Frecuencia recomendada: diario.
# Para automatizar con cron:
#   crontab -e
#   0 3 * * * /ruta/al/repo/scripts/backup-supabase.sh >> ~/jarvex-backups/cron.log 2>&1
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

# Cargar .env.local si existe (no falla si no existe)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_DIR/.env.local"

if [[ -f "$ENV_FILE" ]]; then
  # Cargar todo lo del .env.local sin que rompa si tiene espacios
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

# Validar variables requeridas
: "${SUPABASE_DB_HOST:?SUPABASE_DB_HOST no está definido (en .env.local o exportado)}"
: "${SUPABASE_DB_USER:?SUPABASE_DB_USER no está definido}"
: "${SUPABASE_DB_PASSWORD:?SUPABASE_DB_PASSWORD no está definido}"

PORT="${SUPABASE_DB_PORT:-5432}"
DB_NAME="${SUPABASE_DB_NAME:-postgres}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/jarvex-backups}"

# Verificar que pg_dump esté instalado
if ! command -v pg_dump &> /dev/null; then
  echo "✗ pg_dump no está instalado."
  echo "  Mac:    brew install postgresql"
  echo "  Ubuntu: sudo apt install postgresql-client"
  exit 1
fi

# Crear directorio de backups si no existe
mkdir -p "$BACKUP_DIR"

# Nombre del archivo
TIMESTAMP="$(date +%Y%m%d-%H%M)"
DUMP_FILE="$BACKUP_DIR/jarvex-backup-$TIMESTAMP.dump"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "JARVEX backup → $DUMP_FILE"
echo "Host:   $SUPABASE_DB_HOST:$PORT"
echo "User:   $SUPABASE_DB_USER"
echo "DB:     $DB_NAME"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Ejecutar pg_dump
# -F c    : custom format (comprimido, recomendado)
# --no-owner --no-acl : portable, no incluye ownership/permisos del cluster
# Excluimos schemas internos de Supabase que no nos interesan en restore
export PGPASSWORD="$SUPABASE_DB_PASSWORD"
START_TIME=$(date +%s)

pg_dump \
  -h "$SUPABASE_DB_HOST" \
  -p "$PORT" \
  -U "$SUPABASE_DB_USER" \
  -d "$DB_NAME" \
  -F c \
  --no-owner \
  --no-acl \
  --exclude-schema='cron' \
  --exclude-schema='extensions' \
  --exclude-schema='graphql' \
  --exclude-schema='graphql_public' \
  --exclude-schema='pgsodium*' \
  --exclude-schema='realtime' \
  --exclude-schema='supabase_functions' \
  --exclude-schema='vault' \
  --exclude-schema='storage' \
  -f "$DUMP_FILE"

unset PGPASSWORD

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
SIZE=$(du -h "$DUMP_FILE" | cut -f1)

echo ""
echo "✓ Backup completo"
echo "  Archivo:   $DUMP_FILE"
echo "  Tamaño:    $SIZE"
echo "  Duración:  ${DURATION}s"

# Limpiar backups viejos (mantener últimos 30)
RETENTION="${BACKUP_RETENTION_DAYS:-30}"
if command -v find &> /dev/null; then
  REMOVED=$(find "$BACKUP_DIR" -name "jarvex-backup-*.dump" -type f -mtime +"$RETENTION" -print -delete 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$REMOVED" -gt 0 ]]; then
    echo "  Limpieza:  borrados $REMOVED backups con > $RETENTION días"
  fi
fi

# Listar últimos 5 backups
echo ""
echo "Últimos backups en $BACKUP_DIR:"
ls -lhrt "$BACKUP_DIR"/jarvex-backup-*.dump 2>/dev/null | tail -5 || echo "  (ninguno)"

echo ""
echo "Para verificar que se puede restaurar, correr:"
echo "  ./scripts/verify-restore.sh $DUMP_FILE"
