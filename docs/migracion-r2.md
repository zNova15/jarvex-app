# Mudar las evidencias de Supabase Storage a Cloudflare R2

> Runbook operativo. Escrito el **13-set-2026**, actualizado el mismo día con
> el flujo optimizado. Objetivo final: que Supabase quede en **~60 MB de base
> y 0 de Storage**, para poder volver del plan **Pro (USD 25/mes)** al **Free**.

## Quién hace qué (actualizado)

Gabriel preguntó si los 9 pasos de abajo son la única forma, o si se puede
optimizar para que Claude haga la mayor parte. Se puede — y bastante:

- **Los 6 valores que hacen falta (Paso 2) YA EXISTEN en Vercel**, porque R2
  ya está funcionando en producción. No hay que crear ninguna credencial
  nueva en Cloudflare: es copiar y pegar 6 líneas desde el dashboard de
  Vercel a un archivo `.env.local` (la plantilla con los 6 nombres ya está
  creada en la raíz del repo — solo faltan los valores).
- **Una vez que ese archivo tiene los valores, Claude corre TODO lo demás**
  (Pasos 3 a 6, y el 8) con el Bash de esta máquina: dry-run, migración,
  segunda pasada de verificación, y el bump de `_SIGNED_LS_KEY` para no
  esperar los 7 días de caché. Ningún valor del archivo necesita pegarse en
  el chat — Claude solo corre el comando, no necesita leer el contenido.
- **El Paso 7 (vaciar Supabase) ahora tiene script propio**
  (`scripts/borrar-evidencias-migradas-r2.mjs`): verifica con un HEAD contra
  R2 antes de borrar cada objeto de Supabase, y deja sin tocar cualquiera que
  no pueda confirmar. Claude lo corre en `--dry-run` primero y muestra el
  resultado; el `--apply` (borra de verdad, es irreversible) se hace recién
  con el OK explícito de Gabriel en ese momento.
- **Lo que queda irreductiblemente manual** (ninguna API lo expone): abrir
  Vercel para copiar los 6 valores (Paso 2, ~2 minutos), y dos clics de
  dashboard al final — bajar el plan de Supabase (Paso 9, botón de billing) y,
  opcional, poner `R2_SKIP_HEAD=1` en Vercel (Paso 8b). Ninguna herramienta de
  Claude puede tocar billing de Supabase ni las env vars de Vercel.

---

## 0. Dónde estamos hoy (medido, no supuesto)

| Cosa | Estado 13-set-2026 |
|---|---|
| Base de datos | **61 MB** (techo de Free: 500 MB) ✔ |
| Supabase Storage, bucket `evidencias` | **1.835 objetos · 596 MB** (techo de Free: 1 GB) ✖ |
| Último archivo subido a Supabase | **7-set-2026** |
| Evidencias que apuntan a Supabase (`url_archivo` absoluta) | **1.749** |
| Evidencias que ya viven en R2 (`url_archivo` = `/evidencias/…`) | **240**, desde el 5-set |
| Flag `VITE_R2_EVIDENCIAS` en producción | **`on`** (se lee Y se sube a R2) |

**Lo importante: la mitad del trabajo ya está hecha.** R2 está encendido y todo
lo que se sube desde el 8-set va directo al bucket, sin tocar Supabase. Lo que
queda es **mudar los 596 MB históricos y vaciar el bucket viejo**.

Cómo verificar que sigue así antes de empezar (SQL Editor de Supabase):

```sql
-- Storage: cuánto queda del lado de Supabase
select count(*) objetos,
       pg_size_pretty(sum((metadata->>'size')::bigint)) tamano,
       max(created_at)::date ultimo
from storage.objects where bucket_id = 'evidencias';

-- Evidencias por "forma" de la URL: cuántas siguen apuntando a Supabase
select case when url_archivo is null then 'sin subir'
            when url_archivo like '/evidencias/%' then 'R2'
            when url_archivo like 'http%' then 'Supabase'
            else 'otro' end forma,
       count(*)
from evidencias group by 1 order by 2 desc;
```

Si `ultimo` avanzó más allá del 7-set, alguien desactivó el flag: revisá
`VITE_R2_EVIDENCIAS` en Vercel antes de seguir.

---

## 1. Cómo funciona el mecanismo (para entender los pasos)

- El bucket de R2 es **privado**. `api/r2.js` valida la sesión de Supabase del
  que pide y devuelve una **URL prefirmada** (GET 7 días / PUT 1 hora). Los
  bytes viajan **navegador ↔ R2 directo**: no pasan por Vercel ni por Supabase.
  El egress de R2 es **$0 para siempre**.
- El flag `VITE_R2_EVIDENCIAS` (build-time, se hornea en el bundle) tiene tres
  posiciones: `off` (todo Supabase) → `read` (lee de R2, sube a Supabase) →
  `on` (lee y sube a R2). **Hoy está en `on`.**
- **La lectura tiene red de contención:** `src/lib/evidencias-url.js` firma
  primero en R2; si el objeto no está ahí, `api/r2.js` devuelve 404 y el cliente
  cae solo a Supabase. Por eso hoy conviven las 240 nuevas y las 1.749 viejas
  sin que nadie note nada.
- `pathDeEvidencia()` saca el path del bucket **tanto de la URL absoluta vieja
  como del path relativo nuevo**. Por eso **no hace falta reescribir
  `url_archivo` en la base**: las 1.749 filas viejas van a funcionar contra R2
  tal como están, apenas el objeto exista allá.

---

## 2. Requisitos antes de arrancar

1. **Completar `.env.local`** (ya existe en la raíz del repo, con los 6
   nombres puestos y los valores vacíos — está en `.gitignore`, nunca viaja
   por git). Los 6 valores **ya están en Vercel** (jarvex-app → Settings →
   Environment Variables) porque R2 ya funciona en producción: no hace falta
   crear ninguna credencial nueva en Cloudflare, solo copiarlos de ahí:

   ```
   VITE_SUPABASE_URL=...
   SUPABASE_SERVICE_ROLE_KEY=...      # ⚠ nunca commitear
   R2_ACCOUNT_ID=...
   R2_ACCESS_KEY_ID=...
   R2_SECRET_ACCESS_KEY=...
   R2_BUCKET=jarvex-evidencias
   ```

   Con el archivo completo, avisale a Claude — corre todo lo de abajo sin
   necesitar que le pegues ningún valor en el chat.

2. **`npm install`** hecho (el script usa `@supabase/supabase-js`).
3. **Correr la migración estando todavía en Pro.** Bajar los 596 MB de Supabase
   es egress: en Free entraría justo contra el tope de 5 GB/mes. En Pro sobra.

---

## 3. Paso a paso

### Paso 1 — Ensayo en seco (no toca nada)

```bash
node --env-file=.env.local scripts/migrar-evidencias-r2.mjs --dry-run
```

Tiene que listar ~1.835 objetos y ~596 MB. Si dice `No hay acceso al bucket`,
las credenciales o el nombre del bucket están mal: **parar acá**, no sigue nada
roto.

### Paso 2 — Migrar

```bash
node --env-file=.env.local scripts/migrar-evidencias-r2.mjs --concurrency=8
```

- **Copia, no mueve**: Supabase queda intacto como respaldo.
- Salta lo que ya está en R2 (HEAD previo), así que **es reanudable**: si se
  corta la conexión, volvé a correrlo y sigue donde quedó.
- Verifica el tamaño de cada archivo bajado contra el que declara Supabase: si
  no coincide, lo marca error en vez de subir un archivo truncado.
- Termina con un resumen. **Tiene que decir `0 errores`.** Si hay fallidos, los
  lista con el motivo; volvé a correr el comando (los ya subidos se saltean).

Duración estimada: 15-40 min con concurrencia 8, según la conexión.

### Paso 3 — Verificar que ya no queda nada sin copiar

```bash
node --env-file=.env.local scripts/migrar-evidencias-r2.mjs
```

Corrido una segunda vez debe decir **`0 subidos, 1835 ya estaban, 0 errores`**.
Ese es el certificado de que la copia está completa.

### Paso 4 — Probar en la app, con los ojos

Con Supabase todavía lleno (o sea: si algo falla, nadie se entera), abrir en
producción y mirar **evidencias VIEJAS**, de las que estaban solo en Supabase:

- una foto de obra de junio/julio (Evidencias),
- un comprobante de Captura Mágica de agosto,
- un PDF pesado (un CV con constancias),
- desde **otro dispositivo** que no las haya abierto nunca (así se firma de
  cero, sin caché).

En el navegador (F12 → Network) las imágenes tienen que venir de
`…r2.cloudflarestorage.com`, no de `…supabase.co`.

### Paso 5 — Invalidar las URLs firmadas viejas ⚠️ (el paso que es fácil olvidar)

Cada dispositivo **cachea la URL firmada en `localStorage` por 7 días**
(`jx_signed_urls`, ver `src/lib/evidencias-url.js`). Un equipo que ya abrió una
evidencia vieja tiene guardada una URL de **Supabase** y la va a seguir usando
hasta que expire — aunque el archivo ya esté en R2. Si borrás Supabase antes,
ese equipo ve imágenes rotas hasta 7 días.

Dos formas de resolverlo:

- **Esperar 7 días** entre el Paso 4 y el Paso 6. Simple, gratis, lento.
- **Forzar el vencimiento**: cambiar `_SIGNED_LS_KEY` de `'jx_signed_urls'` a
  `'jx_signed_urls_v2'` en `src/lib/evidencias-url.js` y desplegar. Todas las
  URLs cacheadas dejan de existir de golpe y la próxima apertura se firma de
  nuevo — contra R2, que ya tiene el archivo. Es una línea y no rompe nada.

### Paso 6 — Limpiar huérfanos (opcional, pero conviene antes de vaciar)

```bash
node scripts/limpiar-huerfanos-storage.mjs           # en seco
node scripts/limpiar-huerfanos-storage.mjs --apply   # borra de verdad
```

Borra los objetos de Storage que **ninguna fila de `evidencias` referencia**
(medidos el 4-set: 86 objetos, 19,7 MB). No toca nada subido en los últimos 30
días, para no matar una subida en vuelo cuya fila todavía no sincronizó.

### Paso 7 — Vaciar el bucket de Supabase

**Solo después de que el Paso 3 diera 0 errores y el Paso 4 se viera bien.**

Script listo: `scripts/borrar-evidencias-migradas-r2.mjs`. Por cada objeto de
Supabase hace un HEAD a R2 en la misma ruta y **solo borra si existe ahí Y el
tamaño coincide** — cualquier otra cosa (no está, tamaño distinto, error de
red) lo deja sin tocar y lo lista al final, nunca borra a ciegas. También
respeta una gracia de 30 días por fecha de subida (`--dias`), para no pisar
algo tan reciente que el último ciclo de migración no haya alcanzado a copiar.

```bash
node --env-file=.env.local scripts/borrar-evidencias-migradas-r2.mjs             # dry-run: cuenta, no borra
node --env-file=.env.local scripts/borrar-evidencias-migradas-r2.mjs --apply     # borra de verdad
```

Primero el dry-run — tiene que decir **todos** los objetos como "confirmados",
0 "sin confirmar". Recién con eso a la vista, el `--apply`: es el paso
irreversible del runbook entero, así que se corre con el OK explícito de
Gabriel en el momento, no antes.

Después de vaciar, confirmar:

```sql
select count(*) from storage.objects where bucket_id = 'evidencias';  -- debe dar 0
```

### Paso 8 — Apagar el HEAD de existencia

Con Supabase vacío ya no hay fallback que valga la pena chequear. En Vercel →
Environment Variables (Production y Preview):

```
R2_SKIP_HEAD=1
```

Ahorra una operación clase B de R2 por cada firma. **Redesplegar** para que tome
efecto.

### Paso 9 — Bajar a Free

Supabase → Settings → Billing → cambiar el plan. Antes de tocarlo, chequear
contra los techos de Free:

| Recurso | Hoy | Techo Free |
|---|---|---|
| Base | 61 MB | 500 MB ✔ |
| Storage | 0 (tras el paso 7) | 1 GB ✔ |
| Egress de filas | ~400-500 MB/mes | 5 GB/mes ✔ |

---

## 4. Lo que se pierde al bajar a Free (decidilo a propósito)

1. **Backups automáticos.** Pro hace backup diario; Free **no hace ninguno**.
   Para un ERP con la contabilidad de la obra adentro esto no es un detalle.
   Mitigación: programar `scripts/backup-supabase.mjs` (semanal como mínimo) y
   guardar el dump fuera de la máquina. **Hacer esto ANTES de bajar de plan.**
2. **Branching de Supabase** (bases de staging propias) es feature de Pro. Hoy
   staging comparte la base con producción, así que no se pierde nada que se
   esté usando — pero es el único motivo legítimo para quedarse en Pro.
3. **Pausa por inactividad**: Free pausa proyectos con 7 días sin actividad.
   JARVEX se usa todos los días; no aplica.

## 5. Rollback

- **Durante la migración (pasos 1-6):** no hay nada que revertir. Supabase está
  intacto; R2 solo recibió copias.
- **Si R2 fallara** (credenciales revocadas, bucket borrado): poner
  `VITE_R2_EVIDENCIAS=read` o `off` en Vercel y redesplegar. Con `off`, la
  lectura vuelve entera a Supabase y las URLs de R2 cacheadas se ignoran
  (`_firmarPath` ya contempla ese caso). **Ojo: esto solo salva lo que siga en
  Supabase** — después del Paso 7 el rollback deja de existir. Por eso el Paso 7
  va último y por meses.
- **Después de bajar a Free:** volver a Pro es un clic y es inmediato.

## 6. CORS del bucket (por si hay que rehacerlo)

R2 **no acepta comodines**: hay que listar los orígenes exactos.

```json
[{ "AllowedOrigins": ["https://jarvex-app.vercel.app",
                      "https://jarvex-app-git-staging-znova15s-projects.vercel.app",
                      "http://localhost:5173"],
   "AllowedMethods": ["GET","PUT","HEAD"],
   "AllowedHeaders": ["Content-Type","Cache-Control"],
   "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
```

Sin esta política, subir o abrir una foto falla con un `Failed to fetch` pelado.

---

## Archivos que intervienen

- `api/r2.js` — firma las URLs y repone la autorización que R2 no tiene (R2 no
  tiene RLS).
- `src/lib/r2-storage.js` — el adaptador del cliente y el flag de rollout.
- `src/lib/evidencias-url.js` — lectura con fallback y caché de URLs firmadas.
- `src/sync/EvidenceUploader.js` — la subida (R2 o Supabase según el flag).
- `scripts/migrar-evidencias-r2.mjs` — la copia masiva.
- `scripts/limpiar-huerfanos-storage.mjs` — los objetos sin fila.
- `MEDICION-CONSUMO.md` — bitácora del corte por egress del 9-set.
