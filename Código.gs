function irEntrada(){
  SpreadsheetApp.getActive().getSheetByName("ENTRADA").activate();
}

function irSalida(){
  SpreadsheetApp.getActive().getSheetByName("SALIDA").activate();
}

function irConsulta(){
  SpreadsheetApp.getActive().getSheetByName("CONSULTA").activate();
}

function irEtiqueta(){
  SpreadsheetApp.getActive().getSheetByName("ETIQUETAS").activate();
}

function nuevaEntrada() {

  const ss = SpreadsheetApp.getActive();
  const hoja = ss.getSheetByName("ENTRADA");

  hoja.activate();

  let fila = hoja.getLastRow() + 1;
  if (fila < 4) fila = 4;

  hoja.getRange(fila, 2).setValue(new Date());

  hoja.setActiveSelection("D" + fila);

}

function onOpen() {

  SpreadsheetApp.getUi()
    .createMenu("📦 Inventario")
    .addItem("📥 Nueva Entrada", "nuevaEntrada")
    .addItem("📤 Nueva Salida", "nuevaSalida")
    .addItem("🔍 Consultar Producto", "irConsulta")
    .addItem("🖨 Imprimir Etiqueta", "irEtiqueta")
    .addItem("📋 Generar Conteo Cíclico", "generarConteo")
    .addItem("📷 Capturar Conteo", "abrirCapturaConteo")
    .addItem("🔎 Revisar Discrepancias", "revisarDiscrepancias")
    .addItem("✅ Aprobar Discrepancias","abrirAprobacion")
    .addItem("📚 Cerrar Conteo y Guardar Historial","abrirCierreConteo")
    .addItem("📜 Kardex de Movimientos","abrirKardex")
    .addSeparator()
    .addItem("🗺️ Mapa del Almacén", "abrirMapa")
    .addItem("📊 Dashboard Ejecutivo","abrirDashboard")
    .addToUi();

}

function debugKardex(){

  const ss = SpreadsheetApp.getActive();
  const hoja = ss.getSheetByName("KARDEX");

  if (!hoja) {
    Logger.log("❌ NO SE ENCONTRÓ una hoja llamada exactamente 'KARDEX'.");
    Logger.log("Hojas que sí existen en este archivo:");
    ss.getSheets().forEach(h => Logger.log(" - " + h.getName()));
    return;
  }

  Logger.log("✅ Hoja encontrada: " + hoja.getName());
  Logger.log("Última fila con datos (getLastRow): " + hoja.getLastRow());
  Logger.log("Última columna con datos (getLastColumn): " + hoja.getLastColumn());

  if (hoja.getLastRow() >= 2) {

    const datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 12).getValues();

    Logger.log("Filas de datos encontradas: " + datos.length);
    Logger.log("Primera fila de datos: " + JSON.stringify(datos[0]));
    Logger.log("Última fila de datos: " + JSON.stringify(datos[datos.length - 1]));

  } else {

    Logger.log("⚠️ getLastRow() dio menos de 2 — el script piensa que la hoja no tiene datos, solo encabezado.");

  }

}

function nuevaSalida() {

  const ss = SpreadsheetApp.getActive();
  const hoja = ss.getSheetByName("SALIDA");

  hoja.activate();

  let fila = hoja.getLastRow() + 1;

  if (fila < 4) fila = 4;

  hoja.getRange(fila,3).setValue(new Date());

  hoja.setActiveSelection("D" + fila);

}

function abrirAprobacion(){

  const html = HtmlService
    .createHtmlOutputFromFile("AprobacionDiscrepancias")
    .setWidth(650)
    .setHeight(700);

  SpreadsheetApp.getUi()
    .showModalDialog(html, "✅ Aprobación de Discrepancias");

}

function abrirMapa() {

  var html = HtmlService
      .createHtmlOutputFromFile("MapaAlmacenV3")
      .setWidth(1300)
      .setHeight(800);

  SpreadsheetApp.getUi()
      .showModalDialog(html, "TAGERS WMS V3");

}

function guardarConteoFisico(fila,cantidad){

  const hoja = SpreadsheetApp
    .getActive()
    .getSheetByName("CONTEO_CICLICO");

  const folio = hoja.getRange(fila,1).getValue();

  const sistema = Number(
    hoja.getRange(fila,7).getValue()
  );

  const fisico = Number(cantidad);

  const diferencia = Math.round((fisico - sistema) * 1000) / 1000;

  let estado="CONTADO";

  if(diferencia!=0){
    estado="DIFERENCIA";
  }

  hoja.getRange(fila,8).setValue(fisico);
  hoja.getRange(fila,9).setValue(diferencia);
  hoja.getRange(fila,10).setValue(estado);

  actualizarAvanceControlConteo(folio);

  return true;

}

function actualizarAvanceControlConteo(folio){

  const ss = SpreadsheetApp.getActive();
  const conteo = ss.getSheetByName("CONTEO_CICLICO");
  const control = ss.getSheetByName("CONTROL_CONTEOS");

  if(!control){ return; }
  if(conteo.getLastRow() < 2){ return; }

  const datosConteo = conteo.getRange(2,1,conteo.getLastRow()-1,10).getValues();

  let total = 0;
  let contados = 0;

  datosConteo.forEach(fila=>{
    if(fila[0] == folio){
      total++;
      if(fila[7] !== "" && fila[7] !== null && fila[7] !== undefined){
        contados++;
      }
    }
  });

  const avance = total === 0 ? 0 : Math.round((contados/total)*100);

  if(control.getLastRow() < 2){ return; }

  const datosControl = control.getRange(2,1,control.getLastRow()-1,8).getValues();

  for(let i=0;i<datosControl.length;i++){
    if(datosControl[i][0] == folio){
      const filaControl = i+2;
      control.getRange(filaControl,6).setValue(contados);  // F CONTADOS
      control.getRange(filaControl,7).setValue(avance);     // G AVANCE
      break;
    }
  }

}

function abrirDashboard(){

  const html = HtmlService
    .createTemplateFromFile("Dashboard")
    .evaluate()
    .setWidth(1300)
    .setHeight(800);

  SpreadsheetApp.getUi()
    .showModalDialog(html, "📊 Dashboard Ejecutivo");

}

function obtenerDashboard(){

  const ss = SpreadsheetApp.getActive();

  const matriz = ss.getSheetByName("MATRIZ");
  const discrepancias = ss.getSheetByName("DISCREPANCIAS");
  const conteo = ss.getSheetByName("CONTEO_CICLICO");

  const datos = matriz.getRange(2,1,matriz.getLastRow()-1,17).getValues();

  let productos=0;
  let ubicaciones=0;
  let bajoMinimo=0;
  let agotados=0;

  let ubic=new Set();

  datos.forEach(f=>{

    if(f[4]!="") productos++;

    if(f[9]!="") ubic.add(f[9]);

    const existencia=Number(f[10])||0;
    const minimo=Number(f[11])||0;

    if(existencia==0){
      agotados++;
    }else if(existencia<minimo){
      bajoMinimo++;
    }

  });

  ubicaciones=ubic.size;

  let pendientes=0;

  if(discrepancias.getLastRow()>1){

    const d=discrepancias
      .getRange(2,9,discrepancias.getLastRow()-1,1)
      .getValues();

    d.forEach(x=>{
      if(x[0]=="PENDIENTE"){
        pendientes++;
      }
    });

  }

  let conteos=0;

  if(conteo.getLastRow()>1){

    const c=conteo
      .getRange(2,10,conteo.getLastRow()-1,1)
      .getValues();

    c.forEach(x=>{
      if(x[0]!="CERRADO"){
        conteos++;
      }
    });

  }

  return{
    productos,
    ubicaciones,
    bajoMinimo,
    agotados,
    pendientes,
    conteos
  };

}

function obtenerAvanceConteo(){

  try {

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = ss.getSheetByName("CONTEO_CICLICO");

    if(!hoja){
      throw new Error("No existe la hoja CONTEO_CICLICO");
    }

    const ultimaFila = hoja.getLastRow();

    if(ultimaFila < 2){
      return {
        total:0,
        contados:0,
        pendientes:0,
        porcentaje:0
      };
    }

    const datos = hoja
      .getRange(2,1,ultimaFila-1,11)
      .getValues();

    let total = 0;
    let contados = 0;

    datos.forEach(function(fila){

      if(fila[3] !== ""){

        total++;

        if(fila[7] !== ""){
          contados++;
        }

      }

    });

    return {
      total: total,
      contados: contados,
      pendientes: total-contados,
      porcentaje: total === 0 ? 0 : Math.round((contados/total)*100)
    };

  } catch(e){
    throw new Error(e.message);
  }

}

function include(nombreArchivo) {
  return HtmlService.createHtmlOutputFromFile(nombreArchivo).getContent();
}

function abrirCapturaConteo(){

  const html = HtmlService
    .createHtmlOutputFromFile("CapturaConteo")
    .setWidth(500)
    .setHeight(600);

  SpreadsheetApp.getUi()
    .showModalDialog(html,"📷 Captura Conteo Cíclico");

}

function buscarCodigoConteo(codigo, folio){

  const hoja = SpreadsheetApp
    .getActive()
    .getSheetByName("CONTEO_CICLICO");

  const datos = hoja
    .getRange(2,1,hoja.getLastRow()-1,11)
    .getValues();

  for(let i=0;i<datos.length;i++){

    const mismoFolio = !folio || datos[i][0].toString() == folio.toString();

    if(mismoFolio && datos[i][3].toString()==codigo.toString()){

      return {
        fila:i+2,
        folio:datos[i][0],
        codigo:datos[i][3],
        producto:datos[i][4],
        ubicacion:datos[i][5],
        existencia:datos[i][6],
        fisico:datos[i][7],
        diferencia:datos[i][8],
        estado:datos[i][9],
        rack:datos[i][10]
      };

    }

  }

  return null;

}

function obtenerSiguientePendiente(folio) {

  const hoja = SpreadsheetApp
    .getActive()
    .getSheetByName("CONTEO_CICLICO");

  const ultimaFila = hoja.getLastRow();

  if (ultimaFila < 2) {
    return null;
  }

  const datos = hoja
    .getRange(2, 1, ultimaFila - 1, 11)
    .getValues();

  for (let i = 0; i < datos.length; i++) {

    const codigo = datos[i][3];
    const fisico = datos[i][7];
    const mismoFolio = !folio || datos[i][0].toString() == folio.toString();

    if (mismoFolio && codigo !== "" && fisico === "") {

      return {
        fila: i + 2,
        folio: datos[i][0],
        codigo: codigo,
        producto: datos[i][4],
        ubicacion: datos[i][5],
        existencia: datos[i][6],
        fisico: datos[i][7],
        diferencia: datos[i][8],
        estado: datos[i][9],
        rack: datos[i][10]
      };

    }

  }

  return null;

}

function cerrarConteoFolio(folio){

  const ss = SpreadsheetApp.getActive();
  const conteo = ss.getSheetByName("CONTEO_CICLICO");
  const historial = ss.getSheetByName("HISTORIAL_CONTEOS");
  const auditoria = ss.getSheetByName("AUDITORIA_AJUSTES");
  const control = ss.getSheetByName("CONTROL_CONTEOS");

  if(!auditoria){
    SpreadsheetApp.getUi().alert(
      "No se encontró la hoja 'AUDITORIA_AJUSTES'. Verifica que el nombre sea exactamente ese (sin espacios ni variaciones)."
    );
    return;
  }

  const ultimaFila = conteo.getLastRow();

  if(ultimaFila < 2){
    SpreadsheetApp.getUi().alert("No hay conteos para cerrar");
    return;
  }

  const datos = conteo.getRange(2,1,ultimaFila-1,11).getValues();

  let historialDatos = [];
  let auditoriaDatos = [];
  let ajustesKardex = [];
  let pendientes = 0;
  let filasIndices = [];

  const usuario = obtenerNombreUsuario();
  const fechaHoy = new Date();

  datos.forEach((fila, i) => {

    if(fila[3] == "") return;
    if(fila[0] != folio) return;

    filasIndices.push(i);

    if(fila[7] === "" || fila[7] === null || fila[7] === undefined){
      pendientes++;
      return;
    }

    const existenciaAnterior = Number(fila[6]);
    const existenciaNueva   = Number(fila[7]);
    const diferencia        = Number(fila[8]);

    let resultado = "CORRECTO";
    if(diferencia != 0){
      resultado = "AJUSTADO";
    }

    historialDatos.push([
      fila[0], fila[1], fila[2], fila[3], fila[4], fila[5],
      fila[6], fila[7], fila[8], resultado, new Date(), usuario
    ]);

    if(resultado == "AJUSTADO"){

      auditoriaDatos.push([
        fechaHoy, fila[3], fila[4], existenciaAnterior, existenciaNueva, diferencia,
        usuario, "Ajuste por conteo cíclico " + folio, fila[10] || ""
      ]);

      ajustesKardex.push({
        codigo: fila[3],
        producto: fila[4],
        diferencia: diferencia,
        existenciaAnterior: existenciaAnterior,
        existenciaNueva: existenciaNueva
      });

    }

  });

  if(pendientes > 0){
    SpreadsheetApp.getUi().alert(
      "El conteo todavía tiene " + pendientes + " productos pendientes"
    );
    return;
  }

  if(historialDatos.length > 0){
    historial
      .getRange(historial.getLastRow()+1, 1, historialDatos.length, 12)
      .setValues(historialDatos);
  }

  if(auditoriaDatos.length > 0){
    auditoria
      .getRange(auditoria.getLastRow()+1, 1, auditoriaDatos.length, 9)
      .setValues(auditoriaDatos);
  }

  ajustesKardex.forEach(a => {
    actualizarExistenciaMatriz_(a.codigo, a.existenciaNueva);
    registrarKardex(
      "AJUSTE",
      folio,
      a.codigo,
      a.producto,
      a.diferencia > 0 ? a.diferencia : "",
      a.diferencia < 0 ? Math.abs(a.diferencia) : "",
      a.existenciaAnterior,
      a.existenciaNueva,
      usuario,
      "Ajuste por conteo cíclico " + folio
    );
  });

  filasIndices.forEach(i => {
    conteo.getRange(i+2, 10, 1, 1).setValue("CERRADO");
  });

  if(control && control.getLastRow() > 1){
    const datosControl = control.getRange(2,1,control.getLastRow()-1,8).getValues();
    for(let i=0;i<datosControl.length;i++){
      if(datosControl[i][0] == folio){
        control.getRange(i+2,8).setValue("CERRADO");
        break;
      }
    }
  }

  SpreadsheetApp.getUi().alert(
    "Conteo cerrado correctamente\n\n" +
    "Productos guardados: " + historialDatos.length + "\n" +
    "Ajustes registrados: " + auditoriaDatos.length
  );

}

function abrirKardex(){

  const html = HtmlService
    .createTemplateFromFile("ConsultaKardex")
    .evaluate()
    .setWidth(950)
    .setHeight(720);

  SpreadsheetApp.getUi()
    .showModalDialog(html, "📜 Kardex de Movimientos");

}

function obtenerHistorialKardex(codigo){

  const hoja = SpreadsheetApp.getActive().getSheetByName("KARDEX");

  if (hoja.getLastRow() < 2) return [];

  const datos = hoja
    .getRange(2, 1, hoja.getLastRow() - 1, 12)
    .getValues();

  const codigoBuscado = codigo.toString().trim().toUpperCase();

  let movimientos = [];

  datos.forEach(fila => {

    const codigoFila = fila[4].toString().trim().toUpperCase();

    if (codigoFila == codigoBuscado) {

      movimientos.push({
        fecha: Utilities.formatDate(
          new Date(fila[0]),
          Session.getScriptTimeZone(),
          "dd/MM/yyyy"
        ),
        fechaOrden: new Date(fila[0]).getTime(),
        hora: fila[1],
        tipo: fila[2],
        folio: fila[3],
        codigo: fila[4],
        producto: fila[5],
        entrada: fila[6],
        salida: fila[7],
        existenciaAnterior: fila[8],
        existenciaNueva: fila[9],
        usuario: fila[10],
        observacion: fila[11]
      });

    }

  });

  movimientos.sort((a, b) => b.fechaOrden - a.fechaOrden);

  return movimientos;

}

function obtenerUltimosMovimientosKardex(limite) {
  limite = limite || 8;

  const hoja = SpreadsheetApp.getActive().getSheetByName("KARDEX");

  if (!hoja || hoja.getLastRow() < 2) return [];

  const datos = hoja
    .getRange(2, 1, hoja.getLastRow() - 1, 12)
    .getValues();

  const zonaHoraria = Session.getScriptTimeZone();

  const movimientos = datos.map(fila => {
    const fecha = fila[0] instanceof Date ? fila[0] : new Date(fila[0]);
    const hora = fila[1] instanceof Date
      ? Utilities.formatDate(fila[1], zonaHoraria, "HH:mm:ss")
      : String(fila[1] || "");

    return {
      fecha: Utilities.formatDate(fecha, zonaHoraria, "dd/MM/yyyy"),
      fechaOrden: fecha.getTime(),
      hora: hora,
      tipo: String(fila[2] || ""),
      codigo: String(fila[4] || ""),
      producto: String(fila[5] || ""),
      entrada: fila[6] || "",
      salida: fila[7] || "",
      existenciaNueva: fila[9] || 0,
      usuario: String(fila[10] || "")
    };
  });

  movimientos.sort((a, b) => b.fechaOrden - a.fechaOrden);

  return movimientos.slice(0, limite);
}

function formatoNumero(valor) {
  const numero = Number(valor);

  if (isNaN(numero)) return "-";

  return numero.toLocaleString("es-MX", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

function onEdit(e) {

  const hoja = e.range.getSheet();
  const nombreHoja = hoja.getName();

  if (nombreHoja != "ENTRADA" && nombreHoja != "SALIDA") return;

  const fila = e.range.getRow();
  const columna = e.range.getColumn();

  if (fila < 4) return;

  if (columna == 4) {

    const codigo = e.range.getValue();

    if (codigo == "") return;

    const ss = SpreadsheetApp.getActive();
    const matriz = ss.getSheetByName("MATRIZ");

    const datos = matriz.getRange(2,1,matriz.getLastRow()-1,10).getValues();

    const meses = [
      "ENERO","FEBRERO","MARZO","ABRIL","MAYO","JUNIO",
      "JULIO","AGOSTO","SEPTIEMBRE","OCTUBRE","NOVIEMBRE","DICIEMBRE"
    ];

    for (let i = 0; i < datos.length; i++) {

      if (datos[i][4] == codigo) {

        hoja.getRange(fila,1).setValue(new Date().getFullYear());
        hoja.getRange(fila,2).setValue(meses[new Date().getMonth()]);
        hoja.getRange(fila,3).setValue(new Date());
        hoja.getRange(fila,5).setValue(datos[i][0]);
        hoja.getRange(fila,7).setValue(datos[i][1]);
        hoja.getRange(fila,11).setValue(datos[i][9]);

        break;

      }

    }

    return;

  }

  if (columna == 6) {

    if (e.oldValue !== undefined && e.oldValue !== "") return;

    const cantidad = Number(e.value);

    if (!cantidad || cantidad <= 0) return;

    const codigo = hoja.getRange(fila, 4).getValue();
    const producto = hoja.getRange(fila, 5).getValue();

    if (codigo == "") return;

    const ss = SpreadsheetApp.getActive();
    const matriz = ss.getSheetByName("MATRIZ");

    const datosMatriz = matriz
      .getRange(2, 1, matriz.getLastRow() - 1, 11)
      .getValues();

    let existenciaNueva = 0;

    for (let i = 0; i < datosMatriz.length; i++) {

      if (datosMatriz[i][4] == codigo) {

        existenciaNueva = Number(datosMatriz[i][10]) || 0;
        break;

      }

    }

    let existenciaAnterior;
    let entradaVal = "";
    let salidaVal  = "";

    if (nombreHoja == "ENTRADA") {

      existenciaAnterior = existenciaNueva - cantidad;
      entradaVal = cantidad;

    } else {

      existenciaAnterior = existenciaNueva + cantidad;
      salidaVal = cantidad;

    }

    registrarKardex(
      nombreHoja,
      "",
      codigo,
      producto,
      entradaVal,
      salidaVal,
      existenciaAnterior,
      existenciaNueva,
      obtenerNombreUsuario(),
      ""
    );

    return;

  }

}

function registrarAuditoria(
usuario,
modulo,
accion,
folio,
codigo,
producto,
cantidadAnterior,
cantidadNueva,
observacion
){

  const hoja = SpreadsheetApp
    .getActive()
    .getSheetByName("AUDITORIA");

  const diferencia = cantidadNueva - cantidadAnterior;

  hoja.appendRow([
    "AUD-"+Utilities.getUuid().substring(0,8),
    new Date(),
    new Date(),
    usuario,
    modulo,
    accion,
    folio,
    codigo,
    producto,
    cantidadAnterior,
    cantidadNueva,
    diferencia,
    observacion
  ]);

}

function obtenerFoliosAbiertos(){

  const hoja =
    SpreadsheetApp
      .getActive()
      .getSheetByName("CONTEO_CICLICO");

  const datos =
    hoja
      .getRange(2,1,hoja.getLastRow()-1,10)
      .getValues();

  let folios=[];

  datos.forEach(f=>{

    if(
      f[0] &&
      f[9]!="CERRADO" &&
      !folios.includes(f[0])
    ){
      folios.push(f[0]);
    }

  });

  return folios;

}

function abrirCierreConteo(){

  const html = HtmlService
    .createHtmlOutputFromFile("SeleccionarCierreConteo")
    .setWidth(400)
    .setHeight(300);

  SpreadsheetApp.getUi()
    .showModalDialog(
      html,
      "📚 Cerrar Conteo"
    );

}

function generarConteo(){

  const html = HtmlService
    .createHtmlOutputFromFile("SeleccionRackConteo")
    .setWidth(400)
    .setHeight(300);

  SpreadsheetApp.getUi()
    .showModalDialog(html,"📋 Seleccionar Rack para Conteo");

}

function obtenerRacksConteo(){

  const hoja = SpreadsheetApp.getActive()
    .getSheetByName("MATRIZ");

  const datos = hoja
    .getRange(2,7,hoja.getLastRow()-1,1)
    .getValues();

  let racks=[];

  datos.forEach(fila=>{

    if(fila[0] && !racks.includes(fila[0])){
      racks.push(fila[0]);
    }

  });

  return racks.sort();

}

function obtenerNombreUsuario(){

  const correo = obtenerUsuario();
  const hoja = SpreadsheetApp
    .getActive()
    .getSheetByName("USUARIOS");

  const datos = hoja
    .getRange(2,1,hoja.getLastRow()-1,2)
    .getValues();

  for(let i=0;i<datos.length;i++){

    if(datos[i][0] == correo){
      return datos[i][1];
    }

  }

  return correo;

}

function obtenerUsuario(){
  return Session.getActiveUser().getEmail();
}

function generarConteoRacks(racks){

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const matriz = ss.getSheetByName("MATRIZ");
  const conteo = ss.getSheetByName("CONTEO_CICLICO");

  const datos = matriz
    .getRange(2,1,matriz.getLastRow()-1,17)
    .getValues();

  const fecha = new Date();

  const usuario = obtenerUsuario();

  let salida=[];
  const fechaCodigo = Utilities.formatDate(
    fecha,
    Session.getScriptTimeZone(),
    "yyyyMMdd"
  );

  let consecutivo = 1;

  if(conteo.getLastRow() > 1){

    const folios = conteo
      .getRange(2,1,conteo.getLastRow()-1,1)
      .getValues()
      .flat();

    const conteosHoy = folios.filter(f =>
      f.toString().includes("CC-"+fechaCodigo)
    );

    consecutivo = conteosHoy.length + 1;

  }

  const folioConteo =
    "CC-"+fechaCodigo+"-"+Utilities.formatString(
      "%03d",
      consecutivo
    );

  datos.forEach((fila,index)=>{

    let rackProducto = fila[6];

    if(
      racks.includes(rackProducto)
      && fila[4]
      && fila[9]
    ){

      salida.push([
        folioConteo,
        fecha,
        usuario,
        fila[4],
        fila[0],
        fila[9],
        fila[10],
        "",
        "",
        "PENDIENTE",
        rackProducto
      ]);

    }

  });

  if(salida.length>0){

    conteo
      .getRange(
        conteo.getLastRow()+1,
        1,
        salida.length,
        11
      )
      .setValues(salida);
  }

  registrarControlConteo(
    folioConteo,
    fecha,
    usuario,
    racks,
    salida.length
  );

  registrarAuditoria(
    usuario,
    "CONTEO",
    "GENERACION CONTEO",
    folioConteo,
    "",
    "",
    0,
    salida.length,
    "Conteo generado para racks: "+racks.join(", ")
  );

  SpreadsheetApp.getUi()
    .alert(
      "Conteo generado correctamente\n\nRacks: "+
      racks.join(", ")+
      "\nProductos: "+
      salida.length
    );

}

function revisarDiscrepancias(){

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const conteo = ss.getSheetByName("CONTEO_CICLICO");
  const diferencias = ss.getSheetByName("DISCREPANCIAS");

  const datos = conteo
    .getRange(2,1,conteo.getLastRow()-1,11)
    .getValues();

  let yaExistentes = new Set();

  if(diferencias.getLastRow() > 1){
    const datosExistentes = diferencias
      .getRange(2, 2, diferencias.getLastRow()-1, 2) // columnas B (folio) y C (código)
      .getValues();

    datosExistentes.forEach(fila=>{
      yaExistentes.add(fila[0] + "||" + fila[1]);
    });
  }

  let salida=[];

  datos.forEach(fila=>{

    let sistema = Number(fila[6]) || 0;
    let fisico = Number(fila[7]) || 0;

    let diferencia = Math.round((fisico - sistema) * 1000) / 1000;

    const clave = fila[0] + "||" + fila[3];

    if(
      fila[7] !== "" &&
      diferencia != 0 &&
      fila[9] == "DIFERENCIA" &&
      !yaExistentes.has(clave)
    ){
      salida.push([
        new Date(),
        fila[0],
        fila[3],
        fila[4],
        fila[5],
        fila[6],
        fila[7],
        diferencia,
        fila[10],
        "PENDIENTE",
        "",
        "",
        "",
        ""
      ]);

      yaExistentes.add(clave);
    }

  });

  if(salida.length>0){

    diferencias
      .getRange(
        diferencias.getLastRow()+1,
        1,
        salida.length,
        14
      )
      .setValues(salida);

    SpreadsheetApp.getUi()
      .alert(
        "Discrepancias encontradas: "
        +salida.length
      );

  }else{

    SpreadsheetApp.getUi()
      .alert(
        "No se encontraron diferencias"
      );

  }

}

function obtenerDiscrepanciasPendientes(){

  const hoja = SpreadsheetApp
    .getActive()
    .getSheetByName("DISCREPANCIAS");

  const ultimaFila = hoja.getLastRow();

  if(ultimaFila < 2){
    return [];
  }

  const datos = hoja
    .getRange(2,1,ultimaFila-1,14)
    .getValues();

  let pendientes=[];

  datos.forEach((fila,index)=>{

    if(fila[9]=="PENDIENTE"){

      pendientes.push({
        fila:index+2,
        folio:fila[1],
        codigo:fila[2],
        producto:fila[3],
        ubicacion:fila[4],
        sistema:fila[5],
        fisico:fila[6],
        diferencia:fila[7],
        rack:fila[8],
        estado:fila[9]
      });

    }

  });

  return pendientes;

}

function rechazarDiscrepancia(fila, comentario){

  const hoja = SpreadsheetApp
    .getActive()
    .getSheetByName("DISCREPANCIAS");

  hoja.getRange(fila,10).setValue("RECHAZADO");
  hoja.getRange(fila,11).setValue(obtenerUsuario());
  hoja.getRange(fila,12).setValue(new Date());
  hoja.getRange(fila,13).setValue(comentario);
  hoja.getRange(fila,14).setValue("SIN AJUSTE");

  return true;

}

function aprobarDiscrepancia(fila, motivo, comentario) {

  const ss = SpreadsheetApp.getActive();
  const hoja = ss.getSheetByName("DISCREPANCIAS");
  const entradaHoja = ss.getSheetByName("ENTRADA");
  const salidaHoja  = ss.getSheetByName("SALIDA");
  const auditoria   = ss.getSheetByName("AUDITORIA_AJUSTES");

  const datos = hoja.getRange(fila, 1, 1, 14).getValues()[0];

  const folio        = datos[1] || "";
  const codigo      = datos[2];
  const producto     = datos[3];
  const ubicacion     = datos[4];
  const sistema      = Number(datos[5]) || 0;
  const fisico       = Number(datos[6]) || 0;
  const diferencia    = Number(datos[7]) || 0;
  const rack           = datos[8] || "";

  const usuario = obtenerUsuario();
  const nombreUsuario = obtenerNombreUsuario();
  const ahora = new Date();

  const meses = [
    "ENERO","FEBRERO","MARZO","ABRIL","MAYO","JUNIO",
    "JULIO","AGOSTO","SEPTIEMBRE","OCTUBRE","NOVIEMBRE","DICIEMBRE"
  ];

  hoja.getRange(fila, 10).setValue("APROBADO");
  hoja.getRange(fila, 11).setValue(usuario);
  hoja.getRange(fila, 12).setValue(ahora);
  hoja.getRange(fila, 13).setValue(comentario);
  hoja.getRange(fila, 14).setValue(motivo);

  if (diferencia > 0) {

    entradaHoja.appendRow([
      ahora.getFullYear(),
      meses[ahora.getMonth()],
      ahora,
      codigo,
      producto,
      Math.abs(diferencia),
      "",
      "AJUSTE",
      "",
      "",
      ubicacion
    ]);

  } else if (diferencia < 0) {

    salidaHoja.appendRow([
      ahora.getFullYear(),
      meses[ahora.getMonth()],
      ahora,
      codigo,
      producto,
      Math.abs(diferencia),
      "",
      "AJUSTE-" + motivo.toUpperCase(),
      "",
      "",
      ubicacion
    ]);

  }

  if(auditoria){
    auditoria.appendRow([
      ahora,
      codigo,
      producto,
      sistema,
      fisico,
      diferencia,
      nombreUsuario,
      "Discrepancia aprobada" + (folio ? (" — conteo " + folio) : "") + ": " + motivo + (comentario ? (" - " + comentario) : ""),
      rack
    ]);
  }

  registrarKardex(
    "AJUSTE",
    folio,
    codigo,
    producto,
    diferencia > 0 ? Math.abs(diferencia) : "",
    diferencia < 0 ? Math.abs(diferencia) : "",
    sistema,
    fisico,
    nombreUsuario,
    motivo + " - " + comentario
  );

  return true;

}

function aprobarDiscrepanciasLoteApp(lista){

  let exitosas = 0;
  let fallidas = [];

  (lista || []).forEach(item=>{
    try{
      aprobarDiscrepancia(item.fila, item.motivo, item.comentario || "");
      exitosas++;
    }catch(e){
      fallidas.push({ fila: item.fila, error: e.message });
    }
  });

  return { exitosas: exitosas, fallidas: fallidas };
}

function obtenerRacks(){

  const ss = SpreadsheetApp.getActive();
  const hoja = ss.getSheetByName("MATRIZ");

  const datos = hoja.getRange(2,7,hoja.getLastRow()-1,1).getValues();

  let racks = [];

  datos.forEach(r=>{

    if(r[0] != "" && !racks.includes(r[0])){
      racks.push(r[0]);
    }

  });

  return racks.sort();

}

function obtenerUbicacionesRack(rack){

  const ss = SpreadsheetApp.getActive();
  const hoja = ss.getSheetByName("MATRIZ");

  const datos = hoja.getRange(
    2,
    1,
    hoja.getLastRow()-1,
    17
  ).getValues();

  let ubicaciones = {};

  datos.forEach(fila => {

    const nivel = String(fila[7] || "").trim().toUpperCase();
    const posicion = String(fila[8] || "").trim().toUpperCase();

    if(fila[6] == rack && nivel != "" && posicion != ""){

      let clave = nivel + "-" + posicion;

      if(!ubicaciones[clave]){

        ubicaciones[clave] = {
          rack: fila[6],
          nivel: nivel,
          posicion: posicion,
          ubicacion: fila[9],
          productos: []
        };

      }

      ubicaciones[clave].productos.push({
        producto: fila[0],
        udm: fila[1],
        categoria: fila[2],
        codigo: fila[4],
        existencia: fila[10],
        minimo: fila[11],
        maximo: fila[12],
        estado: fila[13],
        entrada: fila[14],
        salidas: fila[15],
        proveedor: fila[16]
      });

    }

  });

  return Object.values(ubicaciones);

}

function buscarProducto(texto) {

  if (!texto || texto.length < 2) return [];

  texto = texto.toString().toUpperCase();

  const hoja = SpreadsheetApp.getActive().getSheetByName("MATRIZ");
  const datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 17).getValues();

  let resultados = [];

  datos.forEach(fila => {

    const producto = (fila[0] || "").toString().toUpperCase();
    const codigo   = (fila[4] || "").toString().toUpperCase();

    if (producto.includes(texto) || codigo.includes(texto)) {

      resultados.push({
        producto: fila[0],
        udm: fila[1],
        categoria: fila[2],
        codigo: fila[4],
        rack: fila[6],
        nivel: fila[7],
        posicion: fila[8],
        ubicacion: fila[9],
        existencia: fila[10],
        minimo: fila[11],
        estado: fila[13],
        proveedor: fila[16]
      });

    }

  });

  return resultados;

}

function obtenerResumenRacks() {

  const hoja = SpreadsheetApp.getActive().getSheetByName("MATRIZ");
  const datos = hoja.getRange(2,1,hoja.getLastRow()-1,17).getValues();

  let resumen = {};

  datos.forEach(fila => {

    const rack = fila[6];

    if (!rack) return;

    if (!resumen[rack]) {

      resumen[rack] = {
        rack: rack,
        productos: 0,
        ubicaciones: new Set(),
        bajoMinimo: 0,
        agotados: 0
      };

    }

    resumen[rack].productos++;

    if(fila[9] != ""){
      resumen[rack].ubicaciones.add(fila[9]);
    }

    const existencia = Number(fila[10]) || 0;
    const minimo = Number(fila[11]) || 0;

    if (existencia == 0){
      resumen[rack].agotados++;
    }else if (existencia < minimo){
      resumen[rack].bajoMinimo++;
    }

  });

  return Object.values(resumen).map(r => ({
    rack: r.rack,
    productos: r.productos,
    ubicaciones: r.ubicaciones.size,
    bajoMinimo: r.bajoMinimo,
    agotados: r.agotados
  }));
}

function registrarControlConteo(
folio,
fecha,
usuario,
racks,
productos
){

  const hoja = SpreadsheetApp
    .getActive()
    .getSheetByName("CONTROL_CONTEOS");

  if(!hoja){
    throw new Error(
      "No existe la hoja CONTROL_CONTEOS"
    );
  }

  hoja.appendRow([
    folio,               // A FOLIO
    fecha,               // B FECHA
    usuario,             // C USUARIO
    racks.join(", "),    // D RACKS
    productos,           // E PRODUCTOS
    0,                   // F CONTADOS
    0,                   // G AVANCE %
    "ABIERTO"            // H ESTADO
  ]);

}

function registrarKardex(
tipo,
folio,
codigo,
producto,
entrada,
salida,
existenciaAnterior,
existenciaNueva,
usuario,
observacion
){

  const hoja = SpreadsheetApp
    .getActive()
    .getSheetByName("KARDEX");

  hoja.appendRow([
    new Date(),
    Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      "HH:mm:ss"
    ),
    tipo,
    folio,
    codigo,
    producto,
    entrada,
    salida,
    existenciaAnterior,
    existenciaNueva,
    usuario,
    observacion
  ]);

}

function obtenerProductoPorCodigo(codigo) {
  const hoja = SpreadsheetApp.getActive().getSheetByName("MATRIZ");

  if (!hoja) {
    throw new Error("No existe la hoja MATRIZ.");
  }

  const codigoBuscado = String(codigo || "").trim().toUpperCase();
  const ultimaFila = hoja.getLastRow();

  if (!codigoBuscado || ultimaFila < 2) return null;

  const datos = hoja.getRange(2, 1, ultimaFila - 1, 17).getValues();

  for (let i = 0; i < datos.length; i++) {
    const fila = datos[i];
    const codigoFila = String(fila[4] || "").trim().toUpperCase();

    if (codigoFila === codigoBuscado) {
      return {
        codigo: String(fila[4] || ""),
        producto: String(fila[0] || ""),
        udm: String(fila[1] || ""),
        ubicacion: String(fila[9] || ""),
        existencia: Number(fila[10]) || 0
      };
    }
  }

  return null;
}

function registrarMovimientoDashboard(tipo, datosFormulario) {
  const tipoMovimiento = String(tipo || "").toUpperCase();

  if (tipoMovimiento !== "ENTRADA" && tipoMovimiento !== "SALIDA") {
    throw new Error("Tipo de movimiento no válido.");
  }

  const cantidad = Number(datosFormulario.cantidad);

  if (!Number.isFinite(cantidad) || cantidad <= 0) {
    throw new Error("La cantidad debe ser mayor a cero.");
  }

  const producto = obtenerProductoPorCodigo(datosFormulario.codigo);

  if (!producto) {
    throw new Error("No se encontró el código en la hoja MATRIZ.");
  }

  if (tipoMovimiento === "SALIDA" && cantidad > producto.existencia) {
    throw new Error(
      "Existencia insuficiente. Disponible: " + producto.existencia
    );
  }

  const ss = SpreadsheetApp.getActive();
  const hojaMovimiento = ss.getSheetByName(tipoMovimiento);
  const ahora = new Date();

  const meses = [
    "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
    "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"
  ];

  const loteOArea = tipoMovimiento === "ENTRADA"
    ? (datosFormulario.lote || "")
    : (datosFormulario.area || "");

  hojaMovimiento.appendRow([
    ahora.getFullYear(),
    meses[ahora.getMonth()],
    ahora,
    producto.codigo,
    producto.producto,
    cantidad,
    producto.udm,
    loteOArea,
    "",
    "",
    producto.ubicacion
  ]);

  const existenciaAnterior = producto.existencia;
  const existenciaNueva = tipoMovimiento === "ENTRADA"
    ? existenciaAnterior + cantidad
    : existenciaAnterior - cantidad;

  registrarKardex(
    tipoMovimiento,
    "",
    producto.codigo,
    producto.producto,
    tipoMovimiento === "ENTRADA" ? cantidad : "",
    tipoMovimiento === "SALIDA" ? cantidad : "",
    existenciaAnterior,
    existenciaNueva,
    obtenerNombreUsuario(),
    datosFormulario.observacion || ""
  );

  return {
    mensaje: tipoMovimiento + " registrada correctamente.",
    producto: producto.producto,
    existenciaNueva: existenciaNueva
  };
}