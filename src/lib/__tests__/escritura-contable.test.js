// ═══════════════════════════════════════════════════════════════════
// EL CERCO DE ESCRITURA ES UNO SOLO, EN DOS LADOS (mig 233, tanda B).
//
// La pantalla y el SyncEngine deciden con src/lib/escritura-contable.js; el
// servidor, con las policies escritura_cerco_* de la mig 233. Si se separan,
// el cliente deja escribir algo que el servidor rechaza (queda en el
// dispositivo con «listo» en pantalla y rebota para siempre) o al revés.
// Este test lee la migración y falla si no coinciden.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  CERCO_ESCRITURA, COLUMNAS_RECEPCION, CLAVES_ITEM_RECEPCION,
  puedeEscribirTabla, puedeEmpujarTabla, puedeEditarObras, puedeEscribirContabilidad,
} from '../escritura-contable';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(path.resolve(aqui, '../../../supabase/migrations/233_cerco_escritura_contable.sql'), 'utf8');

const arr = (s) => [...s.matchAll(/'([a-z_]+)'/g)].map(m => m[1]);

describe('mig 233 ↔ escritura-contable.js', () => {
  it('las listas por tabla y operación son las mismas', () => {
    const server = {};
    for (const m of sql.matchAll(/\('([a-z_]+)',\s*'(insert|update)',\s*ARRAY\[([^\]]+)\]\)/g)) {
      (server[m[1]] ||= {})[m[2]] = arr(m[3]).sort();
    }
    const cliente = Object.fromEntries(Object.entries(CERCO_ESCRITURA).map(([t, c]) =>
      [t, { insert: [...c.insert].sort(), update: [...c.update].sort() }]));
    expect(server).toEqual(cliente);
  });

  it('las columnas que la recepción puede tocar son las mismas', () => {
    const libres = sql.match(/libres constant text\[\] := ARRAY\[([^\]]+)\]/);
    expect(libres).not.toBeNull();
    const sellos = ['notas', 'updated_at', 'updated_by', 'version', 'last_synced_at'];
    expect(arr(libres[1]).filter(c => !sellos.includes(c)).sort()).toEqual([...COLUMNAS_RECEPCION].sort());
  });

  it('las claves de cada ítem que escribe la recepción son las mismas', () => {
    const claves = sql.match(/e - ARRAY\[([^\]]+)\]/);
    expect(claves).not.toBeNull();
    expect(arr(claves[1]).sort()).toEqual([...CLAVES_ITEM_RECEPCION].sort());
  });

  it('el trigger reconoce a contabilidad con la misma lista que el cerco', () => {
    const m = sql.match(/current_user_rol\(\) = ANY \(ARRAY\[([^\]]+)\]\), false\) THEN\s+RETURN NEW;/);
    expect(m).not.toBeNull();
    expect(arr(m[1]).sort()).toEqual([...CERCO_ESCRITURA.accounting_movements.insert].sort());
  });
});

describe('decisiones', () => {
  it('la contabilidad la escriben admin, contadora y asistentes', () => {
    for (const rol of ['admin', 'contador', 'ayudante_contador']) expect(puedeEscribirContabilidad(rol)).toBe(true);
    for (const rol of ['almacenero', 'asistente_admin', 'ingeniero_residente', 'gerente', 'tesorero', 'campo', '', null]) {
      expect(puedeEscribirContabilidad(rol)).toBe(false);
    }
  });

  it('las obras, solo el admin', () => {
    expect(puedeEditarObras('admin')).toBe(true);
    for (const rol of ['contador', 'gerente', 'ingeniero_residente', 'asistente_admin']) expect(puedeEditarObras(rol)).toBe(false);
  });

  it('la almacenera actualiza movimientos (recepción) pero no los crea', () => {
    expect(puedeEscribirTabla('accounting_movements', 'almacenero', 'update')).toBe(true);
    expect(puedeEscribirTabla('accounting_movements', 'almacenero', 'insert')).toBe(false);
    expect(puedeEscribirTabla('proveedores', 'almacenero', 'update')).toBe(false);
    expect(puedeEmpujarTabla('accounting_movements', 'almacenero')).toBe(true);
    expect(puedeEmpujarTabla('companies', 'almacenero')).toBe(false);
  });

  it('una tabla fuera del cerco no se decide acá', () => {
    expect(puedeEscribirTabla('materiales', 'almacenero')).toBeNull();
    expect(puedeEmpujarTabla('materiales', 'almacenero')).toBeNull();
  });
});
