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
  const datosDetalle = detalle.getLastRow() > 1 ? detalle.getRange(2,1,detalle.getLastRow()-1,6).getValues() : [];

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
        entregado: f[5]
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
