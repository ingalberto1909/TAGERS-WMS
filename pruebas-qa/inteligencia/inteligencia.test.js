'use strict';

/*
 * TAGERS WMS 2.0 — Fase 1 (Dashboard accionable).
 * Cubre el agregador obtenerAccionesRequeridasApp y sus dos helpers
 * nuevos (transferencias pendientes, lotes de producción por caducar).
 * Es una capa 100% de lectura sobre datos que ya prueban sus propios
 * módulos (requisiciones, requisiciones-sucursal, compras) — aquí solo
 * se valida la CLASIFICACIÓN (urgente/atención/revisar) y el scoping
 * por rol, no se vuelve a probar la lógica de negocio de esos módulos.
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
  id: 'INT-001', grupo: 'inteligencia', nombre: 'Agotados van a urgente, bajo mínimo va a atención', metodo: 'EMPÍRICO',
  objetivo: 'obtenerAccionesRequeridasApp debe separar productos con existencia 0 (urgente) de productos solo bajo mínimo (atención), reusando obtenerProductosBajoMinimo sin duplicar su criterio',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    // El catálogo base ya trae COD-002 bajo mínimo (existencia=5, mínimo=10);
    // se agrega un agotado real (existencia=0, con ubicación válida) mutando
    // COD-003 directamente, mismo patrón ya usado en otras pruebas de esta
    // suite (ver COM-015, RS-022) para simular un estado sin rehacer el flujo completo.
    entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-003')[10] = 0;
    const acciones = entorno.invocar('obtenerAccionesRequeridasApp', token);
    const agotados = acciones.urgente.find(a => a.tipo === 'agotados');
    const bajos = acciones.atencion.find(a => a.tipo === 'bajo-minimo');
    return {
      datos: 'COD-002 bajo mínimo (5/10) de fábrica; COD-003 mutado a existencia=0 (agotado)',
      esperado: 'agotados aparece en "urgente", bajo-mínimo aparece en "atencion", ninguno se mezcla',
      obtenido: `urgente.agotados=${agotados ? agotados.cantidad : 'ausente'}, atencion.bajoMinimo=${bajos ? bajos.cantidad : 'ausente'}`,
      pasa: !!agotados && agotados.cantidad > 0 && !!bajos && bajos.cantidad > 0
        && !acciones.urgente.some(a => a.tipo === 'bajo-minimo') && !acciones.atencion.some(a => a.tipo === 'agotados'),
    };
  },
});

prueba({
  id: 'INT-002', grupo: 'inteligencia', nombre: 'Un operador de área solo ve inventario, no operación entre módulos', metodo: 'EMPÍRICO',
  objetivo: 'obtenerAccionesRequeridasApp debe aplicar el mismo criterio de acceso que ya usa obtenerNotificacionesApp: solo Admin/Almacén ven discrepancias/conteos/requisiciones/OC/transferencias/caducidades',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Operador Cocina', rol: 'OPERADOR' });
    const acciones = entorno.invocar('obtenerAccionesRequeridasApp', token);
    const soloInventario = acciones.atencion.every(a => a.tipo === 'bajo-minimo')
      && acciones.revisar.length === 0
      && acciones.urgente.every(a => a.tipo === 'agotados');
    return {
      datos: 'token de OPERADOR de área (Cocina), no Admin/Almacén',
      esperado: 'atencion y urgente solo contienen inventario; revisar viene vacío (nada de conteos/caducidades)',
      obtenido: `tipos.urgente=${acciones.urgente.map(a=>a.tipo).join(',')}, tipos.atencion=${acciones.atencion.map(a=>a.tipo).join(',')}, revisar=${acciones.revisar.length}`,
      pasa: soloInventario,
    };
  },
});

prueba({
  id: 'INT-003', grupo: 'inteligencia', nombre: 'Transferencia EN_TRANSITO aparece pendiente; una ya RECIBIDA no', metodo: 'EMPÍRICO',
  objetivo: 'obtenerTransferenciasPendientesApp y el agregador deben listar solo transferencias EN_TRANSITO, generadas por el pipeline real de Requisiciones por Sucursal',
  ejecutar() {
    const { entorno, token: tokenS02 } = entornoConLogin({ correo: 'sucursal2@tagers.com', nombre: 'Operador S02', rol: 'OPERADOR' });
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');

    const req = entorno.invocar('crearRequisicionSucursalApp', '', [{ codigo: 'COD-001', producto: 'HARINA DE TRIGO', unidad: 'KG', solicitado: 10 }], tokenS02);
    entorno.invocar('aprobarLineaRequisicionSucursalApp', req.folio, [{ codigo: 'COD-001', cantidadAprobada: 10 }], tokenAdmin);
    entorno.invocar('surtirRequisicionSucursalApp', req.folio, [{ codigo: 'COD-001', cantidadSurtida: 10 }], tokenAdmin);
    const despacho = entorno.invocar('despacharRequisicionSucursalApp', req.folio, tokenAdmin);

    const pendientesTrasDespacho = entorno.invocar('obtenerTransferenciasPendientesApp', tokenAdmin);
    const acciones1 = entorno.invocar('obtenerAccionesRequeridasApp', tokenAdmin);
    const transfEnAcciones1 = acciones1.atencion.find(a => a.tipo === 'transferencias');

    entorno.invocar('recibirTransferenciaSucursalApp', despacho.folioTransferencia, [{ codigo: 'COD-001', cantidadRecibida: 10 }], tokenS02);
    const pendientesTrasRecibir = entorno.invocar('obtenerTransferenciasPendientesApp', tokenAdmin);

    return {
      datos: `${despacho.folioTransferencia}: recién despachada, luego recibida por completo`,
      esperado: 'tras despachar: 1 pendiente (y aparece en acciones.atencion); tras recibir: 0 pendientes',
      obtenido: `trasDespacho=${pendientesTrasDespacho.length}, enAcciones=${transfEnAcciones1 ? transfEnAcciones1.cantidad : 0}, trasRecibir=${pendientesTrasRecibir.length}`,
      pasa: pendientesTrasDespacho.length === 1 && !!transfEnAcciones1 && transfEnAcciones1.cantidad === 1 && pendientesTrasRecibir.length === 0,
    };
  },
});

prueba({
  id: 'INT-004', grupo: 'inteligencia', nombre: 'Lotes por caducar: umbral de días y exclusión de AGOTADO', metodo: 'EMPÍRICO',
  objetivo: 'obtenerLotesProximosACaducarApp debe incluir solo lotes con existencia disponible, no AGOTADOS, dentro del umbral de días — nunca inventar caducidad para mercancía comprada (solo PRODUCCION la tiene)',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });

    // Dispara la creación perezosa de la hoja PRODUCCION antes de insertar filas a mano.
    const antes = entorno.invocar('obtenerLotesProximosACaducarApp', token, 7);

    // Las fechas se construyen DENTRO del mismo realm de vm que corre el
    // backend (entorno.crearFechaDesdeHoy) — un Date armado con el Date
    // normal de Node es un realm distinto y "instanceof Date" fallaría en
    // silencio dentro del código real, excluyendo la fila sin avisar.
    const hoy = entorno.crearFechaDesdeHoy(0);
    const en3Dias = entorno.crearFechaDesdeHoy(3);
    const en30Dias = entorno.crearFechaDesdeHoy(30);
    const en2DiasAgotado = entorno.crearFechaDesdeHoy(2);

    const produccion = entorno.leerHoja('PRODUCCION');
    produccion.push(['LOTE-001', hoy, en3Dias, '', '', 'PROD-A', 'PASTEL DE CHOCOLATE', '', 10, 'PZA', 10, 'ACTIVO', 'Tester', '']);
    produccion.push(['LOTE-002', hoy, en30Dias, '', '', 'PROD-B', 'GALLETAS', '', 5, 'PZA', 5, 'ACTIVO', 'Tester', '']);
    produccion.push(['LOTE-003', hoy, en2DiasAgotado, '', '', 'PROD-C', 'PAN DULCE', '', 8, 'PZA', 3, 'AGOTADO', 'Tester', '']);

    const despues = entorno.invocar('obtenerLotesProximosACaducarApp', token, 7);
    const acciones = entorno.invocar('obtenerAccionesRequeridasApp', token);
    const caducidadesEnAcciones = acciones.revisar.find(a => a.tipo === 'caducidades');

    return {
      datos: 'LOTE-001 caduca en 3 días (activo), LOTE-002 en 30 días (activo, fuera del umbral de 7), LOTE-003 en 2 días pero AGOTADO',
      esperado: 'antes de insertar: 0 lotes. Después: exactamente 1 (LOTE-001) — ni el de 30 días ni el AGOTADO aparecen',
      obtenido: `antes=${antes.length}, despues=${despues.length}, folios=${despues.map(l=>l.folio).join(',')}, enAcciones=${caducidadesEnAcciones ? caducidadesEnAcciones.cantidad : 0}`,
      pasa: antes.length === 0 && despues.length === 1 && despues[0].folio === 'LOTE-001' && !!caducidadesEnAcciones && caducidadesEnAcciones.cantidad === 1,
    };
  },
});

prueba({
  id: 'INT-005', grupo: 'inteligencia', nombre: 'Órdenes de compra PENDIENTE/PARCIAL cuentan como pendientes; RECIBIDA no', metodo: 'EMPÍRICO',
  objetivo: 'El agregador debe listar OC en PENDIENTE o PARCIAL como "atención", y dejar de contarlas en cuanto quedan RECIBIDA — reusando obtenerOrdenesCompraApp sin duplicar su cálculo de estado',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const oc1 = entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR GENERICO', '', [{ codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 10, udm: 'KG', precio: 15 }], token);
    const antes = entorno.invocar('obtenerAccionesRequeridasApp', token);
    const ocAntes = antes.atencion.find(a => a.tipo === 'ordenes-compra');

    entorno.invocar('registrarRecepcionOCApp', oc1.folio, [{ codigo: 'COD-001', cantidadRecibida: 10 }], token);
    const despues = entorno.invocar('obtenerAccionesRequeridasApp', token);
    const ocDespues = despues.atencion.find(a => a.tipo === 'ordenes-compra');

    return {
      datos: `${oc1.folio}: PENDIENTE, luego recibida por completo (RECIBIDA)`,
      esperado: 'antes de recibir: 1 OC pendiente en atención. Después de recibirla completa: ya no aparece',
      obtenido: `antes=${ocAntes ? ocAntes.cantidad : 0}, despues=${ocDespues ? ocDespues.cantidad : 0}`,
      pasa: !!ocAntes && ocAntes.cantidad === 1 && !ocDespues,
    };
  },
});

prueba({
  id: 'INT-006', grupo: 'inteligencia', nombre: 'Requisiciones de área y de sucursal PENDIENTE se listan por separado', metodo: 'EMPÍRICO',
  objetivo: 'El agregador debe distinguir requisiciones de Área (tipo requisiciones-area) de las de Sucursal (tipo requisiciones-sucursal), sin mezclar sus conteos',
  ejecutar() {
    const { entorno, token: tokenCocina } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    const tokenS02 = entorno.invocar('crearSesion_', 'sucursal2@tagers.com', 'Operador S02', 'OPERADOR');

    entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-001', producto: 'HARINA DE TRIGO', unidad: 'KG', solicitado: 5 }], tokenCocina);
    entorno.invocar('crearRequisicionSucursalApp', '', [{ codigo: 'COD-002', producto: 'AZUCAR ESTANDAR', unidad: 'KG', solicitado: 3 }], tokenS02);

    const acciones = entorno.invocar('obtenerAccionesRequeridasApp', tokenAdmin);
    const area = acciones.atencion.find(a => a.tipo === 'requisiciones-area');
    const sucursal = acciones.atencion.find(a => a.tipo === 'requisiciones-sucursal');

    return {
      datos: '1 requisición de Área (Cocina) + 1 de Sucursal (S02), ambas PENDIENTE',
      esperado: 'ambos tipos aparecen con cantidad=1 cada uno, en tarjetas separadas',
      obtenido: `area=${area ? area.cantidad : 0}, sucursal=${sucursal ? sucursal.cantidad : 0}`,
      pasa: !!area && area.cantidad === 1 && !!sucursal && sucursal.cantidad === 1,
    };
  },
});

prueba({
  id: 'INT-007', grupo: 'inteligencia', nombre: 'Sin discrepancias pendientes, no se genera ninguna tarjeta de discrepancias', metodo: 'EMPÍRICO',
  objetivo: 'El agregador no debe inventar una tarjeta de discrepancias cuando obtenerContadoresControl().discrepancias es 0 — no rellenar con ceros ni datos falsos',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const acciones = entorno.invocar('obtenerAccionesRequeridasApp', token);
    return {
      datos: 'catálogo base de pruebas, sin filas en DISCREPANCIAS con Estado=PENDIENTE',
      esperado: 'ninguna tarjeta con tipo="discrepancias" en atencion',
      obtenido: `tipos.atencion=${acciones.atencion.map(a=>a.tipo).join(',')}`,
      pasa: !acciones.atencion.some(a => a.tipo === 'discrepancias'),
    };
  },
});
