'use strict';

/*
 * FASE 6-7 del pedido del usuario: auditoría de rendimiento (medición
 * real donde es posible, complejidad estimada donde no) y la prueba
 * obligatoria de "Dashboard ANTES vs DESPUÉS" — los KPIs deben salir
 * EXACTAMENTE iguales usando el mismo dataset, tanto si se leyó con
 * caché como sin ella. Si hay cualquier diferencia, se reporta como
 * hallazgo y NO se sigue optimizando encima sin resolverlo primero.
 *
 * IMPORTANTE — esto NO es una medición de tiempo real de producción.
 * Node/V8 y el entorno emulado son órdenes de magnitud más rápidos que
 * el HtmlService/SpreadsheetApp reales de Apps Script; los ms aquí solo
 * sirven para comparar el ANTES/DESPUÉS relativo dentro de esta misma
 * corrida (p. ej. "N lecturas se volvieron 1"), nunca como tiempo
 * absoluto esperado en producción. Eso se declara explícitamente en el
 * reporte final como "complejidad estimada", no "tiempo medido real".
 */

const { prueba } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase } = require('../lib/datos-prueba');

prueba({
  id: 'REND-001', grupo: 'rendimiento', nombre: 'Caché de 20s evita relecturas repetidas de MATRIZ', metodo: 'EMPÍRICO',
  objetivo: 'obtenerFilasHojaCacheadas_ debe leer la hoja UNA sola vez y servir las siguientes llamadas (dentro del TTL) desde CacheService',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const hojaReal = entorno.hojas.MATRIZ;
    let lecturasReales = 0;
    const getDataRangeOriginal = hojaReal.getDataRange.bind(hojaReal);
    hojaReal.getDataRange = function () { lecturasReales++; return getDataRangeOriginal(); };

    entorno.invocar('obtenerDashboardMovil');
    entorno.invocar('obtenerDashboardMovil');
    entorno.invocar('obtenerDashboardMovil');

    return {
      datos: '3 llamadas seguidas a obtenerDashboardMovil (cada una lee MATRIZ vía caché) dentro de la misma ventana de 20s',
      esperado: '1 sola lectura real de la hoja MATRIZ (getDataRange), las otras 2 desde caché',
      obtenido: `lecturasReales=${lecturasReales}`,
      pasa: lecturasReales === 1,
    };
  },
});

prueba({
  id: 'REND-002', grupo: 'rendimiento', nombre: 'Dashboard ANTES vs DESPUÉS: KPIs idénticos con y sin caché', metodo: 'EMPÍRICO',
  objetivo: 'Con el MISMO dataset, obtenerDashboardMovil debe dar el mismo resultado leyendo en frío (caché vacía) que leyendo en caliente (caché ya poblada) — la caché no debe alterar ningún KPI',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const antes = entorno.invocar('obtenerDashboardMovil'); // caché fría -> se puebla aquí
    const despues = entorno.invocar('obtenerDashboardMovil'); // caché caliente
    const iguales = JSON.stringify(antes) === JSON.stringify(despues);
    return {
      datos: 'mismo dataset, 2 lecturas: 1ª puebla la caché, 2ª la reutiliza',
      esperado: 'KPIs idénticos byte a byte',
      obtenido: iguales ? 'idénticos' : `DIFERENTES: antes=${JSON.stringify(antes)} despues=${JSON.stringify(despues)}`,
      pasa: iguales,
    };
  },
});

prueba({
  id: 'REND-003', grupo: 'rendimiento', nombre: 'HALLAZGO: la caché de 20s puede servir datos obsoletos tras una escritura', metodo: 'EMPÍRICO',
  objetivo: 'Verificar si una entrada/salida escrita DESPUÉS de poblar la caché se refleja de inmediato en la siguiente lectura cacheada, o si el dashboard puede mostrar existencia vieja hasta por 20 segundos',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const tokenOp = entorno.invocar('crearSesion_', 'operador@tagers.com', 'Op', 'OPERADOR');

    const antes = entorno.invocar('obtenerDetalleProductoApp', 'COD-001', tokenOp); // puebla la caché de MATRIZ con existencia=100
    entorno.invocar('guardarEntradaApp', { codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 20, udm: 'KG', token: tokenOp }); // sube a 120, escribe directo a la hoja (sin pasar por caché)
    const despues = entorno.invocar('obtenerDetalleProductoApp', 'COD-001', tokenOp); // ¿lee 120 real, o 100 de la caché de 20s?

    const huboEntradaReal = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10] === 120;
    const dashboardActualizado = despues.existencia === 120;

    return {
      datos: `MATRIZ real tras la entrada: existencia=${entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10]}`,
      esperado: 'la lectura cacheada refleja la existencia real inmediatamente después de escribir (120), no la existencia vieja cacheada (100)',
      obtenido: `MATRIZ real actualizada=${huboEntradaReal}, lectura cacheada devuelve existencia=${despues.existencia}`,
      pasa: huboEntradaReal && dashboardActualizado,
    };
  },
});
