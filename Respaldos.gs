/**
 * TAGERS WMS 2.0 — Backup automático diario (pedido del usuario, punto 4).
 *
 * Copia MATRIZ y KARDEX (como valores, no fórmulas) a un archivo de Sheets
 * nuevo por día, guardado en una carpeta dedicada de Drive — separado del
 * libro en vivo, para que un borrado/edición accidental en la hoja real no
 * se lleve también el respaldo.
 *
 * NO se expone a index.html ni a ningún botón — solo la dispara el
 * disparador de tiempo instalado una vez con instalarTriggerRespaldoDiario
 * (ver instrucciones al final de este archivo).
 */

const CARPETA_RESPALDOS_ = "TAGERS WMS — Respaldos";
const HOJAS_RESPALDO_DIARIO_ = ["MATRIZ", "KARDEX"];

function obtenerCarpetaRespaldos_(){
  const carpetas = DriveApp.getFoldersByName(CARPETA_RESPALDOS_);
  if(carpetas.hasNext()){
    return carpetas.next();
  }
  return DriveApp.createFolder(CARPETA_RESPALDOS_);
}

function respaldarHojasCriticasApp_(){

  const ss = SpreadsheetApp.getActive();
  const carpeta = obtenerCarpetaRespaldos_();
  const fecha = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const nombreArchivo = "TAGERS WMS — Respaldo " + fecha;

  // Idempotente: si ya corrió hoy (ej. el trigger se disparó dos veces, o
  // se ejecuta a mano para probar), reemplaza el respaldo del mismo día en
  // vez de acumular duplicados.
  const existentes = carpeta.getFilesByName(nombreArchivo);
  while(existentes.hasNext()){
    existentes.next().setTrashed(true);
  }

  const nuevo = SpreadsheetApp.create(nombreArchivo);
  const archivoNuevo = DriveApp.getFileById(nuevo.getId());

  // SpreadsheetApp.create() deja el archivo en la raíz de Drive del dueño
  // del script — se mueve a la carpeta dedicada (Drive no tiene "mover" de
  // verdad, es agregar a la carpeta destino y quitar de donde estaba).
  carpeta.addFile(archivoNuevo);
  DriveApp.getRootFolder().removeFile(archivoNuevo);

  let esPrimeraHoja = true;
  let hojasRespaldadas = 0;

  HOJAS_RESPALDO_DIARIO_.forEach(function(nombreHoja){

    const origen = ss.getSheetByName(nombreHoja);
    if(!origen) return; // hoja no existe todavía en este libro — se ignora, no se rompe el respaldo de las demás

    const datos = origen.getDataRange().getValues();

    let destino;
    if(esPrimeraHoja){
      destino = nuevo.getSheets()[0];
      destino.setName(nombreHoja);
      esPrimeraHoja = false;
    } else {
      destino = nuevo.insertSheet(nombreHoja);
    }

    if(datos.length && datos[0].length){
      destino.getRange(1, 1, datos.length, datos[0].length).setValues(datos);
    }

    hojasRespaldadas++;

  });

  return { archivo: nombreArchivo, url: nuevo.getUrl(), hojasRespaldadas: hojasRespaldadas };

}

/**
 * Instala el disparador diario — CORRER UNA SOLA VEZ A MANO desde el editor
 * de Apps Script (▶ Ejecutar → instalarTriggerRespaldoDiario), nunca desde
 * la web app. Es seguro volver a correrla: primero borra cualquier
 * disparador anterior de esta misma función, así nunca queda duplicado.
 */
function instalarTriggerRespaldoDiario(){

  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction() === "respaldarHojasCriticasApp_"){
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger("respaldarHojasCriticasApp_")
    .timeBased()
    .everyDays(1)
    .atHour(1)
    .create();

  return { ok: true, mensaje: "Disparador diario instalado — corre todos los días entre 1:00 y 2:00 a.m. (zona horaria del proyecto)." };

}
