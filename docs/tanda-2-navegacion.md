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
  aterrizaje por rol: aquí se ajusta.

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
CADENAS INTERCOMPANY       ← se mueve aquí desde el bloque general
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
**no se editan aquí**. Llevan un hipervínculo a la contabilidad de su obra, que
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

## 4-bis. Entrega D — Navegación de dos niveles DE VERDAD + aislamiento

> **Escrita el 3-sep-2026, después de que Gabriel probara A/B/C en staging.**
> Las entregas A-C construyeron las piezas correctas pero la **pantalla
> principal seguía siendo la vieja**: nada de esto se notaba al entrar.

### Lo que Gabriel encontró al probar

1. *"En la pantalla inicial se supone que solo existirían los 5 bloques; no
   debería estar Obra de Trabajo ni Trabajo en la Obra."* — el Inicio tenía
   arriba un **selector de obra** y abajo los **bloques de la obra** (Almacén,
   Logística…) planos. Eso último es el desglose de un trabajo: vive en el
   Panel del trabajo (entrega B), no en la pantalla del grupo.
2. *"Al ingresar a uno de los 5 bloques debería llevarme a otra pantalla, no
   expandirla nada más."* — los bloques se **desplegaban en el lugar**. Un
   bloque tiene que navegar: Trabajos → la lista → un trabajo → su desglose.
3. **Un almacenero designado a UNA obra vio las dos del grupo.**

### Lo que se hizo

**D1. La pantalla principal es solo el primer nivel** (`jx-inicio.jsx`,
reescrito). Cinco bloques que NAVEGAN; sin selector de obra, sin bloques de
obra, sin desplegar. Los `BLOQUES` temáticos viejos (~100 líneas) se borraron:
el desglose de un trabajo ya tiene su fuente única en `desglose-obra.js`.
Cada bloque declara `entradas` (varias candidatas) y usa la primera que el rol
puede abrir — así la contadora entra a Configuración por 'configuracion' y el
admin por 'usuarios', sin bloques muertos.

**D2. Contabilidad, como la definió Gabriel.** Hay una *contabilidad de
entidad* que llevan **cada empresa del grupo** y **cada trabajo**; el bloque
Contabilidad es el **resumen de todas ellas con el vínculo a cada una**. Los
consorcios no figuran como empresa (su contabilidad es la de su trabajo, que
es donde se mira) y a los terceros no se les llevan libros. Pantalla nueva
`contabilidad` (`ContabilidadGrupoPage`, dentro del chunk `jx-contabilidad`,
sin chunk nuevo) sobre `src/lib/contabilidad-entidades.js` (con tests).
🔴 **Los dos totales NO se suman y la pantalla lo dice:** un comprobante tiene
`company_id` y además puede tener `obra_id`/`trabajo_id` — aparece en su
empresa Y en su trabajo. Son dos miradas de la misma dinero. Eliminar de verdad
lo repetido es la **tanda 3**. Las empresas se calculan con la MISMA función
que su ficha (`resumenFinancieroEmpresa`) para que no haya dos números
distintos de lo mismo.

**D3. Aislamiento por obra — los tres agujeros.** Medido contra producción
(2 obras, 17 usuarios) antes de tocar nada:
- *Cliente 1:* "sin designaciones" devolvía `null` = **ve todas**. Ahora un rol
  de obra sin designaciones ve un Set **vacío** y la pantalla le dice a quién
  pedirle acceso (`obras-asignadas.js`, con tests).
- *Cliente 2:* `window.__obrasPermitidas` se poblaba async y hasta que resolvía
  valía `undefined`, que todos los consumidores leían como "sin restricción":
  **en cada arranque había una ventana con todas las obras a la vista**. Ahora
  arranca del caché local y, si no hay, queda cerrado y en `loading`.
- *Servidor:* `obras` tenía **dos** policies de SELECT permisivas
  (`USING(true)` y `uid IS NOT NULL`) que se combinan con OR → cualquier
  autenticado se bajaba todas. **Mig 175**, validada con ROLLBACK contra los
  usuarios reales: almacenero 2→**1** obra, ingeniero 2→**1**, contadora/admin
  siguen viendo 2, la cuenta `campo` 0 (no las usa).
- ⚠ **Alcance honesto (al 3-sep):** la 175 cierra `obras` y `obra_usuarios`.
  Las tablas HIJAS seguían con la mig 030 laxa — el 🔴 pendiente de siempre.
  **CERRADO el 4-sep** por las migs **177** (cerco de obra en las 71 tablas
  hijas) y **178** (cerco de módulo por rol). Ver `docs/cercos-rls.md`.

**D4. Aterrizaje por rol** (`resolveLanding`): un rol de obra ya no pasa por la
pantalla de bloques del grupo (de los cinco solo puede abrir uno). Con **una**
obra entra **directo a su desglose** (`panel-obra`); con varias o con ninguna,
a la lista de **sus** trabajos. Y `trabajos` pasó a ser visible para todo rol
logueado —como `panel-obra`— porque es la puerta de entrada: mandar ahí a un
almacenero que no podía verla era dejarlo en "Sin acceso" en su propia pantalla
de arranque. La lista se acota a las obras designadas.

## 4-ter. Entrega E — El desglose de la empresa (y el de la obra, afinado)

> Segunda prueba de Gabriel, el mismo 3-sep. La 2D arregló la puerta de
> entrada; esto arregla lo que había detrás de dos de los bloques.

### E1. Empresas: bloques y desglose, no una tabla con pestañas
*"Cuando ingresas a empresas te sale lo que siempre me ha salido […] Se supone
que debería estar en bloques […] y cuando yo dé clic debería darme el
desglosado, pero de la empresa en general. Tú estás haciendo simplemente el
desglose de la parte contable y eso está mal."*

- El catálogo pasa de **tabla de 10 columnas a tarjetas agrupadas por las tres
  clases** (grupo · consorcios · terceros), con buscador y filtros por clase.
  A un TERCERO no se le muestran números: no le llevamos libros.
- Cada empresa abre un **PANEL, hermano del Panel del trabajo**, con sus
  **8 secciones** en tarjetas y el conteo de cada una: Ficha · Contabilidad ·
  Compras e inventario · Personal · Trabajos · Tesorería · Equipos ·
  Documentos y SUNAT. Definidas en `src/lib/desglose-empresa.js` (con tests
  que las atan al menú real), espejo de `desglose-obra.js`.
- Tres secciones son nuevas y salen de datos que ya existían y no se veían:
  **Ficha** (los datos legales solo se podían mirar abriendo el formulario de
  edición), **Tesorería** (`cuentas_bancarias` + `cronograma_pagos` por
  `company_id`) y **Equipos** (`activos_pesados.company_id`).
- **EMPRESAS gana área propia en el menú.** Era la otra mitad de la queja
  ("en la parte izquierda me sale como siempre"): entrar al catálogo mostraba
  las 22 secciones contables. Ahora Empresas y Contabilidad son áreas
  hermanas, como los bloques que son.

### E2. Ingenieros ≠ especialistas (desglose del trabajo)
Definición de Gabriel: el **ingeniero de campo** es civil, sigue el avance por
**zonas y frentes**, y se lo designa **líder de un frente**; el **especialista**
se encarga de seguridad, calidad o ambiental **a nivel macro de toda la obra**.
Eran un solo bloque. Ahora el desglose del trabajo tiene **8 grupos**: se
separó **"Ingenieros y frentes"** de "Gestión de obra" (se llevó `frentes`,
las 9 pantallas de frente, la aprobación de frentes y el rendimiento de
ingenieros), y "Secciones especiales" pasó a llamarse **"Especialistas"**.

### E3. La contadora jefe ve subcontratos
*"Sí debería ver los subcontratos, porque es parte de la contabilidad también."*
`contador` gana `w` en Subcontratistas, Subcontratos y Valor. Subcontrato:
lo que factura un subcontratista entra por sus libros como cualquier costo.

## 4-quater. Entrega F — La empresa activa

> Tercera prueba de Gabriel. Le gustó el panel de empresa, pero encontró que
> **al salir de él se perdía la empresa**: *"si luego tú presionas movimientos,
> ahí te va a salir de todos […] aquí tienes nuevamente todo mezclado"*.

### F1. La contabilidad de una empresa es un panel, no cinco números
*"Contabilidad debería ser la parte que esté MÁS DESARROLLADA en cada empresa.
Ahí debería salir movimientos […] guías de remisión […] compras por categoría
[…] flujo de caja, cuentas, plan de cuentas, libro diario mismo, que no lo he
visto, y eso es importantísimo."*

La sección Contabilidad del panel de empresa muestra arriba su resumen y abajo
**12 bloques** que abren cada pantalla contable: Dashboard, Movimientos,
Comprobantes, Guías, Compras por categoría, Libro diario, Plan de cuentas,
Estado de resultados, Balance, PLE, Flujo de caja y Operaciones entre
empresas. `Documentos y SUNAT` dejó de ser sección hermana y vive aquí adentro,
como él pidió.

### F2. EMPRESA ACTIVA — el mecanismo que faltaba
Hermana de la **obra activa**, y por el mismo motivo. `src/lib/empresa-activa.js`
(con tests) guarda en qué empresa estás parado, y con eso:
- **cada pantalla contable arranca filtrada por ella** — una línea por
  pantalla: `useState(() => filtroInicialEmpresa('todas'))`. Aplicado en
  Movimientos, Dashboard contable, Comprobantes, Guías, Compras por categoría,
  Libro diario, Balance, EE.RR., PLE y Flujo de caja;
- **el menú de la izquierda cambia**: con empresa activa, las secciones
  contables se agrupan bajo "CONTABILIDAD DE ESTA EMPRESA" en vez de listar
  las 22 del grupo;
- **un cartel** (`window.EmpresaActivaBanner`, eager) dice en qué empresa
  estás y da la salida: "Ver todas las empresas →". Sin él, una lista más
  corta de lo normal no tendría explicación.

Quedan FUERA del contexto a propósito: el **Resumen por entidad**, el
**Consolidado** y el **Análisis de insumos** — comparan o consolidan el grupo
entero, y mirarlos "desde una empresa" no significa nada (`esPaginaDeEmpresa`).

`compras-categoria` no tenía filtro de empresa y se le agregó: era parte del
pedido — *"en la empresa también se puede categorizar qué compras está
haciendo"*.

## 5. Condición no negociable (del doc original, sigue vigente)

Cualquier cambio de qué rol ve o no ve qué pantalla **debe reflejarse en espejo
en RLS de Postgres**, no solo en el cliente o el menú. Las allowlists de
`jx-admin.jsx` son UI: no protegen datos.

Pesaba especialmente porque la mig `030_rls_bulk_authenticated.sql` es laxa
(~40 tablas con `USING(true)` para cualquier autenticado, `accounting_movements`
incluida). Las tablas de la tanda 1 no la heredan — nacieron con policies por
rol — pero las viejas sí.

**Las migs 177 y 178 (4-sep) no borran la 030: la envuelven.** Le suman policies
RESTRICTIVE, que se combinan con AND, así que el permiso viejo sigue ahí y
encima hay que ser de la obra (177) y del módulo (178). Lo que la 030 abrió ya
no alcanza para leer nada ajeno. Detalle y lo que queda abierto:
`docs/cercos-rls.md`.

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
