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

// AUD-01 (auditoría comparativa vs. MarketMan): antes, login/logout no
// dejaban NINGÚN rastro (ni éxito ni fallo) y no había límite de
// intentos — relevante porque el despliegue es access:ANYONE (cualquiera
// con la URL llega a la pantalla de login). El contador vive en
// PropertiesService, mismo mecanismo ya usado para sesiones — nunca se
// distingue en el mensaje ni en el conteo entre "correo no existe",
// "cuenta inactiva" o "contraseña incorrecta": tratarlos igual es lo que
// ya hacía el código (siempre regresaba el mismo {ok:false}) y evita que
// alguien use el contador para averiguar qué correos sí existen.
const UMBRAL_INTENTOS_LOGIN_ = 5;
const VENTANA_BLOQUEO_LOGIN_MINUTOS_ = 15;

function obtenerClaveIntentosLogin_(correo){
  return "LOGIN_INTENTOS_" + String(correo || "").toLowerCase().trim();
}

function obtenerEstadoIntentosLogin_(correo){
  const raw = PropertiesService.getScriptProperties().getProperty(obtenerClaveIntentosLogin_(correo));
  if(!raw) return { intentos: 0, bloqueadoHasta: 0 };
  try { return JSON.parse(raw); } catch(e){ return { intentos: 0, bloqueadoHasta: 0 }; }
}

function guardarEstadoIntentosLogin_(correo, estado){
  PropertiesService.getScriptProperties().setProperty(obtenerClaveIntentosLogin_(correo), JSON.stringify(estado));
}

function limpiarIntentosLogin_(correo){
  PropertiesService.getScriptProperties().deleteProperty(obtenerClaveIntentosLogin_(correo));
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

  const correoNormalizado = String(correo || "").toLowerCase().trim();
  const ahora = new Date().getTime();

  const estadoIntentos = obtenerEstadoIntentosLogin_(correoNormalizado);
  if(estadoIntentos.bloqueadoHasta && estadoIntentos.bloqueadoHasta > ahora){
    const minutosRestantes = Math.ceil((estadoIntentos.bloqueadoHasta - ahora) / 60000);
    registrarAuditoria(correo, "SEGURIDAD", "LOGIN BLOQUEADO", "", "", "", 0, 0,
      "Demasiados intentos fallidos — bloqueado " + minutosRestantes + " minuto(s) más");
    return { ok: false, bloqueado: true, mensaje: "Demasiados intentos fallidos. Intenta de nuevo en " + minutosRestantes + " minuto(s)." };
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

    limpiarIntentosLogin_(correoNormalizado);

    const token = crearSesion_(correoBD, nombre, rol);

    registrarAuditoria(nombre, "SEGURIDAD", "LOGIN EXITOSO", "", "", "", 0, 0, correoBD);

    return {
      ok: true,
      token: token,
      nombre: nombre,
      rol: rol
    };

  }

  const intentosNuevos = (estadoIntentos.intentos || 0) + 1;
  const nuevoEstado = { intentos: intentosNuevos, bloqueadoHasta: 0 };
  if(intentosNuevos >= UMBRAL_INTENTOS_LOGIN_){
    nuevoEstado.bloqueadoHasta = ahora + VENTANA_BLOQUEO_LOGIN_MINUTOS_ * 60000;
    nuevoEstado.intentos = 0;
  }
  guardarEstadoIntentosLogin_(correoNormalizado, nuevoEstado);

  registrarAuditoria(correo, "SEGURIDAD", "LOGIN FALLIDO", "", "", "", 0, 0,
    "Intento " + intentosNuevos + " de " + UMBRAL_INTENTOS_LOGIN_);

  return { ok: false };
}

// ================================================================
// TAGERS WMS 2.0 — Gestión de usuarios (pedido del usuario).
// Hallazgo de la auditoría integral: no existía NINGUNA función para dar de
// alta, editar rol o dar de baja usuarios — todo se hacía editando USUARIOS
// directo en Sheets, sin ningún registro de auditoría. Este módulo lo cierra.
//
// Acceso: SOLO rol ADMIN, verificado en el backend (requerirAccesoAdminApp_)
// en cada función — nunca basta con ocultar el botón en el sidebar, mismo
// criterio que ya usa todo lo demás del proyecto desde la Fase 6 de
// seguridad. El botón del sidebar tampoco se lista en PERMISOS_ROL de
// SUPERVISOR/OPERADOR/CONSULTA, así que ni siquiera lo ven.
// ================================================================

const ROLES_VALIDOS_ = ["ADMIN", "SUPERVISOR", "OPERADOR", "CONSULTA"];

function requerirAccesoAdminApp_(token){
  requerirSesionActivaApp_(token);
  const rol = String(obtenerRolDesdeToken(token) || "").toUpperCase();
  if(rol !== "ADMIN"){
    throw new Error("Solo un administrador puede acceder a la gestión de usuarios.");
  }
}

function obtenerHojaUsuarios_(){
  const hoja = SpreadsheetApp.getActive().getSheetByName("USUARIOS");
  if(!hoja) throw new Error("No existe la hoja USUARIOS");
  return hoja;
}

function validarFormatoCorreo_(correo){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(correo || "").trim());
}

/** Lista completa de usuarios — NUNCA incluye el hash de la contraseña. */
function obtenerUsuariosApp(token){

  requerirAccesoAdminApp_(token);

  const hoja = obtenerHojaUsuarios_();
  if(hoja.getLastRow() < 2) return [];

  const datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 7).getValues();

  return datos
    .filter(function(f){ return String(f[0] || "").trim(); })
    .map(function(f){
      return {
        correo: f[0], nombre: f[1], rol: f[3],
        estado: f[4], area: f[5], sucursal: f[6]
      };
    });

}

function crearUsuarioApp(datos, token){

  requerirAccesoAdminApp_(token);

  const correo = String((datos && datos.correo) || "").trim().toLowerCase();
  const nombre = String((datos && datos.nombre) || "").trim();
  const password = String((datos && datos.password) || "");
  const rol = String((datos && datos.rol) || "").trim().toUpperCase();
  const area = String((datos && datos.area) || "").trim();
  const sucursal = String((datos && datos.sucursal) || "").trim();

  if(!correo || !validarFormatoCorreo_(correo)) throw new Error("Captura un correo válido.");
  if(!nombre) throw new Error("Captura el nombre del usuario.");
  if(password.length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres.");
  if(ROLES_VALIDOS_.indexOf(rol) === -1) throw new Error("Rol inválido: " + rol);

  const hoja = obtenerHojaUsuarios_();
  const correosActuales = hoja.getLastRow() > 1
    ? hoja.getRange(2, 1, hoja.getLastRow() - 1, 1).getValues().map(function(f){ return String(f[0] || "").trim().toLowerCase(); })
    : [];
  if(correosActuales.indexOf(correo) !== -1) throw new Error("Ya existe un usuario con ese correo.");

  hoja.appendRow([correo, nombre, calcularHashPassword_(password), rol, "ACTIVO", area, sucursal]);

  const usuarioActual = obtenerNombreDesdeToken(token);
  registrarAuditoria(usuarioActual, "USUARIOS", "ALTA DE USUARIO", correo, "", "", 0, 0,
    nombre + " — Rol: " + rol + (area ? ", Área: " + area : "") + (sucursal ? ", Sucursal: " + sucursal : ""));

  return { ok: true };

}

/**
 * Edita nombre/rol/área/sucursal y, opcionalmente, la contraseña (solo si
 * datos.password viene con algo — en blanco significa "no cambiarla").
 * No permite que un ADMIN se quite a sí mismo el rol de Admin (evita que
 * el único administrador activo se bloquee a sí mismo por accidente).
 */
function editarUsuarioApp(correoObjetivo, datos, token){

  requerirAccesoAdminApp_(token);

  const correo = String(correoObjetivo || "").trim().toLowerCase();
  const hoja = obtenerHojaUsuarios_();
  if(hoja.getLastRow() < 2) throw new Error("No se encontró el usuario " + correo);

  const datosActuales = hoja.getRange(2, 1, hoja.getLastRow() - 1, 7).getValues();
  let fila = -1, filaActual = null;
  datosActuales.forEach(function(f, i){
    if(String(f[0] || "").trim().toLowerCase() === correo){ fila = i + 2; filaActual = f; }
  });
  if(fila === -1) throw new Error("No se encontró el usuario " + correo);

  const nombreNuevo = String((datos && datos.nombre) || filaActual[1]).trim();
  const rolNuevo = String((datos && datos.rol) || filaActual[3]).trim().toUpperCase();
  const areaNueva = (datos && datos.area !== undefined) ? String(datos.area).trim() : filaActual[5];
  const sucursalNueva = (datos && datos.sucursal !== undefined) ? String(datos.sucursal).trim() : filaActual[6];

  if(!nombreNuevo) throw new Error("El nombre no puede quedar vacío.");
  if(ROLES_VALIDOS_.indexOf(rolNuevo) === -1) throw new Error("Rol inválido: " + rolNuevo);

  const rolAnterior = String(filaActual[3] || "").toUpperCase();
  const correoTokenActual = String(obtenerCorreoDesdeToken_(token) || "").toLowerCase();
  if(correo === correoTokenActual && rolAnterior === "ADMIN" && rolNuevo !== "ADMIN"){
    throw new Error("No puedes quitarte a ti mismo el rol de Admin — pide a otro administrador que lo haga.");
  }

  hoja.getRange(fila, 2).setValue(nombreNuevo);
  hoja.getRange(fila, 4).setValue(rolNuevo);
  hoja.getRange(fila, 6).setValue(areaNueva);
  hoja.getRange(fila, 7).setValue(sucursalNueva);

  if(datos && datos.password){
    if(String(datos.password).length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres.");
    hoja.getRange(fila, 3).setValue(calcularHashPassword_(datos.password));
  }

  const usuarioActual = obtenerNombreDesdeToken(token);
  registrarAuditoria(usuarioActual, "USUARIOS", "USUARIO EDITADO", correo, "", "", 0, 0,
    rolAnterior !== rolNuevo ? ("Rol cambiado de " + rolAnterior + " a " + rolNuevo) : "Datos actualizados");

  return { ok: true };

}

/**
 * "Dar de baja" = desactivar (Estado=INACTIVO), nunca borrar la fila — así
 * se conserva su historial en KARDEX/AUDITORIA/REQUISICIONES sin romper
 * ninguna referencia existente. También sirve para reactivar.
 * No permite que un usuario se desactive a sí mismo.
 */
function cambiarEstadoUsuarioApp(correoObjetivo, nuevoEstado, token){

  requerirAccesoAdminApp_(token);

  const correo = String(correoObjetivo || "").trim().toLowerCase();
  const estado = String(nuevoEstado || "").trim().toUpperCase();
  if(estado !== "ACTIVO" && estado !== "INACTIVO") throw new Error("Estado inválido.");

  const correoTokenActual = String(obtenerCorreoDesdeToken_(token) || "").toLowerCase();
  if(correo === correoTokenActual && estado === "INACTIVO"){
    throw new Error("No puedes desactivar tu propia cuenta.");
  }

  const hoja = obtenerHojaUsuarios_();
  if(hoja.getLastRow() < 2) throw new Error("No se encontró el usuario " + correo);

  const datosActuales = hoja.getRange(2, 1, hoja.getLastRow() - 1, 5).getValues();
  let fila = -1, estadoAnterior = "";
  datosActuales.forEach(function(f, i){
    if(String(f[0] || "").trim().toLowerCase() === correo){ fila = i + 2; estadoAnterior = f[4]; }
  });
  if(fila === -1) throw new Error("No se encontró el usuario " + correo);

  hoja.getRange(fila, 5).setValue(estado);

  const usuarioActual = obtenerNombreDesdeToken(token);
  registrarAuditoria(usuarioActual, "USUARIOS", estado === "ACTIVO" ? "USUARIO REACTIVADO" : "USUARIO DESACTIVADO",
    correo, "", "", 0, 0, "Estado cambiado de " + estadoAnterior + " a " + estado);

  return { ok: true };

}