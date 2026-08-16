'use strict';

/*
 * Fundación multi-sucursal (Opción B del diseño de la etapa anterior).
 * Nada de esto está conectado a ninguna pantalla todavía — estas
 * pruebas ejercen directamente las funciones nuevas (parámetro opcional
 * `sucursal` en los 3 escritores centralizados de existencia + la hoja
 * nueva EXISTENCIAS_SUCURSAL) para demostrar dos cosas:
 *
 *   1. Cuando NADIE manda una sucursal (el caso de HOY, 100% de las
 *      llamadas reales), el comportamiento es exactamente el de antes
 *      — ya lo prueba el resto de la suite sin haber cambiado una sola
 *      línea, y aquí se repite explícito.
 *   2. Cuando SÍ se manda una sucursal real, la escritura queda aislada
 *      en su propia fila de EXISTENCIAS_SUCURSAL, sin tocar MATRIZ ni
 *      las filas de otras sucursales — la propiedad de aislamiento que
 *      justificó recomendar la Opción B en el diseño.
 */

const { prueba } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase } = require('../lib/datos-prueba');

prueba({
  id: 'SUC-001', grupo: 'sucursales', nombre: 'Sin sucursal explícita, todo sigue igual que antes', metodo: 'EMPÍRICO',
  objetivo: 'ajustarExistenciaMatrizPorDeltaValidado_ sin 3er argumento debe escribir en MATRIZ como siempre y NO crear la hoja EXISTENCIAS_SUCURSAL',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 20);
    const existenciaMatriz = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];
    const hojaExistencias = entorno.hojas.EXISTENCIAS_SUCURSAL;
    return {
      datos: 'existencia inicial=100 en MATRIZ, +20 sin pasar sucursal',
      esperado: 'MATRIZ=120, la hoja EXISTENCIAS_SUCURSAL no se crea',
      obtenido: `MATRIZ=${existenciaMatriz}, hojaExistenciasSucursalCreada=${!!hojaExistencias}`,
      pasa: existenciaMatriz === 120 && !hojaExistencias,
    };
  },
});

prueba({
  id: 'SUC-002', grupo: 'sucursales', nombre: 'Escribir en una sucursal real no toca MATRIZ', metodo: 'EMPÍRICO',
  objetivo: 'Pasar sucursal="S02" debe crear/actualizar una fila en EXISTENCIAS_SUCURSAL y dejar MATRIZ.Existencia intacta',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 30, 'S02');
    const existenciaMatriz = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];
    const filaSucursal = entorno.leerHoja('EXISTENCIAS_SUCURSAL')[1];
    return {
      datos: 'MATRIZ.COD-001=100 (sin tocar), S02 recibe +30 desde 0',
      esperado: 'MATRIZ sigue en 100, EXISTENCIAS_SUCURSAL tiene 1 fila (COD-001, S02, 30)',
      obtenido: `MATRIZ=${existenciaMatriz}, filaSucursal=${JSON.stringify(filaSucursal)}`,
      pasa: existenciaMatriz === 100 && filaSucursal && filaSucursal[0] === 'COD-001' && filaSucursal[1] === 'S02' && filaSucursal[2] === 30,
    };
  },
});

prueba({
  id: 'SUC-003', grupo: 'sucursales', nombre: 'Escribir en una sucursal no afecta a otra', metodo: 'EMPÍRICO',
  objetivo: 'Dos escrituras en S02 y S05 para el mismo código deben quedar en filas separadas, cada una con su propio valor',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 50, 'S02');
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 10, 'S05');
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 30, 'S05'); // segunda escritura a la MISMA fila de S05
    const filas = entorno.leerHoja('EXISTENCIAS_SUCURSAL').slice(1);
    const s02 = filas.find(f => f[1] === 'S02');
    const s05 = filas.find(f => f[1] === 'S05');
    return {
      datos: 'S02 recibe +50, S05 recibe +10 y luego +30 más',
      esperado: '2 filas: S02=50, S05=40 (10+30, misma fila actualizada, no duplicada)',
      obtenido: `filas=${filas.length}, S02=${s02 && s02[2]}, S05=${s05 && s05[2]}`,
      pasa: filas.length === 2 && s02[2] === 50 && s05[2] === 40,
    };
  },
});

prueba({
  id: 'SUC-004', grupo: 'sucursales', nombre: 'Validación de existencia negativa funciona por sucursal', metodo: 'EMPÍRICO',
  objetivo: 'ajustarExistenciaMatrizPorDeltaValidado_ debe bloquear una salida que deje negativa la existencia DE ESA sucursal, aunque MATRIZ (S01) tenga stock de sobra',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    // COD-001 tiene 100 en MATRIZ (S01), pero S03 arranca en 0.
    let bloqueado = false, mensaje = '';
    try { entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', -20, 'S03'); }
    catch (e) { bloqueado = true; mensaje = e.message; }
    const existenciaMatriz = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];
    return {
      datos: 'S03 existencia local=0, intenta salida de 20 (MATRIZ/S01 tiene 100, pero es irrelevante para S03)',
      esperado: 'bloqueado con "Existencia insuficiente", MATRIZ (S01) no se toca',
      obtenido: bloqueado ? mensaje : 'PERMITIDO',
      pasa: bloqueado && /insuficiente/i.test(mensaje) && existenciaMatriz === 100,
    };
  },
});

prueba({
  id: 'SUC-005', grupo: 'sucursales', nombre: 'Lectura de S01 cae a MATRIZ antes de tener fila propia', metodo: 'EMPÍRICO',
  objetivo: 'obtenerExistenciaSucursal_(codigo, "S01") debe leer MATRIZ.Existencia mientras no exista una migración real hacia EXISTENCIAS_SUCURSAL',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const existencia = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S01');
    return {
      datos: 'COD-001 en MATRIZ=100, sin fila en EXISTENCIAS_SUCURSAL',
      esperado: '100 (leído de MATRIZ)',
      obtenido: `${existencia}`,
      pasa: existencia === 100,
    };
  },
});

prueba({
  id: 'SUC-006', grupo: 'sucursales', nombre: 'Simulación de 6 sucursales (Fase 10 del diseño, ahora con código real)', metodo: 'EMPÍRICO',
  objetivo: 'Producto X en S01..S06 con las cantidades del pedido: S03 (0) no puede tomar 20 unidades, y S06 (200) permanece aislada e intacta',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    entorno.invocar('actualizarExistenciaMatriz_', 'COD-001', 100); // S01 = MATRIZ, la única fuente hoy
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 50, 'S02');
    // S03 se queda en 0 (no se escribe nada = 0 por default)
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 75, 'S04');
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 20, 'S05');
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 200, 'S06');

    const s01 = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S01');
    const s02 = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S02');
    const s03 = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S03');
    const s04 = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S04');
    const s05 = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S05');
    const s06Antes = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S06');

    let s03Bloqueada = false;
    try { entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', -20, 'S03'); }
    catch (e) { s03Bloqueada = true; }

    const s06Despues = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S06');
    const total = s01 + s02 + s03 + s04 + s05 + s06Antes;

    return {
      datos: `S01=${s01} S02=${s02} S03=${s03} S04=${s04} S05=${s05} S06=${s06Antes} (total=${total})`,
      esperado: 'total=445; S03 solicita 20 y se bloquea (existencia insuficiente); S06 sigue en 200 sin ninguna acción especial',
      obtenido: `total=${total}, s03Bloqueada=${s03Bloqueada}, S06 antes=${s06Antes} después=${s06Despues}`,
      pasa: total === 445 && s03Bloqueada === true && s06Antes === 200 && s06Despues === 200,
    };
  },
});

prueba({
  id: 'SUC-007', grupo: 'sucursales', nombre: 'actualizarExistenciaMatriz_ (valor absoluto) también respeta la sucursal', metodo: 'EMPÍRICO',
  objetivo: 'La variante de "fijar valor absoluto" debe desviarse a EXISTENCIAS_SUCURSAL igual que la de delta cuando recibe una sucursal real',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    entorno.invocar('actualizarExistenciaMatriz_', 'COD-002', 77, 'S04');
    const existenciaMatriz = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-002')[10];
    const filaSucursal = entorno.leerHoja('EXISTENCIAS_SUCURSAL')[1];
    return {
      datos: 'COD-002 MATRIZ=5 (AZUCAR), se fija S04=77',
      esperado: 'MATRIZ sigue en 5, EXISTENCIAS_SUCURSAL tiene (COD-002, S04, 77)',
      obtenido: `MATRIZ=${existenciaMatriz}, filaSucursal=${JSON.stringify(filaSucursal)}`,
      pasa: existenciaMatriz === 5 && filaSucursal[1] === 'S04' && filaSucursal[2] === 77,
    };
  },
});
