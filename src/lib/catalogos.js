// ═══════════════════════════════════════════════════════════════════
// JARVEX — Catálogos base estándar peruanos
// ═══════════════════════════════════════════════════════════════════
// Unidades de medida, categorías y materiales típicos de construcción
// civil en Perú (basado en S10/Delphin + práctica habitual CAPECO).
//
// Estos catálogos son la base. Admin puede agregar/editar; otros roles
// solicitan vía change_requests.
// ═══════════════════════════════════════════════════════════════════

// ─── UNIDADES DE MEDIDA ─────────────────────────────────────────────
export const UNIDADES_ESTANDAR = [
  // Longitud
  { codigo: 'm',   nombre: 'Metro lineal',   categoria: 'longitud' },
  { codigo: 'ml',  nombre: 'Metro lineal',   categoria: 'longitud' },
  { codigo: 'cm',  nombre: 'Centímetro',     categoria: 'longitud' },
  { codigo: 'mm',  nombre: 'Milímetro',      categoria: 'longitud' },
  { codigo: 'km',  nombre: 'Kilómetro',      categoria: 'longitud' },
  // Área
  { codigo: 'm²',  nombre: 'Metro cuadrado', categoria: 'area' },
  { codigo: 'm2',  nombre: 'Metro cuadrado', categoria: 'area' },
  { codigo: 'cm²', nombre: 'Cm cuadrado',    categoria: 'area' },
  // Volumen
  { codigo: 'm³',  nombre: 'Metro cúbico',   categoria: 'volumen' },
  { codigo: 'm3',  nombre: 'Metro cúbico',   categoria: 'volumen' },
  { codigo: 'L',   nombre: 'Litro',          categoria: 'volumen' },
  { codigo: 'gln', nombre: 'Galón',          categoria: 'volumen' },
  // Peso
  { codigo: 'kg',  nombre: 'Kilogramo',      categoria: 'peso' },
  { codigo: 't',   nombre: 'Tonelada',       categoria: 'peso' },
  { codigo: 'tn',  nombre: 'Tonelada',       categoria: 'peso' },
  { codigo: 'g',   nombre: 'Gramo',          categoria: 'peso' },
  // Conteo
  { codigo: 'und', nombre: 'Unidad',         categoria: 'conteo' },
  { codigo: 'pza', nombre: 'Pieza',          categoria: 'conteo' },
  { codigo: 'jgo', nombre: 'Juego',          categoria: 'conteo' },
  { codigo: 'set', nombre: 'Set',            categoria: 'conteo' },
  { codigo: 'par', nombre: 'Par',            categoria: 'conteo' },
  { codigo: 'doc', nombre: 'Docena',         categoria: 'conteo' },
  { codigo: 'mll', nombre: 'Millar',         categoria: 'conteo' },
  // Empaques
  { codigo: 'bls', nombre: 'Bolsa',          categoria: 'empaque' },
  { codigo: 'rll', nombre: 'Rollo',          categoria: 'empaque' },
  { codigo: 'cja', nombre: 'Caja',           categoria: 'empaque' },
  { codigo: 'plt', nombre: 'Pallet',         categoria: 'empaque' },
  // Trabajo / tiempo
  { codigo: 'glb', nombre: 'Global',         categoria: 'trabajo' },
  { codigo: 'hh',  nombre: 'Hora-hombre',    categoria: 'trabajo' },
  { codigo: 'hm',  nombre: 'Hora-máquina',   categoria: 'trabajo' },
  { codigo: 'día', nombre: 'Día',            categoria: 'tiempo' },
  { codigo: 'mes', nombre: 'Mes',            categoria: 'tiempo' },
  { codigo: 'vje', nombre: 'Viaje',          categoria: 'transporte' },
];

export const CATEGORIAS_UNIDAD_LABEL = {
  longitud: 'Longitud',
  area: 'Área',
  volumen: 'Volumen',
  peso: 'Peso',
  conteo: 'Conteo',
  empaque: 'Empaque',
  trabajo: 'Trabajo',
  tiempo: 'Tiempo',
  transporte: 'Transporte',
};

// ─── CATEGORÍAS DE MATERIAL ─────────────────────────────────────────
export const CATEGORIAS_MATERIAL = [
  'Cemento',
  'Acero',
  'Agregados',
  'Ladrillos',
  'Concreto',
  'Madera',
  'Eléctrico',
  'Sanitario',
  'Pintura',
  'Acabados',
  'Vidrio',
  'Aluminio',
  'Drywall',
  'Impermeabilizantes',
  'Adhesivos',
  'Ferretería',
  'Herramientas',
  'EPP / Seguridad',
  'Combustibles',
  'Encofrado',
  'Tuberías',
  'Cables',
  'Carpintería metálica',
  'Carpintería madera',
  'Coberturas',
  'Pegamentos',
  'General',
];

// ─── MATERIALES BASE PERÚ (catálogo típico construcción) ────────────
// Esta lista cubre los materiales más usados en constructoras peruanas.
// Cada material tiene nombre, unidad sugerida, categoría y precio
// estimado actualizado (2026 PEN). El usuario puede ajustar precios.
export const MATERIALES_BASE = [
  // Cemento
  { nombre: 'Cemento Portland Tipo I (bolsa 42.5 kg)', unidad: 'bls', categoria: 'Cemento', precio: 28.50 },
  { nombre: 'Cemento Portland Tipo IP (bolsa 42.5 kg)', unidad: 'bls', categoria: 'Cemento', precio: 30.00 },
  { nombre: 'Cemento Portland Tipo V (bolsa 42.5 kg)', unidad: 'bls', categoria: 'Cemento', precio: 35.00 },
  { nombre: 'Cemento blanco', unidad: 'bls', categoria: 'Cemento', precio: 65.00 },
  // Acero
  { nombre: 'Acero corrugado 1/4" Fy=4200 kg/cm²', unidad: 'kg', categoria: 'Acero', precio: 4.20 },
  { nombre: 'Acero corrugado 3/8" Fy=4200 kg/cm²', unidad: 'kg', categoria: 'Acero', precio: 4.20 },
  { nombre: 'Acero corrugado 1/2" Fy=4200 kg/cm²', unidad: 'kg', categoria: 'Acero', precio: 4.20 },
  { nombre: 'Acero corrugado 5/8" Fy=4200 kg/cm²', unidad: 'kg', categoria: 'Acero', precio: 4.20 },
  { nombre: 'Acero corrugado 3/4" Fy=4200 kg/cm²', unidad: 'kg', categoria: 'Acero', precio: 4.30 },
  { nombre: 'Acero corrugado 1" Fy=4200 kg/cm²', unidad: 'kg', categoria: 'Acero', precio: 4.50 },
  { nombre: 'Alambre N°16 (recocido)', unidad: 'kg', categoria: 'Acero', precio: 5.50 },
  { nombre: 'Alambre N°8 (negro)', unidad: 'kg', categoria: 'Acero', precio: 5.20 },
  { nombre: 'Malla electrosoldada Q-188 (4.5 m × 2.4 m)', unidad: 'und', categoria: 'Acero', precio: 95.00 },
  { nombre: 'Malla electrosoldada Q-257 (4.5 m × 2.4 m)', unidad: 'und', categoria: 'Acero', precio: 130.00 },
  // Agregados
  { nombre: 'Arena fina', unidad: 'm³', categoria: 'Agregados', precio: 65.00 },
  { nombre: 'Arena gruesa', unidad: 'm³', categoria: 'Agregados', precio: 70.00 },
  { nombre: 'Piedra chancada 1/2"', unidad: 'm³', categoria: 'Agregados', precio: 85.00 },
  { nombre: 'Piedra chancada 3/4"', unidad: 'm³', categoria: 'Agregados', precio: 85.00 },
  { nombre: 'Piedra chancada 1"', unidad: 'm³', categoria: 'Agregados', precio: 80.00 },
  { nombre: 'Hormigón', unidad: 'm³', categoria: 'Agregados', precio: 60.00 },
  { nombre: 'Confitillo', unidad: 'm³', categoria: 'Agregados', precio: 75.00 },
  { nombre: 'Afirmado', unidad: 'm³', categoria: 'Agregados', precio: 55.00 },
  { nombre: 'Material para base', unidad: 'm³', categoria: 'Agregados', precio: 45.00 },
  // Ladrillos
  { nombre: 'Ladrillo King Kong 18 huecos (9×13×24 cm)', unidad: 'mll', categoria: 'Ladrillos', precio: 850.00 },
  { nombre: 'Ladrillo Pandereta 5×9×24 cm', unidad: 'mll', categoria: 'Ladrillos', precio: 720.00 },
  { nombre: 'Ladrillo Hueco 12 (12×30×30)', unidad: 'mll', categoria: 'Ladrillos', precio: 1450.00 },
  { nombre: 'Ladrillo Hueco 15 (15×30×30)', unidad: 'mll', categoria: 'Ladrillos', precio: 1650.00 },
  { nombre: 'Ladrillo Caravista', unidad: 'mll', categoria: 'Ladrillos', precio: 1850.00 },
  { nombre: 'Bloque concreto P-7 (9×19×39)', unidad: 'und', categoria: 'Ladrillos', precio: 2.20 },
  { nombre: 'Bloque concreto P-10 (12×19×39)', unidad: 'und', categoria: 'Ladrillos', precio: 2.80 },
  // Concreto / aditivos
  { nombre: 'Concreto premezclado f\'c=210 kg/cm²', unidad: 'm³', categoria: 'Concreto', precio: 295.00 },
  { nombre: 'Concreto premezclado f\'c=280 kg/cm²', unidad: 'm³', categoria: 'Concreto', precio: 320.00 },
  { nombre: 'Concreto premezclado f\'c=350 kg/cm²', unidad: 'm³', categoria: 'Concreto', precio: 360.00 },
  { nombre: 'Aditivo plastificante (Sika)', unidad: 'gln', categoria: 'Concreto', precio: 95.00 },
  { nombre: 'Aditivo acelerante', unidad: 'gln', categoria: 'Concreto', precio: 110.00 },
  { nombre: 'Aditivo impermeabilizante (Sika 1)', unidad: 'gln', categoria: 'Concreto', precio: 75.00 },
  // Madera y encofrado
  { nombre: 'Madera tornillo 2"×6"×10\'', unidad: 'und', categoria: 'Madera', precio: 32.00 },
  { nombre: 'Madera tornillo 2"×4"×10\'', unidad: 'und', categoria: 'Madera', precio: 22.00 },
  { nombre: 'Madera tornillo 2"×3"×10\'', unidad: 'und', categoria: 'Madera', precio: 16.00 },
  { nombre: 'Madera tornillo 2"×2"×10\'', unidad: 'und', categoria: 'Madera', precio: 11.00 },
  { nombre: 'Triplay fenólico 18 mm (1.22×2.44)', unidad: 'und', categoria: 'Encofrado', precio: 165.00 },
  { nombre: 'Triplay 4 mm (1.22×2.44)', unidad: 'und', categoria: 'Madera', precio: 38.00 },
  { nombre: 'Estaca de madera 1.50 m', unidad: 'und', categoria: 'Madera', precio: 4.50 },
  // Eléctrico
  { nombre: 'Cable THW 14 AWG', unidad: 'm', categoria: 'Eléctrico', precio: 1.80 },
  { nombre: 'Cable THW 12 AWG', unidad: 'm', categoria: 'Eléctrico', precio: 2.50 },
  { nombre: 'Cable THW 10 AWG', unidad: 'm', categoria: 'Eléctrico', precio: 3.80 },
  { nombre: 'Cable THW 8 AWG', unidad: 'm', categoria: 'Eléctrico', precio: 5.80 },
  { nombre: 'Cable NYY 3×2.5 mm²', unidad: 'm', categoria: 'Eléctrico', precio: 6.50 },
  { nombre: 'Tubería SAP 3/4" (3 m)', unidad: 'und', categoria: 'Eléctrico', precio: 4.50 },
  { nombre: 'Tubería SEL 1/2" (3 m)', unidad: 'und', categoria: 'Eléctrico', precio: 3.20 },
  { nombre: 'Caja rectangular 2"×4"×1 7/8"', unidad: 'und', categoria: 'Eléctrico', precio: 2.50 },
  { nombre: 'Caja octogonal 4"×4"', unidad: 'und', categoria: 'Eléctrico', precio: 2.20 },
  { nombre: 'Tomacorriente doble + placa', unidad: 'und', categoria: 'Eléctrico', precio: 18.00 },
  { nombre: 'Interruptor simple + placa', unidad: 'und', categoria: 'Eléctrico', precio: 12.50 },
  { nombre: 'Llave termomagnética 2×16 A', unidad: 'und', categoria: 'Eléctrico', precio: 28.00 },
  { nombre: 'Llave termomagnética 2×32 A', unidad: 'und', categoria: 'Eléctrico', precio: 38.00 },
  { nombre: 'Llave diferencial 2×40 A 30 mA', unidad: 'und', categoria: 'Eléctrico', precio: 95.00 },
  { nombre: 'Tablero distribución 12 polos', unidad: 'und', categoria: 'Eléctrico', precio: 145.00 },
  // Sanitario / plomería
  { nombre: 'Tubería PVC SAP 4" Clase 7.5 (5 m)', unidad: 'und', categoria: 'Sanitario', precio: 35.00 },
  { nombre: 'Tubería PVC SAP 2" Clase 10 (5 m)', unidad: 'und', categoria: 'Sanitario', precio: 18.00 },
  { nombre: 'Tubería PVC SAP 1/2" Clase 10 (5 m)', unidad: 'und', categoria: 'Sanitario', precio: 8.50 },
  { nombre: 'Tubería PVC SAP 3/4" Clase 10 (5 m)', unidad: 'und', categoria: 'Sanitario', precio: 11.50 },
  { nombre: 'Codo PVC 90° 4"', unidad: 'und', categoria: 'Sanitario', precio: 8.50 },
  { nombre: 'Codo PVC 90° 1/2"', unidad: 'und', categoria: 'Sanitario', precio: 1.80 },
  { nombre: 'Tee PVC 1/2"', unidad: 'und', categoria: 'Sanitario', precio: 2.20 },
  { nombre: 'Pegamento PVC oatey 1/4 gln', unidad: 'und', categoria: 'Sanitario', precio: 28.00 },
  { nombre: 'Cinta teflón', unidad: 'und', categoria: 'Sanitario', precio: 3.50 },
  { nombre: 'Inodoro one-piece blanco', unidad: 'und', categoria: 'Sanitario', precio: 320.00 },
  { nombre: 'Lavatorio empotrar blanco', unidad: 'und', categoria: 'Sanitario', precio: 180.00 },
  { nombre: 'Mezcladora ducha 8" cromada', unidad: 'und', categoria: 'Sanitario', precio: 165.00 },
  // Pintura
  { nombre: 'Pintura látex blanca (4 gln)', unidad: 'und', categoria: 'Pintura', precio: 145.00 },
  { nombre: 'Pintura látex base (1 gln)', unidad: 'gln', categoria: 'Pintura', precio: 38.00 },
  { nombre: 'Pintura esmalte sintético (1 gln)', unidad: 'gln', categoria: 'Pintura', precio: 65.00 },
  { nombre: 'Imprimante PVA (4 gln)', unidad: 'und', categoria: 'Pintura', precio: 95.00 },
  { nombre: 'Pintura epóxica piso (1 gln)', unidad: 'gln', categoria: 'Pintura', precio: 145.00 },
  { nombre: 'Lija al agua N°150', unidad: 'und', categoria: 'Pintura', precio: 1.20 },
  { nombre: 'Brocha 4"', unidad: 'und', categoria: 'Pintura', precio: 12.00 },
  { nombre: 'Rodillo + cuba 9"', unidad: 'jgo', categoria: 'Pintura', precio: 18.00 },
  // Acabados
  { nombre: 'Cerámico piso 45×45 (m²)', unidad: 'm²', categoria: 'Acabados', precio: 38.00 },
  { nombre: 'Cerámico pared 30×60 (m²)', unidad: 'm²', categoria: 'Acabados', precio: 42.00 },
  { nombre: 'Porcelanato pulido 60×60 (m²)', unidad: 'm²', categoria: 'Acabados', precio: 95.00 },
  { nombre: 'Pegamento cerámico (bls 25 kg)', unidad: 'bls', categoria: 'Adhesivos', precio: 28.00 },
  { nombre: 'Fragua Celima blanco (kg)', unidad: 'kg', categoria: 'Adhesivos', precio: 8.50 },
  { nombre: 'Yeso (bls 18 kg)', unidad: 'bls', categoria: 'Acabados', precio: 12.00 },
  { nombre: 'Drywall 1/2" estándar (1.22×2.44)', unidad: 'und', categoria: 'Drywall', precio: 28.00 },
  { nombre: 'Drywall 5/8" RH (resistente humedad)', unidad: 'und', categoria: 'Drywall', precio: 38.00 },
  { nombre: 'Tornillo drywall 1" (caja 1000)', unidad: 'cja', categoria: 'Drywall', precio: 35.00 },
  { nombre: 'Perfil drywall canal 89 mm', unidad: 'und', categoria: 'Drywall', precio: 18.00 },
  { nombre: 'Perfil drywall parante 89 mm', unidad: 'und', categoria: 'Drywall', precio: 16.00 },
  // Vidrio / aluminio
  { nombre: 'Vidrio crudo 6 mm (m²)', unidad: 'm²', categoria: 'Vidrio', precio: 95.00 },
  { nombre: 'Vidrio templado 8 mm (m²)', unidad: 'm²', categoria: 'Vidrio', precio: 195.00 },
  { nombre: 'Aluminio serie 25 (m)', unidad: 'm', categoria: 'Aluminio', precio: 12.00 },
  // Coberturas / impermeabilizantes
  { nombre: 'Calamina galvanizada 0.30 mm (1.83×0.83)', unidad: 'und', categoria: 'Coberturas', precio: 32.00 },
  { nombre: 'Tejado teja andina (m²)', unidad: 'm²', categoria: 'Coberturas', precio: 38.00 },
  { nombre: 'Manto asfáltico 4 mm (m²)', unidad: 'm²', categoria: 'Impermeabilizantes', precio: 28.00 },
  { nombre: 'Imprimante asfáltico (gln)', unidad: 'gln', categoria: 'Impermeabilizantes', precio: 35.00 },
  // Ferretería
  { nombre: 'Clavo 2"', unidad: 'kg', categoria: 'Ferretería', precio: 5.50 },
  { nombre: 'Clavo 3"', unidad: 'kg', categoria: 'Ferretería', precio: 5.50 },
  { nombre: 'Clavo 4"', unidad: 'kg', categoria: 'Ferretería', precio: 5.50 },
  { nombre: 'Tornillo autorroscante 1.5"', unidad: 'kg', categoria: 'Ferretería', precio: 12.00 },
  { nombre: 'Bisagra cromada 4"', unidad: 'pza', categoria: 'Ferretería', precio: 8.00 },
  { nombre: 'Cerradura puerta principal', unidad: 'und', categoria: 'Ferretería', precio: 95.00 },
  { nombre: 'Pico minero', unidad: 'und', categoria: 'Herramientas', precio: 38.00 },
  { nombre: 'Pala recta', unidad: 'und', categoria: 'Herramientas', precio: 32.00 },
  { nombre: 'Carretilla buggy', unidad: 'und', categoria: 'Herramientas', precio: 195.00 },
  { nombre: 'Cono de seguridad 70 cm', unidad: 'und', categoria: 'EPP / Seguridad', precio: 35.00 },
  // EPP
  { nombre: 'Casco amarillo (con barbiquejo)', unidad: 'und', categoria: 'EPP / Seguridad', precio: 28.00 },
  { nombre: 'Lentes de seguridad', unidad: 'und', categoria: 'EPP / Seguridad', precio: 12.00 },
  { nombre: 'Guantes de cuero', unidad: 'par', categoria: 'EPP / Seguridad', precio: 18.00 },
  { nombre: 'Guantes de badana', unidad: 'par', categoria: 'EPP / Seguridad', precio: 8.50 },
  { nombre: 'Botas punta de acero', unidad: 'par', categoria: 'EPP / Seguridad', precio: 145.00 },
  { nombre: 'Chaleco reflectivo', unidad: 'und', categoria: 'EPP / Seguridad', precio: 22.00 },
  { nombre: 'Tapón auditivo', unidad: 'par', categoria: 'EPP / Seguridad', precio: 4.00 },
  { nombre: 'Mascarilla 3M N95', unidad: 'und', categoria: 'EPP / Seguridad', precio: 8.50 },
  { nombre: 'Arnés de seguridad', unidad: 'und', categoria: 'EPP / Seguridad', precio: 165.00 },
  // Combustibles
  { nombre: 'Petróleo Diesel B5 (gln)', unidad: 'gln', categoria: 'Combustibles', precio: 18.50 },
  { nombre: 'Gasolina 90 (gln)', unidad: 'gln', categoria: 'Combustibles', precio: 18.00 },
  { nombre: 'GLP cilindro 10 kg', unidad: 'und', categoria: 'Combustibles', precio: 65.00 },
];

// ─── HELPERS ────────────────────────────────────────────────────────
const STORAGE_KEY_UNIDADES   = 'jx_catalogo_unidades_custom';
const STORAGE_KEY_MATERIALES = 'jx_catalogo_materiales_custom';
const STORAGE_KEY_CATEGORIAS = 'jx_catalogo_categorias_custom';

export function loadCustomUnidades() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_UNIDADES) || '[]'); }
  catch { return []; }
}
export function saveCustomUnidades(arr) {
  try { localStorage.setItem(STORAGE_KEY_UNIDADES, JSON.stringify(arr)); }
  catch {}
}
export function loadCustomCategorias() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_CATEGORIAS) || '[]'); }
  catch { return []; }
}
export function saveCustomCategorias(arr) {
  try { localStorage.setItem(STORAGE_KEY_CATEGORIAS, JSON.stringify(arr)); }
  catch {}
}
export function loadCustomMateriales() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_MATERIALES) || '[]'); }
  catch { return []; }
}
export function saveCustomMateriales(arr) {
  try { localStorage.setItem(STORAGE_KEY_MATERIALES, JSON.stringify(arr)); }
  catch {}
}

// Devuelve unidades estándar + custom (deduplicado por código)
export function getAllUnidades() {
  const base = UNIDADES_ESTANDAR;
  const custom = loadCustomUnidades();
  const codigos = new Set(base.map(u => u.codigo));
  return [...base, ...custom.filter(u => !codigos.has(u.codigo))];
}

export function getAllCategorias() {
  return [...new Set([...CATEGORIAS_MATERIAL, ...loadCustomCategorias()])];
}

// Para autocompletar materiales en formularios. La lista combina la base
// estándar + custom + lo que venga de la DB de la obra (por hooks).
export function getMaterialesBase() {
  return [...MATERIALES_BASE, ...loadCustomMateriales()];
}
