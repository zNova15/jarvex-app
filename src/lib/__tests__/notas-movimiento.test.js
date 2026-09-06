import { describe, it, expect } from 'vitest';
import {
  parsearNotas, tieneEstructura, notaHumana, fusionarNota, resumenEstructurado,
} from '../notas-movimiento.js';

// La forma REAL de producción: los 1.402 movimientos vivos tienen JSON acá.
const facturaCapturaMagica = JSON.stringify({
  captura_magica: true,
  confianza: 0.93,
  subtotal: 7627.12,
  igv: 1372.88,
  items_factura: [
    { descripcion: 'VARILLA DE ACERO CORRUGADO 1/2', cantidad: 100, precio_unitario: 38 },
    { descripcion: 'ALAMBRE DE AMARRE #16', cantidad: 20, precio_unitario: 12 },
  ],
});

describe('parsearNotas — nunca lanza', () => {
  it('parsea el JSON de producción', () => {
    expect(parsearNotas(facturaCapturaMagica).items_factura).toHaveLength(2);
  });
  it('un objeto ya parseado pasa derecho', () => {
    expect(parsearNotas({ nota: 'hola' })).toEqual({ nota: 'hola' });
  });
  it('texto plano, null, vacío y JSON roto dan {}', () => {
    expect(parsearNotas('se pagó en efectivo')).toEqual({});
    expect(parsearNotas(null)).toEqual({});
    expect(parsearNotas('')).toEqual({});
    expect(parsearNotas('{roto')).toEqual({});
  });
  it('un ARRAY no es un payload válido', () => {
    expect(parsearNotas('[1,2,3]')).toEqual({});
  });
});

describe('notaHumana — lo único que el formulario debe mostrar', () => {
  it('de una factura de Captura Mágica NO devuelve el JSON', () => {
    // Este es el bug: el textarea mostraba todo el blob.
    const n = notaHumana(facturaCapturaMagica);
    expect(n).toBe('');
    expect(n).not.toMatch(/items_factura/);
  });

  it('devuelve la nota escrita a mano cuando existe', () => {
    const con = JSON.stringify({ items_factura: [], nota: 'Falta la guía de remisión' });
    expect(notaHumana(con)).toBe('Falta la guía de remisión');
  });

  it('un comprobante viejo con texto plano NO pierde su nota', () => {
    expect(notaHumana('se pagó en efectivo, sin depósito')).toBe('se pagó en efectivo, sin depósito');
  });

  it('null, vacío y objeto sin nota dan cadena vacía', () => {
    expect(notaHumana(null)).toBe('');
    expect(notaHumana('')).toBe('');
    expect(notaHumana({ items_factura: [] })).toBe('');
  });
});

describe('fusionarNota — la función que evita perder los ítems', () => {
  it('escribir una nota CONSERVA items_factura, igv y subtotal', () => {
    const salida = fusionarNota(facturaCapturaMagica, 'Revisar con el proveedor');
    const j = JSON.parse(salida);
    expect(j.nota).toBe('Revisar con el proveedor');
    expect(j.items_factura).toHaveLength(2);
    expect(j.igv).toBe(1372.88);
    expect(j.subtotal).toBe(7627.12);
    expect(j.captura_magica).toBe(true);
  });

  it('BORRAR la nota no borra el payload', () => {
    const conNota = fusionarNota(facturaCapturaMagica, 'algo');
    const sinNota = fusionarNota(conNota, '');
    const j = JSON.parse(sinNota);
    expect(j.nota).toBeUndefined();
    expect(j.items_factura).toHaveLength(2);
  });

  it('espacios en blanco cuentan como nota vacía, no como nota', () => {
    const j = JSON.parse(fusionarNota(facturaCapturaMagica, '   '));
    expect(j.nota).toBeUndefined();
    expect(j.items_factura).toHaveLength(2);
  });

  it('un comprobante sin nada y sin nota queda en null, no en "{}"', () => {
    expect(fusionarNota(null, '')).toBeNull();
    expect(fusionarNota('', '   ')).toBeNull();
  });

  it('un comprobante sin estructura gana su nota', () => {
    expect(JSON.parse(fusionarNota(null, 'pagado en caja'))).toEqual({ nota: 'pagado en caja' });
  });

  it('el ciclo abrir→guardar sin tocar nada es IDEMPOTENTE', () => {
    // El caso que más importa: la contadora abre para cambiar la fecha, no toca
    // Notas, y guarda. El payload tiene que salir igual que entró.
    const leido = notaHumana(facturaCapturaMagica);
    const guardado = fusionarNota(facturaCapturaMagica, leido);
    expect(JSON.parse(guardado)).toEqual(JSON.parse(facturaCapturaMagica));
  });
});

describe('tieneEstructura', () => {
  it('una nota suelta NO es estructura', () => {
    expect(tieneEstructura(JSON.stringify({ nota: 'hola' }))).toBe(false);
  });
  it('items_factura SÍ', () => {
    expect(tieneEstructura(facturaCapturaMagica)).toBe(true);
  });
});

describe('resumenEstructurado — le dice al usuario qué se está conservando', () => {
  it('nombra los ítems y el IGV', () => {
    const r = resumenEstructurado(facturaCapturaMagica);
    expect(r).toMatch(/2 ítem\(s\)/);
    expect(r).toMatch(/desglose de IGV/);
    expect(r).toMatch(/Se conserva al guardar/);
  });
  it('el espejo automático se anuncia', () => {
    expect(resumenEstructurado(JSON.stringify({ intercompany_auto: true })))
      .toMatch(/espejo automático/);
  });
  it('sin payload no dice nada', () => {
    expect(resumenEstructurado(JSON.stringify({ nota: 'hola' }))).toBe('');
    expect(resumenEstructurado(null)).toBe('');
  });
});
