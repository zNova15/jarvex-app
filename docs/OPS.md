# JARVEX — Runbook de operaciones

Guía corta para detectar y reaccionar a problemas en producción. Pensada para que la leas a las 11 PM cuando el almacenero reporta algo.

---

## Tableros que tienes que mirar

| Qué | Dónde | Cuándo |
|---|---|---|
| Errores de la app | https://novvx-proyect.sentry.io/issues | Cuando llega alerta por mail/Discord |
| Uso real (qué pantallas se usan) | https://us.posthog.com → Activity | 1 vez por semana |
| Estado de Supabase (DB up/down) | https://supabase.com/dashboard → tu proyecto → Reports | Si la app está lenta |
| Deploys | https://vercel.com/dashboard → jarvex-app | Después de cada `git push` |
| Backups | GitHub repo → tab **Actions** → "Backup diario Supabase" | Cada mañana revisar que el último corrió OK |

## Backups

**Automático**: corre todos los días a las 03:00 Lima vía GitHub Actions. Retención 90 días. Para descargar uno: tab Actions → run del día → Artifacts.

**Manual** (urgente, antes de algo riesgoso):
```bash
cd JARVEX/jarvex-app
node scripts/backup-supabase.mjs
# Genera ~/jarvex-backups/jarvex-YYYYMMDD-HHMM/
```

**Si el workflow no corrió en >24h**: Actions tab → "Backup diario Supabase" → "Run workflow" para disparar manual. Si sigue fallando, revisar:
1. ¿Los secrets `VITE_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` están seteados en Settings → Secrets?
2. ¿El service_role_key sigue válido? Probalo localmente con `node scripts/backup-supabase.mjs`.
3. ¿Supabase está caído? Mira supabase.com/status.

**Restaurar de un backup**: el backup es JSONL. Para reimportar tabla por tabla:
```bash
# Descomprimir
tar -xzf jarvex-YYYYMMDD-HHMM.tar.gz

# Restaurar UNA tabla (ej: materiales) usando psql.
# Necesitás conexión directa a Postgres — si tu red bloquea 5432/6543,
# corrélo desde una máquina con acceso (ej: Cloud Shell de GCP/AWS).
cat jarvex-YYYYMMDD-HHMM/materiales.jsonl | \
  psql "$SUPABASE_DB_URL" -c "COPY materiales FROM STDIN WITH (FORMAT csv);"
```
> **NO restaures sobre producción sin probar primero** en un proyecto Supabase nuevo. `scripts/verify-restore.sh` automatiza esa prueba.

## Cuando llega alerta de Sentry

1. Click en el link del mail/Discord → te lleva al issue.
2. Mira el **stacktrace**: la primera línea de `src/...` es el código nuestro (lo demás suele ser node_modules).
3. Mira **Tags** → `module`, `operation`, `table` te dicen qué subsistema falló.
4. Mira **Extra Data** → contexto serializado del error.
5. Si tiene **Session Replay**, abrilo: vas a ver exactamente qué hizo el usuario.
6. Para análisis de causa-raíz automatizado: en Sentry, botón "Analyze with Seer" (toma ~3 min).

**Severidades típicas**:
- `module: sync-engine` → bug de sincronización local↔server. Puede dejar records en FAILED. Revisar primero.
- `module: rls` → un user intentó leer/escribir algo que no le corresponde. Si es false positive, ajustar política en `supabase/migrations/033_rls_por_roles.sql`.
- Errores de PostgREST (`PGRST*`) → suele ser schema cache desactualizado o columna que no existe. Normalmente se resuelve con un deploy nuevo.

## Cuando un almacenero reporta "esperando sincronización"

1. **Pídele que recargue la app** (Cmd/Ctrl+Shift+R, o cerrar y volver a abrir Chrome).
2. En su DevTools (F12) → Console → buscá errores en rojo. Si hay `PGRST204` o `RLS bloqueando`, mandalos por captura.
3. Si los errores son de sync engine, después del recargo el `self-heal` reintenta automáticamente los records bloqueados.
4. Si persiste, abre Sentry, filtra por `user.email:<el-email>` last 24h, y mira qué le sale.

**Si todos los almaceneros lo reportan a la vez**: probablemente Supabase está caído o RLS bloqueando. Plan rápido:
1. ¿Supabase está up? supabase.com/status.
2. ¿Cambiamos RLS recientemente? Revisar último commit de `supabase/migrations/`.
3. **Rollback de RLS de emergencia** (USAR CON CRITERIO): correr `supabase/migrations/034_rls_rollback.sql` desde Supabase SQL Editor → vuelve a USING(true) en todas las tablas. Después fixear y volver a aplicar 033.

## Verificaciones periódicas (1 vez por semana)

```bash
cd JARVEX/jarvex-app

# 1. ¿RLS sigue activo y los helpers funcionan?
node scripts/verify-rls.mjs

# 2. ¿Hay duplicados nuevos?
node scripts/detect-duplicates.mjs

# 3. Si hay duplicados que quieres borrar:
node scripts/clean-duplicates.mjs            # dry-run
node scripts/clean-duplicates.mjs --apply    # ejecuta
```

## Despliegue

Push a `main` → Vercel rebuilda y deploya en ~2 min. Verificá en su dashboard que el último deploy esté **Ready** (verde).

**Si el deploy falla**: tab Deployments del run → ver log. Causas comunes:
- `Function size exceeded`: hay más de 12 archivos en `/api/` (Hobby plan). Mover helpers a `/lib/`.
- `Module not found`: faltan deps en `package.json` — corré `npm install` localmente.
- Test/build errors en logs.

**Si el deploy fue OK pero la UI sigue vieja**: el SW está sirviendo bundle cacheado. DevTools → Application → Storage → **Clear site data**. Cerrar tab y reabrir.

## Variables sensibles — dónde están

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_POSTHOG_KEY`, `VITE_SENTRY_DSN`: Vercel → Settings → Environment Variables.
- `SUPABASE_SERVICE_ROLE_KEY`: GitHub repo → Settings → Secrets (solo para CI). En tu PC: `.env.local` (gitignored).
- `SENTRY_AUTH_TOKEN` (para sourcemaps): Vercel build env vars.

**Nunca commitees `.env.local`**. Si lo hiciste por error: rotar todas las claves desde sus dashboards y `git filter-repo` para sacarlas del historial.

## Datos de contacto / responsabilidades

- **Owner técnico**: Gabriel Julca (Novvx Project)
- **Soporte Supabase**: support@supabase.com (incluido en plan Pro)
- **Soporte Vercel**: dashboard → Help (chat 24/7 en plan Pro)
- **Sentry/PostHog**: dashboards → Help → su soporte por email

Si hay incidente serio (datos perdidos, RLS roto, app caída para todos los users), priorizar en este orden:
1. Confirmar el alcance (¿1 user o todos?).
2. Avisar a los users afectados que estás mirando.
3. **NO restaures el último backup sin antes evaluar** — quizás solo necesitás revertir el último deploy.
4. Documentar qué pasó en `docs/incidents/<fecha>.md` mientras está fresco.
