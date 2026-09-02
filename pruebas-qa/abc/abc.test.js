'use strict';

/*
 * TAGERS WMS 2.0 — ClasificacionABC.gs: clasificación ABC de inventario
 * (Pareto 80/15/5) por valor de consumo real (salidas de KARDEX × costo
 * unitario vigente en MATRIZ). Reutiliza calcularConsumoPorCodigo_
 * (Inteligencia.gs) — estas pruebas verifican el corte A/B/C, el caso
 * sin ningún consumo, la ventana configurable, y el control de acceso.
 */

const { prueba } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase, filaProducto } = require('../lib/datos-prueba');

function entornoConLogin(rolCorreo) {
  const entorno = crearEntorno({ hojas: hojasBase() });
  const token = entorno.invocar('crearSesion_', rolCorreo.correo, rolCorreo.nombre, rolCorreo.rol);
  return { entorno, token };
}

function admin() {
  return entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
}

// KARDEX: Fecha|Hora|Tipo|Folio|Código|Producto|Entrada|Salida|ExistenciaAnterior|ExistenciaNueva|Usuario|Observación
function agregarSalidaKardex_(entorno, { codigo, cantidad, fecha }) {
  entorno.leerHoja('KARDEX').push([fecha, '10:00:00', 'SALIDA', 'SAL-X', codigo, 'PRODUCTO', 0, cantidad, 100, 100 - cantidad, 'Tester', '']);
}

// Catálogo con 5 productos de costo distinto, pensado para un corte 80/95 limpio.
function entornoParaCorte_() {
  const entorno = crearEntorno({
    hojas: hojasBase({
      MATRIZ: [
        hojasBase().MATRIZ[0],
        filaProducto({ producto: 'PROD A (alto valor)', codigo: 'COD-001', existencia: 200, costo: 10 }),
        filaProducto({ producto: 'PROD B', codigo: 'COD-002', existencia: 200, costo: 5 }),
        filaProducto({ producto: 'PROD C', codigo: 'COD-003', existencia: 200, costo: 2 }),
        filaProducto({ producto: 'PROD D (bajo valor)', codigo: 'COD-004', existencia: 200, costo: 1 }),
        filaProducto({ producto: 'PROD E (sin movimiento)', codigo: 'COD-005', existencia: 50, costo: 10 }),
      ],
    }),
  });
  const token = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
  // 100 unidades de salida cada uno → valorConsumo: A=1000, B=500, C=200, D=100, E=0. Total=1800.
  // Acumulado: A=55.56% (A) | +B=83.33% (B) | +C=94.44% (B) | +D=100% (C) | +E=100% (C, sinMovimiento)
  ['COD-001', 'COD-002', 'COD-003', 'COD-004'].forEach(codigo => {
    agregarSalidaKardex_(entorno, { codigo, cantidad: 100, fecha: entorno.crearFechaDesdeHoy(-1) });
  });
  return { entorno, token };
}

prueba({
  id: 'ABC-201', grupo: 'abc', nombre: 'Clasifica A/B/C por corte de valor de consumo acumulado (Pareto 80/95)', metodo: 'EMPÍRICO',
  objetivo: 'obtenerClasificacionABCApp debe ordenar por valorConsumo desc y asignar A hasta 80% acumulado, B hasta 95%, C el resto — sin reinventar el cruce de consumo',
  ejecutar() {
    const { entorno, token } = entornoParaCorte_();
    const r = entorno.invocar('obtenerClasificacionABCApp', token, {});
    const porCodigo = {};
    r.productos.forEach(p => { porCodigo[p.codigo] = p; });
    return {
      datos: 'COD-001..004 con 100 unidades de salida c/u y costo 10/5/2/1 (valor 1000/500/200/100); COD-005 sin salidas',
      esperado: 'COD-001=A, COD-002=B, COD-003=B, COD-004=C, COD-005=C; resumen A: 1 prod/$1000, B: 2 prod/$700, C: 2 prod/$100',
      obtenido: `COD-001=${porCodigo['COD-001'].categoria}, COD-002=${porCodigo['COD-002'].categoria}, COD-003=${porCodigo['COD-003'].categoria}, COD-004=${porCodigo['COD-004'].categoria}, COD-005=${porCodigo['COD-005'].categoria}; resumen=${JSON.stringify(r.resumen)}`,
      pasa: porCodigo['COD-001'].categoria === 'A'
        && porCodigo['COD-002'].categoria === 'B'
        && porCodigo['COD-003'].categoria === 'B'
        && porCodigo['COD-004'].categoria === 'C'
        && porCodigo['COD-005'].categoria === 'C'
        && r.resumen.A.conteo === 1 && r.resumen.A.valor === 1000
        && r.resumen.B.conteo === 2 && r.resumen.B.valor === 700
        && r.resumen.C.conteo === 2 && r.resumen.C.valor === 100
        && r.totalValorConsumo === 1800 && r.totalProductos === 5,
    };
  },
});

prueba({
  id: 'ABC-202', grupo: 'abc', nombre: 'Producto sin ninguna salida en la ventana se marca sinMovimiento y cae en C', metodo: 'EMPÍRICO',
  objetivo: 'Un producto con cantidadSalida=0 no debe inventar un valor de consumo — debe quedar con valorConsumo=0, sinMovimiento=true, y categoria=C (nunca A/B)',
  ejecutar() {
    const { entorno, token } = entornoParaCorte_();
    const r = entorno.invocar('obtenerClasificacionABCApp', token, {});
    const e = r.productos.find(p => p.codigo === 'COD-005');
    return {
      datos: 'COD-005 (costo=10, existencia=50) sin ninguna fila de SALIDA en KARDEX',
      esperado: 'cantidadSalida=0, valorConsumo=0, sinMovimiento=true, categoria=C',
      obtenido: `cantidadSalida=${e.cantidadSalida}, valorConsumo=${e.valorConsumo}, sinMovimiento=${e.sinMovimiento}, categoria=${e.categoria}`,
      pasa: e.cantidadSalida === 0 && e.valorConsumo === 0 && e.sinMovimiento === true && e.categoria === 'C',
    };
  },
});

prueba({
  id: 'ABC-203', grupo: 'abc', nombre: 'diasHistorial es un parámetro real: una salida fuera de la ventana no se cuenta', metodo: 'EMPÍRICO',
  objetivo: 'Con diasHistorial=30 una salida de hace 90 días no debe sumarse al valorConsumo, pero sí con diasHistorial=120 — confirma que la ventana no está hardcodeada',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const token = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    agregarSalidaKardex_(entorno, { codigo: 'COD-001', cantidad: 20, fecha: entorno.crearFechaDesdeHoy(-90) });
    const r30 = entorno.invocar('obtenerClasificacionABCApp', token, { diasHistorial: 30 });
    const r120 = entorno.invocar('obtenerClasificacionABCApp', token, { diasHistorial: 120 });
    const p30 = r30.productos.find(p => p.codigo === 'COD-001');
    const p120 = r120.productos.find(p => p.codigo === 'COD-001');
    return {
      datos: 'Única SALIDA de COD-001 (costo=10) fue hace 90 días',
      esperado: 'con ventana=30 días: sinMovimiento (valorConsumo=0); con ventana=120 días: valorConsumo=200',
      obtenido: `ventana30.valorConsumo=${p30.valorConsumo}, sinMovimiento=${p30.sinMovimiento}; ventana120.valorConsumo=${p120.valorConsumo}`,
      pasa: p30.valorConsumo === 0 && p30.sinMovimiento === true && p120.valorConsumo === 200 && p120.sinMovimiento === false,
    };
  },
});

prueba({
  id: 'ABC-204', grupo: 'abc', nombre: 'Sin ninguna salida en todo el catálogo, nadie es A ni B (no se inventa un corte con denominador 0)', metodo: 'EMPÍRICO',
  objetivo: 'Cuando totalValorConsumo es 0 (KARDEX vacío), todos los productos deben quedar en categoria=C sin dividir entre 0 ni tronar',
  ejecutar() {
    const { entorno, token } = admin(); // catálogo base, KARDEX vacío
    let error = null;
    let r = null;
    try { r = entorno.invocar('obtenerClasificacionABCApp', token, {}); } catch (e) { error = e; }
    const todasC = r && r.productos.every(p => p.categoria === 'C');
    return {
      datos: 'Catálogo base (5 productos), KARDEX vacío — nadie tuvo salida jamás',
      esperado: 'no truena; totalValorConsumo=0; todos los productos categoria=C',
      obtenido: error ? `error: ${error.message}` : `totalValorConsumo=${r.totalValorConsumo}, todasC=${todasC}`,
      pasa: !error && r.totalValorConsumo === 0 && todasC === true,
    };
  },
});

prueba({
  id: 'ABC-205', grupo: 'abc', nombre: 'Exige sesión activa', metodo: 'EMPÍRICO',
  objetivo: 'obtenerClasificacionABCApp debe rechazar un token inválido/vacío antes de leer ninguna hoja',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    let error = null;
    try { entorno.invocar('obtenerClasificacionABCApp', 'token-invalido', {}); } catch (e) { error = e; }
    return {
      datos: 'Token inexistente',
      esperado: 'lanza error de sesión inválida',
      obtenido: error ? error.message : 'no lanzó error',
      pasa: !!error,
    };
  },
});

prueba({
  id: 'ABC-206', grupo: 'abc', nombre: 'CONSULTA (sin área Almacén) no puede ver la clasificación ABC', metodo: 'EMPÍRICO',
  objetivo: 'requerirAccesoClasificacionABC_ debe bloquear a un usuario que no es Admin ni del área Almacén — mismo criterio que KPIs operativos/análisis de compras',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'consulta@tagers.com', nombre: 'Consulta', rol: 'CONSULTA' });
    let error = null;
    try { entorno.invocar('obtenerClasificacionABCApp', token, {}); } catch (e) { error = e; }
    return {
      datos: 'Usuario CONSULTA, sin área Almacén',
      esperado: 'lanza error "Solo Almacén puede ver la clasificación ABC."',
      obtenido: error ? error.message : 'no lanzó error',
      pasa: !!error && /Solo Almacén/.test(error.message),
    };
  },
});

prueba({
  id: 'ABC-207', grupo: 'abc', nombre: 'ADMIN sí puede ver la clasificación ABC', metodo: 'EMPÍRICO',
  objetivo: 'requerirAccesoClasificacionABC_ debe permitir el acceso a un usuario con rol ADMIN',
  ejecutar() {
    const { entorno, token } = admin();
    let error = null;
    let r = null;
    try { r = entorno.invocar('obtenerClasificacionABCApp', token, {}); } catch (e) { error = e; }
    return {
      datos: 'Usuario ADMIN Prueba',
      esperado: 'no lanza error, regresa la clasificación de los 5 productos del catálogo base',
      obtenido: error ? `error: ${error.message}` : `totalProductos=${r.totalProductos}`,
      pasa: !error && r.totalProductos === 5,
    };
  },
});
