// JARVEX — Catálogo de RUBROS de empresa (compartido).
// Vivía dentro de jx-contabilidad; se extrajo (sep-2026) para que el portal de
// captura de campo muestre el LABEL legible en el torpedo y el panel de
// configuración del admin edite el rubro sin abrir el form completo de
// Empresas. NO cambiar los valores `v`: están persistidos en companies.rubro.
export const RUBROS = [
  { v: 'importadora_acero',        label: 'Importadora · Acero / Fierro',         fam: 'acero' },
  { v: 'importadora_cemento',      label: 'Importadora · Cemento / Aglomerantes', fam: 'cemento' },
  { v: 'importadora_general',      label: 'Importadora · General',                fam: 'general' },
  { v: 'distribuidora_materiales', label: 'Distribuidora de Materiales',          fam: 'materiales' },
  { v: 'ferreteria',               label: 'Ferretería',                           fam: 'materiales' },
  { v: 'transporte',               label: 'Transporte / Flete',                   fam: 'transporte' },
  { v: 'alquiler_maquinaria',      label: 'Alquiler de Maquinaria',               fam: 'maquinaria' },
  { v: 'venta_maquinaria',         label: 'Venta de Maquinaria',                  fam: 'maquinaria' },
  { v: 'mano_obra',                label: 'Mano de Obra / Subcontratos',          fam: 'mano_obra' },
  { v: 'supervision',              label: 'Supervisión / Consultoría',            fam: 'servicios' },
  { v: 'estudios_proyectos',       label: 'Estudios y Proyectos',                 fam: 'servicios' },
  { v: 'ejecutora_obra',           label: 'Ejecutora de Obra (contratista)',      fam: 'ejecutora' },
  { v: 'contratista_general',      label: 'Contratista General',                  fam: 'ejecutora' },
  { v: 'inmobiliaria',             label: 'Inmobiliaria',                         fam: 'inmobiliaria' },
  { v: 'otro',                     label: 'Otro',                                 fam: 'otro' },
];

export const rubroLabel = (v) => RUBROS.find(r => r.v === v)?.label || v || '—';
