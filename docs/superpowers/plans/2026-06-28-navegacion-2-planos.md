# Navegación en 2 planos (General/Obra) — Plan de Implementación (Fase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Pantalla de Inicio (launcher) + workspace de obra enfocado: el menú y el header se adaptan al plano (general/obra) de la página actual; el resto de las páginas no cambia.

**Architecture:** El "modo" se DERIVA de la página actual: `page === 'inicio'` → launcher; `planoDe(page) === 'general'|'obra'` → sidebar+header de ese plano. Un helper puro `nav-planos.js` define qué ítem es de qué plano y a dónde aterriza cada rol. Las páginas individuales ya filtran por obra activa → no se tocan.

**Tech Stack:** React (sin JSX build de tipos), Vite/rolldown, globals window.__*, Dexie. Tests: vitest.

## Global Constraints
- NO tocar páginas individuales, modelo de datos, ni permisos (PERM_MATRIX/allowlists).
- NO agregar funciones serverless (Vercel 12/12).
- Verificación de deploy por contenido (grep de strings literales en el chunk).
- Comentarios en español, mismo estilo del repo.

---

### Task 1: Helper puro `nav-planos.js` (planos + landing)

**Files:**
- Create: `src/lib/nav-planos.js`
- Test: `src/lib/__tests__/nav-planos.test.js`

**Interfaces:**
- Produces: `GENERAL_ITEMS: Set<string>`, `planoDe(id: string): 'general'|'obra'`, `resolveLanding({ rol, obrasAsignadas: string[], homePorRol: Record<string,string>, esAdminOGlobal: boolean }): { page: string, obraId: string|null }`

Mapeo GENERAL (todo lo demás = 'obra'): `captura-magica, obras, dashboard, reportes, proveedores, empresas, cont-dashboard, intercompany, trazabilidad, consolidado, cuentas-bancarias, plan-cuentas, libro-diario, balance-general, estado-resultados, comprobantes, libros-electronicos, config-sunat, comparativo-periodos, dashboard-ejecutivo, kpis-obra, cumplimiento-cronograma, alertas, busqueda, usuarios, roles, solicitudes, configuracion, conflictos, audit-log, inicio`.

resolveLanding: roles que caen en 'inicio' = los que ven varias obras o lo general (admin, gerente, contador, ayudante_contador, tesorero). Los operativos (resto): si `obrasAsignadas.length === 1` → `{ page: homePorRol[rol] || 'dashboard-gestion', obraId: obrasAsignadas[0] }`; si 0 ó >1 → `{ page: 'inicio', obraId: null }`. Admin/gerente siempre `{ page:'inicio', obraId:null }`.

- [ ] **Step 1: Write the failing test**
```js
import { describe, it, expect } from 'vitest';
import { planoDe, GENERAL_ITEMS, resolveLanding } from '../nav-planos.js';

describe('planoDe', () => {
  it('clasifica general vs obra', () => {
    expect(planoDe('empresas')).toBe('general');
    expect(planoDe('proveedores')).toBe('general');
    expect(planoDe('balance-general')).toBe('general');
    expect(planoDe('captura-magica')).toBe('general');
    expect(planoDe('mov-materiales')).toBe('obra');
    expect(planoDe('conciliacion-insumos')).toBe('obra');
    expect(planoDe('partidas')).toBe('obra');
    expect(planoDe('cualquier-otra')).toBe('obra');
  });
});

describe('resolveLanding', () => {
  const home = { almacenero: 'mov-materiales', ingeniero: 'dashboard-tecnico', contador: 'cont-dashboard' };
  it('admin/contador → inicio', () => {
    expect(resolveLanding({ rol: 'admin', obrasAsignadas: ['a','b'], homePorRol: home })).toEqual({ page: 'inicio', obraId: null });
    expect(resolveLanding({ rol: 'contador', obrasAsignadas: ['a'], homePorRol: home })).toEqual({ page: 'inicio', obraId: null });
  });
  it('operativo con UNA obra → entra a su obra y su página', () => {
    expect(resolveLanding({ rol: 'almacenero', obrasAsignadas: ['o1'], homePorRol: home })).toEqual({ page: 'mov-materiales', obraId: 'o1' });
  });
  it('operativo con varias o ninguna → inicio', () => {
    expect(resolveLanding({ rol: 'almacenero', obrasAsignadas: ['o1','o2'], homePorRol: home })).toEqual({ page: 'inicio', obraId: null });
    expect(resolveLanding({ rol: 'ingeniero', obrasAsignadas: [], homePorRol: home })).toEqual({ page: 'inicio', obraId: null });
  });
});
```

- [ ] **Step 2: Run test, verify it fails** — `npx vitest run src/lib/__tests__/nav-planos.test.js` → FAIL (módulo no existe).

- [ ] **Step 3: Implement** `src/lib/nav-planos.js`:
```js
// Clasifica cada página en su PLANO de navegación: 'general' (global, sin obra)
// o 'obra' (workspace de una obra). Y decide a dónde aterriza cada rol.
export const GENERAL_ITEMS = new Set([
  'inicio', 'captura-magica', 'obras', 'dashboard', 'reportes',
  'proveedores',
  'empresas', 'cont-dashboard', 'intercompany', 'trazabilidad', 'consolidado',
  'cuentas-bancarias', 'plan-cuentas', 'libro-diario', 'balance-general',
  'estado-resultados', 'comprobantes', 'libros-electronicos', 'config-sunat',
  'comparativo-periodos',
  'dashboard-ejecutivo', 'kpis-obra', 'cumplimiento-cronograma', 'alertas', 'busqueda',
  'usuarios', 'roles', 'solicitudes', 'configuracion', 'conflictos', 'audit-log',
]);
export const planoDe = (id) => GENERAL_ITEMS.has(id) ? 'general' : 'obra';

const ROLES_GLOBALES = new Set(['admin', 'gerente', 'contador', 'ayudante_contador', 'tesorero']);
export function resolveLanding({ rol, obrasAsignadas = [], homePorRol = {} }) {
  if (ROLES_GLOBALES.has(rol)) return { page: 'inicio', obraId: null };
  if (obrasAsignadas.length === 1) return { page: homePorRol[rol] || 'dashboard-gestion', obraId: obrasAsignadas[0] };
  return { page: 'inicio', obraId: null };
}
```

- [ ] **Step 4: Run test, verify pass** — `npx vitest run src/lib/__tests__/nav-planos.test.js` → PASS.
- [ ] **Step 5: Commit** — `git add src/lib/nav-planos.js src/lib/__tests__/nav-planos.test.js && git commit -m "feat(nav): helper de planos (general/obra) + resolveLanding"`

---

### Task 2: Sidebar filtra por plano actual

**Files:**
- Modify: `src/components/jx-sidebar.jsx` (NAV render ~350-376; el componente Sidebar acepta nuevo prop `plano`)

**Interfaces:**
- Consumes: `planoDe` de `nav-planos.js`.
- Produces: `<Sidebar plano="general"|"obra" .../>` muestra solo ítems de ese plano; secciones vacías ya se ocultan.

- [ ] **Step 1:** En jx-sidebar.jsx, importar `import { planoDe } from "../lib/nav-planos.js";` (top, junto a los otros imports).
- [ ] **Step 2:** En `function Sidebar({ current, onNav, collapsed, onToggle, ... })`, agregar `plano = 'obra'` al destructuring de props.
- [ ] **Step 3:** En el render del NAV (donde mapea `NAV` y filtra por `canSee`), agregar el filtro de plano: un ítem `it` (con `it.id`) solo se muestra si `planoDe(it.id) === plano`. Las filas `{ section: ... }` se muestran solo si tienen al menos un ítem visible de ese plano (la lógica de ocultar secciones vacías ya existe — extenderla para contar solo ítems del plano actual).
- [ ] **Step 4:** Build — `npm run build` → verde.
- [ ] **Step 5: Commit** — `git add src/components/jx-sidebar.jsx && git commit -m "feat(nav): sidebar filtra por plano (general/obra)"`

---

### Task 3: Componente Inicio (launcher de mosaicos + grid de obras)

**Files:**
- Create: `src/components/jx-inicio.jsx`
- Modify: `src/main.jsx` (import eager del nuevo componente, junto a jx-dashboard)

**Interfaces:**
- Consumes: `window.__hooks.useObras()`, `window.__useAuth()`, `window.__canSeeSidebarItem(rol,id)`, `GENERAL_ITEMS`/`planoDe`, `calcAvanceFinanciero` (avance financiero por obra — opcional Fase 3, en Fase 1 mostrar solo nombre + avance físico si está en obra).
- Produces: `window.InicioPage = function({ onNav, onEnterObra })` — mosaicos de Datos Generales (ítems general que el rol ve) + grid de obras (las que el rol puede ver). Click tile → `onNav(id)`; click obra → `onEnterObra(obra.id)`.

- [ ] **Step 1:** Crear `jx-inicio.jsx`: un set de TILES generales `[{id:'empresas',label:'Empresas',icon:'building'}, {id:'proveedores',...}, {id:'captura-magica',...}, {id:'usuarios',...}, {id:'dashboard-ejecutivo',...}, {id:'configuracion',...}]` filtrados por `window.__canSeeSidebarItem(rol, id)`. Render con la grilla de tiles (estilo card grande, como las kpi-card). Debajo, "OBRAS": `useObras()` filtradas a las que el rol ve (admin/gerente todas; otros: las asignadas vía `obra_usuarios` — en Fase 1, mostrar todas las no-borradas y refinar el filtro de asignación en Fase 3). Cada obra = card clickeable que llama `onEnterObra(o.id)`. Usar `window.JxIcon` (wrapper) y estilos inline existentes (card/card-p/kpi-card).
- [ ] **Step 2:** En `main.jsx`, agregar `import './components/jx-inicio.jsx';` junto a `import './components/jx-dashboard.jsx';`.
- [ ] **Step 3:** Build — `npm run build` → verde.
- [ ] **Step 4: Commit** — `git add src/components/jx-inicio.jsx src/main.jsx && git commit -m "feat(nav): componente Inicio (launcher general + grid de obras)"`

---

### Task 4: jx-app integra el modo (render Inicio + plano al sidebar/header + landing)

**Files:**
- Modify: `src/jx-app.jsx` (App render ~1049-1072; landing inicial ~745-765; renderPage ~1015)

**Interfaces:**
- Consumes: `planoDe`, `resolveLanding`, `window.InicioPage`.

- [ ] **Step 1:** Import `import { planoDe, resolveLanding } from "./lib/nav-planos.js";` al top de jx-app.jsx.
- [ ] **Step 2:** Landing: donde se calcula la página inicial (`useState(() => { ... __defaultPageForRol })`), usar `resolveLanding({ rol, obrasAsignadas, homePorRol: __HOME_POR_ROL })` para decidir page inicial; si devuelve `obraId`, setear obra activa. (En Fase 1, `obrasAsignadas` puede aproximarse con las obras del usuario; refinamiento en Fase 3.) Default seguro: 'inicio'.
- [ ] **Step 3:** renderPage: si `page === 'inicio'`, renderizar `<window.InicioPage onNav={setPage} onEnterObra={(oid)=>{ window.__setObraActivaId(oid); setPage(homeDeObra(rol)); }} />` (homeDeObra = __defaultPageForRol pero forzando una página de plano 'obra', ej. 'dashboard-gestion' si el sugerido es general).
- [ ] **Step 4:** Calcular `const plano = page === 'inicio' ? 'general' : planoDe(page);` y pasar `plano={plano}` a `<Sidebar .../>`. Cuando `page === 'inicio'`, ocultar el sidebar (render launcher full-width) o pasar `plano='general'` (mostrar tiles en main, sidebar general). Decisión Fase 1: en 'inicio' NO mostrar sidebar (launcher full).
- [ ] **Step 5:** Pasar `plano` + `onInicio={()=>setPage('inicio')}` al `<Header/>`.
- [ ] **Step 6:** Build + tests — `npm run build && npx vitest run` → verde.
- [ ] **Step 7: Commit** — `git add src/jx-app.jsx && git commit -m "feat(nav): jx-app renderiza Inicio + pasa plano a sidebar/header + landing por rol"`

---

### Task 5: Header adapta por plano (← Inicio + cambio rápido de obra)

**Files:**
- Modify: `src/jx-app.jsx` (componente Header, ~370-460)

- [ ] **Step 1:** Header acepta props `plano`, `onInicio`. Si `plano !== 'general'` o no estamos en inicio, mostrar botón `← Inicio` (llama `onInicio`). Cuando `plano === 'obra'`, mantener el selector de obra como "cambio rápido" (el dropdown ya existe). Cuando `plano === 'general'` (páginas generales), ocultar el selector de obra (no aplica).
- [ ] **Step 2:** Build — `npm run build` → verde.
- [ ] **Step 3:** Registrar 'inicio' como página visible para todos: en `jx-admin.jsx __canSeeSidebarItem`, asegurar que 'inicio' siempre retorne true (como 'dashboard'). Y en `PAGE_REGISTRY`/routing, 'inicio' lo maneja jx-app directamente (no es chunk lazy).
- [ ] **Step 4: Commit** — `git add src/jx-app.jsx src/components/jx-admin.jsx && git commit -m "feat(nav): header con ← Inicio + cambio rápido de obra por plano"`

---

### Task 6: Deploy + verificación

- [ ] **Step 1:** `npm run build && npx vitest run` → verde; `ls api/*.js | wc -l` → 12.
- [ ] **Step 2:** `git push origin main`.
- [ ] **Step 3:** Verificar deploy por contenido: el chunk con InicioPage contiene "DATOS GENERALES" y "OBRAS"; el header contiene "Inicio" (← Inicio). Esperar build Vercel READY, fetch del entry → chunk → grep strings.

## Self-review
- Cobertura del spec: Inicio (T3), 2 planos (T1/T2/T4), header ← Inicio + cambio rápido (T5), landing por rol (T1/T4). Empresas-como-hub de contabilidad y tarjetas con avance financiero = Fases 2/3 (fuera de Fase 1, declarado). 
- Placeholders: ninguno; cada task con código/acción concreta.
- Tipos: `planoDe`/`resolveLanding`/`GENERAL_ITEMS` consistentes entre T1 y consumidores T2/T4.

## Fases siguientes (fuera de Fase 1)
- Fase 2: Empresas como hub de contabilidad de empresa (agrupar Balance/Libros/SUNAT/Cuentas bajo Empresas; sub-nav).
- Fase 3: tarjetas de obra con avance físico+financiero en vivo (calcAvanceFinanciero); filtro de obras por `obra_usuarios` (asignación real); suavizar cambio de obra sin recarga.
