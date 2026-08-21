// ============================================
// KPISOPERATIVOS.GS — TAGERS WMS 2.0, Fase 4 (KPIs operativos)
// ============================================
//
// Capa 100% de LECTURA — nunca escribe en ninguna hoja. Archivo separado
// de Inteligencia.gs/FEFO.gs (mismo criterio de las fases anteriores: cada
// motor de cálculo distinto vive en su propio archivo).
//
// REGLA DE ESTE ARCHIVO (pedido explícito): "no inventar un KPI cuando no
// existan datos suficientes". Por eso CADA función regresa null en el
// campo de porcentaje/promedio cuando el denominador es 0 (nada que medir
// en la ventana pedida) — nunca 0%, nunca 100%, nunca un promedio de una
// lista vacía. El frontend debe mostrar "sin datos suficientes" cuando ve
// null, no ocultar el KPI ni inventar un valor.
//
// Todas las funciones aceptan `opciones.diasHistorial` (por defecto 30) —
// la ventana no está fija en el código.
//
// Alcance de acceso: igual que el resto de datos operativos entre
// módulos en este sistema (discrepancias, conteos, OC, requisiciones
// pendientes) — solo Admin/Almacén, mismo criterio ya usado en
// obtenerRequisicionesPendientesApp.

function requerirAccesoKpisOperativos_(token){
  const acceso = obtenerAccesoRequisicionesApp(token);
  if(!acceso.esAdmin){
    throw new Error("Solo Almacén puede ver los KPIs operativos.");
  }
}

/**
 * Exactitud de inventario: % de líneas contadas (conteo cíclico cerrado)
 * sin diferencia entre Sistema y Físico, dentro de la ventana. Fuente:
 * HISTORIAL_CONTEOS (ya es el registro de conteos YA CERRADOS — no se
 * mezcla con conteos todavía abiertos en CONTEO_CICLICO).
 */
function obtenerExactitudInventarioApp(token, opciones){

  requerirSesionActivaApp_(token);
  requerirAccesoKpisOperativos_(token);
  opciones = opciones || {};
  const diasHistorial = Number(opciones.diasHistorial) || 30;

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const desde = new Date(hoy);
  desde.setDate(desde.getDate() - diasHistorial);

  const datos = obtenerFilasHojaCacheadas_("HISTORIAL_CONTEOS");
  datos.shift();

  let total = 0;
  let sinDiferencia = 0;

  datos.forEach(f => {
    const fechaCierre = new Date(f[10]); // FechaCierre
    if(isNaN(fechaCierre.getTime())) return;
    const dia = new Date(fechaCierre);
    dia.setHours(0, 0, 0, 0);
    if(dia < desde || dia > hoy) return;

    total++;
    if((Number(f[8]) || 0) === 0) sinDiferencia++; // Diferencia
  });

  return {
    diasHistorial: diasHistorial,
    totalContados: total,
    sinDiferencia: sinDiferencia,
    exactitudPorcentaje: total > 0 ? Math.round((sinDiferencia / total) * 10000) / 100 : null
  };

}

/**
 * Fill rate de requisiciones de Área: % de lo Solicitado que realmente
 * se Entregó, y % de folios ENTREGADA que quedaron completos en cada
 * línea (sin faltantes), dentro de la ventana (por fecha de creación).
 */
function obtenerFillRateRequisicionesAreaApp(token, opciones){

  requerirSesionActivaApp_(token);
  requerirAccesoKpisOperativos_(token);
  opciones = opciones || {};
  const diasHistorial = Number(opciones.diasHistorial) || 30;

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const desde = new Date(hoy);
  desde.setDate(desde.getDate() - diasHistorial);

  const req = obtenerFilasHojaCacheadas_("REQUISICIONES");
  req.shift();

  const foliosEntregados = {};
  req.forEach(f => {
    if(String(f[4] || "").trim().toUpperCase() !== "ENTREGADA") return;
    const fecha = new Date(f[1]);
    if(isNaN(fecha.getTime())) return;
    const dia = new Date(fecha);
    dia.setHours(0, 0, 0, 0);
    if(dia < desde || dia > hoy) return;
    foliosEntregados[String(f[0]).trim()] = true;
  });

  if(!Object.keys(foliosEntregados).length){
    return { diasHistorial: diasHistorial, folios: 0, solicitado: 0, entregado: 0, fillRatePorcentaje: null, folioCompletos: 0, folioCompletosPorcentaje: null };
  }

  const detalle = obtenerFilasHojaCacheadas_("DETALLE_REQUISICIONES");
  detalle.shift();

  let solicitadoTotal = 0;
  let entregadoTotal = 0;
  const estadoPorFolio = {};

  detalle.forEach(f => {
    const folio = String(f[0]).trim();
    if(!foliosEntregados[folio]) return;

    const solicitado = Number(f[4]) || 0;
    const entregado = Number(f[5]) || 0;
    solicitadoTotal += solicitado;
    entregadoTotal += entregado;

    if(!estadoPorFolio[folio]) estadoPorFolio[folio] = { completo: true };
    if(entregado < solicitado) estadoPorFolio[folio].completo = false;
  });

  const folios = Object.keys(estadoPorFolio);
  const completos = folios.filter(f => estadoPorFolio[f].completo).length;

  return {
    diasHistorial: diasHistorial,
    folios: folios.length,
    solicitado: solicitadoTotal,
    entregado: entregadoTotal,
    fillRatePorcentaje: solicitadoTotal > 0 ? Math.round((entregadoTotal / solicitadoTotal) * 10000) / 100 : null,
    folioCompletos: completos,
    folioCompletosPorcentaje: folios.length > 0 ? Math.round((completos / folios.length) * 10000) / 100 : null
  };

}

// Estados de REQUISICIONES_SUCURSAL en los que ya hubo algo de entrega
// real a la sucursal — sea por el flujo heredado de un paso (ENTREGADA)
// o por el pipeline completo (RECIBIDA/RECIBIDA_PARCIAL/CON_INCIDENCIA),
// incluyendo CERRADA (una incidencia ya resuelta y archivada).
const ESTADOS_SUCURSAL_CON_ENTREGA_ = ["RECIBIDA", "RECIBIDA_PARCIAL", "CON_INCIDENCIA", "CERRADA", "ENTREGADA"];

/**
 * Fill rate de requisiciones de Sucursal — mismo concepto que el de Área,
 * pero "cuánto llegó realmente" según qué flujo se usó para esa línea:
 *   - Flujo heredado de un paso: columna Entregado de
 *     DETALLE_REQUISICIONES_SUCURSAL (índice 5).
 *   - Flujo de pipeline con transferencia: recibirTransferenciaSucursalApp
 *     ahora también acumula en la columna "Recibido" de
 *     DETALLE_REQUISICIONES_SUCURSAL (índice 12) — pero cualquier
 *     transferencia recibida ANTES de ese fix se quedó con esa columna en
 *     0/vacía para siempre (no se hizo backfill de datos históricos). Por
 *     eso esta función sigue sin confiar en esa columna: junta
 *     TRANSFERENCIAS (FolioTransferencia→FolioRequisicion) con
 *     TRANSFERENCIAS_DETALLE (CantidadRecibida por código), que es
 *     confiable para toda la historia, no solo para lo recibido después
 *     del fix.
 * Se toma el máximo de las dos fuentes por línea — en la práctica solo
 * una de las dos aplica, nunca ambas, porque una requisición sigue un
 * solo flujo de principio a fin.
 */
function obtenerFillRateRequisicionesSucursalApp(token, opciones){

  requerirSesionActivaApp_(token);
  requerirAccesoKpisOperativos_(token);
  opciones = opciones || {};
  const diasHistorial = Number(opciones.diasHistorial) || 30;

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const desde = new Date(hoy);
  desde.setDate(desde.getDate() - diasHistorial);

  const req = obtenerFilasHojaCacheadas_("REQUISICIONES_SUCURSAL");
  req.shift();

  const foliosValidos = {};
  req.forEach(f => {
    const estado = String(f[4] || "").trim().toUpperCase();
    if(ESTADOS_SUCURSAL_CON_ENTREGA_.indexOf(estado) === -1) return;
    const fecha = new Date(f[1]);
    if(isNaN(fecha.getTime())) return;
    const dia = new Date(fecha);
    dia.setHours(0, 0, 0, 0);
    if(dia < desde || dia > hoy) return;
    foliosValidos[String(f[0]).trim()] = true;
  });

  if(!Object.keys(foliosValidos).length){
    return { diasHistorial: diasHistorial, folios: 0, solicitado: 0, entregado: 0, fillRatePorcentaje: null, folioCompletos: 0, folioCompletosPorcentaje: null };
  }

  const folioTransfARequisicion = {};
  const transferencias = obtenerFilasHojaCacheadas_("TRANSFERENCIAS");
  transferencias.shift();
  transferencias.forEach(f => {
    folioTransfARequisicion[String(f[0] || "").trim()] = String(f[1] || "").trim();
  });

  const recibidoPorRequisicionCodigo_ = {};
  const transfDetalle = obtenerFilasHojaCacheadas_("TRANSFERENCIAS_DETALLE");
  transfDetalle.shift();
  transfDetalle.forEach(f => {
    const folioReq = folioTransfARequisicion[String(f[0] || "").trim()];
    if(!folioReq) return;
    const clave = folioReq + "|" + String(f[1] || "").trim();
    recibidoPorRequisicionCodigo_[clave] = (recibidoPorRequisicionCodigo_[clave] || 0) + (Number(f[5]) || 0);
  });

  const detalle = obtenerFilasHojaCacheadas_("DETALLE_REQUISICIONES_SUCURSAL");
  detalle.shift();

  let solicitadoTotal = 0;
  let entregadoTotal = 0;
  const estadoPorFolio = {};

  detalle.forEach(f => {
    const folio = String(f[0]).trim();
    if(!foliosValidos[folio]) return;

    const codigo = String(f[1] || "").trim();
    const solicitado = Number(f[4]) || 0;
    const entregadoLegacy = Number(f[5]) || 0;
    const recibidoPipeline = recibidoPorRequisicionCodigo_[folio + "|" + codigo] || 0;
    const entregadoReal = Math.max(entregadoLegacy, recibidoPipeline);

    solicitadoTotal += solicitado;
    entregadoTotal += entregadoReal;

    if(!estadoPorFolio[folio]) estadoPorFolio[folio] = { completo: true };
    if(entregadoReal < solicitado) estadoPorFolio[folio].completo = false;
  });

  const folios = Object.keys(estadoPorFolio);
  const completos = folios.filter(f => estadoPorFolio[f].completo).length;

  return {
    diasHistorial: diasHistorial,
    folios: folios.length,
    solicitado: solicitadoTotal,
    entregado: entregadoTotal,
    fillRatePorcentaje: solicitadoTotal > 0 ? Math.round((entregadoTotal / solicitadoTotal) * 10000) / 100 : null,
    folioCompletos: completos,
    folioCompletosPorcentaje: folios.length > 0 ? Math.round((completos / folios.length) * 10000) / 100 : null
  };

}

/**
 * Recepciones completas de compras: entre las OC que ya recibieron algo
 * (RECIBIDA o PARCIAL) en la ventana, % que terminaron RECIBIDA (completa,
 * tarde o temprano) y, de esas, % que se recibieron en una sola vez (una
 * sola fila "RECEPCIÓN REGISTRADA" en AUDITORIA para ese folio) — la
 * señal de qué tan seguido una compra se recibe de un solo golpe vs. en
 * varias entregas parciales.
 */
function obtenerRecepcionesCompletasComprasApp(token, opciones){

  requerirSesionActivaApp_(token);
  requerirAccesoKpisOperativos_(token);
  opciones = opciones || {};
  const diasHistorial = Number(opciones.diasHistorial) || 30;

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const desde = new Date(hoy);
  desde.setDate(desde.getDate() - diasHistorial);

  const ordenes = obtenerFilasHojaCacheadas_("ORDENES_COMPRA");
  ordenes.shift();

  const estadoPorFolio = {};
  ordenes.forEach(f => {
    const estado = String(f[4] || "").trim().toUpperCase();
    if(estado !== "RECIBIDA" && estado !== "PARCIAL") return;
    const fecha = new Date(f[1]);
    if(isNaN(fecha.getTime())) return;
    const dia = new Date(fecha);
    dia.setHours(0, 0, 0, 0);
    if(dia < desde || dia > hoy) return;
    estadoPorFolio[String(f[0]).trim()] = estado;
  });

  const folios = Object.keys(estadoPorFolio);
  if(!folios.length){
    return { diasHistorial: diasHistorial, ordenesConRecepcion: 0, ordenesCompletas: 0, completasPorcentaje: null, ordenesEnUnaSolaRecepcion: 0, enUnaSolaRecepcionPorcentaje: null };
  }

  const completas = folios.filter(f => estadoPorFolio[f] === "RECIBIDA");

  const auditoria = obtenerFilasHojaCacheadas_("AUDITORIA");
  auditoria.shift();

  const recepcionesPorFolio = {};
  auditoria.forEach(f => {
    if(String(f[4] || "").trim().toUpperCase() !== "COMPRAS") return;
    if(String(f[5] || "").trim().toUpperCase() !== "RECEPCIÓN REGISTRADA") return;
    const folio = String(f[6] || "").trim();
    if(!estadoPorFolio[folio]) return;
    recepcionesPorFolio[folio] = (recepcionesPorFolio[folio] || 0) + 1;
  });

  const enUnaSola = completas.filter(f => (recepcionesPorFolio[f] || 0) === 1).length;

  return {
    diasHistorial: diasHistorial,
    ordenesConRecepcion: folios.length,
    ordenesCompletas: completas.length,
    completasPorcentaje: Math.round((completas.length / folios.length) * 10000) / 100,
    ordenesEnUnaSolaRecepcion: enUnaSola,
    enUnaSolaRecepcionPorcentaje: completas.length > 0 ? Math.round((enUnaSola / completas.length) * 10000) / 100 : null
  };

}

/**
 * Tiempo de surtido de requisiciones de Área: horas/días entre la
 * creación (Fecha) y la entrega confirmada (FechaEntrega), para folios
 * ENTREGADA cuya FechaEntrega cae dentro de la ventana.
 */
function obtenerTiempoSurtidoAreaApp(token, opciones){

  requerirSesionActivaApp_(token);
  requerirAccesoKpisOperativos_(token);
  opciones = opciones || {};
  const diasHistorial = Number(opciones.diasHistorial) || 30;

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const desde = new Date(hoy);
  desde.setDate(desde.getDate() - diasHistorial);

  const req = obtenerFilasHojaCacheadas_("REQUISICIONES");
  req.shift();

  const tiempos = [];

  req.forEach(f => {
    if(String(f[4] || "").trim().toUpperCase() !== "ENTREGADA") return;

    const fechaCreacion = new Date(f[1]);
    const fechaEntrega = new Date(f[6]);
    if(isNaN(fechaCreacion.getTime()) || isNaN(fechaEntrega.getTime())) return;

    const dia = new Date(fechaEntrega);
    dia.setHours(0, 0, 0, 0);
    if(dia < desde || dia > hoy) return;

    const horas = (fechaEntrega - fechaCreacion) / 3600000;
    if(horas >= 0) tiempos.push(horas);
  });

  if(!tiempos.length){
    return { diasHistorial: diasHistorial, foliosEvaluados: 0, horasPromedio: null, diasPromedio: null };
  }

  const promedioHoras = tiempos.reduce((a, b) => a + b, 0) / tiempos.length;

  return {
    diasHistorial: diasHistorial,
    foliosEvaluados: tiempos.length,
    horasPromedio: Math.round(promedioHoras * 10) / 10,
    diasPromedio: Math.round((promedioHoras / 24) * 10) / 10
  };

}

/**
 * Tiempo de surtido de requisiciones de Sucursal — mismo concepto, pero
 * cubriendo los dos flujos posibles (ver nota de ESTADOS_SUCURSAL_CON_ENTREGA_):
 *   - Flujo heredado de un paso: Fecha → FechaEntrega (columna G, igual
 *     que Área).
 *   - Flujo de pipeline con transferencia: Fecha → última "RECEPCIÓN
 *     REGISTRADA" en HISTORIAL_REQUISICIONES para ese folio.
 * Deliberadamente NO se cuentan folios RECIBIDA_PARCIAL/CON_INCIDENCIA —
 * mezclar el tiempo de una recepción con incidencia con el de una
 * recepción normal daría un promedio engañoso (ver comentario de la
 * función hermana de fill rate para el porqué de incluirlas ahí sí, pero
 * no aquí: fill rate mide cantidad entregada, esto mide tiempo hasta un
 * cierre limpio).
 */
function obtenerTiempoSurtidoSucursalApp(token, opciones){

  requerirSesionActivaApp_(token);
  requerirAccesoKpisOperativos_(token);
  opciones = opciones || {};
  const diasHistorial = Number(opciones.diasHistorial) || 30;

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const desde = new Date(hoy);
  desde.setDate(desde.getDate() - diasHistorial);

  const req = obtenerFilasHojaCacheadas_("REQUISICIONES_SUCURSAL");
  req.shift();

  const porFolio = {};
  req.forEach(f => {
    const folio = String(f[0] || "").trim();
    if(!folio) return;
    porFolio[folio] = {
      fechaCreacion: new Date(f[1]),
      estado: String(f[4] || "").trim().toUpperCase(),
      fechaEntregaLegacy: f[6] ? new Date(f[6]) : null
    };
  });

  const historial = obtenerFilasHojaCacheadas_("HISTORIAL_REQUISICIONES");
  historial.shift();

  const ultimaRecepcionPorFolio = {};
  historial.forEach(f => {
    if(String(f[3] || "").trim().toUpperCase() !== "RECEPCIÓN REGISTRADA") return;
    const folio = String(f[0] || "").trim();
    const fecha = new Date(f[1]);
    if(isNaN(fecha.getTime())) return;
    if(!ultimaRecepcionPorFolio[folio] || fecha > ultimaRecepcionPorFolio[folio]){
      ultimaRecepcionPorFolio[folio] = fecha;
    }
  });

  const tiempos = [];

  Object.keys(porFolio).forEach(folio => {
    const info = porFolio[folio];
    let fechaFin = null;

    if(info.estado === "ENTREGADA" && info.fechaEntregaLegacy && !isNaN(info.fechaEntregaLegacy.getTime())){
      fechaFin = info.fechaEntregaLegacy;
    } else if(info.estado === "RECIBIDA" && ultimaRecepcionPorFolio[folio]){
      fechaFin = ultimaRecepcionPorFolio[folio];
    }

    if(!fechaFin || isNaN(info.fechaCreacion.getTime())) return;

    const dia = new Date(fechaFin);
    dia.setHours(0, 0, 0, 0);
    if(dia < desde || dia > hoy) return;

    const horas = (fechaFin - info.fechaCreacion) / 3600000;
    if(horas >= 0) tiempos.push(horas);
  });

  if(!tiempos.length){
    return { diasHistorial: diasHistorial, foliosEvaluados: 0, horasPromedio: null, diasPromedio: null };
  }

  const promedioHoras = tiempos.reduce((a, b) => a + b, 0) / tiempos.length;

  return {
    diasHistorial: diasHistorial,
    foliosEvaluados: tiempos.length,
    horasPromedio: Math.round(promedioHoras * 10) / 10,
    diasPromedio: Math.round((promedioHoras / 24) * 10) / 10
  };

}

/**
 * Agregador único para el Dashboard — una sola llamada RPC que junta los
 * 6 KPIs de esta fase. No duplica ningún cálculo, solo junta.
 */
function obtenerKpisOperativosApp(token, opciones){

  requerirSesionActivaApp_(token);
  requerirAccesoKpisOperativos_(token);
  opciones = opciones || {};

  return {
    exactitudInventario: obtenerExactitudInventarioApp(token, opciones),
    fillRateArea: obtenerFillRateRequisicionesAreaApp(token, opciones),
    fillRateSucursal: obtenerFillRateRequisicionesSucursalApp(token, opciones),
    recepcionesCompras: obtenerRecepcionesCompletasComprasApp(token, opciones),
    tiempoSurtidoArea: obtenerTiempoSurtidoAreaApp(token, opciones),
    tiempoSurtidoSucursal: obtenerTiempoSurtidoSucursalApp(token, opciones)
  };

}
