# Tanda 15 — Licitaciones

> Contexto original de Gabriel (8-set-2026) + el análisis medido contra el
> repo y el orden de entregas que salió de ahí.

---

## 0. Lo que ya estaba construido (y el documento no sabía)

El bloque **Licitaciones** existe desde la tanda 2 y su propia descripción
prometía *«el plantel profesional y los trabajos a los que nos presentamos»*.
La primera mitad estaba hecha; la segunda no existía.

Ya en producción antes de esta tanda:

- `src/components/jx-profesionales.jsx` — ficha del profesional y pestaña
  **Buscar plantel**, que es el verificador de requisitos mínimos.
- `src/lib/experiencia-profesional.js` — `buscarPlantel()` /
  `evaluarRequisito()`, con las dos reglas duras: los periodos solapados no se
  suman dos veces y la experiencia sustentada se cuenta aparte.
- Migración 171 — ficha 1:1 contra `personal`, experiencia como periodos,
  rubros como catálogo.
- Rol `licitaciones` con allowlist, visibilidad de evidencias propia, área de
  navegación y bloque de primer nivel.

**Por eso la prioridad #1 del documento no era construir el verificador: era
darle un expediente.** Los requisitos se tipeaban de cero cada vez y se perdían
al cerrar la pestaña. Servía para una consulta suelta, no para trabajar.

## 1. Correcciones al documento de contexto

| Punto | Qué decía | Qué se midió |
|---|---|---|
| Vínculo con costos | «usa el mismo motor de estimación que ya existe para expediente técnico/reajuste» | **Ese motor no existe.** Hay `pdfBudgetParser.js` + `jx-importar.jsx` (importan presupuestos S10/Delphin de una obra ya ganada), valorizaciones y análisis de insumos — todo mirando hacia atrás. No es conectar, es construir. Fuera del alcance inicial. |
| Triage de OCR por página | correcto, pero no dice dónde corre | Tiene que correr **en el cliente**. `captura-magica.js` manda el PDF entero en base64 a una serverless: unas bases de 150–300 páginas no pasan por ahí. `pdfjs-dist` ya es dependencia y `pdfBudgetParser.js` ya extrae texto página por página. |
| Elección de modelo | primer punto a resolver | No bloquea nada. Cuando llegue, entra por `docs/ia-postproceso-openrouter.md` (ZDR) y **con snapshot fijo, nunca alias móvil** — `mistral-ocr-latest` se movió solo y duplicó el precio (por eso existe `lib/mistral-ocr.js`). |
| — | no figuraba | **El banco de profesionales está vacío.** El verificador contra un padrón vacío no sirve: todos los puestos salen en ⛔. La extracción de CVs sube al segundo lugar. |

## 2. Orden de entregas

| # | Entrega | Estado |
|---|---|---|
| 1 | **La postulación existe como dato** — tablas, pantalla, requisitos guardados por proceso, veredicto y paso a Trabajos | ✅ hecha |
| 2 | **El requisito como lo piden las bases** + **motor de triage** (mig 198) | ✅ hecha |
| 3 | **Herramienta de análisis de documentos** — pasadas de extracción sobre el markdown híbrido | siguiente |
| 4 | **CV → ficha con IA** — llenar el padrón, que hoy está vacío | pendiente |
| 5 | **Requisitos de empresa** — obras similares, facturación, CDC/RNP | pendiente |
| 6 | Calendario del proceso + kanban con documentos por etapa | pendiente |
| 7 | Oferta económica | módulo propio, no un vínculo |

> La herramienta de análisis es **separada de Captura Mágica**, por decisión de
> Gabriel (8-set-2026) y porque son problemas distintos: Captura Mágica lee un
> comprobante por vez; ésta lee 300 páginas y hace dos o tres pasadas.
> Comparten el motor de OCR y nada más.

---

## Entrega 1 — La postulación existe como dato

### Migración 197

Dos tablas. **`licitaciones`** (el proceso) y **`licitacion_requisitos`** (lo
que piden sus bases).

**Por qué tabla aparte y no una `obras` con `estado='postulando'`** — el mismo
criterio que la mig 174 usó para bienes y servicios:

- Una postulación no tiene partidas, cronograma de ejecución, almacén, personal
  asignado, valorizaciones ni un solo asiento contable.
- La mayoría **nunca** va a ser obra: se pierden. Meterlas en `obras` ensucia
  todos los selectores de obra y todos los filtros de contabilidad con procesos
  que no existieron.
- `obras` es titular de imputación de media app. Una fila que no puede recibir
  ningún movimiento no debe vivir ahí.

El enganche es `licitaciones.obra_id`, **nullable**, y se llena solo al ganar y
apretar el botón.

**Por qué `licitacion_requisitos` tiene la forma que tiene** — es, campo por
campo, el objeto que come `evaluarRequisito()`. No hay capa de traducción que
se pueda desincronizar: la fila que se guarda ES el requisito que se evalúa.

Campos que nacen vacíos a propósito: `fuente`, `fuente_pagina` y `fuente_cita`
los llena el escáner de bases (entrega 4), que tiene la regla de citar la
página de origen. `clase` acepta `'empresa'` desde ahora aunque solo se use
`'personal'`: los requisitos de empresa son la entrega 3 y no vale mover un
CHECK por eso.

**Etapas** — el kanban del documento más `desistido`. Ese estado no es un
adorno: *«no calificamos, no gastamos una semana en esto»* es la decisión que
todo el módulo existe para poder tomar, y hoy no queda registrada en ningún lado.

**RLS** — admin, gerencia y el rol `licitaciones`. RR.HH. queda afuera: ve la
ficha profesional (es dato de personal) pero a qué procesos se postula el grupo
es información comercial. El gate del sidebar (`__canSeeSidebarItem`) es espejo
exacto de esa lista, como ya se hace con `pagos` y `activos-fijos`.

### `src/lib/licitaciones.js`

No vuelve a evaluar a nadie — toda la evaluación sigue en
`experiencia-profesional.js`. Acá pasan dos cosas:

1. La traducción fila → requisito (mapeo tonto a propósito).
2. **El veredicto**: convertir la lista larga de `buscarPlantel()` en la única
   frase que hace falta antes de invertir una semana.

**La regla que define el veredicto:** un puesto con un candidato **ya elegido**
que no cumple es *peor* que un puesto todavía sin elegir. El segundo es trabajo
pendiente; el primero es el nombre que ya está escrito en el expediente y es
una observación segura en la evaluación. Por eso hay `califica` **y** `limpio`.

**Sin requisitos cargados no se califica.** `califica` es `false` con la lista
vacía: no saber no es lo mismo que estar bien, y ese matiz es la diferencia
entre desistir a tiempo y perder la semana.

29 tests en `src/lib/__tests__/licitaciones.test.js`.

### `src/components/jx-licitaciones.jsx`

La pantalla contesta una pregunta, no muestra una tabla. El veredicto va en la
tarjeta de la lista, **antes de abrir nada**.

- ✅ califica y los elegidos cumplen · ⚠️ hay a quién presentar pero un elegido
  está en falta · ⛔ falta gente para un puesto · ❓ sin requisitos cargados.
- En cada puesto: cuántos califican, **a quién le falta poco** (y cuántos meses)
  y el selector de a quién presentamos.

### El paso a Trabajos

Manual, con botón, como pedía el documento. Se habilita solo con la etapa en
*Buena pro*. **No se duplicó la creación de obras**: `jx-obra.jsx` ya la tiene
con su consorcio, su seed de ubicaciones y su auditoría. Postulaciones deja el
borrador en `window.__prefillObraDesdeLicitacion` y navega; `jx-obra.jsx` lo
consume (se borra al leerlo, para que volver a Obras mañana no reabra el
formulario solo), abre su form ya lleno y, al guardar, escribe de vuelta
`licitaciones.obra_id` — sin eso el botón quedaría disponible para siempre y se
podría crear la misma obra dos veces.

`ejecutora_tipo` **no** viaja en el borrador: empresa o consorcio no se deduce
de con qué RUC se postuló, y errarlo desarma la contabilidad de la obra entera.

---

## Entrega 2 — El requisito real, y el triage medido

### Lo que se midió en las bases de Chilete (8-set-2026)

Cuatro archivos reales: los Anexos 12 (ejecución) y 13 (supervisión) del
proceso del Gobierno Regional de Cajamarca, más dos publicaciones de El Peruano.

| | Texto nativo | Imágenes | Páginas a OCR |
|---|---|---|---|
| Anexo 12 — bases EP (ejecución) | 194.052 chars | 16 | **15** |
| Anexo 13 — bases EPS (supervisión) | 120.515 chars | 18 | **17** |
| El Peruano 021-2026 | 8.620 chars alfabéticos | — | **0** |
| El Peruano 022-2026 | 9.549 chars alfabéticos | — | **0** |

Las 32 imágenes son **páginas completas escaneadas: los Términos de Referencia**,
pegadas como bloque dentro de un Word que por lo demás es texto nativo. Decidir
el OCR a nivel de documento manda a OCR 314.000 caracteres perfectos (y les mete
errores) o deja sin leer los TDR, que es donde están los requisitos.

Costo: 32 páginas por proceso ≈ **USD 0,06**. Mandar los documentos enteros a un
modelo de visión cuesta 20–50× más y lee peor.

**El calendario con fechas reales es NATIVO** (Anexo N° 2, las 10 etapas del
17/08/2026 al 15/10/2026): se extrae sin OCR y sin IA.

**Los PDFs de El Peruano no necesitan OCR en absoluto.** Pero la convocatoria es
una nota entre resoluciones de COFOPRI, notificaciones de SUNAT y disoluciones
de empresas: ahí el problema no es leer, es **encontrar**. Es otro trabajo.

### El hallazgo que evita una heurística

Las páginas escaneadas están **rotadas 90°**, y el Word **declara la rotación**
en su propio XML (`<a:xfrm rot="...">`): `rot=270°` en 15 de 16 imágenes del
Anexo 12 y 17 de 18 del Anexo 13.

Y en el Anexo 12 **no todas van para el mismo lado**: 12 a 270° y 3 a 90°.
Rotar todo 90° "a ojo" corrompe esas 3. El atributo del documento es la única
fuente confiable, y por eso `bases-triage.js` lo lee en vez de estimarlo.

El tamaño de la caja separa la página del adorno: las del TDR miden 22–27 cm; el
logo de la carátula, 7,7 cm.

### La asimetría entre los dos documentos del mismo proceso

En las bases de **supervisión** los requisitos de personal están en texto
nativo (66 líneas con "experiencia", 15 con "personal clave"). En las de
**ejecución** no — están en el TDR escaneado. Mismo proceso, dos documentos, dos
caminos. Eso hace que el triage no sea una optimización sino la condición para
que el extractor funcione en los dos casos.

### El falso ✅ que cerró la mig 198

El requisito real, literal del Anexo 13:

> **Jefe de Supervisión del Proyecto** — Experiencia no menor de **03 años**,
> sustentada con copia de diploma de incorporación al Colegio respectivo.
> Sustentar como mínimo **02 participaciones** como Residente de obra y/o
> Supervisor de obra y/o Inspector de obra y/o [7 cargos más] en obras iguales o
> similares al objeto de la convocatoria, por un plazo **no menor a 02 meses
> cada participación**, en los **últimos 10 años**.

Son **cinco criterios** y la mig 197 guardaba uno (`meses_minimos` + `rubro`).
Consecuencia concreta: **alguien con cinco años seguidos en UNA sola obra pasaba
el filtro y el verificador lo daba por calificado.** No califica — le falta la
segunda participación. Un verificador que dice "sí" cuando la respuesta es "no"
es peor que no tener verificador.

La mig 198 agrega, todo con defaults que APAGAN los criterios (una fila vieja se
evalúa igual que antes):

- `participaciones_minimas` · `meses_por_participacion` · `ventana_anios`
- `cargos_equivalentes` (jsonb) — los diez sinónimos por puesto
- `meses_generales_minimos` — la experiencia general, otro número
- `licitaciones.definicion_obras_similares` — se define una vez por proceso, y
  **no** es un rubro del catálogo: es el texto que escribió esa entidad
- `personal_profesional.colegiatura_fecha` — sin ella los "03 años" no se pueden
  medir; `colegiatura_habil_hasta` dice si puede presentarse hoy, no la antigüedad

**Las participaciones no se fusionan**, y es lo contrario de los meses: dos obras
simultáneas son UN año pero son DOS participaciones. Son dos reglas opuestas
sobre los mismos datos y cada una está donde corresponde
(`totalizarExperiencia` fusiona, `contarParticipaciones` no).

Cuando falta la fecha de colegiatura se **avisa y no se bloquea**: descartar a
alguien por un campo vacío es el error caro de este módulo.

### Archivos

- `src/lib/bases-triage.js` — decisión pura + lector de `.docx`. Sin IA.
- `src/lib/__tests__/bases-triage.test.js` — 21 tests; los que abren los .docx
  reales se **saltan** si `Modelos/` no está (gitignoreado: el repo es público).
- `src/lib/__tests__/requisitos-reales-bases.test.js` — 26 tests que transcriben
  el requisito del Jefe de Supervisión palabra por palabra.

### Dos bugs que los archivos reales destaparon

1. En `bloquesDeDocx`, esparcir `clasificarImagenDocx()` sobre el bloque pisaba
   `tipo: 'imagen'` con su propio `tipo: 'pagina'` — y todo el módulo filtra por
   ese campo, así que las 15 páginas del TDR quedaban **invisibles**.
2. `<w:t[^>]*>` también matchea `<w:tbl>`, `<w:tc>` y `<w:tr>`; como no cierran
   con `</w:t>`, la captura se comía párrafos enteros de tabla e inflaba el texto
   de 194k a 327k caracteres.

Ninguno de los dos aparece con datos inventados. Los dos tienen test de regresión.

---

## Anexo — contexto original de Gabriel (8-set-2026)

Se conserva tal como se recibió, salvo los puntos ya corregidos arriba.

### Estructura del bloque

- Bloque de herramientas IA: escaneo/extracción de bases, análisis de CVs,
  análisis de empresas del grupo/terceras.
- Bloque de trabajos a postular: múltiples postulaciones en paralelo, creadas
  preferentemente desde el escaneo de bases.
- Calendario por postulación: hitos del cronograma (registro, consultas,
  absolución, integración de bases, presentación de ofertas, buena pro), con
  notificaciones por rol.
- Kanban por postulación, con documentos vinculados a cada etapa.
- Transición a Trabajos: manual, con botón, prellenando lo disponible.

### Banco de profesionales y empresas

Ficha estructurada por profesional (experiencia general, específica por tipo de
obra, cargo máximo, colegiatura y vigencia, capacitaciones) y por empresa
(obras similares, facturación acumulada, capacidad libre de contratación
CDC/RNP). La extracción de CVs se hace **una vez**, no re-parseando el CV en
cada postulación.

### Escáner de bases — triage de OCR por página

Un documento de bases casi nunca es 100% nativo ni 100% escaneado. Decidir
«esta base necesita OCR» a nivel de documento completo es incorrecto en ambas
direcciones: gasta dinero y mete errores de OCR en páginas que ya eran texto
perfecto, o deja sin OCR páginas escaneadas dentro de un documento que «en
general» parecía nativo.

**Paso 0 — triage por página, antes de cualquier OCR:**

1. Extraer texto nativo de cada página. Si devuelve cantidad significativa con
   proporción razonable de caracteres alfabéticos → página nativa, usar ese
   texto, **no mandarla a OCR**.
2. Si devuelve vacío, muy poco o basura → esa página específica va a OCR.
3. En `.docx` el texto casi siempre es nativo; el principio aplica solo a las
   imágenes incrustadas (firmas, cuadros pegados como imagen).
4. El resultado es un documento híbrido: texto nativo tal cual + OCR solo donde
   hacía falta, combinado en el mismo markdown antes del Pase 1.

### Arquitectura de extracción (dos pasadas)

- **Pase 1 — localización**: llamado barato que ubica en qué sección/rango de
  páginas están los requisitos de personal, los de empresa, el cronograma, la
  estructura de presentación y los factores de evaluación. Marca qué no encontró.
- **Pase 2 — extracción detallada**: solo sobre las secciones localizadas, con
  reglas estrictas de no inventar datos, distinguir requisito obligatorio de
  factor de evaluación con puntaje, y **citar la página/subsección de origen**
  de cada dato.
- El schema cubre datos del proceso, requisitos de personal, requisitos de
  empresa, cronograma, estructura de presentación, factores de evaluación y un
  array de **alertas** para todo lo que necesita revisión humana.

> ⚠️ El `prompt-extraccion-bases-jarvex.md` que el contexto original referencia
> **no está en el repo**. Hace falta para la entrega 4.

### Estructura de presentación: dinámica, no plantilla fija

El orden de anexos, formularios y foliado **no es el mismo entre
postulaciones** — no se puede reutilizar un expediente anterior completo. Por
eso se separa el banco de contenido reutilizable (declaraciones juradas,
formularios estándar) del índice de estructura generado por cada postulación a
partir de sus propias bases.

### Documentos de referencia compartidos

- Boletín El Peruano (dos ediciones, 8-set-2026) con modelos de convocatoria de
  Entidad Privada Supervisora y Empresa Privada para Chilete (Obras por
  Impuestos, Ley 29230) — ejemplo de estructura de convocatoria y calendario,
  no de OCR mixto.
- Anexos 12 y 13 — Modelo de Bases EP/EPS Chilete (.docx).
- Pendiente: bases reales con partes escaneadas para validar el triage.
