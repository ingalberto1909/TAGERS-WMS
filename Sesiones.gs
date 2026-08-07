function myFunction() {
  
}
// ============================================
// SESIONES.GS — Sesión persistente TAGERS WMS
// ============================================

const SESION_DURACION_HORAS = 8; // dura la sesión mientras no cierre sesión o pasen 8h

function generarToken_() {
  return Utilities.getUuid();
}

function crearSesion_(correo, nombre, rol) {
  const token = generarToken_();
  const props = PropertiesService.getScriptProperties();

  const sesion = {
    correo: correo,
    nombre: nombre,
    rol: rol,
    creada: new Date().getTime()
  };

  props.setProperty("SESION_" + token, JSON.stringify(sesion));
  return token;
}

function obtenerSesion_(token) {
  if (!token) return null;

  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty("SESION_" + token);
  if (!raw) return null;

  const sesion = JSON.parse(raw);
  const horas = (new Date().getTime() - sesion.creada) / (1000 * 60 * 60);

  if (horas > SESION_DURACION_HORAS) {
    props.deleteProperty("SESION_" + token);
    return null;
  }

  return sesion;
}

// Llamado desde index.html al cargar, para confirmar que la sesión sigue viva
function validarSesionApp(token) {
  const sesion = obtenerSesion_(token);
  if (!sesion) return { ok: false };
  return { ok: true, nombre: sesion.nombre, rol: sesion.rol, correo: sesion.correo };
}

function cerrarSesionApp(token) {
  if (token) {
    PropertiesService.getScriptProperties().deleteProperty("SESION_" + token);
  }
  return { ok: true };
}

// Helpers para usar en CUALQUIER función que escriba en hojas (auditoría real)
function obtenerNombreDesdeToken(token) {
  const sesion = obtenerSesion_(token);
  return sesion ? sesion.nombre : "Desconocido";
}

function obtenerRolDesdeToken(token) {
  const sesion = obtenerSesion_(token);
  return sesion ? sesion.rol : null;
}