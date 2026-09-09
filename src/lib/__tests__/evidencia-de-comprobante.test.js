// ═══════════════════════════════════════════════════════════════════
// EL ARCHIVO DE UN COMPROBANTE (tanda 18, entrega B) — lib con Dexie inyectada.
//
// Gabriel, 9-set-2026: «si se detecta que la serie está incorrecta, que permita
// hipervínculo para revisar la factura real en foto o PDF». El 👁 aparece solo
// donde HAY archivo: un ojo que después dice «no hay nada» enseña a no hacerle
// caso al ojo.
//
// Los dos casos que ya se pagaron caros en Movimientos y no se repiten acá:
//   · una evidencia bajada de otra PC llega como 'synced' con URL — está
//     subida, aunque no diga 'uploaded' (bug del «⏳ subiendo» eterno, 20-jul);
//   · un registro fantasma atascado en pending no puede tapar al archivo que sí
//     está.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { evidenciasDeComprobantes } from '../evidencia-de-comprobante.js';

const dexieCon = (evidencias) => ({
  evidencias: {
    filter: (fn) => ({ toArray: async () => evidencias.filter(fn) }),
  },
});

const ev = (id, movId, extra = {}) => ({
  id, modulo_relacionado: 'accounting_movements', registro_relacionado_id: movId,
  nombre_archivo: `${id}.pdf`, mime_type: 'application/pdf',
  url_archivo: `evidencias/${id}.pdf`, sync_status: 'uploaded',
  created_at: '2026-07-01T10:00:00Z', ...extra,
});

describe('evidenciasDeComprobantes', () => {
  it('devuelve el archivo de cada comprobante pedido', async () => {
    const db = dexieCon([ev('e1', 'm1'), ev('e2', 'm2')]);
    const m = await evidenciasDeComprobantes(['m1', 'm2'], { dexie: db });
    expect(m.get('m1').nombre).toBe('e1.pdf');
    expect(m.get('m2').mime).toBe('application/pdf');
  });

  it('el que no tiene archivo NO entra al mapa (así no aparece el 👁)', async () => {
    const db = dexieCon([ev('e1', 'm1')]);
    const m = await evidenciasDeComprobantes(['m1', 'm-sin-nada'], { dexie: db });
    expect(m.has('m-sin-nada')).toBe(false);
    expect(m.size).toBe(1);
  });

  it('no confunde la bancarización ni la constancia de detracción con la factura', async () => {
    const db = dexieCon([
      ev('banc', 'm1', { tipo_evidencia: 'bancarizacion' }),
      ev('detr', 'm1', { tipo_evidencia: 'constancia_detraccion' }),
      ev('factura', 'm1', { tipo_evidencia: 'comprobante' }),
    ]);
    const m = await evidenciasDeComprobantes(['m1'], { dexie: db });
    expect(m.get('m1').nombre).toBe('factura.pdf');
  });

  it('la subida le gana al registro fantasma atascado en pendiente', async () => {
    const db = dexieCon([
      ev('fantasma', 'm1', { sync_status: 'pending_upload', url_archivo: null, created_at: '2026-08-01T10:00:00Z' }),
      ev('buena', 'm1', { sync_status: 'uploaded', created_at: '2026-07-01T10:00:00Z' }),
    ]);
    const m = await evidenciasDeComprobantes(['m1'], { dexie: db });
    expect(m.get('m1').nombre).toBe('buena.pdf');
  });

  it("una evidencia bajada de otra PC ('synced' con URL) cuenta como subida", async () => {
    const db = dexieCon([ev('deotrapc', 'm1', { sync_status: 'synced' })]);
    const m = await evidenciasDeComprobantes(['m1'], { dexie: db });
    expect(m.get('m1').sync).toBe('uploaded');
  });

  it('no pide nada a la base si no hay ids', async () => {
    let tocada = false;
    const db = { evidencias: { filter: () => { tocada = true; return { toArray: async () => [] }; } } };
    const m = await evidenciasDeComprobantes([null, undefined], { dexie: db });
    expect(m.size).toBe(0);
    expect(tocada).toBe(false);
  });

  it('sin base disponible devuelve vacío en vez de romper la pantalla', async () => {
    const m = await evidenciasDeComprobantes(['m1'], { dexie: {} });
    expect(m.size).toBe(0);
  });
});
