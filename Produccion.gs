
function obtenerHojaProduccion_(){
  const ss = SpreadsheetApp.getActive();
  let hoja = ss.getSheetByName("PRODUCCION");
  if(!hoja){
    hoja = ss.insertSheet("PRODUCCION");
    hoja.getRange(1, 1, 1, 14).setValues([[
      "Folio Lote", "Fecha elaboración", "Fecha caducidad",
      "Código receta", "Receta", "Código producto", "Producto",
      "Requisición origen", "Cantidad producida", "UDM",
      "Cantidad disponible", "Estado", "Usuario", "Observaciones"
    ]]);
    hoja.getRange(1, 1, 1, 14).setFontWeight("bold");
  }
  return hoja;
}

function generarFolioLote_(hoja, fecha){
  const fechaCodigo = Utilities.formatDate(fecha, Session.getScriptTimeZone(), "yyyyMMdd");
  let consecutivo = 1;
  if(hoja.getLastRow() > 1){
    const folios = hoja.getRange(2, 1, hoja.getLastRow()-1, 1).getValues().flat();
    consecutivo = folios.filter(function(f){ return f.toString().includes("PROD-"+fechaCodigo); }).length + 1;
  }
  return "PROD-" + fechaCodigo + "-" + Utilities.formatString("%03d", consecutivo);
}

function obtenerRequisicionListaParaProduccionApp(folio){
  const detalle = obtenerDetalleRequisicionRecetaApp(folio);
  if(detalle.estado !== "ENTREGADA"){
    throw new Error("La requisición " + folio + " todavía no tiene los insumos entregados — confírmala primero.");
  }
  return detalle;
}

function registrarProduccionApp(datos, token){

  requerirAccesoAlmacenApp_(token);

  const folioRequisicion = String((datos && datos.folioRequisicion) || "").trim();
  if(!folioRequisicion){
    throw new Error("Indica la requisición de receta de origen.");
  }

  const requisicion = obtenerRequisicionListaParaProduccionApp(folioRequisicion);

  const nombreReceta = String((datos && datos.nombreReceta) || "").trim();
  const receta = requisicion.recetas.find(function(r){ return r.nombreReceta === nombreReceta; });
  if(!receta){
    throw new Error("Esa receta no forma parte de la requisición " + folioRequisicion + ".");
  }

  const cantidadProducida = Number(datos && datos.cantidadProducida) || 0;
  if(cantidadProducida <= 0){
    throw new Error("Captura una cantidad producida mayor a cero.");
  }

  const codigoProducto = String((datos && datos.codigoProducto) || "").trim();
  const filaMatriz = buscarFilaMatrizPorCodigo_(codigoProducto);
  if(filaMatriz === -1){
    throw new Error("El código " + codigoProducto + " no existe en MATRIZ — créalo primero como producto terminado.");
  }

  const matriz = SpreadsheetApp.getActive().getSheetByName("MATRIZ");
  const filaDatos = matriz.getRange(filaMatriz, 1, 1, 11).getValues()[0];
  const nombreProducto = filaDatos[0];
  const udm = String((datos && datos.udm) || "").trim() || filaDatos[1] || "";
  const ubicacionMatriz = filaDatos[9] || "";

  const usuario = obtenerNombreDesdeToken(token);
  const fecha = new Date();
  const hoja = obtenerHojaProduccion_();
  const fechaCaducidad = (datos && datos.fechaCaducidad) || "";

  let folioLote;

  conBloqueoApp_(function(){

    folioLote = generarFolioLote_(hoja, fecha);

    hoja.appendRow([
      folioLote, fecha, fechaCaducidad,
      receta.codigoReceta, receta.nombreReceta, codigoProducto, nombreProducto,
      folioRequisicion, cantidadProducida, udm,
      cantidadProducida, "ACTIVO", usuario, (datos && datos.observaciones) || ""
    ]);

  });

  registrarEntradaInterna_(
    {
      codigo: codigoProducto, producto: nombreProducto, cantidad: cantidadProducida,
      udm: udm, ubicacion: (datos && datos.ubicacion) || ubicacionMatriz,
      lote: folioLote, caducidad: fechaCaducidad
    },
    usuario, folioLote,
    "Producción — Lote " + folioLote + " (Requisición " + folioRequisicion + ")"
  );

  registrarAuditoria(usuario, "PRODUCCION", "LOTE REGISTRADO", folioLote, "", "", 0, cantidadProducida,
    receta.nombreReceta + " — " + cantidadProducida + " " + udm + " (Requisición " + folioRequisicion + ")");

  return { folio: folioLote, producto: nombreProducto, cantidadProducida: cantidadProducida };

}

/**
 * Autocompletar "Código de producto terminado" al elegir una receta en
 * el formulario de Registrar Producción: RECETAS no guarda ningún
 * vínculo hacia el producto terminado en MATRIZ (columnas A-G, ver
 * Recetas.gs), pero el producto terminado de cada receta ya existe en
 * MATRIZ con el MISMO nombre (confirmado por el usuario) — así que se
 * busca directo por nombre, sin depender de si esa receta ya se produjo
 * antes. Usa normalizarTexto_ (mayúsculas, sin acentos, sin espacios de
 * más) para que un match exacto no falle por diferencias de formato. Si
 * ningún producto de MATRIZ tiene ese nombre, regresa null y el usuario
 * sigue pudiendo escanear/escribir el código a mano, como ya funcionaba.
 */
function obtenerProductoTerminadoPorNombreRecetaApp(nombreReceta){

  const nombreNormalizado = normalizarTexto_(nombreReceta);
  if(!nombreNormalizado) return null;

  const matriz = SpreadsheetApp.getActive().getSheetByName("MATRIZ");
  const datos = matriz.getDataRange().getValues();

  for(let i = 1; i < datos.length; i++){
    if(normalizarTexto_(datos[i][0]) === nombreNormalizado){
      return {
        codigoProducto: String(datos[i][4] || "").trim(),
        producto: datos[i][0],
        udm: datos[i][1],
        ubicacion: datos[i][9]
      };
    }
  }

  return null;

}

function obtenerLotesProduccionApp(filtros){
  const hoja = obtenerHojaProduccion_();
  if(hoja.getLastRow() < 2) return [];

  const datos = hoja.getRange(2, 1, hoja.getLastRow()-1, 14).getValues();
  const codigoFiltro = (filtros && filtros.codigoProducto) ? String(filtros.codigoProducto).trim() : "";
  const estadoFiltro = (filtros && filtros.estado) ? String(filtros.estado).trim().toUpperCase() : "";

  return datos
    .filter(function(f){
      return (!codigoFiltro || String(f[5]).trim() === codigoFiltro) &&
             (!estadoFiltro || String(f[11]).trim().toUpperCase() === estadoFiltro);
    })
    .map(function(f){
      return {
        folio: f[0],
        fechaElaboracion: f[1] instanceof Date ? Utilities.formatDate(f[1], Session.getScriptTimeZone(), "dd/MM/yyyy") : f[1],
        fechaCaducidad: f[2] instanceof Date ? Utilities.formatDate(f[2], Session.getScriptTimeZone(), "dd/MM/yyyy") : f[2],
        codigoReceta: f[3], receta: f[4], codigoProducto: f[5], producto: f[6],
        requisicionOrigen: f[7], cantidadProducida: Number(f[8])||0, udm: f[9],
        cantidadDisponible: Number(f[10])||0, estado: f[11], usuario: f[12], observaciones: f[13]
      };
    })
    .reverse();
}

function cerrarLoteProduccionApp(folioLote, token){

  requerirAccesoAlmacenApp_(token);

  const hoja = obtenerHojaProduccion_();
  if(hoja.getLastRow() < 2) throw new Error("No hay lotes registrados.");

  const datos = hoja.getRange(2, 1, hoja.getLastRow()-1, 1).getValues();
  let fila = -1;
  datos.forEach(function(f, i){ if(String(f[0]) === String(folioLote)) fila = i + 2; });

  if(fila === -1) throw new Error("No se encontró el lote " + folioLote);

  hoja.getRange(fila, 12).setValue("AGOTADO"); // L = Estado
  hoja.getRange(fila, 11).setValue(0);         // K = Cantidad disponible

  const usuario = obtenerNombreDesdeToken(token);
  registrarAuditoria(usuario, "PRODUCCION", "LOTE CERRADO", folioLote, "", "", 0, 0, "Marcado como AGOTADO");

  return { ok: true };

}