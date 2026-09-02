
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

  const id = generarIdProgramacion();

  hoja.appendRow([
    id,                         // A ID
    datos.rack,                // B Rack
    datos.dia,                 // C Día
    datos.frecuencia,          // D Frecuencia
    datos.responsable,         // E Responsable
    "ACTIVO",                  // F Estado
    ""                         // G Última generación
  ]);

  return id;
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

// ============================================
// Administración de Programación de Conteos Cíclicos desde la web app.
// El motor de ejecución automática (generarConteosDelDia, arriba) ya
// corría desde antes (ARQ-201) — lo que faltaba era una pantalla para dar
// de alta/editar/activar/desactivar renglones de PROGRAMACION_CONTEOS sin
// abrir la hoja cruda en Sheets. Mismo criterio de acceso que Conteos
// Cíclicos operativo: ADMIN o SUPERVISOR (ver PERMISOS_ROL en index.html).
// Nunca se borra una fila físicamente (soft-delete vía columna Estado),
// mismo criterio que USUARIOS — así el historial de "última generación"
// de un rack desactivado no se pierde si se reactiva después.
// ============================================

const DIAS_PROGRAMACION_CONTEO_ = ["DOMINGO","LUNES","MARTES","MIERCOLES","JUEVES","VIERNES","SABADO"];
const FRECUENCIAS_PROGRAMACION_CONTEO_ = ["SEMANAL","QUINCENAL","MENSUAL"];

function requerirAccesoProgramacionConteosApp_(token){
  requerirSesionActivaApp_(token);
  const rol = String(obtenerRolDesdeToken(token) || "").toUpperCase();
  if(rol !== "ADMIN" && rol !== "SUPERVISOR"){
    throw new Error("No tienes permiso para administrar la programación de conteos.");
  }
}

/** Lista completa (ACTIVO e INACTIVO) para la pantalla de administración — el filtro por estado se hace en el frontend. */
function obtenerProgramacionConteosApp(token){
  requerirAccesoProgramacionConteosApp_(token);

  const hoja = SpreadsheetApp.getActive().getSheetByName("PROGRAMACION_CONTEOS");
  if(!hoja || hoja.getLastRow() < 2) return [];

  const datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 7).getValues();
  const zona = Session.getScriptTimeZone();

  return datos.map(function(f){
    return {
      id: f[0],
      rack: f[1],
      dia: f[2],
      frecuencia: f[3],
      responsable: f[4],
      estado: f[5] || "ACTIVO",
      ultimaGeneracion: f[6] ? Utilities.formatDate(new Date(f[6]), zona, "dd/MM/yyyy") : ""
    };
  });
}

/** Catálogos de apoyo (racks reales de MATRIZ + días/frecuencias válidas) para el formulario de alta/edición. */
function obtenerCatalogosProgramacionConteoApp(token){
  requerirAccesoProgramacionConteosApp_(token);
  return {
    racks: obtenerRacksConteo(),
    dias: DIAS_PROGRAMACION_CONTEO_,
    frecuencias: FRECUENCIAS_PROGRAMACION_CONTEO_
  };
}

function validarDatosProgramacionConteo_(datos){
  datos = datos || {};
  const rack = String(datos.rack || "").trim();
  const dia = String(datos.dia || "").trim().toUpperCase();
  const frecuencia = String(datos.frecuencia || "").trim().toUpperCase();
  const responsable = String(datos.responsable || "").trim();

  if(!rack) throw new Error("Selecciona un rack.");
  if(DIAS_PROGRAMACION_CONTEO_.indexOf(dia) === -1){
    throw new Error("Selecciona un día válido de la semana.");
  }
  if(!responsable) throw new Error("Captura quién es responsable de este conteo.");

  return {
    rack: rack,
    dia: dia,
    frecuencia: FRECUENCIAS_PROGRAMACION_CONTEO_.indexOf(frecuencia) !== -1 ? frecuencia : "SEMANAL",
    responsable: responsable
  };
}

function buscarFilaProgramacionConteoPorId_(hoja, id){
  if(hoja.getLastRow() < 2) return -1;
  const ids = hoja.getRange(2, 1, hoja.getLastRow() - 1, 1).getValues();
  for(let i = 0; i < ids.length; i++){
    if(String(ids[i][0]) === String(id)) return i + 2; // fila real (1-based, +1 por encabezado)
  }
  return -1;
}

/** Crea una programación nueva — reusa guardarProgramacion() dentro de un lock (evita ID duplicado si dos administradores crean al mismo tiempo). */
function crearProgramacionConteoApp(datos, token){
  requerirAccesoProgramacionConteosApp_(token);
  const limpio = validarDatosProgramacionConteo_(datos);
  const usuario = obtenerNombreDesdeToken(token);

  const id = conBloqueoApp_(function(){
    return guardarProgramacion(limpio);
  });

  registrarAuditoria(usuario, "CONTEO", "PROGRAMACION DE CONTEO CREADA", id, "", limpio.rack, 0, 0,
    "Rack " + limpio.rack + " — " + limpio.dia + " (" + limpio.frecuencia + "), responsable: " + limpio.responsable);

  return { ok: true, id: id };
}

/** Edita rack/día/frecuencia/responsable de una programación existente (no toca Estado ni Última generación). */
function editarProgramacionConteoApp(id, datos, token){
  requerirAccesoProgramacionConteosApp_(token);
  const limpio = validarDatosProgramacionConteo_(datos);
  const usuario = obtenerNombreDesdeToken(token);

  conBloqueoApp_(function(){
    const hoja = SpreadsheetApp.getActive().getSheetByName("PROGRAMACION_CONTEOS");
    const fila = buscarFilaProgramacionConteoPorId_(hoja, id);
    if(fila === -1) throw new Error("No se encontró la programación " + id + " — puede que ya haya sido eliminada.");
    hoja.getRange(fila, 2, 1, 4).setValues([[limpio.rack, limpio.dia, limpio.frecuencia, limpio.responsable]]);
  });

  registrarAuditoria(usuario, "CONTEO", "PROGRAMACION DE CONTEO EDITADA", id, "", limpio.rack, 0, 0,
    "Actualizada a: rack " + limpio.rack + " — " + limpio.dia + " (" + limpio.frecuencia + "), responsable: " + limpio.responsable);

  return { ok: true };
}

/** Activa/desactiva una programación (soft-delete — nunca se borra la fila). Una programación INACTIVA nunca se toma en cuenta en generarConteosDelDia (compara estado === "ACTIVO"). */
function cambiarEstadoProgramacionConteoApp(id, nuevoEstado, token){
  requerirAccesoProgramacionConteosApp_(token);
  const estado = String(nuevoEstado || "").trim().toUpperCase();
  if(estado !== "ACTIVO" && estado !== "INACTIVO"){
    throw new Error("Estado inválido.");
  }
  const usuario = obtenerNombreDesdeToken(token);

  conBloqueoApp_(function(){
    const hoja = SpreadsheetApp.getActive().getSheetByName("PROGRAMACION_CONTEOS");
    const fila = buscarFilaProgramacionConteoPorId_(hoja, id);
    if(fila === -1) throw new Error("No se encontró la programación " + id + " — puede que ya haya sido eliminada.");
    hoja.getRange(fila, 6, 1, 1).setValue(estado);
  });

  registrarAuditoria(usuario, "CONTEO", "PROGRAMACION DE CONTEO " + (estado === "ACTIVO" ? "ACTIVADA" : "DESACTIVADA"), id, "", "", 0, 0, "");

  return { ok: true };
}