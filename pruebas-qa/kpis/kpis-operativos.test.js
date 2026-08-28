'use strict';

/*
 * TAGERS WMS 2.0 — Fase 4 (KpisOperativos.gs): exactitud de inventario,
 * fill rate (Área y Sucursal), recepciones completas de compras, y
 * tiempo de surtido (Área y Sucursal). Regla de la fase: ningún KPI debe
 * inventarse cuando el denominador es 0 en la ventana pedida — estas
 * pruebas verifican tanto el cálculo real como ese caso "sin datos".
 */

const { prueba } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase } = require('../lib/datos-prueba');

function entornoConLogin(rolCorreo) {
  const entorno = crearEntorno({ hojas: hojasBase() });
  const token = entorno.invocar('crearSesion_', rolCorreo.correo, rolCorreo.nombre, rolCorreo.rol);
  return { entorno, token };
}

function admin() {
  return entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
}

// HISTORIAL_CONTEOS: Folio|Fecha|Usuario|Código|Producto|Ubicación|Sistema|Físico|Diferencia|Resultado|FechaCierre|UsuarioCierre
function agregarHistorialConteo_(entorno, { codigo, diferencia, fechaCierre }) {
  entorno.leerHoja('HISTORIAL_CONTEOS').push(['F-1', fechaCierre, 'Tester', codigo, 'PRODUCTO', 'A-01', 100, 100 + diferencia, diferencia, diferencia === 0 ? 'OK' : 'DISCREPANCIA', fechaCierre, 'Tester']);
}

// REQUISICIONES: Folio|Fecha|Área|Solicitante|Estado|Observaciones|FechaEntrega|Entregó|FechaRequerida
function agregarRequisicionArea_(entorno, { folio, fecha, estado, fechaEntrega }) {
  entorno.leerHoja('REQUISICIONES').push([folio, fecha, 'Cocina', 'Tester', estado, '', fechaEntrega || '', fechaEntrega ? 'Tester' : '', '']);
}

// DETALLE_REQUISICIONES: Folio|Código|Producto|Unidad|Solicitado|Entregado
function agregarDetalleArea_(entorno, { folio, codigo, solicitado, entregado }) {
  entorno.leerHoja('DETALLE_REQUISICIONES').push([folio, codigo, 'PRODUCTO', 'KG', solicitado, entregado]);
}

// ORDENES_COMPRA: Folio|Fecha|Proveedor|Usuario|Estado|Total|Observaciones
function agregarOC_(entorno, { folio, fecha, estado }) {
  entorno.leerHoja('ORDENES_COMPRA').push([folio, fecha, 'PROVEEDOR GENERICO', 'Tester', estado, 1000, '']);
}

// AUDITORIA: ID|FechaCreación|FechaMod|Usuario|Módulo|Acción|Folio|Código|Producto|CantidadAnterior|CantidadNueva|Diferencia|Observación
function agregarAuditoriaRecepcionOC_(entorno, { folio, fecha }) {
  entorno.leerHoja('AUDITORIA').push(['AUD-X', fecha, fecha, 'Tester', 'COMPRAS', 'RECEPCIÓN REGISTRADA', folio, '', '', 0, 0, 0, '']);
}

// Fuerza la creación perezosa de REQUISICIONES_SUCURSAL, DETALLE_REQUISICIONES_SUCURSAL
// (con sus columnas de pipeline ya extendidas) e HISTORIAL_REQUISICIONES, mismo
// patrón que INT-004 usa para PRODUCCION — corriendo una vez el flujo real completo.
function bootstrapHojasSucursal_(entorno) {
  const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
  const tokenS02 = entorno.invocar('crearSesion_', 'sucursal2@tagers.com', 'Operador S02', 'OPERADOR');
  const req = entorno.invocar('crearRequisicionSucursalApp', '', [{ codigo: 'COD-001', producto: 'HARINA DE TRIGO', unidad: 'KG', solicitado: 1 }], tokenS02);
  entorno.invocar('aprobarLineaRequisicionSucursalApp', req.folio, [{ codigo: 'COD-001', cantidadAprobada: 1 }], tokenAdmin);
  entorno.invocar('surtirRequisicionSucursalApp', req.folio, [{ codigo: 'COD-001', cantidadSurtida: 1 }], tokenAdmin);
  const despacho = entorno.invocar('despacharRequisicionSucursalApp', req.folio, tokenAdmin);
  entorno.invocar('recibirTransferenciaSucursalApp', despacho.folioTransferencia, [{ codigo: 'COD-001', cantidadRecibida: 1 }], tokenS02);
  return req.folio; // folio "de calentamiento" — se ignora en las aserciones de cada prueba
}

prueba({
  id: 'KPI-001', grupo: 'kpis', nombre: 'Exactitud de inventario: cuenta líneas sin diferencia dentro de la ventana', metodo: 'EMPÍRICO',
  objetivo: 'obtenerExactitudInventarioApp debe calcular sinDiferencia/total solo con conteos cuya FechaCierre cae dentro de diasHistorial, ignorando los de fuera de la ventana',
  ejecutar() {
    const { entorno, token } = admin();
    agregarHistorialConteo_(entorno, { codigo: 'COD-001', diferencia: 0, fechaCierre: entorno.crearFechaDesdeHoy(-1) });
    agregarHistorialConteo_(entorno, { codigo: 'COD-002', diferencia: 0, fechaCierre: entorno.crearFechaDesdeHoy(-2) });
    agregarHistorialConteo_(entorno, { codigo: 'COD-003', diferencia: 5, fechaCierre: entorno.crearFechaDesdeHoy(-3) });
    agregarHistorialConteo_(entorno, { codigo: 'COD-004', diferencia: 0, fechaCierre: entorno.crearFechaDesdeHoy(-40) }); // fuera de la ventana de 30 días
    const r = entorno.invocar('obtenerExactitudInventarioApp', token, {});
    return {
      datos: '3 conteos dentro de 30 días (2 sin diferencia, 1 con diferencia=5) + 1 conteo de hace 40 días (fuera de ventana)',
      esperado: 'totalContados=3, sinDiferencia=2, exactitudPorcentaje=66.67',
      obtenido: `total=${r.totalContados}, sinDif=${r.sinDiferencia}, pct=${r.exactitudPorcentaje}`,
      pasa: r.totalContados === 3 && r.sinDiferencia === 2 && r.exactitudPorcentaje === 66.67,
    };
  },
});

prueba({
  id: 'KPI-002', grupo: 'kpis', nombre: 'Exactitud de inventario sin conteos cerrados: null, no 0% ni 100%', metodo: 'EMPÍRICO',
  objetivo: 'Con HISTORIAL_CONTEOS vacío en la ventana, exactitudPorcentaje debe ser null — nunca inventar un porcentaje con denominador 0',
  ejecutar() {
    const { entorno, token } = admin();
    const r = entorno.invocar('obtenerExactitudInventarioApp', token, {});
    return {
      datos: 'HISTORIAL_CONTEOS vacío (catálogo base de pruebas)',
      esperado: 'totalContados=0, exactitudPorcentaje=null',
      obtenido: `total=${r.totalContados}, pct=${r.exactitudPorcentaje}`,
      pasa: r.totalContados === 0 && r.exactitudPorcentaje === null,
    };
  },
});

prueba({
  id: 'KPI-003', grupo: 'kpis', nombre: 'Fill rate de Área: agrega Solicitado/Entregado y detecta folios completos vs incompletos', metodo: 'EMPÍRICO',
  objetivo: 'obtenerFillRateRequisicionesAreaApp debe sumar Solicitado/Entregado de folios ENTREGADA en la ventana y marcar como incompleto un folio con al menos una línea con faltante',
  ejecutar() {
    const { entorno, token } = admin();
    const hoy = entorno.crearFechaDesdeHoy(0);
    agregarRequisicionArea_(entorno, { folio: 'REQ-1', fecha: hoy, estado: 'ENTREGADA', fechaEntrega: hoy });
    agregarDetalleArea_(entorno, { folio: 'REQ-1', codigo: 'COD-001', solicitado: 10, entregado: 10 });
    agregarRequisicionArea_(entorno, { folio: 'REQ-2', fecha: hoy, estado: 'ENTREGADA', fechaEntrega: hoy });
    agregarDetalleArea_(entorno, { folio: 'REQ-2', codigo: 'COD-002', solicitado: 10, entregado: 6 });
    // Requisición PENDIENTE: no debe contarse en absoluto.
    agregarRequisicionArea_(entorno, { folio: 'REQ-3', fecha: hoy, estado: 'PENDIENTE', fechaEntrega: '' });
    agregarDetalleArea_(entorno, { folio: 'REQ-3', codigo: 'COD-003', solicitado: 100, entregado: 0 });

    const r = entorno.invocar('obtenerFillRateRequisicionesAreaApp', token, {});
    return {
      datos: 'REQ-1 ENTREGADA completa (10/10), REQ-2 ENTREGADA con faltante (6/10), REQ-3 PENDIENTE (no cuenta)',
      esperado: 'folios=2, solicitado=20, entregado=16, fillRatePorcentaje=80, folioCompletos=1',
      obtenido: `folios=${r.folios}, sol=${r.solicitado}, ent=${r.entregado}, pct=${r.fillRatePorcentaje}, completos=${r.folioCompletos}`,
      pasa: r.folios === 2 && r.solicitado === 20 && r.entregado === 16 && r.fillRatePorcentaje === 80 && r.folioCompletos === 1,
    };
  },
});

prueba({
  id: 'KPI-004', grupo: 'kpis', nombre: 'Fill rate de Área sin folios entregados en la ventana: null', metodo: 'EMPÍRICO',
  objetivo: 'Sin ningún folio ENTREGADA en la ventana, fillRatePorcentaje debe ser null, no 0%',
  ejecutar() {
    const { entorno, token } = admin();
    const r = entorno.invocar('obtenerFillRateRequisicionesAreaApp', token, {});
    return {
      datos: 'REQUISICIONES vacío',
      esperado: 'folios=0, fillRatePorcentaje=null',
      obtenido: `folios=${r.folios}, pct=${r.fillRatePorcentaje}`,
      pasa: r.folios === 0 && r.fillRatePorcentaje === null,
    };
  },
});

prueba({
  id: 'KPI-005', grupo: 'kpis', nombre: 'Fill rate de Sucursal: toma el máximo entre Entregado (heredado) y lo realmente recibido vía transferencia (pipeline)', metodo: 'EMPÍRICO',
  objetivo: 'DETALLE_REQUISICIONES_SUCURSAL.Recibido nunca se escribe en el flujo real (recibirTransferenciaSucursalApp solo llena TRANSFERENCIAS_DETALLE) — la función debe juntar TRANSFERENCIAS con TRANSFERENCIAS_DETALLE para el flujo de pipeline, y usar la columna Entregado para el flujo heredado',
  ejecutar() {
    const { entorno } = admin();
    bootstrapHojasSucursal_(entorno); // crea las hojas con todas sus columnas
    // SEG-02: bootstrapHojasSucursal_ crea su propia sesión de admin por
    // dentro — con sesión única por usuario, eso invalida el token de
    // arriba. Se saca uno nuevo, ya después del bootstrap, para la
    // llamada real de esta prueba.
    const token = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    const hoy = entorno.crearFechaDesdeHoy(0);

    // Flujo heredado: fila con Entregado (col F, índice 5) lleno.
    entorno.leerHoja('REQUISICIONES_SUCURSAL').push(['REQ-SUC-LEGACY', hoy, 'S02', 'Tester', 'ENTREGADA', '', hoy, 'Tester', '']);
    entorno.leerHoja('DETALLE_REQUISICIONES_SUCURSAL').push(['REQ-SUC-LEGACY', 'COD-001', 'HARINA', 'KG', 10, 10, 0, 0, 0, 0, 0, 0, 0, '', '']);

    // Flujo de pipeline: DETALLE_REQUISICIONES_SUCURSAL.Entregado queda en 0 (nunca se llena en este flujo);
    // lo realmente recibido vive en TRANSFERENCIAS_DETALLE, unido por FolioTransferencia -> FolioRequisicion.
    entorno.leerHoja('REQUISICIONES_SUCURSAL').push(['REQ-SUC-PIPE', hoy, 'S02', 'Tester', 'RECIBIDA', '', '', '', '']);
    entorno.leerHoja('DETALLE_REQUISICIONES_SUCURSAL').push(['REQ-SUC-PIPE', 'COD-002', 'AZUCAR', 'KG', 20, 0, 0, 0, 0, 20, 20, 20, 0, 'APROBADA', '']);
    entorno.leerHoja('TRANSFERENCIAS').push(['TRF-TEST', 'REQ-SUC-PIPE', 'S01', 'S02', hoy, 'Tester', 'RECIBIDA']);
    entorno.leerHoja('TRANSFERENCIAS_DETALLE').push(['TRF-TEST', 'COD-002', 'AZUCAR', 'KG', 20, 20]);

    const r = entorno.invocar('obtenerFillRateRequisicionesSucursalApp', token, {});
    return {
      datos: 'REQ-SUC-LEGACY (Entregado=10/10) + REQ-SUC-PIPE (Recibido real vía TRANSFERENCIAS_DETALLE=20/20), más 1 folio de calentamiento (1/1)',
      esperado: 'solicitado=31, entregado=31, fillRatePorcentaje=100 (incluyendo el folio de calentamiento del bootstrap)',
      obtenido: `folios=${r.folios}, sol=${r.solicitado}, ent=${r.entregado}, pct=${r.fillRatePorcentaje}`,
      pasa: r.folios === 3 && r.solicitado === 31 && r.entregado === 31 && r.fillRatePorcentaje === 100,
    };
  },
});

prueba({
  id: 'KPI-006', grupo: 'kpis', nombre: 'Recepciones completas de compras: distingue recibidas de un solo golpe vs. en varias entregas', metodo: 'EMPÍRICO',
  objetivo: 'obtenerRecepcionesCompletasComprasApp debe contar OC con alguna recepción, cuántas terminaron RECIBIDA, y de esas cuántas se recibieron en una sola recepción (1 fila de auditoría) vs. varias',
  ejecutar() {
    const { entorno, token } = admin();
    const hoy = entorno.crearFechaDesdeHoy(0);
    agregarOC_(entorno, { folio: 'OC-1', fecha: hoy, estado: 'RECIBIDA' });
    agregarAuditoriaRecepcionOC_(entorno, { folio: 'OC-1', fecha: hoy });

    agregarOC_(entorno, { folio: 'OC-2', fecha: hoy, estado: 'RECIBIDA' });
    agregarAuditoriaRecepcionOC_(entorno, { folio: 'OC-2', fecha: entorno.crearFechaDesdeHoy(-2) });
    agregarAuditoriaRecepcionOC_(entorno, { folio: 'OC-2', fecha: hoy });

    agregarOC_(entorno, { folio: 'OC-3', fecha: hoy, estado: 'PARCIAL' });
    agregarAuditoriaRecepcionOC_(entorno, { folio: 'OC-3', fecha: hoy });

    const r = entorno.invocar('obtenerRecepcionesCompletasComprasApp', token, {});
    return {
      datos: 'OC-1 RECIBIDA en 1 recepción, OC-2 RECIBIDA en 2 recepciones, OC-3 todavía PARCIAL',
      esperado: 'ordenesConRecepcion=3, ordenesCompletas=2, ordenesEnUnaSolaRecepcion=1',
      obtenido: `total=${r.ordenesConRecepcion}, completas=${r.ordenesCompletas}, unaSola=${r.ordenesEnUnaSolaRecepcion}`,
      pasa: r.ordenesConRecepcion === 3 && r.ordenesCompletas === 2 && r.ordenesEnUnaSolaRecepcion === 1,
    };
  },
});

prueba({
  id: 'KPI-007', grupo: 'kpis', nombre: 'Tiempo de surtido de Área: promedio en horas/días entre creación y entrega', metodo: 'EMPÍRICO',
  objetivo: 'obtenerTiempoSurtidoAreaApp debe calcular el promedio de horas entre Fecha y FechaEntrega para folios ENTREGADA',
  ejecutar() {
    const { entorno, token } = admin();
    agregarRequisicionArea_(entorno, { folio: 'REQ-T1', fecha: entorno.crearFechaDesdeHoy(-2), estado: 'ENTREGADA', fechaEntrega: entorno.crearFechaDesdeHoy(0) });
    const r = entorno.invocar('obtenerTiempoSurtidoAreaApp', token, {});
    return {
      datos: 'REQ-T1: creada hace 2 días, entregada hoy',
      esperado: 'foliosEvaluados=1, diasPromedio=2',
      obtenido: `folios=${r.foliosEvaluados}, dias=${r.diasPromedio}, horas=${r.horasPromedio}`,
      pasa: r.foliosEvaluados === 1 && r.diasPromedio === 2 && r.horasPromedio === 48,
    };
  },
});

prueba({
  id: 'KPI-008', grupo: 'kpis', nombre: 'Tiempo de surtido de Sucursal: cubre tanto el flujo heredado como el de pipeline, y excluye recepciones parciales/con incidencia', metodo: 'EMPÍRICO',
  objetivo: 'obtenerTiempoSurtidoSucursalApp debe medir tiempo en el flujo heredado (FechaEntrega) y en el de pipeline (última RECEPCIÓN REGISTRADA del historial), y NO contar folios RECIBIDA_PARCIAL/CON_INCIDENCIA (cierre ambiguo)',
  ejecutar() {
    const { entorno } = admin();
    bootstrapHojasSucursal_(entorno);
    // SEG-02: mismo ajuste que KPI-005 — token fresco después del bootstrap.
    const token = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');

    entorno.leerHoja('REQUISICIONES_SUCURSAL').push(['REQ-T-LEGACY', entorno.crearFechaDesdeHoy(-3), 'S02', 'Tester', 'ENTREGADA', '', entorno.crearFechaDesdeHoy(0), 'Tester', '']);

    entorno.leerHoja('REQUISICIONES_SUCURSAL').push(['REQ-T-PIPE', entorno.crearFechaDesdeHoy(-1), 'S02', 'Tester', 'RECIBIDA', '', '', '', '']);
    entorno.leerHoja('HISTORIAL_REQUISICIONES').push(['REQ-T-PIPE', entorno.crearFechaDesdeHoy(0), 'Tester', 'RECEPCIÓN REGISTRADA', 'EN_TRANSITO', 'RECIBIDA', '']);

    // RECIBIDA_PARCIAL: no debe entrar al promedio pese a tener una fila de historial.
    entorno.leerHoja('REQUISICIONES_SUCURSAL').push(['REQ-T-PARCIAL', entorno.crearFechaDesdeHoy(-1), 'S02', 'Tester', 'RECIBIDA_PARCIAL', '', '', '', '']);
    entorno.leerHoja('HISTORIAL_REQUISICIONES').push(['REQ-T-PARCIAL', entorno.crearFechaDesdeHoy(0), 'Tester', 'RECEPCIÓN REGISTRADA', 'EN_TRANSITO', 'RECIBIDA_PARCIAL', '']);

    const r = entorno.invocar('obtenerTiempoSurtidoSucursalApp', token, {});
    // El folio de calentamiento del bootstrap también cuenta (tiempo ~0 días, mismo día).
    return {
      datos: 'REQ-T-LEGACY (3 días, heredado), REQ-T-PIPE (1 día, pipeline), REQ-T-PARCIAL (no debe contarse) + 1 folio de calentamiento',
      esperado: 'foliosEvaluados=3 (calentamiento + LEGACY + PIPE), RECIBIDA_PARCIAL excluido',
      obtenido: `folios=${r.foliosEvaluados}, dias=${r.diasPromedio}`,
      pasa: r.foliosEvaluados === 3,
    };
  },
});

prueba({
  id: 'KPI-009', grupo: 'kpis', nombre: 'Un operador de área no puede ver los KPIs operativos', metodo: 'EMPÍRICO',
  objetivo: 'obtenerKpisOperativosApp (y cada función individual) debe rechazar a un usuario que no sea Admin/Almacén, mismo criterio que ya usa obtenerRequisicionesPendientesApp',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Operador Cocina', rol: 'OPERADOR' });
    let error = null;
    try { entorno.invocar('obtenerKpisOperativosApp', token, {}); } catch(e) { error = e.message; }
    return {
      datos: 'token de OPERADOR de área (Cocina)',
      esperado: 'lanza un error explícito, no regresa datos',
      obtenido: `error=${error}`,
      pasa: !!error && /almacén|admin/i.test(error),
    };
  },
});

prueba({
  id: 'KPI-010', grupo: 'kpis', nombre: 'El agregador junta los 6 KPIs sin recalcular su lógica', metodo: 'EMPÍRICO',
  objetivo: 'obtenerKpisOperativosApp debe regresar los 6 sub-objetos con exactamente los mismos valores que llamar cada función por separado',
  ejecutar() {
    const { entorno, token } = admin();
    agregarHistorialConteo_(entorno, { codigo: 'COD-001', diferencia: 0, fechaCierre: entorno.crearFechaDesdeHoy(0) });
    const individual = entorno.invocar('obtenerExactitudInventarioApp', token, {});
    const agregado = entorno.invocar('obtenerKpisOperativosApp', token, {});
    const tieneLlaves = ['exactitudInventario','fillRateArea','fillRateSucursal','recepcionesCompras','tiempoSurtidoArea','tiempoSurtidoSucursal'].every(k => k in agregado);
    return {
      datos: '1 conteo cerrado sin diferencia',
      esperado: 'agregado.exactitudInventario coincide con la llamada individual, y las 6 llaves existen',
      obtenido: `llaves=${tieneLlaves}, exactitudCoincide=${JSON.stringify(agregado.exactitudInventario) === JSON.stringify(individual)}`,
      pasa: tieneLlaves && JSON.stringify(agregado.exactitudInventario) === JSON.stringify(individual),
    };
  },
});
