-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Schema inicial
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- ═══════════════════════════════════════════════════════════════════

-- Habilitar extensión UUID
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Función para updated_at automático ───────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  NEW.version = OLD.version + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────────────────────────────────
-- 1. PROFILES (extiende auth.users)
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  nombres     TEXT NOT NULL,
  apellidos   TEXT NOT NULL,
  email       TEXT NOT NULL,
  avatar_url  TEXT,
  rol         TEXT NOT NULL DEFAULT 'solo_lectura' CHECK (rol IN (
                'admin', 'gerente', 'ingeniero_residente',
                'supervisor', 'almacenero', 'asistente_admin', 'solo_lectura'
              )),
  activo      BOOLEAN DEFAULT true,
  version     INTEGER DEFAULT 1 NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Crear profile automáticamente al registrar usuario
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, nombres, apellidos, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nombres', 'Sin nombre'),
    COALESCE(NEW.raw_user_meta_data->>'apellidos', ''),
    NEW.email
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ──────────────────────────────────────────────────────────────────────
-- 2. PROVEEDORES
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proveedores (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  razon_social   TEXT NOT NULL,
  ruc            TEXT UNIQUE,
  contacto       TEXT,
  telefono       TEXT,
  correo         TEXT,
  tipo_proveedor TEXT,
  direccion      TEXT,
  estado         TEXT DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo')),
  observaciones  TEXT,
  version        INTEGER DEFAULT 1 NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at     TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at     TIMESTAMPTZ,
  created_by     UUID REFERENCES auth.users(id)
);

CREATE TRIGGER trg_proveedores_updated_at
  BEFORE UPDATE ON proveedores
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ──────────────────────────────────────────────────────────────────────
-- 3. OBRAS
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS obras (
  id                     UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre_obra            TEXT NOT NULL,
  cliente                TEXT,
  ubicacion              TEXT,
  estado                 TEXT DEFAULT 'activo' CHECK (estado IN (
                           'planificacion', 'activo', 'pausado', 'terminado', 'cancelado'
                         )),
  fecha_inicio           DATE,
  fecha_fin_estimada     DATE,
  presupuesto_total      NUMERIC(14,2),
  costo_real_acumulado   NUMERIC(14,2) DEFAULT 0,
  avance_fisico          NUMERIC(5,2) DEFAULT 0,
  avance_financiero      NUMERIC(5,2) DEFAULT 0,
  responsable_id         UUID REFERENCES profiles(id),
  observaciones          TEXT,
  version                INTEGER DEFAULT 1 NOT NULL,
  created_at             TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at             TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at             TIMESTAMPTZ,
  created_by             UUID REFERENCES auth.users(id),
  updated_by             UUID REFERENCES auth.users(id)
);

CREATE TRIGGER trg_obras_updated_at
  BEFORE UPDATE ON obras
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ──────────────────────────────────────────────────────────────────────
-- 4. OBRA_USUARIOS (permisos por obra)
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS obra_usuarios (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  obra_id    UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rol_obra   TEXT CHECK (rol_obra IN (
               'admin', 'gerente', 'ingeniero_residente',
               'supervisor', 'almacenero', 'asistente_admin', 'solo_lectura'
             )),
  activo     BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(obra_id, usuario_id)
);

-- ──────────────────────────────────────────────────────────────────────
-- 5. PERSONAL
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS personal (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  obra_id        UUID NOT NULL REFERENCES obras(id),
  nombres        TEXT NOT NULL,
  apellidos      TEXT NOT NULL,
  dni            TEXT NOT NULL,
  cargo          TEXT,
  area           TEXT,
  fecha_ingreso  DATE,
  estado         TEXT DEFAULT 'activo' CHECK (estado IN (
                   'activo', 'inactivo', 'suspendido', 'retirado'
                 )),
  telefono       TEXT,
  observaciones  TEXT,
  version        INTEGER DEFAULT 1 NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at     TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at     TIMESTAMPTZ,
  created_by     UUID REFERENCES auth.users(id),
  updated_by     UUID REFERENCES auth.users(id),
  UNIQUE(dni, obra_id)
);

CREATE TRIGGER trg_personal_updated_at
  BEFORE UPDATE ON personal
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ──────────────────────────────────────────────────────────────────────
-- 6. MATERIALES
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS materiales (
  id                          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  obra_id                     UUID NOT NULL REFERENCES obras(id),
  nombre_material             TEXT NOT NULL,
  categoria                   TEXT,
  unidad                      TEXT NOT NULL,
  stock_inicial               NUMERIC(12,3) DEFAULT 0,
  stock_actual                NUMERIC(12,3) DEFAULT 0,
  stock_minimo                NUMERIC(12,3) DEFAULT 0,
  total_entradas              NUMERIC(12,3) DEFAULT 0,
  total_salidas               NUMERIC(12,3) DEFAULT 0,
  precio_unitario_estimado    NUMERIC(10,2),
  precio_unitario_real_prom   NUMERIC(10,2),
  proveedor_principal_id      UUID REFERENCES proveedores(id),
  alerta                      TEXT DEFAULT 'ok' CHECK (alerta IN (
                                'ok', 'reponer', 'critico', 'sin_stock'
                              )),
  estado                      TEXT DEFAULT 'activo',
  observaciones               TEXT,
  version                     INTEGER DEFAULT 1 NOT NULL,
  created_at                  TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at                  TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at                  TIMESTAMPTZ,
  created_by                  UUID REFERENCES auth.users(id),
  updated_by                  UUID REFERENCES auth.users(id)
);

CREATE TRIGGER trg_materiales_updated_at
  BEFORE UPDATE ON materiales
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ──────────────────────────────────────────────────────────────────────
-- 7. HERRAMIENTAS
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS herramientas (
  id                       UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  obra_id                  UUID NOT NULL REFERENCES obras(id),
  nombre_herramienta       TEXT NOT NULL,
  tipo_herramienta         TEXT CHECK (tipo_herramienta IN (
                             'manual', 'electrica', 'maquinaria_liviana',
                             'maquinaria_pesada', 'medicion', 'seguridad'
                           )),
  marca                    TEXT,
  modelo                   TEXT,
  serie                    TEXT,
  estado_actual            TEXT DEFAULT 'bueno' CHECK (estado_actual IN (
                             'nuevo', 'bueno', 'regular', 'malo',
                             'mantenimiento', 'inhabilitado', 'baja'
                           )),
  ubicacion_actual         TEXT DEFAULT 'almacen' CHECK (ubicacion_actual IN (
                             'almacen', 'en_uso', 'mantenimiento', 'perdida', 'baja'
                           )),
  disponible               BOOLEAN DEFAULT true,
  ultimo_responsable_id    UUID REFERENCES personal(id),
  fecha_ultimo_movimiento  DATE,
  observaciones            TEXT,
  version                  INTEGER DEFAULT 1 NOT NULL,
  created_at               TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at               TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at               TIMESTAMPTZ,
  created_by               UUID REFERENCES auth.users(id),
  updated_by               UUID REFERENCES auth.users(id)
);

CREATE TRIGGER trg_herramientas_updated_at
  BEFORE UPDATE ON herramientas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ──────────────────────────────────────────────────────────────────────
-- 8. PARTIDAS
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS partidas (
  id                          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  obra_id                     UUID NOT NULL REFERENCES obras(id),
  codigo_delfin               TEXT,
  nombre_partida              TEXT NOT NULL,
  categoria                   TEXT,
  unidad                      TEXT,
  metrado_contratado          NUMERIC(12,3),
  metrado_ejecutado           NUMERIC(12,3) DEFAULT 0,
  porcentaje_avance           NUMERIC(5,2) DEFAULT 0,
  precio_unitario_pres        NUMERIC(10,2),
  costo_total_presupuestado   NUMERIC(14,2),
  costo_real_acumulado        NUMERIC(14,2) DEFAULT 0,
  diferencia                  NUMERIC(14,2) GENERATED ALWAYS AS (costo_real_acumulado - COALESCE(costo_total_presupuestado, 0)) STORED,
  estado                      TEXT DEFAULT 'pendiente' CHECK (estado IN (
                                'pendiente', 'en_ejecucion', 'terminado', 'observado', 'atrasado'
                              )),
  fecha_inicio_planificada    DATE,
  fecha_fin_planificada       DATE,
  fecha_inicio_real           DATE,
  fecha_fin_real              DATE,
  observaciones               TEXT,
  version                     INTEGER DEFAULT 1 NOT NULL,
  created_at                  TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at                  TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at                  TIMESTAMPTZ,
  created_by                  UUID REFERENCES auth.users(id),
  updated_by                  UUID REFERENCES auth.users(id)
);

CREATE TRIGGER trg_partidas_updated_at
  BEFORE UPDATE ON partidas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ──────────────────────────────────────────────────────────────────────
-- 9. MOVIMIENTOS_MATERIALES
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS movimientos_materiales (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  obra_id              UUID NOT NULL REFERENCES obras(id),
  material_id          UUID NOT NULL REFERENCES materiales(id),
  fecha                DATE NOT NULL,
  hora                 TIME,
  tipo_movimiento      TEXT NOT NULL CHECK (tipo_movimiento IN (
                         'entrada', 'salida', 'ajuste', 'devolucion', 'merma'
                       )),
  cantidad             NUMERIC(12,3) NOT NULL CHECK (cantidad > 0),
  unidad               TEXT NOT NULL,
  responsable_id       UUID REFERENCES personal(id),
  proveedor_id         UUID REFERENCES proveedores(id),
  documento_asociado   TEXT,
  partida_id           UUID REFERENCES partidas(id),
  frente_zona          TEXT,
  precio_unitario_real NUMERIC(10,2),
  evidencia_id         UUID,
  observaciones        TEXT,
  version              INTEGER DEFAULT 1 NOT NULL,
  created_at           TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at           TIMESTAMPTZ DEFAULT now() NOT NULL,
  created_by           UUID REFERENCES auth.users(id),
  updated_by           UUID REFERENCES auth.users(id),
  idempotency_key      TEXT UNIQUE
);

CREATE TRIGGER trg_mov_materiales_updated_at
  BEFORE UPDATE ON movimientos_materiales
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ──────────────────────────────────────────────────────────────────────
-- 10. MOVIMIENTOS_HERRAMIENTAS
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS movimientos_herramientas (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  obra_id             UUID NOT NULL REFERENCES obras(id),
  herramienta_id      UUID NOT NULL REFERENCES herramientas(id),
  fecha               DATE NOT NULL,
  hora                TIME,
  responsable_id      UUID NOT NULL REFERENCES personal(id),
  accion              TEXT NOT NULL CHECK (accion IN (
                        'salida', 'entrada', 'mantenimiento', 'baja', 'reposicion'
                      )),
  estado_salida       TEXT,
  estado_devolucion   TEXT,
  evidencia_id        UUID,
  observaciones       TEXT,
  version             INTEGER DEFAULT 1 NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at          TIMESTAMPTZ DEFAULT now() NOT NULL,
  created_by          UUID REFERENCES auth.users(id),
  updated_by          UUID REFERENCES auth.users(id),
  idempotency_key     TEXT UNIQUE
);

CREATE TRIGGER trg_mov_herramientas_updated_at
  BEFORE UPDATE ON movimientos_herramientas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ──────────────────────────────────────────────────────────────────────
-- 11. ASISTENCIA
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS asistencia (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  obra_id                 UUID NOT NULL REFERENCES obras(id),
  personal_id             UUID NOT NULL REFERENCES personal(id),
  fecha                   DATE NOT NULL,
  hora_ingreso            TIME,
  hora_salida             TIME,
  horas_trabajadas        NUMERIC(4,2),
  estado_asistencia       TEXT NOT NULL CHECK (estado_asistencia IN (
                            'asistio', 'tardanza', 'falta', 'permiso', 'descanso'
                          )),
  evidencia_id            UUID,
  observaciones           TEXT,
  version                 INTEGER DEFAULT 1 NOT NULL,
  created_at              TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at              TIMESTAMPTZ DEFAULT now() NOT NULL,
  created_by              UUID REFERENCES auth.users(id),
  updated_by              UUID REFERENCES auth.users(id),
  idempotency_key         TEXT UNIQUE,
  UNIQUE(personal_id, fecha)
);

CREATE TRIGGER trg_asistencia_updated_at
  BEFORE UPDATE ON asistencia
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ──────────────────────────────────────────────────────────────────────
-- 12. AVANCE_OBRA
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS avance_obra (
  id                          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  obra_id                     UUID NOT NULL REFERENCES obras(id),
  partida_id                  UUID NOT NULL REFERENCES partidas(id),
  fecha                       DATE NOT NULL,
  semana                      TEXT,
  metrado_ejecutado           NUMERIC(12,3),
  porcentaje_avance_reportado NUMERIC(5,2),
  responsable_id              UUID REFERENCES profiles(id),
  personal_asignado           INTEGER,
  evidencia_id                UUID,
  observaciones               TEXT,
  version                     INTEGER DEFAULT 1 NOT NULL,
  created_at                  TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at                  TIMESTAMPTZ DEFAULT now() NOT NULL,
  created_by                  UUID REFERENCES auth.users(id),
  updated_by                  UUID REFERENCES auth.users(id),
  idempotency_key             TEXT UNIQUE
);

CREATE TRIGGER trg_avance_updated_at
  BEFORE UPDATE ON avance_obra
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ──────────────────────────────────────────────────────────────────────
-- 13. INSUMOS_PARTIDA
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS insumos_partida (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  obra_id               UUID NOT NULL REFERENCES obras(id),
  partida_id            UUID NOT NULL REFERENCES partidas(id),
  tipo_insumo           TEXT CHECK (tipo_insumo IN (
                          'material', 'mano_obra', 'herramienta', 'equipo'
                        )),
  recurso_id            UUID,
  nombre_insumo         TEXT NOT NULL,
  unidad                TEXT,
  cantidad_presupuestada NUMERIC(12,3),
  precio_presupuestado  NUMERIC(10,2),
  costo_presupuestado   NUMERIC(14,2) GENERATED ALWAYS AS (
                          COALESCE(cantidad_presupuestada, 0) * COALESCE(precio_presupuestado, 0)
                        ) STORED,
  cantidad_real_usada   NUMERIC(12,3) DEFAULT 0,
  precio_real           NUMERIC(10,2) DEFAULT 0,
  costo_real            NUMERIC(14,2) DEFAULT 0,
  diferencia_cantidad   NUMERIC(12,3) GENERATED ALWAYS AS (
                          COALESCE(cantidad_real_usada, 0) - COALESCE(cantidad_presupuestada, 0)
                        ) STORED,
  estado                TEXT DEFAULT 'dentro_presupuesto' CHECK (estado IN (
                          'dentro_presupuesto', 'exceso', 'ahorro'
                        )),
  version               INTEGER DEFAULT 1 NOT NULL,
  created_at            TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at            TIMESTAMPTZ DEFAULT now() NOT NULL,
  created_by            UUID REFERENCES auth.users(id)
);

-- ──────────────────────────────────────────────────────────────────────
-- 14. CRONOGRAMA
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cronograma (
  id                       UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  obra_id                  UUID NOT NULL REFERENCES obras(id),
  partida_id               UUID NOT NULL REFERENCES partidas(id) UNIQUE,
  fecha_inicio_planificada DATE,
  fecha_fin_planificada    DATE,
  duracion_planificada     INTEGER,
  fecha_inicio_real        DATE,
  fecha_fin_real           DATE,
  duracion_real            INTEGER,
  avance_esperado          NUMERIC(5,2),
  avance_real              NUMERIC(5,2),
  estado                   TEXT DEFAULT 'a_tiempo' CHECK (estado IN (
                             'a_tiempo', 'adelantado', 'atrasado', 'critico', 'finalizado'
                           )),
  dependencias             UUID[],
  observaciones            TEXT,
  version                  INTEGER DEFAULT 1 NOT NULL,
  created_at               TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at               TIMESTAMPTZ DEFAULT now() NOT NULL,
  created_by               UUID REFERENCES auth.users(id)
);

-- ──────────────────────────────────────────────────────────────────────
-- 15. EVIDENCIAS
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS evidencias (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  obra_id                 UUID NOT NULL REFERENCES obras(id),
  tipo_evidencia          TEXT CHECK (tipo_evidencia IN (
                            'foto_asistencia', 'pdf_formato_firmado', 'guia_remision',
                            'factura', 'foto_herramienta_danada', 'foto_avance',
                            'acta', 'documento_general'
                          )),
  modulo_relacionado      TEXT,
  registro_relacionado_id UUID,
  nombre_archivo          TEXT NOT NULL,
  url_archivo             TEXT,
  local_path_temporal     TEXT,
  mime_type               TEXT,
  tamano_bytes            INTEGER,
  subido_por              UUID REFERENCES auth.users(id),
  fecha                   DATE,
  observaciones           TEXT,
  sync_status             TEXT DEFAULT 'pending_upload' CHECK (sync_status IN (
                            'pending_upload', 'uploaded', 'failed'
                          )),
  upload_retries          INTEGER DEFAULT 0,
  created_at              TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at              TIMESTAMPTZ DEFAULT now() NOT NULL,
  created_by              UUID REFERENCES auth.users(id)
);

-- ──────────────────────────────────────────────────────────────────────
-- 16. INCIDENCIAS
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS incidencias (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  obra_id              UUID NOT NULL REFERENCES obras(id),
  tipo_incidencia      TEXT CHECK (tipo_incidencia IN (
                         'herramienta', 'seguridad', 'material', 'calidad',
                         'equipo', 'accidente', 'stock_conflicto'
                       )),
  severidad            TEXT DEFAULT 'media' CHECK (severidad IN (
                         'baja', 'media', 'alta', 'critica'
                       )),
  modulo_origen        TEXT,
  registro_origen_id   UUID,
  descripcion          TEXT NOT NULL,
  responsable_id       UUID REFERENCES personal(id),
  estado               TEXT DEFAULT 'abierta' CHECK (estado IN (
                         'abierta', 'en_revision', 'resuelta', 'cerrada'
                       )),
  evidencia_id         UUID,
  creado_por           UUID REFERENCES auth.users(id),
  resuelto_en          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at           TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ──────────────────────────────────────────────────────────────────────
-- 17. SYNC_LOG (auditoría)
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_log (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  usuario_id      UUID REFERENCES auth.users(id),
  tabla           TEXT NOT NULL,
  registro_id     UUID NOT NULL,
  operacion       TEXT CHECK (operacion IN ('create', 'update', 'delete', 'conflict')),
  datos_antes     JSONB,
  datos_despues   JSONB,
  resuelto        BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL
);
