import { describe, it, expect } from 'vitest';
import { sugerirCodigoSpot, CODIGOS_VALIDADOS } from '../sugerir-codigo-spot.js';

describe('estructura del catálogo', () => {
  it('solo tiene los 3 códigos validados por uso real, ninguno inventado', () => {
    expect(Object.keys(CODIGOS_VALIDADOS).sort()).toEqual(['019', '022', '027']);
  });
});

// ── LOS CASOS REALES DE PRODUCCIÓN, uno por uno ────────────────────

describe('019 — alquiler (3+2 casos reales)', () => {
  it('las 3 facturas de la retroexcavadora sugieren 019, SIN tasa única', () => {
    for (const d of [
      'ALQUILER DE RETROEXCAVADORA A TODO COSTO PARA LA OBRA MEJORAMIENTO, AMPLIACION',
      'ALQUILER DE RETROEXCAVADORA A TODO COSTO PARA OBRA MEJORAMIENTO AMPLIACION',
    ]) {
      const r = sugerirCodigoSpot(d);
      expect(r.codigo).toBe('019');
      expect(r.confianza).toBe('alta');
      expect(r.tasaUnica).toBeNull();
    }
  });

  it('🔴 NO decide 10% ni 4%: las tres reales están en la MISMA obra y difieren', () => {
    // Es el hallazgo que cambió el diseño: obra_id no explica la diferencia.
    const r = sugerirCodigoSpot('ALQUILER DE RETROEXCAVADORA A TODO COSTO');
    expect(r.tasasPosibles).toEqual([
      { tasa: 10, cuando: 'alquiler de un bien mueble común' },
      { tasa: 4, cuando: 'cuando el proveedor lo trata como parte de un contrato de construcción' },
    ]);
    expect(r.avisoTasa).toMatch(/NO se puede derivar/);
  });

  it('el alquiler de camioneta también sugiere 019', () => {
    const r = sugerirCodigoSpot('ALQUILER DE CAMIONETA INC/CHOFER Y COMBUSTIBLE PARA REALIZAR EL DOCUMENTO');
    expect(r.codigo).toBe('019');
  });

  it('🔴 avisa cuando la tasa ya cargada no es ni 10% ni 4% (E001-43/E001-44 reales, 12%)', () => {
    const r = sugerirCodigoSpot('ALQUILER DE CAMIONETA INC/CHOFER Y COMBUSTIBLE', { tasaActual: 12 });
    expect(r.avisoTasaInusual).toMatch(/12%/);
    expect(r.avisoTasaInusual).toMatch(/10% o 4%/);
  });

  it('con una tasa ya conocida (10 o 4) no avisa nada raro', () => {
    expect(sugerirCodigoSpot('ALQUILER DE RETROEXCAVADORA', { tasaActual: 10 }).avisoTasaInusual).toBeNull();
    expect(sugerirCodigoSpot('ALQUILER DE RETROEXCAVADORA', { tasaActual: 4 }).avisoTasaInusual).toBeNull();
  });

  it('arrendamiento (sinónimo) también dispara la regla', () => {
    expect(sugerirCodigoSpot('CONTRATO DE ARRENDAMIENTO DE MAQUINARIA').codigo).toBe('019');
  });
});

describe('027 — transporte (5 casos reales)', () => {
  const casos = [
    'POR EL SERVICIO DE TRANSPORTE DE TUBO PVC-U 200MM S-25 Y PVC',
    'Servicio de transporte 1 PAQUETE L (Serie: V860 Nr',
    'POR SERVICIO DE TRANSPORTE DE CHICLAYO A CAJAMARCA',
  ];
  it.each(casos)('«%s» sugiere 027 al 4%%, con confianza alta', (d) => {
    const r = sugerirCodigoSpot(d);
    expect(r.codigo).toBe('027');
    expect(r.confianza).toBe('alta');
    expect(r.tasaUnica).toBe(4);
  });

  it('traslado y flete son sinónimos válidos', () => {
    expect(sugerirCodigoSpot('SERVICIO DE TRASLADO DE MATERIALES').codigo).toBe('027');
    expect(sugerirCodigoSpot('FLETE POR ENVÍO DE EQUIPOS').codigo).toBe('027');
  });

  it('avisa si la tasa cargada no es 4%', () => {
    const r = sugerirCodigoSpot('SERVICIO DE TRANSPORTE DE MATERIALES', { tasaActual: 10 });
    expect(r.avisoTasaInusual).toMatch(/10%/);
  });
});

describe('022 — otros servicios (3 casos reales, todos al 12%)', () => {
  it('🔴 «ESTUDIO DE SUELOS» no dice "servicio", pero con tasa 12% ya cargada sugiere 022 con confianza ALTA', () => {
    // Caso real de la lista "sin código": el texto NO tiene la palabra clave.
    const r = sugerirCodigoSpot('ESTUDIO DE SUELOS PARA LA ELABORACIÓN DEL DOCUMENTO DE TRABAJO', { tasaActual: 12 });
    expect(r.codigo).toBe('022');
    expect(r.confianza).toBe('alta');
    expect(r.tasaUnica).toBe(12);
  });

  it('«DISEÑO DE MEZCLAS», mismo caso: sin la palabra servicio, pero con 12% ya puesto', () => {
    const r = sugerirCodigoSpot('DISEÑO DE MEZCLAS PARA LA ELABORACIÓN DEL DOCUMENTO', { tasaActual: 12 });
    expect(r.codigo).toBe('022');
    expect(r.confianza).toBe('alta');
  });

  it('«SUPERVISAR LA ADQUISICION DEL EQUIPAMIENTO», mismo patrón', () => {
    expect(sugerirCodigoSpot('SUPERVISAR LA ADQUISICION DEL EQUIPAMIENTO DE LA ENTIDAD', { tasaActual: 12 }).codigo).toBe('022');
  });

  it('«SERVICIO DE ALIMENTACIÓN DEL PERSONAL TÉCNICO» — tiene la palabra Y la tasa', () => {
    const r = sugerirCodigoSpot('SERVICIO DE ALIMENTACIÓN DEL PERSONAL TÉCNICO DE LA OBRA', { tasaActual: 12 });
    expect(r.codigo).toBe('022');
    expect(r.confianza).toBe('alta');
  });

  it('«SERVICIO ESPECIALIZADO DE MONITOREO AMBIENTAL» y «LIQUIDACION DE SALDO DE OBRA»', () => {
    expect(sugerirCodigoSpot('SERVICIO ESPECIALIZADO DE MONITOREO AMBIENTAL DE CALIDAD', { tasaActual: 12 }).codigo).toBe('022');
    expect(sugerirCodigoSpot('ELABORACION DE LIQUIDACION DE SALDO DE OBRA', { tasaActual: 12 }).codigo).toBe('022');
  });

  it('sin la tasa 12% puesta, solo dispara si el texto dice "servicio" — y con confianza MEDIA, más débil', () => {
    const conServicio = sugerirCodigoSpot('SERVICIO ESPECIALIZADO DE MONITOREO AMBIENTAL');
    expect(conServicio.codigo).toBe('022');
    expect(conServicio.confianza).toBe('media');

    // "ESTUDIO DE SUELOS" sin tasa 12% y sin la palabra "servicio": no hay
    // señal, y por la disciplina de no inventar, no se propone nada.
    expect(sugerirCodigoSpot('ESTUDIO DE SUELOS PARA LA OBRA')).toBeNull();
  });

  it('tipo_insumo="servicio" también cuenta como señal, aunque el texto no diga la palabra', () => {
    const r = sugerirCodigoSpot('ELABORACION DE LIQUIDACION DE SALDO DE OBRA', { tipoInsumo: 'servicio' });
    expect(r.codigo).toBe('022');
    expect(r.confianza).toBe('media');
  });
});

describe('🔴 la disciplina: sin señal NO se inventa un código', () => {
  it('un material común (cemento, generador) con detracción mal marcada no recibe 022', () => {
    expect(sugerirCodigoSpot('CEMENTO PORTLAND TIPO I 425 KG', { tasaActual: 18, tipoInsumo: 'material' })).toBeNull();
    expect(sugerirCodigoSpot('GENERADOR GASOLINERO KAILI 3800KW', { tipoInsumo: 'maquinaria' })).toBeNull();
  });

  it('la tasa 12% NO alcanza si tipoInsumo dice que es un bien (material/herramienta/maquinaria/EPP)', () => {
    // Sin `tipoInsumo`, un texto ambiguo con 12% SÍ cae en el fallback — el
    // llamador solo debe pasar `tasaActual` cuando ya decidió que es un
    // servicio con detracción (el caso real de uso, desde el escáner).
    expect(sugerirCodigoSpot('VARILLA DE ACERO CORRUGADO', { tasaActual: 12 })).not.toBeNull();
    // Pero si además viene tipado como bien, la señal de la tasa se ignora.
    expect(sugerirCodigoSpot('VARILLA DE ACERO CORRUGADO', { tasaActual: 12, tipoInsumo: 'material' })).toBeNull();
    expect(sugerirCodigoSpot('MARTILLO DEMOLEDOR', { tasaActual: 12, tipoInsumo: 'herramienta' })).toBeNull();
    expect(sugerirCodigoSpot('GENERADOR KAILI', { tasaActual: 12, tipoInsumo: 'maquinaria' })).toBeNull();
    expect(sugerirCodigoSpot('CASCO DE SEGURIDAD', { tasaActual: 12, tipoInsumo: 'epp' })).toBeNull();
  });

  it('descripción vacía, null o basura no rompe y no propone nada', () => {
    expect(sugerirCodigoSpot('')).toBeNull();
    expect(sugerirCodigoSpot(null)).toBeNull();
    expect(sugerirCodigoSpot(undefined)).toBeNull();
    expect(() => sugerirCodigoSpot(123)).not.toThrow();
  });

  it('alquiler y transporte GANAN sobre el fallback de 022, aunque diga "servicio"', () => {
    // "SERVICIO DE ALQUILER..." tiene ambas palabras: alquiler debe ganar.
    expect(sugerirCodigoSpot('SERVICIO DE ALQUILER DE MAQUINARIA PESADA').codigo).toBe('019');
    expect(sugerirCodigoSpot('SERVICIO DE TRANSPORTE DE MATERIALES', { tasaActual: 12 }).codigo).toBe('027');
  });
});

describe('colisiones de subcadena (misma clase de bug que en recomendador-activos)', () => {
  it('el límite de palabra exige "transporte" exacto: "transportadora" no matchea por sí sola', () => {
    // "transportadora" (razón social) NO es la palabra "transporte" — el
    // límite de palabra del regex lo distingue. Con la palabra "servicio"
    // presente, cae en el fallback 022 en vez de 027: es lo correcto, porque
    // el nombre del proveedor no dice qué tipo de servicio prestó.
    const r = sugerirCodigoSpot('SERVICIO DE TRANSPORTADORA CAJAMARCA S.A.');
    expect(r.codigo).toBe('022');
    expect(r.confianza).toBe('media');
  });

  it('pero "transporte" como palabra completa sí dispara, esté donde esté en el texto', () => {
    expect(sugerirCodigoSpot('CONTRATO CON TRANSPORTADORA CAJAMARCA — SERVICIO DE TRANSPORTE DE CARGA').codigo).toBe('027');
  });

  it('"arrendataria" no debe confundirse con un alquiler NUESTRO si el contexto es distinto — limitación aceptada', () => {
    // Documentado: el sugeridor lee solo texto, no quién es el arrendador. Si
    // la descripción nombra "arrendamiento" para cualquier parte del contrato,
    // sugiere 019. Es una recomendación, la contadora decide si aplica.
    expect(sugerirCodigoSpot('GASTOS NOTARIALES DEL CONTRATO DE ARRENDAMIENTO').codigo).toBe('019');
  });
});
