function myFunction() {
  
}

/**
 * SHA-256 en hexadecimal (64 caracteres). Se usa para no volver a
 * guardar contraseñas en texto plano en USUARIOS. No requiere ninguna
 * librería externa: Utilities.computeDigest ya viene con Apps Script.
 */
function calcularHashPassword_(password){
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(password),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function(b){
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? "0" + v : v;
  }).join("");
}

/**
 * Login. ANTES comparaba la contraseña en texto plano contra la
 * columna C de USUARIOS. AHORA compara contra un hash SHA-256.
 *
 * Para no romper el acceso de los usuarios que ya tienen su
 * contraseña en texto plano guardada en la hoja (como hasta ahora),
 * la validación acepta las DOS formas:
 *   - si la celda ya es un hash (64 caracteres hex) -> compara hash
 *     contra hash, como quedará todo a partir de ahora.
 *   - si la celda todavía es texto plano -> compara tal cual iguales
 *     que antes y, si el login es correcto, migra esa celda a su
 *     hash en ese momento (una sola vez por usuario, automático).
 * Ningún usuario necesita volver a capturar su contraseña ni el
 * administrador tiene que hacer nada manual en la hoja.
 */
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

    if (correoBD.toLowerCase().trim() !== String(correo).toLowerCase().trim()) continue;
    if (estado.toUpperCase().trim() !== "ACTIVO") continue;

    const passwordIngresado = String(password).trim();
    const esHashAlmacenado = /^[a-f0-9]{64}$/i.test(passBD);
    const hashIngresado = calcularHashPassword_(passwordIngresado);

    const coincide = esHashAlmacenado
      ? passBD === hashIngresado
      : passBD === passwordIngresado;

    if (!coincide) continue;

    if (!esHashAlmacenado) {
      // Migración silenciosa: la próxima vez esta celda ya solo tendrá el hash.
      hoja.getRange(i + 1, 3).setValue(hashIngresado);
    }

    const token = crearSesion_(correoBD, nombre, rol);

    return {
      ok: true,
      token: token,
      nombre: nombre,
      rol: rol
    };

  }

  return { ok: false };
}