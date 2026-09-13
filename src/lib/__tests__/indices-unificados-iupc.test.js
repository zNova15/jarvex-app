import { describe, it, expect } from 'vitest';
import {
  IUPC_CODIGOS,
  IUPC_POR_CODIGO,
  REAGRUPACIONES_IUPC,
  CATEGORIAS_COMPLEMENTARIAS,
  listarCategoriasDisponibles,
  etiquetaCategoria,
  bandaConfianza,
  detectarServicio,
  clasificarConIUPC,
  tipoDeCategoria,
  gastoDeCategoria,
} from '../indices-unificados-iupc.js';

describe('indices-unificados-iupc — R.J. Nº 016-2026-INEI', () => {
  it('contiene los códigos oficiales requeridos', () => {
    expect(IUPC_POR_CODIGO.has('01')).toBe(true);
    expect(IUPC_POR_CODIGO.has('03')).toBe(true);
    expect(IUPC_POR_CODIGO.has('21')).toBe(true);
    expect(IUPC_POR_CODIGO.has('47-1')).toBe(true);
    expect(IUPC_POR_CODIGO.has('81')).toBe(true);
    expect(IUPC_POR_CODIGO.has('83')).toBe(true);
    expect(IUPC_POR_CODIGO.has('95')).toBe(true);
    expect(IUPC_CODIGOS.length).toBeGreaterThanOrEqual(70);
  });

  it('resuelve las reagrupaciones oficiales de la norma', () => {
    expect(REAGRUPACIONES_IUPC['22']).toBe('21'); // Cemento tipo II -> Cemento Portland e hidráulico
    expect(REAGRUPACIONES_IUPC['23']).toBe('21'); // Cemento tipo V -> Cemento Portland e hidráulico
    expect(REAGRUPACIONES_IUPC['45']).toBe('44'); // Madera terciada para encofrado -> Madera terciada nacional
    expect(REAGRUPACIONES_IUPC['64']).toBe('40'); // Terrazo -> Loseta y terrazo
    expect(REAGRUPACIONES_IUPC['69']).toBe('31'); // Tub. conc. simple -> Prefabricado de concreto
    expect(REAGRUPACIONES_IUPC['70']).toBe('31'); // Tub. conc. reforzado -> Prefabricado de concreto
    expect(REAGRUPACIONES_IUPC['73']).toBe('72'); // Ducto telefónico PVC -> Tub. PVC redes interiores
  });

  it('etiquetaCategoria formatea códigos IUPC y complementarios', () => {
    expect(etiquetaCategoria('03')).toContain('Acero de construcción corrugado');
    expect(etiquetaCategoria('22')).toContain('Cemento Portland e hidráulico'); // aplica reagrupación a 21
    expect(etiquetaCategoria('servicios')).toBe('Servicios en general');
    expect(etiquetaCategoria('administrativos')).toBe('Consumos administrativos / Oficina');
    expect(etiquetaCategoria('sin_clasificar')).toContain('Sin clasificar');
  });

  it('bandaConfianza segmenta exactamente en los 5 rangos pedidos', () => {
    expect(bandaConfianza(0.85).slug).toBe('alta');         // >= 70%
    expect(bandaConfianza(0.55).slug).toBe('media');        // 40% - 69%
    expect(bandaConfianza(0.35).slug).toBe('baja');         // 25% - 39%
    expect(bandaConfianza(0.18).slug).toBe('rara');         // 10% - 24%
    expect(bandaConfianza(0.05).slug).toBe('extrema_baja'); // < 10%
  });

  // ── LO QUE CONSUME LA UI ─────────────────────────────────────────
  // Los dos de acá abajo son guardas de bugs reales, no adorno.

  it('cada categoría del desplegable trae `label` (el <option> lee ESE campo)', () => {
    const cats = listarCategoriasDisponibles();
    expect(cats.length).toBeGreaterThan(70);
    // El JSX pedía `nombreCompleto`, que no existe → 80 opciones EN BLANCO.
    expect(cats.every(c => typeof c.label === 'string' && c.label.length > 0)).toBe(true);
    expect(cats.every(c => typeof c.codigo === 'string' && c.codigo.length > 0)).toBe(true);
    expect(cats.every(c => typeof c.grupo === 'string' && c.grupo.length > 0)).toBe(true);
  });

  it('`banda` es el SLUG (string), no el objeto — los badges lo indexan', () => {
    const r = clasificarConIUPC('CEMENTO PORTLAND TIPO I');
    expect(typeof r.banda).toBe('string');
    expect(['alta', 'media', 'baja', 'rara', 'extrema_baja']).toContain(r.banda);
    // El objeto completo sigue disponible aparte, para quien lo necesite.
    expect(r.bandaInfo.slug).toBe(r.banda);
    expect(r.bandaInfo.color).toBeTruthy();
  });

  // ── SERVICIOS ────────────────────────────────────────────────────

  it('detecta servicios con inclinación (ejemplo alquiler de retroexcavadora)', () => {
    const s1 = detectarServicio('ALQUILER DE RETROEXCAVADORA ORUGA');
    expect(s1).not.toBeNull();
    expect(s1.categoriaRecomendada).toBe('servicios');
    expect(s1.iupcRelacionado).toBe('49');
    expect(s1.inclinacion).toContain('49');

    const s2 = detectarServicio('SERVICIO DE FLETE DE MATERIALES');
    expect(s2).not.toBeNull();
    expect(s2.categoriaRecomendada).toBe('servicios');
    expect(s2.iupcRelacionado).toBe('32');
  });

  it('NO convierte materiales en servicios por una palabra suelta', () => {
    // Los tres casos salen de facturas reales y los tres caían en «servicios»
    // con score 0,85 —banda ALTA— por contener «instalacion» o «limpieza».
    for (const t of [
      'TUBERIA PVC-U 160MM PARA INSTALACION DE ALCANTARILLADO',
      'ESCOBA DE LIMPIEZA INDUSTRIAL',
      'KIT DE INSTALACION SANITARIA',
    ]) {
      expect(detectarServicio(t), t).toBeNull();
      expect(clasificarConIUPC(t).codigo, t).not.toBe('servicios');
    }
  });

  it('el score de un servicio refleja la fuerza de la evidencia', () => {
    // Antes TODAS las ramas devolvían 0,85: la regla más débil era la que más
    // seguridad aparentaba y la banda no servía para triar nada.
    const fuerte = clasificarConIUPC('ALQUILER DE RETROEXCAVADORA ORUGA');
    const debil = clasificarConIUPC('SERVICIO DE ALGO NO ESPECIFICADO');
    expect(fuerte.codigo).toBe('servicios');
    expect(debil.codigo).toBe('servicios');
    expect(fuerte.score).toBeGreaterThan(debil.score);
    expect(fuerte.banda).toBe('alta');
    expect(debil.banda).not.toBe('alta');
  });

  it('el Diccionario Oficial le gana a la heurística de servicios', () => {
    const c = clasificarConIUPC('CEMENTO PORTLAND TIPO I');
    expect(c.codigo).toBe('21');
    expect(c.motivos[0]).toContain('Diccionario Oficial');
  });

  // ── COBERTURA ────────────────────────────────────────────────────

  it('clasifica insumos exactos del Diccionario Oficial con alta confianza', () => {
    const c1 = clasificarConIUPC('CEMENTO PORTLAND TIPO I');
    expect(c1.codigo).toBe('21');
    expect(c1.score).toBeGreaterThanOrEqual(0.70);
    expect(c1.banda).toBe('alta');

    const c2 = clasificarConIUPC('TUBERIA HDPE');
    expect(c2.codigo).toBe('90');
    expect(c2.score).toBeGreaterThanOrEqual(0.70);

    const c3 = clasificarConIUPC('CASCO DE SEGURIDAD');
    expect(c3.codigo).toBe('83');
    expect(c3.score).toBeGreaterThanOrEqual(0.70);
  });

  it('cobertura 100% SIN inventar: lo desconocido cae en «sin clasificar»', () => {
    const cRaro = clasificarConIUPC('XKWQ PZ99 COSA EXTRAÑA NO CONOCIDA');
    expect(cRaro.codigo).toBe('sin_clasificar');
    expect(cRaro.score).toBeLessThan(0.10);
    expect(cRaro.banda).toBe('extrema_baja');
    // Y sobre todo: NO entra al catálogo como servicio, que es lo que pasaba
    // cuando el residual era el IUPC 93 (que es de tipo `servicio`).
    expect(tipoDeCategoria(cRaro.codigo)).not.toBe('servicio');
  });

  // ── EL PUENTE AL GASTO DE LA CONTADORA ───────────────────────────

  it('cada tipo IUPC cae en su categoría de gasto, no todo en «materiales»', () => {
    expect(gastoDeCategoria('03')).toBe('materiales');       // material
    expect(gastoDeCategoria('37')).toBe('herramientas');     // herramienta manual
    expect(gastoDeCategoria('83')).toBe('epp');              // implemento de seguridad
    expect(gastoDeCategoria('32')).toBe('servicios');        // flete terrestre
    expect(gastoDeCategoria('92')).toBe('servicios');        // flete fluvial
    expect(gastoDeCategoria('48')).toBe('maquinaria');       // equipo liviano
    expect(gastoDeCategoria('49')).toBe('maquinaria');       // equipo pesado
    expect(gastoDeCategoria('47')).toBe('gastos_generales'); // mano de obra
    expect(gastoDeCategoria('30')).toBe('gastos_generales'); // financiero
    expect(gastoDeCategoria('servicios')).toBe('servicios');
    expect(gastoDeCategoria('administrativos')).toBe('gastos_generales');
    expect(gastoDeCategoria('sin_clasificar')).toBe('otros');
  });

  it('las complementarias son el escape para lo que la norma no contempla', () => {
    const cods = CATEGORIAS_COMPLEMENTARIAS.map(c => c.codigo);
    expect(cods).toContain('servicios');
    expect(cods).toContain('administrativos');
    expect(cods).toContain('sin_clasificar');
  });
});
