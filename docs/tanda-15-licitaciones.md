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
| 2 | **CV → ficha con IA** — llenar el padrón, que hoy está vacío | pendiente |
| 3 | **Requisitos de empresa** — obras similares, facturación, CDC/RNP | pendiente |
| 4 | **Escáner de bases** — triage por página en el cliente + Pase 1/Pase 2 → llena los requisitos de la entrega 1 | pendiente (esperando bases reales) |
| 5 | Calendario del proceso + kanban con documentos por etapa | pendiente |
| 6 | Oferta económica | módulo propio, no un vínculo |

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
