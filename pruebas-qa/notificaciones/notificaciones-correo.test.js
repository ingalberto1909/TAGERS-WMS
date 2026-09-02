'use strict';

/*
 * FASE de rendimiento/escalabilidad del pedido del usuario, punto 3:
 * notificaciones automáticas por correo — conteos cíclicos de hoy (uno
 * por responsable) y stock crítico (solo al CRUZAR el mínimo, no en cada
 * pasada). Ninguna de las dos manda correo de verdad aquí (MailApp está
 * inerte en el emulador — ver lib/emulador-gas.js), así que estas pruebas
 * verifican la lógica real: a quién le toca, a qué correo se resuelve, y
 * cuándo SÍ/NO se debe avisar — no el contenido del correo en sí.
 */

const { prueba } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase } = require('../lib/datos-prueba');

const DIAS_SEMANA_ = ["DOMINGO", "LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO"];
const DIA_HOY_ = DIAS_SEMANA_[new Date().getDay()];

prueba({
  id: 'NOTIFCORREO-001', grupo: 'notificaciones', nombre: 'Aviso de conteos hoy: agrupa por responsable y resuelve su correo por nombre', metodo: 'EMPÍRICO',
  objetivo: 'enviarAvisoConteosHoyApp_ debe juntar en un solo aviso los racks de un mismo responsable (no uno por rack), resolviendo el nombre libre de PROGRAMACION_CONTEOS contra USUARIOS sin importar mayúsculas/acentos',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const prog = entorno.leerHoja('PROGRAMACION_CONTEOS');
    // "admin prueba" (minúsculas, sin acento en "Admin") debe emparejar con "Admin Prueba" de USUARIOS.
    prog.push(['PC-0001', 'A01', DIA_HOY_, 'SEMANAL', 'admin prueba', 'ACTIVO', '']);
    prog.push(['PC-0002', 'B01', DIA_HOY_, 'SEMANAL', 'admin prueba', 'ACTIVO', '']);
    prog.push(['PC-0003', 'C01', DIA_HOY_, 'SEMANAL', 'Nombre Que No Existe', 'ACTIVO', '']);

    const resultado = entorno.invocar('enviarAvisoConteosHoyApp_');

    return {
      datos: '2 racks (A01, B01) para "admin prueba" (existe en USUARIOS como "Admin Prueba"), 1 rack (C01) para un nombre que no existe',
      esperado: '1 solo correo enviado (agrupado, no 2 sueltos) para admin prueba; "Nombre Que No Existe" queda reportado en sinCorreo, no rompe el aviso',
      obtenido: `enviados=${resultado.enviados}, sinCorreo=[${resultado.sinCorreo.join(', ')}]`,
      pasa: resultado.enviados === 1 && resultado.sinCorreo.length === 1 && resultado.sinCorreo[0] === 'Nombre Que No Existe',
    };
  },
});

prueba({
  id: 'NOTIFCORREO-002', grupo: 'notificaciones', nombre: 'Aviso de conteos hoy: sin racks programados para hoy, no manda nada', metodo: 'EMPÍRICO',
  objetivo: 'Si no hay ningún rack cuya programación caiga en el día de hoy, enviarAvisoConteosHoyApp_ no debe mandar ningún correo',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const prog = entorno.leerHoja('PROGRAMACION_CONTEOS');
    const otroDia = DIAS_SEMANA_[(new Date().getDay() + 1) % 7];
    prog.push(['PC-0001', 'A01', otroDia, 'SEMANAL', 'Admin Prueba', 'ACTIVO', '']);

    const resultado = entorno.invocar('enviarAvisoConteosHoyApp_');

    return {
      datos: `único rack programado es para "${otroDia}", no para hoy ("${DIA_HOY_}")`,
      esperado: '0 correos enviados',
      obtenido: `enviados=${resultado.enviados}`,
      pasa: resultado.enviados === 0,
    };
  },
});

prueba({
  id: 'NOTIFCORREO-003', grupo: 'notificaciones', nombre: 'Stock crítico: solo avisa la PRIMERA vez que un producto cruza el mínimo, no en cada pasada', metodo: 'EMPÍRICO',
  objetivo: 'revisarStockCriticoYNotificarApp_ debe avisar cuando un producto entra por primera vez a la lista de críticos, y NO volver a avisar de ese mismo producto en la siguiente corrida si sigue crítico (evita spam)',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    // COD-002 AZUCAR: Mínimo=20 (ver hojaMatrizEstandar) — se baja a 5 (bajo mínimo).
    entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-002')[10] = 5;

    const primeraCorrida = entorno.invocar('revisarStockCriticoYNotificarApp_');
    const segundaCorrida = entorno.invocar('revisarStockCriticoYNotificarApp_'); // mismo estado, nada cambió

    return {
      datos: 'COD-002 baja a existencia=5 (mínimo=20) antes de la primera corrida; nada cambia entre la 1ª y la 2ª corrida',
      esperado: '1ª corrida: 1 nuevo aviso. 2ª corrida: 0 nuevos avisos (ya se avisó, sigue crítico pero no es "nuevo")',
      obtenido: `primeraCorrida.nuevosAvisados=${primeraCorrida.nuevosAvisados}, segundaCorrida.nuevosAvisados=${segundaCorrida.nuevosAvisados}`,
      pasa: primeraCorrida.nuevosAvisados === 1 && segundaCorrida.nuevosAvisados === 0,
    };
  },
});

prueba({
  id: 'NOTIFCORREO-004', grupo: 'notificaciones', nombre: 'Stock crítico: un SEGUNDO producto que cruza el mínimo sí genera un nuevo aviso', metodo: 'EMPÍRICO',
  objetivo: 'Control positivo de NOTIFCORREO-003 — si después de la primera corrida OTRO producto distinto cruza su mínimo, sí debe contar como nuevo, sin importar que el primero ya estuviera avisado',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const matriz = entorno.leerHoja('MATRIZ');
    matriz.find(f => f[4] === 'COD-002')[10] = 5; // AZUCAR bajo mínimo desde el arranque

    const primeraCorrida = entorno.invocar('revisarStockCriticoYNotificarApp_');

    matriz.find(f => f[4] === 'COD-001')[10] = 1; // HARINA también cruza su mínimo después
    entorno.invocar('invalidarCacheHoja_', 'MATRIZ'); // escritura directa a la hoja — mismo criterio que ya usan REND-001/003

    const segundaCorrida = entorno.invocar('revisarStockCriticoYNotificarApp_');

    return {
      datos: 'COD-002 crítico desde la 1ª corrida; COD-001 se vuelve crítico recién antes de la 2ª',
      esperado: '1ª corrida: 1 nuevo (COD-002). 2ª corrida: 1 nuevo (COD-001) — COD-002 no se recuenta',
      obtenido: `primeraCorrida.nuevosAvisados=${primeraCorrida.nuevosAvisados}, segundaCorrida.nuevosAvisados=${segundaCorrida.nuevosAvisados}, segundaCorrida.criticos=${segundaCorrida.criticos}`,
      pasa: primeraCorrida.nuevosAvisados === 1 && segundaCorrida.nuevosAvisados === 1 && segundaCorrida.criticos === 2,
    };
  },
});

prueba({
  id: 'NOTIFCORREO-005', grupo: 'notificaciones', nombre: 'Stock crítico: productos sin ubicación o sin mínimo capturado no cuentan', metodo: 'EMPÍRICO',
  objetivo: 'Mismo criterio que ya usa el resto del Dashboard (obtenerDashboardMovil/obtenerProductosPorEstadoStock): un producto sin ubicación asignada, o sin Mínimo capturado (0), no debe generar alerta aunque su existencia sea baja',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const matriz = entorno.leerHoja('MATRIZ');
    matriz.find(f => f[4] === 'COD-002')[10] = 999; // AZUCAR: por defecto ya está bajo mínimo (existencia=5, mínimo=10) — se sube para aislar lo que esta prueba realmente mide
    const fila = matriz.find(f => f[4] === 'COD-003'); // SAL DE MESA
    fila[9] = ''; // sin ubicación
    fila[10] = 0; // existencia en 0
    fila[11] = 10; // mínimo capturado — igual no debe contar por falta de ubicación

    const resultado = entorno.invocar('revisarStockCriticoYNotificarApp_');

    return {
      datos: 'COD-003 con existencia=0 pero SIN ubicación asignada (COD-002 subido a existencia=999 para no interferir)',
      esperado: '0 productos críticos detectados (la falta de ubicación lo excluye, mismo criterio que el Dashboard)',
      obtenido: `criticos=${resultado.criticos}`,
      pasa: resultado.criticos === 0,
    };
  },
});

/*
 * AUTO-01 (auditoría comparativa vs. MarketMan): resumen diario de
 * "acciones requeridas" — reutiliza obtenerAccionesRequeridasApp tal
 * cual (vía una sesión sintética de ADMIN que se crea y se cierra en la
 * misma llamada), así que estas pruebas verifican la integración
 * (cuándo manda, a quién, y que no truene sin destinatarios) — no
 * vuelven a probar la lógica de clasificación de acciones, ya cubierta
 * en pruebas-qa/inteligencia/inteligencia.test.js.
 */

prueba({
  id: 'NOTIFCORREO-006', grupo: 'notificaciones', nombre: 'AUTO-01: con algo pendiente (bajo mínimo por default), el aviso se manda a Admin/Almacén', metodo: 'EMPÍRICO',
  objetivo: 'enviarAvisoAccionesRequeridasApp_ debe detectar que hay acciones pendientes (el fixture base ya trae COD-002 bajo mínimo) y mandar el resumen a los usuarios ADMIN/Almacén activos',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const resultado = entorno.invocar('enviarAvisoAccionesRequeridasApp_');
    return {
      datos: 'fixture base sin tocar — COD-002 ya está bajo mínimo (existencia=5, mínimo=10) por default',
      esperado: 'total > 0 y enviados > 0 (hay al menos un ADMIN activo en el fixture base)',
      obtenido: `total=${resultado.total}, enviados=${resultado.enviados}`,
      pasa: resultado.total > 0 && resultado.enviados > 0,
    };
  },
});

prueba({
  id: 'NOTIFCORREO-007', grupo: 'notificaciones', nombre: 'AUTO-01: sin ninguna acción pendiente, no manda nada', metodo: 'EMPÍRICO',
  objetivo: 'enviarAvisoAccionesRequeridasApp_ no debe intentar mandar correo si obtenerAccionesRequeridasApp regresa las 3 listas vacías',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const matriz = entorno.leerHoja('MATRIZ');
    matriz.find(f => f[4] === 'COD-002')[10] = 999; // sube el único producto bajo mínimo del fixture base
    const resultado = entorno.invocar('enviarAvisoAccionesRequeridasApp_');
    return {
      datos: 'todo el catálogo por encima de su mínimo, sin discrepancias/requisiciones/OC/transferencias pendientes',
      esperado: 'total=0, enviados=0',
      obtenido: `total=${resultado.total}, enviados=${resultado.enviados}`,
      pasa: resultado.total === 0 && resultado.enviados === 0,
    };
  },
});

prueba({
  id: 'NOTIFCORREO-008', grupo: 'notificaciones', nombre: 'AUTO-01: la sesión sintética del sistema se cierra explícitamente después de mandar el aviso', metodo: 'EMPÍRICO',
  objetivo: 'enviarAvisoAccionesRequeridasApp_ debe llamar cerrarSesionApp sobre la sesión sintética que crea para leer obtenerAccionesRequeridasApp — no debe quedar viva indefinidamente. cerrarSesionApp deja su propio rastro en AUDITORIA (AUD-01), que es lo verificable aquí',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    entorno.invocar('enviarAvisoAccionesRequeridasApp_');
    const auditoria = entorno.leerHoja('AUDITORIA');
    const logoutsSistema = auditoria.filter(f => f[3] === 'Sistema Automático' && f[5] === 'LOGOUT');
    return {
      datos: 'una corrida del aviso de acciones requeridas',
      esperado: 'exactamente 1 fila LOGOUT en AUDITORIA para "Sistema Automático" (la sesión sintética se cerró en la misma llamada)',
      obtenido: `logoutsSistema=${logoutsSistema.length}`,
      pasa: logoutsSistema.length === 1,
    };
  },
});
