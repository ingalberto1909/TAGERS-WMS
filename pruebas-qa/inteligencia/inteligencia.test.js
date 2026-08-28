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
    // Fase 7: obtenerLotesProximosACaducarApp ahora lee PRODUCCION vía la
    // caché de 20s — como esta prueba escribe directo a la hoja (sin pasar
    // por registrarProduccionApp, que ya invalida esa caché), hay que
    // invalidarla a mano para que la lectura "después" vea estas filas.
    entorno.invocar('invalidarCacheHoja_', 'PRODUCCION');

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
  objetivo: 'El agregador debe listar OC en PENDIENTE o PARCIAL como "atención" (esperando recepción) solo DESPUÉS de aprobarse (COM-01: ahora nace en PENDIENTE_APROBACION, una categoría de atención distinta — ver INT-005B), y dejar de contarlas en cuanto quedan RECIBIDA — reusando obtenerOrdenesCompraApp sin duplicar su cálculo de estado',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const oc1 = entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR GENERICO', '', [{ codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 10, udm: 'KG', precio: 15 }], token);
    entorno.invocar('aprobarOrdenCompraApp', oc1.folio, token);
    const antes = entorno.invocar('obtenerAccionesRequeridasApp', token);
    const ocAntes = antes.atencion.find(a => a.tipo === 'ordenes-compra');

    entorno.invocar('registrarRecepcionOCApp', oc1.folio, [{ codigo: 'COD-001', cantidadRecibida: 10 }], token);
    const despues = entorno.invocar('obtenerAccionesRequeridasApp', token);
    const ocDespues = despues.atencion.find(a => a.tipo === 'ordenes-compra');

    return {
      datos: `${oc1.folio}: aprobada (PENDIENTE), luego recibida por completo (RECIBIDA)`,
      esperado: 'antes de recibir: 1 OC pendiente en atención. Después de recibirla completa: ya no aparece',
      obtenido: `antes=${ocAntes ? ocAntes.cantidad : 0}, despues=${ocDespues ? ocDespues.cantidad : 0}`,
      pasa: !!ocAntes && ocAntes.cantidad === 1 && !ocDespues,
    };
  },
});

prueba({
  id: 'INT-005B', grupo: 'inteligencia', nombre: 'COM-01: una OC sin aprobar aparece en su propia categoría de atención, no en "esperando recepción"', metodo: 'EMPÍRICO',
  objetivo: 'obtenerAccionesRequeridasApp debe distinguir "sin aprobar" (PENDIENTE_APROBACION) de "esperando recepción" (PENDIENTE/PARCIAL) — una OC recién generada no debe aparecer en ambas a la vez',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const oc1 = entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR GENERICO', '', [{ codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 10, udm: 'KG', precio: 15 }], token);

    const antes = entorno.invocar('obtenerAccionesRequeridasApp', token);
    const porAprobarAntes = antes.atencion.find(a => a.tipo === 'ordenes-compra-por-aprobar');
    const porRecibirAntes = antes.atencion.find(a => a.tipo === 'ordenes-compra');

    entorno.invocar('aprobarOrdenCompraApp', oc1.folio, token);
    const despues = entorno.invocar('obtenerAccionesRequeridasApp', token);
    const porAprobarDespues = despues.atencion.find(a => a.tipo === 'ordenes-compra-por-aprobar');
    const porRecibirDespues = despues.atencion.find(a => a.tipo === 'ordenes-compra');

    return {
      datos: `${oc1.folio}: recién generada (PENDIENTE_APROBACION), luego aprobada (PENDIENTE)`,
      esperado: 'antes: 1 en "por aprobar", 0 en "esperando recepción". Después de aprobar: 0 en "por aprobar", 1 en "esperando recepción"',
      obtenido: `antes: porAprobar=${porAprobarAntes ? porAprobarAntes.cantidad : 0}, porRecibir=${porRecibirAntes ? porRecibirAntes.cantidad : 0} | después: porAprobar=${porAprobarDespues ? porAprobarDespues.cantidad : 0}, porRecibir=${porRecibirDespues ? porRecibirDespues.cantidad : 0}`,
      pasa: !!porAprobarAntes && porAprobarAntes.cantidad === 1 && !porRecibirAntes && !porAprobarDespues && !!porRecibirDespues && porRecibirDespues.cantidad === 1,
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

/*
 * TAGERS WMS 2.0 — Fase 2 (Inteligencia de inventario).
 * Cubre obtenerCoberturaInventarioApp / obtenerResumenCoberturaApp:
 * consumo promedio (ventana de KARDEX), días de cobertura, clasificación
 * de riesgo con umbrales configurables, y reutilización de
 * calcularValorInventario_ para el valor monetario. Alcance: MATRIZ/S01
 * únicamente (ver nota en Inteligencia.gs) — no se prueba nada de
 * sucursal porque el propio código no distingue destino en KARDEX.
 */

function agregarSalidaKardex_(entorno, fecha, codigo, producto, salida) {
  entorno.leerHoja('KARDEX').push([fecha, '10:00:00', 'SALIDA', 'F-TEST', codigo, producto, 0, salida, 0, 0, 'Tester', '']);
}

prueba({
  id: 'INT-008', grupo: 'inteligencia', nombre: 'Producto sin ningún consumo en la ventana: sin-consumo, no se inventa un número de días', metodo: 'EMPÍRICO',
  objetivo: 'Cuando consumoPromedioDiario es 0, diasCobertura debe ser null y clasificacion "sin-consumo" — nunca 0 ni Infinity simulando un dato real',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const detalle = entorno.invocar('obtenerCoberturaInventarioApp', token, {});
    const sal = detalle.find(p => p.codigo === 'COD-003');
    return {
      datos: 'COD-003 (SAL DE MESA) sin ninguna fila de SALIDA en KARDEX',
      esperado: 'clasificacion="sin-consumo", diasCobertura=null, consumoPromedioDiario=0',
      obtenido: `clasificacion=${sal.clasificacion}, dias=${sal.diasCobertura}, consumo=${sal.consumoPromedioDiario}`,
      pasa: !!sal && sal.clasificacion === 'sin-consumo' && sal.diasCobertura === null && sal.consumoPromedioDiario === 0,
    };
  },
});

prueba({
  id: 'INT-009', grupo: 'inteligencia', nombre: 'Consumo alto frente a existencia clasifica como crítico', metodo: 'EMPÍRICO',
  objetivo: 'COD-001 (existencia=100) con consumo que arroja menos de 3 días de cobertura debe clasificar "critico"',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const hoy = entorno.crearFechaDesdeHoy(0);
    agregarSalidaKardex_(entorno, hoy, 'COD-001', 'HARINA DE TRIGO', 1200); // 1200/30 = 40/día → 100/40 = 2.5 días
    const detalle = entorno.invocar('obtenerCoberturaInventarioApp', token, {});
    const harina = detalle.find(p => p.codigo === 'COD-001');
    return {
      datos: 'COD-001 existencia=100, Salida=1200 en KARDEX (ventana 30 días por defecto)',
      esperado: 'consumoPromedioDiario=40, diasCobertura=2.5, clasificacion="critico" (umbral por defecto: <3)',
      obtenido: `consumo=${harina.consumoPromedioDiario}, dias=${harina.diasCobertura}, clasificacion=${harina.clasificacion}`,
      pasa: !!harina && harina.consumoPromedioDiario === 40 && harina.diasCobertura === 2.5 && harina.clasificacion === 'critico',
    };
  },
});

prueba({
  id: 'INT-010', grupo: 'inteligencia', nombre: 'Cobertura entre umbral de riesgo y de exceso clasifica como riesgo o normal correctamente', metodo: 'EMPÍRICO',
  objetivo: 'COD-001 con consumo moderado debe caer en "riesgo" (< 7 días) y con consumo más bajo en "normal" (entre 7 y 45 días), sin cruzarse',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const hoy = entorno.crearFechaDesdeHoy(0);
    // 150/30 = 5/día → 100/5 = 20 días... para "riesgo" (<7) necesitamos consumo mayor.
    agregarSalidaKardex_(entorno, hoy, 'COD-001', 'HARINA DE TRIGO', 450); // 450/30=15/día → 100/15=6.67 días (riesgo)
    agregarSalidaKardex_(entorno, hoy, 'COD-003', 'SAL DE MESA', 100); // 100/30=3.33/día → 50/3.33=15 días (normal)
    const detalle = entorno.invocar('obtenerCoberturaInventarioApp', token, {});
    const harina = detalle.find(p => p.codigo === 'COD-001');
    const sal = detalle.find(p => p.codigo === 'COD-003');
    return {
      datos: 'COD-001: 100 existencia / 15 consumo diario ≈ 6.67 días. COD-003: 50 existencia / 3.33 consumo diario = 15 días',
      esperado: 'COD-001 clasifica "riesgo" (<7), COD-003 clasifica "normal" (entre 7 y 45)',
      obtenido: `COD-001=${harina.clasificacion} (${harina.diasCobertura}d), COD-003=${sal.clasificacion} (${sal.diasCobertura}d)`,
      pasa: harina.clasificacion === 'riesgo' && sal.clasificacion === 'normal',
    };
  },
});

prueba({
  id: 'INT-011', grupo: 'inteligencia', nombre: 'Consumo muy bajo frente a existencia clasifica como exceso', metodo: 'EMPÍRICO',
  objetivo: 'COD-001 con consumo que arroja 45 días de cobertura o más debe clasificar "exceso" (nunca recomendarse compra automática — solo etiqueta de revisión)',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const hoy = entorno.crearFechaDesdeHoy(0);
    agregarSalidaKardex_(entorno, hoy, 'COD-001', 'HARINA DE TRIGO', 60); // 60/30=2/día → 100/2=50 días
    const detalle = entorno.invocar('obtenerCoberturaInventarioApp', token, {});
    const harina = detalle.find(p => p.codigo === 'COD-001');
    return {
      datos: 'COD-001 existencia=100, Salida=60 en 30 días → consumo 2/día → 50 días de cobertura',
      esperado: 'clasificacion="exceso" (umbral por defecto: >=45)',
      obtenido: `dias=${harina.diasCobertura}, clasificacion=${harina.clasificacion}`,
      pasa: harina.diasCobertura === 50 && harina.clasificacion === 'exceso',
    };
  },
});

prueba({
  id: 'INT-012', grupo: 'inteligencia', nombre: 'Producto sin ubicación (temporada) se excluye de cobertura, igual que de bajo-mínimo', metodo: 'EMPÍRICO',
  objetivo: 'obtenerCoberturaInventarioApp debe aplicar el mismo filtro ubicacionVacia_ que ya usa obtenerProductosBajoMinimo, para no generar alertas de productos de temporada sin ubicación asignada',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const detalle = entorno.invocar('obtenerCoberturaInventarioApp', token, {});
    return {
      datos: 'COD-005 (PRODUCTO SIN UBICACION) tiene ubicación "--" en el catálogo base',
      esperado: 'COD-005 no aparece en el detalle de cobertura',
      obtenido: `codigos=${detalle.map(p=>p.codigo).join(',')}`,
      pasa: !detalle.some(p => p.codigo === 'COD-005'),
    };
  },
});

prueba({
  id: 'INT-013', grupo: 'inteligencia', nombre: 'Umbrales configurables cambian la clasificación sin tocar código', metodo: 'EMPÍRICO',
  objetivo: 'Pasar umbralRiesgo/umbralCritico distintos en `opciones` debe mover la frontera de clasificación — confirma que no están hardcodeados',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const hoy = entorno.crearFechaDesdeHoy(0);
    agregarSalidaKardex_(entorno, hoy, 'COD-001', 'HARINA DE TRIGO', 450); // 6.67 días de cobertura
    const conDefecto = entorno.invocar('obtenerCoberturaInventarioApp', token, {});
    const conUmbralAmplio = entorno.invocar('obtenerCoberturaInventarioApp', token, { umbralRiesgo: 5 });
    const harinaDefecto = conDefecto.find(p => p.codigo === 'COD-001');
    const harinaAmplio = conUmbralAmplio.find(p => p.codigo === 'COD-001');
    return {
      datos: 'COD-001 con 6.67 días de cobertura; una llamada usa umbralRiesgo por defecto (7), otra pasa umbralRiesgo=5',
      esperado: 'con umbral=7 clasifica "riesgo"; con umbral=5 (6.67 ya no es < 5) clasifica "normal"',
      obtenido: `defecto=${harinaDefecto.clasificacion}, umbralRiesgo=5→${harinaAmplio.clasificacion}`,
      pasa: harinaDefecto.clasificacion === 'riesgo' && harinaAmplio.clasificacion === 'normal',
    };
  },
});

prueba({
  id: 'INT-014', grupo: 'inteligencia', nombre: 'diasHistorial configurable: una venta fuera de la ventana estándar solo cuenta con ventana más amplia', metodo: 'EMPÍRICO',
  objetivo: 'Una SALIDA de hace 40 días no debe contarse con diasHistorial=30 (por defecto) pero sí con diasHistorial=60 — la ventana de consumo es un parámetro, no un valor fijo',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const hace40Dias = entorno.crearFechaDesdeHoy(-40);
    agregarSalidaKardex_(entorno, hace40Dias, 'COD-001', 'HARINA DE TRIGO', 300);
    const ventana30 = entorno.invocar('obtenerCoberturaInventarioApp', token, {});
    const ventana60 = entorno.invocar('obtenerCoberturaInventarioApp', token, { diasHistorial: 60 });
    const harina30 = ventana30.find(p => p.codigo === 'COD-001');
    const harina60 = ventana60.find(p => p.codigo === 'COD-001');
    return {
      datos: 'Única SALIDA de COD-001 fue hace 40 días',
      esperado: 'con ventana de 30 días no se cuenta (sin-consumo); con ventana de 60 días sí se cuenta',
      obtenido: `ventana30=${harina30.clasificacion}, ventana60=${harina60.clasificacion} (consumo=${harina60.consumoPromedioDiario})`,
      pasa: harina30.clasificacion === 'sin-consumo' && harina60.consumoPromedioDiario > 0,
    };
  },
});

prueba({
  id: 'INT-015', grupo: 'inteligencia', nombre: 'obtenerResumenCoberturaApp agrega conteo y valor monetario reutilizando calcularValorInventario_', metodo: 'EMPÍRICO',
  objetivo: 'El resumen debe sumar cantidad y valor por clasificación sin reimplementar el cálculo monetario — el valor de cada bucket debe coincidir con la suma manual de existencia×costo de sus productos',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const resumen = entorno.invocar('obtenerResumenCoberturaApp', token, {});
    // Catálogo base sin ninguna SALIDA: los 4 productos con ubicación (COD-001..004) caen en "sin-consumo".
    // Valor esperado = suma de existencia×costo: COD-001 100×10=1000, COD-002 5×10=50, COD-003 50×10=500, COD-004 12×10=120.
    const esperado = 1000 + 50 + 500 + 120;
    return {
      datos: 'Catálogo base (COD-001..004 con ubicación, sin ninguna SALIDA en KARDEX)',
      esperado: `sin-consumo: cantidad=4, valor=${esperado}`,
      obtenido: `cantidad=${resumen['sin-consumo'].cantidad}, valor=${resumen['sin-consumo'].valor}`,
      pasa: resumen['sin-consumo'].cantidad === 4 && resumen['sin-consumo'].valor === esperado,
    };
  },
});
