# JARVEX — Scripts auxiliares

Scripts de operación que NO son parte del bundle de la app. Se corren manualmente en tu máquina (o en un cron en una máquina siempre encendida).

## Setup inicial (una vez)

1. **Instalá PostgreSQL client tools** (necesario para `pg_dump` y `pg_restore`):

   ```bash
   # Mac
   brew install postgresql

   # Ubuntu/Debian
   sudo apt install postgresql-client

   # Verificar
   pg_dump --version
   ```

2. **Hacé los scripts ejecutables**:

   ```bash
   chmod +x scripts/*.sh
   ```

3. **Crear `.env.local`** en la raíz del proyecto (este archivo está en `.gitignore`, no se commitea). Plantilla:

   ```bash
   # ── Producción (origen de los backups) ──
   # Sacar de Supabase Dashboard → Settings → Database → Connection string (Session Pooler)
   SUPABASE_DB_HOST="aws-0-sa-east-1.pooler.supabase.com"
   SUPABASE_DB_PORT="5432"
   SUPABASE_DB_USER="postgres.<tu-project-ref>"
   SUPABASE_DB_PASSWORD="<tu-db-password>"
   SUPABASE_DB_NAME="postgres"

   # ── Target de prueba para verificar restore (NUNCA producción) ──
   # Crear un proyecto Supabase nuevo (free tier) solo para probar restores
   RESTORE_TARGET_HOST="aws-0-sa-east-1.pooler.supabase.com"
   RESTORE_TARGET_PORT="5432"
   RESTORE_TARGET_USER="postgres.<test-project-ref>"
   RESTORE_TARGET_PASSWORD="<test-db-password>"
   RESTORE_TARGET_NAME="postgres"

   # ── Opcionales ──
   BACKUP_DIR="$HOME/jarvex-backups"      # default: ~/jarvex-backups
   BACKUP_RETENTION_DAYS="30"             # default: 30 días
   ```

   ⚠ **NUNCA commitear `.env.local`**. Si por accidente lo hacés, rotá inmediatamente el password de Supabase.

## Scripts disponibles

### `backup-supabase.sh` — Backup diario

Genera un dump comprimido (`.dump`) de la DB de producción.

```bash
./scripts/backup-supabase.sh
```

- Sale en `~/jarvex-backups/jarvex-backup-YYYYMMDD-HHMM.dump`.
- Tamaño esperado: 10-200 MB según volumen de datos.
- Excluye schemas internos de Supabase (cron, storage, realtime, etc.) que no son recuperables fuera del cluster managed.
- Limpia automáticamente backups con más de 30 días.

#### Automatizar con cron (recomendado)

```bash
crontab -e
```

Agregar:

```
# Backup diario de JARVEX a las 3am
0 3 * * * /ruta/absoluta/al/repo/scripts/backup-supabase.sh >> ~/jarvex-backups/cron.log 2>&1
```

Verificar que corrió: `tail -50 ~/jarvex-backups/cron.log`.

### `verify-restore.sh` — Verificar que el backup se puede restaurar

**Backup que no se restauró no es backup, es archivo**. Probá la recuperación periódicamente.

```bash
./scripts/verify-restore.sh ~/jarvex-backups/jarvex-backup-20260507-0300.dump
```

- Restaura el dump en la DB definida por `RESTORE_TARGET_*` (NO producción).
- Tiene **safety check**: rehúsa correr si el target coincide con producción.
- Pide confirmación interactiva escribiendo "restaurar" (saltable con `FORCE=1`).
- Después del restore, te dice cómo verificar manualmente que los datos están bien.

#### Cómo crear el target de prueba

1. Crear un proyecto Supabase nuevo (cuenta personal, gratis): https://supabase.com/dashboard.
2. NO correr ninguna migration — el restore va a recrear todo el schema.
3. Copiar las credenciales de Settings → Database → Connection string a `RESTORE_TARGET_*` en `.env.local`.

#### Frecuencia recomendada

- Verificar restore al menos **una vez al mes**.
- Cada vez que toques el SyncEngine o las migrations.
- Antes de cualquier feature mayor que pueda modificar muchos datos.

## Troubleshooting

### `pg_dump: connection failed`

- Verificá que las credenciales sean correctas (dashboard de Supabase).
- Verificá que estés usando el **Session Pooler** (puerto 5432), NO el Transaction Pooler (puerto 6543) — `pg_dump` requiere session.
- Si usás IPv4 → considerá agregar tu IP a Supabase → Settings → Database → IP Allow List (algunos planes lo requieren).

### `permission denied: ./scripts/backup-supabase.sh`

```bash
chmod +x scripts/*.sh
```

### El dump pesa más de 1 GB

Probablemente acumulaste evidencias en `evidencias_blobs` que no se borran automáticamente. Verificar:

```sql
SELECT pg_size_pretty(pg_total_relation_size('public.evidencias_blobs'));
```

Si es muy grande, considerar excluir esa tabla del backup (ya viven en Supabase Storage).

### `pg_restore` tira warnings de "owner does not exist"

Es normal en Supabase managed. Los datos se restauran correctamente igual. Por eso usamos `--no-owner --no-acl`.

## Próximos pasos

- [ ] Configurar cron de backup diario.
- [ ] Probar `verify-restore.sh` al menos una vez para asegurar que el flujo funciona.
- [ ] Setear alerta en Sentry cuando el cron falla (Sentry Cron Monitoring — feature paga).
- [ ] Considerar Supabase Pro plan: incluye backups diarios automáticos del lado del proveedor (no reemplazan el backup propio, pero suman redundancia).
