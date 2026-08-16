'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  crearHojaEmulada,
  crearLockServiceEmulado,
  crearCacheServiceEmulado,
  crearPropertiesServiceEmulado,
  crearUtilitiesEmulado,
  crearSessionEmulado,
  crearProxyInerte,
} = require('./emulador-gas');

const RAIZ_PROYECTO = path.join(__dirname, '..', '..');

// Orden de carga: no afecta la resolución de llamadas cruzadas (todas las
// funciones ya están definidas para cuando una prueba INVOCA algo — el
// orden solo importa si un archivo ejecutara código de nivel superior que
// dependiera de otro archivo, y ninguno de estos lo hace), pero se
// mantiene en un orden lógico por claridad.
const ARCHIVOS_BACKEND = [
  'Sesiones.gs',
  'Usuarios.gs',
  'Código.gs',
  '📁 App.gs.gs',
  'Recetas.gs',
  'RequisicionesRecetas.gs',
  'RequisicionesSucursal.gs',
  'Produccion.gs',
  'ProgramacionConteos.gs',
  'AnalisisCompras.gs',
  'MovimientosDashboard.gs',
];

/**
 * Crea un entorno TAGERS WMS aislado: carga el código REAL de los
 * archivos .gs de producción (solo LECTURA — nunca se escribe sobre
 * ellos) dentro de un contexto de vm con las APIs de Google emuladas en
 * memoria. Cada llamada a crearEntorno() da un entorno 100% nuevo e
 * independiente — nada se comparte entre pruebas ni se persiste en disco.
 *
 * @param {Object} opciones
 * @param {Object} opciones.hojas - { NOMBRE_HOJA: [[fila0...], [fila1...]] } (fila 0 = encabezado)
 * @param {string} [opciones.correoActivo] - Session.getActiveUser().getEmail() emulado
 */
function crearEntorno(opciones) {
  opciones = opciones || {};
  const registroHojas = {};
  Object.keys(opciones.hojas || {}).forEach(nombre => {
    registroHojas[nombre] = crearHojaEmulada(nombre, opciones.hojas[nombre]);
  });

  const lockService = crearLockServiceEmulado();
  const cacheService = crearCacheServiceEmulado();
  const propertiesService = crearPropertiesServiceEmulado();
  const utilities = crearUtilitiesEmulado();
  const session = crearSessionEmulado(opciones.correoActivo);

  const spreadsheetActivo = {
    getSheetByName(nombre) {
      return registroHojas[nombre] || null;
    },
    insertSheet(nombre) {
      const nueva = crearHojaEmulada(nombre, []);
      registroHojas[nombre] = nueva;
      return nueva;
    },
  };

  const SpreadsheetApp = {
    getActive() { return spreadsheetActivo; },
    getActiveSpreadsheet() { return spreadsheetActivo; },
    flush() {},
  };

  const LockService = {
    getScriptLock() {
      // Réplica síncrona de la API real: en el código de producción,
      // conBloqueoApp_ llama waitLock()/releaseLock() de forma síncrona
      // (Apps Script no tiene async/await). Aquí igual: el "lock" solo
      // sirve como marcador de la sección crítica para las pruebas de
      // integridad no concurrentes (la mayoría). Las pruebas de
      // concurrencia real usan un mecanismo aparte (ver lib/concurrencia.js)
      // porque JS de un solo hilo no puede interrumpir código síncrono a
      // la mitad sin ayuda externa.
      return { waitLock() {}, releaseLock() {} };
    },
  };

  const contexto = vm.createContext({
    console,
    SpreadsheetApp,
    LockService,
    CacheService: cacheService,
    PropertiesService: propertiesService,
    Utilities: utilities,
    Session: session,
    // Servicios de Google que TAGERS WMS solo usa para generar/guardar
    // PDFs — inertes aquí (ver crearProxyInerte), nunca se prueba su
    // contenido en esta carpeta.
    DriveApp: crearProxyInerte('DriveApp'),
    DocumentApp: crearProxyInerte('DocumentApp'),
    HtmlService: crearProxyInerte('HtmlService'),
    MailApp: crearProxyInerte('MailApp'),
    GmailApp: crearProxyInerte('GmailApp'),
    ScriptApp: crearProxyInerte('ScriptApp'),
    UrlFetchApp: crearProxyInerte('UrlFetchApp'),
    Logger: { log() {} },
  });

  ARCHIVOS_BACKEND.forEach(nombreArchivo => {
    const rutaCompleta = path.join(RAIZ_PROYECTO, nombreArchivo);
    if (!fs.existsSync(rutaCompleta)) {
      throw new Error('No se encontró el archivo de backend real: ' + rutaCompleta);
    }
    const codigoFuente = fs.readFileSync(rutaCompleta, 'utf8');
    vm.runInContext(codigoFuente, contexto, { filename: nombreArchivo });
  });

  return {
    contexto,
    hojas: registroHojas,
    cache: cacheService,
    propiedades: propertiesService,
    session,
    lockService,
    /** Invoca una función real cargada, por nombre. */
    invocar(nombreFuncion, ...args) {
      const fn = contexto[nombreFuncion];
      if (typeof fn !== 'function') {
        throw new Error('La función "' + nombreFuncion + '" no existe en el backend cargado (revisa el nombre o si el archivo que la define está en ARCHIVOS_BACKEND).');
      }
      return fn.apply(null, args);
    },
    /** Lee el estado actual (post-prueba) de una hoja como arreglo 2D. */
    leerHoja(nombre) {
      const hoja = registroHojas[nombre];
      return hoja ? hoja._filas() : null;
    },
  };
}

module.exports = { crearEntorno, ARCHIVOS_BACKEND, RAIZ_PROYECTO };
