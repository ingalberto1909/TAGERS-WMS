'use strict';

/*
 * Módulo de gestión de usuarios (pedido del usuario, tras la auditoría
 * integral): hallazgo original era que no existía NINGUNA función para
 * alta/edición/baja de usuarios — todo era edición manual de la hoja, sin
 * auditoría. Estas pruebas verifican que el nuevo módulo (Usuarios.gs)
 * quede tan cerrado como el resto del proyecto: solo ADMIN, con
 * validaciones y sin poder auto-bloquearse.
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
  id: 'USR-001', grupo: 'usuarios', nombre: 'ADMIN puede dar de alta un usuario nuevo, sin exponer el hash de password', metodo: 'EMPÍRICO',
  objetivo: 'crearUsuarioApp debe crear la fila en USUARIOS y aparecer en obtenerUsuariosApp; el hash de la contraseña nunca debe viajar en la respuesta al cliente',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    entorno.invocar('crearUsuarioApp', {
      correo: 'nuevo@tagers.com', nombre: 'Usuario Nuevo', password: 'clave123', rol: 'OPERADOR', area: 'Cocina',
    }, token);
    const lista = entorno.invocar('obtenerUsuariosApp', token);
    const creado = lista.find(u => u.correo === 'nuevo@tagers.com');
    return {
      datos: 'alta de nuevo@tagers.com, rol OPERADOR, área Cocina',
      esperado: 'aparece en la lista con estado ACTIVO y sin ningún campo de password',
      obtenido: creado ? `nombre=${creado.nombre}, rol=${creado.rol}, estado=${creado.estado}, tienePassword=${creado.password !== undefined}` : 'NO ENCONTRADO',
      pasa: !!creado && creado.nombre === 'Usuario Nuevo' && creado.estado === 'ACTIVO' && creado.password === undefined,
    };
  },
});

prueba({
  id: 'USR-002', grupo: 'usuarios', nombre: 'Ningún rol distinto de ADMIN puede ver ni crear usuarios', metodo: 'EMPÍRICO',
  objetivo: 'requerirAccesoAdminApp_ debe bloquear a SUPERVISOR, OPERADOR y CONSULTA tanto en obtenerUsuariosApp como en crearUsuarioApp — el backend, no solo el botón oculto en el sidebar',
  ejecutar() {
    const roles = ['SUPERVISOR', 'OPERADOR', 'CONSULTA'];
    const resultados = roles.map(rol => {
      const { entorno, token } = entornoConLogin({ correo: rol.toLowerCase() + '@tagers.com', nombre: rol, rol });
      let listaBloqueada = false, altaBloqueada = false;
      try { entorno.invocar('obtenerUsuariosApp', token); } catch (e) { listaBloqueada = true; }
      try { entorno.invocar('crearUsuarioApp', { correo: 'x@x.com', nombre: 'X', password: '123456', rol: 'OPERADOR' }, token); } catch (e) { altaBloqueada = true; }
      return { rol, listaBloqueada, altaBloqueada };
    });
    const todosBloqueados = resultados.every(r => r.listaBloqueada && r.altaBloqueada);
    return {
      datos: 'SUPERVISOR, OPERADOR y CONSULTA intentan ver y crear usuarios',
      esperado: 'los 3 roles bloqueados en ambas funciones',
      obtenido: resultados.map(r => `${r.rol}: lista=${r.listaBloqueada?'bloqueada':'PERMITIDA'}, alta=${r.altaBloqueada?'bloqueada':'PERMITIDA'}`).join(' | '),
      pasa: todosBloqueados,
    };
  },
});

prueba({
  id: 'USR-003', grupo: 'usuarios', nombre: 'No se permite un correo duplicado', metodo: 'EMPÍRICO',
  objetivo: 'crearUsuarioApp debe rechazar un correo que ya existe en USUARIOS (comparación sin importar mayúsculas)',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    let bloqueado = false;
    try {
      entorno.invocar('crearUsuarioApp', { correo: 'Admin@Tagers.com', nombre: 'Otro Admin', password: 'clave123', rol: 'ADMIN' }, token);
    } catch (e) { bloqueado = true; }
    return {
      datos: 'admin@tagers.com ya existe en la base; se intenta crear "Admin@Tagers.com" (mismas letras, mayúsculas distintas)',
      esperado: 'bloqueado',
      obtenido: bloqueado ? 'bloqueado' : 'PERMITIDO (duplicado)',
      pasa: bloqueado,
    };
  },
});

prueba({
  id: 'USR-004', grupo: 'usuarios', nombre: 'Editar usuario cambia el rol y lo audita', metodo: 'EMPÍRICO',
  objetivo: 'editarUsuarioApp debe actualizar el rol en USUARIOS y dejar un registro en AUDITORIA con el cambio de rol explícito',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    entorno.invocar('editarUsuarioApp', 'supervisor@tagers.com', { nombre: 'Supervisor Prueba', rol: 'ADMIN' }, token);
    const lista = entorno.invocar('obtenerUsuariosApp', token);
    const editado = lista.find(u => u.correo === 'supervisor@tagers.com');
    const auditoria = entorno.leerHoja('AUDITORIA').slice(1);
    const filaAuditoria = auditoria.find(f => f[6] === 'supervisor@tagers.com');
    return {
      datos: 'supervisor@tagers.com pasa de SUPERVISOR a ADMIN',
      esperado: 'rol=ADMIN en la lista; 1 fila de auditoría (columna Observación) mencionando el cambio de rol',
      obtenido: `rolFinal=${editado && editado.rol}, auditoria=${filaAuditoria ? filaAuditoria[12] : 'NO ENCONTRADA'}`,
      pasa: !!editado && editado.rol === 'ADMIN' && !!filaAuditoria && /SUPERVISOR.*ADMIN/.test(filaAuditoria[12]),
    };
  },
});

prueba({
  id: 'USR-005', grupo: 'usuarios', nombre: 'Un ADMIN no puede quitarse a sí mismo el rol de Admin', metodo: 'EMPÍRICO',
  objetivo: 'editarUsuarioApp debe bloquear que la sesión actual se cambie su propio rol de ADMIN a otro — evita que el único administrador activo se bloquee por accidente',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    let bloqueado = false, mensaje = '';
    try { entorno.invocar('editarUsuarioApp', 'admin@tagers.com', { nombre: 'Admin', rol: 'OPERADOR' }, token); }
    catch (e) { bloqueado = true; mensaje = e.message; }
    const lista = entorno.invocar('obtenerUsuariosApp', token);
    const sigueSiendoAdmin = lista.find(u => u.correo === 'admin@tagers.com').rol === 'ADMIN';
    return {
      datos: 'admin@tagers.com (la sesión actual) intenta cambiarse su propio rol a OPERADOR',
      esperado: 'bloqueado, sigue siendo ADMIN',
      obtenido: `bloqueado=${bloqueado} ("${mensaje}"), rolActual=${sigueSiendoAdmin ? 'ADMIN' : 'CAMBIÓ'}`,
      pasa: bloqueado && sigueSiendoAdmin,
    };
  },
});

prueba({
  id: 'USR-006', grupo: 'usuarios', nombre: 'Desactivar un usuario le impide iniciar sesión de inmediato', metodo: 'EMPÍRICO',
  objetivo: 'cambiarEstadoUsuarioApp(INACTIVO) debe reflejarse en validarUsuario — el login ya filtra por Estado=ACTIVO, así que esta prueba confirma la integración real entre ambos, no solo que la celda cambió',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    const usuarios = entorno.leerHoja('USUARIOS');
    usuarios.find(f => f[0] === 'operador@tagers.com')[2] = 'operador123'; // texto plano, se migra a hash al validar (mismo patrón que smoke-001)
    const loginAntes = entorno.invocar('validarUsuario', 'operador@tagers.com', 'operador123');
    entorno.invocar('cambiarEstadoUsuarioApp', 'operador@tagers.com', 'INACTIVO', token);
    const loginDespues = entorno.invocar('validarUsuario', 'operador@tagers.com', 'operador123');
    return {
      datos: 'operador@tagers.com se desactiva mientras existe una sesión de ADMIN abierta',
      esperado: 'el login funcionaba antes (ok:true) y deja de funcionar después (ok:false)',
      obtenido: `antes.ok=${loginAntes.ok}, despues.ok=${loginDespues.ok}`,
      pasa: loginAntes.ok === true && loginDespues.ok === false,
    };
  },
});

prueba({
  id: 'USR-007', grupo: 'usuarios', nombre: 'Un usuario no puede desactivar su propia cuenta', metodo: 'EMPÍRICO',
  objetivo: 'cambiarEstadoUsuarioApp debe bloquear que la sesión actual se desactive a sí misma',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    let bloqueado = false;
    try { entorno.invocar('cambiarEstadoUsuarioApp', 'admin@tagers.com', 'INACTIVO', token); }
    catch (e) { bloqueado = true; }
    return {
      datos: 'admin@tagers.com intenta desactivarse a sí mismo',
      esperado: 'bloqueado',
      obtenido: bloqueado ? 'bloqueado' : 'PERMITIDO (auto-desactivación)',
      pasa: bloqueado,
    };
  },
});

prueba({
  id: 'USR-008', grupo: 'usuarios', nombre: 'Rol inválido es rechazado al crear', metodo: 'EMPÍRICO',
  objetivo: 'crearUsuarioApp debe rechazar cualquier rol que no esté en la lista válida (ADMIN/SUPERVISOR/OPERADOR/CONSULTA)',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    let bloqueado = false;
    try { entorno.invocar('crearUsuarioApp', { correo: 'x@x.com', nombre: 'X', password: 'clave123', rol: 'SUPERADMIN' }, token); }
    catch (e) { bloqueado = true; }
    return { datos: 'rol="SUPERADMIN" (no existe)', esperado: 'bloqueado', obtenido: bloqueado ? 'bloqueado' : 'PERMITIDO', pasa: bloqueado };
  },
});

prueba({
  id: 'USR-009', grupo: 'usuarios', nombre: 'Contraseña corta es rechazada', metodo: 'EMPÍRICO',
  objetivo: 'crearUsuarioApp debe exigir al menos 6 caracteres de contraseña',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    let bloqueado = false;
    try { entorno.invocar('crearUsuarioApp', { correo: 'x@x.com', nombre: 'X', password: '123', rol: 'OPERADOR' }, token); }
    catch (e) { bloqueado = true; }
    return { datos: 'password="123" (3 caracteres)', esperado: 'bloqueado', obtenido: bloqueado ? 'bloqueado' : 'PERMITIDO', pasa: bloqueado };
  },
});

prueba({
  id: 'USR-010', grupo: 'usuarios', nombre: 'Correo con formato inválido es rechazado', metodo: 'EMPÍRICO',
  objetivo: 'crearUsuarioApp debe validar el formato del correo antes de guardarlo',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    let bloqueado = false;
    try { entorno.invocar('crearUsuarioApp', { correo: 'no-es-un-correo', nombre: 'X', password: 'clave123', rol: 'OPERADOR' }, token); }
    catch (e) { bloqueado = true; }
    return { datos: 'correo="no-es-un-correo"', esperado: 'bloqueado', obtenido: bloqueado ? 'bloqueado' : 'PERMITIDO', pasa: bloqueado };
  },
});
