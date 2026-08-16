'use strict';

/*
 * registrarMovimientoDashboard (Dashboard.html, legado de Sheets) —
 * estaba duplicada palabra por palabra en Código.gs y
 * MovimientosDashboard.gs (hallazgo de la auditoría de arquitectura
 * multi-sucursal), y NINGUNA de las dos copias actualizaba la
 * Existencia real de MATRIZ — solo escribían un número calculado a
 * mano en Kardex. Se unificó en una sola definición (Código.gs) que sí
 * usa la función central de existencia. Estas pruebas confirman la
 * corrección real, no solo que el código compile.
 */

const { prueba } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase } = require('../lib/datos-prueba');

prueba({
  id: 'LEG-001', grupo: 'legado', nombre: 'Entrada desde Dashboard legado sí actualiza MATRIZ', metodo: 'EMPÍRICO',
  objetivo: 'registrarMovimientoDashboard("ENTRADA", ...) debe sumar a la Existencia real de MATRIZ (bug de la auditoría: antes solo escribía Kardex con un número inventado)',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const r = entorno.invocar('registrarMovimientoDashboard', 'ENTRADA', { codigo: 'COD-001', cantidad: 20, lote: 'L1', observacion: 'prueba' });
    const existenciaMatriz = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];
    return {
      datos: 'existencia inicial=100, entrada=20',
      esperado: 'MATRIZ=120 (no solo Kardex), resultado.existenciaNueva=120',
      obtenido: `MATRIZ=${existenciaMatriz}, resultado.existenciaNueva=${r.existenciaNueva}`,
      pasa: existenciaMatriz === 120 && r.existenciaNueva === 120,
    };
  },
});

prueba({
  id: 'LEG-002', grupo: 'legado', nombre: 'Salida desde Dashboard legado sí actualiza MATRIZ', metodo: 'EMPÍRICO',
  objetivo: 'registrarMovimientoDashboard("SALIDA", ...) debe restar de la Existencia real de MATRIZ',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const r = entorno.invocar('registrarMovimientoDashboard', 'SALIDA', { codigo: 'COD-001', cantidad: 30, area: 'Cocina' });
    const existenciaMatriz = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];
    return {
      datos: 'existencia inicial=100, salida=30',
      esperado: 'MATRIZ=70, resultado.existenciaNueva=70',
      obtenido: `MATRIZ=${existenciaMatriz}, resultado.existenciaNueva=${r.existenciaNueva}`,
      pasa: existenciaMatriz === 70 && r.existenciaNueva === 70,
    };
  },
});

prueba({
  id: 'LEG-003', grupo: 'legado', nombre: 'Salida sin existencia suficiente se bloquea antes de escribir nada', metodo: 'EMPÍRICO',
  objetivo: 'Debe lanzar "Existencia insuficiente" y no dejar ninguna fila huérfana en SALIDA ni KARDEX',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    let bloqueado = false, mensaje = '';
    try { entorno.invocar('registrarMovimientoDashboard', 'SALIDA', { codigo: 'COD-002', cantidad: 999 }); } // COD-002 (AZUCAR) = 5
    catch (e) { bloqueado = true; mensaje = e.message; }
    const existenciaMatriz = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-002')[10];
    const filasSalida = entorno.leerHoja('SALIDA').length - 1;
    const filasKardex = entorno.leerHoja('KARDEX').length - 1;
    return {
      datos: 'COD-002 existencia=5, intenta salida de 999',
      esperado: 'bloqueado, MATRIZ sin cambio, sin filas huérfanas en SALIDA ni KARDEX',
      obtenido: bloqueado ? `${mensaje} — MATRIZ=${existenciaMatriz}, filasSalida=${filasSalida}, filasKardex=${filasKardex}` : 'PERMITIDO',
      pasa: bloqueado && /insuficiente/i.test(mensaje) && existenciaMatriz === 5 && filasSalida === 0 && filasKardex === 0,
    };
  },
});

prueba({
  id: 'LEG-004', grupo: 'legado', nombre: 'Kardex refleja el existenciaAnterior/Nueva REAL, no uno calculado por separado', metodo: 'EMPÍRICO',
  objetivo: 'La fila de Kardex debe coincidir exactamente con lo que la función central escribió en MATRIZ, no con un cálculo hecho a mano por registrarMovimientoDashboard',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    entorno.invocar('registrarMovimientoDashboard', 'ENTRADA', { codigo: 'COD-003', cantidad: 12 }); // SAL DE MESA, existencia=50
    const kardex = entorno.leerHoja('KARDEX')[1];
    const existenciaMatriz = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-003')[10];
    return {
      datos: 'COD-003 existencia inicial=50, entrada=12',
      esperado: 'Kardex.ExistenciaAnterior=50, ExistenciaNueva=62, igual a MATRIZ=62',
      obtenido: `kardex: ${kardex[8]}→${kardex[9]}, MATRIZ=${existenciaMatriz}`,
      pasa: kardex[8] === 50 && kardex[9] === 62 && existenciaMatriz === 62,
    };
  },
});
