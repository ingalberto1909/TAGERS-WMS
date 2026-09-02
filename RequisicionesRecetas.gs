
function buscarRecetaParaRequisicionApp(texto, token){
  requerirSesionActivaApp_(token);
  return buscarRecetasApp(texto, token).filter(r => r.estado === "ACTIVA");
}

function generarFolioRequisicionReceta_(){

  const hoja = obtenerHojaRequisiciones_();
  if(hoja.getLastRow() < 2) return "RIR-0001";

  const folios = hoja.getRange(2, 1, hoja.getLastRow()-1, 1).getValues();
  let maxNum = 0;

  folios.forEach(f => {
    const match = String(f[0]||"").match(/^RIR-(\d+)$/);
    if(match){
      const num = parseInt(match[1], 10);
      if(num > maxNum) maxNum = num;
    }
  });

  return "RIR-" + Utilities.formatString("%04d", maxNum + 1);

}

function crearRequisicionRecetaApp(observaciones, items, token){

  requerirSesionActivaApp_(token);

  const correo = obtenerCorreoDesdeToken_(token);
  const usuario = obtenerNombreDesdeToken(token);
  const area = obtenerAreaUsuarioPorCorreo_(correo);

  if(!area){
    throw new Error("Tu usuario no tiene un Área asignada en USUARIOS — pide al administrador que la capture.");
  }

  const activas = {};
  obtenerRecetasApp(token).forEach(r => { if(r.estado === "ACTIVA") activas[r.codigo] = r; });

  const validos = (items||[])
    .filter(it => it.codigoReceta && Number(it.cantidadSolicitada) > 0)
    .map(it => {
      const receta = activas[it.codigoReceta];
      if(!receta) throw new Error("La receta " + (it.nombreReceta||it.codigoReceta) + " ya no está activa — no se puede solicitar.");
      return {
        codigoReceta: receta.codigo,
        nombreReceta: receta.nombre,
        udm: Number(it.cantidadSolicitada) === 1 ? "receta" : "recetas",
        cantidadSolicitada: Number(it.cantidadSolicitada)
      };
    });

  if(!validos.length){
    throw new Error("Agrega al menos una receta con cantidad solicitada mayor a cero.");
  }

  const fecha = new Date();
  let folio;

  conBloqueoApp_(function(){
    folio = generarFolioRequisicionReceta_();

    obtenerHojaRequisiciones_().appendRow([
      folio, fecha, area, usuario, "PENDIENTE", observaciones || "", "", ""
    ]);
  });

  const detalle = obtenerHojaDetalleRequisiciones_();

  if(detalle.getRange(1, 7).getValue() === ""){
    detalle.getRange(1, 7).setValue("Tipo");
    detalle.getRange(1, 7).setFontWeight("bold");
  }

  const filas = validos.map(it => [
    folio, it.codigoReceta, it.nombreReceta, it.udm, it.cantidadSolicitada, "", "RECETA"
  ]);

  detalle.getRange(detalle.getLastRow()+1, 1, filas.length, 7).setValues(filas);

  registrarAuditoria(usuario, "REQUISICIONES", "NUEVA REQUISICIÓN DE RECETAS", folio, "", "", 0, 0,
    "Área " + area + " — " + filas.length + " receta(s)");

  return { folio: folio, recetas: filas.length };

}

// Versión interna sin guard propio — usada también por INV-06 (reserva de
// Requisiciones de Área) para saber si un folio es de receta ANTES de
// tocar la reserva de MATRIZ/EXISTENCIAS_SUCURSAL: el "código" de una fila
// de receta es un código de receta (REC-0001), nunca un código de MATRIZ,
// así que esa lógica debe saltarse por completo para estos folios.
function obtenerTipoRequisicion_(folio){

  const detalle = obtenerHojaDetalleRequisiciones_();
  if(detalle.getLastRow() < 2) return "PRODUCTO";

  const anchoDetalle = Math.min(detalle.getLastColumn(), 7);
  const datos = detalle.getRange(2, 1, detalle.getLastRow()-1, anchoDetalle).getValues();

  for(let i=0;i<datos.length;i++){
    if(String(datos[i][0]) === String(folio)){
      const tipo = anchoDetalle >= 7 ? String(datos[i][6]||"").trim().toUpperCase() : "";
      return tipo === "RECETA" ? "RECETA" : "PRODUCTO";
    }
  }

  return "PRODUCTO";

}

function obtenerTipoRequisicionApp(folio, token){
  requerirSesionActivaApp_(token);
  return obtenerTipoRequisicion_(folio);
}

// Versión interna sin guard propio — token sigue siendo opcional aquí,
// pero solo para decidir si se filtra por área (ver obtenerDetalleRequisicionApp,
// Requisiciones de producto): Producción la usa sin token a propósito para
// mantener acceso a cualquier área, y ya valida la sesión por su cuenta
// ANTES de llegar aquí (ver obtenerRequisicionListaParaProduccionApp). La
// pública (abajo) es la única que debe llamarse desde el cliente, y esa sí
// exige sesión siempre.
function obtenerDetalleRequisicionRecetaApp_(folio, token){

  const req = obtenerHojaRequisiciones_();
  const datosReq = req.getRange(2,1,req.getLastRow()-1,8).getValues();
  let encabezado = null;
  datosReq.forEach(f => { if(String(f[0]) === String(folio)) encabezado = f; });

  if(!encabezado) throw new Error("No se encontró la requisición " + folio);

  if(token){
    const acceso = obtenerAccesoRequisicionesApp(token);
    if(!acceso.esAdmin && String(encabezado[2]).trim() !== String(acceso.area).trim()){
      throw new Error("No se encontró la requisición " + folio);
    }
  }

  const detalle = obtenerHojaDetalleRequisiciones_();
  const anchoDetalle = Math.min(detalle.getLastColumn(), 7);
  const datosDetalle = detalle.getLastRow() > 1 ? detalle.getRange(2,1,detalle.getLastRow()-1,anchoDetalle).getValues() : [];

  const recetas = datosDetalle
    .filter(f => String(f[0]) === String(folio))
    .map(f => {
      let rendimiento = "";
      try{
        rendimiento = obtenerDetalleRecetaApp_(f[2]).rendimiento;
      }catch(e){
        rendimiento = "—"; // la receta pudo haberse renombrado después
      }
      return {
        codigoReceta: f[1],
        nombreReceta: f[2],
        udm: f[3],
        cantidadSolicitada: Number(f[4]) || 0,
        rendimiento: rendimiento
      };
    });

  return {
    folio: encabezado[0],
    fecha: encabezado[1] instanceof Date ? Utilities.formatDate(encabezado[1], Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm") : encabezado[1],
    area: encabezado[2], solicitante: encabezado[3], estado: encabezado[4], observaciones: encabezado[5],
    recetas: recetas
  };

}

function obtenerDetalleRequisicionRecetaApp(folio, token){
  requerirSesionActivaApp_(token);
  return obtenerDetalleRequisicionRecetaApp_(folio, token);
}

function parsearRendimiento_(rendimientoTexto){
  const texto = String(rendimientoTexto||"").trim();
  const match = texto.match(/^([\d.,]+)\s*(.*)$/);
  if(!match) return { valor: 0, udm: texto };
  return { valor: Number(match[1].replace(",", "")) || 0, udm: (match[2]||"").trim() };
}

function buscarProductoEnMatrizPorNombre_(nombre){

  const buscado = normalizarTexto_(nombre);
  const hoja = SpreadsheetApp.getActive().getSheetByName("MATRIZ");
  if(hoja.getLastRow() < 2) return null;

  // PROD-01: se amplía de 11 a 18 columnas (hasta R=Costo Unitario) para
  // que el costeo de recetas (Recetas.gs) pueda reusar esta misma
  // búsqueda por nombre sin duplicar la lectura de MATRIZ — costoUnitario
  // es un campo aditivo, ningún llamador existente lo leía antes.
  const datos = hoja.getRange(2, 1, hoja.getLastRow()-1, 18).getValues(); // A..R

  for(let i=0;i<datos.length;i++){
    const ubicacion = String(datos[i][9]||"").trim();
    if(ubicacionVacia_(ubicacion)) continue;
    if(normalizarTexto_(datos[i][0]) === buscado){
      return { codigo: datos[i][4], producto: datos[i][0], udm: datos[i][1], existencia: Number(datos[i][10])||0, costoUnitario: Number(datos[i][17])||0 };
    }
  }

  return null;

}

function obtenerCalculoIngredientesRequisicionApp(folio, token){
  requerirSesionActivaApp_(token);
  return obtenerCalculoIngredientesRequisicionApp_(folio, token);
}

// Versión interna sin sesión — la usa construirHtmlRequisicionReceta_ (PDF),
// que corre DESPUÉS de que confirmarEntregaRequisicionRecetaApp/
// obtenerPDFRequisicionRecetaApp ya validaron acceso de Almacén; llamarla sin
// token (como hacía antes la función pública, causando el error "Tu sesión
// expiró" en cualquier PDF de receta) se evita del todo. token sigue siendo
// opcional aquí a propósito, igual que en obtenerDetalleRequisicionRecetaApp_:
// si viene (llamada pública), se preserva el filtro por área.
function obtenerCalculoIngredientesRequisicionApp_(folio, token){

  const detalleReceta = obtenerDetalleRequisicionRecetaApp_(folio, token);

  const acumulado = {}; // ingrediente normalizado -> {nombre, necesario, udmReceta}

  detalleReceta.recetas.forEach(r => {

    const receta = obtenerDetalleRecetaApp_(r.nombreReceta);
    
    const factor = r.cantidadSolicitada;

    receta.ingredientes.forEach(ing => {
      const clave = normalizarTexto_(ing.nombre);
      const necesarioEsteIngrediente = Math.round(ing.cantidad * factor * 1000) / 1000;
      if(!acumulado[clave]){
        acumulado[clave] = { nombre: ing.nombre, necesario: 0, udmReceta: ing.udm };
      }
      acumulado[clave].necesario += necesarioEsteIngrediente;
    });

  });

  const ingredientes = Object.values(acumulado).map(ing => {

    const producto = buscarProductoEnMatrizPorNombre_(ing.nombre);
    let necesario = Math.round(ing.necesario * 1000) / 1000; // todavía en la UDM de la receta
    let sinConversionPosible = false;

    // La receta puede capturar el ingrediente en una UDM distinta a la
    // que usa MATRIZ para ese mismo producto (p. ej. receta en G,
    // producto controlado en KG) — antes se comparaba/descontaba el
    // número tal cual, sin convertir, lo que podía tratar 500 (gramos)
    // como si fueran 500 kg. Ahora se convierte a la UDM real del
    // producto antes de comparar contra existencia o sugerir cuánto
    // entregar. Si las unidades no son de la misma magnitud (p. ej. PZ
    // contra KG) no se inventa un factor — se deja tal cual y se marca
    // para revisión manual.
    if(producto){
      const factor = factorConversionUDM_(ing.udmReceta, producto.udm);
      if(factor !== null){
        necesario = Math.round(necesario * factor * 1000) / 1000;
      } else {
        sinConversionPosible = true;
      }
    }

    return {
      nombre: ing.nombre,
      codigo: producto ? producto.codigo : null,
      udm: producto ? producto.udm : ing.udmReceta,
      necesario: necesario,
      existencia: producto ? producto.existencia : null,
      entregarSugerido: producto ? Math.max(Math.min(necesario, producto.existencia), 0) : 0,
      encontrado: !!producto,
      sinConversionPosible: sinConversionPosible
    };

  });

  return {
    folio: detalleReceta.folio, area: detalleReceta.area, solicitante: detalleReceta.solicitante,
    fecha: detalleReceta.fecha, estado: detalleReceta.estado, observaciones: detalleReceta.observaciones,
    recetas: detalleReceta.recetas,
    ingredientes: ingredientes
  };

}

function confirmarEntregaRequisicionRecetaApp(folio, entregas, token){

  const acceso = obtenerAccesoRequisicionesApp(token);
  if(!acceso.esAdmin){
    throw new Error("Solo Almacén puede confirmar entregas.");
  }

  const usuario = obtenerNombreDesdeToken(token);

  const req = obtenerHojaRequisiciones_();
  const datosReq = req.getRange(2,1,req.getLastRow()-1,8).getValues();
  let filaReq = -1, areaReq = "";
  datosReq.forEach((f,i) => { if(String(f[0]) === String(folio)){ filaReq = i+2; areaReq = f[2]; } });
  if(filaReq === -1) throw new Error("No se encontró la requisición " + folio);

  let insumosEntregados = 0;

  (entregas||[]).forEach(e => {

    const cantidad = Number(e.cantidadEntregada) || 0;
    if(cantidad <= 0 || !e.codigo) return;

    registrarSalidaInterna_({
      codigo: e.codigo,
      producto: e.nombre || e.codigo,
      cantidad: cantidad,
      udm: e.udm || "",
      area: areaReq,
      ubicacion: "",
      folio: folio,
      observacion: "Requisición de receta " + folio + " — Área " + areaReq
    }, usuario);

    insumosEntregados++;

  });

  if(insumosEntregados === 0){
    throw new Error("Captura al menos una cantidad a entregar.");
  }

  const fechaEntrega = new Date();
  req.getRange(filaReq, 5).setValue("ENTREGADA");
  req.getRange(filaReq, 7).setValue(fechaEntrega);
  req.getRange(filaReq, 8).setValue(usuario);

  registrarAuditoria(usuario, "REQUISICIONES", "ENTREGA DE RECETA CONFIRMADA", folio, "", "", 0, 0,
    insumosEntregados + " insumo(s) entregados a " + areaReq);

  const pdf = generarYGuardarPDFRequisicionReceta_(folio);

  return { insumosEntregados: insumosEntregados, pdf: pdf };

}

function construirHtmlRequisicionReceta_(folio){

  const datos = obtenerCalculoIngredientesRequisicionApp_(folio);

  const filasRecetas = datos.recetas.map(r => `
    <tr>
      <td>🧪 ${r.nombreReceta}</td>
      <td style="text-align:center">${r.rendimiento}</td>
      <td style="text-align:right">${formatearCantidad_(r.cantidadSolicitada)} ${r.udm}</td>
    </tr>
  `).join("");

  const filasIngredientes = datos.ingredientes.map((ing,i) => `
    <tr style="background:${i%2===0?'#ffffff':'#F9F5EF'}">
      <td>${ing.nombre}${ing.encontrado ? "" : " ⚠️"}</td>
      <td style="text-align:right">${formatearCantidad_(ing.necesario)} ${ing.udm||""}</td>
      <td style="text-align:right">${ing.encontrado ? formatearCantidad_(ing.existencia) : "—"}</td>
    </tr>
  `).join("");

  const generado = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm");

  return construirHtmlDocumentoTagers_({
    titulo: "REQUISICIÓN DE RECETAS",
    folio: datos.folio,
    colorEstado: datos.estado === "ENTREGADA" ? "#5C6B2A" : "#C4522A",
    estado: datos.estado,
    infoGrid: [
      { etiqueta: "Área", valor: datos.area },
      { etiqueta: "Solicitante", valor: datos.solicitante },
      { etiqueta: "Fecha", valor: datos.fecha },
      { etiqueta: "Recetas solicitadas", valor: datos.recetas.length }
    ],
    kpis: [
      { num: datos.recetas.length, lbl: "Recetas" },
      { num: datos.ingredientes.length, lbl: "Insumos calculados" },
      { num: datos.ingredientes.filter(i=>i.encontrado).length, lbl: "Encontrados en catálogo" },
      { num: datos.ingredientes.filter(i=>!i.encontrado).length, lbl: "Sin coincidencia" }
    ],
    tablaEncabezados: `<th>Receta</th><th style="text-align:center">Rendimiento por tanda</th><th style="text-align:right">Tandas pedidas</th>`,
    tablaFilas: filasRecetas,
    observaciones: datos.observaciones,
    firmas: ["Solicitó", "Surtió"],
    generado: generado
  }).replace(
    "</table>",
    `</table><h4 style="margin:18px 36px 0;color:#6B2737">Insumos calculados</h4><table class="tablaItems"><thead><tr><th>Insumo</th><th style="text-align:right">Necesario</th><th style="text-align:right">Existencia</th></tr></thead><tbody>${filasIngredientes}</tbody></table>`
  );

}

function generarYGuardarPDFRequisicionReceta_(folio){

  const html = construirHtmlRequisicionReceta_(folio);
  const pdfBlob = HtmlService.createHtmlOutput(html).getAs("application/pdf").setName(folio + ".pdf");

  const carpeta = obtenerCarpetaRequisiciones_();
  const existentes = carpeta.getFilesByName(folio + ".pdf");
  while(existentes.hasNext()){ existentes.next().setTrashed(true); }

  const archivo = carpeta.createFile(pdfBlob);
  archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return {
    id: archivo.getId(),
    verUrl: "https://drive.google.com/file/d/" + archivo.getId() + "/view",
    descargarUrl: "https://drive.google.com/uc?export=download&id=" + archivo.getId()
  };

}

function obtenerPDFRequisicionRecetaApp(folio, token){
  requerirSesionActivaApp_(token);
  return generarYGuardarPDFRequisicionReceta_(folio);
}