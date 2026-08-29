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
  id: 'PROD-005', grupo: 'produccion', nombre: 'Registrar producción calcula costo de insumos y actualiza el costo del producto terminado', metodo: 'EMPÍRICO',
  objetivo: 'PROD-01: registrarProduccionApp debe sumar el costo de HARINA DE TRIGO (costo=10/KG en el fixture estándar) por las tandas solicitadas, guardarlo en PRODUCCION y propagar el costo unitario a MATRIZ vía procesarCambioPrecioProducto_',
  ejecutar() {
    const matriz = hojaMatrizEstandar(); // COD-001 HARINA DE TRIGO: costo=10/KG, existencia=100
    matriz.push(filaProducto({ producto: 'PAN DE MUERTO', udm: 'PZ', codigo: 'COD-010', existencia: 0, ubicacion: 'C-01', costo: 0 }));
    const entorno = crearEntorno({ hojas: hojasBase({
      MATRIZ: matriz,
      RECETAS: [
        ['Receta', 'Ingrediente', 'CantidadNeta', 'UDM', 'Rendimiento', 'Categoría', 'Estado'],
        ['PAN DE MUERTO', 'HARINA DE TRIGO', 2, 'KG', '20 piezas', 'GENERAL', 'ACTIVA'],
      ],
    }) });
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    const req = entorno.invocar('crearRequisicionRecetaApp', '', [{ codigoReceta: 'REC-0001', cantidadSolicitada: 3 }], tokenAdmin);
    const filaReq = entorno.leerHoja('REQUISICIONES').find(f => f[0] === req.folio);
    filaReq[4] = 'ENTREGADA';

    const r = entorno.invocar('registrarProduccionApp', {
      folioRequisicion: req.folio, nombreReceta: 'PAN DE MUERTO', codigoProducto: 'COD-010', cantidadProducida: 60, udm: 'PZ',
    }, tokenAdmin);

    const lotes = entorno.invocar('obtenerLotesProduccionApp', {}, tokenAdmin);
    const costoMatriz = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-010')[17];
    const historial = entorno.leerHoja('HISTORIAL_PRECIOS').length - 1;

    return {
      datos: '2 KG harina (costo=10/KG) × 3 tandas solicitadas = $60 de insumos, para 60 PZ producidas',
      esperado: 'valorInsumosConsumidos=60, costoUnitarioProducido=1, MATRIZ COD-010 costo=1, 1 fila nueva en HISTORIAL_PRECIOS',
      obtenido: `folio=${r.folio}, valorInsumos=${lotes[0].valorInsumosConsumidos}, costoUnitario=${lotes[0].costoUnitarioProducido}, costoMatriz=${costoMatriz}, historial=${historial}`,
      pasa: lotes[0].valorInsumosConsumidos === 60 && lotes[0].costoUnitarioProducido === 1 && costoMatriz === 1 && historial === 1,
    };
  },
});

prueba({
  id: 'PROD-006', grupo: 'produccion', nombre: 'Costeo incompleto no sobreescribe el costo maestro del producto terminado', metodo: 'EMPÍRICO',
  objetivo: 'PROD-01: si un ingrediente de la receta no existe en MATRIZ (sin costo conocido), el lote se registra igual pero NO se llama a procesarCambioPrecioProducto_ — evita corromper el costo maestro con datos incompletos',
  ejecutar() {
    const matriz = hojaMatrizEstandar();
    matriz.push(filaProducto({ producto: 'PAN DE MUERTO', udm: 'PZ', codigo: 'COD-010', existencia: 0, ubicacion: 'C-01', costo: 5 }));
    const entorno = crearEntorno({ hojas: hojasBase({
      MATRIZ: matriz,
      RECETAS: [
        ['Receta', 'Ingrediente', 'CantidadNeta', 'UDM', 'Rendimiento', 'Categoría', 'Estado'],
        ['PAN DE MUERTO', 'INGREDIENTE FANTASMA', 1, 'KG', '20 piezas', 'GENERAL', 'ACTIVA'],
      ],
    }) });
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    const folioReq = prepararRequisicionEntregada(entorno, tokenAdmin);

    entorno.invocar('registrarProduccionApp', {
      folioRequisicion: folioReq, nombreReceta: 'PAN DE MUERTO', codigoProducto: 'COD-010', cantidadProducida: 20, udm: 'PZ',
    }, tokenAdmin);

    const costoMatriz = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-010')[17];
    const historial = entorno.leerHoja('HISTORIAL_PRECIOS').length - 1;

    return {
      datos: 'receta con un ingrediente que no existe en MATRIZ (costo desconocido)',
      esperado: 'costo de COD-010 en MATRIZ permanece en 5 (sin cambios), sin filas nuevas en HISTORIAL_PRECIOS',
      obtenido: `costoMatriz=${costoMatriz}, historial=${historial}`,
      pasa: costoMatriz === 5 && historial === 0,
    };
  },
});

prueba({
  id: 'PROD-007', grupo: 'produccion', nombre: 'Producir menos de lo esperado calcula la merma de producción', metodo: 'EMPÍRICO',
  objetivo: 'PROD-02: registrarProduccionApp debe comparar el rendimiento teórico (RECETAS.Rendimiento × tandas solicitadas, vía parsearRendimiento_) contra lo realmente producido, y guardar la diferencia como merma',
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
    const folioReq = prepararRequisicionEntregada(entorno, tokenAdmin); // 1 tanda solicitada → 20 PZ esperadas

    const r = entorno.invocar('registrarProduccionApp', {
      folioRequisicion: folioReq, nombreReceta: 'PAN DE MUERTO', codigoProducto: 'COD-010', cantidadProducida: 15, udm: 'PZ',
    }, tokenAdmin);

    const lotes = entorno.invocar('obtenerLotesProduccionApp', {}, tokenAdmin);

    return {
      datos: 'rendimiento teórico "20 piezas" × 1 tanda solicitada, pero solo se produjeron 15 PZ',
      esperado: 'rendimientoEsperadoTotal=20, mermaProduccion=5, mermaPorcentaje=25',
      obtenido: `folio=${r.folio}, esperado=${lotes[0].rendimientoEsperadoTotal}, merma=${lotes[0].mermaProduccion}, mermaPct=${lotes[0].mermaPorcentaje}`,
      pasa: lotes[0].rendimientoEsperadoTotal === 20 && lotes[0].mermaProduccion === 5 && lotes[0].mermaPorcentaje === 25,
    };
  },
});

prueba({
  id: 'PROD-008', grupo: 'produccion', nombre: 'Producir lo esperado (o más) no genera merma negativa ni inventada', metodo: 'EMPÍRICO',
  objetivo: 'PROD-02: si lo producido alcanza o supera el rendimiento teórico, la merma debe quedar en 0 — nunca un número negativo',
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

    entorno.invocar('registrarProduccionApp', {
      folioRequisicion: folioReq, nombreReceta: 'PAN DE MUERTO', codigoProducto: 'COD-010', cantidadProducida: 22, udm: 'PZ',
    }, tokenAdmin);

    const lotes = entorno.invocar('obtenerLotesProduccionApp', {}, tokenAdmin);

    return {
      datos: 'rendimiento teórico "20 piezas" × 1 tanda, pero se produjeron 22 PZ (por encima de lo esperado)',
      esperado: 'mermaProduccion=0, mermaPorcentaje=0 (no un número negativo)',
      obtenido: `merma=${lotes[0].mermaProduccion}, mermaPct=${lotes[0].mermaPorcentaje}`,
      pasa: lotes[0].mermaProduccion === 0 && lotes[0].mermaPorcentaje === 0,
    };
  },
});

prueba({
  id: 'PROD-009', grupo: 'produccion', nombre: 'Rendimiento no parseable no inventa una merma', metodo: 'EMPÍRICO',
  objetivo: 'PROD-02: si RECETAS.Rendimiento no trae un número reconocible (texto libre sin cantidad), no se calcula rendimiento esperado ni merma — se guardan en 0 en vez de un dato inventado',
  ejecutar() {
    const matriz = hojaMatrizEstandar();
    matriz.push(filaProducto({ producto: 'PAN DE MUERTO', udm: 'PZ', codigo: 'COD-010', existencia: 0, ubicacion: 'C-01' }));
    const entorno = crearEntorno({ hojas: hojasBase({
      MATRIZ: matriz,
      RECETAS: [
        ['Receta', 'Ingrediente', 'CantidadNeta', 'UDM', 'Rendimiento', 'Categoría', 'Estado'],
        ['PAN DE MUERTO', 'HARINA DE TRIGO', 1, 'KG', 'una tanda', 'GENERAL', 'ACTIVA'], // sin número
      ],
    }) });
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    const folioReq = prepararRequisicionEntregada(entorno, tokenAdmin);

    entorno.invocar('registrarProduccionApp', {
      folioRequisicion: folioReq, nombreReceta: 'PAN DE MUERTO', codigoProducto: 'COD-010', cantidadProducida: 20, udm: 'PZ',
    }, tokenAdmin);

    const lotes = entorno.invocar('obtenerLotesProduccionApp', {}, tokenAdmin);

    return {
      datos: 'Rendimiento="una tanda" (sin número al inicio)',
      esperado: 'rendimientoEsperadoTotal=0, mermaProduccion=0, mermaPorcentaje=0 — el lote se registra igual',
      obtenido: `esperado=${lotes[0].rendimientoEsperadoTotal}, merma=${lotes[0].mermaProduccion}, mermaPct=${lotes[0].mermaPorcentaje}`,
      pasa: lotes[0].rendimientoEsperadoTotal === 0 && lotes[0].mermaProduccion === 0 && lotes[0].mermaPorcentaje === 0,
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

prueba({
  id: 'PROD-010', grupo: 'produccion', nombre: 'ARQ-03: el costo del producto terminado se actualiza con PROMEDIO PONDERADO, no con el costo del lote solo', metodo: 'EMPÍRICO',
  objetivo: 'Cuando el producto terminado YA tenía existencia y costo antes de este lote, procesarCambioPrecioProducto_ debe recibir el promedio ponderado entre lo que ya había (a su costo) y este lote (a su costoUnitarioProducido) — el costo del lote guardado en PRODUCCION.costoUnitarioProducido se mantiene sin tocar, solo cambia lo que se escribe en MATRIZ',
  ejecutar() {
    const matriz = hojaMatrizEstandar();
    // PAN DE MUERTO ya tenía 40 PZ en existencia a un costo de $2 c/u.
    matriz.push(filaProducto({ producto: 'PAN DE MUERTO', udm: 'PZ', codigo: 'COD-010', existencia: 40, costo: 2, ubicacion: 'C-01' }));
    const entorno = crearEntorno({ hojas: hojasBase({
      MATRIZ: matriz,
      RECETAS: [
        ['Receta', 'Ingrediente', 'CantidadNeta', 'UDM', 'Rendimiento', 'Categoría', 'Estado'],
        ['PAN DE MUERTO', 'HARINA DE TRIGO', 2, 'KG', '20 piezas', 'GENERAL', 'ACTIVA'], // 2 KG × $10/KG = $20 por tanda
      ],
    }) });
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    const folioReq = prepararRequisicionEntregada(entorno, tokenAdmin); // 1 tanda solicitada

    const r = entorno.invocar('registrarProduccionApp', {
      folioRequisicion: folioReq, nombreReceta: 'PAN DE MUERTO', codigoProducto: 'COD-010', cantidadProducida: 20, udm: 'PZ',
    }, tokenAdmin);

    const lotes = entorno.invocar('obtenerLotesProduccionApp', {}, tokenAdmin);
    const costoMatriz = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-010')[17];

    return {
      datos: 'PAN DE MUERTO: existencia previa=40 PZ a $2, + este lote produce 20 PZ a $1/PZ (costo propio del lote)',
      esperado: 'PRODUCCION.costoUnitarioProducido=1 (sin tocar), MATRIZ.CostoUnitario=1.67 ((40×2 + 20×1)/60)',
      obtenido: `folio=${r.folio}, costoLote=${lotes[0].costoUnitarioProducido}, costoMatriz=${costoMatriz}`,
      pasa: lotes[0].costoUnitarioProducido === 1 && costoMatriz === 1.67,
    };
  },
});

prueba({
  id: 'PROD-011', grupo: 'produccion', nombre: 'Fase 3e: costo por receta agrega varios lotes ponderando por cuánto produjo cada uno', metodo: 'EMPÍRICO',
  objetivo: 'obtenerCostoPorRecetaApp debe sumar valorInsumosConsumidos y cantidadProducida de todos los lotes de una receta en el periodo, y calcular el costo promedio por unidad como el total ponderado (no un promedio simple de los costos unitarios de cada lote)',
  ejecutar() {
    const matriz = hojaMatrizEstandar(); // COD-001 HARINA: costo=10/KG
    matriz.push(filaProducto({ producto: 'PAN DE MUERTO', udm: 'PZ', codigo: 'COD-010', existencia: 0, ubicacion: 'C-01' }));
    const entorno = crearEntorno({ hojas: hojasBase({
      MATRIZ: matriz,
      RECETAS: [
        ['Receta', 'Ingrediente', 'CantidadNeta', 'UDM', 'Rendimiento', 'Categoría', 'Estado'],
        ['PAN DE MUERTO', 'HARINA DE TRIGO', 1, 'KG', '10 piezas', 'GENERAL', 'ACTIVA'], // $10 por tanda
      ],
    }) });
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');

    // Lote 1: 1 tanda ($10 de insumos), produce 10 PZ → $1/PZ.
    const folioReq1 = prepararRequisicionEntregada(entorno, tokenAdmin);
    entorno.invocar('registrarProduccionApp', { folioRequisicion: folioReq1, nombreReceta: 'PAN DE MUERTO', codigoProducto: 'COD-010', cantidadProducida: 10, udm: 'PZ' }, tokenAdmin);

    // Lote 2: 2 tandas ($20 de insumos), produce 15 PZ → $1.33/PZ.
    const req2 = entorno.invocar('crearRequisicionRecetaApp', '', [{ codigoReceta: 'REC-0001', cantidadSolicitada: 2 }], tokenAdmin);
    entorno.leerHoja('REQUISICIONES').find(f => f[0] === req2.folio)[4] = 'ENTREGADA';
    entorno.invocar('registrarProduccionApp', { folioRequisicion: req2.folio, nombreReceta: 'PAN DE MUERTO', codigoProducto: 'COD-010', cantidadProducida: 15, udm: 'PZ' }, tokenAdmin);

    const costos = entorno.invocar('obtenerCostoPorRecetaApp', 30, tokenAdmin);
    const panDeMuerto = costos.find(c => c.receta === 'PAN DE MUERTO');

    return {
      datos: 'Lote 1: $10 insumos / 10 PZ. Lote 2: $20 insumos / 15 PZ. Total: $30 insumos / 25 PZ',
      esperado: 'lotes=2, cantidadTotalProducida=25, valorTotalInsumos=30, costoPromedioPorUnidad=1.2 (30/25, NO el promedio simple de 1 y 1.33)',
      obtenido: panDeMuerto ? `lotes=${panDeMuerto.lotes}, cantidad=${panDeMuerto.cantidadTotalProducida}, valor=${panDeMuerto.valorTotalInsumos}, promedio=${panDeMuerto.costoPromedioPorUnidad}` : 'PAN DE MUERTO no aparece',
      pasa: !!panDeMuerto && panDeMuerto.lotes === 2 && panDeMuerto.cantidadTotalProducida === 25 &&
        panDeMuerto.valorTotalInsumos === 30 && panDeMuerto.costoPromedioPorUnidad === 1.2,
    };
  },
});

prueba({
  id: 'PROD-012', grupo: 'produccion', nombre: 'Fase 3e: valor perdido por merma combina merma regular y merma de producción', metodo: 'EMPÍRICO',
  objetivo: 'obtenerValorPerdidoPorMermaApp debe sumar el valor de las mermas regulares (Mermas.gs, valorizadas a su costo de MATRIZ) con el valor de la merma de producción (PROD-02, valorizada al costoUnitarioProducido de CADA lote) en un solo total, sin recalcular ninguna de las dos por su cuenta',
  ejecutar() {
    const matriz = hojaMatrizEstandar(); // COD-001 HARINA: costo=10/KG, existencia=100
    matriz.push(filaProducto({ producto: 'PAN DE MUERTO', udm: 'PZ', codigo: 'COD-010', existencia: 0, ubicacion: 'C-01' }));
    const entorno = crearEntorno({ hojas: hojasBase({
      MATRIZ: matriz,
      RECETAS: [
        ['Receta', 'Ingrediente', 'CantidadNeta', 'UDM', 'Rendimiento', 'Categoría', 'Estado'],
        ['PAN DE MUERTO', 'HARINA DE TRIGO', 2, 'KG', '20 piezas', 'GENERAL', 'ACTIVA'], // $20 por tanda
      ],
    }) });
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');

    // Merma regular: 2 KG de HARINA dañados → valor = 2 × $10 = $20.
    entorno.invocar('registrarMermaApp', 'COD-001', 2, 'PRODUCTO DAÑADO', '', '', tokenAdmin);

    // Merma de producción: se esperaban 20 PZ, se produjeron 15 (merma=5) a $1.33/PZ.
    const folioReq = prepararRequisicionEntregada(entorno, tokenAdmin);
    entorno.invocar('registrarProduccionApp', { folioRequisicion: folioReq, nombreReceta: 'PAN DE MUERTO', codigoProducto: 'COD-010', cantidadProducida: 15, udm: 'PZ' }, tokenAdmin);

    const perdida = entorno.invocar('obtenerValorPerdidoPorMermaApp', 30, tokenAdmin);

    return {
      datos: 'merma regular=$20 (2 KG harina) + merma de producción=5 PZ × $1.33 = $6.65',
      esperado: 'mermaRegular.valorTotal=20, mermaProduccion.valorTotal=6.65, mermaProduccion.lotesConMerma=1, valorTotalPerdido=26.65',
      obtenido: `regular=${perdida.mermaRegular.valorTotal}, produccion=${perdida.mermaProduccion.valorTotal}, lotesConMerma=${perdida.mermaProduccion.lotesConMerma}, total=${perdida.valorTotalPerdido}`,
      pasa: perdida.mermaRegular.valorTotal === 20 && perdida.mermaProduccion.valorTotal === 6.65 &&
        perdida.mermaProduccion.lotesConMerma === 1 && perdida.valorTotalPerdido === 26.65,
    };
  },
});

prueba({
  id: 'PROD-013', grupo: 'produccion', nombre: 'PROD-04: trazabilidad de lote hacia adelante rastrea solo las entregas donde SÍ se anotó el lote', metodo: 'EMPÍRICO',
  objetivo: 'obtenerTrazabilidadLoteApp debe listar las salidas de la requisición de Área que anotaron el folio del lote, sumar unidadesRastreadas, y reportar el resto como unidadesSinRastrear en vez de inventarlo — una entrega sin lote anotado no debe aparecer como rastreada',
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
    const folioReqReceta = prepararRequisicionEntregada(entorno, tokenAdmin);
    const lote = entorno.invocar('registrarProduccionApp', { folioRequisicion: folioReqReceta, nombreReceta: 'PAN DE MUERTO', codigoProducto: 'COD-010', cantidadProducida: 20, udm: 'PZ' }, tokenAdmin);

    // Se entrega el lote a Cocina en 2 movimientos: uno CON lote anotado (15) y otro SIN anotar (5).
    const tokenCocina = entorno.invocar('crearSesion_', 'cocina@tagers.com', 'Cocina', 'OPERADOR');
    const reqArea = entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-010', producto: 'PAN DE MUERTO', unidad: 'PZ', solicitado: 20 }], tokenCocina);
    entorno.invocar('confirmarEntregaRequisicionApp', reqArea.folio, [{ codigo: 'COD-010', cantidadEntregada: 15, lote: lote.folio }], tokenAdmin);

    const reqArea2 = entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-010', producto: 'PAN DE MUERTO', unidad: 'PZ', solicitado: 5 }], tokenCocina);
    entorno.invocar('confirmarEntregaRequisicionApp', reqArea2.folio, [{ codigo: 'COD-010', cantidadEntregada: 5 }], tokenAdmin); // sin lote

    const trazabilidad = entorno.invocar('obtenerTrazabilidadLoteApp', lote.folio, tokenAdmin);

    return {
      datos: `lote ${lote.folio}: 20 PZ producidas, 15 entregadas CON el lote anotado, 5 entregadas SIN anotar`,
      esperado: 'movimientos=1 (solo la entrega anotada), unidadesRastreadas=15, unidadesSinRastrear=5',
      obtenido: `movimientos=${trazabilidad.movimientos.length}, rastreadas=${trazabilidad.unidadesRastreadas}, sinRastrear=${trazabilidad.unidadesSinRastrear}, cantidadPrimerMovimiento=${trazabilidad.movimientos[0] && trazabilidad.movimientos[0].cantidad}`,
      pasa: trazabilidad.movimientos.length === 1 && trazabilidad.unidadesRastreadas === 15 &&
        trazabilidad.unidadesSinRastrear === 5 && trazabilidad.movimientos[0].cantidad === 15,
    };
  },
});

prueba({
  id: 'PROD-014', grupo: 'produccion', nombre: 'PROD-04: un folio de lote inexistente da un error claro', metodo: 'EMPÍRICO',
  objetivo: 'obtenerTrazabilidadLoteApp no debe inventar datos para un folio que no existe en PRODUCCION',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    let bloqueado = false, mensaje = '';
    try { entorno.invocar('obtenerTrazabilidadLoteApp', 'PROD-NO-EXISTE', tokenAdmin); }
    catch (e) { bloqueado = true; mensaje = e.message; }
    return {
      datos: 'folio "PROD-NO-EXISTE" nunca se registró',
      esperado: 'bloqueado ("No se encontró el lote")',
      obtenido: bloqueado ? mensaje : 'PERMITIDO',
      pasa: bloqueado && /no se encontró el lote/i.test(mensaje),
    };
  },
});
