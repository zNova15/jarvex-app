# Comprobantes de pago: adjuntar a factura existente + borrado seguro con desvinculación

**Fecha:** 2026-06-16
**Estado:** Diseño aprobado por el dueño (Gabriel) — decisiones cerradas, listo para plan.

Tres mejoras sobre el vínculo factura (movimiento contable) ↔ comprobante PDF ↔ ingreso de almacén:

1. **Adjuntar el PDF a una factura YA creada** desde Captura Mágica (backfill), sin crear un movimiento duplicado.
2. **Verificar** el auto-vínculo del comprobante al ingreso (ya funciona — no se construye).
3. **Borrar un movimiento contable de forma segura:** aviso previo, desvinculación limpia de los ingresos (sin tocar stock) y **borrado real del PDF** (local + nube).

No requiere migración Supabase ni bump de Dexie: las tres reutilizan columnas y tablas existentes.

---

## Hallazgos del estado actual (verificados en código)

- **Captura Mágica** (`jx-captura-magica.jsx`): detecta duplicado por `third_party_ruc` +
  `document_number` (~líneas 310-314) y guarda `it.duplicate_of = dup.id`, pero
  `confirmarItem()` (~552) **siempre crea un `accounting_movements` nuevo** (~766) y adjunta la
  evidencia a ESE id nuevo (~935-949 vía `window.__saveEvidenciaLocal`,
  `tipo_evidencia:'comprobante_captura'`, `modulo_relacionado:'accounting_movements'`,
  `registro_relacionado_id: accId`). **No existe** un camino "solo adjuntar al existente".
- **Compras Pendientes** (`jx-compras-pendientes.jsx`): el `confirmar()` (~577-710), rama
  VINCULAR (~585-609), **ya estampa** en el ingreso `documento_asociado = factura.document_number`
  + `accounting_movement_id`, y `cargarCandidatos` (~425-452) excluye los ya vinculados
  (`!documento_asociado && !accounting_movement_id`). **El #2 ya funciona.**
- **Borrado contable** (`jx-contabilidad.jsx` `eliminar()` ~917-933): bloquea intercompany
  (~919), confirm mínimo, soft-delete (`deleted_at` + `sync_status:'pending_delete'`).
  **No** escanea ni desvincula los `movimientos_*` que apuntan a esa factura (quedan colgados),
  **no** toca la evidencia (PDF huérfano), **no** avisa. (El patrón de cascada ya existe en
  `intercompany_transactions.delete()` ~1436-1463.)
- **Visor del PDF** (`jx-contabilidad.jsx` ~684-728): carga evidencias por
  `registro_relacionado_id` y firma URL 24 h con `getEvidenciaSrc` (bucket privado). El sync de
  evidencias ya está arreglado (migs 080/081 + `EvidenceUploader`), así que un PDF adjuntado se ve
  y descarga en otra PC.
- **Columnas clave NO indexadas en Dexie:** `accounting_movement_id` y `documento_asociado` en los
  5 `movimientos_*` (la mig 076 solo indexó server-side) → "buscar ingresos de esta factura" se
  hace con `toArray()` + filtro en memoria por tabla, como ya hace Compras Pendientes.
- **Las 5 tablas de movimiento:** `movimientos_materiales`, `movimientos_herramientas`,
  `movimientos_epp`, `movimientos_maquinaria`, `movimientos_insumos_emergencia` (todas con
  `accounting_movement_id` + `documento_asociado`).

## Decisiones cerradas (dueño)

- **#3 PDF al borrar:** se **elimina de verdad** (no se oculta). Borrar la factura borra su(s)
  comprobante(s): objeto de Storage + fila `evidencias` + blob local. Cross-device.
- **#1 colisión de PDF:** si la factura existente **ya tiene** comprobante, **avisar y que el
  usuario elija** (reemplazar el anterior o agregar como segundo).
- **Stock intacto** en la desvinculación (#3): jamás se recalcula stock ni se crea reverso.

---

## Feature #1 — Adjuntar comprobante a factura existente (Captura Mágica)

**Archivo:** `src/components/jx-captura-magica.jsx`.

**Acción nueva** para un ítem con `status==='duplicado'` (y `it.duplicate_of` seteado): botón
**"Adjuntar a la factura existente"**, disponible tanto en la fila de la lista (~1247-1264) como en
el banner de duplicado del ReviewModal (~1459-1463). Copy explícito: *"NO crea un movimiento nuevo;
solo sube el PDF a la factura ya registrada."*

**Handler `adjuntarAExistente(id)`** (espejo de SOLO el bloque de evidencia de `confirmarItem`,
~935-949; nada de proveedor/company/accounting_movement/recepción/OC):

1. `mov = await window.__db.accounting_movements.get(it.duplicate_of)`. Si no existe (fue
   borrado) → toast "la factura ya no existe" y abortar.
2. **`obra_id = mov.obra_id`** (del movimiento existente, NO del header de Captura) — clave para
   que el blob caiga en `evidencias/{obra_id}/{yyyy-mm}/{id}` y sea visible desde la factura.
3. Buscar comprobantes existentes:
   `prev = await window.__db.evidencias.where('registro_relacionado_id').equals(it.duplicate_of).filter(e=>!e.deleted_at).toArray()`
   (esta columna SÍ está indexada). Si `prev.length>0` → **preguntar** (modal/confirm):
   *"Esta factura ya tiene N comprobante(s). ¿Reemplazar o agregar?"*
   - **Reemplazar:** borrar realmente los `prev` (ver `eliminarEvidenciaReal`, §Feature 3) y luego adjuntar.
   - **Agregar:** adjuntar sin tocar los previos.
4. `await window.__saveEvidenciaLocal({ id: window.__newId(), obra_id, tipo_evidencia:'comprobante_captura', modulo_relacionado:'accounting_movements', registro_relacionado_id: it.duplicate_of, nombre_archivo: it.name, mime_type: it.mimeType, blob: it.file, fecha: r.fecha_emision, observaciones:'Backfill comprobante '+r.serie_correlativo, created_by: userId })`.
5. `it.status='confirmado'`; `window.dispatchEvent(jx_data_changed{tabla:'evidencias'})` (prende el
   ojito en `jx-contabilidad`).
6. **try/catch obligatorio:** `saveEvidenciaLocal` lanza si `blob.size > 8 MB`
   (`EvidenceUploader.js:179`) y los PDF **no se comprimen** → capturar y mostrar toast claro
   ("el PDF supera 8 MB").

**Riesgos:** obra del movimiento (no del header); duplicado de movimiento borrado → no aparece el
botón (aceptable); cap de 8 MB.

## Feature #2 — Auto-vínculo del comprobante al ingreso (verificación)

**Ya funciona** (Compras Pendientes estampa `documento_asociado` + `accounting_movement_id`).
Sin build. Plan de verificación manual: vincular un ingreso a una factura `pendiente_recepcion` y
confirmar que el ingreso muestra el número de factura y el enlace.

**Opcional (polish, si el dueño lo pide):** que las vistas de movimiento muestren también
**tipo/serie** del comprobante (hoy solo copia el número). Resolver con lookup en render al
`accounting_movements` vinculado — **no** denormalizar columnas nuevas. (Fuera del alcance v1 salvo
pedido explícito.)

## Feature #3 — Borrado seguro: aviso + desvinculación + borrado real del PDF

**Archivo:** `src/components/jx-contabilidad.jsx` (`eliminar()` ~917-933) + un helper de borrado de
evidencia.

### Flujo

1. **Pre-escaneo** (antes de confirmar), reutilizando la lista de 5 tablas:
   - Por cada tabla `t` de `['movimientos_materiales','movimientos_herramientas','movimientos_epp','movimientos_maquinaria','movimientos_insumos_emergencia']`:
     `vinc = await window.__db[t].filter(x => x.accounting_movement_id === m.id && !x.deleted_at).toArray()`.
   - `evs = await window.__db.evidencias.where('registro_relacionado_id').equals(m.id).filter(e=>!e.deleted_at).toArray()`.
2. **Aviso enriquecido** (si hay vínculos o evidencias):
   > *"Esta factura tiene **N ingreso(s) de almacén** vinculado(s) y **M comprobante(s)** adjunto(s).
   > Al eliminar: los ingresos quedarán **sin factura (el stock NO se toca)** para que los puedas
   > re-vincular a la factura corregida, y el/los comprobante(s) se **eliminarán**."*

   Si no hay nada vinculado → confirm simple como hoy.
3. **Al confirmar**, transacción Dexie `('rw', [accounting_movements, ...5 tablas, evidencias, evidencias_blobs])`:
   - **Desvincular cada ingreso** (`construirDesvinculacion`, helper puro):
     `update(id, { accounting_movement_id: null, documento_asociado: null, observaciones: anotarBaja(observaciones, m.document_number), updated_at, updated_by, version: (version||1)+1, sync_status: syncStatusDesvinculo(mov) })`.
     - `anotarBaja`: quita/anula el fragmento `'Factura <num>'` y agrega `' · [factura eliminada — re-vincular]'` (deja rastro).
     - `syncStatusDesvinculo`: si el mov es demo/synced sin cambios pendientes, mantener `'synced'`
       no aplica al cambiar datos → usar `'pending_update'` salvo que esté en `'pending_create'`
       (espejo de la lógica de VINCULAR en compras-pendientes ~601). **Stock/cantidad: intactos.**
   - **Borrar real cada evidencia** (`eliminarEvidenciaReal`): ver abajo.
   - **Soft-delete de la factura** como hoy (`deleted_at` + `sync_status:'pending_delete'`).
   - `logAudit` con la lista de `movIds` desvinculados; `dispatchEvent` `jx_data_changed` por cada
     tabla afectada + `evidencias`.

### `eliminarEvidenciaReal(ev)` (borrado real, no soft)

Nuevo helper (en `src/lib/evidencias-url.js` o `EvidenceUploader.js`). El PDF debe desaparecer
también en la nube y en otras PC:

- **Online:** `supabase.storage.from('evidencias').remove([path])` (path vía
  `pathDeEvidencia(ev.url_archivo)`), luego `supabase.from('evidencias').delete().eq('id', ev.id)`
  (DELETE real de la fila — el soft-delete NO sirve porque `deleted_at` no está en `EVIDENCIA_COLS`
  y no se propaga). Local: `db.evidencias.delete(ev.id)` + `db.evidencias_blobs.delete(ev.blob_ref || ev.id)`.
- **Offline:** borrar local (fila + blob) y encolar el purgado remoto en una lista de
  pendientes-de-borrado (`evidencias_purga_pendiente` en localStorage o tabla simple) que
  `EvidenceUploader` procesa al reconectar. Mostrar nota "se purgará de la nube al reconectar".
- Siempre `try/catch`: si falla el remove de Storage pero la fila se borra, registrar warning
  (el objeto huérfano en Storage no rompe nada funcional).

### Semántica de desvinculación (preciso)

- Ingreso: `accounting_movement_id=null` + `documento_asociado=null` → reaparece en
  `cargarCandidatos` para re-vincular a la factura verdadera. `observaciones` anotada. **Sin tocar
  `cantidad`, `stock_actual`, `tipo_movimiento`; sin reverso; sin tocar `insumos_partida`/consumo.**
- Factura: soft-delete (se borra de verdad la evidencia, no la factura — la factura sigue el
  soft-delete estándar).
- No hay tabla-join del vínculo: vive en las 2 columnas del ingreso (+ JSON `notas` de la factura,
  irrelevante porque la factura se borra). Limpiar las 2 columnas es el desvínculo autoritativo.
- Intercompany ya está bloqueado de borrado (~919) → el escaneo no corre para esos.

## Opcional recomendado — Indicador "sin comprobante"

Para que Gabriel encuentre rápido las facturas a las que les falta el PDF (su caso de backfill): en
la lista de Movimientos Contables, un **badge/filtro "sin comprobante"** para los
`accounting_movements` sin ninguna `evidencia` (`modulo_relacionado='accounting_movements'`,
`registro_relacionado_id=m.id`, `!deleted_at`). Lo decide el plan; es liviano (la consulta ya se usa
para el ojito). No bloquea las 3 features.

## Helpers puros testeables

- **`construirDesvinculacion(factura, movsVinculados)`** → array de patches
  `{ tabla, id, cambios }` (limpia columnas + anota observaciones), sin tocar stock. Unit-testeable.
- **`anotarBaja(observaciones, numeroFactura)`** → string con el fragmento de factura anulado +
  sufijo `[factura eliminada — re-vincular]`. Unit-testeable.
- (El escaneo y los borrados de Storage quedan en la capa de componente/sync, no en el helper puro.)

## Pruebas

- **Unit (`src/lib/__tests__/desvinculacion-factura.test.js`):** `construirDesvinculacion` con 0/1/N
  ingresos en varias tablas (incluida maquinaria/emergencia); verifica que limpia
  `accounting_movement_id`+`documento_asociado`, anota observaciones, **no** incluye cambios de
  `cantidad`/`stock`; `anotarBaja` con observación con y sin fragmento de factura previo.
- **Build:** `TMPDIR=/var/tmp npm run build`. **Unit:** `TMPDIR=/var/tmp npm run test:unit`.
- **Manual:** (#1) importar un duplicado, adjuntar a la existente, ver el ojito en otra PC;
  colisión → preguntar reemplazar/agregar. (#3) borrar una factura con 1 ingreso vinculado + PDF →
  aviso correcto → confirmar → ingreso queda sin comprobante y re-vinculable, stock igual, PDF ya no
  se ve (ni en otra PC). (#2) vincular y verificar el número auto-estampado.

## Archivos

| Acción | Archivo |
|--------|---------|
| Modificar | `src/components/jx-captura-magica.jsx` (#1: botón + `adjuntarAExistente`) |
| Modificar | `src/components/jx-contabilidad.jsx` (#3: pre-escaneo + aviso + transacción desvínculo/borrado; opcional badge "sin comprobante") |
| Modificar | `src/lib/evidencias-url.js` o `src/sync/EvidenceUploader.js` (`eliminarEvidenciaReal` + purga offline) |
| Crear | `src/lib/desvinculacion-factura.js` (`construirDesvinculacion`, `anotarBaja`) |
| Crear | `src/lib/__tests__/desvinculacion-factura.test.js` |
| Verificar | `src/components/jx-compras-pendientes.jsx` (#2 ya funciona) |

## Fuera de alcance v1

- Hacer **obligatorio** que toda factura tenga PDF (rompería flujos; en su lugar, el indicador
  "sin comprobante" lo hace visible).
- Mostrar tipo/serie standalone en el movimiento (polish, solo si se pide).
- Purga retroactiva de blobs huérfanos en Storage de borrados previos.
