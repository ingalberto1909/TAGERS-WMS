'use strict';

/*
 * Emulador mínimo de las APIs de Google Apps Script que usa TAGERS WMS
 * (SpreadsheetApp, LockService, CacheService, Utilities, Session,
 * PropertiesService). NO es un mock de la lógica de negocio — la
 * lógica de negocio sigue siendo el código REAL de los archivos .gs,
 * cargado tal cual por cargarBackend.js. Esto solo reemplaza la capa
 * de Google (a la que no tenemos acceso desde aquí) por una versión en
 * memoria, para poder ejecutar esas mismas funciones en Node.
 *
 * IMPORTANTE: esta carpeta nunca toca una hoja de cálculo real. Todo
 * "MATRIZ"/"KARDEX"/etc. aquí es un arreglo en memoria que se descarta
 * al terminar el proceso de Node.
 */

function crearHojaEmulada(nombre, filasIniciales) {
  // filas[0] = encabezado, igual que una hoja real (fila 1 = encabezado).
  let filas = (filasIniciales || []).map(f => f.slice());

  function normalizarFila(f, ancho) {
    const out = f.slice();
    while (out.length < ancho) out.push('');
    return out;
  }

  return {
    nombre,
    getLastRow() { return filas.length; },
    getLastColumn() {
      return filas.reduce((max, f) => Math.max(max, f.length), 0);
    },
    getRange(fila, col, numFilas, numCols) {
      numFilas = numFilas || 1;
      numCols = numCols || 1;
      return crearRangoEmulado(this, fila, col, numFilas, numCols);
    },
    getDataRange() {
      const ultimaFila = Math.max(filas.length, 1);
      const ultimaCol = Math.max(this.getLastColumn(), 1);
      return crearRangoEmulado(this, 1, 1, ultimaFila, ultimaCol);
    },
    appendRow(arr) {
      filas.push(arr.slice());
    },
    insertRowsAfter(filaDespuesDe, cuantas) {
      const idx = filaDespuesDe; // filaDespuesDe es 1-index; insertamos DESPUÉS de esa fila
      const vacias = [];
      for (let i = 0; i < cuantas; i++) vacias.push([]);
      filas.splice(idx, 0, ...vacias);
    },
    deleteRows(filaInicio, cuantas) {
      filas.splice(filaInicio - 1, cuantas);
    },
    // acceso directo para que las pruebas puedan inspeccionar el estado final
    _filas() { return filas; },
    _setFilas(nuevas) { filas = nuevas.map(f => f.slice()); },
  };

  function crearRangoEmulado(hoja, fila, col, numFilas, numCols) {
    return {
      getValues() {
        const out = [];
        for (let i = 0; i < numFilas; i++) {
          const f = filas[fila - 1 + i];
          out.push(f ? normalizarFila(f, col - 1 + numCols).slice(col - 1, col - 1 + numCols) : new Array(numCols).fill(''));
        }
        return out;
      },
      getValue() {
        const f = filas[fila - 1];
        if (!f) return '';
        return f[col - 1] !== undefined ? f[col - 1] : '';
      },
      setValue(v) {
        if (!filas[fila - 1]) filas[fila - 1] = [];
        filas[fila - 1] = normalizarFila(filas[fila - 1], col);
        filas[fila - 1][col - 1] = v;
        return this;
      },
      setValues(vals) {
        vals.forEach((rowVals, i) => {
          if (!filas[fila - 1 + i]) filas[fila - 1 + i] = [];
          filas[fila - 1 + i] = normalizarFila(filas[fila - 1 + i], col - 1 + rowVals.length);
          rowVals.forEach((v, j) => { filas[fila - 1 + i][col - 1 + j] = v; });
        });
        return this;
      },
      setFontWeight() { return this; },
      setFontColor() { return this; },
      setBackground() { return this; },
    };
  }
}

function crearLockServiceEmulado() {
  // Un solo lock de "script" (mismo criterio que LockService.getScriptLock()
  // real: un lock global por proyecto, no por hoja/producto). Implementado
  // como mutex asíncrono real, para poder forzar intercalados de
  // ejecuciones "concurrentes" en las pruebas de concurrencia.
  let ocupado = false;
  const cola = [];
  return {
    getScriptLock() {
      return {
        waitLock(ms) {
          // Síncrono desde el punto de vista de GAS real, pero aquí lo
          // exponemos como Promise para las pruebas de concurrencia; el
          // código real de TAGERS WMS llama esto de forma síncrona
          // (Apps Script no tiene async/await), así que esta versión
          // también debe poder usarse de forma síncrona: ver
          // adquirirSincrono()/liberar() más abajo, usados por el wrapper
          // conBloqueoApp_ emulado en cargarBackend.js.
        },
        releaseLock() {},
      };
    },
    async adquirirAsync() {
      if (!ocupado) { ocupado = true; return; }
      await new Promise(resolve => cola.push(resolve));
    },
    liberar() {
      if (cola.length) cola.shift()();
      else ocupado = false;
    },
  };
}

function crearCacheServiceEmulado() {
  const almacen = new Map();
  return {
    getScriptCache() {
      return {
        get(clave) {
          const entrada = almacen.get(clave);
          if (!entrada) return null;
          if (Date.now() > entrada.expira) { almacen.delete(clave); return null; }
          return entrada.valor;
        },
        put(clave, valor, ttlSegundos) {
          if (Buffer.byteLength(String(valor), 'utf8') > 100 * 1024) {
            throw new Error('Argument too large: value');
          }
          almacen.set(clave, { valor, expira: Date.now() + (ttlSegundos || 600) * 1000 });
        },
        remove(clave) { almacen.delete(clave); },
      };
    },
    _almacenCrudo: almacen,
  };
}

function crearPropertiesServiceEmulado() {
  const almacen = new Map();
  const servicio = {
    getProperty(k) { return almacen.has(k) ? almacen.get(k) : null; },
    setProperty(k, v) { almacen.set(k, v); },
    deleteProperty(k) { almacen.delete(k); },
  };
  return { getScriptProperties() { return servicio; }, getUserProperties() { return servicio; } };
}

function formatearFechaEmulado(fecha, tz, patron) {
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  const pad = (n, w) => String(n).padStart(w || 2, '0');
  const map = {
    yyyy: d.getFullYear(),
    MM: pad(d.getMonth() + 1),
    MMMM: ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'][d.getMonth()],
    dd: pad(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
  };
  return patron.replace(/yyyy|MMMM|MM|dd|HH|mm|ss/g, (m) => map[m]);
}

function crearUtilitiesEmulado() {
  return {
    formatDate: formatearFechaEmulado,
    formatString(patron, ...args) {
      let i = 0;
      return patron.replace(/%(\d*)d/g, (_, ancho) => {
        const v = String(args[i++]);
        return ancho ? v.padStart(Number(ancho), '0') : v;
      });
    },
    getUuid() {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
    },
    computeDigest(algoritmo, texto) {
      const crypto = require('crypto');
      const hash = crypto.createHash('sha256').update(String(texto), 'utf8').digest();
      // GAS regresa un arreglo de bytes con signo (-128..127); replicamos eso
      // porque Usuarios.gs hace exactamente ese ajuste al convertir a hex.
      return Array.from(hash).map(b => (b > 127 ? b - 256 : b));
    },
    sleep() {},
    Charset: { UTF_8: 'UTF_8' },
    DigestAlgorithm: { SHA_256: 'SHA_256' },
  };
}

function crearSessionEmulado(correoActivoInicial) {
  let correoActivo = correoActivoInicial || '';
  return {
    getScriptTimeZone() { return 'America/Mexico_City'; },
    getActiveUser() { return { getEmail() { return correoActivo; } }; },
    _establecerUsuarioActivo(correo) { correoActivo = correo; },
  };
}

/**
 * Proxy "inerte": absorbe cualquier cadena de llamadas/propiedades sin
 * tronar (DriveApp.getFolderById(x).createFile(blob).getUrl(), etc.).
 * Se usa SOLO para servicios de Google que TAGERS WMS usa exclusivamente
 * para generar/guardar PDFs (DriveApp, DocumentApp, HtmlService, MailApp,
 * GmailApp, ScriptApp, UrlFetchApp) — nada de lo que se prueba en esta
 * carpeta verifica el contenido de un PDF, así que un stub que "no hace
 * nada pero tampoco truena" es suficiente y evita tener que enumerar la
 * API completa de cada servicio.
 */
function crearProxyInerte(nombre) {
  const primitivos = {
    hasNext: () => false,
    getId: () => 'FAKE_ID_' + nombre,
    getUrl: () => 'https://fake.local/' + nombre,
    getName: () => 'prueba-qa.pdf',
    getBytes: () => [],
  };
  let proxy;
  const handler = {
    get(target, prop) {
      if (prop === Symbol.toPrimitive || prop === 'valueOf' || prop === 'toString') return () => '';
      if (typeof prop === 'string' && primitivos[prop]) return primitivos[prop];
      return proxy;
    },
    apply() { return proxy; },
  };
  proxy = new Proxy(function () {}, handler);
  return proxy;
}

module.exports = {
  crearHojaEmulada,
  crearLockServiceEmulado,
  crearCacheServiceEmulado,
  crearPropertiesServiceEmulado,
  crearUtilitiesEmulado,
  crearSessionEmulado,
  crearProxyInerte,
  formatearFechaEmulado,
};
