// ============================================
// DEVOLUCIONES.GS — TAGERS WMS 2.0 (auditoría comparativa vs. MarketMan, INV-04)
// ============================================
//
// Antes no existía NINGÚN flujo de devolución — cero resultados de
// "devolución" en todo el repositorio. Este archivo cubre los dos casos
// reales identificados en la auditoría:
//
//   (a) Sucursal → CEDIS: una sucursal regresa producto que ya recibió
//       (sobrante, equivocación de surtido, etc.). Se apoya tal cual en
//       transferirEntreSucursalesApp — la misma transferencia instantánea
//       ya probada (ver 📁 App.gs.gs, Fase 12) — sin reinventar el
//       mecanismo de mover existencia entre sucursales; esta función solo
//       le pone semántica de "devolución" (motivo, bitácora propia) y
//       fija el destino siempre a CEDIS/S01.
//
//   (b) CEDIS → Proveedor: una salida normal (misma
//       registrarSalidaInterna_ que ya usan Salidas/requisiciones), con
//       área/motivo "DEVOLUCIÓN A PROVEEDOR" y, opcionalmente, el folio
//       de la OC original como referencia — sin tocar ORDENES_COMPRA ni
//       su ciclo de vida (Pendiente/Parcial/Recibida no cambian).
//
// Ambas quedan también en una bitácora propia (hoja DEVOLUCIONES) para
// poder reportarlas por separado de transferencias/salidas normales —
// mismo criterio que Mermas.gs (INV-03): no mezclar en KARDEX/SALIDA sin
// una forma de verlas agrupadas después.

function obtenerHojaDevoluciones_(){
  const ss = SpreadsheetApp.getActive();
  let hoja = ss.getSheetByName("DEVOLUCIONES");
  if(!hoja){
    hoja = ss.insertSheet("DEVOLUCIONES");
    hoja.appendRow(["Fecha", "Código", "Producto", "Cantidad", "Tipo", "Origen", "Destino", "Motivo", "Folio OC", "Folio Referencia", "Usuario", "Observaciones"]);
    hoja.getRange(1, 1, 1, 12).setFontWeight("bold");
  }
  return hoja;
}

/**
 * Devolución de una sucursal hacia CEDIS. Reutiliza
 * transferirEntreSucursalesApp (que ya valida rol, existencia suficiente
 * en origen, y registra Kardex en ambos extremos con folio TR-) — aquí
 * solo se fija sucursalDestino=CEDIS y se agrega el registro propio en
 * DEVOLUCIONES con el motivo.
 */
function registrarDevolucionSucursalApp(codigo, cantidad, sucursalOrigen, motivo, observaciones, token){

  motivo = String(motivo || "").trim();
  if(!motivo){
    throw new Error("Captura el motivo de la devolución.");
  }

  // transferirEntreSucursalesApp ya valida token/rol, código, cantidad,
  // existencia suficiente y que origen != destino — no se duplica nada
  // de eso aquí.
  const resultado = transferirEntreSucursalesApp(codigo, sucursalOrigen, SUCURSAL_DEFAULT_, cantidad, token);

  const usuario = obtenerNombreDesdeToken(token);
  const filaMatriz = buscarFilaMatrizPorCodigo_(codigo);
  const producto = filaMatriz !== -1 ? SpreadsheetApp.getActive().getSheetByName("MATRIZ").getRange(filaMatriz, 1).getValue() : codigo;

  obtenerHojaDevoluciones_().appendRow([
    new Date(), codigo, producto, cantidad, "SUCURSAL_A_CEDIS",
    resultado.sucursalOrigen, resultado.sucursalDestino, motivo, "", resultado.folio, usuario, observaciones || ""
  ]);

  registrarAuditoria(usuario, "DEVOLUCIONES", "DEVOLUCIÓN A CEDIS", resultado.folio, codigo, producto, 0, cantidad,
    "Desde " + resultado.sucursalOrigen + " — " + motivo);

  return resultado;

}

/**
 * Devolución de CEDIS hacia un proveedor — una salida normal (misma
 * función central que usa cualquier otra salida, con su misma validación
 * de existencia suficiente), etiquetada con área "DEVOLUCIÓN A
 * PROVEEDOR" y, si se captura, el folio de la OC original como
 * referencia (sin tocar esa OC ni su estado).
 */
function registrarDevolucionProveedorApp(codigo, producto, cantidad, udm, motivo, folioOC, observaciones, token){

  requerirAccesoAlmacenApp_(token);

  motivo = String(motivo || "").trim();
  if(!motivo){
    throw new Error("Captura el motivo de la devolución.");
  }

  const usuario = obtenerNombreDesdeToken(token);
  const folioReferencia = "DEV-" + new Date().getTime();

  const notaSalida = "DEVOLUCIÓN A PROVEEDOR — " + motivo + (folioOC ? (" (OC " + folioOC + ")") : "") + (observaciones ? (" — " + observaciones) : "");

  const resultadoSalida = registrarSalidaInterna_({
    codigo: codigo,
    producto: producto,
    cantidad: cantidad,
    udm: udm,
    folio: folioReferencia,
    area: "DEVOLUCIÓN A PROVEEDOR",
    observacion: notaSalida
  }, usuario);

  obtenerHojaDevoluciones_().appendRow([
    new Date(), codigo, producto, cantidad, "CEDIS_A_PROVEEDOR",
    SUCURSAL_DEFAULT_, "Proveedor", motivo, folioOC || "", folioReferencia, usuario, observaciones || ""
  ]);

  registrarAuditoria(usuario, "DEVOLUCIONES", "DEVOLUCIÓN A PROVEEDOR", folioReferencia, codigo, producto, 0, cantidad, notaSalida);

  return { ok: true, folio: folioReferencia, existenciaRestante: resultadoSalida.existenciaRestante };

}

/**
 * Lista de devoluciones (ambos tipos) en un rango de fechas — mismo
 * patrón que obtenerMermasApp/obtenerOrdenesCompraApp.
 */
function obtenerDevolucionesApp(desde, hasta, token){

  requerirSesionActivaApp_(token);

  const hoja = obtenerHojaDevoluciones_();
  if(hoja.getLastRow() < 2) return [];

  const fechaDesde = desde ? new Date(desde) : null;
  const fechaHasta = hasta ? new Date(hasta) : null;
  if(fechaHasta) fechaHasta.setHours(23, 59, 59, 999);

  const datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 12).getValues();

  return datos
    .filter(f => {
      const fecha = f[0] instanceof Date ? f[0] : new Date(f[0]);
      if(fechaDesde && fecha < fechaDesde) return false;
      if(fechaHasta && fecha > fechaHasta) return false;
      return true;
    })
    .map(f => ({
      fecha: f[0] instanceof Date ? Utilities.formatDate(f[0], Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm") : String(f[0] || ""),
      codigo: f[1], producto: f[2], cantidad: Number(f[3]) || 0, tipo: f[4],
      origen: f[5], destino: f[6], motivo: f[7], folioOC: f[8] || "", folioReferencia: f[9] || "",
      usuario: f[10], observaciones: f[11] || ""
    }))
    .reverse();

}
