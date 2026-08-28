'use strict';

/*
 * Módulo de Proveedores (pedido del usuario): informativo, NO genera
 * ninguna orden de compra — a diferencia de Centro de Reabastecimiento.
 * Verifica la lista agrupada, el detalle por proveedor (que SÍ incluye
 * productos sin ubicación, a propósito, porque es catálogo informativo
 * completo), y el ajuste de precio/presentación con su registro correcto
 * (HISTORIAL_PRECIOS para precio, AUDITORIA para presentación — nunca
 * KARDEX, que es de cantidades).
 */

const { prueba } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase, hojaMatrizEstandar, filaProducto } = require('../lib/datos-prueba');

function entornoConLogin(rolCorreo, overrides) {
  const entorno = crearEntorno({ hojas: hojasBase(overrides) });
  const token = entorno.invocar('crearSesion_', rolCorreo.correo, rolCorreo.nombre, rolCorreo.rol);
  return { entorno, token };
}

prueba({
  id: 'PROV-001', grupo: 'proveedores', nombre: 'Lista de proveedores agrupa correctamente por proveedor', metodo: 'EMPÍRICO',
  objetivo: 'obtenerListaProveedoresApp debe agrupar MATRIZ por proveedor y contar cuántos productos tiene cada uno',
  ejecutar() {
    const matriz = hojaMatrizEstandar();
    matriz.push(filaProducto({ producto: 'HUEVO BLANCO', udm: 'KG', codigo: 'COD-010', existencia: 40, proveedor: 'Huevos del Bajío', costo: 850 }));
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' }, { MATRIZ: matriz });
    const lista = entorno.invocar('obtenerListaProveedoresApp', token);
    const generico = lista.find(p => p.proveedor === 'PROVEEDOR GENERICO');
    const huevos = lista.find(p => p.proveedor === 'Huevos del Bajío');
    return {
      datos: '5 productos base con "PROVEEDOR GENERICO" + 1 producto nuevo con "Huevos del Bajío"',
      esperado: 'PROVEEDOR GENERICO=5, Huevos del Bajío=1',
      obtenido: `PROVEEDOR GENERICO=${generico && generico.totalProductos}, Huevos del Bajío=${huevos && huevos.totalProductos}`,
      pasa: !!generico && generico.totalProductos === 5 && !!huevos && huevos.totalProductos === 1,
    };
  },
});

prueba({
  id: 'PROV-011', grupo: 'proveedores', nombre: 'Lista de proveedores trae el valor de inventario y ordena de mayor a menor', metodo: 'EMPÍRICO',
  objetivo: 'obtenerListaProveedoresApp debe sumar existencia×precio de cada producto por proveedor (calcularValorInventario_) y ordenar de mayor a menor valor, para responder directo "qué proveedor pesa más en mi inventario"',
  ejecutar() {
    const matriz = hojaMatrizEstandar();
    // "Proveedor Caro": 10 unidades a $500 = $5,000 -> debe quedar primero.
    matriz.push(filaProducto({ producto: 'TRUFA NEGRA', udm: 'KG', codigo: 'COD-020', existencia: 10, proveedor: 'Proveedor Caro', costo: 500 }));
    // "Proveedor Barato": 2 unidades a $5 = $10 -> debe quedar al final.
    matriz.push(filaProducto({ producto: 'SERVILLETAS', udm: 'PZ', codigo: 'COD-021', existencia: 2, proveedor: 'Proveedor Barato', costo: 5 }));
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' }, { MATRIZ: matriz });

    const lista = entorno.invocar('obtenerListaProveedoresApp', token);
    const caro = lista.find(p => p.proveedor === 'Proveedor Caro');
    const barato = lista.find(p => p.proveedor === 'Proveedor Barato');
    const indiceCaro = lista.findIndex(p => p.proveedor === 'Proveedor Caro');
    const indiceBarato = lista.findIndex(p => p.proveedor === 'Proveedor Barato');

    return {
      datos: 'Proveedor Caro: 10×$500=$5,000. Proveedor Barato: 2×$5=$10',
      esperado: 'valorInventario correcto para cada uno, y Proveedor Caro aparece ANTES que Proveedor Barato en la lista (orden descendente por valor)',
      obtenido: `Caro.valorInventario=${caro && caro.valorInventario} (posición ${indiceCaro}), Barato.valorInventario=${barato && barato.valorInventario} (posición ${indiceBarato})`,
      pasa: !!caro && caro.valorInventario === 5000 && !!barato && barato.valorInventario === 10 && indiceCaro < indiceBarato,
    };
  },
});

prueba({
  id: 'PROV-012', grupo: 'proveedores', nombre: 'El detalle por proveedor trae el valor de cada producto y suma correctamente', metodo: 'EMPÍRICO',
  objetivo: 'obtenerProductosProveedorInfoApp debe traer "valor" (existencia×precio) por producto, y la suma de esos valores debe coincidir con el valorInventario que reporta obtenerListaProveedoresApp para ese mismo proveedor',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    const lista = entorno.invocar('obtenerListaProveedoresApp', token);
    const totalProveedorGenerico = lista.find(p => p.proveedor === 'PROVEEDOR GENERICO').valorInventario;

    const detalle = entorno.invocar('obtenerProductosProveedorInfoApp', 'PROVEEDOR GENERICO', token);
    const sumaDetalle = Math.round(detalle.reduce((s, p) => s + p.valor, 0) * 100) / 100;

    return {
      datos: 'suma de "valor" por producto en el detalle vs. "valorInventario" total de la lista, mismo proveedor',
      esperado: 'ambos números coinciden exactamente — no hay dos fórmulas de valorización distintas conviviendo',
      obtenido: `sumaDetalle=${sumaDetalle}, totalLista=${totalProveedorGenerico}`,
      pasa: sumaDetalle === totalProveedorGenerico,
    };
  },
});

prueba({
  id: 'PROV-002', grupo: 'proveedores', nombre: 'El detalle por proveedor SÍ incluye productos sin ubicación (a diferencia de Centro de Reabastecimiento)', metodo: 'EMPÍRICO',
  objetivo: 'obtenerProductosProveedorInfoApp es un catálogo informativo completo — no debe excluir productos sin ubicación como sí hace obtenerProductosPorProveedorApp (que es para armar una OC)',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    // COD-005 "PRODUCTO SIN UBICACION" tiene proveedor="PROVEEDOR GENERICO" (default) y ubicacion="--".
    const detalle = entorno.invocar('obtenerProductosProveedorInfoApp', 'PROVEEDOR GENERICO', token);
    const sinUbicacion = detalle.find(p => p.codigo === 'COD-005');
    return {
      datos: 'COD-005 sin ubicación asignada, mismo proveedor que los demás',
      esperado: 'aparece en el detalle informativo (a diferencia del flujo de Centro de Reabastecimiento)',
      obtenido: sinUbicacion ? 'aparece' : 'NO aparece',
      pasa: !!sinUbicacion,
    };
  },
});

prueba({
  id: 'PROV-003', grupo: 'proveedores', nombre: 'Ajustar precio actualiza MATRIZ y queda en HISTORIAL_PRECIOS, NUNCA en KARDEX', metodo: 'EMPÍRICO',
  objetivo: 'ajustarProductoProveedorApp(precioNuevo) debe corregir el precio inflado (caso "huevo": capturado como precio de caja completa) y dejar el registro en HISTORIAL_PRECIOS — el Kardex es de cantidades, no debe tocarse',
  ejecutar() {
    const matriz = hojaMatrizEstandar();
    matriz.push(filaProducto({ producto: 'HUEVO BLANCO', udm: 'KG', codigo: 'COD-010', existencia: 40, proveedor: 'Huevos del Bajío', costo: 850 })); // $850 capturado por caja de 18kg, no por kg
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' }, { MATRIZ: matriz });

    const kardexAntes = entorno.leerHoja('KARDEX').length;
    const existenciaAntes = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-010')[10];

    entorno.invocar('ajustarProductoProveedorApp', 'COD-010', { precioNuevo: 47.22 }, token);

    const precioFinal = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-010')[17];
    const existenciaDespues = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-010')[10];
    const kardexDespues = entorno.leerHoja('KARDEX').length;
    const historial = entorno.leerHoja('HISTORIAL_PRECIOS').slice(1);
    const filaHistorial = historial.find(f => f[1] === 'COD-010');

    return {
      datos: 'HUEVO BLANCO capturado a $850/KG (precio de caja completa, no por kg); se corrige a $47.22/KG',
      esperado: 'precio final=47.22; existencia NO cambia (40); Kardex NO gana filas; 1 fila en HISTORIAL_PRECIOS con 850->47.22',
      obtenido: `precioFinal=${precioFinal}, existencia=${existenciaAntes}->${existenciaDespues}, kardex=${kardexAntes}->${kardexDespues}, historial=${filaHistorial ? filaHistorial[4]+'->'+filaHistorial[5] : 'NO ENCONTRADO'}`,
      pasa: precioFinal === 47.22 && existenciaAntes === existenciaDespues && kardexAntes === kardexDespues && !!filaHistorial && filaHistorial[4] === 850 && filaHistorial[5] === 47.22,
    };
  },
});

prueba({
  id: 'PROV-004', grupo: 'proveedores', nombre: 'Ajustar presentación/convertir queda en AUDITORIA, no en HISTORIAL_PRECIOS ni KARDEX', metodo: 'EMPÍRICO',
  objetivo: 'ajustarProductoProveedorApp(presentacionNueva/convertirNuevo) debe actualizar MATRIZ columnas S/T y auditarlo — sin generar ninguna fila de precio ni de cantidad',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    // COD-001 HARINA no tiene presentación capturada por defecto (convertir=NO).
    entorno.invocar('ajustarProductoProveedorApp', 'COD-001', { presentacionNueva: 25, convertirNuevo: true }, token);

    const filaFinal = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001');
    const historialPrecios = entorno.leerHoja('HISTORIAL_PRECIOS').slice(1);
    const auditoria = entorno.leerHoja('AUDITORIA').slice(1);
    const filaAuditoria = auditoria.find(f => f[6] === 'COD-001' && f[5] === 'PRESENTACIÓN AJUSTADA');

    return {
      datos: 'HARINA (COD-001) pasa de "no se compra en presentación" a "se compra en costales de 25 KG"',
      esperado: 'MATRIZ: Convertir=SI, Presentación=25; 0 filas en HISTORIAL_PRECIOS; 1 fila en AUDITORIA',
      obtenido: `convertir=${filaFinal[18]}, presentacion=${filaFinal[19]}, historialPrecios=${historialPrecios.length}, auditoria=${filaAuditoria ? 'encontrada' : 'NO ENCONTRADA'}`,
      pasa: filaFinal[18] === 'SI' && filaFinal[19] === 25 && historialPrecios.length === 0 && !!filaAuditoria,
    };
  },
});

prueba({
  id: 'PROV-005', grupo: 'proveedores', nombre: 'Puede ajustar precio Y presentación en la misma llamada', metodo: 'EMPÍRICO',
  objetivo: 'ajustarProductoProveedorApp debe aplicar ambos cambios de forma independiente cuando se mandan juntos, generando las DOS auditorías correspondientes',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    const r = entorno.invocar('ajustarProductoProveedorApp', 'COD-002', { precioNuevo: 18.5, presentacionNueva: 10, convertirNuevo: true }, token);
    const filaFinal = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-002');
    return {
      datos: 'AZUCAR (COD-002): precio 10->18.5, presentación 0->10 con Convertir=SI, en una sola llamada',
      esperado: 'precioActualizado=true, presentacionActualizada=true, ambos reflejados en MATRIZ',
      obtenido: `precioActualizado=${r.precioActualizado}, presentacionActualizada=${r.presentacionActualizada}, precioMatriz=${filaFinal[17]}, presentacionMatriz=${filaFinal[19]}`,
      pasa: r.precioActualizado === true && r.presentacionActualizada === true && filaFinal[17] === 18.5 && filaFinal[19] === 10,
    };
  },
});

prueba({
  id: 'PROV-006', grupo: 'proveedores', nombre: 'Sin ningún cambio real, lanza error en vez de guardar silenciosamente', metodo: 'EMPÍRICO',
  objetivo: 'Si el precio mandado es igual al actual y no se toca presentación, ajustarProductoProveedorApp debe avisar que no hay nada que guardar, no fallar en silencio',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    let bloqueado = false, mensaje = '';
    try { entorno.invocar('ajustarProductoProveedorApp', 'COD-001', { precioNuevo: 10 }, token); } // COD-001 ya cuesta 10
    catch (e) { bloqueado = true; mensaje = e.message; }
    return {
      datos: 'COD-001 ya cuesta $10; se manda precioNuevo=10 (sin cambio real)',
      esperado: 'error explícito, no un "guardado exitoso" falso',
      obtenido: bloqueado ? mensaje : 'GUARDÓ SIN AVISAR QUE NO HABÍA CAMBIOS',
      pasa: bloqueado && /ningún cambio/i.test(mensaje),
    };
  },
});

prueba({
  id: 'PROV-007', grupo: 'proveedores', nombre: 'Rechaza un precio de 0 o negativo', metodo: 'EMPÍRICO',
  objetivo: 'ajustarProductoProveedorApp debe validar que el precio nuevo sea mayor a 0',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    let bloqueado = false;
    try { entorno.invocar('ajustarProductoProveedorApp', 'COD-001', { precioNuevo: -5 }, token); }
    catch (e) { bloqueado = true; }
    return { datos: 'precioNuevo=-5', esperado: 'bloqueado', obtenido: bloqueado ? 'bloqueado' : 'PERMITIDO', pasa: bloqueado };
  },
});

prueba({
  id: 'PROV-008', grupo: 'proveedores', nombre: 'Activar "Convertir" sin capturar Presentación es rechazado', metodo: 'EMPÍRICO',
  objetivo: 'No tiene sentido decir "se compra en presentaciones" sin decir de qué tamaño — ajustarProductoProveedorApp debe exigir Presentación > 0 cuando Convertir=true',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    let bloqueado = false;
    try { entorno.invocar('ajustarProductoProveedorApp', 'COD-001', { convertirNuevo: true, presentacionNueva: 0 }, token); }
    catch (e) { bloqueado = true; }
    return { datos: 'convertirNuevo=true, presentacionNueva=0', esperado: 'bloqueado', obtenido: bloqueado ? 'bloqueado' : 'PERMITIDO', pasa: bloqueado };
  },
});

prueba({
  id: 'PROV-009', grupo: 'proveedores', nombre: 'Un rol sin acceso de Almacén no puede ajustar precio/presentación', metodo: 'EMPÍRICO',
  objetivo: 'ajustarProductoProveedorApp usa requerirAccesoAlmacenApp_ — un OPERADOR de área (Cocina) no debe poder cambiar precios del catálogo',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    let bloqueado = false;
    try { entorno.invocar('ajustarProductoProveedorApp', 'COD-001', { precioNuevo: 99 }, token); }
    catch (e) { bloqueado = true; }
    return { datos: 'OPERADOR de área Cocina intenta ajustar precio', esperado: 'bloqueado', obtenido: bloqueado ? 'bloqueado' : 'PERMITIDO', pasa: bloqueado };
  },
});

prueba({
  id: 'PROV-010', grupo: 'proveedores', nombre: 'La búsqueda inversa (catálogo) muestra proveedor, precio y presentación juntos', metodo: 'EMPÍRICO',
  objetivo: 'buscarProductoCatalogoApp (usada por "¿Dónde compro este producto?") ya debe incluir presentacion/convertir además de proveedor/precio/existencia',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    // COD-004 "RAJAS POBLANAS 0.5 KG" ya viene con convertir=SI, presentacion=0.5 en el fixture estándar.
    const resultados = entorno.invocar('buscarProductoCatalogoApp', 'rajas poblanas', token);
    const producto = resultados[0];
    return {
      datos: 'búsqueda "rajas poblanas" (COD-004, convertir=SI, presentación=0.5)',
      esperado: 'el resultado incluye proveedor, precio, convertir=true y presentacion=0.5',
      obtenido: producto ? `proveedor=${producto.proveedor}, precio=${producto.precio}, convertir=${producto.convertir}, presentacion=${producto.presentacion}` : 'SIN RESULTADOS',
      pasa: !!producto && producto.proveedor === 'PROVEEDOR GENERICO' && producto.convertir === true && producto.presentacion === 0.5,
    };
  },
});
