
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

    // ESTA ES TU FUNCIÓN QUE YA TIENES
    generarConteoRacks(racksHoy);

    // Registrar en auditoría
    registrarAuditoria(
      "CONTEO_PROGRAMADO",
      racksHoy.join(", "),
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