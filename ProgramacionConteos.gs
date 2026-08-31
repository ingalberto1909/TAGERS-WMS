
function obtenerProgramacionConteos() {
  const hoja = SpreadsheetApp.getActive()
    .getSheetByName("PROGRAMACION_CONTEOS");

  const datos = hoja.getDataRange().getValues();
  datos.shift(); // quitar encabezados

  return datos;
}

function generarIdProgramacion() {
  const hoja = SpreadsheetApp.getActive()
    .getSheetByName("PROGRAMACION_CONTEOS");

  const ultimo = hoja.getLastRow();
  return "PC-" + Utilities.formatString("%04d", ultimo);
}

function guardarProgramacion(datos) {
  const hoja = SpreadsheetApp.getActive()
    .getSheetByName("PROGRAMACION_CONTEOS");

  hoja.appendRow([
    generarIdProgramacion(),   // A ID
    datos.rack,                // B Rack
    datos.dia,                 // C Día
    datos.frecuencia,          // D Frecuencia
    datos.responsable,         // E Responsable
    "ACTIVO",                  // F Estado
    ""                         // G Última generación
  ]);

  return true;
}

function obtenerDiaActual() {
  const dias = [
    "DOMINGO",
    "LUNES",
    "MARTES",
    "MIERCOLES",
    "JUEVES",
    "VIERNES",
    "SABADO"
  ];

  return dias[new Date().getDay()];
}

function generarConteosDelDia() {

  const hoja = SpreadsheetApp.getActive()
    .getSheetByName("PROGRAMACION_CONTEOS");

  const datos = hoja.getDataRange().getValues();

  // Quitar encabezado
  datos.shift();

  const hoy = obtenerDiaActual();
  const racksHoy = [];

  datos.forEach((fila, i) => {

    const rack = fila[1];           // Columna B
    const dia = fila[2];            // Columna C
    const frecuencia = fila[3];     // Columna D
    const responsable = fila[4];    // Columna E
    const estado = fila[5];         // Columna F
    const ultima = fila[6];         // Columna G

    // Solo programas activos del día actual
    if (estado === "ACTIVO" && dia === hoy) {

      // Evitar generar dos veces el mismo día
      const hoyTexto = Utilities.formatDate(
        new Date(),
        Session.getScriptTimeZone(),
        "yyyy-MM-dd"
      );

      let yaGenerado = false;

      if (ultima) {
        const ultimaTexto = Utilities.formatDate(
          new Date(ultima),
          Session.getScriptTimeZone(),
          "yyyy-MM-dd"
        );

        yaGenerado = (ultimaTexto === hoyTexto);
      }

      if (!yaGenerado) {
        racksHoy.push(rack);

        // Actualizar última generación
        hoja.getRange(i + 2, 7).setValue(new Date());
      }
    }
  });

  // Si hay racks para hoy, generar el conteo
  if (racksHoy.length > 0) {

    // ARQ-201: usa el mismo núcleo que la generación manual desde la SPA
    // (generarConteoRacksInterna_, en 📁 App.gs.gs) — antes llamaba a la
    // función legada generarConteoRacks (Código.gs), que NO registraba
    // CONTROL_CONTEOS, así que un conteo generado automáticamente no
    // aparecía donde el resto del sistema espera verlo.
    generarConteoRacksInterna_(racksHoy, "Sistema (programación automática)");

    // Registrar en auditoría — registrarAuditoria(usuario, modulo, accion,
    // folio, codigo, producto, cantidadAnterior, cantidadNueva, observacion),
    // ver Código.gs. La llamada anterior pasaba solo 3 argumentos
    // posicionales (quedaban usuario="CONTEO_PROGRAMADO", modulo=racks,
    // accion=el mensaje, y el resto undefined/NaN) — se corrigió, y ahora
    // esta función SÍ está conectada (ver instalarTriggerProgramacionConteos
    // al final de este archivo).
    registrarAuditoria(
      "Sistema (programación automática)", "CONTEO", "GENERACION CONTEO PROGRAMADA",
      racksHoy.join(", "), "", "", 0, racksHoy.length,
      "Generación automática de conteos del día: " + obtenerDiaActual()
    );

    return {
      generado: true,
      dia: hoy,
      racks: racksHoy,
      total: racksHoy.length
    };
  }

  return {
    generado: false,
    dia: hoy,
    racks: [],
    total: 0
  };
}

function pruebaGeneracionHoy() {
  const resultado = generarConteosDelDia();
  Logger.log(JSON.stringify(resultado, null, 2));
}

/**
 * ARQ-201 (auditoría de arquitectura, evolución continua): instala el
 * disparador diario — CORRER UNA SOLA VEZ A MANO desde el editor de Apps
 * Script (▶ Ejecutar → instalarTriggerProgramacionConteos), nunca desde
 * la web app. Es seguro volver a correrla: primero borra cualquier
 * disparador anterior de esta misma función, así nunca queda duplicado.
 *
 * Corre a las 5 a.m., una hora antes del aviso por correo de "conteos de
 * hoy" (instalarTriggerAvisoConteosHoy, Notificaciones.gs, 6 a.m.) — así
 * el conteo ya existe en CONTEO_CICLICO para cuando el responsable
 * reciba el correo y abra la app a capturarlo.
 */
function instalarTriggerProgramacionConteos(){

  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction() === "generarConteosDelDia"){
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger("generarConteosDelDia")
    .timeBased()
    .everyDays(1)
    .atHour(5)
    .create();

  return { ok: true, mensaje: "Disparador diario instalado — corre todos los días entre 5:00 y 6:00 a.m. (zona horaria del proyecto), una hora antes del aviso por correo de conteos de hoy." };

}