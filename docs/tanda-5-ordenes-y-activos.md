# Tanda 5 — Las órdenes que faltaban, y los activos fijos

> Ejecutada el 4-sep-2026 sobre el material que dejó Gabriel en `Modelos/`:
> `ordenes.xlsx` (dos hojas de orden reales del CONSORCIO EL INCA), una foto
> de una OC del CONSORCIO SUR PERÚ y `6.1.- REGISTRO ACTIVOS_VALIDO.xls`
> (el Formato 7.1 que llevan las contadoras).
>
> Cierra **B1 + B2 + B3 + B4** de `docs/tanda-4-ordenes-y-libro-de-obra.md`
> y abre el módulo de **activos fijos**, que era nuevo.
>
> **Migraciones 179 y 180 YA APLICADAS** en producción por el MCP de Supabase.
> El código está en `staging`.

---

## ⚠️ Lo primero, porque es de seguridad

`Modelos/` **se fue al `.gitignore`**. El repo es **público** y ese Excel
trae, en texto plano:

- N° de cuenta BCP y **CCI** del CONSORCIO EL INCA,
- el **DNI** del representante legal común,
- los RUC y domicilios de las ocho empresas del grupo.

Para pasar esa carpeta a la otra PC: Drive o WhatsApp, **no git**. Si en algún
momento ya se hubiera pusheado, avisame y lo purgamos del historial — hoy
nunca entró (`git check-ignore` lo confirma).

---

## Parte A — Órdenes de compra y de servicio

### Lo que estaba roto (medido, no supuesto)

| | |
|---|---:|
| `ordenes_compra` | **0** filas |
| `oc_items` | **0** |
| `accounting_movements.orden_compra_id` con valor | **0** de 1.378 |

El circuito existe desde la mig 022 y **nunca se usó ni una vez**. La tanda 4
ya había diagnosticado por qué no lo encontraba (vive solo dentro de una obra,
en Logística). La causa más profunda es que **la tabla no servía para lo que
él necesita**:

1. **No tenía dueño.** Solo `obra_id`. Ocho empresas propias y ninguna forma
   de decir cuál emite → ni plantilla, ni logo, ni serie de correlativo.
2. **No existía el tipo.** La orden de servicio no era un concepto.
3. **El documento no entraba.** El contrato/CUI de la obra, el rubro
   («MATERIAL FERRETERIA»), los datos de pago y despacho (banco, cuenta, CCI,
   lugar y fecha de entrega) y las notas al proveedor no tenían dónde
   guardarse. **Por eso se emitían a mano en Excel.**
4. **`obra_id` era NOT NULL.** Un trabajo de bienes/servicios (mig 174) no es
   una obra: sus órdenes no tenían dónde vivir.

### B1 — Migración 179: dueño, tipo y documento

`ordenes_compra` gana `company_id`, `tipo` (`compra` | `servicio`),
`trabajo_id`, el bloque completo del documento del modelo, `correlativo`+`anio`
y el espejo `accounting_movement_id`. `obra_id` pasa a nullable.

Dos índices únicos parciales que evitan los dos errores caros:

```sql
uq_oc_por_movimiento   -- una factura, UNA orden viva (dos tabs / dos devices)
uq_oc_correlativo      -- (empresa, tipo, año, correlativo) — nunca dos N° iguales
```

### B2 — La emisión masiva del respaldo

Con el umbral de S/ 2.000 que propuso Gabriel, sobre lo cargado en soles:

| | Documentos > S/ 2.000 | Monto | % del dinero |
|---|---:|---:|---:|
| **Compras** | **200** de 1.205 | S/ 3.911.606 | **97%** |
| Ventas | 97 de 120 | S/ 2.451.936 | 99,9% |

Con el **17% de los papeles de compra** se respalda el **97% del dinero**. El
umbral está bien elegido — y por eso ahora vive en `app_config`
(`orden_umbral_monto`) y se edita en **Administración**, no en el código (B4).

La pestaña **«Sin respaldo»** lista esos comprobantes, agrupados por empresa
emisora y ordenados por monto, con la grilla **editable antes de emitir**:
nombre de lo comprado, tipo (compra/servicio), IGV (18% o sin IGV para un
recibo por honorarios) y monto. Al emitir en lote, cada orden queda atada a su
comprobante por los dos lados y `orden_compra_id` pasa de 0 a la cantidad
emitida.

Tres decisiones que están en el código y conviene tener presentes:

- **La orden retroactiva NO infla la factura.** El total del comprobante manda
  y el valor de venta se despeja hacia atrás (`totalesDesdeTotal`). Si se
  recalculara desde los ítems, una orden diría S/ 24.985 donde la factura dice
  S/ 21.174.
- **Una orden anulada NO libera su número.** Reusar el 003 daría dos documentos
  distintos con el mismo N°. Anular sí devuelve el comprobante a «sin respaldo»,
  que es la verdad.
- **El correlativo del lote se calcula sobre un acumulador local.** Releer Dexie
  en cada vuelta de un lote de 200 daría el mismo número dos veces.

### B3 — La plantilla por empresa

`generateOrdenPdf()` reproduce el formato del modelo: cabecera con el nombre y
el logo de **la empresa que emite** (`companies.logo_dataurl` y `nombre_corto`
existían y estaban sin usar), banda de rubro, bloques de obra/contratante,
orden, proveedor, el detalle, los tres totales, pago y despacho, notas y las
**tres firmas** (elaborado por / rep. legal / proveedor).

Compra y servicio son **el mismo cuerpo con distinto rótulo** —
«Descripción» vs «Descripción del servicio», «IMPORTE TOTAL DE LA COMPRA» vs
«…DEL SERVICIO». Eso lo decide `textosDeTipo()` en `lib/ordenes.js`, testeado.

De paso: el PDF de la pantalla de logística **dejó de salir con «la primera
empresa activa del grupo»** y sale con la que realmente emite.

### Dónde está ahora

- **Contabilidad → «Órdenes de Compra y Servicio»** (plano general) — el
  registro documental del grupo, o de una empresa si hay empresa activa.
- **Panel de la empresa → Contabilidad → «Órdenes de compra y servicio»**.
- **Obra → Logística → «Órdenes de Compra»** — el circuito de siempre
  (solicitud → OC → recepción), que ahora estampa dueño y tipo.

---

## Parte B — Activos fijos (lo nuevo)

### Qué pidieron y qué encontré

Las contadoras llevan el **«FORMATO 7.1: REGISTRO DE ACTIVOS FIJOS»** en un
Excel suelto, ejercicio por ejercicio, a mano.

**`activos_pesados` no servía**, y no por poco: son **dos registros distintos
con el mismo nombre coloquial**.

| | `activos_pesados` (ya existía) | `activos_fijos` (nueva) |
|---|---|---|
| Para qué | Operativo | Contable |
| De quién | De la **obra** | De la **empresa** |
| Qué guarda | Horómetro, combustible, mantenimiento, operador | Cuenta PCGE, tasa, depreciación, valor en libros |
| Filas hoy | 2, **sin costo ni fecha de adquisición** | — |

Sus dos filas (un generador y un martillo demoledor) no tienen costo ni fecha:
nadie las cargó para contabilidad, y está bien, porque no es para eso.

**Y no se puede derivar de lo cargado:** hay **0 movimientos contables** con
cuenta 33x (el único `cuenta_pcge` usado en toda la base es un `65`). El
registro nace del Excel que ya llevan, no de las facturas. Por eso la pantalla
tiene la carga a mano como camino principal.

El puente entre los dos registros es `activo_pesado_id` — una excavadora puede
estar en ambos y no hay que tipearla dos veces. Pero la excavadora **alquilada**
está solo en el operativo, y la **laptop de oficina** solo en el contable.
Fusionarlos habría roto los dos.

### La fórmula, verificada contra SU Excel

```
depreciación del ejercicio = valor histórico × tasa × meses de uso / 12
```

| Bien | Cuenta | Cálculo | La app | Su Excel |
|---|---|---|---:|---:|
| REMOLCADOR KENWORTH T800 | 33411 | 70.002,85 × 20% × 3/12 | 3.500,14 | 3.500 |
| SCANIA R500 | 33412 | 44.875,00 × 20% × 6/12 | **4.487,50** | **4.488** |
| LAPTOP HP | 33611 | 2.542,37 × 25% × 2/12 | 105,93 | 106 |
| EQUIPO GPS | 33691 | 423,73 × 25% × 6/12 | 52,97 | 53 |
| | | **TOTAL valor en libros** | 57.103,95 | 57.103,95 |

Las cuatro dan. **La única diferencia es el redondeo** —su planilla trabaja en
soles enteros, la app en céntimos— y es a favor: redondear arrastra medio sol
por bien y por año.

### Lo que la app hace y el Excel no

1. **No guarda los derivados.** Valor histórico, depreciación del ejercicio,
   acumulada y valor en libros se calculan al leer. En la planilla son
   fórmulas que se arrastran, y basta una mal copiada para que el total no
   cuadre. Misma regla que el stock (sale de los movimientos) y el margen de
   un trabajo.
2. **Topea la depreciación.** Un bien ya agotado deja de generar gasto: el
   valor en libros **nunca queda negativo**. En una planilla, seguir la
   fórmula un año de más no lo avisa nadie hasta el balance.
3. **Avisa por la tasa.** Si el % supera el máximo del rubro (20% vehículos,
   25% equipos de cómputo, 5% edificaciones…), lo dice: **el exceso no es
   deducible**. Depreciar más lento sí está permitido y no molesta.
4. **El cierre de ejercicio es un botón.** Arrastra valor histórico y
   acumulada al año siguiente, pone los movimientos en cero y **no arrastra
   lo retirado ni lo vendido**. Es el paso donde la planilla propaga errores.
5. **Exporta el Formato 7.1** en Excel, con las 28 columnas oficiales,
   agrupado por cuenta y con subtotales.

### Lo que NO hace, y hay que decirlo

**No genera el TXT del PLE 7.1 (código 070100).** El Excel en el formato
oficial sí — que es con lo que trabajan hoy. El TXT pide la especificación de
campos vigente de SUNAT; emitir un archivo con los campos en otro orden es peor
que no emitirlo, porque SUNAT lo rechaza sin decir dónde. Si Gabriel consigue
la estructura oficial (o un TXT válido de ejemplo), se agrega junto a los
otros cuatro libros de `sunat-ple.js` en una tanda chica.

### Dónde está

**Contabilidad → «Activos Fijos (formato 7.1)»**, y como bloque dentro del
panel de cada empresa. Lo ven admin, gerente, contador, ayudante_contador y
tesorero; los roles de campo y de especialidad quedan afuera por RLS
(`modulo_cerco_select`, espejo de la mig 178).

---

## Verificación

- **Green gate:** 1.117 tests verdes (43 nuevos de `ordenes.js`, 43 de
  `activos-fijos.js`), build limpio, sin chunk inesperado.
- **Migraciones 179 y 180 aplicadas**; advisors de seguridad sin novedades
  nuevas (siguen los `SECURITY DEFINER` preexistentes y el toggle de *Leaked
  Password Protection*, que Gabriel tiene pendiente en el dashboard).
- **A probar en producción:**
  1. Contabilidad → Órdenes → «Sin respaldo»: tiene que listar los
     comprobantes > S/ 2.000 agrupados por empresa. Emitir un par y verificar
     que el PDF sale con el logo y el RUC de SU empresa y el N° de SU serie.
  2. Anular una: el comprobante vuelve a la lista de pendientes.
  3. Activos Fijos: cargar los cuatro bienes del Excel y comparar el total de
     valor en libros contra los S/ 57.103,95 de la planilla.
  4. Exportar el Formato 7.1 y abrirlo al lado del suyo.

---

## Modelo, effort y sesión recomendados para lo que sigue

- **Lo de esta tanda ya está hecho** con Opus 5, effort alto, sesión dedicada
  (como recomendaba la tanda 4).
- **A1 + A2 — los dos libros de la contabilidad de obra** (Libro del consorcio
  / Aporte del grupo, y la barra de la cadena): **sigue pendiente**. Opus 5,
  effort alto, **sesión nueva**. Toca `jx-contabilidad.jsx` (~7.000 líneas) y
  hay que releerlo entero. A2 ahora se apoya en las órdenes emitidas, así que
  conviene hacerla **después** de que Gabriel emita el primer lote real.
- **El PLE 7.1 en TXT:** Sonnet 5, effort medio, tanda chica — **pero recién
  cuando esté la especificación oficial de campos**. Sin eso no se empieza.
- **El 🔴 abierto de la tanda 3** («movimientos a veces no me deja ingresar»)
  no se tocó acá. Sonnet 5, effort alto, sesión propia: es un bug de
  reproducción intermitente y necesita el detalle de Gabriel sobre cuándo pasa.
