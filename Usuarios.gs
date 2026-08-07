function myFunction() {
  
}
function validarUsuario(correo, password) {

  const hoja = SpreadsheetApp.getActive().getSheetByName("USUARIOS");

  if (!hoja) {
    throw new Error("No existe la hoja USUARIOS");
  }

  const datos = hoja.getDataRange().getValues();

  for (let i = 1; i < datos.length; i++) {

    const correoBD = String(datos[i][0]).trim();
    const nombre = datos[i][1];
    const passBD = String(datos[i][2]).trim();
    const rol = datos[i][3];
    const estado = String(datos[i][4]).trim();

    if (
      correoBD.toLowerCase().trim() === String(correo).toLowerCase().trim() &&
      passBD.trim() === String(password).trim() &&
      estado.toUpperCase().trim() === "ACTIVO"
    ) {

      const token = crearSesion_(correoBD, nombre, rol);

      return {
        ok: true,
        token: token,
        nombre: nombre,
        rol: rol
      };

    }

  }

  return { ok: false };
}