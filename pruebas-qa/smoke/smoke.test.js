'use strict';

/*
 * Los 20 smoke tests — cada uno llama la función REAL del backend
 * (cargada por lib/cargar-backend.js), nunca una reimplementación.
 * "EMPÍRICO" aquí significa: se ejecutó el código de producción real
 * contra un entorno emulado, no una simulación de su lógica.
 */

const { prueba, saltar } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase } = require('../lib/datos-prueba');

function entornoConLogin(rolCorreo) {
  const entorno = crearEntorno({ hojas: hojasBase() });
  const token = entorno.invocar('crearSesion_', rolCorreo.correo, rolCorreo.nombre, rolCorreo.rol);
  return { entorno, token };
}

prueba({
  id: '001', grupo: 'smoke', nombre: 'Login correcto', metodo: 'EMPÍRICO',
  objetivo: 'validarUsuario debe aceptar credenciales correctas y devolver token+rol',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const usuarios = entorno.leerHoja('USUARIOS');
    usuarios[1][2] = '1234'; // admin@tagers.com en texto plano, se migra a hash al validar
    const r = entorno.invocar('validarUsuario', 'admin@tagers.com', '1234');
    return {
      datos: 'correo=admin@tagers.com, password=1234',
      esperado: 'ok:true, rol:ADMIN',
      obtenido: `ok:${r.ok}, rol:${r.rol}`,
      pasa: r.ok === true && r.rol === 'ADMIN' && !!r.token,
    };
  },
});

prueba({
  id: '002', grupo: 'smoke', nombre: 'Login incorrecto', metodo: 'EMPÍRICO',
  objetivo: 'validarUsuario debe rechazar una contraseña incorrecta',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    entorno.leerHoja('USUARIOS')[1][2] = '1234';
    const r = entorno.invocar('validarUsuario', 'admin@tagers.com', 'password-equivocada');
    return {
      datos: 'correo=admin@tagers.com, password=password-equivocada',
      esperado: 'ok:false',
      obtenido: `ok:${r.ok}`,
      pasa: r.ok === false,
    };
  },
});

prueba({
  id: '003', grupo: 'smoke', nombre: 'Crear entrada', metodo: 'EMPÍRICO',
  objetivo: 'guardarEntradaApp debe sumar a la existencia y generar Kardex',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'operador@tagers.com', nombre: 'Op', rol: 'OPERADOR' });
    entorno.invocar('guardarEntradaApp', { codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 20, udm: 'KG', token });
    const existencia = entorno.leerHoja('MATRIZ')[1][10];
    const filasKardex = entorno.leerHoja('KARDEX').length - 1;
    return {
      datos: 'existencia inicial=100, entrada=20',
      esperado: 'existencia=120, 1 fila nueva en Kardex',
      obtenido: `existencia=${existencia}, filasKardex=${filasKardex}`,
      pasa: existencia === 120 && filasKardex === 1,
    };
  },
});

prueba({
  id: '004', grupo: 'smoke', nombre: 'Crear salida', metodo: 'EMPÍRICO',
  objetivo: 'registrarSalidaApp debe restar de la existencia y generar Kardex',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'operador@tagers.com', nombre: 'Op', rol: 'OPERADOR' });
    entorno.invocar('registrarSalidaApp', { codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 20, udm: 'KG', token });
    const existencia = entorno.leerHoja('MATRIZ')[1][10];
    return {
      datos: 'existencia inicial=100, salida=20',
      esperado: 'existencia=80',
      obtenido: `existencia=${existencia}`,
      pasa: existencia === 80,
    };
  },
});

prueba({
  id: '005', grupo: 'smoke', nombre: 'Salida con stock insuficiente', metodo: 'EMPÍRICO',
  objetivo: 'registrarSalidaApp debe bloquear una salida mayor a la existencia disponible',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'operador@tagers.com', nombre: 'Op', rol: 'OPERADOR' });
    // COD-002 (AZUCAR) tiene existencia=5 en el fixture
    let bloqueado = false, mensaje = '';
    try {
      entorno.invocar('registrarSalidaApp', { codigo: 'COD-002', producto: 'AZUCAR ESTANDAR', cantidad: 20, udm: 'KG', token });
    } catch (e) { bloqueado = true; mensaje = e.message; }
    return {
      datos: 'existencia=5, intenta salida=20',
      esperado: 'bloqueado con "Existencia insuficiente"',
      obtenido: bloqueado ? mensaje : 'NO bloqueado',
      pasa: bloqueado && /insuficiente/i.test(mensaje),
    };
  },
});

prueba({
  id: '006', grupo: 'smoke', nombre: 'CONSULTA intenta Configuración', metodo: 'EMPÍRICO',
  objetivo: 'requerirNoConsultaApp_ (vía migrarCostoUnitarioAPorUnidadApp) debe bloquear a CONSULTA',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'consulta@tagers.com', nombre: 'C', rol: 'CONSULTA' });
    let bloqueado = false;
    try { entorno.invocar('migrarCostoUnitarioAPorUnidadApp', token); } catch (e) { bloqueado = true; }
    return {
      datos: 'rol=CONSULTA', esperado: 'bloqueado', obtenido: bloqueado ? 'bloqueado' : 'permitido',
      pasa: bloqueado,
    };
  },
});

prueba({
  id: '007', grupo: 'smoke', nombre: 'SUPERVISOR intenta Operaciones', metodo: 'EMPÍRICO',
  objetivo: 'requerirAccesoOperacionesApp_ (vía guardarEntradaApp) debe bloquear a SUPERVISOR',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'supervisor@tagers.com', nombre: 'S', rol: 'SUPERVISOR' });
    let bloqueado = false;
    try { entorno.invocar('guardarEntradaApp', { codigo: 'COD-001', producto: 'X', cantidad: 1, udm: 'KG', token }); }
    catch (e) { bloqueado = true; }
    return { datos: 'rol=SUPERVISOR', esperado: 'bloqueado', obtenido: bloqueado ? 'bloqueado' : 'permitido', pasa: bloqueado };
  },
});

prueba({
  id: '008', grupo: 'smoke', nombre: 'Generación de folio de conteo', metodo: 'EMPÍRICO',
  objetivo: 'generarConteoRacksApp debe crear un folio con el formato CC-AAAAMMDD-###',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const r = entorno.invocar('generarConteoRacksApp', ['A'], token);
    return {
      datos: 'racks=["A"]', esperado: 'folio con formato CC-YYYYMMDD-001',
      obtenido: r.folio,
      pasa: /^CC-\d{8}-\d{3}$/.test(r.folio),
    };
  },
});

prueba({
  id: '009', grupo: 'smoke', nombre: 'Conteo con diferencia', metodo: 'EMPÍRICO',
  objetivo: 'guardarConteoFisico debe calcular la diferencia y marcar el estado DIFERENCIA',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    // fila 2 de CONTEO_CICLICO (1-index) = primera fila de datos
    entorno.hojas.CONTEO_CICLICO._filas().push(['CC-1', new Date(), 'Admin', 'COD-001', 'HARINA', 'A-01', 100, '', '', 'PENDIENTE', 'A']);
    entorno.invocar('guardarConteoFisico', 2, 97);
    const fila = entorno.leerHoja('CONTEO_CICLICO')[1];
    return {
      datos: 'sistema=100, físico=97',
      esperado: 'diferencia=-3, estado=DIFERENCIA',
      obtenido: `diferencia=${fila[8]}, estado=${fila[9]}`,
      pasa: fila[8] === -3 && fila[9] === 'DIFERENCIA',
    };
  },
});

prueba({
  id: '010', grupo: 'smoke', nombre: 'Aprobar discrepancia actualiza MATRIZ', metodo: 'EMPÍRICO',
  objetivo: 'aprobarDiscrepancia debe aplicar el ajuste a la existencia real (bug corregido en Fase 2)',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    entorno.hojas.DISCREPANCIAS._filas().push([new Date(), 'CC-1', 'COD-001', 'HARINA', 'A-01', 100, 97, -3, 'A', 'PENDIENTE', '', '', '', '']);
    entorno.invocar('aprobarDiscrepancia', 2, 'CONTEO_FISICO', 'ajuste de prueba', undefined);
    const existencia = entorno.leerHoja('MATRIZ')[1][10];
    return {
      datos: 'MATRIZ inicial=100, discrepancia=-3',
      esperado: 'MATRIZ=97',
      obtenido: `MATRIZ=${existencia}`,
      pasa: existencia === 97,
    };
  },
});

prueba({
  id: '011', grupo: 'smoke', nombre: 'Crear orden de compra', metodo: 'EMPÍRICO',
  objetivo: 'generarOrdenCompraApp debe crear folio único y líneas en DETALLE_OC',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const r = entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR GENERICO', 'prueba', [
      { codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 10, udm: 'KG', precio: 15 },
      { codigo: 'COD-002', producto: 'AZUCAR ESTANDAR', cantidad: 5, udm: 'KG', precio: 20 },
    ], token);
    return {
      datos: '2 productos', esperado: 'folio OC-..., 2 productos',
      obtenido: `folio=${r.folio}, productos=${r.productos}`,
      pasa: /^OC-\d{8}-\d{3}$/.test(r.folio) && r.productos === 2,
    };
  },
});

prueba({
  id: '012', grupo: 'smoke', nombre: 'Agregar producto a OC existente (persistencia de selección)', metodo: 'SKIP',
  objetivo: 'Esta prueba es de ESTADO DE FRONTEND (index.html), no de backend — no puede correr en esta suite basada en Apps Script.',
  ejecutar() { saltar('Prueba de frontend (JS de index.html) — cubierta por Playwright en check_oc_persist.js, fuera del alcance de esta suite de backend.'); },
});

prueba({
  id: '013', grupo: 'smoke', nombre: 'Recibir OC (topa a lo pedido)', metodo: 'EMPÍRICO',
  objetivo: 'registrarRecepcionOCApp no debe permitir recibir más de lo pedido',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const oc = entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR GENERICO', '', [
      { codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 10, udm: 'KG', precio: 15 },
    ], token);
    entorno.invocar('registrarRecepcionOCApp', oc.folio, [
      { codigo: 'COD-001', cantidadRecibida: 15 }, // intenta recibir MÁS de lo pedido (10)
    ], token);
    const detalle = entorno.invocar('obtenerDetalleOCApp', oc.folio, token);
    const recibido = detalle.items[0].recibido;
    return {
      datos: 'pedido=10, intenta recibir=15',
      esperado: 'recibido=10 (topado)',
      obtenido: `recibido=${recibido}`,
      pasa: recibido === 10,
    };
  },
});

prueba({
  id: '014', grupo: 'smoke', nombre: 'Crear requisición (área del servidor)', metodo: 'EMPÍRICO',
  objetivo: 'crearRequisicionApp debe tomar el área del usuario desde USUARIOS, no del cliente',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    const r = entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-001', producto: 'HARINA', unidad: 'KG', solicitado: 5 }], token);
    const fila = entorno.leerHoja('REQUISICIONES')[1];
    return {
      datos: 'usuario=cocina@tagers.com (área=Cocina en USUARIOS)',
      esperado: 'área de la requisición = Cocina',
      obtenido: `área=${fila[2]}`,
      pasa: fila[2] === 'Cocina',
    };
  },
});

prueba({
  id: '015', grupo: 'smoke', nombre: 'Usuario de otra área lee folio ajeno (IDOR)', metodo: 'EMPÍRICO',
  objetivo: 'obtenerDetalleRequisicionApp debe bloquear leer una requisición de otra área (bug corregido en Fase 1)',
  ejecutar() {
    const { entorno, token: tokenCocina } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    const req = entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-001', producto: 'HARINA', unidad: 'KG', solicitado: 5 }], tokenCocina);
    const tokenPanaderia = entorno.invocar('crearSesion_', 'panaderia@tagers.com', 'Panadería', 'OPERADOR');
    let bloqueado = false;
    try { entorno.invocar('obtenerDetalleRequisicionApp', req.folio, tokenPanaderia); }
    catch (e) { bloqueado = true; }
    return {
      datos: 'Panadería intenta leer folio de Cocina',
      esperado: 'bloqueado', obtenido: bloqueado ? 'bloqueado' : 'FUGA: detalle devuelto',
      pasa: bloqueado,
    };
  },
});

prueba({
  id: '016', grupo: 'smoke', nombre: 'Entregar requisición', metodo: 'EMPÍRICO',
  objetivo: 'confirmarEntregaRequisicionApp debe descontar existencia vía la ruta central de salida',
  ejecutar() {
    const { entorno, token: tokenCocina } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    const req = entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-001', producto: 'HARINA DE TRIGO', unidad: 'KG', solicitado: 10 }], tokenCocina);
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    entorno.invocar('confirmarEntregaRequisicionApp', req.folio, [{ codigo: 'COD-001', cantidadEntregada: 10 }], tokenAdmin);
    const existencia = entorno.leerHoja('MATRIZ')[1][10];
    return {
      datos: 'existencia inicial=100, entrega=10',
      esperado: 'existencia=90',
      obtenido: `existencia=${existencia}`,
      pasa: existencia === 90,
    };
  },
});

prueba({
  id: '017', grupo: 'smoke', nombre: 'Requisición de receta: conversión G/KG', metodo: 'EMPÍRICO',
  objetivo: 'obtenerCalculoIngredientesRequisicionApp debe convertir 500 G a 0.5 KG antes de sugerir la entrega (bug corregido en Fase 3)',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    entorno.hojas.RECETAS._filas().push(['SALSA X', 'HARINA DE TRIGO', 500, 'G', '1 tanda', 'GENERAL', 'ACTIVA']);
    const tokenCocina = entorno.invocar('crearSesion_', 'cocina@tagers.com', 'Cocina', 'OPERADOR');
    const req = entorno.invocar('crearRequisicionRecetaApp', '', [{ codigoReceta: 'REC-0001', cantidadSolicitada: 1 }], tokenCocina);
    const calculo = entorno.invocar('obtenerCalculoIngredientesRequisicionApp', req.folio, tokenCocina);
    const ing = calculo.ingredientes.find(i => i.nombre === 'HARINA DE TRIGO');
    return {
      datos: 'receta: 500 G de HARINA (MATRIZ la controla en KG)',
      esperado: 'necesario/sugerido = 0.5 KG',
      obtenido: `necesario=${ing.necesario} ${ing.udm}`,
      pasa: ing.necesario === 0.5 && ing.udm === 'KG',
    };
  },
});

prueba({
  id: '018', grupo: 'smoke', nombre: 'Cerrar lote de producción', metodo: 'EMPÍRICO',
  objetivo: 'cerrarLoteProduccionApp debe marcar el lote AGOTADO y cantidad disponible en 0',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    entorno.hojas.PRODUCCION._filas().push(['PROD-1', new Date(), '', 'REC-1', 'X', 'COD-001', 'HARINA', '', 10, 'KG', 10, 'ACTIVO', 'A', '']);
    entorno.invocar('cerrarLoteProduccionApp', 'PROD-1', token);
    const fila = entorno.leerHoja('PRODUCCION')[1];
    return {
      datos: 'lote PROD-1, cantidad disponible=10',
      esperado: 'estado=AGOTADO, cantidad disponible=0',
      obtenido: `estado=${fila[11]}, cantidad=${fila[10]}`,
      pasa: fila[11] === 'AGOTADO' && fila[10] === 0,
    };
  },
});

prueba({
  id: '019', grupo: 'smoke', nombre: 'Buscar movimiento en Kardex', metodo: 'EMPÍRICO',
  objetivo: 'obtenerKardex debe devolver las últimas N filas, más recientes primero',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const kardex = entorno.hojas.KARDEX._filas();
    for (let i = 1; i <= 5; i++) {
      kardex.push([new Date(), '10:00:00', 'ENTRADA', 'ENT-' + i, 'COD-00' + i, 'Producto ' + i, 1, 0, 0, 1, 'Usuario', '']);
    }
    const r = entorno.invocar('obtenerKardex', 3);
    return {
      datos: '5 movimientos en Kardex, límite=3',
      esperado: '3 filas, la más reciente (folio ENT-5) primero',
      obtenido: `filas=${r.length}, primera=${r[0] && r[0].folio}`,
      pasa: r.length === 3 && r[0].folio === 'ENT-5',
    };
  },
});

prueba({
  id: '020', grupo: 'smoke', nombre: 'Cargar Dashboard', metodo: 'EMPÍRICO',
  objetivo: 'obtenerDashboardMovil debe regresar KPIs correctos sin lanzar error',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const r = entorno.invocar('obtenerDashboardMovil');
    return {
      datos: '5 productos en MATRIZ (1 sin ubicación)',
      esperado: 'productosConUbicacion=4, sinUbicacion=1, sin lanzar excepción',
      obtenido: `productosConUbicacion=${r.productosConUbicacion}, sinUbicacion=${r.sinUbicacion}`,
      pasa: r.productosConUbicacion === 4 && r.sinUbicacion === 1,
    };
  },
});
