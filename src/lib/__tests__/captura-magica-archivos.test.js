import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ALLOWED_MIME_CAPTURA, mimeEfectivoDeArchivo, tipoAceptado } from '../captura-magica-archivos.js';

// El caso real (13-set-2026): Gabriel — «captura mágica no me deja procesar
// evidencia .heic, que subieron por captura rápido algunas personas».
describe('captura-magica-archivos — HEIC de iPhone', () => {
  it('HEIC/HEIF están en la lista de tipos aceptados', () => {
    expect(ALLOWED_MIME_CAPTURA).toContain('image/heic');
    expect(ALLOWED_MIME_CAPTURA).toContain('image/heif');
  });

  it('un HEIC con el mimeType bien puesto pasa tal cual', () => {
    const f = { type: 'image/heic', name: 'IMG_1234.HEIC' };
    expect(mimeEfectivoDeArchivo(f)).toBe('image/heic');
    expect(tipoAceptado(f)).toBe(true);
  });

  it('🔴 el quirk de Safari/iOS: file.type VACÍO se infiere por la extensión', () => {
    const f = { type: '', name: 'IMG_1234.heic' };
    expect(mimeEfectivoDeArchivo(f)).toBe('image/heic');
    expect(tipoAceptado(f)).toBe(true);
  });

  it('lo mismo con file.type "application/octet-stream" (otro fallback típico del navegador)', () => {
    const f = { type: 'application/octet-stream', name: 'foto.heif' };
    expect(mimeEfectivoDeArchivo(f)).toBe('image/heic');
  });

  it('extensión en mayúsculas también cuenta', () => {
    expect(mimeEfectivoDeArchivo({ type: '', name: 'FOTO.HEIF' })).toBe('image/heic');
  });

  it('un mimeType YA reconocido nunca se pisa por el nombre', () => {
    // Si el navegador dijo jpeg, se respeta — aunque el nombre (mal puesto a
    // mano) diga .heic.
    expect(mimeEfectivoDeArchivo({ type: 'image/jpeg', name: 'export.heic' })).toBe('image/jpeg');
  });

  it('sin tipo y sin extensión reconocible, no inventa nada', () => {
    expect(mimeEfectivoDeArchivo({ type: '', name: 'archivo.docx' })).toBe('');
    expect(tipoAceptado({ type: '', name: 'archivo.docx' })).toBe(false);
  });

  it('un tipo realmente no soportado se sigue rechazando', () => {
    expect(tipoAceptado({ type: 'application/zip', name: 'facturas.zip' })).toBe(false);
  });

  it('sin argumento no revienta', () => {
    expect(mimeEfectivoDeArchivo(undefined)).toBe('');
    expect(tipoAceptado(null)).toBe(false);
  });
});

// ── GUARD DE CÓDIGO: el server de verdad convierte el HEIC ──────────
// Aceptar el mimeType del lado del cliente no sirve de nada si el endpoint no
// lo convierte antes de mandarlo a Mistral/Claude — ninguno de los dos lee
// HEIC. Este test lee el archivo fuente (no lo ejecuta: heic-convert necesita
// bytes HEIC reales) y frena en el green gate si alguien saca el import o la
// conversión sin sacar también 'image/heic' de ALLOWED_MIME.
describe('el server realmente convierte el HEIC antes de leerlo', () => {
  const src = readFileSync(new URL('../../../api/captura-magica.js', import.meta.url), 'utf8');

  it("importa 'heic-convert'", () => {
    expect(src).toMatch(/from ['"]heic-convert['"]/);
  });

  it("ALLOWED_MIME del server acepta 'image/heic'", () => {
    expect(src).toMatch(/'image\/heic'/);
  });

  it('la conversión se dispara cuando validateFileBytes dice actualType heic', () => {
    expect(src).toMatch(/v\.actualType === 'heic'/);
    expect(src).toMatch(/heicConvert\(/);
  });
});
