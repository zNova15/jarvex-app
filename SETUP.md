# JARVEX — Guía de Setup

## 1. Crear proyecto en Supabase

1. Ve a https://supabase.com → "New project"
2. Nombre: `jarvex-prod` (o `jarvex-dev` para pruebas)
3. Contraseña: generar una fuerte y guardarla
4. Región: South America (São Paulo) — más cercano a Perú
5. Plan: Free tier por ahora

## 2. Ejecutar migraciones SQL

En Supabase Dashboard → SQL Editor, ejecutar en orden:

```
supabase/migrations/001_initial_schema.sql   ← Todas las tablas
supabase/migrations/002_rls_policies.sql     ← Permisos por rol y obra
supabase/migrations/003_triggers.sql         ← Stock automático, avance
supabase/migrations/004_views.sql            ← Dashboards y KPIs
```

## 3. Configurar Storage

En Supabase Dashboard → Storage:
1. Crear bucket: `evidencias`
2. Tipo: **Private** (con RLS)
3. Política de acceso: usuarios solo ven evidencias de sus obras

SQL para política de storage:
```sql
CREATE POLICY "evidencias: ver propias"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'evidencias'
    AND auth.uid() IS NOT NULL
    -- Validación de obra_id en path: {obra_id}/{yyyy-mm}/{archivo}
  );

CREATE POLICY "evidencias: subir propias"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'evidencias'
    AND auth.uid() IS NOT NULL
  );
```

## 4. Crear primer usuario admin

En Supabase Dashboard → Authentication → Users → "Add user":
- Email: tu email
- Password: la que quieras

Luego en SQL Editor, asignar rol admin:
```sql
UPDATE profiles SET rol = 'admin' WHERE email = 'tu@email.com';
```

## 5. Configurar variables de entorno

```bash
cp .env.example .env
```

Editar `.env` con las credenciales de tu proyecto:
- `VITE_SUPABASE_URL` → Settings → API → Project URL
- `VITE_SUPABASE_ANON_KEY` → Settings → API → anon public key

## 6. Instalar y arrancar

```bash
npm install
npm run dev       # Desarrollo en http://localhost:5173
npm run build     # Build de producción
npm run preview   # Preview del build
```

## 7. Instalar como PWA

- **Android**: Chrome → menú → "Agregar a pantalla de inicio"
- **iPhone**: Safari → Compartir → "Agregar a pantalla de inicio"
- **Laptop**: Chrome/Edge → ícono de instalación en barra de direcciones

## Estructura del proyecto

```
src/
  db/           ← Dexie.js (base de datos local offline)
  sync/         ← Motor de sincronización + upload de evidencias
  lib/          ← Cliente Supabase + módulo de Auth
  hooks/        ← useAuth, useSync, useOnline, useOfflineData
  components/   ← UI components (heredados del prototipo + nuevos)
  pages/        ← Páginas (por conectar en Fase 2)

supabase/
  migrations/   ← SQL: schema, RLS, triggers, vistas
```

## Estado de implementación

### ✅ Fase 1 — Backend (completado)
- Schema PostgreSQL completo (17 tablas)
- RLS policies por rol y obra
- Triggers de negocio (stock, herramientas, avance)
- Vistas SQL para dashboards
- Dexie.js schema (offline)
- Motor de sincronización (push + pull + conflictos)
- Upload de evidencias con compresión
- Auth offline (JWT cacheado en IndexedDB)
- Hooks React para datos offline-first
- PWA: service worker + manifest instalable
- Build Vite listo para producción

### ⬜ Fase 2 — Conectar UI a datos reales
- Reemplazar datos mock en componentes por hooks de useOfflineData
- Dashboard con KPIs reales de Supabase
- Módulo de conflictos de sincronización
- Reportes con datos reales

### ⬜ Fase 3 — Importación + Automatizaciones
- Importación desde Excel/Delfín/S10
- n8n: alertas de stock crítico
- Conexión Power BI

---

## Para deploy a producción ver [DEPLOY.md](./DEPLOY.md)
