function registrarMovimientoDashboard(tipo, datosFormulario) {
  const tipoMovimiento = String(tipo || "").toUpperCase();

  if (tipoMovimiento !== "ENTRADA" && tipoMovimiento !== "SALIDA") {
    throw new Error("Tipo de movimiento no válido.");
  }

  const codigoBuscado = String(datosFormulario.codigo || "")
    .trim()
    .toUpperCase();

  const cantidad = Number(datosFormulario.cantidad);

  if (!codigoBuscado) {
    throw new Error("Captura un código de producto.");
  }

  if (!Number.isFinite(cantidad) || cantidad <= 0) {
    throw new Error("La cantidad debe ser mayor a cero.");
  }

  const ss = SpreadsheetApp.getActive();
  const matriz = ss.getSheetByName("MATRIZ");
  const hojaMovimiento = ss.getSheetByName(tipoMovimiento);
  const kardex = ss.getSheetByName("KARDEX");

  if (!matriz || !hojaMovimiento || !kardex) {
    throw new Error("Falta la hoja MATRIZ, " + tipoMovimiento + " o KARDEX.");
  }

  const datosMatriz = matriz
    .getRange(2, 1, matriz.getLastRow() - 1, 17)
    .getValues();

  let producto = null;

  for (let i = 0; i < datosMatriz.length; i++) {
    const fila = datosMatriz[i];

    if (String(fila[4] || "").trim().toUpperCase() === codigoBuscado) {
      producto = {
        codigo: fila[4],
        nombre: fila[0],
        udm: fila[1],
        ubicacion: fila[9],
        existencia: Number(fila[10]) || 0
      };
      break;
    }
  }

  if (!producto) {
    throw new Error("No se encontró el producto en MATRIZ.");
  }

  if (tipoMovimiento === "SALIDA" && cantidad > producto.existencia) {
    throw new Error(
      "Existencia insuficiente. Disponible: " + producto.existencia
    );
  }

  const ahora = new Date();

  const meses = [
    "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
    "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"
  ];

  const detalle = tipoMovimiento === "ENTRADA"
    ? String(datosFormulario.lote || "")
    : String(datosFormulario.area || "");

  hojaMovimiento.appendRow([
    ahora.getFullYear(),
    meses[ahora.getMonth()],
    ahora,
    producto.codigo,
    producto.nombre,
    cantidad,
    producto.udm,
    detalle,
    "",
    "",
    producto.ubicacion
  ]);

  const existenciaNueva = tipoMovimiento === "ENTRADA"
    ? producto.existencia + cantidad
    : producto.existencia - cantidad;

  kardex.appendRow([
    ahora,
    Utilities.formatDate(
      ahora,
      Session.getScriptTimeZone(),
      "HH:mm:ss"
    ),
    tipoMovimiento,
    "",
    producto.codigo,
    producto.nombre,
    tipoMovimiento === "ENTRADA" ? cantidad : "",
    tipoMovimiento === "SALIDA" ? cantidad : "",
    producto.existencia,
    existenciaNueva,
    obtenerNombreUsuario(),
    String(datosFormulario.observacion || "")
  ]);

  return {
    mensaje: tipoMovimiento + " registrada correctamente.",
    producto: producto.nombre,
    existenciaNueva: existenciaNueva
  };
}