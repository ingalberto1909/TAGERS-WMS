'use strict';

/*
 * Requisiciones POR SUCURSAL — el flujo nuevo, aparte del de
 * Requisiciones por Área, que respalda el botón nuevo del sidebar.
 * Mismo criterio ya probado en requisiciones/ (servidor decide el
 * ámbito, nunca el cliente; IDOR cerrado; folio único), pero filtrado
 * por Sucursal en vez de Área, y usando la existencia AISLADA por
 * sucursal (EXISTENCIAS_SUCURSAL) en vez de MATRIZ directo — esta es
 * la prueba de punta a punta de que la fundación de la etapa anterior
 * sirve para algo real.
 */

const { prueba } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase } = require('../lib/datos-prueba');

function entornoConLogin(rolCorreo) {
  const entorno = crearEntorno({ hojas: hojasBase() });
  const token = entorno.invocar('crearSesion_', rolCorreo.correo, rolCorreo.nombre, rolCorreo.rol);
  return { entorno, token };
}

prueba({
  id: 'RS-001', grupo: 'requisiciones-sucursal', nombre: 'Crear requisición toma la sucursal del servidor, no del cliente', metodo: 'EMPÍRICO',
  objetivo: 'crearRequisicionSucursalApp debe usar la Sucursal de USUARIOS (vía obtenerAccesoSucursalApp), igual que crearRequisicionApp ya hace con Área',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'sucursal2@tagers.com', nombre: 'Operador S02', rol: 'OPERADOR' });
    const r = entorno.invocar('crearRequisicionSucursalApp', '', [{ codigo: 'COD-001', producto: 'HARINA', unidad: 'KG', solicitado: 5 }], token);
    const fila = entorno.leerHoja('REQUISICIONES_SUCURSAL')[1];
    return {
      datos: 'usuario sucursal2@tagers.com (Sucursal=S02 en USUARIOS)',
      esperado: 'sucursal de la requisición = S02, folio con prefijo RS-',
      obtenido: `sucursal=${fila[2]}, folio=${r.folio}`,
      pasa: fila[2] === 'S02' && /^RS-\d{4}$/.test(r.folio),
    };
  },
});

prueba({
  id: 'RS-002', grupo: 'requisiciones-sucursal', nombre: 'Un usuario corporativo no puede crear requisición de sucursal', metodo: 'EMPÍRICO',
  objetivo: 'crearRequisicionSucursalApp debe rechazar a un usuario con acceso a TODAS las sucursales — esta pantalla es para pedir a nombre de UNA sucursal',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    let bloqueado = false;
    try { entorno.invocar('crearRequisicionSucursalApp', '', [{ codigo: 'COD-001', producto: 'HARINA', unidad: 'KG', solicitado: 5 }], token); }
    catch (e) { bloqueado = true; }
    return { datos: 'usuario ADMIN (esTodasLasSucursales=true)', esperado: 'bloqueado', obtenido: bloqueado ? 'bloqueado' : 'PERMITIDO', pasa: bloqueado };
  },
});

prueba({
  id: 'RS-003', grupo: 'requisiciones-sucursal', nombre: 'Una sucursal no ve las requisiciones de otra', metodo: 'EMPÍRICO',
  objetivo: 'obtenerRequisicionesSucursalApp debe filtrar por la sucursal del token, igual que obtenerRequisicionesApp filtra por área',
  ejecutar() {
    const { entorno, token: tokenS02 } = entornoConLogin({ correo: 'sucursal2@tagers.com', nombre: 'Operador S02', rol: 'OPERADOR' });
    entorno.invocar('crearRequisicionSucursalApp', '', [{ codigo: 'COD-001', producto: 'HARINA', unidad: 'KG', solicitado: 5 }], tokenS02);
    const tokenS04 = entorno.invocar('crearSesion_', 'sucursal4@tagers.com', 'Operador S04', 'OPERADOR');
    entorno.invocar('crearRequisicionSucursalApp', '', [{ codigo: 'COD-002', producto: 'AZUCAR', unidad: 'KG', solicitado: 2 }], tokenS04);

    const listaS02 = entorno.invocar('obtenerRequisicionesSucursalApp', tokenS02);
    return {
      datos: '1 requisición de S02 + 1 de S04 existen',
      esperado: 'S02 solo ve la suya',
      obtenido: `total=${listaS02.length}, sucursales=${listaS02.map(r => r.sucursal).join(',')}`,
      pasa: listaS02.length === 1 && listaS02[0].sucursal === 'S02',
    };
  },
});

prueba({
  id: 'RS-004', grupo: 'requisiciones-sucursal', nombre: 'IDOR: una sucursal no puede leer el folio de otra', metodo: 'EMPÍRICO',
  objetivo: 'obtenerDetalleRequisicionSucursalApp debe bloquear leer un folio de otra sucursal, mismo criterio que la versión por Área',
  ejecutar() {
    const { entorno, token: tokenS02 } = entornoConLogin({ correo: 'sucursal2@tagers.com', nombre: 'Operador S02', rol: 'OPERADOR' });
    const req = entorno.invocar('crearRequisicionSucursalApp', '', [{ codigo: 'COD-001', producto: 'HARINA', unidad: 'KG', solicitado: 5 }], tokenS02);
    const tokenS04 = entorno.invocar('crearSesion_', 'sucursal4@tagers.com', 'Operador S04', 'OPERADOR');
    let bloqueado = false;
    try { entorno.invocar('obtenerDetalleRequisicionSucursalApp', req.folio, tokenS04); } catch (e) { bloqueado = true; }
    return { datos: 'folio de S02 leído por S04', esperado: 'bloqueado', obtenido: bloqueado ? 'bloqueado' : 'FUGA', pasa: bloqueado };
  },
});

prueba({
  id: 'RS-005', grupo: 'requisiciones-sucursal', nombre: 'El detalle muestra la existencia AISLADA de esa sucursal, no la de MATRIZ', metodo: 'EMPÍRICO',
  objetivo: 'obtenerDetalleRequisicionSucursalApp debe leer la existencia vía obtenerExistenciaSucursal_ contra la sucursal de la requisición, demostrando el aislamiento end-to-end',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'sucursal2@tagers.com', nombre: 'Operador S02', rol: 'OPERADOR' });
    // MATRIZ (S01) tiene 100 de COD-001, pero S02 solo tiene 8 unidades propias.
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 8, 'S02');
    const req = entorno.invocar('crearRequisicionSucursalApp', '', [{ codigo: 'COD-001', producto: 'HARINA DE TRIGO', unidad: 'KG', solicitado: 20 }], token);
    const detalle = entorno.invocar('obtenerDetalleRequisicionSucursalApp', req.folio, token);
    const item = detalle.items[0];
    return {
      datos: 'MATRIZ(S01)=100, S02 propia=8, solicitado=20',
      esperado: 'existencia mostrada=8 (la de S02, no la de MATRIZ), sugerido=min(20,8)=8',
      obtenido: `existencia=${item.existencia}, sugerido=${item.entregarSugerido}`,
      pasa: item.existencia === 8 && item.entregarSugerido === 8,
    };
  },
});

prueba({
  id: 'RS-006', grupo: 'requisiciones-sucursal', nombre: 'Entregar descuenta la sucursal correcta y deja las demás intactas', metodo: 'EMPÍRICO',
  objetivo: 'confirmarEntregaRequisicionSucursalApp debe descontar SOLO la sucursal de la requisición (vía ajustarExistenciaMatrizPorDeltaValidado_ con esa sucursal), sin tocar MATRIZ ni otras sucursales',
  ejecutar() {
    const { entorno, token: tokenS02 } = entornoConLogin({ correo: 'sucursal2@tagers.com', nombre: 'Operador S02', rol: 'OPERADOR' });
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 50, 'S02');
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 30, 'S04'); // otra sucursal, no debe tocarse
    const req = entorno.invocar('crearRequisicionSucursalApp', '', [{ codigo: 'COD-001', producto: 'HARINA DE TRIGO', unidad: 'KG', solicitado: 10 }], tokenS02);

    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    const r = entorno.invocar('confirmarEntregaRequisicionSucursalApp', req.folio, [{ codigo: 'COD-001', cantidadEntregada: 10 }], tokenAdmin);

    const s02 = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S02');
    const s04 = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S04');
    const matrizS01 = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];
    const kardexFilas = entorno.leerHoja('KARDEX').length - 1;

    return {
      datos: 'S02=50 (entrega 10), S04=30 (no debe tocarse), MATRIZ/S01=100 (no debe tocarse)',
      esperado: 'S02=40, S04=30 sin cambio, MATRIZ=100 sin cambio, 1 fila en Kardex',
      obtenido: `productosEntregados=${r.productosEntregados}, S02=${s02}, S04=${s04}, MATRIZ=${matrizS01}, kardex=${kardexFilas}`,
      pasa: r.productosEntregados === 1 && s02 === 40 && s04 === 30 && matrizS01 === 100 && kardexFilas === 1,
    };
  },
});

prueba({
  id: 'RS-007', grupo: 'requisiciones-sucursal', nombre: 'Solo un usuario con acceso a todas las sucursales puede confirmar entregas', metodo: 'EMPÍRICO',
  objetivo: 'confirmarEntregaRequisicionSucursalApp debe bloquear a la propia sucursal que hizo la requisición de autoentregarse',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'sucursal2@tagers.com', nombre: 'Operador S02', rol: 'OPERADOR' });
    const req = entorno.invocar('crearRequisicionSucursalApp', '', [{ codigo: 'COD-001', producto: 'HARINA', unidad: 'KG', solicitado: 5 }], token);
    let bloqueado = false;
    try { entorno.invocar('confirmarEntregaRequisicionSucursalApp', req.folio, [{ codigo: 'COD-001', cantidadEntregada: 5 }], token); }
    catch (e) { bloqueado = true; }
    return { datos: 'S02 intenta autoentregarse', esperado: 'bloqueado', obtenido: bloqueado ? 'bloqueado' : 'PERMITIDO', pasa: bloqueado };
  },
});

prueba({
  id: 'RS-008', grupo: 'requisiciones-sucursal', nombre: 'No se puede requisitar sin ninguna cantidad', metodo: 'EMPÍRICO',
  objetivo: 'crearRequisicionSucursalApp debe rechazar una requisición sin cantidades solicitadas > 0',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'sucursal2@tagers.com', nombre: 'Operador S02', rol: 'OPERADOR' });
    let bloqueado = false;
    try { entorno.invocar('crearRequisicionSucursalApp', '', [{ codigo: 'COD-001', producto: 'HARINA', unidad: 'KG', solicitado: 0 }], token); }
    catch (e) { bloqueado = true; }
    return { datos: 'solicitado=0', esperado: 'bloqueado', obtenido: bloqueado ? 'bloqueado' : 'permitido', pasa: bloqueado };
  },
});

prueba({
  id: 'RS-009', grupo: 'requisiciones-sucursal', nombre: 'El buscador muestra la existencia de LA SUCURSAL del que busca, no de MATRIZ', metodo: 'EMPÍRICO',
  objetivo: 'buscarProductoParaRequisicionSucursalApp debe devolver existencia vía obtenerExistenciaSucursal_ para la sucursal del token, más Mínimo/Máximo del catálogo',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'sucursal2@tagers.com', nombre: 'Operador S02', rol: 'OPERADOR' });
    // MATRIZ(S01) tiene 100 de COD-001 (mínimo=10, máximo=200), pero S02 solo tiene 7 unidades propias.
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 7, 'S02');
    const resultados = entorno.invocar('buscarProductoParaRequisicionSucursalApp', 'harina', token);
    const item = resultados.find(r => r.codigo === 'COD-001');
    return {
      datos: 'MATRIZ(S01)=100, S02 propia=7, mínimo=10, máximo=200',
      esperado: 'existencia=7 (de S02, no 100), minimo=10, maximo=200',
      obtenido: `existencia=${item.existencia}, minimo=${item.minimo}, maximo=${item.maximo}`,
      pasa: item.existencia === 7 && item.minimo === 10 && item.maximo === 200,
    };
  },
});

prueba({
  id: 'RS-010', grupo: 'requisiciones-sucursal', nombre: 'Dos sucursales distintas ven existencias distintas del mismo producto', metodo: 'EMPÍRICO',
  objetivo: 'El aislamiento por sucursal debe reflejarse en el buscador: S02 y S04 ven números distintos para el mismo código',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 15, 'S02');
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 40, 'S04');
    const tokenS02 = entorno.invocar('crearSesion_', 'sucursal2@tagers.com', 'Operador S02', 'OPERADOR');
    const tokenS04 = entorno.invocar('crearSesion_', 'sucursal4@tagers.com', 'Operador S04', 'OPERADOR');

    const resS02 = entorno.invocar('buscarProductoParaRequisicionSucursalApp', 'harina', tokenS02).find(r => r.codigo === 'COD-001');
    const resS04 = entorno.invocar('buscarProductoParaRequisicionSucursalApp', 'harina', tokenS04).find(r => r.codigo === 'COD-001');

    return {
      datos: 'S02=15, S04=40, mismo producto',
      esperado: 'el buscador de S02 muestra 15, el de S04 muestra 40',
      obtenido: `S02 ve=${resS02.existencia}, S04 ve=${resS04.existencia}`,
      pasa: resS02.existencia === 15 && resS04.existencia === 40,
    };
  },
});

prueba({
  id: 'RS-011', grupo: 'requisiciones-sucursal', nombre: 'Fecha requerida se guarda y se devuelve (lista y detalle)', metodo: 'EMPÍRICO',
  objetivo: 'crearRequisicionSucursalApp(observaciones, items, token, fechaRequerida) debe guardar la fecha requerida en la 9na columna nueva de REQUISICIONES_SUCURSAL, igual que el flujo de Área',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'sucursal2@tagers.com', nombre: 'Operador S02', rol: 'OPERADOR' });
    const req = entorno.invocar('crearRequisicionSucursalApp', '', [{ codigo: 'COD-001', producto: 'HARINA', unidad: 'KG', solicitado: 5 }], token, '2026-08-19');
    const lista = entorno.invocar('obtenerRequisicionesSucursalApp', token);
    const detalle = entorno.invocar('obtenerDetalleRequisicionSucursalApp', req.folio, token);
    return {
      datos: 'fechaRequerida="2026-08-19"',
      esperado: 'lista y detalle devuelven fechaRequerida="19/08/2026"',
      obtenido: `lista=${lista[0].fechaRequerida}, detalle=${detalle.fechaRequerida}`,
      pasa: lista[0].fechaRequerida === '19/08/2026' && detalle.fechaRequerida === '19/08/2026',
    };
  },
});

prueba({
  id: 'RS-012', grupo: 'requisiciones-sucursal', nombre: 'Fecha requerida omitida no truena la requisición de sucursal', metodo: 'EMPÍRICO',
  objetivo: 'crearRequisicionSucursalApp sin 4to argumento (compatibilidad con llamadas viejas de 3 args) debe seguir creando el folio, solo sin fechaRequerida',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'sucursal2@tagers.com', nombre: 'Operador S02', rol: 'OPERADOR' });
    const req = entorno.invocar('crearRequisicionSucursalApp', '', [{ codigo: 'COD-001', producto: 'HARINA', unidad: 'KG', solicitado: 1 }], token);
    const detalle = entorno.invocar('obtenerDetalleRequisicionSucursalApp', req.folio, token);
    return {
      datos: '3 args (sin fechaRequerida)',
      esperado: 'folio se crea, fechaRequerida=""',
      obtenido: `folio=${req.folio}, fechaRequerida="${detalle.fechaRequerida}"`,
      pasa: !!req.folio && detalle.fechaRequerida === '',
    };
  },
});
