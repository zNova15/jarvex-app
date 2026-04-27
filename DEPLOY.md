# JARVEX — Guía de Deploy a Producción

Guía paso a paso para llevar JARVEX a producción en Vercel + Supabase. Pensada para alguien que **nunca ha hecho un deploy antes**. Si sigues los pasos en orden, en 30 minutos tienes la app online en una URL pública, accesible desde cualquier celular.

---

## Sección 1 — Subir el código a GitHub

GitHub es donde vive el código. Vercel se conecta a GitHub para hacer deploy automático cada vez que subes cambios.

### 1.1. Crear repositorio en GitHub

1. Entra a https://github.com → si no tienes cuenta, crea una (gratis).
2. Click en **"+"** arriba a la derecha → **"New repository"**.
3. Nombre del repo: `jarvex-app`
4. Marcar como **Private** (importante — el código no debe ser público).
5. **NO** marcar "Add README" ni "Add .gitignore" (ya los tenemos en local).
6. Click **"Create repository"**.
7. GitHub te muestra una pantalla con instrucciones. Copia la URL del repo, algo como:
   `https://github.com/TU-USUARIO/jarvex-app.git`

### 1.2. Subir el código desde la terminal

Abrir la terminal (Mac: Cmd+Espacio → "Terminal") y ejecutar:

```bash
cd "/Users/macbookpro/Desktop/Nova/ClaudeCode/Empresa IA/jarvex-app"
git init
git add .
git commit -m "JARVEX initial production release"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/jarvex-app.git
git push -u origin main
```

> Reemplaza `TU-USUARIO` por tu usuario real de GitHub.

Si te pide credenciales: usa tu usuario de GitHub y un **Personal Access Token** (no la contraseña). Para crear uno: GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token → marcar el scope `repo`.

Verificar: refrescar la página del repo en GitHub. Deberías ver todos los archivos.

---

## Sección 2 — Deploy a Vercel (sin CLI, todo desde la web)

Vercel es la plataforma que va a hostear la app. Tiene plan gratis suficiente para JARVEX.

1. Ir a https://vercel.com → click **"Sign Up"** → elegir **"Continue with GitHub"** → autorizar.
2. Una vez dentro, click **"Add New..."** → **"Project"**.
3. Vercel lista tus repos de GitHub. Buscar `jarvex-app` → click **"Import"**.
4. En la pantalla de configuración:
   - **Framework Preset:** debe detectar **Vite** automáticamente. Si no, seleccionarlo manualmente.
   - **Root Directory:** dejar `./` (raíz).
   - **Build Command:** `npm run build` (ya viene del `vercel.json`).
   - **Output Directory:** `dist` (ya viene).
   - **Install Command:** `npm install --legacy-peer-deps` (ya viene).
5. **MUY IMPORTANTE — Environment Variables:** desplegar la sección y agregar:

| Name | Value |
|------|-------|
| `VITE_SUPABASE_URL` | tu Project URL de Supabase (ej: `https://xxxxx.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | tu anon public key de Supabase |

   > Estas las sacas de Supabase Dashboard → tu proyecto → Settings → API.
   > **NO uses la `service_role` key** — esa nunca debe estar en el frontend.

6. Click **"Deploy"**.
7. Esperar 2-3 minutos. Vercel hace el build y publica.
8. Cuando termine, te da una URL pública del tipo:
   `https://jarvex-app-xxx.vercel.app`

Click en la URL → la app debería cargar. Si hay un error de "Failed to fetch" al hacer login, falta el siguiente paso.

---

## Sección 3 — Configurar Auth en Supabase para producción

Por defecto Supabase solo permite login desde `localhost`. Hay que autorizar el dominio de Vercel.

1. Ir a https://supabase.com/dashboard → tu proyecto → **Authentication** → **URL Configuration**.
2. **Site URL:** pegar la URL de Vercel (ej: `https://jarvex-app-xxx.vercel.app`).
3. **Redirect URLs:** agregar (uno por línea):
   ```
   https://jarvex-app-xxx.vercel.app/**
   http://localhost:5173/**
   ```
   El `/**` al final permite redirects a cualquier ruta interna.
4. Click **"Save"**.

Volver a la app de Vercel y probar login → debería funcionar.

---

## Sección 4 — Probar en el celular

JARVEX es PWA: se instala como app nativa en el celular.

1. Abrir la URL de Vercel en:
   - **Android:** Chrome
   - **iPhone:** Safari (importante — Chrome en iPhone no soporta bien PWA)
2. Hacer login con un usuario válido.
3. Navegar un poco para que el service worker cachee los assets.
4. Menú del navegador (⋮ en Android, compartir en iPhone) → **"Agregar a pantalla de inicio"** / **"Instalar app"**.
5. Aparece el icono de JARVEX en la pantalla de inicio.
6. **Probar offline:**
   - Abrir la app desde el icono.
   - Activar **modo avión**.
   - Registrar un movimiento de almacén o asistencia.
   - Verificar que se guarda y la app sigue funcionando.
   - Desactivar modo avión.
   - Ir a **Settings → Sistema → "Sincronizar ahora"**.
   - Verificar que el movimiento aparece en la nube (Supabase Dashboard → Table Editor).

---

## Sección 5 — Dominio personalizado (opcional)

Para que la URL sea `app.jarvex.pe` en vez de `jarvex-app-xxx.vercel.app`.

1. Comprar el dominio (~ S/35-50/año):
   - **GoDaddy** — https://godaddy.com
   - **Namecheap** — https://namecheap.com
   - **Punku.pe** — https://punku.pe (registrador peruano para `.pe`)
2. En Vercel → tu proyecto → **Settings** → **Domains** → **Add**.
3. Ingresar el dominio (ej: `app.jarvex.pe`).
4. Vercel te da instrucciones de DNS (un registro CNAME o A).
5. Entrar al panel del registrador (donde compraste el dominio) → **DNS Management** → agregar el registro que indica Vercel.
6. Esperar 5-30 minutos a que propague el DNS. Vercel verifica automáticamente.
7. Una vez verde, **actualizar Site URL en Supabase** (Sección 3) con el nuevo dominio.

---

## Sección 6 — Re-deploy automático

A partir de ahora, **cada `git push` a la rama `main` re-despliega automáticamente** en producción. No tienes que hacer nada más.

```bash
cd "/Users/macbookpro/Desktop/Nova/ClaudeCode/Empresa IA/jarvex-app"
# editar archivos...
git add .
git commit -m "fix: corregir cálculo de avance"
git push
# en 2-3 minutos la nueva versión está en producción
```

### Preview de cambios sin afectar producción

Para probar cambios sin tocar la versión que usan los usuarios:

```bash
git checkout -b mi-cambio
# editar archivos...
git add .
git commit -m "wip: probando algo"
git push -u origin mi-cambio
```

Vercel detecta la nueva rama y genera una **URL preview** independiente (algo como `jarvex-app-git-mi-cambio-xxx.vercel.app`). Cuando estés conforme, hacer merge a `main`.

---

## Sección 7 — Troubleshooting

### "RLS error" / "permission denied"
- Las políticas de Row Level Security en Supabase están bloqueando la operación.
- Ir a Supabase → Authentication → Users → verificar que el usuario tiene perfil en la tabla `profiles` con un rol asignado.
- Revisar las políticas en Supabase → Database → Policies → asegurar que el rol del usuario tiene permiso para esa tabla.

### "Build failed" en Vercel
- Click en el deploy fallido en Vercel → ver **Build Logs** completos.
- Causas comunes:
  - Falta una variable de entorno (ver Sección 2 paso 5).
  - Error de sintaxis en el código → reproducir local con `npm run build`.
  - Dependencia incompatible → asegurar que `Install Command` es `npm install --legacy-peer-deps`.

### "Sync no funciona" / cambios no llegan a la nube
- Abrir la app en el navegador → **F12** → pestaña **Console**.
- Buscar errores de red o de Supabase.
- Ir a **Settings → Sistema → "Sincronizar ahora"** y observar la consola.
- Verificar que `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en Vercel son correctas.
- Verificar que el usuario tiene sesión activa (Supabase → Authentication → Users → ver "Last sign in").

### "Failed to fetch" al hacer login
- Falta agregar el dominio de Vercel en Supabase → Authentication → URL Configuration (Sección 3).

### La PWA no se instala en iPhone
- Solo Safari soporta PWA en iPhone. Chrome/Firefox en iOS no.
- La URL debe ser **HTTPS** (Vercel lo da por defecto).
- Si ya está instalada y no se actualiza: borrar la app del home screen y reinstalar.

---

## Resumen rápido para futuros deploys

```bash
cd "/Users/macbookpro/Desktop/Nova/ClaudeCode/Empresa IA/jarvex-app"
git add .
git commit -m "descripción del cambio"
git push
# listo, en 2-3 min está en producción
```

Para soporte: Gabriel Jesús Julca Salazar — grabieljesusjulcasalazar@gmail.com
