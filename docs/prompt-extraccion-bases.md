# El prompt de extracción de bases

> Tanda 15, entrega 3. Éste es **el documento que se revisa cuando una
> extracción sale mal**: los prompts viven en `api/bases-analizar.js`, pero el
> porqué de cada regla está acá.

El contexto original de Gabriel (8-set-2026) mencionaba un
`prompt-extraccion-bases-jarvex.md` que nunca existió en el repo. Este archivo
lo reemplaza y documenta lo que efectivamente se construyó.

---

## Por qué no es un prompt, son cinco pasos

| Paso | Quién lo hace | Cuesta |
|---|---|---|
| 0 · Triage | `bases-triage.js` — código | **USD 0** |
| 0.5 · Índice | `bases-extraccion.js` — `grep` | **USD 0** |
| 1 · Localizar | IA, ~4k tokens | ~USD 0 |
| 2 · Extraer | IA, ~10k tokens por rango | ~USD 0 |
| 3 · Verificar | `verificarCita()` — código | **USD 0** |

Lo caro es el OCR (USD 0,002 por página escaneada). Todo lo demás está armado
para que la IA lea lo menos posible: **el índice del paso 0.5 baja el Pase 1 de
90.000 tokens a 4.000**, y sin él ningún gratuito con ZDR tiene ventana
suficiente para el documento entero.

## Las dos pasadas no son redundancia

Son un embudo, no una repetición:

- El **Pase 1** no busca en el documento: **elige** entre candidatos que ya
  encontró el código. Devuelve rangos de páginas, nunca datos.
- El **Pase 2** lee solo esos rangos. Pasa de 96 páginas a 8.

Repetir la extracción y comparar las dos salidas costaría el doble y seguiría
sin responder la pregunta que importa —*¿este dato está en las bases?*—, porque
**dos alucinaciones coherentes se confirman entre sí**. Por eso el tercer paso
no es IA.

## La regla que manda: la cita se comprueba

Cada dato vuelve con `fuente_cita` (una frase copiada literal) y `fuente_pagina`.
`verificarCita()` busca esa frase en el markdown del documento, normalizando
tildes, mayúsculas y espacios —porque así devuelve el OCR—, y:

- si no aparece → el dato se marca **sin verificar** y sale con ⚠️;
- si aparece en otra página → se corrige la página y se avisa;
- **nunca se borra en silencio.** Perder un requisito real es tan caro como
  inventar uno, y solo una persona puede decidir cuál de las dos cosas pasó.

En la pantalla, lo no verificado **arranca destildado**: se ve, pero no se
guarda sin que alguien lo mire.

## Los cinco criterios que se confunden entre sí

Es la lección de la entrega 2, ahora dentro del prompt. Este requisito real del
Anexo 13 de Chilete tiene **cinco números distintos**:

> Experiencia no menor de **03 años**, sustentada con copia de diploma de
> incorporación al Colegio respectivo. Sustentar como mínimo **02
> participaciones** como Residente de obra y/o Supervisor de obra […] por un
> plazo **no menor a 02 meses cada participación**, en los **últimos 10 años**.

| Campo | Qué es | Acá |
|---|---|---|
| `meses_generales_minimos` | experiencia general, desde la colegiatura | 36 |
| `meses_minimos` | experiencia específica en el cargo | 0 |
| `participaciones_minimas` | cuántas obras distintas | 2 |
| `meses_por_participacion` | duración mínima de cada una | 2 |
| `ventana_anios` | en cuántos años hacia atrás | 10 |

Guardar solo el primero es lo que hacía que **alguien con cinco años en UNA
sola obra pasara el filtro**. El prompt los nombra uno por uno con su ejemplo,
y el test `bases-extraccion.test.js` los verifica sobre el requisito literal.

## Lo que el prompt tiene prohibido

- **Inventar un número que no está**: el campo va en `0` o `null`, nunca en un
  valor «típico».
- **Confundir requisito con factor de evaluación**: el primero descalifica, el
  segundo da puntaje. Van a listas distintas.
- **Proponer `rubro_id`**: es una fila del catálogo interno del grupo y el
  modelo no puede conocerla. La definición de obra similar que escribió la
  entidad va como texto en `licitaciones.definicion_obras_similares`.
- **Proponer `tipo_trabajo` o con qué empresa postulamos**: no se deduce de las
  bases y errarlo desarma la postulación entera — mismo criterio que
  `ejecutora_tipo` en la entrega 1.

## Qué modelo

El de `docs/ia-postproceso-openrouter.md`: titular gratuito con **ZDR**, cadena
de respaldos, y la política de datos explícita en cada request. Las bases son
públicas, pero el prompt viaja con nombres de profesionales del grupo.

El OCR va por `lib/mistral-ocr.js` con **snapshot fijo**, nunca un alias móvil:
`mistral-ocr-latest` se movió solo el 16-jul-2026 y duplicó el precio.

## Cuando una extracción sale mal

1. ¿El triage mandó a OCR las páginas correctas? → `presupuestar()` lo dice
   antes de gastar.
2. ¿El OCR leyó? → si una página vuelve vacía, sale en las alertas.
3. ¿El índice encontró la sección? → `indiceDeSecciones()`; si una familia da
   0 aciertos, hay que agregar el rótulo a `SECCIONES` en
   `bases-extraccion.js`. **Ese es el ajuste más común y no requiere tocar el
   prompt.**
4. ¿El Pase 1 eligió un rango absurdo? → se recorta a 12 páginas solo.
5. ¿El Pase 2 alucinó? → la verificación de cita lo agarra y lo marca.
