// ═══════════════════════════════════════════════════════════════════
// SUBFAMILIAS Y RECOMENDACIONES DE MOVIDA (tanda 14, entrega 2.1).
//
// TODOS los casos de acá salieron de correr el motor contra el archivo real de
// Gabriel (`Modelos/Categorizacion Simple.xlsx`, 478 filas) y mirar uno por uno
// qué proponía. Los «no propone» son los falsos positivos que la primera
// versión SÍ proponía: quedan clavados en tests porque son la única defensa
// contra volver a criar ruido, que es lo que hace que una herramienta así se
// deje de abrir.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  sugerirSubfamilia, revisarCatalogo, subfamiliasDe, familiasDeSubfamilia,
  etiquetaSubfamilia, SUBFAMILIAS,
} from '../catalogo-subfamilias.js';

const sug = (nombre, familia) => sugerirSubfamilia(nombre, familia);
const sub = (nombre, familia) => sug(nombre, familia)?.subfamilia || null;
const mueve = (nombre, familia) => sug(nombre, familia)?.familiaSugerida || null;

// ── 1. El segundo nivel ────────────────────────────────────────────
describe('la subfamilia parte las familias que eran muy generales', () => {
  it('«implementos de seguridad» deja de ser una sola bolsa de 64 cosas', () => {
    expect(sub('CASCOS DE SEGURIDAD', 'seguridad')).toBe('epp_cabeza');
    expect(sub('GUANTES DE CUERO', 'seguridad')).toBe('epp_manos');
    expect(sub('ZAPATOS PUNTA DE ACERO', 'seguridad')).toBe('epp_pies');
    expect(sub('LENTES DE SEGURIDAD', 'seguridad')).toBe('epp_vision');
    expect(sub('PROTECTOR DE OIDOS', 'seguridad')).toBe('epp_auditivo');
    expect(sub('RESPIRADORES CONTRA GASES', 'seguridad')).toBe('epp_respiratorio');
    expect(sub('ARNES CON TRES ANILLO', 'seguridad')).toBe('epp_altura');
    expect(sub('CAMILLA DE POLIETILENO', 'seguridad')).toBe('seguridad_emergencia');
    expect(sub('MALLA CERCADORA NARANJA', 'seguridad')).toBe('seguridad_senalizacion');
  });

  it('lo médico del botiquín es emergencia, no un instrumento de medición', () => {
    // Van antes que `herramienta_medicion` a propósito: un pulsómetro dentro de
    // un botiquín no es topografía.
    expect(sub('PULSOMETRO', 'seguridad')).toBe('seguridad_emergencia');
    expect(sub('TERMOMETRO DIGITAL TIPO LASER', 'seguridad')).toBe('seguridad_emergencia');
    expect(sub('MEDIDOR DE PRESION ARTERIAL', 'seguridad')).toBe('seguridad_emergencia');
    expect(sub('BALON CHICO DE OXIGENO (LLENO)', 'seguridad')).toBe('seguridad_emergencia');
  });

  it('«equipos y herramientas» separa la retroexcavadora de la brocha', () => {
    expect(sub('RETROEXCAVADORA SOBRE LLANTAS 80-100 HP', 'equipos_herramientas')).toBe('equipo_pesado');
    expect(sub('BROCHAS DE 4"', 'equipos_herramientas')).toBe('herramienta_manual');
    expect(sub('WICHA DE 50m', 'equipos_herramientas')).toBe('herramienta_medicion');
    expect(sub('DISCO DE CORTE DE 7" PARA FIERRO', 'equipos_herramientas')).toBe('consumible_herramienta');
    expect(sub('BOMBA PARA PRUEBA DE TUBERIAS', 'equipos_herramientas')).toBe('equipo_electrico');
  });

  it('los plurales del archivo también pegan («PICOS», no «pico»)', () => {
    expect(sub('PICOS', 'equipos_herramientas')).toBe('herramienta_manual');
    expect(sub('CARRETILLAS', 'equipos_herramientas')).toBe('herramienta_manual');
    expect(sub('LAPICEROS', 'administrativos')).toBe('admin_papeleria');
  });

  it('para lo civil reusa el motor técnico que ya estaba medido', () => {
    expect(sub('TUBERIA PVC UF S25 DE 8"(200mm) x 6m ISO 4435', 'tuberia_accesorios')).toBe('tuberia_pvc');
    expect(sub('TUBERIA HDPE DE 200mm', 'tuberia_accesorios')).toBe('tuberia_hdpe');
    expect(sub('CODO PVC SP 1/2" X 90°', 'tuberia_accesorios')).toBe('accesorio_pvc');
    expect(sub('PIEDRA CHANCADA 1/2"', 'agregados')).toBe('agregado');
    expect(sub('MADERA TORNILLO 1"x 8"x8\'', 'madera')).toBe('madera');
  });

  it('la familia técnica se elige entre las de SU familia, no la primera global', () => {
    // 🔴 Regresión real: «VALVULA COMPUERTA … PARA HDPE» daba `tuberia_hdpe`
    // —esa regla va antes en la lista global— y proponía mudarla a Tubería,
    // estando perfectamente en Válvulas.
    expect(sub('VALVULA COMPUERTA ACERROJADA 4" PARA HDPE INC. ACCESORIOS', 'valvulas')).toBe('valvula');
    expect(mueve('VALVULA COMPUERTA ACERROJADA 4" PARA HDPE INC. ACCESORIOS', 'valvulas')).toBeNull();
  });

  it('lo que no reconoce queda en null: no se inventa una subfamilia', () => {
    expect(sub('WATER STOP NEOPRENO', 'ferreteria')).toBeNull();
    expect(sug('', 'ferreteria')).toBeNull();
  });
});

// ── 2. Las recomendaciones de movida ───────────────────────────────
describe('cuándo se propone mover un insumo de familia', () => {
  it('propone lo que está claramente mal puesto', () => {
    expect(mueve('CEMENTO PORTLAND TIPO I (42.5 kg)', 'ferreteria')).toBe('agregados');
    expect(mueve('TRANSPORTE DE RESIDUOS DE OBRA DURANTE LA EJECUCION', 'seguridad')).toBe('servicios');
    expect(mueve('WINCHA DE 5M', 'administrativos')).toBe('equipos_herramientas');
    expect(mueve('LIJA PARA METAL', 'ferreteria')).toBe('equipos_herramientas');
    expect(mueve('REGISTRO DE BRONCE CROMADO DE 4"', 'ferreteria')).toBe('tuberia_accesorios');
  });

  it('y trae el motivo, para que la decisión no sea a ciegas', () => {
    const r = sug('CEMENTO PORTLAND TIPO I (42.5 kg)', 'ferreteria');
    expect(r.motivo).toContain('Cemento');
    expect(etiquetaSubfamilia(r.subfamilia)).toBe('Cemento');
  });

  // 🔴 LOS FALSOS POSITIVOS QUE LA PRIMERA VERSIÓN SÍ PROPONÍA. Todos salieron
  // de correr el motor contra el archivo real. Si alguno vuelve, este test cae.
  it('NO propone mover por una palabra que está al final del nombre', () => {
    expect(mueve('PANTALON DE TELA DRILL CON CINTA REFLECTIVA', 'seguridad')).toBeNull();
    expect(mueve('TANQUE DE AGUA COLOR ARENA (POLIETILENO) DE 600 LITROS', 'ferreteria')).toBeNull();
    expect(mueve('ADHESIVO EPÓXICO DE ANCLAJE', 'ferreteria')).toBeNull();
    expect(mueve('SUMINISTRO DE PLACA DE ANCLAJE DE ESTRUCTURA METALICA', 'perfiles_metalicos')).toBeNull();
    expect(mueve('MALETIN CHICO DE IMPLEMENTOS QUIRURGICOS DE CURACIÓN (PINZAS, TIJERAS)', 'seguridad')).toBeNull();
    expect(mueve('CAJA PARA LLAVE TERMOMAGNETICA', 'tuberia_accesorios')).toBeNull();
    expect(mueve('CLAVOS PARA MADERA CON CABEZA DE 3"', 'ferreteria')).toBeNull();
    expect(mueve('GRAPAS PARA CABLE DE 5/8"', 'perfiles_metalicos')).toBeNull();
  });

  it('un insumo bien puesto nunca genera recomendación', () => {
    for (const [n, f] of [
      ['CASCOS DE SEGURIDAD', 'seguridad'],
      ['PIEDRA CHANCADA 1/2"', 'agregados'],
      ['ALQUILER DE CAMIONETA 4X4', 'servicios'],
      ['PAPEL BOND', 'administrativos'],
      ['GRIFO DE BRONCE DE 1/2"', 'valvulas'],
    ]) expect(mueve(n, f), n).toBeNull();
  });
});

// ── 3. El repaso completo ──────────────────────────────────────────
describe('revisarCatalogo', () => {
  const fila = (id, nombre, familia, extra = {}) => ({ id, nombre, familia, activo: true, ...extra });

  it('cuenta cuántos quedan sin subfamilia y agrupa los demás', () => {
    const r = revisarCatalogo([
      fila('1', 'CASCOS DE SEGURIDAD', 'seguridad'),
      fila('2', 'GUANTES DE JEBE', 'seguridad'),
      fila('3', 'WATER STOP NEOPRENO', 'ferreteria'),
    ]);
    expect(r.sinSubfamilia).toBe(1);
    expect(r.porSubfamilia.get('epp_cabeza')).toBe(1);
    expect(r.porSubfamilia.get('epp_manos')).toBe(1);
  });

  it('lo que ya tiene subfamilia grabada no se vuelve a proponer', () => {
    const r = revisarCatalogo([fila('1', 'CASCOS DE SEGURIDAD', 'seguridad', { subfamilia: 'epp_ropa' })]);
    expect(r.propuestas).toHaveLength(0);
    expect(r.porSubfamilia.get('epp_ropa')).toBe(1);   // manda lo decidido
  });

  it('lo marcado como revisado no vuelve a aparecer entre las recomendaciones', () => {
    const conRec = revisarCatalogo([fila('1', 'CEMENTO PORTLAND TIPO I', 'ferreteria')]);
    expect(conRec.recomendaciones).toHaveLength(1);
    const revisado = revisarCatalogo([fila('1', 'CEMENTO PORTLAND TIPO I', 'ferreteria', { revisado: true })]);
    expect(revisado.recomendaciones).toHaveLength(0);
    // Pero la subfamilia se sigue proponiendo: descartar la MOVIDA no es
    // descartar el segundo nivel.
    expect(revisado.propuestas).toHaveLength(1);
  });

  it('lo desactivado y lo borrado no entra al repaso', () => {
    const r = revisarCatalogo([
      fila('1', 'CASCOS DE SEGURIDAD', 'seguridad', { activo: false }),
      fila('2', 'GUANTES DE JEBE', 'seguridad', { deleted_at: '2026-09-07' }),
    ]);
    expect(r.propuestas).toHaveLength(0);
    expect(r.sinSubfamilia).toBe(0);
  });
});

// ── 4. Coherencia del vocabulario ──────────────────────────────────
describe('el vocabulario se sostiene solo', () => {
  it('cada subfamilia declara al menos una familia donde vive', () => {
    for (const s of SUBFAMILIAS) expect(s.familias.length, s.slug).toBeGreaterThan(0);
  });

  it('las subfamilias de una familia son las que la familia declara', () => {
    expect(subfamiliasDe('seguridad')).toContain('epp_cabeza');
    expect(subfamiliasDe('seguridad')).not.toContain('admin_papeleria');
    expect(familiasDeSubfamilia('epp_cabeza')).toEqual(['seguridad']);
    expect(familiasDeSubfamilia('cemento')).toEqual(['agregados']);
  });

  it('cada subfamilia tiene etiqueta legible, no un slug pelado', () => {
    for (const s of SUBFAMILIAS) {
      expect(etiquetaSubfamilia(s.slug), s.slug).not.toBe(s.slug);
      expect(etiquetaSubfamilia(s.slug).length).toBeGreaterThan(3);
    }
  });
});
