'use strict';

/*
 * INV-03 (auditoría comparativa vs. MarketMan): módulo dedicado de
 * mermas — antes solo existía como un motivo de texto libre dentro de
 * discrepancias de conteo cíclico, sin cantidad/costo/origen reportables
 * por separado. Estas pruebas cubren el registro (descuento de
 * existencia + valorización + Kardex propio + auditoría) y las
 * consultas (lista filtrada por fecha, resumen por motivo).
 */

const { prueba } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase } = require('../lib/datos-prueba');

function entornoConLogin(rolCorreo, hojasExtra) {
  const entorno = crearEntorno({ hojas: hojasBase(hojasExtra) });
  const token = entorno.invocar('crearSesion_', rolCorreo.correo, rolCorreo.nombre, rolCorreo.rol);
  return { entorno, token };
}

prueba({
  id: 'MER-001', grupo: 'mermas', nombre: 'Registrar merma descuenta existencia, calcula valor y deja rastro en KARDEX/MERMAS/AUDITORIA', metodo: 'EMPÍRICO',
  objetivo: 'registrarMermaApp debe descontar la cantidad de MATRIZ, calcular el valor con el costo unitario del producto, escribir una fila en KARDEX con tipo "MERMA" (Salida=cantidad, Entrada=0), una fila en MERMAS, y una fila en AUDITORIA',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });

    const auditoriaAntes = entorno.leerHoja('AUDITORIA').length;
    const resultado = entorno.invocar('registrarMermaApp', 'COD-001', 10, 'PRODUCTO DAÑADO', '', 'Se cayó la tarima', token);

    const existencia = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];
    const kardex = entorno.leerHoja('KARDEX');
    const filaKardex = kardex[kardex.length - 1];
    const mermas = entorno.leerHoja('MERMAS');
    const filaMerma = mermas[mermas.length - 1];
    const auditoriaDespues = entorno.leerHoja('AUDITORIA').length;

    return {
      datos: 'COD-001 existencia=100, costo=10, se registra merma de 10 por "Producto dañado"',
      esperado: 'existencia=90, valor=100 (10×10), KARDEX tipo=MERMA con Salida=10/Entrada=0, 1 fila en MERMAS, 1 fila nueva en AUDITORIA',
      obtenido: `existencia=${existencia}, valor=${resultado.valor}, kardexTipo=${filaKardex[2]}, kardexEntrada=${filaKardex[6]}, kardexSalida=${filaKardex[7]}, mermaValor=${filaMerma[6]}, mermaMotivo=${filaMerma[7]}, auditoria +${auditoriaDespues - auditoriaAntes}`,
      pasa: existencia === 90 && resultado.valor === 100 && filaKardex[2] === 'MERMA' && filaKardex[6] === 0 && filaKardex[7] === 10 && filaMerma[6] === 100 && filaMerma[7] === 'PRODUCTO DAÑADO' && (auditoriaDespues - auditoriaAntes) === 1,
    };
  },
});

prueba({
  id: 'MER-002', grupo: 'mermas', nombre: 'Motivo inválido se rechaza sin tocar existencia', metodo: 'EMPÍRICO',
  objetivo: 'registrarMermaApp debe rechazar cualquier motivo fuera de la lista fija (MOTIVOS_MERMA_VALIDOS_), sin descontar nada',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });

    let bloqueado = false, mensaje = '';
    try { entorno.invocar('registrarMermaApp', 'COD-001', 10, 'SE ME ANTOJÓ', '', '', token); }
    catch (e) { bloqueado = true; mensaje = e.message; }

    const existencia = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];

    return {
      datos: 'motivo="SE ME ANTOJÓ" (no está en la lista válida)',
      esperado: 'bloqueado, existencia sigue en 100',
      obtenido: `bloqueado=${bloqueado} ("${mensaje}"), existencia=${existencia}`,
      pasa: bloqueado && existencia === 100,
    };
  },
});

prueba({
  id: 'MER-003', grupo: 'mermas', nombre: 'No se puede registrar una merma mayor a la existencia disponible', metodo: 'EMPÍRICO',
  objetivo: 'registrarMermaApp reutiliza ajustarExistenciaMatrizPorDeltaValidado_ — debe rechazar la merma si la cantidad excede lo disponible, sin dejar la existencia en negativo ni escribir nada en KARDEX/MERMAS',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });

    const kardexAntes = entorno.leerHoja('KARDEX').length;
    const mermasAntesExiste = !!entorno.leerHoja('MERMAS');

    let bloqueado = false;
    try { entorno.invocar('registrarMermaApp', 'COD-002', 999, 'PRODUCTO DAÑADO', '', '', token); } // COD-002 existencia=5
    catch (e) { bloqueado = true; }

    const existencia = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-002')[10];
    const kardexDespues = entorno.leerHoja('KARDEX').length;

    return {
      datos: 'COD-002 existencia=5, se intenta registrar una merma de 999',
      esperado: 'bloqueado, existencia sigue en 5, sin fila nueva en KARDEX',
      obtenido: `bloqueado=${bloqueado}, existencia=${existencia}, kardex +${kardexDespues - kardexAntes}`,
      pasa: bloqueado && existencia === 5 && kardexDespues === kardexAntes,
    };
  },
});

prueba({
  id: 'MER-004', grupo: 'mermas', nombre: 'Un operador de área (Cocina) no puede registrar mermas', metodo: 'EMPÍRICO',
  objetivo: 'registrarMermaApp exige requerirAccesoAlmacenApp_ — mismo criterio que el resto de los ajustes de existencia (aprobar discrepancias, inventario mensual)',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });

    let bloqueado = false;
    try { entorno.invocar('registrarMermaApp', 'COD-001', 5, 'PRODUCTO DAÑADO', '', '', token); }
    catch (e) { bloqueado = true; }

    return {
      datos: 'usuario Cocina (OPERADOR de área, sin acceso de Almacén)',
      esperado: 'bloqueado',
      obtenido: bloqueado ? 'bloqueado' : 'permitido',
      pasa: bloqueado,
    };
  },
});

prueba({
  id: 'MER-005', grupo: 'mermas', nombre: 'obtenerMermasApp filtra por rango de fechas', metodo: 'EMPÍRICO',
  objetivo: 'obtenerMermasApp debe excluir registros fuera del rango [desde, hasta] pedido, e incluir los que caen dentro',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });

    entorno.invocar('registrarMermaApp', 'COD-001', 5, 'PRODUCTO DAÑADO', '', 'reciente', token);

    // Una segunda merma, pero con fecha manipulada a hace 60 días directo en la hoja.
    entorno.invocar('registrarMermaApp', 'COD-003', 5, 'OTRO', '', 'vieja', token);
    const mermas = entorno.leerHoja('MERMAS');
    const filaVieja = mermas[mermas.length - 1];
    const hace60Dias = new Date();
    hace60Dias.setDate(hace60Dias.getDate() - 60);
    filaVieja[0] = hace60Dias;

    const hace7Dias = new Date();
    hace7Dias.setDate(hace7Dias.getDate() - 7);

    const lista = entorno.invocar('obtenerMermasApp', hace7Dias.toISOString(), null, token);

    return {
      datos: '1 merma de hoy (COD-001) + 1 merma con fecha forzada a hace 60 días (COD-003), se pide desde hace 7 días',
      esperado: 'solo aparece la de COD-001 (hoy), la de hace 60 días queda fuera del rango',
      obtenido: `cantidad=${lista.length}, códigos=${lista.map(m => m.codigo).join(',')}`,
      pasa: lista.length === 1 && lista[0].codigo === 'COD-001',
    };
  },
});

prueba({
  id: 'MER-006', grupo: 'mermas', nombre: 'obtenerResumenMermasApp agrega valor total y desglose por motivo', metodo: 'EMPÍRICO',
  objetivo: 'obtenerResumenMermasApp debe sumar el valor de todas las mermas del rango y agruparlas por motivo — la pregunta de negocio que motivó el módulo ("cuánto dinero se perdió por desperdicio")',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });

    entorno.invocar('registrarMermaApp', 'COD-001', 10, 'PRODUCTO DAÑADO', '', '', token); // valor=100 (10×10)
    entorno.invocar('registrarMermaApp', 'COD-003', 4, 'PRODUCTO DAÑADO', '', '', token);  // valor=40 (4×10)
    entorno.invocar('registrarMermaApp', 'COD-004', 2, 'CADUCIDAD/VENCIMIENTO', '', '', token); // valor=20 (2×10, convertir="SI" pero calcularValorInventario_ ya ignora eso desde la migración)

    const resumen = entorno.invocar('obtenerResumenMermasApp', null, null, token);

    return {
      datos: '3 mermas: 2 de "PRODUCTO DAÑADO" (100+40=140) y 1 de "CADUCIDAD/VENCIMIENTO" (20)',
      esperado: 'totalRegistros=3, valorTotal=160, porMotivo["PRODUCTO DAÑADO"]=140, porMotivo["CADUCIDAD/VENCIMIENTO"]=20',
      obtenido: `totalRegistros=${resumen.totalRegistros}, valorTotal=${resumen.valorTotal}, porMotivo=${JSON.stringify(resumen.porMotivo)}`,
      pasa: resumen.totalRegistros === 3 && resumen.valorTotal === 160 && resumen.porMotivo['PRODUCTO DAÑADO'] === 140 && resumen.porMotivo['CADUCIDAD/VENCIMIENTO'] === 20,
    };
  },
});
