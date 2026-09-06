# Tanda 6 — Los dos ámbitos, y las puertas que llevaban al lugar equivocado

> 5-sep-2026. Feedback de Gabriel, dos frases:
>
> 1. *«Quise entrar a órdenes de compra y servicios para un trabajo
>    (Miraflores) y me llevó a contabilidad de JARVEX.»*
> 2. *«Intenté entrar por contabilidad a la contabilidad de la obra y terminé
>    en la pestaña de trabajo de la obra con almacén, gestión de obra, etc.»*
>
> Son dos bugs distintos con una raíz común: **el ámbito en el que estás parado
> no se respetaba al cruzar de una pantalla a otra.**

---

## El modelo, en una línea

La app tiene **dos ámbitos hermanos y excluyentes**: estás parado en un
**TRABAJO** (obra activa, plano `obra`) o en una **EMPRESA** (empresa activa,
plano `general` con área `empresa`). Nunca en los dos. Eso ya estaba escrito
en `useEmpresaBloqueada()` — «dentro de una obra manda la obra» — pero solo se
aplicaba *mientras* estabas en el plano obra. El contexto de empresa seguía
guardado y reaparecía al primer paso afuera.

---

## Bug 1 — La empresa activa vieja secuestraba la navegación

### Qué pasaba, exactamente

`empresa_activa_id` vive en `localStorage` (sobrevive al F5, como la obra
activa) y **solo se limpiaba** al apretar «Volver a Empresas» dentro del panel
de una empresa. Cualquier otra salida —el menú, el Inicio, entrar a un
trabajo— la dejaba puesta.

Entonces: entrás a JARVEX un martes, salís por el menú, el jueves entrás a
Miraflores. Dentro del trabajo no se nota nada (`useEmpresaBloqueada` la tapa
en el plano obra). Tocás cualquier pantalla contable general y JARVEX vuelve:
`areaActual` pasa a `'empresa'`, el menú entero se vuelve **«CONTABILIDAD DE
ESTA EMPRESA»** y la pantalla arranca filtrada por su RUC. Sin haber hecho
nada.

### Qué se hizo

- **Entrar a un trabajo SALE de la empresa.** `limpiarEmpresaActiva()` en los
  cuatro puntos donde se entra deliberadamente a una obra: `entrarObra`
  (`jx-app.jsx`), `irATrabajo` y la tarjeta de consorcio (`jx-contabilidad.jsx`),
  `irAObra` / `irAPersonalDeObra` (`jx-empresa-detalle.jsx`).
  **No** se puso dentro de `setObraActivaId()`: ese setter también corre solo
  al bootear (elige la primera obra visible) y ahí borraría el contexto de una
  contadora que no pidió nada.
- **El selector de empresa de Órdenes dejó de fijar el contexto global.**
  Elegir «JARVEX» en el desplegable llamaba a `setEmpresaActivaId()`: un filtro
  de pantalla te metía en la contabilidad de esa empresa para toda la app.
  Dentro de una obra ahora es lo que parece — un filtro.
- **Dentro de una obra, el filtro de empresa arranca en «todas»**, no en la
  empresa activa guardada. Con `filtroInicialEmpresa()` un contexto viejo
  escondía la mayor parte de la obra sin decir por qué.

---

## Bug 2 — «Contabilidad → un trabajo» daba el índice, no los libros

`ContabilidadGrupoPage` es el **Resumen por entidad**: filas con ingresos,
egresos y utilidad. Al tocar la de un trabajo, `irATrabajo` navegaba a
`panel-obra` — el desglose con Almacén, Logística, Gestión de obra,
Especialistas. Entrás por los libros y te da el índice del trabajo.

Lo mismo hacía la tarjeta de un **consorcio** en el catálogo de Empresas, que
según `docs/tanda-2-navegacion.md` §4 debía llevar «un hipervínculo a la
contabilidad de su obra».

**Ahora las dos van a `movimientos-contables` en plano `obra`**, con la obra
fijada: es la contabilidad de la obra (con sus dos libros de la tanda 4 A1).

---

## Bug 3 — Órdenes no tenía puerta desde el trabajo (la causa de fondo del 1)

La tanda 5 puso el registro documental de órdenes en dos lados —Contabilidad
del grupo y el panel de una empresa— porque **una orden la numera un RUC**
(`OC-001-2026` por empresa). Cierto, pero incompleto: una orden **respalda la
compra de una obra**, y ésa es la pregunta con la que Gabriel la fue a buscar.
Desde Miraflores no había ninguna puerta, así que el único camino pasaba por
la contabilidad del grupo — donde lo esperaba el bug 1.

### Qué se hizo

`'ordenes'` pasó a ser un **ítem DUAL**, con la misma mecánica que
`movimientos-contables`:

| | |
|---|---|
| `nav-planos.js` | sale de `GENERAL_ITEMS` (plano por defecto: `obra`), se queda en `AREA.contabilidad` |
| `desglose-obra.js` | entra al grupo **`contabilidad-obra`** — es el papel que respalda esos movimientos. **No** en Logística: ahí vive `ordenes-compra`, que es el circuito requisición→OC→recepción del almacén y es otra pantalla |
| `jx-sidebar.jsx` | dos entradas: «Órdenes de Compra y Servicio **de esta obra**» (`plano: 'obra'`) y la del grupo (`plano: 'general'`) |
| `lib/ordenes.js` | `comprobantesSinOrden()` y `resumenRespaldo()` aceptan `obraId` |
| `jx-ordenes.jsx` | con `window.__plano === 'obra'` acota emitidas y pendientes a la obra activa, y muestra su cartel con la salida |

**La empresa NO se acota junto con la obra**, a propósito y por el mismo
motivo que en Movimientos (`tanda-2-navegacion.md` B1): en Miraflores, de 460
comprobantes solo 112 son del titular (CONSORCIO EL INCA) — el resto es la
cadena intercompany. Fijar el titular escondería 3 de cada 4 órdenes de la
obra.

### El número que justifica la puerta

Medido contra producción el 5-sep-2026 (compras en soles, > S/ 2.000):

| Obra | Comprobantes sin respaldo | Monto |
|---|---:|---:|
| **Plan Miraflores** (CUI 2293464) | **94** | S/ 2.035.152 |
| Obras San Marcos | 33 | S/ 1.110.949 |
| Sin obra (gasto de empresa) | 77 | S/ 791.488 |

> ⚠️ **Corregido el 6-sep.** La primera versión de esta tabla decía 139 / 65 / 98
> y S/ 3.192.140 en Miraflores. Estaba mal: la consulta no filtraba por `type` e
> incluía las VENTAS. El filtro real es el de `necesitaOrden()` en
> `src/lib/ordenes.js` — `type IN ('cost','expense')`, moneda PEN, sin orden ya
> asignada, y monto > el umbral. Los números de arriba son con ese filtro. El
> mensaje del commit `bacf1ea` conserva la cifra vieja: quedó escrita antes de
> detectarlo.

`ordenes_compra` sigue en **0 filas**: nunca se emitió una. La pestaña «Sin
respaldo», ahora acotada a la obra, es la que tiene trabajo real que hacer.

---

## Dos arreglos menores que salieron por el camino

- **El panel del trabajo rotulaba sus tarjetas con el nombre de la vista del
  grupo.** `navInfo` construía el mapa de labels desde `window.NAV` con
  «el último gana», y los ítems duales están dos o tres veces: la tarjeta de
  contabilidad de la obra decía «Movimientos (todas / por obra)». Ahora manda
  la entrada del plano obra, que es la que el panel abre.
- **El test que monta las 114 pantallas ahora corre dos veces**: en el plano
  general y **parado dentro de una obra** (`__plano='obra'`). Las pantallas
  duales toman otro camino según el plano y ese camino no lo probaba nadie —
  exactamente el hueco por el que se coló el TDZ que dejó Movimientos
  Contables muerto con el green gate en verde.

---

## Verificación

- **Green gate:** `npm run test:unit` 1258 verdes · `npm run build` limpio ·
  sin chunk nuevo en `dist/assets` (67 chunks `jx-*`, idénticos a la base).
- **A mano, lo que reportó Gabriel:**
  1. Entrar a Miraflores → menú de la obra → «Órdenes de Compra y Servicio de
     esta obra»: tiene que quedarse en la obra, con su cartel ámbar, y mostrar
     94 comprobantes sin respaldo (no los 204 del grupo).
  2. Contabilidad → Resumen por entidad → la fila de Miraflores: tiene que
     abrir **Movimientos de esta obra**, no el panel con Almacén y Gestión.
  3. Entrar al panel de JARVEX, salir por el menú, entrar a un trabajo y
     volver a una pantalla contable: el menú **no** debe decir «CONTABILIDAD
     DE ESTA EMPRESA».

## Queda abierto

- `jx-empresa-detalle.jsx` → «Ir a Equipos Pesados» navega al plano obra sin
  elegir obra: caés en la que estuviera activa. Es la misma clase de salto,
  pero arreglarlo pide decidir **cuál** obra (¿preguntar, como hace
  `irAPersonalDeObra`?) y eso es una decisión de producto, no de código.
- La entrada de ayuda de `ordenes` (y ~960 strings más en `src/api`) sigue en
  voseo. Se corrigió solo el texto nuevo.

## Modelo, effort y sesión recomendados

| Qué | Modelo | Effort | Sesión |
|---|---|---|---|
| Esta tanda | Opus 5 | alto | Ya hecha. Toca planos, áreas y contextos persistidos: un error acá se paga con una pantalla que muestra los datos de otra entidad. |
| Verificación en staging | — | — | Gabriel, a mano, con los tres pasos de arriba. |
| «Equipos Pesados» sin obra | Sonnet 5 | medio | Sesión nueva, después de que Gabriel decida si pregunta la obra o lleva al panel de la empresa. |
