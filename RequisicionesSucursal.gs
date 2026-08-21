// ============================================
// REQUISICIONES POR SUCURSAL — Fundación multi-sucursal (Opción B)
// ============================================
//
// Flujo APARTE del de Requisiciones por Área (RequisicionesApp en
// 📁 App.gs.gs): hojas propias (REQUISICIONES_SUCURSAL /
// DETALLE_REQUISICIONES_SUCURSAL), folio con prefijo distinto ("RS-"),
// funciones propias — nada de esto toca REQUISICIONES, DETALLE_REQUISICIONES
// ni ninguna función existente de ese flujo. Funciona con el MISMO
// criterio que ya está probado ahí (servidor decide el ámbito del
// usuario, nunca el cliente; folio consecutivo protegido por lock;
// existencia se descuenta con la función central ya sucursal-consciente
// ajustarExistenciaMatrizPorDeltaValidado_), pero filtrando por
// Sucursal en vez de Área — así se prueba de punta a punta que el
// aislamiento de existencia por sucursal (EXISTENCIAS_SUCURSAL,
// agregado en la etapa anterior) funciona con un caso de uso real.
//
// No genera PDF (a diferencia de Requisiciones/Requisiciones de receta)
// — se dejó fuera a propósito en esta primera versión para no ampliar
// el alcance; se puede agregar después siguiendo el mismo patrón de
// construirHtmlRequisicion_/generarYGuardarPDFRequisicion_.

/**
 * Búsqueda de producto para Requisiciones por Sucursal — a diferencia de
 * buscarProductoParaRequisicionApp (Requisiciones por Área, que muestra
 * la existencia de MATRIZ), esta muestra la existencia REAL de la
 * sucursal del usuario que busca (server-derived vía
 * obtenerAccesoSucursalApp — nunca la manda el cliente), nunca la de
 * MATRIZ ni la de otra sucursal. Mínimo/Máximo siguen siendo del
 * catálogo (MATRIZ) — no hay todavía un mínimo/máximo por sucursal, así
 * que son el mismo valor de referencia para las 6.
 */
function buscarProductoParaRequisicionSucursalApp(texto, token){

  const acceso = obtenerAccesoSucursalApp(token);
  const busqueda = normalizarTexto_(texto);
  if(!busqueda) return [];

  const datos = obtenerFilasHojaCacheadas_("MATRIZ");
  datos.shift();

  const resultados = [];

  for(let i = 0; i < datos.length; i++){
    const f = datos[i];
    const ubicacion = String(f[9]||"").trim();
    if(ubicacionVacia_(ubicacion)) continue;

    const coincide = normalizarTexto_(f[0]).indexOf(busqueda) !== -1 || normalizarTexto_(f[4]).indexOf(busqueda) !== -1;
    if(!coincide) continue;

    const codigo = String(f[4]).trim();

    resultados.push({
      codigo: codigo,
      producto: f[0],
      udm: f[1],
      existencia: obtenerExistenciaSucursal_(codigo, acceso.sucursal),
      minimo: Number(f[11]) || 0,
      maximo: Number(f[12]) || 0
    });

    if(resultados.length >= 15) break;
  }

  return resultados;

}

function obtenerHojaRequisicionesSucursal_(){
  const ss = SpreadsheetApp.getActive();
  let hoja = ss.getSheetByName("REQUISICIONES_SUCURSAL");
  if(!hoja){
    hoja = ss.insertSheet("REQUISICIONES_SUCURSAL");
    hoja.appendRow(["Folio","Fecha","Sucursal","Solicitante","Estado","Observaciones","Fecha Entrega","Entregó","Fecha Requerida"]);
    hoja.getRange(1,1,1,9).setFontWeight("bold");
  }
  return hoja;
}

function obtenerHojaDetalleRequisicionesSucursal_(){
  const ss = SpreadsheetApp.getActive();
  let hoja = ss.getSheetByName("DETALLE_REQUISICIONES_SUCURSAL");
  if(!hoja){
    hoja = ss.insertSheet("DETALLE_REQUISICIONES_SUCURSAL");
    hoja.appendRow(["Folio","Código","Producto","Unidad","Solicitado","Entregado"]);
    hoja.getRange(1,1,1,6).setFontWeight("bold");
  }
  return hoja;
}

function generarFolioRequisicionSucursal_(){
  const hoja = obtenerHojaRequisicionesSucursal_();
  const total = hoja.getLastRow() > 1 ? hoja.getLastRow() - 1 : 0;
  return "RS-" + Utilities.formatString("%04d", total + 1);
}

/**
 * Nueva requisición para la sucursal del usuario que la crea (la
 * sucursal se toma de USUARIOS vía obtenerAccesoSucursalApp — el mismo
 * criterio anti-IDOR que ya usa crearRequisicionApp con el Área: nunca
 * se confía en un valor de sucursal mandado por el cliente).
 * items = [{codigo, producto, unidad, solicitado}]
 * fechaRequerida (opcional, string "yyyy-MM-dd"): cuándo la sucursal
 * necesita tener esto — mismo parámetro opcional al final, mismo helper
 * parsearFechaRequerida_ que usa crearRequisicionApp (📁 App.gs.gs).
 */
function crearRequisicionSucursalApp(observaciones, items, token, fechaRequerida){

  requerirSesionActivaApp_(token);

  const usuario = obtenerNombreDesdeToken(token);
  const acceso = obtenerAccesoSucursalApp(token);

  if(acceso.esTodasLasSucursales){
    throw new Error("Un usuario de Corporativo/Admin no tiene una sucursal propia para requisitar — esta pantalla es para pedir a NOMBRE de una sucursal específica.");
  }

  const validos = (items||[]).filter(it => Number(it.solicitado) > 0);
  if(!validos.length){
    throw new Error("Captura al menos una cantidad solicitada.");
  }

  const fecha = new Date();
  const fechaReq = parsearFechaRequerida_(fechaRequerida);
  let folio;

  conBloqueoApp_(function(){
    folio = generarFolioRequisicionSucursal_();
    obtenerHojaRequisicionesSucursal_().appendRow([
      folio, fecha, acceso.sucursal, usuario, "PENDIENTE", observaciones || "", "", "", fechaReq
    ]);
  });

  const filasDetalle = validos.map(it => [
    folio, it.codigo, it.producto, it.unidad || "", Number(it.solicitado), ""
  ]);

  const detalle = obtenerHojaDetalleRequisicionesSucursal_();
  detalle.getRange(detalle.getLastRow()+1, 1, filasDetalle.length, 6).setValues(filasDetalle);

  registrarAuditoria(usuario, "REQUISICIONES_SUCURSAL", "NUEVA REQUISICIÓN", folio, "", "", 0, 0,
    "Sucursal " + acceso.sucursal + " — " + filasDetalle.length + " producto(s)");

  return { folio: folio, sucursal: acceso.sucursal, productos: filasDetalle.length };

}

/**
 * Lista las requisiciones de sucursal visibles para el usuario: solo
 * las de su propia sucursal, salvo que tenga acceso a todas (ADMIN o
 * Sucursal="TODAS") — mismo criterio que obtenerRequisicionesApp.
 */
function obtenerRequisicionesSucursalApp(token){

  const acceso = obtenerAccesoSucursalApp(token);
  const hoja = obtenerHojaRequisicionesSucursal_();
  if(hoja.getLastRow() < 2) return [];

  const datos = hoja.getRange(2,1,hoja.getLastRow()-1,9).getValues();

  return datos
    .filter(f => acceso.esTodasLasSucursales || String(f[2]).trim() === String(acceso.sucursal).trim())
    .map(f => ({
      folio: f[0],
      fecha: f[1] instanceof Date ? Utilities.formatDate(f[1], Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm") : f[1],
      sucursal: f[2], solicitante: f[3], estado: f[4], observaciones: f[5],
      fechaEntrega: f[6] instanceof Date ? Utilities.formatDate(f[6], Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm") : "",
      entrego: f[7],
      fechaRequerida: f[8] instanceof Date ? Utilities.formatDate(f[8], Session.getScriptTimeZone(), "dd/MM/yyyy") : ""
    }))
    .sort((a,b) => a.folio < b.folio ? 1 : -1);

}

/**
 * Detalle de una requisición de sucursal — bloquea leer el folio de otra
 * sucursal (mismo IDOR fix que ya tiene obtenerDetalleRequisicionApp).
 * La existencia de cada producto se lee con obtenerExistenciaSucursal_,
 * es decir CONTRA LA SUCURSAL DE LA REQUISICIÓN, no contra MATRIZ en
 * general — así una sucursal solo ve su propio disponible.
 */
function obtenerDetalleRequisicionSucursalApp(folio, token){

  const req = obtenerHojaRequisicionesSucursal_();
  const datosReq = req.getRange(2,1,req.getLastRow()-1,9).getValues();
  let encabezado = null;
  datosReq.forEach(f => { if(String(f[0]) === String(folio)) encabezado = f; });

  if(!encabezado) throw new Error("No se encontró la requisición " + folio);

  const acceso = obtenerAccesoSucursalApp(token);
  if(!acceso.esTodasLasSucursales && String(encabezado[2]).trim() !== String(acceso.sucursal).trim()){
    throw new Error("No se encontró la requisición " + folio);
  }

  const sucursalReq = encabezado[2];
  const detalle = obtenerHojaDetalleRequisicionesSucursal_();
  const anchoDetalle = Math.max(detalle.getLastColumn(), 15);
  const datosDetalle = detalle.getLastRow() > 1 ? detalle.getRange(2,1,detalle.getLastRow()-1,anchoDetalle).getValues() : [];

  const items = datosDetalle
    .filter(f => String(f[0]) === String(folio))
    .map(f => {
      const codigo = String(f[1]).trim();
      const existencia = obtenerExistenciaSucursal_(codigo, sucursalReq);
      const solicitado = Number(f[4]) || 0;
      return {
        codigo: f[1], producto: f[2], unidad: f[3], solicitado: solicitado,
        existencia: existencia,
        entregarSugerido: Math.min(solicitado, existencia),
        entregado: f[5],
        // Campos del pipeline nuevo (Plano de Abastecimiento) — "" o 0 en
        // filas creadas antes de que existiera, no rompe nada.
        aprobado: Number(f[9]) || 0,
        surtido: Number(f[10]) || 0,
        enviado: Number(f[11]) || 0,
        recibido: Number(f[12]) || 0,
        estadoLinea: String(f[13]||"").trim(),
        motivoRechazo: f[14] || ""
      };
    });

  return {
    folio: encabezado[0],
    fecha: encabezado[1] instanceof Date ? Utilities.formatDate(encabezado[1], Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm") : encabezado[1],
    sucursal: sucursalReq, solicitante: encabezado[3], estado: encabezado[4], observaciones: encabezado[5],
    fechaRequerida: encabezado[8] instanceof Date ? Utilities.formatDate(encabezado[8], Session.getScriptTimeZone(), "dd/MM/yyyy") : "",
    items: items
  };

}

/**
 * Historial cronológico de una requisición de sucursal — timeline de
 * quién hizo qué (aprobación, rechazo, surtido, despacho, recepción,
 * incidencias, cierre/cancelación). HISTORIAL_REQUISICIONES ya se
 * escribe desde cada acción del pipeline; esto solo la expone para
 * lectura. Mismo chequeo de acceso por sucursal que el resto del folio.
 */
function obtenerHistorialRequisicionSucursalApp(folio, token){

  const req = obtenerHojaRequisicionesSucursal_();
  const datosReq = req.getRange(2,1,req.getLastRow()-1,9).getValues();
  let encabezado = null;
  datosReq.forEach(f => { if(String(f[0]) === String(folio)) encabezado = f; });

  if(!encabezado) throw new Error("No se encontró la requisición " + folio);

  const acceso = obtenerAccesoSucursalApp(token);
  if(!acceso.esTodasLasSucursales && String(encabezado[2]).trim() !== String(acceso.sucursal).trim()){
    throw new Error("No se encontró la requisición " + folio);
  }

  const hoja = obtenerHojaHistorialRequisiciones_();
  if(hoja.getLastRow() < 2) return [];

  const datos = hoja.getRange(2,1,hoja.getLastRow()-1,7).getValues();

  // Las filas ya quedan en orden cronológico porque se escriben con
  // appendRow en cada paso del pipeline — no hace falta reordenar.
  return datos
    .filter(f => String(f[0]) === String(folio))
    .map(f => ({
      fecha: f[1] instanceof Date ? Utilities.formatDate(f[1], Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm") : f[1],
      usuario: f[2], accion: f[3], estadoAnterior: f[4], estadoNuevo: f[5], descripcion: f[6]
    }));

}

/**
 * Datos de la transferencia asociada a una requisición (si ya se
 * despachó) — para la pestaña de tránsito/recepción del detalle.
 */
function obtenerTransferenciaPorRequisicionSucursalApp(folioRequisicion, token){
  requerirSesionActivaApp_(token);

  const transferencias = obtenerHojaTransferenciasRequisiciones_();
  if(transferencias.getLastRow() < 2) return null;
  const datos = transferencias.getRange(2,1,transferencias.getLastRow()-1,7).getValues();
  const fila = datos.find(f => String(f[1]) === String(folioRequisicion));
  if(!fila) return null;

  const folioTransferencia = fila[0];
  const detalleTransf = obtenerHojaTransferenciasDetalle_();
  const datosDetalle = detalleTransf.getLastRow() > 1 ? detalleTransf.getRange(2,1,detalleTransf.getLastRow()-1,6).getValues() : [];

  const items = datosDetalle
    .filter(f => String(f[0]) === String(folioTransferencia))
    .map(f => ({ codigo: f[1], producto: f[2], unidad: f[3], enviado: Number(f[4])||0, recibido: f[5] === "" ? "" : Number(f[5])||0 }));

  const incidenciasHoja = obtenerHojaIncidenciasRequisiciones_();
  const datosInc = incidenciasHoja.getLastRow() > 1 ? incidenciasHoja.getRange(2,1,incidenciasHoja.getLastRow()-1,15).getValues() : [];
  const incidencias = datosInc
    .filter(f => String(f[1]) === String(folioRequisicion))
    .map(f => ({
      folioIncidencia: f[0], codigo: f[3], producto: f[4], tipo: f[5],
      cantidadEnviada: f[6], cantidadRecibida: f[7], diferencia: f[8],
      estado: f[13], resolucion: f[14]
    }));

  return {
    folioTransferencia: folioTransferencia, sucursalOrigen: fila[2], sucursalDestino: fila[3],
    estado: fila[6], items: items, incidencias: incidencias
  };
}

/**
 * Confirma la entrega: descuenta existencia con la función central ya
 * sucursal-consciente (ajustarExistenciaMatrizPorDeltaValidado_) contra
 * la sucursal DE LA REQUISICIÓN, registra Kardex, y cierra el folio.
 * Solo un usuario con acceso a todas las sucursales puede confirmar
 * (mismo criterio que "Solo Almacén puede confirmar entregas").
 * No escribe en la hoja SALIDA (esa hoja registra el Área operativa,
 * no la sucursal física — mezclar los dos conceptos ahí sería
 * confuso); el movimiento real de existencia sí queda íntegro en
 * KARDEX y en AUDITORIA, igual que cualquier otro ajuste del sistema.
 */
function confirmarEntregaRequisicionSucursalApp(folio, entregas, token){

  const acceso = obtenerAccesoSucursalApp(token);
  if(!acceso.esTodasLasSucursales){
    throw new Error("Solo un usuario con acceso a todas las sucursales puede confirmar entregas.");
  }

  const usuario = obtenerNombreDesdeToken(token);

  const req = obtenerHojaRequisicionesSucursal_();
  const datosReq = req.getRange(2,1,req.getLastRow()-1,8).getValues();
  let filaReq = -1, sucursalReq = "";
  datosReq.forEach((f,i) => { if(String(f[0]) === String(folio)){ filaReq = i+2; sucursalReq = f[2]; } });

  if(filaReq === -1) throw new Error("No se encontró la requisición " + folio);

  const detalle = obtenerHojaDetalleRequisicionesSucursal_();
  const datosDetalle = detalle.getRange(2,1,detalle.getLastRow()-1,6).getValues();

  const mapaEntregas = {};
  (entregas||[]).forEach(e => { mapaEntregas[String(e.codigo)] = Number(e.cantidadEntregada) || 0; });

  let productosEntregados = 0;

  datosDetalle.forEach((f, i) => {

    if(String(f[0]) !== String(folio)) return;

    const codigo = String(f[1]).trim();
    const producto = f[2];
    const cantidadEntregar = mapaEntregas[codigo] || 0;

    if(cantidadEntregar <= 0) return;

    const ajuste = ajustarExistenciaMatrizPorDeltaValidado_(codigo, -cantidadEntregar, sucursalReq);

    registrarKardex(
      "SALIDA", folio, codigo, producto, "", cantidadEntregar,
      ajuste.anterior, ajuste.nueva, usuario,
      "Requisición de sucursal " + folio + " — Sucursal " + sucursalReq
    );

    detalle.getRange(i+2, 6).setValue(cantidadEntregar);
    productosEntregados++;

  });

  if(productosEntregados === 0){
    throw new Error("Captura al menos una cantidad a entregar.");
  }

  const fechaEntrega = new Date();
  req.getRange(filaReq, 5).setValue("ENTREGADA");
  req.getRange(filaReq, 7).setValue(fechaEntrega);
  req.getRange(filaReq, 8).setValue(usuario);

  registrarAuditoria(usuario, "REQUISICIONES_SUCURSAL", "ENTREGA CONFIRMADA", folio, "", "", 0, 0,
    productosEntregados + " producto(s) entregados a la sucursal " + sucursalReq);

  return { productosEntregados: productosEntregados };

}

// ============================================
// PLANO DE ABASTECIMIENTO — pipeline de aprobación/reserva. Aditivo
// sobre todo lo de arriba: crearRequisicionSucursalApp /
// obtenerRequisicionesSucursalApp / confirmarEntregaRequisicionSucursalApp
// NO se tocan — un folio puede seguir usando el flujo directo de
// siempre. Esto agrega el paso que faltaba entre "se solicitó" y "se
// entregó": aprobar cuánto se puede atender, con una RESERVA real (no
// un descuento físico todavía) para que dos aprobaciones simultáneas
// del mismo producto nunca puedan comprometer más de lo que existe.
//
// Todavía sin: surtido, despacho/transferencia en tránsito, recepción
// e incidencias — esa es la siguiente entrega de esta misma fase.
// ============================================

const ESTADO_REQ_SUCURSAL_ = Object.freeze({
  PENDIENTE: "PENDIENTE",           // heredado — folio recién creado, esperando aprobación
  APROBADA: "APROBADA",
  APROBADA_PARCIAL: "APROBADA_PARCIAL",
  SURTIDO_PARCIAL: "SURTIDO_PARCIAL",
  LISTA_DESPACHO: "LISTA_DESPACHO",
  EN_TRANSITO: "EN_TRANSITO",
  RECIBIDA_PARCIAL: "RECIBIDA_PARCIAL",
  RECIBIDA: "RECIBIDA",
  CON_INCIDENCIA: "CON_INCIDENCIA",
  CERRADA: "CERRADA",
  ENTREGADA: "ENTREGADA",           // heredado — flujo directo de un paso
  CANCELADA: "CANCELADA"            // heredado
});

const ESTADO_LINEA_REQ_SUCURSAL_ = Object.freeze({
  PENDIENTE: "PENDIENTE",
  APROBADA: "APROBADA",
  APROBADA_PARCIAL: "APROBADA_PARCIAL",
  RECHAZADA: "RECHAZADA"
});

function obtenerHojaHistorialRequisiciones_(){
  const ss = SpreadsheetApp.getActive();
  let hoja = ss.getSheetByName("HISTORIAL_REQUISICIONES");
  if(!hoja){
    hoja = ss.insertSheet("HISTORIAL_REQUISICIONES");
    hoja.appendRow(["Folio","Fecha","Usuario","Accion","EstadoAnterior","EstadoNuevo","Descripcion"]);
    hoja.getRange(1,1,1,7).setFontWeight("bold");
  }
  return hoja;
}

/** Una sola forma de escribir HISTORIAL_REQUISICIONES — folio-céntrica,
 * distinta de AUDITORIA (que es un log plano de todo el sistema). */
function registrarHistorialRequisicion_(folio, usuario, accion, estadoAnterior, estadoNuevo, descripcion){
  obtenerHojaHistorialRequisiciones_().appendRow([
    folio, new Date(), usuario, accion, estadoAnterior || "", estadoNuevo || "", descripcion || ""
  ]);
}

/** Agrega en caliente los encabezados del pipeline a
 * DETALLE_REQUISICIONES_SUCURSAL la primera vez que se necesitan —
 * mismo patrón que ya usa RequisicionesRecetas.gs con su columna
 * "Tipo". Filas viejas quedan con estas columnas en blanco (se leen
 * como 0/"" sin romper nada). */
function asegurarEncabezadosPipelineDetalleSucursal_(detalle){
  if(detalle.getRange(1, 7).getValue() === ""){
    detalle.getRange(1, 7, 1, 9).setValues([[
      "Minimo","Maximo","Sugerido","Aprobado","Surtido","Enviado","Recibido","EstadoLinea","MotivoRechazo"
    ]]);
    detalle.getRange(1, 7, 1, 9).setFontWeight("bold");
  }
}

/**
 * Envoltorio del pipeline sobre resolverAjusteExistencia_ — un solo
 * lock para ajustar existencia y/o reserva de una sucursal a la vez.
 */
function ajustarExistenciaYReservaSucursal_(codigo, sucursal, deltaExistencia, deltaReserva, opciones){
  sucursal = normalizarSucursal_(sucursal);
  opciones = opciones || {};
  return conBloqueoApp_(function(){
    return resolverAjusteExistencia_(codigo, sucursal, {
      delta: deltaExistencia || 0, deltaReserva: deltaReserva || 0,
      validar: !!opciones.validar, validarReserva: !!opciones.validarReserva,
      validarDisponible: !!opciones.validarDisponible
    });
  });
}

/**
 * Aprueba (total o parcialmente) las líneas de una requisición de
 * sucursal ya creada. NO descuenta existencia física: solo RESERVA la
 * cantidad aprobada contra el almacén de origen — hoy siempre
 * S01/CEDIS, mismo supuesto que ya usa confirmarEntregaRequisicionSucursalApp
 * (no hay todavía un campo "Almacén origen" distinto por folio). La
 * reserva se libera al rechazar/cancelar la línea, o se consumirá al
 * despachar (siguiente entrega).
 *
 * aprobaciones = [{codigo, cantidadAprobada}] — puede traer solo
 * algunas líneas; las demás quedan pendientes para una vuelta futura.
 */
function aprobarLineaRequisicionSucursalApp(folio, aprobaciones, token){

  const acceso = obtenerAccesoSucursalApp(token);
  if(!acceso.esTodasLasSucursales){
    throw new Error("Solo un usuario con acceso a todas las sucursales puede aprobar requisiciones.");
  }

  const usuario = obtenerNombreDesdeToken(token);
  const almacenOrigen = SUCURSAL_DEFAULT_;

  const req = obtenerHojaRequisicionesSucursal_();
  const datosReq = req.getRange(2,1,req.getLastRow()-1,9).getValues();
  let filaReq = -1, estadoActual = "";
  datosReq.forEach((f,i) => { if(String(f[0]) === String(folio)){ filaReq = i+2; estadoActual = String(f[4]||"").trim().toUpperCase(); } });

  if(filaReq === -1) throw new Error("No se encontró la requisición " + folio);

  const estadosAprobables = [ESTADO_REQ_SUCURSAL_.PENDIENTE, ESTADO_REQ_SUCURSAL_.APROBADA_PARCIAL];
  if(estadosAprobables.indexOf(estadoActual) === -1){
    throw new Error("Esta requisición está en estado " + estadoActual + " y no se puede aprobar.");
  }

  const detalle = obtenerHojaDetalleRequisicionesSucursal_();
  asegurarEncabezadosPipelineDetalleSucursal_(detalle);
  const anchoDetalle = Math.max(detalle.getLastColumn(), 15);
  const datosDetalle = detalle.getRange(2,1,detalle.getLastRow()-1,anchoDetalle).getValues();

  const mapaAprobaciones = {};
  (aprobaciones||[]).forEach(a => { mapaAprobaciones[String(a.codigo).trim()] = Number(a.cantidadAprobada) || 0; });

  let lineasAprobadas = 0, lineasTotales = 0;
  // El folio queda APROBADA solo si TODAS sus líneas terminan exactamente
  // APROBADA (aprobado === solicitado) — cualquier línea PENDIENTE,
  // APROBADA_PARCIAL o RECHAZADA dentro del folio lo deja en
  // APROBADA_PARCIAL (una aprobación total de todo, con cero excepciones).
  let todasLineasCompletas = true;

  datosDetalle.forEach((f, i) => {

    if(String(f[0]) !== String(folio)) return;
    lineasTotales++;

    const codigo = String(f[1]).trim();
    const solicitado = Number(f[4]) || 0;
    let estadoLineaFinal = String(f[13]||"").trim().toUpperCase() || ESTADO_LINEA_REQ_SUCURSAL_.PENDIENTE;

    const yaResuelta = estadoLineaFinal === ESTADO_LINEA_REQ_SUCURSAL_.RECHAZADA
      || estadoLineaFinal === ESTADO_LINEA_REQ_SUCURSAL_.APROBADA
      || estadoLineaFinal === ESTADO_LINEA_REQ_SUCURSAL_.APROBADA_PARCIAL;

    if(!yaResuelta && codigo in mapaAprobaciones){

      const cantidadAprobada = mapaAprobaciones[codigo];

      if(cantidadAprobada < 0){
        throw new Error("La cantidad aprobada de " + codigo + " no puede ser negativa.");
      }
      if(cantidadAprobada > solicitado){
        throw new Error("No puedes aprobar más de lo solicitado para " + codigo + " (solicitado: " + solicitado + ").");
      }

      if(cantidadAprobada > 0){
        // Disponible real se valida DENTRO del mismo lock que reserva — así
        // dos aprobaciones simultáneas del mismo producto nunca pueden
        // sobre-reservar más de lo que existe.
        ajustarExistenciaYReservaSucursal_(codigo, almacenOrigen, 0, cantidadAprobada, { validarDisponible: true });

        estadoLineaFinal = cantidadAprobada === solicitado ? ESTADO_LINEA_REQ_SUCURSAL_.APROBADA : ESTADO_LINEA_REQ_SUCURSAL_.APROBADA_PARCIAL;
        detalle.getRange(i+2, 10).setValue(cantidadAprobada); // J = Aprobado
        detalle.getRange(i+2, 14).setValue(estadoLineaFinal); // N = EstadoLinea

        lineasAprobadas++;
      }
      // cantidadAprobada === 0: sin decisión real, la línea sigue PENDIENTE
      // (usa rechazarLineaRequisicionSucursalApp para rechazar explícitamente).
    }

    if(estadoLineaFinal !== ESTADO_LINEA_REQ_SUCURSAL_.APROBADA){
      todasLineasCompletas = false;
    }

  });

  if(lineasAprobadas === 0){
    throw new Error("Captura al menos una cantidad aprobada mayor a cero.");
  }

  const estadoNuevo = todasLineasCompletas ? ESTADO_REQ_SUCURSAL_.APROBADA : ESTADO_REQ_SUCURSAL_.APROBADA_PARCIAL;

  req.getRange(filaReq, 5).setValue(estadoNuevo);

  registrarHistorialRequisicion_(folio, usuario, "REQUISICIÓN APROBADA", estadoActual, estadoNuevo,
    lineasAprobadas + " de " + lineasTotales + " línea(s) aprobadas");

  registrarAuditoria(usuario, "REQUISICIONES_SUCURSAL", "APROBACIÓN", folio, "", "", 0, 0,
    lineasAprobadas + " línea(s) aprobadas y reservadas contra " + almacenOrigen);

  return { folio: folio, estado: estadoNuevo, lineasAprobadas: lineasAprobadas, lineasTotales: lineasTotales };

}

/**
 * Rechaza UNA línea de una requisición de sucursal, con motivo
 * obligatorio — no la borra, solo la marca RECHAZADA (misma filosofía
 * de trazabilidad que cancelarRequisicionApp/cancelarOrdenCompraApp).
 * No libera ninguna reserva porque una línea rechazada nunca llegó a
 * aprobarse/reservarse (si ya estaba APROBADA, hay que usar el futuro
 * flujo de cancelación, que sí libera reservas).
 */
function rechazarLineaRequisicionSucursalApp(folio, codigo, motivo, token){

  const acceso = obtenerAccesoSucursalApp(token);
  if(!acceso.esTodasLasSucursales){
    throw new Error("Solo un usuario con acceso a todas las sucursales puede rechazar líneas de una requisición.");
  }
  if(!motivo || !String(motivo).trim()){
    throw new Error("Captura el motivo del rechazo.");
  }

  const usuario = obtenerNombreDesdeToken(token);
  codigo = String(codigo||"").trim();

  const req = obtenerHojaRequisicionesSucursal_();
  const datosReq = req.getRange(2,1,req.getLastRow()-1,9).getValues();
  let filaReq = -1, estadoActual = "";
  datosReq.forEach((f,i) => { if(String(f[0]) === String(folio)){ filaReq = i+2; estadoActual = String(f[4]||"").trim().toUpperCase(); } });
  if(filaReq === -1) throw new Error("No se encontró la requisición " + folio);

  const estadosTerminal = [ESTADO_REQ_SUCURSAL_.ENTREGADA, ESTADO_REQ_SUCURSAL_.CANCELADA];
  if(estadosTerminal.indexOf(estadoActual) !== -1){
    throw new Error("Esta requisición ya está " + estadoActual + " y no se puede modificar.");
  }

  const detalle = obtenerHojaDetalleRequisicionesSucursal_();
  asegurarEncabezadosPipelineDetalleSucursal_(detalle);
  const anchoDetalle = Math.max(detalle.getLastColumn(), 15);
  const datosDetalle = detalle.getRange(2,1,detalle.getLastRow()-1,anchoDetalle).getValues();

  let filaLinea = -1;
  datosDetalle.forEach((f, i) => {
    if(String(f[0]) === String(folio) && String(f[1]).trim() === codigo) filaLinea = i+2;
  });

  if(filaLinea === -1) throw new Error("Ese código no pertenece a la requisición " + folio);

  detalle.getRange(filaLinea, 14).setValue(ESTADO_LINEA_REQ_SUCURSAL_.RECHAZADA); // N
  detalle.getRange(filaLinea, 15).setValue(motivo); // O

  registrarHistorialRequisicion_(folio, usuario, "LÍNEA RECHAZADA", estadoActual, estadoActual, codigo + " — " + motivo);
  registrarAuditoria(usuario, "REQUISICIONES_SUCURSAL", "LÍNEA RECHAZADA", folio, codigo, "", 0, 0, motivo);

  return { ok: true, folio: folio, codigo: codigo };

}

/**
 * Registra cuánto se surtió físicamente de cada línea aprobada — NO
 * mueve existencia ni reserva todavía (tu punto 25/26: "surtido" es
 * juntar el producto, no despacharlo). Solo valida que no se surta más
 * de lo aprobado ni más de lo que hay físicamente en el almacén origen.
 * surtido = [{codigo, cantidadSurtida}]
 */
function surtirRequisicionSucursalApp(folio, surtido, token){

  const acceso = obtenerAccesoSucursalApp(token);
  if(!acceso.esTodasLasSucursales){
    throw new Error("Solo un usuario con acceso a todas las sucursales puede surtir requisiciones.");
  }

  const usuario = obtenerNombreDesdeToken(token);
  const almacenOrigen = SUCURSAL_DEFAULT_;

  const req = obtenerHojaRequisicionesSucursal_();
  const datosReq = req.getRange(2,1,req.getLastRow()-1,9).getValues();
  let filaReq = -1, estadoActual = "";
  datosReq.forEach((f,i) => { if(String(f[0]) === String(folio)){ filaReq = i+2; estadoActual = String(f[4]||"").trim().toUpperCase(); } });
  if(filaReq === -1) throw new Error("No se encontró la requisición " + folio);

  const estadosSurtibles = [ESTADO_REQ_SUCURSAL_.APROBADA, ESTADO_REQ_SUCURSAL_.APROBADA_PARCIAL, ESTADO_REQ_SUCURSAL_.SURTIDO_PARCIAL];
  if(estadosSurtibles.indexOf(estadoActual) === -1){
    throw new Error("Esta requisición está en estado " + estadoActual + " y no se puede surtir.");
  }

  const detalle = obtenerHojaDetalleRequisicionesSucursal_();
  asegurarEncabezadosPipelineDetalleSucursal_(detalle);
  const anchoDetalle = Math.max(detalle.getLastColumn(), 15);
  const datosDetalle = detalle.getRange(2,1,detalle.getLastRow()-1,anchoDetalle).getValues();

  const mapaSurtido = {};
  (surtido||[]).forEach(s => { mapaSurtido[String(s.codigo).trim()] = Number(s.cantidadSurtida) || 0; });

  let lineasSurtidas = 0, hayAprobadas = false, todasListas = true;

  datosDetalle.forEach((f, i) => {

    if(String(f[0]) !== String(folio)) return;

    const codigo = String(f[1]).trim();
    const aprobado = Number(f[9]) || 0;
    if(aprobado <= 0) return; // línea rechazada o sin decisión — no se surte

    hayAprobadas = true;
    let surtidoActual = Number(f[10]) || 0;

    if(codigo in mapaSurtido){

      const cantidadSurtida = mapaSurtido[codigo];
      if(cantidadSurtida < 0){
        throw new Error("La cantidad surtida de " + codigo + " no puede ser negativa.");
      }
      if(cantidadSurtida > aprobado){
        throw new Error("No puedes surtir más de lo aprobado para " + codigo + " (aprobado: " + aprobado + ").");
      }

      const existenciaFisica = obtenerExistenciaSucursal_(codigo, almacenOrigen);
      if(cantidadSurtida > existenciaFisica){
        throw new Error("No hay existencia física suficiente de " + codigo + " en " + almacenOrigen + " para surtir " + cantidadSurtida + " — disponible: " + existenciaFisica);
      }

      detalle.getRange(i+2, 11).setValue(cantidadSurtida); // K = Surtido
      surtidoActual = cantidadSurtida;
      lineasSurtidas++;

    }

    if(surtidoActual < aprobado) todasListas = false;

  });

  if(!hayAprobadas){
    throw new Error("Esta requisición no tiene líneas aprobadas para surtir.");
  }
  if(lineasSurtidas === 0){
    throw new Error("Captura al menos una cantidad surtida mayor a cero.");
  }

  const estadoNuevo = todasListas ? ESTADO_REQ_SUCURSAL_.LISTA_DESPACHO : ESTADO_REQ_SUCURSAL_.SURTIDO_PARCIAL;
  req.getRange(filaReq, 5).setValue(estadoNuevo);

  registrarHistorialRequisicion_(folio, usuario, "SURTIDO REGISTRADO", estadoActual, estadoNuevo, lineasSurtidas + " línea(s) surtidas");
  registrarAuditoria(usuario, "REQUISICIONES_SUCURSAL", "SURTIDO", folio, "", "", 0, 0, lineasSurtidas + " línea(s) surtidas");

  return { folio: folio, estado: estadoNuevo, lineasSurtidas: lineasSurtidas };

}

function obtenerHojaTransferenciasRequisiciones_(){
  const ss = SpreadsheetApp.getActive();
  let hoja = ss.getSheetByName("TRANSFERENCIAS");
  if(!hoja){
    hoja = ss.insertSheet("TRANSFERENCIAS");
    hoja.appendRow(["FolioTransferencia","FolioRequisicion","SucursalOrigen","SucursalDestino","FechaDespacho","Usuario","Estado"]);
    hoja.getRange(1,1,1,7).setFontWeight("bold");
  }
  return hoja;
}

function obtenerHojaTransferenciasDetalle_(){
  const ss = SpreadsheetApp.getActive();
  let hoja = ss.getSheetByName("TRANSFERENCIAS_DETALLE");
  if(!hoja){
    hoja = ss.insertSheet("TRANSFERENCIAS_DETALLE");
    hoja.appendRow(["FolioTransferencia","Código","Producto","UDM","CantidadEnviada","CantidadRecibida"]);
    hoja.getRange(1,1,1,6).setFontWeight("bold");
  }
  return hoja;
}

function generarFolioTransferenciaRequisicion_(){
  return "TRF-" + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd-HHmmss");
}

/**
 * Despacha una requisición LISTA_DESPACHO: crea la TRANSFERENCIA (una
 * sola, por más que se pulse el botón varias veces — idempotente),
 * CONSUME la reserva (deltaExistencia y deltaReserva, ambos negativos,
 * en el MISMO lock: la reserva se vuelve movimiento real) y registra
 * Kardex de salida. El destino todavía NO sube — queda "en tránsito"
 * hasta que la sucursal confirme recepción (tu punto 32).
 */
function despacharRequisicionSucursalApp(folio, token){

  const acceso = obtenerAccesoSucursalApp(token);
  if(!acceso.esTodasLasSucursales){
    throw new Error("Solo un usuario con acceso a todas las sucursales puede despachar requisiciones.");
  }

  const usuario = obtenerNombreDesdeToken(token);
  const almacenOrigen = SUCURSAL_DEFAULT_;

  const req = obtenerHojaRequisicionesSucursal_();
  const datosReq = req.getRange(2,1,req.getLastRow()-1,9).getValues();
  let filaReq = -1, estadoActual = "", sucursalDestino = "";
  datosReq.forEach((f,i) => {
    if(String(f[0]) === String(folio)){ filaReq = i+2; estadoActual = String(f[4]||"").trim().toUpperCase(); sucursalDestino = String(f[2]||"").trim(); }
  });
  if(filaReq === -1) throw new Error("No se encontró la requisición " + folio);

  // Idempotencia: doble clic en "Despachar" no crea una segunda
  // transferencia — se regresa la que ya existe para este folio.
  const transferencias = obtenerHojaTransferenciasRequisiciones_();
  if(transferencias.getLastRow() > 1){
    const existentes = transferencias.getRange(2,1,transferencias.getLastRow()-1,7).getValues();
    const yaDespachada = existentes.find(f => String(f[1]) === String(folio));
    if(yaDespachada){
      return { folioTransferencia: yaDespachada[0], estado: estadoActual, yaExistia: true };
    }
  }

  if(estadoActual !== ESTADO_REQ_SUCURSAL_.LISTA_DESPACHO){
    throw new Error("Esta requisición está en estado " + estadoActual + " y no se puede despachar — primero debe quedar LISTA_DESPACHO (surtido completo).");
  }

  const detalle = obtenerHojaDetalleRequisicionesSucursal_();
  const anchoDetalle = Math.max(detalle.getLastColumn(), 15);
  const datosDetalle = detalle.getRange(2,1,detalle.getLastRow()-1,anchoDetalle).getValues();

  const filasEnviar = [];
  datosDetalle.forEach((f, i) => {
    if(String(f[0]) !== String(folio)) return;
    const surtido = Number(f[10]) || 0;
    if(surtido <= 0) return;
    filasEnviar.push({ fila: i+2, codigo: String(f[1]).trim(), producto: f[2], unidad: f[3], cantidad: surtido });
  });

  if(!filasEnviar.length){
    throw new Error("No hay cantidades surtidas para despachar.");
  }

  const folioTransferencia = generarFolioTransferenciaRequisicion_();
  const fecha = new Date();

  filasEnviar.forEach(item => {
    // Última validación de inventario justo antes de mover algo — la
    // existencia pudo cambiar desde que se surtió (tu punto 27).
    const ajuste = ajustarExistenciaYReservaSucursal_(item.codigo, almacenOrigen, -item.cantidad, -item.cantidad, { validar: true, validarReserva: true });
    item.existenciaAnterior = ajuste.anterior;
    item.existenciaNueva = ajuste.nueva;
  });

  transferencias.appendRow([folioTransferencia, folio, almacenOrigen, sucursalDestino, fecha, usuario, "EN_TRANSITO"]);

  const detalleTransferencias = obtenerHojaTransferenciasDetalle_();
  const filasDetalle = filasEnviar.map(item => [folioTransferencia, item.codigo, item.producto, item.unidad, item.cantidad, ""]);
  detalleTransferencias.getRange(detalleTransferencias.getLastRow()+1, 1, filasDetalle.length, 6).setValues(filasDetalle);

  filasEnviar.forEach(item => {
    detalle.getRange(item.fila, 12).setValue(item.cantidad); // L = Enviado
    registrarKardex(
      "TRANSFERENCIA-SALIDA", folioTransferencia, item.codigo, item.producto, "", item.cantidad,
      item.existenciaAnterior, item.existenciaNueva, usuario,
      "Requisición " + folio + " — despacho a " + sucursalDestino
    );
  });

  req.getRange(filaReq, 5).setValue(ESTADO_REQ_SUCURSAL_.EN_TRANSITO);

  registrarHistorialRequisicion_(folio, usuario, "DESPACHO REALIZADO", estadoActual, ESTADO_REQ_SUCURSAL_.EN_TRANSITO,
    "Transferencia " + folioTransferencia + " — " + filasEnviar.length + " producto(s)");
  registrarAuditoria(usuario, "REQUISICIONES_SUCURSAL", "DESPACHO", folio, "", "", 0, 0,
    "Transferencia " + folioTransferencia + " hacia " + sucursalDestino);

  return { folioTransferencia: folioTransferencia, estado: ESTADO_REQ_SUCURSAL_.EN_TRANSITO, productos: filasEnviar.length, yaExistia: false };

}

function obtenerHojaIncidenciasRequisiciones_(){
  const ss = SpreadsheetApp.getActive();
  let hoja = ss.getSheetByName("INCIDENCIAS_REQUISICIONES");
  if(!hoja){
    hoja = ss.insertSheet("INCIDENCIAS_REQUISICIONES");
    hoja.appendRow(["FolioIncidencia","FolioRequisicion","FolioTransferencia","Código","Producto","Tipo","CantidadEnviada","CantidadRecibida","Diferencia","Motivo","Comentario","Usuario","Fecha","Estado","Resolucion"]);
    hoja.getRange(1,1,1,15).setFontWeight("bold");
  }
  return hoja;
}

function generarFolioIncidencia_(){
  const hoja = obtenerHojaIncidenciasRequisiciones_();
  const total = hoja.getLastRow() > 1 ? hoja.getLastRow() - 1 : 0;
  return "INC-" + Utilities.formatString("%04d", total + 1);
}

/**
 * Confirma cuánto llegó realmente a la sucursal destino — solo esa
 * sucursal (o alguien con acceso a todas) puede recibir su propia
 * transferencia. Incrementa la existencia del destino con la cantidad
 * REAL recibida (nunca la enviada), genera Kardex de entrada, y crea
 * una incidencia automática por cada línea con diferencia. Idempotente:
 * una línea ya recibida no se vuelve a procesar; una transferencia ya
 * RECIBIDA por completo regresa sin hacer nada más.
 * recepciones = [{codigo, cantidadRecibida}]
 */
function recibirTransferenciaSucursalApp(folioTransferencia, recepciones, token){

  const acceso = obtenerAccesoSucursalApp(token);
  const usuario = obtenerNombreDesdeToken(token);

  const transferencias = obtenerHojaTransferenciasRequisiciones_();
  const datosTransf = transferencias.getRange(2,1,transferencias.getLastRow()-1,7).getValues();
  let filaTransf = -1, folioReq = "", sucursalDestino = "", estadoTransf = "";
  datosTransf.forEach((f,i) => {
    if(String(f[0]) === String(folioTransferencia)){
      filaTransf = i+2; folioReq = f[1]; sucursalDestino = f[3]; estadoTransf = String(f[6]||"").trim().toUpperCase();
    }
  });
  if(filaTransf === -1) throw new Error("No se encontró la transferencia " + folioTransferencia);

  if(!acceso.esTodasLasSucursales && normalizarSucursal_(acceso.sucursal) !== normalizarSucursal_(sucursalDestino)){
    throw new Error("Solo la sucursal destino puede confirmar la recepción de esta transferencia.");
  }

  if(estadoTransf === "RECIBIDA"){
    return { folioTransferencia: folioTransferencia, estado: "RECIBIDA", productosRecibidos: 0, incidencias: [], yaExistia: true };
  }
  if(estadoTransf !== "EN_TRANSITO" && estadoTransf !== "RECIBIDA_PARCIAL"){
    throw new Error("Esta transferencia está en estado " + estadoTransf + " y no se puede recibir.");
  }

  const detalleTransf = obtenerHojaTransferenciasDetalle_();
  const datosDetalleTransf = detalleTransf.getRange(2,1,detalleTransf.getLastRow()-1,6).getValues();

  const mapaRecepciones = {};
  (recepciones||[]).forEach(r => { mapaRecepciones[String(r.codigo).trim()] = Number(r.cantidadRecibida) || 0; });

  // La columna "Recibido" (M) de DETALLE_REQUISICIONES_SUCURSAL se reserva
  // desde asegurarEncabezadosPipelineDetalleSucursal_ pero hasta ahora
  // nunca se escribía aquí — lo recibido solo quedaba en
  // TRANSFERENCIAS_DETALLE. Sin esto, cualquier lectura que confíe en esa
  // columna (fill rate, reportes) siempre ve 0/vacío para el flujo de
  // pipeline aunque la recepción sí haya ocurrido. Se llena por línea,
  // acumulando por si la transferencia se recibe en varias vueltas.
  const detalleReq = obtenerHojaDetalleRequisicionesSucursal_();
  asegurarEncabezadosPipelineDetalleSucursal_(detalleReq);
  const filaDetalleReqPorCodigo = {};
  if(detalleReq.getLastRow() > 1){
    detalleReq.getRange(2,1,detalleReq.getLastRow()-1,13).getValues().forEach((f,i) => {
      if(String(f[0]) !== String(folioReq)) return;
      filaDetalleReqPorCodigo[String(f[1]).trim()] = i+2;
    });
  }

  let productosRecibidos = 0, todosCompletos = true, hayLineas = false;
  const incidenciasCreadas = [];

  datosDetalleTransf.forEach((f, i) => {

    if(String(f[0]) !== String(folioTransferencia)) return;
    hayLineas = true;

    const codigo = String(f[1]).trim();
    const producto = f[2];
    const enviado = Number(f[4]) || 0;
    const recibidoPrevio = Number(f[5]) || 0;

    if(recibidoPrevio > 0){
      if(recibidoPrevio < enviado) todosCompletos = false;
      return; // ya procesada en una vuelta anterior
    }

    if(!(codigo in mapaRecepciones)){ todosCompletos = false; return; }

    const cantidadRecibida = mapaRecepciones[codigo];
    if(cantidadRecibida < 0){
      throw new Error("La cantidad recibida de " + codigo + " no puede ser negativa.");
    }
    if(cantidadRecibida > enviado){
      throw new Error("La cantidad recibida de " + codigo + " (" + cantidadRecibida + ") no puede ser mayor a la enviada (" + enviado + ").");
    }
    if(cantidadRecibida === 0){ todosCompletos = false; return; }

    const ajuste = ajustarExistenciaYReservaSucursal_(codigo, sucursalDestino, cantidadRecibida, 0, {});

    detalleTransf.getRange(i+2, 6).setValue(cantidadRecibida); // F = CantidadRecibida

    const filaDetalleReq = filaDetalleReqPorCodigo[codigo];
    if(filaDetalleReq){
      const recibidoAcumuladoPrevio = Number(detalleReq.getRange(filaDetalleReq, 13).getValue()) || 0;
      detalleReq.getRange(filaDetalleReq, 13).setValue(recibidoAcumuladoPrevio + cantidadRecibida); // M = Recibido
    }

    registrarKardex(
      "TRANSFERENCIA-ENTRADA", folioTransferencia, codigo, producto, cantidadRecibida, "",
      ajuste.anterior, ajuste.nueva, usuario, "Requisición " + folioReq + " — recepción en " + sucursalDestino
    );

    productosRecibidos++;

    if(cantidadRecibida < enviado){
      todosCompletos = false;
      const folioInc = generarFolioIncidencia_();
      obtenerHojaIncidenciasRequisiciones_().appendRow([
        folioInc, folioReq, folioTransferencia, codigo, producto, "FALTANTE",
        enviado, cantidadRecibida, Math.round((enviado - cantidadRecibida) * 1000) / 1000,
        "Diferencia detectada al recibir", "", usuario, new Date(), "PENDIENTE", ""
      ]);
      incidenciasCreadas.push(folioInc);
    }

  });

  if(!hayLineas){
    throw new Error("Esta transferencia no tiene productos.");
  }
  if(productosRecibidos === 0){
    throw new Error("Captura al menos una cantidad recibida mayor a cero.");
  }

  const estadoTransfNuevo = todosCompletos ? "RECIBIDA" : "RECIBIDA_PARCIAL";
  transferencias.getRange(filaTransf, 7).setValue(estadoTransfNuevo);

  const estadoReqNuevo = incidenciasCreadas.length > 0
    ? ESTADO_REQ_SUCURSAL_.CON_INCIDENCIA
    : (todosCompletos ? ESTADO_REQ_SUCURSAL_.RECIBIDA : ESTADO_REQ_SUCURSAL_.RECIBIDA_PARCIAL);

  const req = obtenerHojaRequisicionesSucursal_();
  const datosReq = req.getRange(2,1,req.getLastRow()-1,9).getValues();
  let filaReq = -1, estadoReqAnterior = "";
  datosReq.forEach((f,i) => { if(String(f[0]) === String(folioReq)){ filaReq = i+2; estadoReqAnterior = String(f[4]||"").trim().toUpperCase(); } });
  if(filaReq !== -1){
    req.getRange(filaReq, 5).setValue(estadoReqNuevo);
  }

  registrarHistorialRequisicion_(folioReq, usuario, "RECEPCIÓN REGISTRADA", estadoReqAnterior, estadoReqNuevo,
    productosRecibidos + " producto(s) recibidos" + (incidenciasCreadas.length ? " — " + incidenciasCreadas.length + " incidencia(s)" : ""));
  registrarAuditoria(usuario, "REQUISICIONES_SUCURSAL", "RECEPCIÓN", folioReq, "", "", 0, 0,
    "Transferencia " + folioTransferencia + " — " + estadoTransfNuevo);

  return {
    folioTransferencia: folioTransferencia, estadoTransferencia: estadoTransfNuevo,
    estadoRequisicion: estadoReqNuevo, productosRecibidos: productosRecibidos,
    incidencias: incidenciasCreadas, yaExistia: false
  };

}

/**
 * Cancela una requisición de sucursal que YA está en el pipeline nuevo
 * (aprobación/reserva) — complementa a cancelarRequisicionApp (Área) y
 * al hecho de que confirmarEntregaRequisicionSucursalApp nunca pasa por
 * aquí (flujo directo, sin reserva que liberar). Reglas por estado (tu
 * punto 40): libre en PENDIENTE; libera reserva en
 * APROBADA/APROBADA_PARCIAL/SURTIDO_PARCIAL/LISTA_DESPACHO; bloqueada
 * desde EN_TRANSITO en adelante (ya hay un movimiento físico real en
 * curso — para eso existe la incidencia, no la cancelación).
 */
function cancelarRequisicionSucursalApp(folio, motivo, token){

  const acceso = obtenerAccesoSucursalApp(token);
  if(!acceso.esTodasLasSucursales){
    throw new Error("Solo un usuario con acceso a todas las sucursales puede cancelar esta requisición.");
  }

  const usuario = obtenerNombreDesdeToken(token);
  const almacenOrigen = SUCURSAL_DEFAULT_;

  const req = obtenerHojaRequisicionesSucursal_();
  const datosReq = req.getRange(2,1,req.getLastRow()-1,9).getValues();
  let filaReq = -1, estadoActual = "", observacionesActuales = "";
  datosReq.forEach((f,i) => {
    if(String(f[0]) === String(folio)){ filaReq = i+2; estadoActual = String(f[4]||"").trim().toUpperCase(); observacionesActuales = String(f[5]||""); }
  });
  if(filaReq === -1) throw new Error("No se encontró la requisición " + folio);

  const estadosCancelables = [
    ESTADO_REQ_SUCURSAL_.PENDIENTE, ESTADO_REQ_SUCURSAL_.APROBADA, ESTADO_REQ_SUCURSAL_.APROBADA_PARCIAL,
    ESTADO_REQ_SUCURSAL_.SURTIDO_PARCIAL, ESTADO_REQ_SUCURSAL_.LISTA_DESPACHO
  ];
  if(estadosCancelables.indexOf(estadoActual) === -1){
    throw new Error("Esta requisición está en estado " + estadoActual + " y ya no se puede cancelar — hay un movimiento físico en curso o ya se cerró.");
  }

  const detalle = obtenerHojaDetalleRequisicionesSucursal_();
  const anchoDetalle = Math.max(detalle.getLastColumn(), 15);
  const datosDetalle = detalle.getRange(2,1,detalle.getLastRow()-1,anchoDetalle).getValues();

  let reservasLiberadas = 0;
  datosDetalle.forEach(f => {
    if(String(f[0]) !== String(folio)) return;
    const aprobado = Number(f[9]) || 0;
    if(aprobado <= 0) return; // nunca se llegó a reservar nada para esta línea
    ajustarExistenciaYReservaSucursal_(String(f[1]).trim(), almacenOrigen, 0, -aprobado, { validarReserva: true });
    reservasLiberadas++;
  });

  const nota = "[CANCELADA por " + usuario + (motivo ? " — " + motivo : "") + "]";
  req.getRange(filaReq, 5).setValue(ESTADO_REQ_SUCURSAL_.CANCELADA);
  req.getRange(filaReq, 6).setValue((observacionesActuales ? observacionesActuales + " " : "") + nota);

  registrarHistorialRequisicion_(folio, usuario, "REQUISICIÓN CANCELADA", estadoActual, ESTADO_REQ_SUCURSAL_.CANCELADA,
    (motivo || "") + (reservasLiberadas ? " — " + reservasLiberadas + " reserva(s) liberada(s)" : ""));
  registrarAuditoria(usuario, "REQUISICIONES_SUCURSAL", "REQUISICIÓN CANCELADA", folio, "", "", 0, 0,
    "Estaba " + estadoActual + (motivo ? " — Motivo: " + motivo : ""));

  return { ok: true, folio: folio, reservasLiberadas: reservasLiberadas };

}

/**
 * Cierra una requisición ya RECIBIDA por completo — el punto final del
 * pipeline (tu punto 39). Deliberadamente NO cierra desde
 * RECIBIDA_PARCIAL ni CON_INCIDENCIA: primero hay que resolver esas
 * líneas (recepción complementaria o resolverIncidenciaRequisicionApp)
 * para no cerrar un folio con diferencias sin explicar.
 */
function cerrarRequisicionSucursalApp(folio, token){

  const acceso = obtenerAccesoSucursalApp(token);
  if(!acceso.esTodasLasSucursales){
    throw new Error("Solo un usuario con acceso a todas las sucursales puede cerrar esta requisición.");
  }

  const usuario = obtenerNombreDesdeToken(token);

  const req = obtenerHojaRequisicionesSucursal_();
  const datosReq = req.getRange(2,1,req.getLastRow()-1,9).getValues();
  let filaReq = -1, estadoActual = "";
  datosReq.forEach((f,i) => { if(String(f[0]) === String(folio)){ filaReq = i+2; estadoActual = String(f[4]||"").trim().toUpperCase(); } });
  if(filaReq === -1) throw new Error("No se encontró la requisición " + folio);

  if(estadoActual !== ESTADO_REQ_SUCURSAL_.RECIBIDA){
    throw new Error("Esta requisición está en estado " + estadoActual + " y no se puede cerrar todavía — debe quedar RECIBIDA por completo (sin diferencias pendientes) primero.");
  }

  req.getRange(filaReq, 5).setValue(ESTADO_REQ_SUCURSAL_.CERRADA);

  registrarHistorialRequisicion_(folio, usuario, "REQUISICIÓN CERRADA", estadoActual, ESTADO_REQ_SUCURSAL_.CERRADA, "");
  registrarAuditoria(usuario, "REQUISICIONES_SUCURSAL", "REQUISICIÓN CERRADA", folio, "", "", 0, 0, "");

  return { ok: true, folio: folio };

}

/**
 * Resuelve una incidencia (faltante/daño/etc.) capturada al recibir.
 * Si era la última incidencia PENDIENTE de su requisición, la
 * requisición sale de CON_INCIDENCIA hacia RECIBIDA — ya quedó
 * explicada la diferencia y el ciclo puede cerrarse normalmente.
 */
function resolverIncidenciaRequisicionApp(folioIncidencia, resolucion, token){

  const acceso = obtenerAccesoSucursalApp(token);
  if(!acceso.esTodasLasSucursales){
    throw new Error("Solo un usuario con acceso a todas las sucursales puede resolver incidencias.");
  }
  if(!resolucion || !String(resolucion).trim()){
    throw new Error("Captura cómo se resolvió la incidencia.");
  }

  const usuario = obtenerNombreDesdeToken(token);
  const hoja = obtenerHojaIncidenciasRequisiciones_();
  const datos = hoja.getRange(2,1,hoja.getLastRow()-1,15).getValues();

  let filaInc = -1, folioReq = "", estadoIncActual = "";
  datos.forEach((f,i) => {
    if(String(f[0]) === String(folioIncidencia)){ filaInc = i+2; folioReq = f[1]; estadoIncActual = String(f[13]||"").trim().toUpperCase(); }
  });
  if(filaInc === -1) throw new Error("No se encontró la incidencia " + folioIncidencia);
  if(estadoIncActual === "RESUELTA"){
    throw new Error("Esta incidencia ya está resuelta.");
  }

  hoja.getRange(filaInc, 14).setValue("RESUELTA");
  hoja.getRange(filaInc, 15).setValue(resolucion);

  const quedanPendientes = datos.some((f,i) =>
    i+2 !== filaInc && String(f[1]) === String(folioReq) && String(f[13]||"").trim().toUpperCase() !== "RESUELTA"
  );

  let estadoReqNuevo = null;
  if(!quedanPendientes){
    const req = obtenerHojaRequisicionesSucursal_();
    const datosReq = req.getRange(2,1,req.getLastRow()-1,9).getValues();
    let filaReq = -1, estadoReqActual = "";
    datosReq.forEach((f,i) => { if(String(f[0]) === String(folioReq)){ filaReq = i+2; estadoReqActual = String(f[4]||"").trim().toUpperCase(); } });
    if(filaReq !== -1 && estadoReqActual === ESTADO_REQ_SUCURSAL_.CON_INCIDENCIA){
      estadoReqNuevo = ESTADO_REQ_SUCURSAL_.RECIBIDA;
      req.getRange(filaReq, 5).setValue(estadoReqNuevo);
    }
  }

  registrarHistorialRequisicion_(folioReq, usuario, "INCIDENCIA RESUELTA", "CON_INCIDENCIA", estadoReqNuevo || "CON_INCIDENCIA",
    folioIncidencia + " — " + resolucion);
  registrarAuditoria(usuario, "REQUISICIONES_SUCURSAL", "INCIDENCIA RESUELTA", folioReq, "", "", 0, 0,
    folioIncidencia + " — " + resolucion);

  return { ok: true, folioIncidencia: folioIncidencia, folioRequisicion: folioReq, estadoRequisicion: estadoReqNuevo, quedanPendientes: quedanPendientes };

}
