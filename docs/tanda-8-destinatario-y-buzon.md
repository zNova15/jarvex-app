# Tanda 8 — El destinatario se busca, y la orden llega a un buzón

Feedback de Gabriel del 6-set-2026, probando las órdenes dentro de Miraflores.
Cuatro pedidos, tres cerrados en esta tanda y el cuarto entregado en su primera
versión utilizable.

---

## 1. «A quién se le compra» se BUSCA por RUC o razón social

> «me gustaría que aquí podamos agregar, si estamos colocando un nuevo
> proveedor o una empresa tercera, o incluso una nueva de nuestro grupo, el RUC.
> Y por el RUC podamos identificarlo […] buscar rápidamente el RUC, si es que me
> acuerdo, para emitir esta orden.»

### Qué estaba mal

La pantalla pedía **primero** decidir de qué clase era el destinatario —tres
botones: «escribirlo», «un proveedor ya cargado», «una empresa del grupo»— y
recién después buscarlo, cada clase en su propio `<select>`.

Eso invierte el orden real. Quien emite sabe el RUC o el nombre; **no sabe** (ni
tiene por qué saber) si ese RUC ya está cargado como proveedor, si es una de
nuestras ocho empresas, o si nunca se le dio de alta. La clase es una
**respuesta**, no una pregunta.

### Qué hace ahora

`src/lib/directorio-compra.js` arma una sola lista buscable con **tres fuentes**:

| fuente | de dónde sale | por qué importa |
|---|---|---|
| `grupo` | `companies` | al emitirle una orden entra en **su buzón** |
| `proveedor` | `proveedores` | el catálogo formal (378 filas en producción) |
| `tercero` | `third_party_ruc`/`_name` de comprobantes de **compra** | se le compró de verdad, con papel, pero nunca se lo dio de alta |

**La deduplicación es por RUC y gana el grupo.** Un mismo RUC puede estar en las
tres listas (una empresa nuestra cargada además como proveedor porque alguien la
tipeó al capturar una factura). Mostrarlo tres veces obliga a adivinar cuál
elegir, y elegir mal rompe el buzón: una orden a «GASOMI (proveedor)» no le llega
a GASOMI. Sin RUC de 11 dígitos no se deduplica: dos «sin RUC» no son el mismo.

Un **cliente** no entra: en una venta el tercero es a quien le vendimos, y a un
cliente no se le emite una orden de compra.

### Si el RUC no está

Se ofrece darlo de alta **con ese RUC ya puesto**, y un botón **«Traer de
SUNAT»** completa razón social y dirección usando `/api/sunat`, que ya existía.
Es a pedido y no al tipear: el plan de decolecta es de 100 consultas al mes, y
disparar una por tecla lo quema en una tarde. Si falla, se escribe a mano — una
orden no puede quedar bloqueada porque un servicio de terceros no contestó.

Si el RUC **sí** existe, no se ofrece dar de alta: se dice quién es. Un
duplicado hoy es una fusión a mano mañana.

### El bloque del grupo se esconde cuando no viene al caso

> «en caso de que sea un RUC nuevo, un proveedor nuevo o una empresa de terceros
> nueva, pues el bloque de qué tiene la empresa del grupo no tiene caso que esté
> allí.»

Correcto: enlazar una línea al stock de GASOMI en una orden dirigida a una
ferretería de terceros escribe un origen que la orden no puede respaldar. El
bloque sigue visible **mientras no se eligió destinatario** (ahí es justamente la
forma de descubrirlo), y cuando el destinatario ya es una empresa del grupo
muestra **solo lo de esa empresa**.

---

## 2. Recomendaciones al escribir el detalle

> «si yo coloco "cem.." no me sale recomendaciones de algún insumo que empiece
> por ese nombre. Implementa eso […] tanto para el de las empresas como de los
> trabajos.»

`src/lib/sugerir-descripcion.js`. Los dos bloques de ayuda que ya había
contestan otras preguntas y ninguna es ésta:

- **«qué necesita la obra»** solo existe dentro de una obra, y una empresa
  comprándole a un tercero no tiene presupuesto.
- **«qué tienen las empresas del grupo»** filtra por `disponible > 0`, o sea que
  esconde todo lo comprado y ya consumido. Para escribir una descripción eso es
  exactamente lo que no hay que esconder.

El corpus sale de tres lugares, en este orden de peso: **órdenes ya emitidas**
(`oc_items` — texto que alguien ya dio por bueno en un documento firmado),
**presupuesto** (trae el `insumo_codigo`, que después deja el mapeo aprendido) y
**facturas** (el corpus más grande y el más sucio).

Cada sugerencia trae unidad y **el último precio con su fecha** — no el
promedio: un promedio sobre dos años de cemento da un número que nadie puede
defender frente a un proveedor. Aceptarla llena nombre y unidad; **el precio
solo se rellena si estaba vacío**: si ya se escribió uno, es el que se negoció.

No se filtra por tipo de orden. La primera versión escondía los materiales en
una orden de servicio y se cayó sola al probarla: `tipo_insumo` está cargado en
algunas líneas de orden y casi en ninguna de factura, así que el filtro tapaba
unas cosas y otras no — y un filtro a medias es peor que ninguno, porque no hay
forma de saber por qué no aparece lo que se está escribiendo.

**Va como fila de la tabla, no como desplegable flotante**: el contenedor tiene
`overflow-x: auto`, y en CSS eso vuelve el `overflow-y` `auto` también — un
dropdown absoluto quedaría cortado.

---

## 3. Fuera el desplegable que no controlaba nada

> «si se ingresa desde CONSORCIO LINKA o desde el trabajo de la obra donde LINKA
> es el ejecutor, debería salirme solamente LINKA, pero hay un desplegable que me
> muestra todas […] y creo que ni siquiera tiene una función directa. Si no
> funciona, deberías quitar eso.»

Tenía razón por partida doble:

- Dentro de una **empresa** el `<select>` estaba `disabled` con una sola opción:
  un control que no controla nada.
- Dentro de una **obra** sí cambiaba la lista, pero ofrecía filtrar por empresas
  que no tienen nada que ver con ese trabajo — y cortar ahí escondía justamente
  la cadena intercompany, que en Miraflores son 3 de cada 4 comprobantes.

Ahora, cuando el ámbito ya decidió la empresa, se muestra un chip con candado.
El buscador de al lado sigue filtrando por proveedor, código o rubro.

Guardado con `!emisoraFija && !enObra`: una obra sin titular contable
identificable deja `emisoraFija` en null, y ahí el `<select>` volvería — y peor,
`setEmpresaActivaId` dejaría el contexto de esa empresa pegado al salir del
trabajo (el bug que arregló la tanda 6). `ordenes-pantalla.test.jsx` lo protege
sobre el HTML, porque volvería sin que la pantalla deje de abrir.

---

## 4. El buzón de órdenes recibidas

> «tenemos que tener una sección donde diga ORDEN RECIBIDA, y podamos ver las
> órdenes recibidas para cada una de nuestras empresas, como si fuera su propio
> buzón […] cruzar con nuestro inventario, corroborar que tenemos los insumos,
> tal vez no con el mismo nombre, pero podemos enlazarlos […] y facilitarles la
> opción de generar la factura.»

### El hueco: la orden no sabía a quién se la emitió

El destinatario se guardaba como **snapshot de texto** (`proveedor_nombre`,
`proveedor_ruc`). Para un tercero eso está bien: es lo que dice el papel el día
que se firmó y tiene que quedar congelado. Pero para una empresa nuestra no
alcanza — un buzón armado comparando «GASOMI» contra «GASOMI E.I.R.L.» deja
órdenes sin entregar, y una empresa no tiene forma de enterarse de que existen.

**Mig 186** agrega `proveedor_company_id` (el vínculo duro, indexado) y el
carril de la receptora, separado de `estado` porque `estado` es del emisor y las
dos partes lo escribirían pisándose:

```
respuesta_estado: pendiente | en_revision | aceptada | facturada | rechazada
```

`NULL` = «nadie del otro lado la tocó», que no es lo mismo que `'pendiente'`
escrito a mano. Por eso no hay DEFAULT.

### Qué hace el buzón

- Una orden **anulada** por quien la emitió desaparece del buzón aunque nadie la
  haya tocado; si ya estaba facturada se queda, porque ahí hay una factura que
  alguien tiene que mirar.
- Abrirla la pasa sola a «en revisión», para que dos contadoras no trabajen la
  misma.
- El **inventario** de la receptora sale de sus facturas (comprado − vendido):
  no hay tabla de stock por empresa, el almacén es de obra.
- El cruce **propone, no decide**. Lo que no encuentra devuelve `null`, **no
  cero**: un 0 se lee como «no tienes», y la diferencia entre «no tienes» y «no
  sé» es la que hace que alguien rechace un pedido que sí podía atender.
- Con **unidades distintas** no se afirma que alcanza. No sabemos.

### La factura

Se emite el **par intercompany** con el mismo molde que
`lib/facturas-internas.js`: ingreso en quien vende, costo en quien pidió,
`is_intercompany` + `related_movement_id` cruzados, para que el consolidado
elimine la operación interna en vez de contarla dos veces. Las líneas van en
`notas.items_factura`, que es de donde las leen el inventario, el abastecimiento
y el mapeo — escribirlas en otro lado sería una factura invisible para el resto
de la app.

La compra nace con `orden_compra_id` lleno: es el vínculo que la pestaña «Sin
respaldo» busca, y acá viene de fábrica.

**Ningún aviso bloquea.** Los tres casos que detectan son legítimos y pasan todo
el tiempo (se compra para atender el pedido, se factura de más porque pidieron
más, se vende al costo dentro del grupo). Lo que no puede pasar es que ocurran
sin que nadie los vea. El aviso *alto* es vender por debajo del último costo de
compra.

Renombrar una línea al facturar **enseña el mapeo**, igual que armar la orden:
nadie se sienta a mapear 1.875 descripciones.

### Lo que queda fuera

El número de serie-correlativo de SUNAT: la factura nace como **borrador** y el
número real se pone después, en Contabilidad. Emitir un correlativo fiscal desde
acá sería tomar una decisión que la contadora todavía no tomó.

---

## Archivos

| archivo | qué |
|---|---|
| `supabase/migrations/186_ordenes_destinatario_y_buzon.sql` | `proveedor_company_id` + carril de la receptora |
| `src/db/jarvex.db.js` (v56) | índice del buzón |
| `src/lib/directorio-compra.js` | las tres fuentes, buscables por RUC o nombre |
| `src/lib/sugerir-descripcion.js` | el corpus del autocompletado |
| `src/lib/ordenes-recibidas.js` | buzón, cruce con inventario, borrador de factura, avisos |
| `src/components/jx-ordenes.jsx` | las cuatro pantallas |
| `src/lib/__tests__/directorio-compra.test.js` | 23 casos |
| `src/lib/__tests__/sugerir-descripcion.test.js` | 15 casos |
| `src/lib/__tests__/ordenes-recibidas.test.js` | 30 casos |
| `src/lib/__tests__/ordenes-pantalla.test.jsx` | el desplegable que no vuelve |
