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
    hoja.appendRow(["Folio","Fecha","Sucursal","Solicitante","Estado","Observaciones","Fecha Entrega","Entregó"]);
    hoja.getRange(1,1,1,8).setFontWeight("bold");
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
 */
function crearRequisicionSucursalApp(observaciones, items, token){

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
  let folio;

  conBloqueoApp_(function(){
    folio = generarFolioRequisicionSucursal_();
    obtenerHojaRequisicionesSucursal_().appendRow([
      folio, fecha, acceso.sucursal, usuario, "PENDIENTE", observaciones || "", "", ""
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

  const datos = hoja.getRange(2,1,hoja.getLastRow()-1,8).getValues();

  return datos
    .filter(f => acceso.esTodasLasSucursales || String(f[2]).trim() === String(acceso.sucursal).trim())
    .map(f => ({
      folio: f[0],
      fecha: f[1] instanceof Date ? Utilities.formatDate(f[1], Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm") : f[1],
      sucursal: f[2], solicitante: f[3], estado: f[4], observaciones: f[5],
      fechaEntrega: f[6] instanceof Date ? Utilities.formatDate(f[6], Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm") : "",
      entrego: f[7]
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
  const datosReq = req.getRange(2,1,req.getLastRow()-1,8).getValues();
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
