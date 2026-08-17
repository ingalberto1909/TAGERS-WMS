'use strict';

/*
 * Campana de notificaciones — antes solo mandaba inventario bajo
 * mínimo/agotado (sin token, visible para cualquiera). Ahora también
 * junta conteos cíclicos sin cerrar y requisiciones PENDIENTE (Área +
 * Sucursal), pero eso sí es información operativa de Almacén/CEDIS:
 * mismo criterio de acceso que ya protege "Requisiciones
 * Pendientes"/"Entregas Recientes" (obtenerAccesoRequisicionesApp().esAdmin).
 * Estas pruebas confirman ese gating y el cálculo de "urgente" por
 * fecha requerida.
 */

const { prueba } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase } = require('../lib/datos-prueba');

function entornoConLogin(rolCorreo, overrides) {
  const entorno = crearEntorno({ hojas: hojasBase(overrides) });
  const token = entorno.invocar('crearSesion_', rolCorreo.correo, rolCorreo.nombre, rolCorreo.rol);
  return { entorno, token };
}

function formatearYMD(fecha) {
  const pad = n => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(fecha.getDate())}`;
}

prueba({
  id: 'NOTIF-001', grupo: 'notificaciones', nombre: 'Usuario normal solo ve alertas de inventario', metodo: 'EMPÍRICO',
  objetivo: 'obtenerNotificacionesApp NO debe incluir conteos ni requisiciones pendientes para un usuario que no es Admin ni de área Almacén, aunque existan',
  ejecutar() {
    const { entorno, token } = entornoConLogin(
      { correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' },
      { CONTROL_CONTEOS: [
        ['Folio', 'Fecha', 'Usuario', 'Racks', 'Productos', 'Contados', 'Avance', 'Estado'],
        ['CC-0001', new Date(), 'Admin', 5, 20, 0, 0, 'ABIERTO'],
      ] }
    );
    entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-001', producto: 'HARINA', unidad: 'KG', solicitado: 5 }], token);
    const notis = entorno.invocar('obtenerNotificacionesApp', token);
    const tipos = notis.map(n => n.tipo);
    return {
      datos: '1 conteo abierto + 1 requisición PENDIENTE de Cocina, usuario=Cocina (no Almacén)',
      esperado: 'ningún tipo "conteo" ni "requisicion-*" en el resultado',
      obtenido: `tipos=${tipos.join(',') || '(vacío)'}`,
      pasa: !tipos.includes('conteo') && !tipos.some(t => t.startsWith('requisicion')),
    };
  },
});

prueba({
  id: 'NOTIF-002', grupo: 'notificaciones', nombre: 'Almacén ve conteos cíclicos pendientes', metodo: 'EMPÍRICO',
  objetivo: 'obtenerNotificacionesApp debe incluir una alerta tipo "conteo" cuando CONTROL_CONTEOS tiene folios sin cerrar, para un usuario con esAdmin=true',
  ejecutar() {
    const { entorno, token } = entornoConLogin(
      { correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' },
      { CONTROL_CONTEOS: [
        ['Folio', 'Fecha', 'Usuario', 'Racks', 'Productos', 'Contados', 'Avance', 'Estado'],
        ['CC-0001', new Date(), 'Admin', 5, 20, 0, 0, 'ABIERTO'],
        ['CC-0002', new Date(), 'Admin', 3, 12, 12, 100, 'CERRADO'],
      ] }
    );
    const notis = entorno.invocar('obtenerNotificacionesApp', token);
    const alertaConteo = notis.find(n => n.tipo === 'conteo');
    return {
      datos: 'CONTROL_CONTEOS: 1 ABIERTO + 1 CERRADO',
      esperado: '1 alerta tipo "conteo" (cuenta solo el abierto)',
      obtenido: alertaConteo ? `detalle="${alertaConteo.detalle}"` : '(sin alerta de conteo)',
      pasa: !!alertaConteo && /1 conteo/.test(alertaConteo.detalle),
    };
  },
});

prueba({
  id: 'NOTIF-003', grupo: 'notificaciones', nombre: 'Almacén ve requisición de Área pendiente', metodo: 'EMPÍRICO',
  objetivo: 'obtenerNotificacionesApp debe incluir una alerta tipo "requisicion-area" por cada requisición de Área en estado PENDIENTE',
  ejecutar() {
    const { entorno, token: tokenCocina } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    const req = entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-001', producto: 'HARINA', unidad: 'KG', solicitado: 5 }], tokenCocina);
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    const notis = entorno.invocar('obtenerNotificacionesApp', tokenAdmin);
    const alerta = notis.find(n => n.tipo === 'requisicion-area' && n.clave === 'requisicion-area|' + req.folio);
    return {
      datos: `requisición de Área ${req.folio} PENDIENTE`,
      esperado: 'Admin ve 1 alerta "requisicion-area" con ese folio en la clave',
      obtenido: alerta ? `titulo="${alerta.titulo}"` : '(no encontrada)',
      pasa: !!alerta,
    };
  },
});

prueba({
  id: 'NOTIF-004', grupo: 'notificaciones', nombre: 'Admin ve requisición de Sucursal pendiente', metodo: 'EMPÍRICO',
  objetivo: 'obtenerNotificacionesApp debe incluir una alerta tipo "requisicion-sucursal" por cada requisición de sucursal en estado PENDIENTE, para quien tiene esAdmin=true',
  ejecutar() {
    const { entorno, token: tokenS02 } = entornoConLogin({ correo: 'sucursal2@tagers.com', nombre: 'Operador S02', rol: 'OPERADOR' });
    const req = entorno.invocar('crearRequisicionSucursalApp', '', [{ codigo: 'COD-001', producto: 'HARINA', unidad: 'KG', solicitado: 5 }], tokenS02);
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    const notis = entorno.invocar('obtenerNotificacionesApp', tokenAdmin);
    const alerta = notis.find(n => n.tipo === 'requisicion-sucursal' && n.clave === 'requisicion-sucursal|' + req.folio);
    return {
      datos: `requisición de Sucursal S02 ${req.folio} PENDIENTE`,
      esperado: 'Admin (rol ADMIN -> esAdmin=true Y esTodasLasSucursales=true) ve 1 alerta "requisicion-sucursal" con ese folio',
      obtenido: alerta ? `titulo="${alerta.titulo}"` : '(no encontrada)',
      pasa: !!alerta,
    };
  },
});

prueba({
  id: 'NOTIF-005', grupo: 'notificaciones', nombre: 'Urgente=true solo si la fecha requerida ya venció, es hoy o es mañana', metodo: 'EMPÍRICO',
  objetivo: 'obtenerNotificacionesApp debe marcar urgente=true en requisiciones con fechaRequerida <= mañana, y urgente=false cuando falta mucho',
  ejecutar() {
    const { entorno, token: tokenCocina } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    const hoy = new Date();
    const lejana = new Date(); lejana.setDate(lejana.getDate() + 30);
    const reqHoy = entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-001', producto: 'HARINA', unidad: 'KG', solicitado: 1 }], tokenCocina, formatearYMD(hoy));
    const reqLejana = entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-002', producto: 'AZUCAR', unidad: 'KG', solicitado: 1 }], tokenCocina, formatearYMD(lejana));
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    const notis = entorno.invocar('obtenerNotificacionesApp', tokenAdmin);
    const alertaHoy = notis.find(n => n.clave === 'requisicion-area|' + reqHoy.folio);
    const alertaLejana = notis.find(n => n.clave === 'requisicion-area|' + reqLejana.folio);
    return {
      datos: `${reqHoy.folio} requerida HOY, ${reqLejana.folio} requerida en 30 días`,
      esperado: 'urgente=true para hoy, urgente=false para la lejana',
      obtenido: `hoy.urgente=${alertaHoy && alertaHoy.urgente}, lejana.urgente=${alertaLejana && alertaLejana.urgente}`,
      pasa: !!alertaHoy && alertaHoy.urgente === true && !!alertaLejana && alertaLejana.urgente === false,
    };
  },
});

prueba({
  id: 'NOTIF-006', grupo: 'notificaciones', nombre: 'Token inválido es rechazado', metodo: 'EMPÍRICO',
  objetivo: 'obtenerNotificacionesApp debe exigir sesión activa (requerirSesionActivaApp_), igual que el resto de los endpoints autenticados',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    let bloqueado = false;
    try { entorno.invocar('obtenerNotificacionesApp', 'token-inventado-que-no-existe'); }
    catch (e) { bloqueado = true; }
    return { datos: 'token inexistente', esperado: 'bloqueado', obtenido: bloqueado ? 'bloqueado' : 'permitido', pasa: bloqueado };
  },
});
