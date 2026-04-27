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
-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Row Level Security (RLS)
-- ═══════════════════════════════════════════════════════════════════

-- Función helper: ¿el usuario tiene acceso a la obra?
CREATE OR REPLACE FUNCTION user_has_access_to_obra(p_obra_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  -- Admin ve todo
  IF EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND rol = 'admin'
  ) THEN RETURN true; END IF;

  -- Usuarios asignados a la obra
  RETURN EXISTS (
    SELECT 1 FROM obra_usuarios
    WHERE obra_id = p_obra_id
      AND usuario_id = auth.uid()
      AND activo = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Función helper: rol del usuario en una obra
CREATE OR REPLACE FUNCTION user_rol_in_obra(p_obra_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_rol TEXT;
BEGIN
  SELECT rol INTO v_rol FROM profiles WHERE id = auth.uid();
  IF v_rol = 'admin' THEN RETURN 'admin'; END IF;

  SELECT rol_obra INTO v_rol FROM obra_usuarios
  WHERE obra_id = p_obra_id AND usuario_id = auth.uid() AND activo = true;

  RETURN COALESCE(v_rol, 'sin_acceso');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── PROFILES ────────────────────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles: ver propio" ON profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "profiles: admin ve todos" ON profiles
  FOR SELECT USING (
    (SELECT rol FROM profiles WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "profiles: actualizar propio" ON profiles
  FOR UPDATE USING (id = auth.uid());

-- ── OBRAS ───────────────────────────────────────────────────────────
ALTER TABLE obras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "obras: ver asignadas" ON obras
  FOR SELECT USING (user_has_access_to_obra(id));

CREATE POLICY "obras: crear (admin/gerente)" ON obras
  FOR INSERT WITH CHECK (
    (SELECT rol FROM profiles WHERE id = auth.uid()) IN ('admin', 'gerente')
  );

CREATE POLICY "obras: editar (admin/gerente)" ON obras
  FOR UPDATE USING (
    (SELECT rol FROM profiles WHERE id = auth.uid()) IN ('admin', 'gerente')
  );

-- ── OBRA_USUARIOS ────────────────────────────────────────────────────
ALTER TABLE obra_usuarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "obra_usuarios: ver asignaciones propias" ON obra_usuarios
  FOR SELECT USING (
    usuario_id = auth.uid()
    OR (SELECT rol FROM profiles WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "obra_usuarios: admin gestiona" ON obra_usuarios
  FOR ALL USING (
    (SELECT rol FROM profiles WHERE id = auth.uid()) = 'admin'
  );

-- ── PERSONAL ─────────────────────────────────────────────────────────
ALTER TABLE personal ENABLE ROW LEVEL SECURITY;

CREATE POLICY "personal: ver por obra" ON personal
  FOR SELECT USING (user_has_access_to_obra(obra_id));

CREATE POLICY "personal: crear (roles con acceso)" ON personal
  FOR INSERT WITH CHECK (
    user_has_access_to_obra(obra_id)
    AND user_rol_in_obra(obra_id) IN ('admin', 'gerente', 'ingeniero_residente', 'asistente_admin')
  );

CREATE POLICY "personal: editar (roles con acceso)" ON personal
  FOR UPDATE USING (
    user_has_access_to_obra(obra_id)
    AND user_rol_in_obra(obra_id) IN ('admin', 'gerente', 'ingeniero_residente', 'asistente_admin')
  );

-- ── MATERIALES ───────────────────────────────────────────────────────
ALTER TABLE materiales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "materiales: ver por obra" ON materiales
  FOR SELECT USING (user_has_access_to_obra(obra_id));

CREATE POLICY "materiales: gestionar (almacenero+)" ON materiales
  FOR ALL USING (
    user_has_access_to_obra(obra_id)
    AND user_rol_in_obra(obra_id) IN ('admin', 'gerente', 'ingeniero_residente', 'almacenero')
  );

-- ── HERRAMIENTAS ─────────────────────────────────────────────────────
ALTER TABLE herramientas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "herramientas: ver por obra" ON herramientas
  FOR SELECT USING (user_has_access_to_obra(obra_id));

CREATE POLICY "herramientas: gestionar (supervisor+)" ON herramientas
  FOR ALL USING (
    user_has_access_to_obra(obra_id)
    AND user_rol_in_obra(obra_id) IN ('admin', 'gerente', 'ingeniero_residente', 'supervisor', 'almacenero')
  );

-- ── MOVIMIENTOS_MATERIALES ────────────────────────────────────────────
ALTER TABLE movimientos_materiales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mov_materiales: ver por obra" ON movimientos_materiales
  FOR SELECT USING (user_has_access_to_obra(obra_id));

CREATE POLICY "mov_materiales: registrar (supervisor+almacenero)" ON movimientos_materiales
  FOR INSERT WITH CHECK (
    user_has_access_to_obra(obra_id)
    AND user_rol_in_obra(obra_id) IN ('admin', 'supervisor', 'almacenero', 'ingeniero_residente')
  );

-- ── MOVIMIENTOS_HERRAMIENTAS ──────────────────────────────────────────
ALTER TABLE movimientos_herramientas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mov_herramientas: ver por obra" ON movimientos_herramientas
  FOR SELECT USING (user_has_access_to_obra(obra_id));

CREATE POLICY "mov_herramientas: registrar (supervisor+almacenero)" ON movimientos_herramientas
  FOR INSERT WITH CHECK (
    user_has_access_to_obra(obra_id)
    AND user_rol_in_obra(obra_id) IN ('admin', 'supervisor', 'almacenero', 'ingeniero_residente')
  );

-- ── ASISTENCIA ────────────────────────────────────────────────────────
ALTER TABLE asistencia ENABLE ROW LEVEL SECURITY;

CREATE POLICY "asistencia: ver por obra" ON asistencia
  FOR SELECT USING (user_has_access_to_obra(obra_id));

CREATE POLICY "asistencia: registrar (todos excepto solo_lectura)" ON asistencia
  FOR INSERT WITH CHECK (
    user_has_access_to_obra(obra_id)
    AND user_rol_in_obra(obra_id) != 'solo_lectura'
    AND user_rol_in_obra(obra_id) != 'sin_acceso'
  );

CREATE POLICY "asistencia: editar propios o supervisor+" ON asistencia
  FOR UPDATE USING (
    user_has_access_to_obra(obra_id)
    AND (
      created_by = auth.uid()
      OR user_rol_in_obra(obra_id) IN ('admin', 'gerente', 'ingeniero_residente', 'supervisor', 'asistente_admin')
    )
  );

-- ── PARTIDAS ──────────────────────────────────────────────────────────
ALTER TABLE partidas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "partidas: ver por obra" ON partidas
  FOR SELECT USING (user_has_access_to_obra(obra_id));

CREATE POLICY "partidas: editar (ing.residente+)" ON partidas
  FOR ALL USING (
    user_has_access_to_obra(obra_id)
    AND user_rol_in_obra(obra_id) IN ('admin', 'gerente', 'ingeniero_residente')
  );

-- ── AVANCE_OBRA ───────────────────────────────────────────────────────
ALTER TABLE avance_obra ENABLE ROW LEVEL SECURITY;

CREATE POLICY "avance: ver por obra" ON avance_obra
  FOR SELECT USING (user_has_access_to_obra(obra_id));

CREATE POLICY "avance: registrar (supervisor+)" ON avance_obra
  FOR INSERT WITH CHECK (
    user_has_access_to_obra(obra_id)
    AND user_rol_in_obra(obra_id) IN ('admin', 'gerente', 'ingeniero_residente', 'supervisor')
  );

-- ── INSUMOS_PARTIDA, CRONOGRAMA (solo lectura para no-admin) ─────────
ALTER TABLE insumos_partida ENABLE ROW LEVEL SECURITY;
CREATE POLICY "insumos: ver por obra" ON insumos_partida
  FOR SELECT USING (user_has_access_to_obra(obra_id));
CREATE POLICY "insumos: editar (ing.residente+)" ON insumos_partida
  FOR ALL USING (
    user_has_access_to_obra(obra_id)
    AND user_rol_in_obra(obra_id) IN ('admin', 'gerente', 'ingeniero_residente')
  );

ALTER TABLE cronograma ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cronograma: ver por obra" ON cronograma
  FOR SELECT USING (user_has_access_to_obra(obra_id));
CREATE POLICY "cronograma: editar (ing.residente+)" ON cronograma
  FOR ALL USING (
    user_has_access_to_obra(obra_id)
    AND user_rol_in_obra(obra_id) IN ('admin', 'gerente', 'ingeniero_residente')
  );

-- ── EVIDENCIAS ────────────────────────────────────────────────────────
ALTER TABLE evidencias ENABLE ROW LEVEL SECURITY;
CREATE POLICY "evidencias: ver por obra" ON evidencias
  FOR SELECT USING (user_has_access_to_obra(obra_id));
CREATE POLICY "evidencias: subir (todos excepto solo_lectura)" ON evidencias
  FOR INSERT WITH CHECK (
    user_has_access_to_obra(obra_id)
    AND user_rol_in_obra(obra_id) != 'solo_lectura'
  );

-- ── INCIDENCIAS ───────────────────────────────────────────────────────
ALTER TABLE incidencias ENABLE ROW LEVEL SECURITY;
CREATE POLICY "incidencias: ver por obra" ON incidencias
  FOR SELECT USING (user_has_access_to_obra(obra_id));
CREATE POLICY "incidencias: crear (todos excepto solo_lectura)" ON incidencias
  FOR INSERT WITH CHECK (
    user_has_access_to_obra(obra_id)
    AND user_rol_in_obra(obra_id) != 'solo_lectura'
  );
CREATE POLICY "incidencias: actualizar estado (supervisor+)" ON incidencias
  FOR UPDATE USING (
    user_has_access_to_obra(obra_id)
    AND user_rol_in_obra(obra_id) IN ('admin', 'gerente', 'ingeniero_residente', 'supervisor')
  );

-- ── PROVEEDORES (global, cualquier usuario autenticado) ──────────────
ALTER TABLE proveedores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "proveedores: ver todos" ON proveedores
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "proveedores: gestionar (admin+gerente)" ON proveedores
  FOR ALL USING (
    (SELECT rol FROM profiles WHERE id = auth.uid()) IN ('admin', 'gerente', 'asistente_admin')
  );

-- ── SYNC_LOG (solo admins) ────────────────────────────────────────────
ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sync_log: solo admin" ON sync_log
  FOR ALL USING (
    (SELECT rol FROM profiles WHERE id = auth.uid()) = 'admin'
  );
-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Triggers de negocio
-- ═══════════════════════════════════════════════════════════════════

-- ── Trigger: actualizar stock de material tras movimiento ─────────────

CREATE OR REPLACE FUNCTION recalcular_stock_material()
RETURNS TRIGGER AS $$
DECLARE
  v_delta NUMERIC;
BEGIN
  -- Determinar delta según tipo de movimiento
  v_delta := CASE NEW.tipo_movimiento
    WHEN 'entrada'    THEN  NEW.cantidad
    WHEN 'devolucion' THEN  NEW.cantidad
    WHEN 'salida'     THEN -NEW.cantidad
    WHEN 'merma'      THEN -NEW.cantidad
    WHEN 'ajuste'     THEN  NEW.cantidad   -- positivo = suma, negativo = resta
    ELSE 0
  END;

  UPDATE materiales
  SET
    stock_actual   = stock_actual + v_delta,
    total_entradas = total_entradas + CASE WHEN v_delta > 0 THEN v_delta ELSE 0 END,
    total_salidas  = total_salidas  + CASE WHEN v_delta < 0 THEN -v_delta ELSE 0 END,
    -- Actualizar precio promedio ponderado si es entrada con precio
    precio_unitario_real_prom = CASE
      WHEN NEW.tipo_movimiento IN ('entrada', 'devolucion') AND NEW.precio_unitario_real IS NOT NULL
      THEN (
        (COALESCE(precio_unitario_real_prom, 0) * GREATEST(stock_actual, 0) + NEW.precio_unitario_real * NEW.cantidad)
        / GREATEST(stock_actual + v_delta, 1)
      )
      ELSE precio_unitario_real_prom
    END,
    -- Actualizar alerta
    alerta = CASE
      WHEN (stock_actual + v_delta) <= 0 THEN 'sin_stock'
      WHEN (stock_actual + v_delta) <= stock_minimo * 0.5 THEN 'critico'
      WHEN (stock_actual + v_delta) <= stock_minimo THEN 'reponer'
      ELSE 'ok'
    END,
    updated_at = now()
  WHERE id = NEW.material_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_stock_on_movimiento
  AFTER INSERT ON movimientos_materiales
  FOR EACH ROW EXECUTE FUNCTION recalcular_stock_material();

-- ── Trigger: actualizar disponibilidad de herramienta ─────────────────

CREATE OR REPLACE FUNCTION actualizar_disponibilidad_herramienta()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE herramientas
  SET
    disponible              = (NEW.accion IN ('entrada', 'reposicion')),
    ubicacion_actual        = CASE NEW.accion
                                WHEN 'salida'        THEN 'en_uso'
                                WHEN 'entrada'       THEN 'almacen'
                                WHEN 'mantenimiento' THEN 'mantenimiento'
                                WHEN 'baja'          THEN 'baja'
                                WHEN 'reposicion'    THEN 'almacen'
                                ELSE ubicacion_actual
                              END,
    ultimo_responsable_id   = NEW.responsable_id,
    fecha_ultimo_movimiento = NEW.fecha,
    updated_at              = now()
  WHERE id = NEW.herramienta_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_herramienta_on_movimiento
  AFTER INSERT ON movimientos_herramientas
  FOR EACH ROW EXECUTE FUNCTION actualizar_disponibilidad_herramienta();

-- ── Trigger: actualizar metrado_ejecutado y % avance en partida ───────

CREATE OR REPLACE FUNCTION actualizar_avance_partida()
RETURNS TRIGGER AS $$
DECLARE
  v_total_metrado NUMERIC;
  v_pct NUMERIC;
BEGIN
  SELECT COALESCE(SUM(metrado_ejecutado), 0)
  INTO v_total_metrado
  FROM avance_obra
  WHERE partida_id = NEW.partida_id;

  SELECT
    CASE
      WHEN metrado_contratado > 0
      THEN LEAST(ROUND((v_total_metrado / metrado_contratado) * 100, 2), 100)
      ELSE 0
    END
  INTO v_pct
  FROM partidas WHERE id = NEW.partida_id;

  UPDATE partidas
  SET
    metrado_ejecutado = v_total_metrado,
    porcentaje_avance = v_pct,
    estado = CASE
      WHEN v_pct >= 100 THEN 'terminado'
      WHEN v_pct > 0    THEN 'en_ejecucion'
      ELSE estado
    END,
    updated_at = now()
  WHERE id = NEW.partida_id;

  -- Actualizar avance físico global de la obra
  UPDATE obras o
  SET
    avance_fisico = (
      SELECT ROUND(AVG(p.porcentaje_avance), 2)
      FROM partidas p
      WHERE p.obra_id = o.id AND p.deleted_at IS NULL
    ),
    updated_at = now()
  WHERE o.id = NEW.obra_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_avance_on_registro
  AFTER INSERT OR UPDATE ON avance_obra
  FOR EACH ROW EXECUTE FUNCTION actualizar_avance_partida();

-- ── Trigger: auto-crear incidencia por conflicto de stock ─────────────

CREATE OR REPLACE FUNCTION detectar_stock_negativo()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT stock_actual FROM materiales WHERE id = NEW.material_id) < 0 THEN
    INSERT INTO incidencias (
      obra_id, tipo_incidencia, severidad, modulo_origen,
      registro_origen_id, descripcion, creado_por
    )
    VALUES (
      NEW.obra_id,
      'stock_conflicto',
      'alta',
      'movimientos_materiales',
      NEW.id,
      format('Stock negativo detectado en material %s tras movimiento de sincronización. Revisar y ajustar.', NEW.material_id::text),
      NEW.created_by
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_detectar_stock_negativo
  AFTER INSERT ON movimientos_materiales
  FOR EACH ROW EXECUTE FUNCTION detectar_stock_negativo();
-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Vistas y funciones para dashboards
-- ═══════════════════════════════════════════════════════════════════

-- ── Vista: KPIs por obra ──────────────────────────────────────────────
CREATE OR REPLACE VIEW v_dashboard_obra AS
SELECT
  o.id,
  o.nombre_obra,
  o.estado,
  o.avance_fisico,
  o.avance_financiero,
  o.presupuesto_total,
  o.costo_real_acumulado,
  ROUND(
    (o.costo_real_acumulado / NULLIF(o.presupuesto_total, 0)) * 100,
    1
  ) AS pct_presupuesto_usado,
  (SELECT COUNT(*) FROM personal p WHERE p.obra_id = o.id AND p.estado = 'activo' AND p.deleted_at IS NULL)
    AS personal_activo,
  (SELECT COUNT(*) FROM herramientas h WHERE h.obra_id = o.id AND h.ubicacion_actual = 'en_uso')
    AS herramientas_en_uso,
  (SELECT COUNT(*) FROM materiales m WHERE m.obra_id = o.id AND m.alerta IN ('critico','sin_stock') AND m.deleted_at IS NULL)
    AS materiales_en_alerta,
  (SELECT COUNT(*) FROM partidas pa WHERE pa.obra_id = o.id AND pa.estado = 'atrasado' AND pa.deleted_at IS NULL)
    AS partidas_atrasadas,
  (SELECT COUNT(*) FROM incidencias i WHERE i.obra_id = o.id AND i.estado = 'abierta')
    AS incidencias_abiertas
FROM obras o
WHERE o.deleted_at IS NULL;

-- ── Vista: Asistencia por obra y fecha ───────────────────────────────
CREATE OR REPLACE VIEW v_asistencia_resumen AS
SELECT
  a.obra_id,
  a.fecha,
  COUNT(*) AS total_registros,
  COUNT(*) FILTER (WHERE a.estado_asistencia = 'asistio')  AS asistieron,
  COUNT(*) FILTER (WHERE a.estado_asistencia = 'tardanza') AS tardanzas,
  COUNT(*) FILTER (WHERE a.estado_asistencia = 'falta')    AS faltas,
  COUNT(*) FILTER (WHERE a.estado_asistencia = 'permiso')  AS permisos,
  ROUND(
    COUNT(*) FILTER (WHERE a.estado_asistencia IN ('asistio','tardanza'))::NUMERIC / NULLIF(COUNT(*), 0) * 100,
    1
  ) AS pct_asistencia
FROM asistencia a
GROUP BY a.obra_id, a.fecha;

-- ── Vista: Estado del almacén por obra ───────────────────────────────
CREATE OR REPLACE VIEW v_almacen_resumen AS
SELECT
  m.obra_id,
  COUNT(*) AS total_materiales,
  COUNT(*) FILTER (WHERE m.alerta = 'ok')        AS materiales_ok,
  COUNT(*) FILTER (WHERE m.alerta = 'reponer')   AS materiales_reponer,
  COUNT(*) FILTER (WHERE m.alerta = 'critico')   AS materiales_critico,
  COUNT(*) FILTER (WHERE m.alerta = 'sin_stock') AS materiales_sin_stock,
  SUM(m.stock_actual * COALESCE(m.precio_unitario_real_prom, m.precio_unitario_estimado, 0))
    AS valor_inventario_total
FROM materiales m
WHERE m.deleted_at IS NULL
GROUP BY m.obra_id;

-- ── Vista: Comparativo planificado vs real por partida ────────────────
CREATE OR REPLACE VIEW v_comparativo_partidas AS
SELECT
  p.id,
  p.obra_id,
  p.nombre_partida,
  p.categoria,
  p.metrado_contratado,
  p.metrado_ejecutado,
  p.porcentaje_avance AS avance_real,
  c.avance_esperado,
  COALESCE(p.porcentaje_avance, 0) - COALESCE(c.avance_esperado, 0) AS desviacion_avance,
  p.costo_total_presupuestado,
  p.costo_real_acumulado,
  p.diferencia AS desviacion_costo,
  CASE
    WHEN p.diferencia > 0 THEN 'sobrecosto'
    WHEN p.diferencia < 0 THEN 'ahorro'
    ELSE 'dentro_presupuesto'
  END AS estado_costo,
  c.estado AS estado_cronograma
FROM partidas p
LEFT JOIN cronograma c ON c.partida_id = p.id
WHERE p.deleted_at IS NULL;

-- ── Función RPC: curva S (planificado vs ejecutado por semana) ────────
CREATE OR REPLACE FUNCTION fn_curva_s(p_obra_id UUID)
RETURNS TABLE (
  semana     TEXT,
  planificado NUMERIC,
  ejecutado   NUMERIC,
  acum_plan   NUMERIC,
  acum_real   NUMERIC
) AS $$
  WITH semanas AS (
    SELECT DISTINCT semana FROM avance_obra WHERE obra_id = p_obra_id AND semana IS NOT NULL
  ),
  pres_total AS (
    SELECT COALESCE(SUM(costo_total_presupuestado), 1) as total
    FROM partidas WHERE obra_id = p_obra_id AND deleted_at IS NULL
  ),
  real_por_semana AS (
    SELECT
      ao.semana AS sem,
      SUM(ao.metrado_ejecutado * COALESCE(p.precio_unitario_pres, 0)) AS costo_sem
    FROM avance_obra ao
    JOIN partidas p ON p.id = ao.partida_id
    WHERE ao.obra_id = p_obra_id
    GROUP BY ao.semana
  )
  SELECT
    s.semana,
    ROUND(pt.total / 20.0, 2) AS planificado,
    COALESCE(r.costo_sem, 0)  AS ejecutado,
    SUM(ROUND(pt.total / 20.0, 2)) OVER (ORDER BY s.semana) AS acum_plan,
    SUM(COALESCE(r.costo_sem, 0)) OVER (ORDER BY s.semana)  AS acum_real
  FROM semanas s
  CROSS JOIN pres_total pt
  LEFT JOIN real_por_semana r ON r.sem = s.semana
  ORDER BY s.semana
$$ LANGUAGE sql STABLE SECURITY DEFINER;
