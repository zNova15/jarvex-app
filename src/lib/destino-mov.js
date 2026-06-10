// Fase B — atribuir cada movimiento de insumos a un personal O a un subcontrato
// con UN solo selector. El value combinado codifica el tipo:
//   'sub:<id>'  → subcontrato (subcontratista_id)
//   '<id>'      → personal (responsable_id)
// splitDestino() lo descompone en las columnas reales del movimiento, joinDestino()
// hace lo inverso (para precargar el selector en edición). Así eliminamos el texto
// libre como destino: la almacenera elige persona o subcontrato, nunca escribe un
// nombre ficticio.

export const SUB_PREFIX = 'sub:';

// Etiqueta de una persona para selectores: nombre + «alias» + (cargo) +
// subcontrato. En obra se ubica a la gente por apodo y cargo ("Raúl Díaz
// (Obrero) · Subcontrato JUAN"), y SearchableSelect busca por label — así
// alias y cargo quedan buscables sin tocar el componente.
export function etiquetaPersona(p, subName = null) {
  const nombre = `${p.nombres || ''} ${p.apellidos || ''}`.trim();
  const alias = p.alias ? ` «${p.alias}»` : '';
  const cargo = p.cargo ? ` (${p.cargo})` : '';
  const sub = p.subcontratista_id
    ? ` · ${(subName && subName.get(p.subcontratista_id)) || 'subcontrato'}`
    : '';
  return `${nombre}${alias}${cargo}${sub}`;
}

// Opciones para un selector combinado: personal (activo) + subcontratistas.
// Devuelve { personas, subs } por si se quieren mostrar agrupados; o usar
// [...personas, ...subs] como lista plana.
export function opcionesDestino(personalActivos = [], subcontratistas = []) {
  const subName = new Map((subcontratistas || []).map(s => [s.id, s.razon_social]));
  const personas = (personalActivos || []).map(p => ({
    value: p.id,
    label: etiquetaPersona(p, subName),
  }));
  const subs = (subcontratistas || [])
    .filter(s => !s.deleted_at && s.estado !== 'bloqueado')
    .map(s => ({ value: SUB_PREFIX + s.id, label: `${s.razon_social} (subcontrato)` }));
  return { personas, subs };
}

// Lista plana lista para <select>/SearchableSelect.
export function opcionesDestinoFlat(personalActivos = [], subcontratistas = []) {
  const { personas, subs } = opcionesDestino(personalActivos, subcontratistas);
  return [...personas, ...subs];
}

// value combinado → columnas reales del movimiento.
export function splitDestino(value) {
  if (!value) return { responsable_id: null, subcontratista_id: null, destino_tipo: null };
  const v = String(value);
  if (v.startsWith(SUB_PREFIX)) {
    return { responsable_id: null, subcontratista_id: v.slice(SUB_PREFIX.length), destino_tipo: 'subcontratista' };
  }
  return { responsable_id: value, subcontratista_id: null, destino_tipo: 'personal' };
}

// columnas reales del movimiento → value combinado (precargar selector al editar).
export function joinDestino(mov) {
  if (!mov) return '';
  if (mov.subcontratista_id) return SUB_PREFIX + mov.subcontratista_id;
  return mov.responsable_id || '';
}

// Nombre legible del destino de un movimiento (persona o subcontrato).
export function nombreDestinoMov(mov, personalById, subsById) {
  if (!mov) return '—';
  if (mov.subcontratista_id) {
    const s = subsById?.get?.(mov.subcontratista_id);
    return s ? `${s.razon_social} (subcontrato)` : '(subcontrato)';
  }
  if (mov.responsable_id) {
    const p = personalById?.get?.(mov.responsable_id);
    return p ? `${p.nombres} ${p.apellidos || ''}`.trim() : '—';
  }
  return '—';
}
