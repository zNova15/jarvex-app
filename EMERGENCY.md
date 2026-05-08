# JARVEX — Manual de emergencia

**Para usar cuando algo se rompe, Gabriel no está disponible, o un user reporta un problema crítico.**

Este documento asume que la persona que lee NO conoce el código. Sigue los pasos en orden.

---

## 🚨 Contactos urgentes

| Quién | Cuándo llamar | Cómo |
|---|---|---|
| **Gabriel Julca** (dev principal) | App caída, datos perdidos, dudas | _completar teléfono_ |
| **Soporte Supabase** | DB no responde, login no funciona | https://supabase.com/dashboard → tu proyecto → Support (esquina inferior izquierda) |
| **Soporte Vercel** | App no carga, deploy roto | https://vercel.com/help — chat en vivo en plan Pro |
| **Cliente (constructora)** | Avisar antes de hacer cambios mayores | _completar teléfono del responsable_ |

---

## 📋 Diagnóstico rápido — "¿qué está roto?"

Antes de tocar nada, identificá el síntoma:

### A. Los users no pueden entrar (login falla)
→ Saltá a **[Recuperar Auth](#recuperar-auth)**

### B. Los users entran pero la app aparece en blanco
→ Saltá a **[Rollback de un deploy roto](#rollback-deploy)**

### C. Los users ven la app, pero los movimientos no se sincronizan
→ Saltá a **[Diagnóstico de sync](#diagnostico-sync)**

### D. La app está lenta pero funciona
→ No es emergencia. Esperar a Gabriel. Mientras tanto: hacer **[backup](#backup-rapido)** por las dudas.

### E. Sospechás que los datos se corrompieron
→ Saltá a **[Restaurar desde backup](#restaurar-backup)**. **NO hagas más cambios mientras tanto.**

---

## <a id="rollback-deploy"></a>🔄 Rollback de un deploy roto (90 segundos)

Si el último deploy rompió la app y necesitás volver a la versión anterior YA:

### Opción 1: Vercel Dashboard (recomendado, no requiere terminal)

1. Entrar a https://vercel.com → proyecto `jarvex-app` → tab **Deployments**.
2. Buscar el deploy anterior al que rompió (uno que decía "Ready" y los users no se quejaban).
3. Click en los 3 puntitos `...` al lado → **"Promote to Production"**.
4. Confirmar.
5. En 30 segundos la URL de producción apunta a esa versión vieja.
6. Avisar a Gabriel. NO hacer más cambios.

### Opción 2: Git revert (terminal)

Si tenés acceso al repo localmente:

```bash
cd /ruta/a/jarvex-app
git log --oneline -10                    # ver últimos 10 commits
git revert <hash-del-commit-malo>        # crea un commit que deshace
git push origin main                     # Vercel deploya automático
```

⚠ **NO uses `git reset --hard` y `git push --force`** — eso puede borrar trabajo de otros devs si los hay.

---

## <a id="recuperar-auth"></a>🔐 Recuperar Auth (los users no pueden entrar)

### Síntoma: "Failed to fetch" o "Invalid login credentials" en TODOS los users

Probablemente Supabase rechazó el dominio o cayó la URL.

1. Entrar a https://supabase.com/dashboard → proyecto → **Authentication** → **URL Configuration**.
2. Verificar que **Site URL** sea `https://jarvex-app.vercel.app` (o el dominio actual).
3. Verificar que **Redirect URLs** incluya:
   - `https://jarvex-app.vercel.app/**`
   - `https://jarvex-app.vercel.app/reset-password`
4. Si falta alguno → agregarlo → **Save**.
5. Pedile a un user que pruebe de nuevo (con Ctrl+Shift+R para refrescar).

### Síntoma: solo UN user no entra

Probablemente el user perdió la contraseña o su cuenta fue desactivada.

1. Supabase → **Authentication** → **Users**.
2. Buscar al user por email.
3. Si dice "Banned": click → desactivar el ban.
4. Si pide reset: click "Send password recovery" → al user le llega un email.

---

## <a id="diagnostico-sync"></a>🔄 Diagnóstico de sync (movimientos no aparecen)

### Paso 1: Verificar que Supabase responde

```bash
curl -I https://<TU-PROJECT-ID>.supabase.co/rest/v1/
```

Debería devolver `HTTP/2 200`. Si devuelve error o timeout → es Supabase, no la app. Llamar al soporte de Supabase.

### Paso 2: Verificar que el user tenga banner amarillo/rojo en Mov de Materiales

Si el user reporta movimientos faltantes:
1. Que entre a **Movimiento de Materiales**.
2. Si ve un banner amarillo "X movimientos sin sincronizar" → esperar 1 minuto, debería resolverse solo.
3. Si ve banner rojo "X movimientos con error de sincronización" → click "Reintentar". Si no pasa, anotar el mensaje del error y mandárselo a Gabriel.

### Paso 3: Hard reload en la PC del user

```
Ctrl + Shift + R  (Windows/Linux)
Cmd + Shift + R   (Mac)
```

Esto descarga el bundle nuevo y limpia cache de Service Worker. Resuelve 70% de los reportes de "está lento" o "no se actualiza".

### Paso 4: Si nada de lo anterior funciona

Pedir al user que abra las **DevTools** (F12) → tab **Console** → sacar screenshot. Mandar a Gabriel.

---

## <a id="backup-rapido"></a>💾 Backup rápido de la DB

**Tenés que tener instalado `pg_dump`** (viene con PostgreSQL). En Mac: `brew install postgresql`.

```bash
# Reemplazá <values> con los reales
export PGPASSWORD='<tu-db-password>'
pg_dump \
  -h aws-0-sa-east-1.pooler.supabase.com \
  -p 5432 \
  -U postgres.<tu-project-ref> \
  -d postgres \
  -F c \
  -f ~/jarvex-backup-$(date +%Y%m%d-%H%M).dump

unset PGPASSWORD
```

El backup queda en `~/jarvex-backup-YYYYMMDD-HHMM.dump`. Tamaño esperado: 10-200 MB según data acumulada.

**Dónde sacar las credenciales**:
- Supabase Dashboard → Settings → Database → Connection string (modo "Session pooler").
- La URL tiene formato `postgresql://postgres.<ref>:<password>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`.

**Frecuencia recomendada**: diario (configurable con `cron` en una máquina siempre encendida o con GitHub Actions).

---

## <a id="restaurar-backup"></a>♻️ Restaurar desde backup

**ADVERTENCIA**: esto sobreescribe la DB completa. Solo hacerlo si los datos actuales están corruptos y querés volver a un punto anterior. **Avisar al cliente antes de ejecutar** — perderán los datos posteriores al backup.

### Escenario seguro: restaurar a una DB nueva (verificación)

1. Crear un proyecto Supabase nuevo (free tier, segunda cuenta o misma) → tomar las credenciales.
2. Restaurar:

```bash
export PGPASSWORD='<password-DB-NUEVA>'
pg_restore \
  -h aws-0-sa-east-1.pooler.supabase.com \
  -p 5432 \
  -U postgres.<ref-DB-NUEVA> \
  -d postgres \
  --clean --if-exists \
  ~/jarvex-backup-YYYYMMDD-HHMM.dump
```

3. Cambiar las env vars de Vercel (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) a las de la DB nueva.
4. Redeployar Vercel (botón "Redeploy" en el dashboard).
5. La app ahora apunta al backup restaurado.

### Escenario destructivo: restaurar SOBRE producción

NO hacer esto sin confirmación de Gabriel y del cliente. Mismo comando pero apuntando a la DB de producción. Cualquier dato posterior al backup se pierde **irreversiblemente**.

---

## 🔑 Dónde están los secrets

| Secret | Dónde vive | Cómo accederlo |
|---|---|---|
| Supabase URL + ANON_KEY | Vercel → Project Settings → Environment Variables | Login Vercel → proyecto `jarvex-app` → Settings → Environment Variables |
| Supabase Service Role Key | Solo en cabeza de Gabriel + Supabase Dashboard | Supabase → Settings → API → "service_role secret" |
| DB Password (para pg_dump) | Supabase Dashboard | Settings → Database → "Database Password" (si lo perdiste, podés resetearlo) |
| Sentry DSN (cuando se configure) | Vercel env var `VITE_SENTRY_DSN` | Sentry → proyecto → Settings → Client Keys (DSN) |
| API key de Anthropic (Captura Mágica) | Vercel env var `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |

⚠ **NUNCA commitear ninguna de estas claves al repo**. El archivo `.env.local` está en `.gitignore`. Si ves una clave en un commit, contactar a Gabriel inmediatamente — hay que rotarla.

---

## 📞 Si Gabriel está incomunicado por más de 48h

La constructora depende de la app. Si Gabriel no responde por más de 2 días hábiles y hay un problema crítico:

1. **No tocar el código** sin saber qué hacer. Romper más es peor.
2. **Sí podés**: hacer rollback de un deploy desde Vercel dashboard (sin terminal).
3. **Sí podés**: hacer backup de la DB con el comando de arriba.
4. **Si la app está totalmente caída**: avisar a la constructora que vuelvan temporalmente al cuaderno físico/Excel hasta resolver. Mejor parar 1 día que corromper datos contables.
5. **Contactar a un dev de emergencia**: alguien que sepa React + Supabase puede tomar el control si tiene acceso al repo + Vercel + Supabase. Llevarle este documento.

---

## ✅ Checklist mensual de salud

Si tenés tiempo, una vez al mes correr esta lista:

- [ ] Verificar que el último backup automatizado existe y se puede restaurar (no solo "se hizo", sino "se puede recuperar").
- [ ] Login y registrar 1 movimiento de prueba como almacenero → verificar que aparece en la cuenta del admin.
- [ ] Revisar dashboard de Sentry: errores nuevos en el último mes (cuando esté configurado).
- [ ] Revisar dashboard de Supabase: uso de DB, conexiones, storage. Si están cerca del límite del free tier, hablar con Gabriel sobre plan paid.
- [ ] Revisar dashboard de Vercel: bandwidth, build minutes. Idem.
- [ ] Probar el login en mobile, no solo desktop.
- [ ] Verificar que las migrations de la rama main están aplicadas en Supabase (a veces queda alguna sin correr).

---

## Notas

- **Bus factor**: hoy = 1 (Gabriel). Idealmente: 2+ con acceso al repo, Vercel y Supabase. Si hay otro dev, agregarlo a las invitaciones de proyecto en GitHub/Vercel/Supabase.
- **Versión del esquema actual**: `supabase/migrations/032_epps_separados.sql` (verificar con `ls supabase/migrations/ | tail -5`).
- **Tests**: `npm run test:unit` corre los 90 tests unitarios. Antes de cualquier deploy, verificar que pasen.
- **Última actualización de este documento**: completar fecha cuando se haga cambios mayores.

---

_Si encontrás algo que falta en este manual o un caso que no cubre, agregalo. Es un documento vivo._
