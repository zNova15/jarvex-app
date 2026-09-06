# Tanda 4 — El libro de la obra, y las órdenes que faltan

> Análisis del feedback de Gabriel del 4-sep-2026, después de probar en
> producción la tanda 3. Todo lo de aquí está **medido contra la base real**,
> no razonado en el aire.
>
> **✅ DEPLOYADO el 4-sep (`79bb20f`), la tanda chica — C1, A3, D1:** pila de
> navegación («← Volver»), alerta de imputación cruzada en Movimientos
> Contables (17 detectados, con filtro y botón «Reimputar») e Intercompany
> mudado al menú de la obra. Ver `docs/cercos-rls.md` no — esto va sin doc
> aparte, quedó documentado en el propio commit y en `ayuda-contenido.js`.
>
> **✅ B1+B2+B3+B4 HECHAS** en la tanda 5 — ver
> `docs/tanda-5-ordenes-y-activos.md`.
>
> **✅ A1 HECHA (4-sep, staging):** los dos libros de la obra, con nombre y
> con cuenta. `src/lib/libros-de-obra.js` (15 tests) + tres pestañas en
> Movimientos Contables dentro de un trabajo. Detalle abajo, en "A1 — cómo
> quedó".
>
> **⏸ A2 EN ESPERA A PROPÓSITO — decisión de Gabriel del 4-sep-2026:** la
> *barra de la cadena* (cuánto imputó el grupo a la obra vs cuánto se le
> facturó al consorcio) **se hace después de emitir varias órdenes de compra
> y de servicio reales**. Hoy el número saldría de una base sin una sola
> orden emitida: mediría el hueco de la carga histórica, no el de la
> facturación. Cuando Gabriel haya emitido su primer lote, el número empieza
> a significar algo y ahí se construye. **Sesión nueva, Opus 5, effort alto.**

---

## Resumen de lo que encontró Gabriel

1. La contabilidad de una obra le muestra **movimientos de varias empresas**,
   cuando debería mostrar los del **consorcio ejecutor**.
2. **No encuentra las órdenes de compra ni las de servicio**, y las necesita
   para respaldar las compras de la obra actual.
3. Desde *Resumen por entidad* entra a una empresa y **el botón de volver no
   lo devuelve** a donde estaba.
4. Las **jugadas intercompany** no deberían vivir en el bloque general de
   Contabilidad, sino dentro de las obras. El **consolidado del grupo sí** se
   queda ahí.

Los cuatro son correctos. El 1 y el 2 resultaron ser **el mismo problema visto
desde dos lados**, y eso cambia el orden en que conviene resolverlos.

---

## 1. La contabilidad de la obra — qué muestra hoy, y por qué

### Lo medido (Miraflores, 460 movimientos imputados a la obra)

| Empresa | Movs | Ventas | Compras | Monto |
|---|---:|---:|---:|---:|
| JARVEX | 133 | 4 | 129 | S/ 126.294 |
| **CONSORCIO EL INCA** (ejecutora) | **112** | 0 | 112 | **S/ 227.506** |
| GASOMI | 85 | 21 | 64 | S/ 1.757.403 |
| JADE | 36 | 1 | 35 | S/ 49.395 |
| JHEENSEG | 34 | 0 | 34 | S/ 993.186 |
| MIGUEL ANGEL JULCA | 22 | 4 | 18 | S/ 39.521 |
| SALAZAR CERQUIN RUTH | 17 | 13 | 4 | S/ 87.814 |
| otras 7 entidades | 21 | 5 | 16 | S/ 60.875 |

El titular contable de la obra tiene **112 de 460** movimientos: el 24%.

### El diagnóstico

En esa pantalla hay **dos cosas distintas mezcladas sin etiqueta**:

- **El LIBRO del consorcio** — sus 112 comprobantes propios, más los **9** que
  otras empresas del grupo le emitieron a él (por RUC o vínculo explícito).
  Total: **121**.
- **Lo que las empresas del grupo compraron y le imputaron a la obra** —
  **339 comprobantes** que no son del consorcio *ni están dirigidos a él*. Son
  las compras que JARVEX, GASOMI, JHEENSEG y JADE hicieron a proveedores de
  afuera para abastecer la obra.

Las dos son reales y las dos hacen falta. Pero **no son el mismo libro**, y hoy
la pantalla las apila como si lo fueran.

> **Por qué la tanda anterior no lo fijó al consorcio y por qué tenía razón a
> medias:** fijar el titular habría escondido 339 de 460 filas — el 74%, y con
> ellas los S/ 1,75 M que movió GASOMI. La decisión de no romper eso fue
> correcta; lo que faltó fue **nombrar las dos vistas** en vez de dejar un
> selector de empresa que el usuario tiene que adivinar.

### Lo que la medición destapó (y es lo importante)

**La cadena intercompany está registrada a medias.**

- JHEENSEG compró **S/ 993.186** para esta obra y **no emitió ni una venta**.
- GASOMI vendió **S/ 912.646** … pero **a JHEENSEG**, no al consorcio.
- El CONSORCIO EL INCA recibió del grupo, en total, **S/ 59.684** en facturas
  (4 de JARVEX, 3 de la agencia de viajes, 1 de RUTH, 1 de TEATINO).

O sea: el grupo le imputó a esta obra **millones** en compras, y al consorcio
que la ejecuta se le facturaron **S/ 59.684**. Puede haber explicación —
facturación pendiente, valorizaciones que todavía no salieron— pero **hoy la
app no lo pregunta ni lo muestra**, y esa es exactamente la brecha que Gabriel
quiere cerrar con las órdenes de compra y de servicio.

**Además hay 17 comprobantes probablemente mal imputados:** están marcados como
de Miraflores pero su receptor es CONSORCIO CHUSAAC (que es San Marcos),
CONSORCIO ESPERANZA o CONSORCIO SAMADAY (terceros). No es un bug del código: es
data que hay que revisar, y la pantalla debería señalarla sola.

### Propuesta

**A1 — Dos vistas con nombre, no un selector.** La contabilidad de la obra abre
en **«Libro del consorcio»** (los 121) y tiene al lado **«Aporte de las
empresas del grupo»** (los 339). Cada una con su total, y la pantalla dice con
todas las letras que **no se suman** — es la misma regla que ya aplica el
Resumen por entidad.

**A2 — La barra de la cadena.** Arriba, una línea que hoy no existe:
*«Las empresas del grupo imputaron S/ X a esta obra. Al consorcio se le
facturaron S/ 59.684. Diferencia sin facturar: S/ Y»*. Es un número, no una
pantalla nueva, y es el que dispara la conversación.

**A3 — Alerta de imputación cruzada.** Los 17 comprobantes cuyo receptor es
otro consorcio se marcan con un aviso y un botón para reimputar. Sin borrar
nada automáticamente.

**Obras de una sola empresa:** la misma pantalla, con el titular = esa empresa.
Como Gabriel pidió, se muestran sus movimientos desde la creación de la obra.
No hace falta lógica aparte: `titularContableDeObra()` ya resuelve los dos
casos.

---

## 2. Órdenes de compra y de servicio

### Lo que hay hoy (y por eso no lo encontró)

**Las órdenes de compra EXISTEN.** `src/components/jx-compras.jsx` tiene el
circuito completo: requisición → OC, estados, PDF para firma, subida de la OC
firmada como evidencia, anulación con motivo, auditoría. Está en el menú del
plano obra, dentro del grupo **Compras**.

**Y nunca se usó ni una vez:**

| Tabla | Filas |
|---|---:|
| `ordenes_compra` | **0** |
| `oc_items` | **0** |
| `cotizaciones` | **0** |
| `requisiciones` | 3 |
| `accounting_movements.orden_compra_id` con valor | **0** de 1.342 |

Por qué no lo vio: vive **solo** dentro del desglose de un trabajo, en el grupo
Compras, como un flujo de almacén (pedir → aprobar → ordenar). No aparece en la
contabilidad de ninguna empresa, que es donde él lo fue a buscar.

### Los cuatro huecos estructurales

1. **`ordenes_compra` no tiene `company_id`.** Solo `obra_id`. Una orden no
   puede decir *qué empresa del grupo la emite* — que es justo lo que hace
   falta para que cada una tenga su plantilla, su logo y su numeración.
2. **No existe el tipo.** No hay campo `tipo`: la **orden de servicio** no
   existe como concepto.
3. **El vínculo con la factura existe y está sin usar.**
   `accounting_movements.orden_compra_id` ya está en el esquema, con 0 filas
   llenas. No hay que inventarlo, hay que llenarlo.
4. **La plantilla ya está construida al 80%.** `companies` tiene
   `logo_dataurl`, `nombre_corto` y `codigo_doc_prefix`, y
   `src/lib/plantillas-pdf.js` ya arma PDFs con la marca de la empresa
   ejecutora (hoy para EPP, asistencia e ingresos/salidas). Nadie lo conectó a
   las órdenes.

### El tamaño real del respaldo que falta

Con el umbral de S/ 2.000 que Gabriel propuso, sobre todo lo cargado en soles:

| | Documentos > S/ 2.000 | Monto | % del total |
|---|---:|---:|---:|
| **Compras** | **200** de 1.205 | S/ 3.911.606 | **97%** del dinero |
| **Ventas** | **97** de 120 | S/ 2.451.936 | **99,9%** del dinero |

**297 documentos cubren prácticamente toda la dinero del grupo.** El umbral está
bien elegido: con el 17% de los comprobantes de compra se respalda el 97% del
monto. Y 297 es una cantidad que se puede emitir en lote.

### Propuesta

**B1 — Órdenes con dueño y con tipo.** Migración: `ordenes_compra` gana
`company_id`, `tipo` (`compra` | `servicio`), `trabajo_id` y numeración por
empresa usando el `codigo_doc_prefix` que ya existe. Las órdenes pasan a
aparecer **en la contabilidad de cada empresa** *y* **en el panel de cada
trabajo** — las dos entradas que Gabriel nombró.

**B2 — Emisión masiva sobre lo ya cargado.** Una pantalla que lista los
movimientos > S/ 2.000 **sin orden**, agrupados por empresa, y genera las
OC/OS retroactivas en lote: una por comprobante, con la empresa, fecha,
proveedor y monto ya puestos, **editables en la grilla** antes de emitir
(nombre del insumo y monto, que es lo que él pidió poder cambiar). Al emitir,
llena `orden_compra_id` y la factura queda atada a su orden para siempre.

**B3 — La plantilla por empresa.** Se reusa `plantillas-pdf.js` con
`logo_dataurl` + `nombre_corto`: cada empresa imprime con su cabecera. Se
agrega la variante de **orden de servicio** (descripción del servicio y monto,
sin unidades ni cantidades) además de la de compra.

**B4 — El umbral, configurable.** S/ 2.000 va a `app_config` (la tabla ya
existe), no hardcodeado. Y la pantalla de la obra muestra cuántos comprobantes
por encima del umbral siguen sin respaldo.

> Cuando Gabriel mande el modelo de orden de servicio que mencionó, se ajusta
> B3 a ese formato. B1 y B2 no dependen de eso y se pueden empezar antes.

---

## 3. El botón de volver

**Causa medida:** la app **no tiene historial de navegación**. `window.__navTo`
(`src/jx-app.jsx:915`) solo hace `setPage(...)`; cada «volver» está escrito a
mano en cada pantalla. Desde *Resumen por entidad*, `irAEmpresa()`
(`jx-contabilidad.jsx:6806`) deja una intención en `window.__empresaDetalleIntent`
y salta a `empresas` — y el volver del detalle va al catálogo, porque es el
único lugar que conoce.

**Propuesta (C1):** una pila de navegación mínima — `__navTo` apila, y el
Header muestra **«← Volver»** cuando hay de dónde volver. Es una librería pura
con tests y un botón. **Arregla el síntoma en todas las pantallas a la vez**,
no solo en este camino: es el arreglo más barato de los cuatro y el que más
veces se va a notar.

---

## 4. Intercompany fuera del bloque general

Hoy `intercompany` (*Operaciones entre Empresas*) está en el menú general de
Contabilidad **y** como uno de los 12 bloques del panel de cada empresa;
`ordenes-intercompany` también está en el menú general. `trazabilidad` ya se
mudó al desglose de la obra en la tanda 2G.

**Mover esto no cuesta nada** — está todo vacío:

| Tabla | Filas |
|---|---:|
| `intercompany_transactions` | 0 |
| `ordenes_intercompany` | 0 |
| `trazabilidad_cadenas` | 0 |

**Propuesta (D1):** `intercompany` y `ordenes-intercompany` se mudan al grupo
**«Movimientos y contabilidad de la obra»**, al lado de `trazabilidad`, que ya
está ahí. En el bloque general quedan **Consolidado del grupo** y **Resumen por
entidad**, que es lo que Gabriel quiere conservar. En el panel de la empresa se
mantiene una vista **de solo lectura** («operaciones de esta empresa con el
grupo»), porque es contabilidad suya; pero el lugar donde se **arma** una
jugada pasa a ser la obra.

---

## Orden recomendado

| # | Qué | Por qué en ese lugar | Tamaño | Estado |
|---|---|---|---|---|
| 1 | **C1** — pila de navegación | Barato, se nota en toda la app, no depende de nada | chico | ✅ `79bb20f` |
| 2 | **A1** — dos vistas con nombre (Libro del consorcio / Aporte del grupo) | Es la queja principal, no necesita esquema nuevo | mediano | 🔲 pendiente |
| — | **A3** — alerta de imputación cruzada | Se pudo adelantar: no dependía de A1 | chico | ✅ `79bb20f` (chip + botón «Reimputar» en Movimientos Contables) |
| 3 | **B1** — `company_id` + `tipo` en órdenes | Desbloquea todo lo demás de órdenes | mediano (migración) | 🔲 pendiente |
| 4 | **B2 + B3** — emisión masiva + plantilla por empresa | El valor real: 297 documentos respaldados | grande | 🔲 pendiente |
| 5 | **A2** — barra de la cadena | Se apoya en B2 para ser exacta | chico | 🔲 pendiente |
| 6 | **D1** — mudar intercompany | Cosmético hasta que se use; sin datos, sin riesgo | chico | ✅ `79bb20f` |

**Queda por hacer:** A1 + A2 (los dos libros de la contabilidad de obra) y
B1 + B2 + B3 (órdenes de compra y servicio) — las dos tandas grandes, cada
una en su propia sesión nueva (ver abajo).

---

## Modelo, effort y sesión recomendados

- **C1, A3, D1** — ✅ HECHO el 4-sep (`79bb20f`) con Sonnet 5, effort medio, en
  la misma sesión que escribió este documento.
- **A1 + A2** — Opus 5, effort alto, **sesión nueva**. Toca
  `jx-contabilidad.jsx`, que es el archivo más grande de la app (~7.000
  líneas), y hay que releerlo entero con la cabeza puesta en el libro del
  titular.
- **B1 + B2 + B3** — Opus 5, effort alto, **sesión nueva y dedicada**. Es
  migración + esquema Dexie + SyncEngine + dos pantallas + PDF. Es la tanda más
  grande de las cuatro; mezclarla con otra cosa es cómo se rompen las pantallas.
  Gabriel ya dejó el modelo en `Modelos/` (raíz del repo): `ordenes.xlsx`, el
  registro de activos y una foto de referencia — **leerlos antes de escribir
  código**, para no hacer B3 dos veces.

---

## Verificación (cuando se implemente)

- **A1:** en Miraflores, «Libro del consorcio» debe dar 121 comprobantes y
  «Aporte del grupo» 339. Si la suma da 460 en un solo total, está mal.
- **A3:** deben aparecer exactamente 17 comprobantes marcados.
- **B2:** tras la emisión masiva, `accounting_movements.orden_compra_id` lleno
  debe pasar de 0 a la cantidad de órdenes emitidas, y cada orden debe abrir su
  PDF con el logo de SU empresa.
- **C1:** entrar desde Resumen por entidad a una empresa y volver tiene que
  devolver a Resumen por entidad, no al catálogo.
- **Green gate** de siempre antes de cada promoción.

---

## A1 — cómo quedó (4-sep-2026, staging)

**`src/lib/libros-de-obra.js`** — librería pura, 15 tests. Parte los
comprobantes de una obra en sus dos libros:

- **Libro del titular** = los cargados en su libro (`company_id === titular`)
  **más** los que el grupo le emitió A ÉL (contraparte identificada por
  `related_company_id` o por RUC de 11 dígitos contra `companies`).
- **Aporte de las empresas del grupo** = todo lo demás.

**Verificado contra producción antes de escribir una línea de UI**, con SQL de
solo lectura:

| Obra | Total | Libro del titular | Aporte del grupo |
|---|---:|---:|---:|
| Plan Miraflores (CONSORCIO EL INCA) | 460 | **121** (112 propios + 9 recibidos) · S/ 287.190 | **339** · S/ 3.054.764 |
| Obras San Marcos (CONSORCIO CHUSAAC) | 89 | **64** · S/ 2.044.077 | **25** · S/ 179.477 |

Los 121 y los 339 salen **exactos** contra los números medidos el 4-sep.

**Por qué la regla NO exige `vinculoAfirmado`** (a diferencia de
`documento-dos-lados.js`): allá un reflejo *afirma algo sobre la contabilidad
de otra empresa* y por eso pide una afirmación explícita en el dato. Aquí solo
se decide **en qué columna de la misma obra** va una fila que ya está a la
vista. Un RUC que coincide con el del titular alcanza para decir "esto va
dirigido al consorcio".

**En la pantalla** (Movimientos Contables, dentro de un trabajo): tres
pestañas arriba de los filtros — *Libro de [titular]*, *Aporte de las empresas
del grupo*, *Los dos juntos* — cada una con su cuenta de comprobantes y sus
totales de compras/ventas separados por moneda. Abre en el libro del titular.
Debajo, la frase que faltaba: **los dos totales no se suman**, porque sumarlos
contaría dos veces cada compra que después se le traslada a la ejecutora (la
misma regla del Resumen por entidad). "Los dos juntos" **no muestra montos** a
propósito, por lo mismo.

Decisiones de borde:
- Las pestañas **se combinan** con el filtro de empresa: *GASOMI* dentro del
  libro del titular = lo que GASOMI le facturó a la ejecutora.
- Es **ámbito, no filtro**: no entra en "✕ Limpiar filtros" (mismo criterio que
  la obra dentro de la obra y que la empresa clavada).
- Con **empresa clavada** (entraste por el panel de una empresa) no aparecen:
  esa pantalla ya es el libro de esa empresa.
- Sin titular contable no hay dos libros: la pantalla se comporta como antes.
- Si el filtro deja la tabla vacía, el vacío ofrece **"Buscar en los dos
  libros →"**: la pestaña por defecto nunca puede parecer "no hay nada".

## A2 — por qué espera (y qué la destraba)

La barra pide comparar **lo que el grupo imputó a la obra** contra **lo que se
le facturó al consorcio**. Ese segundo número hoy es S/ 59.684 sobre millones
imputados — pero eso mide la carga histórica, no un proceso. Emitidas las
órdenes de compra y de servicio (tanda 5), la diferencia pasa a ser
*"respaldo emitido vs respaldo facturado"*, que es una pregunta accionable y
la que Gabriel realmente quiere responder. **Se retoma cuando haya un lote
real de órdenes emitidas.**
