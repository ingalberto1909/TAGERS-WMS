#!/usr/bin/env node
'use strict';

/*
 * Punto de entrada de la suite de QA de TAGERS WMS.
 *
 * Uso:
 *   node run.js                        Corre todo, imprime reporte
 *   node run.js --grupo=smoke          Corre solo un grupo
 *   node run.js --baseline             Corre todo y GUARDA baseline/baseline.json
 *   node run.js --comparar             Corre todo y compara contra baseline/baseline.json
 *   node run.js --json=salida.json     Además del reporte en consola, guarda el detalle en JSON
 *
 * Esta carpeta NUNCA toca una hoja de cálculo real — todo corre contra
 * un backend real (los .gs de producción, solo lectura) con las APIs de
 * Google emuladas en memoria (ver lib/emulador-gas.js).
 */

const fs = require('fs');
const path = require('path');
const { ejecutarTodas, imprimirReporte, limpiarRegistro } = require('./lib/runner');
const { compararConBaseline, imprimirComparacion } = require('./lib/comparador');

const ARCHIVOS_DE_PRUEBA = [
  'smoke/smoke.test.js',
  'seguridad/seguridad.test.js',
  'inventario/inventario.test.js',
  'compras/compras.test.js',
  'requisiciones/requisiciones.test.js',
  'recetas/recetas.test.js',
  'produccion/produccion.test.js',
  'concurrencia/concurrencia.test.js',
  'rendimiento/rendimiento.test.js',
  'sucursales/sucursales.test.js',
  'sucursales/prueba-maestra-6-sucursales.test.js',
  'requisiciones-sucursal/requisiciones-sucursal.test.js',
  'legado/movimientos-dashboard.test.js',
  'legado/onedit-entrada-salida.test.js',
  'legado/programacion-conteos.test.js',
  'notificaciones/notificaciones.test.js',
  'notificaciones/notificaciones-correo.test.js',
  'usuarios/usuarios.test.js',
  'proveedores/proveedores.test.js',
  'mermas/mermas.test.js',
  'devoluciones/devoluciones.test.js',
  'reportes/reportes.test.js',
  'inteligencia/inteligencia.test.js',
  'fefo/fefo.test.js',
  'kpis/kpis-operativos.test.js',
];

function cargarTodasLasPruebas() {
  limpiarRegistro();
  ARCHIVOS_DE_PRUEBA.forEach(rel => {
    const ruta = path.join(__dirname, rel);
    if (fs.existsSync(ruta)) {
      delete require.cache[require.resolve(ruta)];
      require(ruta);
    }
  });
}

async function main() {
  const args = process.argv.slice(2);
  const grupoArg = args.find(a => a.startsWith('--grupo='));
  const grupo = grupoArg ? grupoArg.split('=')[1] : null;
  const modoBaseline = args.includes('--baseline');
  const modoComparar = args.includes('--comparar');
  const jsonArg = args.find(a => a.startsWith('--json='));

  cargarTodasLasPruebas();

  const filtro = grupo ? (def => def.grupo === grupo) : null;
  const resultados = await ejecutarTodas(filtro);

  imprimirReporte(resultados);

  if (jsonArg) {
    const rutaJson = path.join(__dirname, jsonArg.split('=')[1]);
    fs.writeFileSync(rutaJson, JSON.stringify(resultados, null, 2));
    console.log('\nDetalle guardado en', rutaJson);
  }

  const rutaBaseline = path.join(__dirname, 'baseline', 'baseline.json');

  if (modoBaseline) {
    fs.writeFileSync(rutaBaseline, JSON.stringify({ fecha: new Date().toISOString(), resultados }, null, 2));
    console.log('\n✅ BASELINE guardada en', rutaBaseline);
  }

  if (modoComparar) {
    if (!fs.existsSync(rutaBaseline)) {
      console.error('\n⚠️  No existe una baseline todavía. Corre primero: node run.js --baseline');
      process.exit(2);
    }
    const baseline = JSON.parse(fs.readFileSync(rutaBaseline, 'utf8'));
    const comparacion = compararConBaseline(baseline.resultados, resultados);
    imprimirComparacion(comparacion);
    if (comparacion.regresiones.length > 0) {
      console.error('\n🔴 SE DETECTARON REGRESIONES — DETENIENDO (código de salida 1)');
      process.exit(1);
    }
  }

  const huboFallaOError = resultados.some(r => r.estado === 'FAIL' || r.estado === 'ERROR');
  if (huboFallaOError && !modoComparar) {
    process.exit(1);
  }
}

main().catch(e => { console.error('ERROR FATAL EN LA SUITE:', e); process.exit(2); });
