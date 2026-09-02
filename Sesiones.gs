function myFunction() {
  
}
// ============================================
// SESIONES.GS — Sesión persistente TAGERS WMS
// ============================================

const SESION_DURACION_HORAS = 8; // dura la sesión mientras no cierre sesión o pasen 8h

function generarToken_() {
  return Utilities.getUuid();
}

function normalizarCorreoSesion_(correo) {
  return String(correo || "").trim().toLowerCase();
}

// SEG-02 (auditoría comparativa vs. MarketMan, Fase 4): sesión única por
// usuario. Se mantiene un índice correo→token ("SESION_ACTIVA_<correo>")
// para no tener que recorrer TODAS las propiedades del script en cada
// login — O(1) en vez de O(n). Al crear una sesión nueva para un correo
// que ya tenía una activa, esa sesión anterior se invalida de inmediato
// (login desde otro dispositivo cierra la sesión previa), igual que hacen
// la mayoría de sistemas que restringen a una sola sesión concurrente.
function crearSesion_(correo, nombre, rol) {
  const token = generarToken_();
  const props = PropertiesService.getScriptProperties();

  const claveIndice = "SESION_ACTIVA_" + normalizarCorreoSesion_(correo);
  const tokenAnterior = props.getProperty(claveIndice);
  if (tokenAnterior) {
    props.deleteProperty("SESION_" + tokenAnterior);
  }

  const sesion = {
    correo: correo,
    nombre: nombre,
    rol: rol,
    creada: new Date().getTime()
  };

  props.setProperty("SESION_" + token, JSON.stringify(sesion));
  props.setProperty(claveIndice, token);
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
    // AUD-01: hay que leer la sesión ANTES de borrarla — una vez borrado
    // el token ya no hay forma de saber quién era.
    const sesion = obtenerSesion_(token);
    const props = PropertiesService.getScriptProperties();
    props.deleteProperty("SESION_" + token);
    if (sesion) {
      // SEG-02: se limpia el índice correo→token, pero SOLO si sigue
      // apuntando a este mismo token — si el usuario ya inició sesión de
      // nuevo en otro lado antes de este logout, el índice ya apunta a esa
      // sesión más nueva y no debe borrarse por accidente.
      const claveIndice = "SESION_ACTIVA_" + normalizarCorreoSesion_(sesion.correo);
      if (props.getProperty(claveIndice) === token) {
        props.deleteProperty(claveIndice);
      }
      registrarAuditoria(sesion.nombre, "SEGURIDAD", "LOGOUT", "", "", "", 0, 0, sesion.correo);
    }
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