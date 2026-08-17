'use strict';

/*
 * onEdit(e) — trigger simple de Código.gs que se dispara al editar
 * directo las hojas ENTRADA/SALIDA en Sheets (fuera de la app). La
 * columna 6 (Cantidad) escribía un Kardex "de adorno": leía la
 * Existencia ACTUAL de MATRIZ (sin haberla movido) y la usaba como si
 * fuera la "existencia nueva" del movimiento — MATRIZ nunca se
 * actualizaba de verdad (hallazgo de la auditoría de arquitectura
 * multi-sucursal). Ahora pasa por la misma función central que usa el
 * resto del sistema. Estas pruebas construyen el evento `e` tal como
 * lo manda Sheets, contra el código real.
 */

const { prueba } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase } = require('../lib/datos-prueba');

// La hoja emulada no trae getName() (no lo necesitaba nadie más) — se
// envuelve para simular exactamente lo que Sheets le pasa a onEdit vía
// e.range.getSheet().getName().
function hojaConNombre(entorno, nombreHoja) {
  return Object.assign({}, entorno.hojas[nombreHoja], { getName: () => nombreHoja });
}

function eventoEdicionCantidad(entorno, nombreHoja, fila, valor, oldValue) {
  return {
    range: {
      getSheet: () => hojaConNombre(entorno, nombreHoja),
      getRow: () => fila,
      getColumn: () => 6,
    },
    value: String(valor),
    oldValue: oldValue,
  };
}

function prepararFilaEntradaOSalida(entorno, nombreHoja, fila, codigo, producto) {
  const hoja = entorno.hojas[nombreHoja];
  const filas = hoja._filas();
  while (filas.length <= fila - 1) filas.push(new Array(11).fill(''));
  filas[fila - 1][3] = codigo;   // D Código
  filas[fila - 1][4] = producto; // E Producto
}

prueba({
  id: 'LEG-005', grupo: 'legado', nombre: 'onEdit: escribir Cantidad en ENTRADA sí mueve MATRIZ', metodo: 'EMPÍRICO',
  objetivo: 'Editar directo la columna Cantidad de la hoja ENTRADA debe sumar a la Existencia real de MATRIZ, no solo escribir un Kardex calculado a mano',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    prepararFilaEntradaOSalida(entorno, 'ENTRADA', 4, 'COD-001', 'HARINA DE TRIGO');

    const e = eventoEdicionCantidad(entorno, 'ENTRADA', 4, 25, '');
    entorno.invocar('onEdit', e);

    const existenciaMatriz = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];
    const kardex = entorno.leerHoja('KARDEX')[1];

    return {
      datos: 'existencia inicial=100, se escribe Cantidad=25 directo en ENTRADA fila 4',
      esperado: 'MATRIZ=125, Kardex.ExistenciaAnterior=100/Nueva=125 (coincide con el movimiento real, no un número leído sin mover nada)',
      obtenido: `MATRIZ=${existenciaMatriz}, kardex=${kardex ? `${kardex[8]}→${kardex[9]}` : 'NINGUNO'}`,
      pasa: existenciaMatriz === 125 && kardex && kardex[8] === 100 && kardex[9] === 125,
    };
  },
});

prueba({
  id: 'LEG-006', grupo: 'legado', nombre: 'onEdit: escribir Cantidad en SALIDA sí descuenta MATRIZ', metodo: 'EMPÍRICO',
  objetivo: 'Editar directo la columna Cantidad de la hoja SALIDA debe restar de la Existencia real de MATRIZ',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    prepararFilaEntradaOSalida(entorno, 'SALIDA', 4, 'COD-001', 'HARINA DE TRIGO');

    const e = eventoEdicionCantidad(entorno, 'SALIDA', 4, 40, '');
    entorno.invocar('onEdit', e);

    const existenciaMatriz = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];
    const kardex = entorno.leerHoja('KARDEX')[1];

    return {
      datos: 'existencia inicial=100, se escribe Cantidad=40 directo en SALIDA fila 4',
      esperado: 'MATRIZ=60, Kardex.ExistenciaAnterior=100/Nueva=60',
      obtenido: `MATRIZ=${existenciaMatriz}, kardex=${kardex ? `${kardex[8]}→${kardex[9]}` : 'NINGUNO'}`,
      pasa: existenciaMatriz === 60 && kardex && kardex[8] === 100 && kardex[9] === 60,
    };
  },
});

prueba({
  id: 'LEG-007', grupo: 'legado', nombre: 'onEdit: SALIDA sin existencia suficiente se bloquea y avisa por toast', metodo: 'EMPÍRICO',
  objetivo: 'No debe mover MATRIZ ni escribir Kardex si la cantidad excede la existencia disponible; debe avisar con SpreadsheetApp.toast (no un getUi().alert que pueda tronar)',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    prepararFilaEntradaOSalida(entorno, 'SALIDA', 4, 'COD-002', 'AZUCAR ESTANDAR'); // existencia=5

    const e = eventoEdicionCantidad(entorno, 'SALIDA', 4, 999, '');
    entorno.invocar('onEdit', e);

    const existenciaMatriz = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-002')[10];
    const filasKardex = entorno.leerHoja('KARDEX').length - 1;

    return {
      datos: 'COD-002 existencia=5, se escribe Cantidad=999 en SALIDA',
      esperado: 'MATRIZ sin cambio (=5), sin fila nueva en Kardex, se avisó por toast',
      obtenido: `MATRIZ=${existenciaMatriz}, filasKardex=${filasKardex}, toasts=${JSON.stringify(entorno.toasts)}`,
      pasa: existenciaMatriz === 5 && filasKardex === 0 && entorno.toasts.length === 1 && /insuficiente/i.test(entorno.toasts[0].mensaje),
    };
  },
});

prueba({
  id: 'LEG-008', grupo: 'legado', nombre: 'onEdit: código inexistente no rompe y avisa por toast', metodo: 'EMPÍRICO',
  objetivo: 'Un código que no existe en MATRIZ no debe tronar el trigger ni escribir un Kardex fantasma',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    prepararFilaEntradaOSalida(entorno, 'ENTRADA', 4, 'COD-NO-EXISTE', 'PRODUCTO FANTASMA');

    let error = null;
    const e = eventoEdicionCantidad(entorno, 'ENTRADA', 4, 10, '');
    try { entorno.invocar('onEdit', e); } catch (err) { error = err.message; }

    const filasKardex = entorno.leerHoja('KARDEX').length - 1;

    return {
      datos: 'código sin fila en MATRIZ, se escribe Cantidad=10 en ENTRADA',
      esperado: 'no truena, sin fila en Kardex, avisa por toast',
      obtenido: `error=${error}, filasKardex=${filasKardex}, toasts=${JSON.stringify(entorno.toasts)}`,
      pasa: error === null && filasKardex === 0 && entorno.toasts.length === 1 && /no encontrado/i.test(entorno.toasts[0].mensaje),
    };
  },
});

prueba({
  id: 'LEG-009', grupo: 'legado', nombre: 'onEdit: editar una cantidad YA existente no dispara un segundo movimiento', metodo: 'EMPÍRICO',
  objetivo: 'El guard de e.oldValue (comportamiento preexistente, no tocado) debe seguir ignorando ediciones sobre una celda que ya tenía valor — solo la PRIMERA captura cuenta como movimiento',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    prepararFilaEntradaOSalida(entorno, 'ENTRADA', 4, 'COD-001', 'HARINA DE TRIGO');

    entorno.invocar('onEdit', eventoEdicionCantidad(entorno, 'ENTRADA', 4, 20, ''));       // captura real
    entorno.invocar('onEdit', eventoEdicionCantidad(entorno, 'ENTRADA', 4, 30, '20'));     // corrección manual — oldValue NO vacío

    const existenciaMatriz = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];
    const filasKardex = entorno.leerHoja('KARDEX').length - 1;

    return {
      datos: 'primera captura=20 (con oldValue=""), luego se corrige a mano a 30 (oldValue="20")',
      esperado: 'solo la primera cuenta: MATRIZ=120, 1 sola fila en Kardex',
      obtenido: `MATRIZ=${existenciaMatriz}, filasKardex=${filasKardex}`,
      pasa: existenciaMatriz === 120 && filasKardex === 1,
    };
  },
});
