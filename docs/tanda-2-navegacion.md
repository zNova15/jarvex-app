# JARVEX — Tanda 2 de 3: navegación y flujo

> **Revisión 3-sep-2026.** La versión anterior planteaba **dos** entradas
> hermanas (Obras y Empresas). Gabriel amplió el diseño a **cinco bloques** y
> corrigió uno: donde decía "Obras" va **"Trabajos"**, porque un trabajo puede
> ser una obra, una supervisión o una venta de bienes/servicios. Esa corrección
> no era posible cuando se escribió el doc original — la taxonomía se decidió
> después, en la tanda 1, que ya dejó el modelo listo (`obras.tipo_trabajo` con
> 4 valores + la tabla `trabajos`).

## Contexto base (dar por sentado)
JARVEX es un ERP de obra offline-first. `companies`, `obras`, `consorcios` y
`trabajos` ya existen como entidades independientes (tanda 1, migs 172-174
aplicadas). Esta tanda **no cambia el modelo de datos**: cambia por dónde se
entra y cómo se agrupa lo que ya está.

### El síntoma que la motiva
Gabriel (3-sep): *"Intenté ir a ver la configuración de la obra activa de
Miraflores y tuve que ingresar a la sección de Empresas para ahí encontrar el
apartado de obras y editarlas."*

Eso pasa porque hoy no hay un bloque "Trabajos": `obras` vive en el plano
general (`nav-planos.js` `GENERAL_ITEMS`) y el sidebar la agrupa junto a
Empresas y contabilidad. El camino a la obra pasa por un bloque que no tiene
nada que ver con ella.

## 1. La pantalla principal: cinco bloques hermanos

```
TRABAJOS      EMPRESAS      CONTABILIDAD      LICITACIONES      CONFIGURACIÓN
```

| Bloque | Qué contiene | Estado hoy |
|---|---|---|
| **Trabajos** | Todo lo que ejecutamos: Obras · Supervisiones · Bienes y Servicios | El modelo existe (tanda 1); falta la entrada unificada |
| **Empresas** | Empresas del grupo y consorcios, cada una con su desglose | Existe como página plana |
| **Contabilidad** | Dashboard + contabilidad neta del grupo (consorcios incluidos) | Hoy es un *área*, no un bloque; el consolidado no elimina de verdad → **tanda 3** |
| **Licitaciones** | Búsqueda de trabajos a postular, cartas, plantel profesional | El rol y el Registro Profesional existen (mig 171); el bloque no |
| **Configuración** | Usuarios, roles, solicitudes, conflictos, auditoría | Existe como área `admin` |

## 2. Entrega A — El flujo de entrada (esta entrega)

Lo que se nota al entrar y no toca ningún dato.

### A1. Los cinco bloques
- `src/components/jx-inicio.jsx` — `BLOQUES` (líneas ~37-129) pasa a tener los
  cinco de primer nivel. Hoy los tiles están mezclados por tema (almacén,
  logística, contabilidad…); se reagrupan bajo los cinco.
- `src/lib/nav-planos.js` — `AREA` gana `trabajos` y `licitaciones` junto a las
  tres que ya están (`contabilidad`, `direccion`, `admin`). El sidebar ya sabe
  mostrar solo el área en la que estás: es el mecanismo que hace que esto
  funcione sin reescribir el menú.

### A2. Trabajos como entrada de primer nivel
- Página nueva `jx-trabajos-hub` (o `TrabajosPage` dentro del chunk que ya
  creamos): lista **los tres tipos juntos**, con filtro por naturaleza.
  Las obras salen de `obras` (con `tipo_trabajo`), los bienes y servicios de
  `trabajos`. Reusa `src/lib/tipos-trabajo.js` y `src/lib/trabajos.js`, ambas
  con tests.
- Desde ahí se entra a una obra concreta (que fija la obra activa) o a un
  trabajo de bienes/servicios.
- **Esto es lo que arregla el síntoma:** el camino a Miraflores pasa a ser
  Inicio → Trabajos → la obra, sin pasar por Empresas.

### A3. Arranque de sesión por rol
Lo que el doc original ya pedía y sigue en pie:
- **Roles obra-scoped** (Ingeniero, Residente, Seguridad, Almacenero y el resto
  de campo): conservan el selector de obra activa en el encabezado **tal cual
  funciona hoy. No tocar este flujo.**
- **Roles cross-obra** (Admin, Contador Jefe, Ayudante Contab., Licitaciones):
  salen del paso "fijar obra de trabajo" del arranque. Entran a la pantalla de
  los cinco bloques, sin obra fija de fondo.
- `src/components/jx-admin.jsx` — `__HOME_POR_ROL` (~línea 1396) ya define el
  aterrizaje por rol: acá se ajusta.

### A4. Atajos contextuales
El sidebar hoy lista todas las secciones sin importar dónde estás. Pasa a
mostrar solo las de la sección actual **más un acceso siempre visible para
volver a la pantalla principal**. El mecanismo de áreas de `nav-planos.js` ya
resuelve la mitad; falta el "volver" fijo.

## 3. Entrega B — Desglose de un trabajo ✅ HECHA (3-sep-2026)

Al entrar a una obra, sus secciones agrupadas como Gabriel las nombró:

```
ALMACÉN          (lo más importante del día a día)
LOGÍSTICA        requisiciones, órdenes de compra, recepciones
GESTIÓN DE OBRA  partidas, cronograma, avance, valorizaciones, costos
PERSONAL Y SUBCONTRATOS
SECCIONES ESPECIALES   seguridad · ambiental · calidad · social
CONTABILIDAD DE LA OBRA    ← nuevo: solo del consorcio que la ejecuta
CADENAS INTERCOMPANY       ← se mueve acá desde el bloque general
```

Lo entregado:

**B0. Panel del trabajo** (`panel-obra`, en el chunk `jx-trabajos`): la pantalla
que faltaba. Al entrar a un trabajo se ve quién lo ejecuta, quién lleva sus
libros (titular contable + socias con su %), **el equipo designado a ese
trabajo con su rol** y las 7 tarjetas de secciones. La pertenencia página→grupo
vive en `src/lib/desglose-obra.js` (con tests) y la usan el panel **y** el
sidebar: un test falla si una página del plano obra queda sin grupo, porque
desaparecería del panel sin que nadie lo note. El sidebar del plano obra pasó
de 11 encabezados sueltos a estos 7.

**B1. Contabilidad de la obra — CORREGIDO contra los datos reales.** El plan
decía: dentro de una obra la empresa no se elige, es su titular contable. **Los
datos lo desmienten.** En Miraflores, de 460 comprobantes imputados a la obra
solo **112 están a nombre del titular** (CONSORCIO EL INCA); el resto es de
JARVEX (133), GASOMI (85), JADE (36), JHEENSEG (34)… En San Marcos, CHUSAAC
tiene 32 de 89. No es un error de carga: **es la cadena intercompany** — las
empresas del grupo compran y le facturan a la ejecutora. Fijar el titular
habría escondido 3 de cada 4 movimientos de la obra y roto el criterio de
verificación de este mismo documento ("los totales deben coincidir con los que
hoy da Movimientos filtrando por esa obra").

Lo que se hizo en su lugar:
- La **obra** sí deja de elegirse dentro del workspace: el selector se
  reemplaza por un cartel con la obra activa y un enlace "Ver todas las obras →"
  a la vista general. Esa era la confusión real a eliminar.
- El selector de **empresa** se acota a las que tienen comprobantes en ESA obra
  (no a las 16 del grupo), con el titular marcado como "· titular contable" y un
  contador que dice cuántos son del titular y cuántos de las otras.
- El panel del trabajo muestra el reparto completo por empresa. Es el número que
  la **tanda 3** (consolidado con eliminaciones) tiene que hacer desaparecer.
- Los saltos cross-obra (Búsqueda Global, alertas, Guías) navegan explícitamente
  a la vista **general** de Movimientos: si no, un comprobante de otra obra
  quedaba inalcanzable desde el workspace.

**B2. Cadenas intercompany dentro de la obra.** Hecho: `trazabilidad` salió de
`GENERAL_ITEMS` y del área de contabilidad, y vive en el workspace del trabajo
(sección "CADENAS INTERCOMPANY"). La lista se acota a la obra activa y "Nueva
Cadena" se deshabilita sin obra. La última empresa de la cadena sigue siendo la
ejecutora resuelta por `titularContableDeObra()`. Las 2 funciones serverless que
la asistían siguen borradas: se rehacen cuando haya uso real (hoy 0 filas).

## 4. Entrega C — Desglose de una empresa

Al entrar a una empresa del grupo:

| Sección | Qué muestra | Estado |
|---|---|---|
| **Contabilidad de la empresa** | Solo de esa entidad legal | Existe en `EmpresaDetalle` |
| **Inventario** | Todos los insumos que debería tener según sus comprobantes | Existe a medias ("QUÉ COMPRÓ") |
| **Personal** | Planilla · recibo por honorarios · libres | Falta: `personal` no tiene `company_id`, solo `obra_id` |
| **Trabajos** | Qué está ejecutando o de qué es parte | Nuevo: se deriva de `obras.ejecutora_company_id`, `consorcio_socios` y `trabajos.ejecutor_company_id` |

**Consorcios en este bloque:** se listan (ya separados por `tipo_entidad`) pero
**no se editan acá**. Llevan un hipervínculo a la contabilidad de su obra, que
es donde viven.

⚠ **`personal` no tiene `company_id`** — su único scoping es `obra_id` (mig 001)
y `UNIQUE(dni, obra_id)`.

**DECIDIDO por Gabriel (3-sep): NO se agrega la columna.** El modelo es:
los **usuarios de la app son globales del programa** y se **designan por rol a
cada trabajo** (obra, supervisión, bien/servicio); la misma persona puede estar
en varios trabajos, con roles distintos. Entonces "el personal de esta empresa"
se **deriva**: los trabajos que la empresa ejecuta (`obras.ejecutora_company_id`,
`consorcio_socios`, `trabajos.ejecutor_company_id`) → su gente.

Estado real del esquema (verificado 3-sep): `obra_usuarios` YA tiene `rol_obra`
con el CHECK ampliado a los 18 roles (migs 103/136), y hay 15 personas
designadas en Miraflores y 3 en San Marcos. **Pero la UI lo mantiene igual al rol
global**: `handleChangeRol` (jx-admin) propaga `profiles.rol` a `obra_usuarios.rol_obra`
de todas sus obras. Para que un usuario pueda tener rol distinto por trabajo hay
que **cortar esa propagación**, y eso toca policies de Storage que filtran por
`rol_obra <> 'solo_lectura'` (migs 104/106): es la primera decisión de la
entrega C, no un cambio suelto. El Panel del trabajo ya MUESTRA `rol_obra` como
"el rol en este trabajo".

## 5. Condición no negociable (del doc original, sigue vigente)

Cualquier cambio de qué rol ve o no ve qué pantalla **debe reflejarse en espejo
en RLS de Postgres**, no solo en el cliente o el menú. Las allowlists de
`jx-admin.jsx` son UI: no protegen datos.

Pesa especialmente porque la mig `030_rls_bulk_authenticated.sql` sigue laxa
(~40 tablas con `USING(true)` para cualquier autenticado, `accounting_movements`
incluida). Las tablas de la tanda 1 no la heredan — nacieron con policies por
rol — pero las viejas sí.

## Roles (referencia al ajustar rutas y menús)
- **Administrador:** control total del grupo.
- **Contador Jefe:** mismo nivel que admin pero limitado a su área, con
  visibilidad global dentro de ella (todas las empresas, todos los
  consorcios/obras).
- **Asistentes contables:** ámbito asignado por la jefa.
- **Licitaciones / Desarrollo comercial:** busca obras, consultorías y
  bienes/servicios. Hoy sin cuentas activas.
- **Personal de obra:** separado en Ejecución y Supervisión — **no fusionar**.

## Verificación
- **Green gate** antes de cada promoción: `npm run test:unit` (todos verdes) y
  `npm run build` limpio, sin chunk nuevo inesperado en `dist/assets`.
- **Entrega A:** entrar como admin y llegar a la configuración de Miraflores
  **sin pasar por Empresas**; confirmar que un ingeniero sigue teniendo su
  selector de obra activa intacto y que un admin ya no debe fijar una.
- **Entrega B:** dentro de una obra de consorcio, confirmar que la contabilidad
  muestra el titular contable sin selector de empresa, y que los totales
  coinciden con los que hoy da `Movimientos Contables` filtrando por esa obra.
- **Entrega C:** que Empresas liste solo las del grupo y que cada ficha muestre
  sus trabajos.
- **RLS:** por cada cambio de visibilidad, el `SELECT` equivalente ejecutado con
  el JWT de ese rol debe devolver lo mismo que muestra el menú.

## Modelo, effort y sesión recomendados

| Entrega | Modelo | Effort | Sesión |
|---|---|---|---|
| **A — Flujo de entrada** | Opus 5 | alto | Esta misma. Toca `jx-inicio`, `nav-planos`, `jx-admin` y el arranque: mucho acoplamiento y una pantalla en blanco se paga caro. |
| **B — Desglose de trabajo** | Opus 5 | alto | ✅ Hecha 3-sep-2026. Lección: el criterio de verificación del propio documento ("los totales deben coincidir") fue lo que detectó que B1 estaba mal planteada — vale medir los datos ANTES de escribir la pantalla, no después. |
| **C — Desglose de empresa** | Sonnet 5 | medio | Sesión nueva, después de decidir lo de `personal.company_id`. Mayormente reagrupar lo que ya existe. |
