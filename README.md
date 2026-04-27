# JARVEX — Sistema ERP de Gestión de Obras

> PWA offline-first para **JARVEX TECNOLOGÍA, INGENIERÍA Y PROYECTOS E.I.R.L.**

---

## ¿Qué es?

JARVEX es un sistema ERP completo diseñado específicamente para empresas de construcción e ingeniería que operan en obra, donde la conectividad a internet es intermitente o inexistente. Permite gestionar obras, almacén, herramientas, personal, avance físico y financiero, todo desde el celular del residente, almacenero o ingeniero — incluso sin señal.

A diferencia de soluciones tradicionales como S10 o Delfín que requieren oficina y conexión estable, JARVEX está construido como una **PWA (Progressive Web App) offline-first**. Toda la operación diaria se registra en una base de datos local en el dispositivo (IndexedDB / Dexie.js) y se sincroniza automáticamente con la nube (Supabase / PostgreSQL) cuando hay conexión disponible.

El sistema reemplaza Excel, WhatsApp y cuadernos físicos por un único punto de verdad digital, manteniendo trazabilidad total de cada movimiento de almacén, herramienta entregada, asistencia de personal, valorización y avance de partidas.

---

## Stack tecnológico

- **Frontend:** Vite 8 + React 19 + React Router 7
- **Base de datos local:** Dexie.js 4 (IndexedDB wrapper)
- **Backend:** Supabase (PostgreSQL + Auth + Storage + RLS)
- **Sincronización:** Motor custom push/pull con resolución de conflictos
- **PWA:** vite-plugin-pwa + Workbox (service worker + manifest instalable)
- **Reportes:** jsPDF + jspdf-autotable + xlsx
- **Gráficos:** Chart.js
- **Deploy:** Vercel (frontend) + Supabase Cloud (backend)

---

## Funcionalidades principales

- **Obras** — alta, edición, presupuesto, partidas, avance físico/financiero
- **Almacén** — kardex, ingresos, salidas, transferencias, stock por obra
- **Herramientas** — entregas, devoluciones, control por trabajador
- **Personal** — alta, asistencia diaria, tareo, valorización de mano de obra
- **Movimientos** — registro con evidencias fotográficas comprimidas
- **Dashboards** — KPIs por obra, alertas de stock crítico, avance vs presupuesto
- **Reportes** — exportación a PDF y Excel
- **Auth offline** — JWT cacheado en IndexedDB, login funciona sin conexión
- **Sincronización inteligente** — push de cambios locales, pull de cambios remotos, detección de conflictos
- **Roles y permisos** — admin, ingeniero, residente, almacenero, contador (vía RLS de Supabase)
- **PWA instalable** — funciona en Android, iPhone y escritorio como app nativa

---

## Arquitectura offline-first

JARVEX siempre **lee y escribe primero en la base de datos local** del dispositivo (IndexedDB vía Dexie.js). El usuario nunca espera al servidor para usar la app.

```
[ Usuario ]  →  [ Dexie (local) ]  ←→  [ Sync engine ]  ←→  [ Supabase (nube) ]
                       ↑
                  fuente de verdad para la UI
```

**Flujo de escritura:**
1. El usuario registra un movimiento de almacén en obra (sin señal).
2. Se guarda en IndexedDB con flag `pending_sync = true`.
3. Cuando el dispositivo detecta conexión, el motor de sync hace push a Supabase.
4. Se marca como sincronizado. Si hay conflicto, se registra para revisión manual.

**Flujo de lectura:**
1. Toda la UI consume datos vía hooks (`useOfflineData`) que leen de Dexie.
2. En background, el motor de sync hace pull de cambios remotos.
3. Los cambios se reflejan automáticamente en la UI.

**Evidencias fotográficas:** se comprimen en el cliente antes de subirse al bucket privado de Supabase Storage, organizadas por `{obra_id}/{yyyy-mm}/{archivo}`.

---

## Setup local

```bash
# 1. Clonar el repo
git clone https://github.com/TU-USUARIO/jarvex-app.git
cd jarvex-app

# 2. Instalar dependencias
npm install --legacy-peer-deps

# 3. Configurar variables de entorno
cp .env.example .env
# editar .env con tus credenciales de Supabase

# 4. Arrancar en desarrollo
npm run dev      # http://localhost:5173

# Otros comandos
npm run build    # build de producción → dist/
npm run preview  # preview del build
npm run lint     # eslint
```

Para configuración detallada del backend (Supabase, migraciones, RLS, Storage) ver [`SETUP.md`](./SETUP.md).

---

## Deploy a producción

Ver guía paso a paso en [`DEPLOY.md`](./DEPLOY.md) — incluye GitHub, Vercel, configuración de Auth en Supabase, instalación PWA en celular y dominio personalizado.

---

## Estructura del proyecto

```
jarvex-app/
├── public/                  # Assets estáticos (icons, manifest)
├── src/
│   ├── components/          # UI components reutilizables
│   ├── pages/               # Páginas / rutas
│   ├── hooks/               # useAuth, useSync, useOnline, useOfflineData
│   ├── db/                  # Dexie.js — schema offline
│   ├── sync/                # Motor de sincronización + upload de evidencias
│   ├── lib/                 # Cliente Supabase + módulo de Auth
│   └── main.jsx             # Entry point
├── supabase/
│   └── migrations/          # SQL: schema, RLS, triggers, vistas
├── vite.config.js           # Vite + PWA plugin
├── vercel.json              # Configuración de deploy
├── .env.example             # Template de variables de entorno
├── README.md                # Este archivo
├── SETUP.md                 # Setup de Supabase + dev local
└── DEPLOY.md                # Guía de deploy a producción
```

---

## Roadmap

### Fase 4 — Tiempo real y automatización
- **Realtime de Supabase** — actualización en vivo de dashboards entre usuarios
- **Alertas con n8n** — workflows de notificación (stock crítico, avance bajo, valorización pendiente) por WhatsApp / Email
- **Power BI** — conexión directa al PostgreSQL de Supabase para reportes ejecutivos avanzados
- **Importador masivo** — carga inicial desde Excel, Delfín y S10
- **Módulo de subcontratistas** — gestión de terceros y valorización por contrato
- **Firmas digitales** — actas y partes firmados desde el celular

---

## Soporte

Desarrollado e implementado por **Novvx Project** — IA, Automatizaciones y Marketing Digital.

- **Contacto:** Gabriel Jesús Julca Salazar
- **Email:** grabieljesusjulcasalazar@gmail.com
- **Cliente:** JARVEX TECNOLOGÍA, INGENIERÍA Y PROYECTOS E.I.R.L.
