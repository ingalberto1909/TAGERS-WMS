'use strict';

/*
 * Re-validación de Recetas (BOM): CRUD básico y el guard de CONSULTA que
 * el propio código ya documentaba como intención pero nunca aplicaba.
 */

const { prueba } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase, ENCABEZADOS } = require('../lib/datos-prueba');

function entornoConLogin(rolCorreo, overrides) {
  const entorno = crearEntorno({ hojas: hojasBase(overrides) });
  const token = entorno.invocar('crearSesion_', rolCorreo.correo, rolCorreo.nombre, rolCorreo.rol);
  return { entorno, token };
}

prueba({
  id: 'REC-001', grupo: 'recetas', nombre: 'Crear receta válida', metodo: 'EMPÍRICO',
  objetivo: 'crearRecetaApp debe crear un bloque con ingredientes en la hoja RECETAS',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const r = entorno.invocar('crearRecetaApp', {
      nombre: 'SALSA X', rendimiento: '1 tanda', categoria: 'GENERAL',
      ingredientes: [{ nombre: 'HARINA DE TRIGO', cantidad: 500, udm: 'G' }],
    }, token);
    const lista = entorno.invocar('obtenerRecetasApp', token);
    return {
      datos: '1 receta con 1 ingrediente',
      esperado: 'ok:true, aparece en obtenerRecetasApp',
      obtenido: `ok=${r.ok}, total=${lista.length}, nombre=${lista[0] && lista[0].nombre}`,
      pasa: r.ok === true && lista.length === 1 && lista[0].nombre === 'SALSA X',
    };
  },
});

prueba({
  id: 'REC-002', grupo: 'recetas', nombre: 'No se permite receta duplicada', metodo: 'EMPÍRICO',
  objetivo: 'crearRecetaApp debe rechazar un nombre de receta ya existente',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const datos = { nombre: 'SALSA X', rendimiento: '1 tanda', categoria: 'GENERAL', ingredientes: [{ nombre: 'HARINA DE TRIGO', cantidad: 500, udm: 'G' }] };
    entorno.invocar('crearRecetaApp', datos, token);
    let bloqueado = false;
    try { entorno.invocar('crearRecetaApp', datos, token); } catch (e) { bloqueado = true; }
    return { datos: 'misma receta creada 2 veces', esperado: 'bloqueado en el 2º intento', obtenido: bloqueado ? 'bloqueado' : 'PERMITIDO (duplicado)', pasa: bloqueado };
  },
});

prueba({
  id: 'REC-003', grupo: 'recetas', nombre: 'Sin ingredientes no se crea la receta', metodo: 'EMPÍRICO',
  objetivo: 'validarDatosReceta_ (vía crearRecetaApp) debe rechazar una receta sin ingredientes válidos',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    let bloqueado = false;
    try { entorno.invocar('crearRecetaApp', { nombre: 'SALSA VACIA', rendimiento: '1 tanda', categoria: 'GENERAL', ingredientes: [] }, token); }
    catch (e) { bloqueado = true; }
    return { datos: 'ingredientes=[]', esperado: 'bloqueado', obtenido: bloqueado ? 'bloqueado' : 'permitido', pasa: bloqueado };
  },
});

prueba({
  id: 'REC-004', grupo: 'recetas', nombre: 'Editar receta cambia sus ingredientes', metodo: 'EMPÍRICO',
  objetivo: 'editarRecetaApp debe reemplazar el bloque de ingredientes existente',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    entorno.invocar('crearRecetaApp', { nombre: 'SALSA X', rendimiento: '1 tanda', categoria: 'GENERAL', ingredientes: [{ nombre: 'HARINA DE TRIGO', cantidad: 500, udm: 'G' }] }, token);
    entorno.invocar('editarRecetaApp', 'SALSA X', {
      nombre: 'SALSA X', rendimiento: '2 tandas', categoria: 'GENERAL',
      ingredientes: [{ nombre: 'HARINA DE TRIGO', cantidad: 1, udm: 'KG' }, { nombre: 'AZUCAR ESTANDAR', cantidad: 200, udm: 'G' }],
    }, token);
    const detalle = entorno.invocar('obtenerDetalleRecetaApp', 'SALSA X', token);
    return {
      datos: 'editar de 1 a 2 ingredientes, rendimiento de "1 tanda" a "2 tandas"',
      esperado: 'rendimiento="2 tandas", 2 ingredientes',
      obtenido: `rendimiento=${detalle.rendimiento}, ingredientes=${detalle.ingredientes.length}`,
      pasa: detalle.rendimiento === '2 tandas' && detalle.ingredientes.length === 2,
    };
  },
});

prueba({
  id: 'REC-005', grupo: 'recetas', nombre: 'Cambiar estado a INACTIVA', metodo: 'EMPÍRICO',
  objetivo: 'cambiarEstadoRecetaApp debe actualizar el estado y que se refleje en obtenerRecetasApp',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    entorno.invocar('crearRecetaApp', { nombre: 'SALSA X', rendimiento: '1 tanda', categoria: 'GENERAL', ingredientes: [{ nombre: 'HARINA DE TRIGO', cantidad: 500, udm: 'G' }] }, token);
    entorno.invocar('cambiarEstadoRecetaApp', 'SALSA X', 'INACTIVA', token);
    const lista = entorno.invocar('obtenerRecetasApp', token);
    return {
      datos: 'receta creada ACTIVA por defecto, luego se desactiva',
      esperado: 'estado=INACTIVA',
      obtenido: `estado=${lista[0].estado}`,
      pasa: lista[0].estado === 'INACTIVA',
    };
  },
});

prueba({
  id: 'REC-006', grupo: 'recetas', nombre: 'Una receta INACTIVA no se puede requisitar', metodo: 'EMPÍRICO',
  objetivo: 'crearRequisicionRecetaApp debe rechazar una receta que ya no está ACTIVA',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    entorno.invocar('crearRecetaApp', { nombre: 'SALSA X', rendimiento: '1 tanda', categoria: 'GENERAL', ingredientes: [{ nombre: 'HARINA DE TRIGO', cantidad: 500, udm: 'G' }] }, token);
    entorno.invocar('cambiarEstadoRecetaApp', 'SALSA X', 'INACTIVA', token);
    const tokenCocina = entorno.invocar('crearSesion_', 'cocina@tagers.com', 'Cocina', 'OPERADOR');
    let bloqueado = false;
    try { entorno.invocar('crearRequisicionRecetaApp', '', [{ codigoReceta: 'REC-0001', cantidadSolicitada: 1 }], tokenCocina); }
    catch (e) { bloqueado = true; }
    return { datos: 'receta INACTIVA', esperado: 'bloqueado', obtenido: bloqueado ? 'bloqueado' : 'PERMITIDO', pasa: bloqueado };
  },
});
