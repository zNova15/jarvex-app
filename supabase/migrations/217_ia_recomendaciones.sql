-- ═══════════════════════════════════════════════════════════════════
-- 217 — LAS RECOMENDACIONES DE IA DEJAN DE VIVIR EN UN SOLO NAVEGADOR
--
-- ── EL DEFECTO, CONTADO POR GABRIEL (15-set-2026) ─────────────────
-- «Quiero que las recomendaciones de IA que me salían en Staging se mantengan
-- en Main, pues actualmente probé en la PC de la contadora en Jefe y a ella no
-- le salen las recomendaciones por IA por las que pagué.»
--
-- ── LA CAUSA REAL, Y NO ES LA RAMA ────────────────────────────────
-- `src/lib/barrido-store.js` guardaba las recomendaciones en localStorage bajo
-- la clave `jx_ia_recomendaciones_v1`. localStorage está atado a DOS cosas que
-- nadie eligió:
--
--   1. EL NAVEGADOR. Lo que se recorrió en la PC de Gabriel no existe en la PC
--      de la contadora. Ella abre la bandeja y ve la lista cruda, sin ninguna
--      de las 549 propuestas que ya se pagaron.
--   2. EL ORIGEN (dominio). `jarvex-app-git-staging-*.vercel.app` y
--      `jarvex-app.vercel.app` son orígenes distintos para el navegador, así
--      que tienen localStorage separados. Promover el código de staging a main
--      NO mueve las recomendaciones: el código viaja, los datos no.
--
-- El comentario de barrido-store decía «LAS RECOMENDACIONES SOBREVIVEN A TODO»
-- y era verdad dentro de un navegador: sobrevivían al refresco, al cierre de
-- sesión y al cierre de pestaña. Lo que no sobrevivían era cambiar de PC, que
-- es justamente lo que hace falta cuando el que paga el barrido y el que
-- despacha las propuestas son dos personas distintas.
--
-- ── POR QUÉ ESTO SÍ VA A UNA TABLA SINCRONIZADA ───────────────────
-- La regla 8 del CLAUDE.md dice que la base oficial (los 82 códigos del IUPC y
-- los 938 términos del Anexo 2) NO va a tablas sincronizadas: es tráfico
-- permanente para guardar algo que no cambia, y ésa fue la lección del corte
-- por egress del 9-set. Esto es lo contrario en las dos mitades:
--   · CAMBIA todo el tiempo — cada barrido escribe, cada decisión borra la suya.
--   · Y ES CHICO: medido el 15-set, el recorrido completo de GASOMI son 549
--     filas de ~300 bytes = unos 165 KB. El catálogo del IUPC son 1.030 filas
--     que nunca cambian; esto son las respuestas que la empresa compró.
-- Guardar en la nube lo que se pagó es exactamente para lo que está la nube.
--
-- ── NO SON DECISIONES, Y ESO NO CAMBIA ────────────────────────────
-- Una fila acá es una PROPUESTA esperando un clic. Lo que se guarda como
-- decisión lo sigue escribiendo la pantalla en `insumo_categoria` /
-- `insumo_correlaciones` cuando una persona acepta. Por eso esta tabla se
-- puede vaciar entera sin perder un solo dato del negocio: lo único que se
-- pierde es la plata del barrido, que es justamente lo que veníamos perdiendo
-- cada vez que alguien abría la app en otra máquina.
--
-- ── SIN FK, A PROPÓSITO ───────────────────────────────────────────
-- `ambito` es texto libre ('grupo', un uuid de empresa, o `empresa::subpestaña`
-- en correlaciones) y `item_id` es la clave lógica del ítem (el `norm` de una
-- descripción, o el id por contenido de un candidato de correlación). Ninguna
-- apunta a una fila que pueda no haber llegado todavía desde la otra PC: con
-- FKs duras, un push offline rebotaría con 23503 por orden de llegada, que es
-- el mismo motivo por el que insumo_correlaciones e insumo_mapeo son FK-less.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ia_recomendaciones (
  id uuid PRIMARY KEY,

  -- Qué pregunta contestó la IA. Son tres recorridos distintos y no se mezclan:
  -- cada pantalla lee solo el suyo.
  seccion text NOT NULL CHECK (seccion IN ('clasificacion','correlaciones','mapeo')),

  -- Sobre qué universo se corrió. 'grupo' o el uuid de la empresa; en
  -- correlaciones lleva además la sub-pestaña ('<empresa>::insumos'), porque
  -- insumos y servicios son dos listas distintas y la misma descripción puede
  -- tener propuesta en una y no en la otra.
  ambito text NOT NULL,

  -- La clave del ítem dentro de ese ámbito: el `norm` de la descripción en
  -- clasificación, el id por contenido del candidato en correlaciones.
  item_id text NOT NULL,

  -- La propuesta cruda, tal como la dejó el recorrido: en clasificación
  -- {codigo, nombre, confianza, razonamiento, nuevaClasificacion, noSe}; en
  -- correlaciones {mismas[], fuera[], confianza, razonamiento, unidades}.
  -- jsonb y no columnas: las tres secciones guardan formas distintas y la
  -- pantalla ya sabe leer la suya. Congelar ese contrato en columnas obligaría
  -- a una migración cada vez que una propuesta gana un campo.
  datos jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Qué modelo la produjo. Es la única forma de contestar «¿esta tanda la hizo
  -- el gratuito o la que pagamos?» cuando dos modelos conviven en el tiempo.
  modelo text,

  demo boolean NOT NULL DEFAULT false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  last_synced_at timestamptz,
  deleted_at timestamptz,
  idempotency_key text UNIQUE
);

COMMENT ON TABLE ia_recomendaciones IS
  'Propuestas que dejo un recorrido con IA, esperando que una persona las acepte. Antes vivian en localStorage: no cruzaban de PC ni de dominio, asi que la contadora no veia lo que se habia pagado. No son decisiones: eso sigue en insumo_categoria / insumo_correlaciones.';
COMMENT ON COLUMN ia_recomendaciones.ambito IS
  'grupo o uuid de empresa; en correlaciones <ambito>::<subpestana>. Texto libre a proposito: no es una FK.';
COMMENT ON COLUMN ia_recomendaciones.item_id IS
  'Clave logica del item: el norm de la descripcion, o el id por contenido del candidato de correlacion.';

-- La consulta de la pantalla es siempre la misma: «lo de esta sección y este
-- ámbito». Sin el índice es un full scan por cada render de la bandeja.
CREATE INDEX IF NOT EXISTS idx_ia_recomendaciones_ambito
  ON ia_recomendaciones (seccion, ambito) WHERE deleted_at IS NULL;
-- Y la escritura busca por la llave lógica completa antes de insertar, para no
-- duplicar la misma propuesta cuando dos PCs recorren a la vez.
CREATE INDEX IF NOT EXISTS idx_ia_recomendaciones_llave
  ON ia_recomendaciones (seccion, ambito, item_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_ia_recomendaciones_updated ON ia_recomendaciones;
CREATE TRIGGER trg_ia_recomendaciones_updated
  BEFORE UPDATE ON ia_recomendaciones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE ia_recomendaciones ENABLE ROW LEVEL SECURITY;

-- Mismo gate que `catalogo_insumos` e `insumo_categoria` después de la mig 211:
-- TODOS leen, y escriben admin / gerente / contador. Que el contador escriba no
-- es un detalle — es el caso que origina esta migración: la Contadora Jefe es
-- quien despacha la bandeja, y si no pudiera escribir, su propio recorrido le
-- rebotaría en el push y volvería a quedarse sin propuestas.
DROP POLICY IF EXISTS "ia_recomendaciones: autenticado lee" ON ia_recomendaciones;
CREATE POLICY "ia_recomendaciones: autenticado lee" ON ia_recomendaciones
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "ia_recomendaciones: contabilidad inserta" ON ia_recomendaciones;
CREATE POLICY "ia_recomendaciones: contabilidad inserta" ON ia_recomendaciones
  FOR INSERT TO authenticated WITH CHECK (has_role(ARRAY['admin'::text,'gerente'::text,'contador'::text]));
DROP POLICY IF EXISTS "ia_recomendaciones: contabilidad actualiza" ON ia_recomendaciones;
CREATE POLICY "ia_recomendaciones: contabilidad actualiza" ON ia_recomendaciones
  FOR UPDATE TO authenticated USING (has_role(ARRAY['admin'::text,'gerente'::text,'contador'::text]));
DROP POLICY IF EXISTS "ia_recomendaciones: contabilidad borra" ON ia_recomendaciones;
CREATE POLICY "ia_recomendaciones: contabilidad borra" ON ia_recomendaciones
  FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text,'gerente'::text,'contador'::text]));
