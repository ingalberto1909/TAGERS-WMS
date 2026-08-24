'use strict';

/*
 * TAGERS WMS 2.0 — Fase 3 (FEFO.gs): estimación de caducidad de mercancía
 * COMPRADA (ENTRADA.Lote / ENTRADA.Caducidad, columnas H/I). A diferencia
 * de PRODUCCION (que sí decrementa una CantidadDisponible real por lote),
 * aquí no existe un ledger por lote — por eso calcularAsignacionFefoPorCodigo_
 * REPARTE la existencia actual contra las entradas ordenadas por caducidad
 * ascendente (FEFO), y estas pruebas verifican esa asignación a fondo, no
 * solo el filtro de umbral.
 */

const { prueba } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase } = require('../lib/datos-prueba');

function entornoConLogin(rolCorreo) {
  const entorno = crearEntorno({ hojas: hojasBase() });
  const token = entorno.invocar('crearSesion_', rolCorreo.correo, rolCorreo.nombre, rolCorreo.rol);
  return { entorno, token };
}

// ENTRADA: A Año|B Mes|C Fecha|D Código|E Producto|F Cantidad|G UDM|H Lote|I Caducidad|J -|K Ubicación
function agregarEntrada_(entorno, { fecha, codigo, producto, cantidad, lote, caducidad }) {
  entorno.leerHoja('ENTRADA').push([
    2026, 'AGO', fecha, codigo, producto, cantidad, 'KG', lote !== undefined ? lote : 'L-TEST', caducidad, '', 'A-01',
  ]);
}

prueba({
  id: 'FEFO-001', grupo: 'fefo', nombre: 'Reparte la existencia contra el lote de caducidad más próxima primero', metodo: 'EMPÍRICO',
  objetivo: 'Con dos entradas de distinta caducidad, la existencia actual debe asignarse primero al lote que caduca antes (FEFO), no repartirse proporcionalmente ni asignarse al más reciente',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const hoy = entorno.crearFechaDesdeHoy(0);
    agregarEntrada_(entorno, { fecha: hoy, codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 60, lote: 'L-1', caducidad: entorno.crearFechaDesdeHoy(5) });
    agregarEntrada_(entorno, { fecha: hoy, codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 80, lote: 'L-2', caducidad: entorno.crearFechaDesdeHoy(30) });
    // COD-001 existencia=100 de fábrica: cubre L-1 completo (60) y 40 de L-2.
    const lotes = entorno.invocar('obtenerLotesEntradaProximosACaducarApp', token, 7);
    const l1 = lotes.find(l => l.lote === 'L-1');
    return {
      datos: 'COD-001 existencia=100; L-1 (60 pzas, caduca en 5 días), L-2 (80 pzas, caduca en 30 días)',
      esperado: 'con umbral=7, solo aparece L-1, con cantidadEstimada=60 (no 100, no repartido a la mitad)',
      obtenido: `lotes=${lotes.map(l=>l.lote+':'+l.cantidadEstimada).join(',')}`,
      pasa: lotes.length === 1 && !!l1 && l1.cantidadEstimada === 60 && l1.diasRestantes === 5 && l1.metodo === 'estimado-fefo',
    };
  },
});

prueba({
  id: 'FEFO-002', grupo: 'fefo', nombre: 'Cuando la existencia es menor que la entrada original, la estimación no excede la existencia', metodo: 'EMPÍRICO',
  objetivo: 'Si ya se consumió parte del lote (existencia actual menor a lo que entró), cantidadEstimada debe reflejar solo lo que queda, nunca la cantidad original de la entrada',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    // COD-002 (AZUCAR) existencia=5 de fábrica; la entrada original fue de 50.
    agregarEntrada_(entorno, { fecha: entorno.crearFechaDesdeHoy(0), codigo: 'COD-002', producto: 'AZUCAR ESTANDAR', cantidad: 50, lote: 'L-AZ', caducidad: entorno.crearFechaDesdeHoy(3) });
    const lotes = entorno.invocar('obtenerLotesEntradaProximosACaducarApp', token, 7);
    const l = lotes.find(x => x.lote === 'L-AZ');
    return {
      datos: 'COD-002 existencia actual=5; la entrada registrada fue de 50 unidades',
      esperado: 'cantidadEstimada=5 (la existencia real), NUNCA 50 (la cantidad original de la entrada)',
      obtenido: `cantidadEstimada=${l ? l.cantidadEstimada : 'ausente'}`,
      pasa: !!l && l.cantidadEstimada === 5,
    };
  },
});

prueba({
  id: 'FEFO-003', grupo: 'fefo', nombre: 'Un lote posterior queda en cero si el más próximo ya cubre toda la existencia', metodo: 'EMPÍRICO',
  objetivo: 'Si el lote que caduca primero ya alcanza para cubrir toda la existencia actual, el lote más lejano no debe recibir ninguna asignación — no debe aparecer aunque esté dentro del umbral',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    // COD-003 (SAL) existencia=50 de fábrica.
    agregarEntrada_(entorno, { fecha: entorno.crearFechaDesdeHoy(0), codigo: 'COD-003', producto: 'SAL DE MESA', cantidad: 200, lote: 'L-CERCA', caducidad: entorno.crearFechaDesdeHoy(2) });
    agregarEntrada_(entorno, { fecha: entorno.crearFechaDesdeHoy(0), codigo: 'COD-003', producto: 'SAL DE MESA', cantidad: 10, lote: 'L-LEJOS', caducidad: entorno.crearFechaDesdeHoy(40) });
    const lotes = entorno.invocar('obtenerLotesEntradaProximosACaducarApp', token, 45); // umbral amplio: si L-LEJOS apareciera, sería por umbral, no por asignación
    return {
      datos: 'COD-003 existencia=50; L-CERCA (200 unidades, caduca en 2 días) ya cubre toda la existencia; L-LEJOS (10, caduca en 40 días)',
      esperado: 'solo aparece L-CERCA (50 asignadas); L-LEJOS no recibe nada y no aparece pese a estar dentro del umbral de 45 días',
      obtenido: `lotes=${lotes.map(l=>l.lote+':'+l.cantidadEstimada).join(',')}`,
      pasa: lotes.length === 1 && lotes[0].lote === 'L-CERCA' && lotes[0].cantidadEstimada === 50,
    };
  },
});

prueba({
  id: 'FEFO-004', grupo: 'fefo', nombre: 'El umbral de días es un parámetro: el mismo lote aparece o no según diasUmbral', metodo: 'EMPÍRICO',
  objetivo: 'Un lote a 20 días no debe aparecer con umbral=7 pero sí con umbral=30 — confirma que el umbral no está fijo en el código',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    // COD-004 (RAJAS POBLANAS) existencia=12 de fábrica.
    agregarEntrada_(entorno, { fecha: entorno.crearFechaDesdeHoy(0), codigo: 'COD-004', producto: 'RAJAS POBLANAS 0.5 KG', cantidad: 12, lote: 'L-20D', caducidad: entorno.crearFechaDesdeHoy(20) });
    const conUmbral7 = entorno.invocar('obtenerLotesEntradaProximosACaducarApp', token, 7);
    const conUmbral30 = entorno.invocar('obtenerLotesEntradaProximosACaducarApp', token, 30);
    return {
      datos: 'L-20D caduca en 20 días',
      esperado: 'con umbral=7 no aparece; con umbral=30 sí aparece con cantidadEstimada=12',
      obtenido: `umbral7=${conUmbral7.some(l=>l.lote==='L-20D')}, umbral30=${conUmbral30.some(l=>l.lote==='L-20D')}`,
      pasa: !conUmbral7.some(l => l.lote === 'L-20D') && conUmbral30.some(l => l.lote === 'L-20D' && l.cantidadEstimada === 12),
    };
  },
});

prueba({
  id: 'FEFO-005', grupo: 'fefo', nombre: 'Un lote ya vencido se incluye con días negativos, igual que en producción', metodo: 'EMPÍRICO',
  objetivo: 'Un lote cuya caducidad ya pasó debe seguir apareciendo (con diasRestantes negativo) — mismo criterio que ya usa obtenerLotesProximosACaducarApp para producción, no se oculta',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    agregarEntrada_(entorno, { fecha: entorno.crearFechaDesdeHoy(-10), codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 100, lote: 'L-VENCIDO', caducidad: entorno.crearFechaDesdeHoy(-3) });
    const lotes = entorno.invocar('obtenerLotesEntradaProximosACaducarApp', token, 7);
    const l = lotes.find(x => x.lote === 'L-VENCIDO');
    return {
      datos: 'L-VENCIDO caducó hace 3 días',
      esperado: 'aparece en el resultado con diasRestantes=-3',
      obtenido: `presente=${!!l}, dias=${l ? l.diasRestantes : 'n/a'}`,
      pasa: !!l && l.diasRestantes === -3,
    };
  },
});

prueba({
  id: 'FEFO-006', grupo: 'fefo', nombre: 'Entrada sin folio de lote no se descarta, se etiqueta como "Sin folio de lote"', metodo: 'EMPÍRICO',
  objetivo: 'Una entrada con Caducidad capturada pero Lote vacío sigue siendo una señal válida de vencimiento — no se descarta solo por faltar la etiqueta',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    agregarEntrada_(entorno, { fecha: entorno.crearFechaDesdeHoy(0), codigo: 'COD-003', producto: 'SAL DE MESA', cantidad: 20, lote: '', caducidad: entorno.crearFechaDesdeHoy(4) });
    const lotes = entorno.invocar('obtenerLotesEntradaProximosACaducarApp', token, 7);
    return {
      datos: 'Entrada de COD-003 con Caducidad en 4 días pero columna Lote vacía',
      esperado: 'aparece en el resultado con lote="Sin folio de lote"',
      obtenido: `lotes=${JSON.stringify(lotes.map(l=>({codigo:l.codigo,lote:l.lote,dias:l.diasRestantes})))}`,
      pasa: lotes.some(l => l.codigo === 'COD-003' && l.lote === 'Sin folio de lote' && l.diasRestantes === 4),
    };
  },
});

prueba({
  id: 'FEFO-007', grupo: 'fefo', nombre: 'Entrada sin caducidad capturada se ignora por completo, sin inventar una fecha', metodo: 'EMPÍRICO',
  objetivo: 'Una entrada con Caducidad vacía (campo opcional que no todos capturan) no debe producir ninguna fila — nunca se infiere o inventa una fecha de vencimiento',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    agregarEntrada_(entorno, { fecha: entorno.crearFechaDesdeHoy(0), codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 30, lote: 'L-SIN-CAD', caducidad: '' });
    const lotes = entorno.invocar('obtenerLotesEntradaProximosACaducarApp', token, 365);
    return {
      datos: 'Entrada de COD-001 con Lote capturado pero Caducidad vacía',
      esperado: 'L-SIN-CAD no aparece en el resultado ni con un umbral de 365 días',
      obtenido: `aparece=${lotes.some(l=>l.lote==='L-SIN-CAD')}`,
      pasa: !lotes.some(l => l.lote === 'L-SIN-CAD'),
    };
  },
});

prueba({
  id: 'FEFO-008', grupo: 'fefo', nombre: 'Producto sin existencia actual no genera alerta aunque tenga entradas con caducidad próxima', metodo: 'EMPÍRICO',
  objetivo: 'Si la existencia actual del producto es 0 (ya se agotó, entró y salió todo), no debe asignarse nada ni lanzar error — no hay inventario real que pueda caducar',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    // COD-005 (PRODUCTO SIN UBICACION) existencia=0 de fábrica.
    agregarEntrada_(entorno, { fecha: entorno.crearFechaDesdeHoy(0), codigo: 'COD-005', producto: 'PRODUCTO SIN UBICACION', cantidad: 40, lote: 'L-AGOTADO', caducidad: entorno.crearFechaDesdeHoy(3) });
    let error = null;
    let lotes = [];
    try { lotes = entorno.invocar('obtenerLotesEntradaProximosACaducarApp', token, 7); } catch(e) { error = e.message; }
    return {
      datos: 'COD-005 existencia actual=0, con una entrada registrada con caducidad próxima',
      esperado: 'no truena, y L-AGOTADO no aparece en el resultado',
      obtenido: `error=${error}, aparece=${lotes.some(l=>l.lote==='L-AGOTADO')}`,
      pasa: !error && !lotes.some(l => l.lote === 'L-AGOTADO'),
    };
  },
});

prueba({
  id: 'FEFO-009', grupo: 'fefo', nombre: 'El agregador de acciones requeridas separa caducidades de compra (estimadas) de las de producción (reales)', metodo: 'EMPÍRICO',
  objetivo: 'obtenerAccionesRequeridasApp debe listar "caducidades-compra" como tarjeta separada de "caducidades" (producción) — nunca mezclar un dato estimado con uno exacto en el mismo conteo',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    agregarEntrada_(entorno, { fecha: entorno.crearFechaDesdeHoy(0), codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 100, lote: 'L-A', caducidad: entorno.crearFechaDesdeHoy(4) });

    const produccion = entorno.leerHoja('PRODUCCION');
    produccion.push(['LOTE-P1', entorno.crearFechaDesdeHoy(0), entorno.crearFechaDesdeHoy(3), '', '', 'PROD-A', 'PASTEL', '', 10, 'PZA', 10, 'ACTIVO', 'Tester', '']);

    const acciones = entorno.invocar('obtenerAccionesRequeridasApp', token);
    const compra = acciones.revisar.find(a => a.tipo === 'caducidades-compra');
    const produccionCard = acciones.revisar.find(a => a.tipo === 'caducidades');
    return {
      datos: '1 lote de compra (ENTRADA, caduca en 4 días) + 1 lote de producción (caduca en 3 días)',
      esperado: 'ambas tarjetas existen, por separado, cada una con cantidad=1',
      obtenido: `compra=${compra ? compra.cantidad : 0}, produccion=${produccionCard ? produccionCard.cantidad : 0}`,
      pasa: !!compra && compra.cantidad === 1 && !!produccionCard && produccionCard.cantidad === 1,
    };
  },
});
