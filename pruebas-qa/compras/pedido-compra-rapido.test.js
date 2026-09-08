'use strict';

/*
 * PEDIDO DE COMPRA RÁPIDO (PedidoCompraRapido.gs) — cubre la configuración
 * de productos habituales (Fase 2), la carga/sugerido/agrupación/
 * generación masiva de OCs (Fases 3-4) y los 10 casos obligatorios del
 * pedido de Alberto (sección 34): 20 productos/6 proveedores, producto sin
 * proveedor, cantidad 0, cantidad negativa, producto duplicado, pedido ya
 * generado el mismo día, folios que no colisionan, usuario sin permisos,
 * producto extraordinario, y cancelar sin perder trazabilidad.
 */

const { prueba } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase, filaProducto, encabezadoMatriz } = require('../lib/datos-prueba');

function fechaISO(diasDesdeHoy){
  const d = new Date(Date.now() + (diasDesdeHoy || 0) * 86400000);
  return d.toISOString().slice(0, 10);
}

// Marca la columna U de MATRIZ (índice 20, la que sigue a Presentación en
// T=19) — filaProducto no la expone como parámetro, igual que nivel/
// posición en mapa-almacen.test.js, así que se asigna directo sobre la fila.
function marcarCompraSemanalMatriz(fila){
  fila[20] = 'SI';
  return fila;
}

function productoMatriz(codigo, proveedor, opts){
  opts = opts || {};
  return filaProducto({
    producto: opts.producto || ('PRODUCTO ' + codigo),
    codigo: codigo,
    proveedor: proveedor,
    existencia: opts.existencia !== undefined ? opts.existencia : 0,
    minimo: opts.minimo !== undefined ? opts.minimo : 5,
    maximo: opts.maximo !== undefined ? opts.maximo : 25,
    ubicacion: opts.ubicacion,
  });
}

function entornoConCatalogo(filasExtra){
  const matriz = [encabezadoMatriz()].concat(filasExtra);
  const entorno = crearEntorno({ hojas: hojasBase({ MATRIZ: matriz }) });
  const token = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
  return { entorno, token };
}

function registrarHabitual(entorno, token, codigo, overrides){
  return entorno.invocar('guardarProductoHabitualCompraApp', Object.assign({
    codigo: codigo, frecuencia: 'DIARIA', diaCompra: '', modoCantidad: 'MIN_MAX',
    cantidadHabitual: 0, activo: true, prioridad: 0, observaciones: ''
  }, overrides || {}), token);
}

// ============================================
// FASE 2 — Configuración de productos habituales
// ============================================

prueba({
  id: 'PCR-CFG-001', grupo: 'compras', nombre: 'guardarProductoHabitualCompraApp da de alta un producto habitual válido',
  metodo: 'EMPÍRICO',
  objetivo: 'Un código que sí existe en MATRIZ debe poder configurarse como habitual (SEMANAL/LUNES, MIN_MAX) y aparecer en listarProductosHabitualesCompraApp con el nombre/proveedor unidos desde MATRIZ',
  ejecutar() {
    const { entorno, token } = entornoConCatalogo([productoMatriz('COD-H01', 'PROVEEDOR A')]);
    entorno.invocar('guardarProductoHabitualCompraApp', {
      codigo: 'COD-H01', frecuencia: 'SEMANAL', diaCompra: 'LUNES', modoCantidad: 'MIN_MAX', activo: true
    }, token);
    const lista = entorno.invocar('listarProductosHabitualesCompraApp', token);
    const fila = lista.find(p => p.codigo === 'COD-H01');
    return {
      datos: 'COD-H01 configurado SEMANAL/LUNES',
      esperado: '1 fila, producto="PRODUCTO COD-H01", proveedor="PROVEEDOR A", activo=true',
      obtenido: JSON.stringify(fila),
      pasa: !!fila && fila.producto === 'PRODUCTO COD-H01' && fila.proveedor === 'PROVEEDOR A' && fila.activo === true,
    };
  },
});

prueba({
  id: 'PCR-CFG-002', grupo: 'compras', nombre: 'guardarProductoHabitualCompraApp rechaza un código que no existe en MATRIZ',
  metodo: 'EMPÍRICO',
  objetivo: 'No debe poder configurarse como habitual un código inexistente en el catálogo — evita productos habituales "fantasma"',
  ejecutar() {
    const { entorno, token } = entornoConCatalogo([productoMatriz('COD-H01', 'PROVEEDOR A')]);
    let lanzo = false;
    try {
      entorno.invocar('guardarProductoHabitualCompraApp', { codigo: 'NO-EXISTE', frecuencia: 'DIARIA' }, token);
    } catch (e) { lanzo = true; }
    return {
      datos: 'codigo="NO-EXISTE" (no está en MATRIZ)',
      esperado: 'lanza error',
      obtenido: `lanzo=${lanzo}`,
      pasa: lanzo === true,
    };
  },
});

prueba({
  id: 'PCR-CFG-003', grupo: 'compras', nombre: 'guardarProductoHabitualCompraApp es upsert: editar el mismo código no crea una segunda fila',
  metodo: 'EMPÍRICO',
  objetivo: 'Guardar dos veces el mismo código debe actualizar la configuración existente, no duplicarla',
  ejecutar() {
    const { entorno, token } = entornoConCatalogo([productoMatriz('COD-H01', 'PROVEEDOR A')]);
    entorno.invocar('guardarProductoHabitualCompraApp', { codigo: 'COD-H01', frecuencia: 'SEMANAL', diaCompra: 'LUNES' }, token);
    entorno.invocar('guardarProductoHabitualCompraApp', { codigo: 'COD-H01', frecuencia: 'SEMANAL', diaCompra: 'MARTES' }, token);
    const lista = entorno.invocar('listarProductosHabitualesCompraApp', token);
    const filas = lista.filter(p => p.codigo === 'COD-H01');
    return {
      datos: 'guardado 2 veces: primero LUNES, luego MARTES',
      esperado: 'exactamente 1 fila, con diaCompra="MARTES" (la edición más reciente)',
      obtenido: JSON.stringify(filas),
      pasa: filas.length === 1 && filas[0].diaCompra === 'MARTES',
    };
  },
});

prueba({
  id: 'PCR-CFG-004', grupo: 'compras', nombre: 'obtenerProductosHabitualesCompraApp respeta Frecuencia SEMANAL + Día Compra',
  metodo: 'EMPÍRICO',
  objetivo: 'Un producto SEMANAL/LUNES no debe cargarse un día distinto a lunes, y sí un lunes',
  ejecutar() {
    // existencia por encima del mínimo: así el único motivo por el que
    // podría aparecer es la frecuencia/día (no se filtra por bajo mínimo).
    const { entorno, token } = entornoConCatalogo([productoMatriz('COD-H01', 'PROVEEDOR A', { existencia: 20, minimo: 5, maximo: 25 })]);
    entorno.invocar('guardarProductoHabitualCompraApp', { codigo: 'COD-H01', frecuencia: 'SEMANAL', diaCompra: 'LUNES' }, token);

    // Se buscan el próximo lunes y el próximo martes reales, sin importar qué día se ejecute la prueba.
    let lunes = null, martes = null;
    for (let i = 0; i < 14; i++) {
      const dia = entorno.invocar('obtenerDiaActual', new Date(Date.now() + i * 86400000));
      if (dia === 'LUNES' && lunes === null) lunes = fechaISO(i);
      if (dia === 'MARTES' && martes === null) martes = fechaISO(i);
    }

    const enLunes = entorno.invocar('obtenerProductosHabitualesCompraApp', lunes, token);
    const enMartes = entorno.invocar('obtenerProductosHabitualesCompraApp', martes, token);

    return {
      datos: `lunes=${lunes}, martes=${martes}`,
      esperado: 'el lunes aparece 1 producto (COD-H01); el martes, 0',
      obtenido: `lunes.productos=${enLunes.productos.length}, martes.productos=${enMartes.productos.length}`,
      pasa: enLunes.productos.length === 1 && enLunes.productos[0].codigo === 'COD-H01' && enMartes.productos.length === 0,
    };
  },
});

prueba({
  id: 'PCR-CFG-005', grupo: 'compras', nombre: 'establecerActivoProductoHabitualCompraApp desactiva sin borrar — nunca se carga inactivo',
  metodo: 'EMPÍRICO',
  objetivo: 'Sección 5: "no debe cargar productos inactivos" — desactivar debe sacarlo de la carga diaria pero conservar su fila de configuración',
  ejecutar() {
    // existencia por encima del mínimo: al desactivarlo como habitual no
    // debe reaparecer "colado" por la mezcla de sugerencias bajo mínimo.
    const { entorno, token } = entornoConCatalogo([productoMatriz('COD-H01', 'PROVEEDOR A', { existencia: 20, minimo: 5, maximo: 25 })]);
    registrarHabitual(entorno, token, 'COD-H01');
    const antes = entorno.invocar('obtenerProductosHabitualesCompraApp', fechaISO(0), token);
    entorno.invocar('establecerActivoProductoHabitualCompraApp', 'COD-H01', false, token);
    const despues = entorno.invocar('obtenerProductosHabitualesCompraApp', fechaISO(0), token);
    const config = entorno.invocar('listarProductosHabitualesCompraApp', token);
    return {
      datos: 'COD-H01 activo, luego desactivado',
      esperado: 'antes=1 producto cargado; después=0 cargados, pero sigue existiendo en la configuración (activo=false)',
      obtenido: `antes=${antes.productos.length}, despues=${despues.productos.length}, sigueConfigurado=${config.some(p => p.codigo === 'COD-H01' && p.activo === false)}`,
      pasa: antes.productos.length === 1 && despues.productos.length === 0 && config.some(p => p.codigo === 'COD-H01' && p.activo === false),
    };
  },
});

prueba({
  id: 'PCR-CFG-006', grupo: 'compras', nombre: 'Modo de cantidad FIJA usa la cantidad habitual capturada, no Máximo-Existencia',
  metodo: 'EMPÍRICO',
  objetivo: 'Sección 6A: cantidad habitual = 20 debe proponer comprar 20, sin importar existencia/mínimo/máximo',
  ejecutar() {
    const { entorno, token } = entornoConCatalogo([productoMatriz('COD-H01', 'PROVEEDOR A', { existencia: 50, minimo: 5, maximo: 25 })]);
    registrarHabitual(entorno, token, 'COD-H01', { modoCantidad: 'FIJA', cantidadHabitual: 20 });
    const r = entorno.invocar('obtenerProductosHabitualesCompraApp', fechaISO(0), token);
    return {
      datos: 'modoCantidad=FIJA, cantidadHabitual=20, existencia=50 (por encima del máximo=25)',
      esperado: 'sugerido=20 (ignora existencia/máximo)',
      obtenido: `sugerido=${r.productos[0].sugerido}`,
      pasa: r.productos[0].sugerido === 20,
    };
  },
});

prueba({
  id: 'PCR-CFG-007', grupo: 'compras', nombre: 'Modo MIN_MAX descuenta la mercancía en tránsito (Máximo - Existencia - En tránsito)',
  metodo: 'EMPÍRICO',
  objetivo: 'Sección 6C: si ya hay una OC pendiente de recibir por 10 unidades, la sugerencia debe descontar esas 10 para no sobre-comprar',
  ejecutar() {
    const { entorno, token } = entornoConCatalogo([productoMatriz('COD-H01', 'PROVEEDOR A', { existencia: 5, minimo: 5, maximo: 25 })]);
    registrarHabitual(entorno, token, 'COD-H01');

    const sinTransito = entorno.invocar('obtenerProductosHabitualesCompraApp', fechaISO(0), token);

    entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR A', '', [{ codigo: 'COD-H01', producto: 'PRODUCTO COD-H01', udm: 'KG', cantidad: 10, precio: 1 }], token);

    const conTransito = entorno.invocar('obtenerProductosHabitualesCompraApp', fechaISO(0), token);

    return {
      datos: 'existencia=5, máximo=25; luego se genera una OC pendiente por 10 unidades del mismo producto',
      esperado: `sin OC pendiente: sugerido=20 (25-5); con OC pendiente por 10: sugerido=10 (25-5-10)`,
      obtenido: `sinTransito=${sinTransito.productos[0].sugerido}, conTransito=${conTransito.productos[0].sugerido}, enTransito=${conTransito.productos[0].enTransito}`,
      pasa: sinTransito.productos[0].sugerido === 20 && conTransito.productos[0].sugerido === 10 && conTransito.productos[0].enTransito === 10,
    };
  },
});

prueba({
  id: 'PCR-CFG-008', grupo: 'compras', nombre: 'Un producto bajo mínimo aparece como sugerencia aunque NO esté configurado como habitual',
  metodo: 'EMPÍRICO',
  objetivo: 'Igual que en Sugerencias de Requisición/Centro de Reabastecimiento: cualquier producto del catálogo con existencia <= mínimo debe sugerirse, sin necesidad de configurarlo en Productos Habituales',
  ejecutar() {
    const { entorno, token } = entornoConCatalogo([
      productoMatriz('COD-01', 'PROVEEDOR A'), // NUNCA se configura como habitual
      productoMatriz('COD-02', 'PROVEEDOR B', { existencia: 20, minimo: 5, maximo: 25 }), // por encima del mínimo — no debe aparecer
    ]);
    const r = entorno.invocar('obtenerProductosHabitualesCompraApp', fechaISO(0), token);
    const bajoMinimo = r.productos.find(p => p.codigo === 'COD-01');
    return {
      datos: 'COD-01 bajo mínimo (existencia=0, mínimo=5) sin configurar como habitual; COD-02 por encima del mínimo',
      esperado: 'aparece 1 producto (COD-01) con origen=BAJO_MINIMO; COD-02 no aparece',
      obtenido: `productos=${r.productos.length}, origenCOD01=${bajoMinimo && bajoMinimo.origen}`,
      pasa: r.productos.length === 1 && !!bajoMinimo && bajoMinimo.origen === 'BAJO_MINIMO',
    };
  },
});

prueba({
  id: 'PCR-CFG-009', grupo: 'compras', nombre: 'Un producto habitual que también está bajo mínimo no se duplica',
  metodo: 'EMPÍRICO',
  objetivo: 'Si un producto ya entró a la lista por ser habitual del día, la mezcla de sugerencias bajo mínimo no debe agregarlo una segunda vez',
  ejecutar() {
    const { entorno, token } = entornoConCatalogo([productoMatriz('COD-01', 'PROVEEDOR A')]); // existencia=0, minimo=5 -> bajo mínimo
    registrarHabitual(entorno, token, 'COD-01'); // DIARIA -> también habitual hoy
    const r = entorno.invocar('obtenerProductosHabitualesCompraApp', fechaISO(0), token);
    const filas = r.productos.filter(p => p.codigo === 'COD-01');
    return {
      datos: 'COD-01 es habitual (DIARIA) Y está bajo mínimo a la vez',
      esperado: 'exactamente 1 fila, con origen=HABITUAL (no se duplica como BAJO_MINIMO)',
      obtenido: JSON.stringify(filas.map(p => ({ codigo: p.codigo, origen: p.origen }))),
      pasa: filas.length === 1 && filas[0].origen === 'HABITUAL',
    };
  },
});

// ============================================
// CASOS OBLIGATORIOS (sección 34 del pedido de Alberto)
// ============================================

prueba({
  id: 'PCR-CASO-01', grupo: 'compras', nombre: 'Caso 1: 20 productos habituales / 6 proveedores generan exactamente 6 OCs',
  metodo: 'EMPÍRICO',
  objetivo: 'El flujo completo (cargar habituales -> guardar borrador -> generar) debe agrupar 20 líneas de 6 proveedores distintos en 6 Órdenes de Compra, una por proveedor',
  ejecutar() {
    const proveedores = ['PROVEEDOR A', 'PROVEEDOR B', 'PROVEEDOR C', 'PROVEEDOR D', 'PROVEEDOR E', 'PROVEEDOR F'];
    const filas = [];
    for (let i = 1; i <= 20; i++) {
      filas.push(productoMatriz('COD-' + String(i).padStart(2, '0'), proveedores[i % 6]));
    }
    const { entorno, token } = entornoConCatalogo(filas);
    filas.forEach(f => registrarHabitual(entorno, token, f[4]));

    const hoy = fechaISO(0);
    const habituales = entorno.invocar('obtenerProductosHabitualesCompraApp', hoy, token);
    const items = habituales.productos.map(p => ({
      codigo: p.codigo, producto: p.producto, proveedor: p.proveedor,
      existencia: p.existencia, sugerido: p.sugerido, cantidad: p.sugerido,
      udm: p.udm, precio: p.precio, origen: 'HABITUAL',
    }));

    const borrador = entorno.invocar('guardarBorradorPedidoCompraApp', null, hoy, items, '', token);
    const resultado = entorno.invocar('generarOrdenesDesdePedidoApp', borrador.folio, token);
    const totalProductosEnOCs = resultado.ordenes.reduce((s, o) => s + o.productos, 0);

    return {
      datos: `20 productos habituales repartidos en ${proveedores.length} proveedores`,
      esperado: '20 productos cargados, 6 órdenes de compra generadas, 0 incidencias, 20 líneas en total repartidas entre las 6 OCs',
      obtenido: `productosHabituales=${habituales.productos.length}, ordenesGeneradas=${resultado.ordenes.length}, incidencias=${resultado.incidencias.length}, totalProductosEnOCs=${totalProductosEnOCs}`,
      pasa: habituales.productos.length === 20 && resultado.ordenes.length === 6 && resultado.incidencias.length === 0 && totalProductosEnOCs === 20,
    };
  },
});

prueba({
  id: 'PCR-CASO-02', grupo: 'compras', nombre: 'Caso 2: producto sin proveedor se reporta como incidencia, sin tumbar el resto del pedido',
  metodo: 'EMPÍRICO',
  objetivo: 'Un producto con MATRIZ!Q vacío debe excluirse de la generación con una incidencia clara, mientras el resto del pedido sí genera su OC',
  ejecutar() {
    const conProveedor = productoMatriz('COD-01', 'PROVEEDOR A');
    const sinProveedor = productoMatriz('COD-02', 'PROVEEDOR A');
    sinProveedor[16] = ''; // fuerza proveedor vacío en MATRIZ (columna Q)

    const { entorno, token } = entornoConCatalogo([conProveedor, sinProveedor]);
    registrarHabitual(entorno, token, 'COD-01');
    registrarHabitual(entorno, token, 'COD-02');

    const hoy = fechaISO(0);
    const habituales = entorno.invocar('obtenerProductosHabitualesCompraApp', hoy, token);
    const incidenciaEnCarga = habituales.productos.find(p => p.codigo === 'COD-02');

    const items = habituales.productos.map(p => ({
      codigo: p.codigo, producto: p.producto, proveedor: p.proveedor,
      cantidad: p.sugerido, udm: p.udm, precio: p.precio, origen: 'HABITUAL',
    }));
    const borrador = entorno.invocar('guardarBorradorPedidoCompraApp', null, hoy, items, '', token);
    const resultado = entorno.invocar('generarOrdenesDesdePedidoApp', borrador.folio, token);

    return {
      datos: 'COD-01 con proveedor, COD-02 sin proveedor',
      esperado: 'al cargar, COD-02 trae incidencia "no tiene proveedor"; al generar, 1 incidencia sobre COD-02 y 1 OC generada solo con COD-01',
      obtenido: `incidenciaCarga="${incidenciaEnCarga.incidencia}", incidenciasGenerar=${JSON.stringify(resultado.incidencias)}, ordenes=${resultado.ordenes.length}`,
      pasa: incidenciaEnCarga.incidencia.indexOf('no tiene proveedor') !== -1
        && resultado.incidencias.length === 1 && resultado.incidencias[0].codigo === 'COD-02'
        && resultado.ordenes.length === 1 && resultado.ordenes[0].productos === 1,
    };
  },
});

prueba({
  id: 'PCR-CASO-03', grupo: 'compras', nombre: 'Caso 3: cantidad 0 no genera línea de compra ni incidencia',
  metodo: 'EMPÍRICO',
  objetivo: 'Sección 24: un producto con cantidad calculada/capturada en 0 se omite silenciosamente (no es un error, es "sin necesidad de comprar")',
  ejecutar() {
    const { entorno, token } = entornoConCatalogo([productoMatriz('COD-01', 'PROVEEDOR A'), productoMatriz('COD-02', 'PROVEEDOR A')]);
    registrarHabitual(entorno, token, 'COD-01');
    registrarHabitual(entorno, token, 'COD-02');
    const hoy = fechaISO(0);
    const items = [
      { codigo: 'COD-01', producto: 'P1', proveedor: 'PROVEEDOR A', cantidad: 10, udm: 'KG', precio: 1, origen: 'HABITUAL' },
      { codigo: 'COD-02', producto: 'P2', proveedor: 'PROVEEDOR A', cantidad: 0, udm: 'KG', precio: 1, origen: 'HABITUAL' },
    ];
    const borrador = entorno.invocar('guardarBorradorPedidoCompraApp', null, hoy, items, '', token);
    const resultado = entorno.invocar('generarOrdenesDesdePedidoApp', borrador.folio, token);
    const detalleOC = entorno.invocar('obtenerDetalleOCApp_', resultado.ordenes[0].folio);
    return {
      datos: 'COD-01 cantidad=10, COD-02 cantidad=0',
      esperado: '0 incidencias, 1 OC con solo 1 línea (COD-01); COD-02 no aparece en la OC',
      obtenido: `incidencias=${resultado.incidencias.length}, lineasEnOC=${detalleOC.items.length}, codigos=${detalleOC.items.map(i => i.codigo).join(',')}`,
      pasa: resultado.incidencias.length === 0 && detalleOC.items.length === 1 && detalleOC.items[0].codigo === 'COD-01',
    };
  },
});

prueba({
  id: 'PCR-CASO-04', grupo: 'compras', nombre: 'Caso 4: cantidad negativa se bloquea como incidencia',
  metodo: 'EMPÍRICO',
  objetivo: 'Sección 22: una cantidad negativa nunca debe llegar a una OC',
  ejecutar() {
    const { entorno, token } = entornoConCatalogo([productoMatriz('COD-01', 'PROVEEDOR A')]);
    registrarHabitual(entorno, token, 'COD-01');
    const hoy = fechaISO(0);
    const items = [{ codigo: 'COD-01', producto: 'P1', proveedor: 'PROVEEDOR A', cantidad: -5, udm: 'KG', precio: 1, origen: 'HABITUAL' }];
    const borrador = entorno.invocar('guardarBorradorPedidoCompraApp', null, hoy, items, '', token);
    let lanzo = false, resultado = null;
    try { resultado = entorno.invocar('generarOrdenesDesdePedidoApp', borrador.folio, token); } catch (e) { lanzo = true; }
    return {
      datos: 'único producto del pedido con cantidad=-5',
      esperado: 'como no queda ningún producto válido, generarOrdenesDesdePedidoApp lanza error (nada que generar)',
      obtenido: `lanzo=${lanzo}`,
      pasa: lanzo === true,
    };
  },
});

prueba({
  id: 'PCR-CASO-05', grupo: 'compras', nombre: 'Caso 5: producto duplicado dentro del mismo pedido se detecta como incidencia',
  metodo: 'EMPÍRICO',
  objetivo: 'Sección 22: el mismo código capturado dos veces en un pedido debe reportarse, no sumarse ni duplicarse en la OC',
  ejecutar() {
    const { entorno, token } = entornoConCatalogo([productoMatriz('COD-01', 'PROVEEDOR A')]);
    registrarHabitual(entorno, token, 'COD-01');
    const hoy = fechaISO(0);
    const items = [
      { codigo: 'COD-01', producto: 'P1', proveedor: 'PROVEEDOR A', cantidad: 10, udm: 'KG', precio: 1, origen: 'HABITUAL' },
      { codigo: 'COD-01', producto: 'P1', proveedor: 'PROVEEDOR A', cantidad: 5, udm: 'KG', precio: 1, origen: 'EXTRAORDINARIO' },
    ];
    const borrador = entorno.invocar('guardarBorradorPedidoCompraApp', null, hoy, items, '', token);
    const resultado = entorno.invocar('generarOrdenesDesdePedidoApp', borrador.folio, token);
    const detalleOC = entorno.invocar('obtenerDetalleOCApp_', resultado.ordenes[0].folio);
    return {
      datos: 'COD-01 capturado dos veces (cantidad 10 y 5)',
      esperado: '1 incidencia de duplicado, la OC solo lleva la primera línea (cantidad 10)',
      obtenido: `incidencias=${JSON.stringify(resultado.incidencias)}, lineasEnOC=${detalleOC.items.length}, cantidad=${detalleOC.items[0] && detalleOC.items[0].cantidad}`,
      pasa: resultado.incidencias.length === 1 && resultado.incidencias[0].motivo.indexOf('duplicado') !== -1
        && detalleOC.items.length === 1 && detalleOC.items[0].cantidad === 10,
    };
  },
});

prueba({
  id: 'PCR-CASO-06', grupo: 'compras', nombre: 'Caso 6: un pedido ya GENERADO ese día se detecta y no se vuelve a generar',
  metodo: 'EMPÍRICO',
  objetivo: 'Sección 15/19: iniciarPedidoCompraRapidoApp debe avisar que ya existe un pedido generado ese día, y generarOrdenesDesdePedidoApp debe rechazar generar el mismo folio dos veces',
  ejecutar() {
    const { entorno, token } = entornoConCatalogo([productoMatriz('COD-01', 'PROVEEDOR A')]);
    registrarHabitual(entorno, token, 'COD-01');
    const hoy = fechaISO(0);
    const items = [{ codigo: 'COD-01', producto: 'P1', proveedor: 'PROVEEDOR A', cantidad: 10, udm: 'KG', precio: 1, origen: 'HABITUAL' }];
    const borrador = entorno.invocar('guardarBorradorPedidoCompraApp', null, hoy, items, '', token);
    entorno.invocar('generarOrdenesDesdePedidoApp', borrador.folio, token);

    const reingreso = entorno.invocar('iniciarPedidoCompraRapidoApp', hoy, token);
    let lanzoAlRegenerar = false;
    try { entorno.invocar('generarOrdenesDesdePedidoApp', borrador.folio, token); } catch (e) { lanzoAlRegenerar = true; }

    return {
      datos: `pedido ${borrador.folio} ya generado hoy`,
      esperado: 'iniciarPedidoCompraRapidoApp reporta existente=true con el mismo folio; volver a generar lanza error',
      obtenido: `existente=${reingreso.existente}, folioReportado=${reingreso.pedido && reingreso.pedido.folio}, lanzoAlRegenerar=${lanzoAlRegenerar}`,
      pasa: reingreso.existente === true && reingreso.pedido.folio === borrador.folio && lanzoAlRegenerar === true,
    };
  },
});

prueba({
  id: 'PCR-CASO-07', grupo: 'compras', nombre: 'Caso 7: dos guardados de borrador seguidos el mismo día no repiten folio de pedido',
  metodo: 'EMPÍRICO',
  objetivo: 'Mismo criterio que CONC-003 (OC) — el folio PED-YYYYMMDD-NNN se reserva dentro de conBloqueoApp_, así que dos pedidos creados "seguidos" no colisionan',
  ejecutar() {
    const { entorno, token } = entornoConCatalogo([productoMatriz('COD-01', 'PROVEEDOR A'), productoMatriz('COD-02', 'PROVEEDOR B')]);
    registrarHabitual(entorno, token, 'COD-01');
    registrarHabitual(entorno, token, 'COD-02');
    const hoy = fechaISO(0);
    const p1 = entorno.invocar('guardarBorradorPedidoCompraApp', null, hoy,
      [{ codigo: 'COD-01', producto: 'P1', proveedor: 'PROVEEDOR A', cantidad: 1, udm: 'KG', precio: 1, origen: 'HABITUAL' }], '', token);
    const p2 = entorno.invocar('guardarBorradorPedidoCompraApp', null, hoy,
      [{ codigo: 'COD-02', producto: 'P2', proveedor: 'PROVEEDOR B', cantidad: 1, udm: 'KG', precio: 1, origen: 'HABITUAL' }], '', token);
    return {
      datos: `folio1=${p1.folio}, folio2=${p2.folio}`,
      esperado: 'folios distintos, consecutivo estricto -001 y -002',
      obtenido: `folio1=${p1.folio}, folio2=${p2.folio}`,
      pasa: p1.folio !== p2.folio && p1.folio.endsWith('-001') && p2.folio.endsWith('-002'),
    };
  },
});

prueba({
  id: 'PCR-CASO-08', grupo: 'compras', nombre: 'Caso 8: un usuario sin acceso a Almacén no puede generar el pedido',
  metodo: 'EMPÍRICO',
  objetivo: 'requerirAccesoAlmacenApp_ (reutilizada, misma regla que Órdenes de Compra) debe bloquear a un OPERADOR de un área distinta a Almacén',
  ejecutar() {
    const { entorno, token: tokenAdmin } = entornoConCatalogo([productoMatriz('COD-01', 'PROVEEDOR A')]);
    registrarHabitual(entorno, tokenAdmin, 'COD-01');
    const tokenCocina = entorno.invocar('crearSesion_', 'cocina@tagers.com', 'Usuario Cocina', 'OPERADOR');
    let lanzo = false;
    try { entorno.invocar('obtenerProductosHabitualesCompraApp', fechaISO(0), tokenCocina); } catch (e) { lanzo = true; }
    return {
      datos: 'sesión OPERADOR de área "Cocina" (no Almacén)',
      esperado: 'bloqueado',
      obtenido: `lanzo=${lanzo}`,
      pasa: lanzo === true,
    };
  },
});

prueba({
  id: 'PCR-CASO-09', grupo: 'compras', nombre: 'Caso 9: un producto extraordinario (fuera de los habituales) se agrega y genera correctamente',
  metodo: 'EMPÍRICO',
  objetivo: 'Sección 9: el usuario debe poder agregar al pedido un producto que NO está en PRODUCTOS_COMPRA, y que termine en su propia OC agrupado por proveedor',
  ejecutar() {
    const { entorno, token } = entornoConCatalogo([
      productoMatriz('COD-01', 'PROVEEDOR A'), // habitual
      productoMatriz('COD-99', 'PROVEEDOR Z'), // NUNCA se configura como habitual — es el extraordinario
    ]);
    registrarHabitual(entorno, token, 'COD-01');
    const hoy = fechaISO(0);
    const habituales = entorno.invocar('obtenerProductosHabitualesCompraApp', hoy, token);

    const extra = entorno.invocar('buscarProductoCatalogoApp', 'COD-99', token)[0];
    const items = habituales.productos.map(p => ({
      codigo: p.codigo, producto: p.producto, proveedor: p.proveedor, cantidad: p.sugerido || 10,
      udm: p.udm, precio: p.precio, origen: 'HABITUAL',
    })).concat([{
      codigo: extra.codigo, producto: extra.producto, proveedor: extra.proveedor,
      cantidad: 7, udm: extra.udm, precio: extra.precio, origen: 'EXTRAORDINARIO',
    }]);

    const borrador = entorno.invocar('guardarBorradorPedidoCompraApp', null, hoy, items, '', token);
    const resultado = entorno.invocar('generarOrdenesDesdePedidoApp', borrador.folio, token);
    const ocExtra = resultado.ordenes.find(o => o.proveedor === 'PROVEEDOR Z');

    return {
      datos: 'COD-01 habitual (PROVEEDOR A) + COD-99 extraordinario (PROVEEDOR Z, cantidad 7)',
      esperado: '2 órdenes generadas, una de ellas a PROVEEDOR Z con 1 producto',
      obtenido: `ordenes=${resultado.ordenes.length}, ocExtra=${JSON.stringify(ocExtra)}`,
      pasa: resultado.ordenes.length === 2 && !!ocExtra && ocExtra.productos === 1,
    };
  },
});

prueba({
  id: 'PCR-CASO-10', grupo: 'compras', nombre: 'Caso 10: cancelar un borrador conserva su información histórica (no se borra)',
  metodo: 'EMPÍRICO',
  objetivo: 'Sección 30: cancelarPedidoCompraApp debe cambiar el estado sin eliminar el encabezado ni las líneas de detalle',
  ejecutar() {
    const { entorno, token } = entornoConCatalogo([productoMatriz('COD-01', 'PROVEEDOR A')]);
    registrarHabitual(entorno, token, 'COD-01');
    const hoy = fechaISO(0);
    const items = [{ codigo: 'COD-01', producto: 'P1', proveedor: 'PROVEEDOR A', cantidad: 10, udm: 'KG', precio: 1, origen: 'HABITUAL' }];
    const borrador = entorno.invocar('guardarBorradorPedidoCompraApp', null, hoy, items, '', token);
    entorno.invocar('cancelarPedidoCompraApp', borrador.folio, token);
    const pedido = entorno.invocar('obtenerPedidoCompraApp', borrador.folio, token);

    let lanzoAlGenerarCancelado = false;
    try { entorno.invocar('generarOrdenesDesdePedidoApp', borrador.folio, token); } catch (e) { lanzoAlGenerarCancelado = true; }

    return {
      datos: `pedido ${borrador.folio} cancelado`,
      esperado: 'estado=CANCELADO, el detalle (1 línea) sigue existiendo, y ya no se puede generar',
      obtenido: `estado=${pedido.estado}, items=${pedido.items.length}, lanzoAlGenerarCancelado=${lanzoAlGenerarCancelado}`,
      pasa: pedido.estado === 'CANCELADO' && pedido.items.length === 1 && lanzoAlGenerarCancelado === true,
    };
  },
});

prueba({
  id: 'PCR-CFG-010', grupo: 'compras', nombre: 'Columna U de MATRIZ ("SI") marca un producto como habitual sin configurarlo aparte',
  metodo: 'EMPÍRICO',
  objetivo: 'Alberto prefiere marcar en MATRIZ mismo (columna U) qué se compra seguido, en vez de registrar frecuencia/día en Productos Habituales — un insumo nuevo con columna U="SI" debe aparecer de inmediato, cualquier día, y un producto descontinuado marcado igual no debe ofrecerse',
  ejecutar() {
    const marcado = marcarCompraSemanalMatriz(productoMatriz('COD-01', 'PROVEEDOR A', { existencia: 20, minimo: 5, maximo: 25 }));
    const noMarcado = productoMatriz('COD-02', 'PROVEEDOR B', { existencia: 20, minimo: 5, maximo: 25 });
    const descontinuadoMarcado = marcarCompraSemanalMatriz(productoMatriz('COD-03', 'PROVEEDOR A', { existencia: 20, minimo: 5, maximo: 25, ubicacion: '---' }));

    const { entorno, token } = entornoConCatalogo([marcado, noMarcado, descontinuadoMarcado]);

    // Cualquier día: no depende de frecuencia/día como los habituales configurados.
    const hoy = entorno.invocar('obtenerProductosHabitualesCompraApp', fechaISO(0), token);
    const dentroDe10Dias = entorno.invocar('obtenerProductosHabitualesCompraApp', fechaISO(10), token);

    return {
      datos: 'COD-01 con columna U="SI"; COD-02 sin marcar; COD-03 marcado pero descontinuado (sin ubicación)',
      esperado: 'aparece solo COD-01 (origen=HABITUAL), tanto hoy como en 10 días — sin restricción de día',
      obtenido: `hoy=${JSON.stringify(hoy.productos.map(p => p.codigo))}, en10dias=${JSON.stringify(dentroDe10Dias.productos.map(p => p.codigo))}`,
      pasa: hoy.productos.length === 1 && hoy.productos[0].codigo === 'COD-01' && hoy.productos[0].origen === 'HABITUAL'
        && dentroDe10Dias.productos.length === 1 && dentroDe10Dias.productos[0].codigo === 'COD-01',
    };
  },
});

prueba({
  id: 'PCR-CASO-11', grupo: 'compras', nombre: 'La Presentación (compra por caja) sobrevive de habituales -> borrador -> OC generada',
  metodo: 'EMPÍRICO',
  objetivo: 'Un producto que se compra por presentación (Convertir=SI en MATRIZ, ej. caja de 12L) debe llegar a DETALLE_OC con su columna Presentación poblada — si se pierde en el camino, Recepción de Mercancía termina mostrando la línea en unidad base en vez de piezas/caja, que fue justo lo que reportó Alberto',
  ejecutar() {
    const leche = productoMatriz('COD-LECHE', 'PROVEEDOR A', {
      producto: 'LECHE ENTERA', existencia: 12, minimo: 5, maximo: 120,
    });
    leche[18] = 'SI'; // Convertir
    leche[19] = 12;   // Presentación: caja de 12 L

    const { entorno, token } = entornoConCatalogo([leche]);
    registrarHabitual(entorno, token, 'COD-LECHE');

    const hoy = fechaISO(0);
    const habituales = entorno.invocar('obtenerProductosHabitualesCompraApp', hoy, token);
    const p = habituales.productos[0];

    // Igual que pedidoRapidoItemsParaEnviar en index.html: la cantidad
    // capturada en pantalla son PIEZAS (p.sugeridoPiezas), se convierten a
    // unidad real antes de mandarlas, y se manda también "presentacion".
    const items = [{
      codigo: p.codigo, producto: p.producto, proveedor: p.proveedor,
      existencia: p.existencia, sugerido: p.sugerido,
      cantidad: p.sugeridoPiezas * p.presentacion,
      udm: p.udm, precio: p.precio, origen: p.origen,
      presentacion: p.presentacion,
    }];

    const borrador = entorno.invocar('guardarBorradorPedidoCompraApp', null, hoy, items, '', token);
    const resultado = entorno.invocar('generarOrdenesDesdePedidoApp', borrador.folio, token);
    const oc = entorno.invocar('obtenerDetalleOCApp', resultado.ordenes[0].folio, token);
    const linea = oc.items[0];

    return {
      datos: `LECHE ENTERA: convertir=SI, presentación=12L/caja, sugeridoPiezas=${p.sugeridoPiezas}, cantidad real enviada=${items[0].cantidad}`,
      esperado: 'la línea en DETALLE_OC conserva presentacion=12 y piezasOrdenadas=9 (no 0), con cantidad real=108',
      obtenido: `presentacion=${linea.presentacion}, piezasOrdenadas=${linea.piezasOrdenadas}, cantidad=${linea.cantidad}`,
      pasa: linea.presentacion === 12 && linea.piezasOrdenadas === 9 && linea.cantidad === 108,
    };
  },
});
