# JARVEX — Tanda 3 de 3: consolidado real (requiere la tanda 1 aplicada primero)

## Dependencia
Esta tanda necesita que la entidad `consorcio` ya exista como libro contable independiente (RUC propio, EE.FF. propios) — ver tanda 1. No empezar esta tanda antes de que la 1 esté migrada y verificada.

## Contexto base
El bloque "Contabilidad y Tesorería" ya lista pantallas de "Intercompany" y "Consolidado". Verificar primero si hoy hacen eliminaciones reales o si solo suman resultados de cada empresa.

## Qué debe hacer el consolidado
- El resumen macro del grupo debe ser un consolidado contable real, con eliminaciones intercompañía — no un tablero de indicadores lado a lado.
- El perímetro de eliminación no es solo empresa-contra-empresa: también hay que eliminar las transacciones entre una empresa del grupo y un consorcio en el que participa (ej.: una empresa intermediaria que le vende material al consorcio ejecutor). Si el consolidado actual solo contempla empresa-contra-empresa, hay que ampliarlo para incluir consorcio como contraparte eliminable.
- Caso de referencia real para probar: cadena de venta A → B → consorcio ejecutor, donde A y B son empresas del grupo — el consolidado no debe contar el mismo material tres veces.

## Verificación antes de dar por cerrado
Correr el consolidado sobre un caso con al menos una cadena de venta intercompañía (empresa → empresa → consorcio) y confirmar que el resultado consolidado no duplica ingreso ni costo.

---

## HECHO — 3-sep-2026

**Dónde vive:** `src/lib/consolidado.js` (puro, 34 tests en
`src/lib/__tests__/consolidado.test.js`), la pantalla `ConsolidadoPage` en
`jx-contabilidad.jsx` reescrita como hoja de trabajo, y la tarjeta del grupo
arriba de la pantalla Contabilidad.

### Lo que estaba mal (medido, no supuesto)

La pantalla sumaba por separado los `income` marcados `is_intercompany` y los
`cost` marcados, y restaba cada bolsa de su lado. Eso no es una eliminación:
una eliminación es un **par**. En producción las dos bolsas no coincidían
(S/ 2.402.475,52 de ingreso interno contra S/ 2.301.917,84 de costo interno).

El error concreto: **12 facturas de SALAZAR CERQUIN RUTH a CHUSAAC / ESPERANZA
/ SAMADAY (S/ 72.408)** tenían su espejo cargado, pero al espejo le faltaba el
flag. Se eliminaba el ingreso del vendedor y el costo del comprador se contaba
como **costo externo del grupo**. La utilidad consolidada salía S/ 72.408 por
debajo de la real, sin ninguna señal en pantalla.

Además, la pantalla sumaba los libros de **terceros** cargados en la app
(municipalidades, SITRAMUNBI): 12 movimientos por S/ 41.891,40 de gasto que no
son del grupo.

### Cómo quedó

1. **Perímetro explícito.** Entran propias y consorcios del catálogo, los
   titulares contables de consorcios, sus socias, y —para no cambiar el número
   de un día para el otro— las que ya tienen operaciones marcadas como
   internas. Estas últimas salen listadas como «falta clasificarla»:
   CONSORCIO ESPERANZA y CONSORCIO SAMADAY siguen en `tipo_entidad='tercero'`.
2. **Se elimina de a pares**, con dos pasadas: `related_movement_id`, y si no
   hay, mismo número de documento + mismo importe + contraparte coherente. Esa
   segunda pasada recupera las 12 facturas de RUTH sin tocar un solo dato.
3. **La contraparte se resuelve, no se asume**: vale `related_company_id` y si
   no está, el RUC contra el catálogo. Por eso una venta a un consorcio del
   grupo se elimina **aunque nadie haya marcado la casilla** — que era el
   agujero que pedía esta tanda.
4. Lo que no encuentra espejo **no se esconde**: sale con entidad, documento e
   importe. El total del grupo está bien igual (lo que no existe no hay que
   eliminarlo); lo que falta es la carga del otro lado.

### Verificación que pedía este documento

**En test** (`consolidado.test.js`, primer bloque): la cadena
proveedor externo → A (S/100) → B (S/120) → consorcio (S/150) → cliente (S/200).
Suma de libros: S/470 de ingreso y S/370 de costo — el material contado tres
veces. Consolidado: **S/200 de ingreso y S/100 de costo, utilidad S/100**. Una
sola vez.

**En producción** (SQL replicando el motor, 3-sep-2026, PEN, sin anulados):

| | Antes | Ahora |
|---|---|---|
| Ingresos | 51.200,00 | **26.200,00** |
| Costos | 1.350.686,59 | **1.278.278,59** |
| Gastos | 398.344,39 | **356.452,99** |
| Utilidad | −1.697.830,98 | **−1.608.531,58** |

Los S/ 89.299,40 de diferencia están explicados uno por uno: +72.408,00 (los
espejos de RUTH, que dejan de ser costo externo), +41.891,40 (libros de
terceros que salen del perímetro), −25.000,00 (una venta de JADE a PERSEIDAS,
socia de EL INCA, que pasa a ser interna). 107 pares eliminados —95 por
vínculo, 12 por documento— por S/ 2.374.325,84 **iguales de los dos lados**.

Cadena real detectada en los datos: **GASOMI → JHEENSEG → CONSORCIO CHUSAAC**.

### Lo que este número NO dice

El grupo tiene S/ 1,28 M de costo externo cargado contra S/ 26.200 de ingreso
externo: **las valorizaciones al cliente final casi no están cargadas**. La
utilidad consolidada muestra el gasto sin su contrapartida, y la pantalla lo
avisa con todas las letras para que nadie lea «el grupo perdió 1,6 millones».

### Pendiente que deja abierto

- Marcar CONSORCIO ESPERANZA y CONSORCIO SAMADAY como `consorcio` en Empresas
  → Revisar clasificación (hoy entran al perímetro por evidencia).
- Cargar el espejo de las 4 operaciones internas que no lo tienen (2 facturas
  de JARVEX a EL INCA y 2 notas de crédito).
