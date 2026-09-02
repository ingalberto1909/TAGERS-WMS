// ============================================
// MERMAS.GS — TAGERS WMS 2.0 (auditoría comparativa vs. MarketMan, INV-03)
// ============================================
//
// Antes, una merma real (producto dañado/vencido/perdido) solo se podía
// registrar pasando primero por un conteo cíclico completo hasta que
// alguien la aprobara como discrepancia — quedaba mezclada dentro de
// KARDEX como un "AJUSTE" más, indistinguible de un error de captura o
// de un ajuste administrativo, sin cantidad/costo/origen reportables por
// separado. Este archivo agrega un tipo de movimiento propio ("MERMA")
// y una bitácora dedicada (hoja MERMAS), con su propio punto de entrada
// directo — sin pasar por conteo cíclico — para el caso real que motivó
// esto ("se cayó una caja ahora mismo").
//
// No se reinventa el mecanismo de existencia: se apoya en
// ajustarExistenciaMatrizPorDeltaValidado_, la misma función central que
// ya usan Salidas/Transferencias (valida dentro del mismo lock que no
// quede negativa) — así ya funciona para cualquier sucursal sin código
// adicional, aunque el caso de uso principal (y el único probado a fondo
// aquí) es CEDIS/S01. El permiso exigido es el mismo que ya piden el
// resto de los ajustes de existencia (Almacén/Admin/Supervisor) — no se
// abre todavía a que cualquier operador reporte su propia merma.

const MOTIVOS_MERMA_VALIDOS_ = ["PRODUCTO DAÑADO", "CADUCIDAD/VENCIMIENTO", "ERROR DE MANEJO", "ROBO/EXTRAVÍO", "OTRO"];

function obtenerHojaMermas_(){
  const ss = SpreadsheetApp.getActive();
  let hoja = ss.getSheetByName("MERMAS");
  if(!hoja){
    hoja = ss.insertSheet("MERMAS");
    hoja.appendRow(["Fecha", "Código", "Producto", "Cantidad", "UDM", "Costo Unitario", "Valor", "Motivo", "Sucursal", "Usuario", "Observaciones"]);
    hoja.getRange(1, 1, 1, 11).setFontWeight("bold");
  }
  return hoja;
}

/**
 * Registra una merma inmediata de un producto: descuenta existencia (con
 * la misma validación de negativos que cualquier salida), calcula su
 * valor con calcularValorInventario_ (misma función central de
 * valorización que usa el resto del proyecto), y deja rastro en 3
 * lugares: KARDEX (tipo "MERMA", propio — antes no existía ninguno),
 * MERMAS (bitácora dedicada, consultable por motivo/fecha/valor) y
 * AUDITORIA (trazabilidad general de quién la registró).
 */
function registrarMermaApp(codigo, cantidad, motivo, sucursal, observaciones, token){

  requerirAccesoAlmacenApp_(token);

  codigo = String(codigo || "").trim();
  cantidad = Number(cantidad);
  motivo = String(motivo || "").trim().toUpperCase();
  sucursal = normalizarSucursal_(sucursal);
  observaciones = String(observaciones || "").trim();

  if(!codigo){
    throw new Error("Captura el producto.");
  }
  if(!cantidad || cantidad <= 0){
    throw new Error("Captura una cantidad mayor a cero.");
  }
  if(MOTIVOS_MERMA_VALIDOS_.indexOf(motivo) === -1){
    throw new Error("Motivo inválido. Usa uno de: " + MOTIVOS_MERMA_VALIDOS_.join(", ") + ".");
  }

  const filaMatriz = buscarFilaMatrizPorCodigo_(codigo);
  if(filaMatriz === -1){
    throw new Error("No se encontró el producto " + codigo);
  }

  const matriz = SpreadsheetApp.getActive().getSheetByName("MATRIZ");
  const datosProducto = matriz.getRange(filaMatriz, 1, 1, 20).getValues()[0];
  const nombreProducto = datosProducto[0];
  const udm = datosProducto[1];
  const costoUnitario = Number(datosProducto[17]) || 0;
  const convertir = datosProducto[18];
  const presentacion = datosProducto[19];

  const usuario = obtenerNombreDesdeToken(token);
  const fecha = new Date();

  const resultadoExistencia = ajustarExistenciaMatrizPorDeltaValidado_(codigo, -cantidad, sucursal);
  const existenciaAnterior = resultadoExistencia.anterior;
  const existenciaNueva = resultadoExistencia.nueva;

  const valor = Math.round((calcularValorInventario_(cantidad, costoUnitario, convertir, presentacion) || 0) * 100) / 100;

  const notaKardex = motivo + (observaciones ? (" — " + observaciones) : "") + (sucursal !== SUCURSAL_DEFAULT_ ? " (" + sucursal + ")" : "");

  const kardex = SpreadsheetApp.getActive().getSheetByName("KARDEX");
  kardex.appendRow([
    fecha,
    Utilities.formatDate(fecha, Session.getScriptTimeZone(), "HH:mm:ss"),
    "MERMA",
    "MER-" + fecha.getTime(),
    codigo,
    nombreProducto,
    0,
    cantidad,
    existenciaAnterior,
    existenciaNueva,
    usuario,
    notaKardex
  ]);
  invalidarCacheHoja_("KARDEX");

  obtenerHojaMermas_().appendRow([
    fecha, codigo, nombreProducto, cantidad, udm, costoUnitario, valor, motivo, sucursal, usuario, observaciones
  ]);

  registrarAuditoria(usuario, "INVENTARIO", "MERMA REGISTRADA", "", codigo, nombreProducto, existenciaAnterior, existenciaNueva, notaKardex);

  return { ok: true, valor: valor, existenciaNueva: existenciaNueva };

}

/**
 * Lista de mermas en un rango de fechas (ambos opcionales — sin ninguno,
 * trae todo el historial). Más recientes primero, mismo criterio que
 * obtenerOrdenesCompraApp/obtenerHistorialInventariosApp.
 */
function obtenerMermasApp(desde, hasta, token){

  requerirSesionActivaApp_(token);

  const hoja = obtenerHojaMermas_();
  if(hoja.getLastRow() < 2) return [];

  const fechaDesde = desde ? new Date(desde) : null;
  const fechaHasta = hasta ? new Date(hasta) : null;
  if(fechaHasta) fechaHasta.setHours(23, 59, 59, 999);

  const datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 11).getValues();

  return datos
    .filter(f => {
      const fecha = f[0] instanceof Date ? f[0] : new Date(f[0]);
      if(fechaDesde && fecha < fechaDesde) return false;
      if(fechaHasta && fecha > fechaHasta) return false;
      return true;
    })
    .map(f => ({
      fecha: f[0] instanceof Date ? Utilities.formatDate(f[0], Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm") : String(f[0] || ""),
      codigo: f[1], producto: f[2], cantidad: Number(f[3]) || 0, udm: f[4],
      costoUnitario: Number(f[5]) || 0, valor: Number(f[6]) || 0, motivo: f[7],
      sucursal: f[8], usuario: f[9], observaciones: f[10] || ""
    }))
    .reverse();

}

/**
 * Resumen para el reporte de mermas: valor total y desglose por motivo —
 * justo el "cuánto dinero se perdió por desperdicio, separado del
 * consumo normal" que motivó este módulo.
 */
function obtenerResumenMermasApp(desde, hasta, token){

  const lista = obtenerMermasApp(desde, hasta, token);

  const valorTotal = Math.round(lista.reduce((suma, m) => suma + m.valor, 0) * 100) / 100;

  const porMotivo = {};
  lista.forEach(m => {
    porMotivo[m.motivo] = Math.round(((porMotivo[m.motivo] || 0) + m.valor) * 100) / 100;
  });

  return { totalRegistros: lista.length, valorTotal: valorTotal, porMotivo: porMotivo };

}
