import { describe, it, expect } from 'vitest';
import {
  filasTablaMarkdown, lineasConCantidad, ocurrenciasDeUnidad, estimarItems,
} from '../../../lib/ocr-items.js';

// Cómo devuelve Mistral OCR un PDF con grilla: tabla markdown.
const OCR_PDF = `# FACTURA ELECTRONICA

| Cantidad | Unidad | Descripcion | P.Unit |
| --- | --- | --- | --- |
| 40.00 | UNIDAD | PICOS | 30.50 |
| 18.00 | UNIDAD | BALDE VACIO DE 19 LTS | 6.77 |
| 5.00 | UNIDAD | CILINDROS VACIOS | 67.79 |
| 12.00 | UNIDAD | MARTILLO | 15.25 |

Son: DOCE MIL NOVECIENTOS VEINTE`;

// Cómo lo devuelve con una FOTO: texto corrido, sin tabla.
const OCR_FOTO = `FACTURA ELECTRONICA
RUC: 20615646505 E001-1
40.00 UNIDAD PICOS 30.50
18.00 UNIDAD BALDE VACIO DE 19 LTS 6.7796
5.00 UNIDAD CILINDROS VACIOS 67.7966
12.00 UNIDAD MARTILLO 15.2542
2.00 UNIDAD WICHA DE 50M 67.7966
6.00 UNIDAD REGLA DE ALUMINIO 101.69
SON: DOCE MIL NOVECIENTOS VEINTE Y 00/100 SOLES`;

describe('ocr-items — señal de tabla markdown (PDF)', () => {
  it('cuenta las filas sin encabezado ni separador', () => {
    expect(filasTablaMarkdown(OCR_PDF)).toBe(4);
  });
  it('una foto sin tabla da 0 — el bug que dejaba el presupuesto en el piso', () => {
    expect(filasTablaMarkdown(OCR_FOTO)).toBe(0);
  });
  it('texto vacío no revienta', () => {
    expect(filasTablaMarkdown('')).toBe(0);
    expect(filasTablaMarkdown(null)).toBe(0);
  });
});

describe('ocr-items — señal de línea con cantidad (foto)', () => {
  it('reconoce las líneas de detalle en texto corrido', () => {
    expect(lineasConCantidad(OCR_FOTO)).toBe(6);
  });
  it('no confunde una línea de texto suelto con un ítem', () => {
    expect(lineasConCantidad('SON: DOCE MIL SOLES\nGracias por su compra')).toBe(0);
  });
  it('no cuenta números sueltos sin descripción', () => {
    expect(lineasConCantidad('12.00\n45')).toBe(0);
  });
  it('acepta decimales con coma', () => {
    expect(lineasConCantidad('1,50 KG CEMENTO PORTLAND 28.90')).toBe(1);
  });
});

describe('ocr-items — señal de unidades', () => {
  it('cuenta las unidades de medida del detalle', () => {
    expect(ocurrenciasDeUnidad('3 BLS CEMENTO\n2 GAL PINTURA\n5 UND CLAVOS')).toBe(3);
  });
  it('no cuenta palabras que solo contienen la unidad', () => {
    expect(ocurrenciasDeUnidad('MUNDO SEGUNDO KILOMETRAJE')).toBe(0);
  });
});

describe('ocr-items — estimarItems toma la señal MÁS ALTA', () => {
  it('un PDF con grilla se estima por la tabla', () => {
    expect(estimarItems(OCR_PDF)).toBeGreaterThanOrEqual(4);
  });
  it('una FOTO ya NO se estima en 0 (el arreglo del 7-sep)', () => {
    expect(estimarItems(OCR_FOTO)).toBeGreaterThanOrEqual(6);
  });
  it('un documento sin detalle estima 0', () => {
    expect(estimarItems('CONSTANCIA DE PAGO\nGracias por su preferencia')).toBe(0);
  });
  it('nunca devuelve negativo', () => {
    expect(estimarItems('UNIDAD')).toBe(0);
    expect(estimarItems('')).toBe(0);
  });
  it('una factura larga de verdad estima decenas de líneas', () => {
    const larga = Array.from({ length: 66 }, (_, i) =>
      `${i + 1}.00 UNIDAD MATERIAL DE PRUEBA ${i} ${(i * 3.5).toFixed(2)}`).join('\n');
    expect(estimarItems(larga)).toBeGreaterThanOrEqual(60);
  });
});
