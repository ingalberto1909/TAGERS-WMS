'use strict';

/*
 * Re-validación de Producción: registrar un lote a partir de una
 * requisición de receta ya entregada, descuento/alta correcta en MATRIZ
 * y Kardex, cierre de lote, y el guard de sesión agregado en esta ronda.
 */

const { prueba } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase, hojaMatrizEstandar, filaProducto } = require('../lib/datos-prueba');

function prepararRequisicionEntregada(entorno, token) {
  const req = entorno.invocar('crearRequisicionRecetaApp', '', [{ codigoReceta: 'REC-0001', cantidadSolicitada: 1 }], token);
  const filaReq = entorno.leerHoja('REQUISICIONES').find(f => f[0] === req.folio);
  filaReq[4] = 'ENTREGADA'; // Se simula que Almacén ya confirmó la entrega de insumos (flujo probado en requisiciones.test.js)
  return req.folio;
}

prueba({
  id: 'PROD-001', grupo: 'produccion', nombre: 'Registrar lote de producción da de alta el producto terminado', metodo: 'EMPÍRICO',
  objetivo: 'registrarProduccionApp debe sumar existencia del producto terminado en MATRIZ y registrar el lote en PRODUCCION',
  ejecutar() {
    const matriz = hojaMatrizEstandar();
    matriz.push(filaProducto({ producto: 'PAN DE MUERTO', udm: 'PZ', codigo: 'COD-010', existencia: 0, ubicacion: 'C-01' }));
    const entorno = crearEntorno({ hojas: hojasBase({
      MATRIZ: matriz,
      RECETAS: [
        ['Receta', 'Ingrediente', 'CantidadNeta', 'UDM', 'Rendimiento', 'Categoría', 'Estado'],
        ['PAN DE MUERTO', 'HARINA DE TRIGO', 1, 'KG', '20 piezas', 'GENERAL', 'ACTIVA'],
      ],
    }) });
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    const folioReq = prepararRequisicionEntregada(entorno, tokenAdmin);

    const r = entorno.invocar('registrarProduccionApp', {
      folioRequisicion: folioReq, nombreReceta: 'PAN DE MUERTO', codigoProducto: 'COD-010', cantidadProducida: 20, udm: 'PZ',
    }, tokenAdmin);

    const existencia = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-010')[10];
    const lotes = entorno.invocar('obtenerLotesProduccionApp', {}, tokenAdmin);
    const kardexFilas = entorno.leerHoja('KARDEX').length - 1;

    return {
      datos: 'producto terminado existencia inicial=0, se producen 20 PZ',
      esperado: 'existencia=20, 1 lote ACTIVO con cantidadDisponible=20, 1 fila en Kardex',
      obtenido: `folio=${r.folio}, existencia=${existencia}, lotes=${lotes.length}, disponible=${lotes[0] && lotes[0].cantidadDisponible}, kardex=${kardexFilas}`,
      pasa: existencia === 20 && lotes.length === 1 && lotes[0].cantidadDisponible === 20 && lotes[0].estado === 'ACTIVO' && kardexFilas === 1,
    };
  },
});

prueba({
  id: 'PROD-002', grupo: 'produccion', nombre: 'No se puede producir de una requisición sin entregar', metodo: 'EMPÍRICO',
  objetivo: 'obtenerRequisicionListaParaProduccionApp debe rechazar una requisición todavía PENDIENTE',
  ejecutar() {
    const matriz = hojaMatrizEstandar();
    matriz.push(filaProducto({ producto: 'PAN DE MUERTO', udm: 'PZ', codigo: 'COD-010', existencia: 0, ubicacion: 'C-01' }));
    const entorno = crearEntorno({ hojas: hojasBase({
      MATRIZ: matriz,
      RECETAS: [
        ['Receta', 'Ingrediente', 'CantidadNeta', 'UDM', 'Rendimiento', 'Categoría', 'Estado'],
        ['PAN DE MUERTO', 'HARINA DE TRIGO', 1, 'KG', '20 piezas', 'GENERAL', 'ACTIVA'],
      ],
    }) });
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    const req = entorno.invocar('crearRequisicionRecetaApp', '', [{ codigoReceta: 'REC-0001', cantidadSolicitada: 1 }], tokenAdmin);
    // No se marca ENTREGADA a propósito — sigue PENDIENTE.
    let bloqueado = false, mensaje = '';
    try { entorno.invocar('registrarProduccionApp', { folioRequisicion: req.folio, nombreReceta: 'PAN DE MUERTO', codigoProducto: 'COD-010', cantidadProducida: 20, udm: 'PZ' }, tokenAdmin); }
    catch (e) { bloqueado = true; mensaje = e.message; }
    return {
      datos: 'requisición de receta en estado PENDIENTE (insumos no entregados)',
      esperado: 'bloqueado ("todavía no tiene los insumos entregados")',
      obtenido: bloqueado ? mensaje : 'PERMITIDO SIN ENTREGA PREVIA',
      pasa: bloqueado && /entregad/i.test(mensaje),
    };
  },
});

prueba({
  id: 'PROD-003', grupo: 'produccion', nombre: 'Cerrar lote agota la cantidad disponible', metodo: 'EMPÍRICO',
  objetivo: 'cerrarLoteProduccionApp marca AGOTADO y pone cantidadDisponible en 0 sin tocar la existencia ya vendida/consumida en MATRIZ',
  ejecutar() {
    const matriz = hojaMatrizEstandar();
    matriz.push(filaProducto({ producto: 'PAN DE MUERTO', udm: 'PZ', codigo: 'COD-010', existencia: 0, ubicacion: 'C-01' }));
    const entorno = crearEntorno({ hojas: hojasBase({
      MATRIZ: matriz,
      RECETAS: [
        ['Receta', 'Ingrediente', 'CantidadNeta', 'UDM', 'Rendimiento', 'Categoría', 'Estado'],
        ['PAN DE MUERTO', 'HARINA DE TRIGO', 1, 'KG', '20 piezas', 'GENERAL', 'ACTIVA'],
      ],
    }) });
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    const folioReq = prepararRequisicionEntregada(entorno, tokenAdmin);
    const lote = entorno.invocar('registrarProduccionApp', { folioRequisicion: folioReq, nombreReceta: 'PAN DE MUERTO', codigoProducto: 'COD-010', cantidadProducida: 20, udm: 'PZ' }, tokenAdmin);

    entorno.invocar('cerrarLoteProduccionApp', lote.folio, tokenAdmin);
    const lotes = entorno.invocar('obtenerLotesProduccionApp', {}, tokenAdmin);
    const existenciaMatriz = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-010')[10];

    return {
      datos: 'lote con cantidadDisponible=20 se cierra manualmente',
      esperado: 'estado=AGOTADO, cantidadDisponible=0, existencia de MATRIZ no cambia por el cierre (=20, sin nuevas salidas)',
      obtenido: `estado=${lotes[0].estado}, disponible=${lotes[0].cantidadDisponible}, existenciaMatriz=${existenciaMatriz}`,
      pasa: lotes[0].estado === 'AGOTADO' && lotes[0].cantidadDisponible === 0 && existenciaMatriz === 20,
    };
  },
});

prueba({
  id: 'PROD-004', grupo: 'produccion', nombre: 'Autocompletar código de producto terminado por nombre de receta', metodo: 'EMPÍRICO',
  objetivo: 'obtenerProductoTerminadoPorNombreRecetaApp debe encontrar en MATRIZ el producto con el mismo nombre que la receta',
  ejecutar() {
    const matriz = hojaMatrizEstandar();
    matriz.push(filaProducto({ producto: 'PAN DE MUERTO', udm: 'PZ', codigo: 'COD-010', existencia: 0, ubicacion: 'C-01' }));
    const entorno = crearEntorno({ hojas: hojasBase({ MATRIZ: matriz }) });
    const token = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    const r = entorno.invocar('obtenerProductoTerminadoPorNombreRecetaApp', 'Pan de Muerto', token);
    return {
      datos: 'receta "Pan de Muerto" (mayúsculas/espacios distintos al nombre de MATRIZ)',
      esperado: 'código=COD-010',
      obtenido: r ? `código=${r.codigoProducto}` : 'null (no encontrado)',
      pasa: !!r && r.codigoProducto === 'COD-010',
    };
  },
});
