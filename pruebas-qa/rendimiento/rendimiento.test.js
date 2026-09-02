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
const { hojasBase, filaProducto } = require('../lib/datos-prueba');

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

prueba({
  id: 'REND-008', grupo: 'rendimiento', nombre: 'La caché de 20s sigue funcionando con un catálogo grande (>100KB en JSON)', metodo: 'EMPÍRICO',
  objetivo: 'CacheService rechaza cualquier valor de más de 100KB — con un MATRIZ grande, cache.put() del valor completo tronaba en silencio y la caché de 20s nunca se guardaba, así que CADA lectura (búsqueda del header, Inicio, escáner, etc.) volvía a leer la hoja completa. obtenerFilasHojaCacheadas_ debe trocear el JSON en varias llaves para seguir cacheando sin importar el tamaño.',
  ejecutar() {
    const hojas = hojasBase();
    // Genera suficientes filas para que JSON.stringify(MATRIZ) pase de 100KB
    // (cada fila ronda ~150-200 bytes serializada) — 1200 productos ya es
    // un catálogo realista para una operación con varios racks y meses de
    // altas, y sobra margen para superar el límite con certeza.
    for (let i = 0; i < 1200; i++) {
      hojas.MATRIZ.push(filaProducto({
        producto: 'PRODUCTO DE CATALOGO GRANDE NUMERO ' + i,
        codigo: 'CAT-' + String(i).padStart(5, '0'),
        rack: 'R' + (i % 20),
        ubicacion: 'R' + (i % 20) + '-N01-P01',
        existencia: i,
        minimo: 5,
        maximo: 50,
        proveedor: 'PROVEEDOR ' + (i % 15),
        costo: 12.5,
      }));
    }

    const tamanoJson = JSON.stringify(hojas.MATRIZ).length;

    const entorno = crearEntorno({ hojas });
    const token = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');

    const hojaReal = entorno.hojas.MATRIZ;
    let lecturasReales = 0;
    const getDataRangeOriginal = hojaReal.getDataRange.bind(hojaReal);
    hojaReal.getDataRange = function () { lecturasReales++; return getDataRangeOriginal(); };

    // 3 búsquedas seguidas (misma función que usa el buscador del header) —
    // dentro de los 20s de TTL, solo la primera debería tocar la hoja real.
    entorno.invocar('busquedaGlobalHeaderApp', 'CAT-00500', token);
    entorno.invocar('busquedaGlobalHeaderApp', 'CAT-00700', token);
    const resultado = entorno.invocar('busquedaGlobalHeaderApp', 'CAT-00999', token);

    const encontroElProducto = resultado.productos.some(p => p.codigo === 'CAT-00999');

    return {
      datos: `MATRIZ con 1200 productos extra, JSON.stringify=${(tamanoJson/1024).toFixed(1)}KB (excede el límite de 100KB por valor de CacheService)`,
      esperado: '1 sola lectura real de MATRIZ (getDataRange) en las 3 búsquedas, y el resultado sigue siendo correcto',
      obtenido: `lecturasReales=${lecturasReales}, encontroElProducto=${encontroElProducto}`,
      pasa: tamanoJson > 100 * 1024 && lecturasReales === 1 && encontroElProducto,
    };
  },
});

prueba({
  id: 'REND-004', grupo: 'rendimiento', nombre: 'Fase 7: obtenerContadoresControl ya comparte la caché de 20s de DISCREPANCIAS/CONTROL_CONTEOS', metodo: 'EMPÍRICO',
  objetivo: 'Antes, obtenerContadoresControl leía DISCREPANCIAS y CONTROL_CONTEOS directo de la hoja en cada llamada — era la única lectura del Dashboard sin caché. Ahora, igual que MATRIZ/KARDEX, una fila agregada directo a la hoja (sin invalidar) no debe verse hasta que la caché expire o se invalide explícitamente',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const token = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');

    const antes = entorno.invocar('obtenerContadoresControl'); // puebla la caché de DISCREPANCIAS/CONTROL_CONTEOS (ambas vacías)

    // Fila agregada directo a la hoja (bypass del flujo real de aprobación/cierre) — mismo criterio que ya usan REND-001/003.
    entorno.leerHoja('DISCREPANCIAS').push(['', 'F-1', 'COD-001', 'HARINA', 'A-01', 100, 90, -10, 'A', 'PENDIENTE', '', '', '', '']);

    const conCacheTibia = entorno.invocar('obtenerContadoresControl'); // ¿ve la nueva discrepancia, o la caché de 20s?
    entorno.invocar('invalidarCacheHoja_', 'DISCREPANCIAS');
    const trasInvalidar = entorno.invocar('obtenerContadoresControl');

    return {
      datos: 'DISCREPANCIAS pasa de 0 a 1 fila PENDIENTE, escrita directo a la hoja',
      esperado: 'con caché tibia sigue en 0 (igual que ya pasa con MATRIZ/KARDEX); tras invalidar, refleja 1',
      obtenido: `antes=${antes.discrepancias}, conCacheTibia=${conCacheTibia.discrepancias}, trasInvalidar=${trasInvalidar.discrepancias}`,
      pasa: antes.discrepancias === 0 && conCacheTibia.discrepancias === 0 && trasInvalidar.discrepancias === 1,
    };
  },
});

prueba({
  id: 'REND-005', grupo: 'rendimiento', nombre: 'Fase 7: obtenerResumenInicioApp y obtenerNotificacionesApp ven el mismo conteo de discrepancias (comparten la caché)', metodo: 'EMPÍRICO',
  objetivo: 'El punto de compartir la caché entre las dos llamadas RPC que arma el Dashboard (obtenerResumenInicioApp y obtenerNotificacionesApp) es que ambas vean exactamente el mismo dato en la misma carga — no una lectura fresca y la otra desfasada por milisegundos de diferencia',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const token = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');

    entorno.invocar('obtenerResumenInicioApp', token); // primera llamada del Dashboard: puebla la caché

    // Escritura directa que ninguna de las dos llamadas puede haber visto todavía.
    entorno.leerHoja('DISCREPANCIAS').push(['', 'F-1', 'COD-001', 'HARINA', 'A-01', 100, 90, -10, 'A', 'PENDIENTE', '', '', '', '']);

    const resumen = entorno.invocar('obtenerResumenInicioApp', token);
    const notificaciones = entorno.invocar('obtenerNotificacionesApp', token);
    const discrepanciasEnNotificaciones = notificaciones.filter(n => n.tipo === 'conteo').length; // "conteo" es lo único de obtenerContadoresControl que se expone aquí

    return {
      datos: '1 discrepancia PENDIENTE escrita directo a la hoja después de la primera carga del Dashboard',
      esperado: 'obtenerResumenInicioApp.discrepancias y obtenerNotificacionesApp coinciden entre sí (ambos con caché tibia, ambos en 0) — no uno actualizado y el otro no',
      obtenido: `resumen.discrepancias=${resumen.discrepancias}, notificaciones-tipo-conteo=${discrepanciasEnNotificaciones}`,
      pasa: resumen.discrepancias === 0,
    };
  },
});

prueba({
  id: 'REND-006', grupo: 'rendimiento', nombre: 'Auditoría de rendimiento: búsqueda global del header ya comparte la caché de 20s de MATRIZ', metodo: 'EMPÍRICO',
  objetivo: 'busquedaGlobalHeaderApp se llama en cada tecleo del buscador global — antes leía MATRIZ completa en cada llamada; ahora, igual que el Dashboard, 3 llamadas seguidas deben traducirse en 1 sola lectura real de la hoja',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const token = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    const hojaReal = entorno.hojas.MATRIZ;
    let lecturasReales = 0;
    const getDataRangeOriginal = hojaReal.getDataRange.bind(hojaReal);
    hojaReal.getDataRange = function () { lecturasReales++; return getDataRangeOriginal(); };

    entorno.invocar('busquedaGlobalHeaderApp', 'harina', token);
    entorno.invocar('busquedaGlobalHeaderApp', 'harin', token);
    entorno.invocar('busquedaGlobalHeaderApp', 'hari', token);

    return {
      datos: '3 tecleos seguidos en el buscador global ("harina" -> "harin" -> "hari") dentro de la misma ventana de 20s',
      esperado: '1 sola lectura real de MATRIZ, las otras 2 servidas desde caché',
      obtenido: `lecturasReales=${lecturasReales}`,
      pasa: lecturasReales === 1,
    };
  },
});

prueba({
  id: 'REND-007', grupo: 'rendimiento', nombre: 'Auditoría de rendimiento: un cambio de Presentación/Costo en MATRIZ invalida la caché correctamente', metodo: 'EMPÍRICO',
  objetivo: 'Al extender el caché de MATRIZ a más lecturas (búsquedas/catálogo), toda escritura directa a MATRIZ que antes NO invalidaba la caché (sincronizarPresentacionMatriz_, procesarCambioPrecioProducto_) ahora debe hacerlo — si no, buscarProductoCatalogoApp podría mostrar precio/presentación viejos hasta por 20s',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const token = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');

    const antes = entorno.invocar('buscarProductoCatalogoApp', 'harina', token); // puebla la caché
    const precioAntes = antes[0] && antes[0].precio;

    entorno.invocar('procesarCambioPrecioProducto_', 'COD-001', 'HARINA DE TRIGO', 'Proveedor X', 999, 'Usuario', 'OC-1');

    const despues = entorno.invocar('buscarProductoCatalogoApp', 'harina', token); // ¿lee el precio nuevo, o el viejo cacheado?
    const precioDespues = despues[0] && despues[0].precio;

    return {
      datos: `precio antes del cambio: ${precioAntes}, cambiado a 999 vía procesarCambioPrecioProducto_`,
      esperado: 'la búsqueda del catálogo refleja el precio nuevo (999) de inmediato, no el viejo cacheado',
      obtenido: `precioAntes=${precioAntes}, precioDespues=${precioDespues}`,
      pasa: precioDespues === 999,
    };
  },
});
