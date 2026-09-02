'use strict';

/*
 * TAGERS WMS MOBILE — obtenerInventarioMovilApp y obtenerUbicacionesUnicasApp
 * (📁 App.gs.gs) alimentan las 3 pestañas de la pantalla Inventario móvil
 * (Productos/Racks/Ubicaciones en MobileApp.html). No duplican ningún
 * cálculo de existencia/estado propio de otra función — obtenerRacksConteoApp
 * ya existía y se reusa tal cual para la pestaña Racks.
 */

const { prueba } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase, filaProducto, encabezadoMatriz } = require('../lib/datos-prueba');

function entornoConLogin() {
  const matriz = [
    encabezadoMatriz(),
    filaProducto({ producto: 'HARINA DE TRIGO', codigo: 'COD-001', rack: 'R01', ubicacion: 'R01-N01-P01', existencia: 100, minimo: 10, maximo: 200 }),
    filaProducto({ producto: 'AZUCAR ESTANDAR', codigo: 'COD-002', rack: 'R02', ubicacion: 'R02-N02-P01', existencia: 3, minimo: 10, maximo: 100 }),
    filaProducto({ producto: 'SAL DE MESA', codigo: 'COD-003', rack: 'R02', ubicacion: 'R02-N03-P02', existencia: 0, minimo: 5, maximo: 80 }),
    filaProducto({ producto: 'PRODUCTO SIN UBICACION', codigo: 'COD-004', ubicacion: '', existencia: 20 }),
  ];
  const entorno = crearEntorno({ hojas: hojasBase({ MATRIZ: matriz }) });
  const token = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
  return { entorno, token };
}

prueba({
  id: 'INVM-001', grupo: 'inventario', nombre: 'obtenerInventarioMovilApp con texto libre busca en nombre, código, rack y ubicación',
  metodo: 'EMPÍRICO',
  objetivo: 'Buscar "R02" debe encontrar los 2 productos cuyo rack o ubicación contienen R02, sin importar el nombre',
  ejecutar() {
    const { entorno, token } = entornoConLogin();
    const resultado = entorno.invocar('obtenerInventarioMovilApp', { texto: 'R02' }, token);

    const codigos = resultado.map(r => r.codigo).sort();

    return {
      datos: '4 productos: COD-001 (R01), COD-002 y COD-003 (R02), COD-004 (sin ubicación)',
      esperado: 'codigos=["COD-002","COD-003"] (coinciden por rack/ubicación con "R02"), sin incluir COD-004 (sin ubicación se excluye siempre)',
      obtenido: `codigos=${JSON.stringify(codigos)}`,
      pasa: codigos.length === 2 && codigos[0] === 'COD-002' && codigos[1] === 'COD-003',
    };
  },
});

prueba({
  id: 'INVM-002', grupo: 'inventario', nombre: 'obtenerInventarioMovilApp con filtro exacto de rack solo regresa ese rack',
  metodo: 'EMPÍRICO',
  objetivo: 'Filtrar por rack="R02" debe regresar solo productos de ese rack exacto, no un match parcial de texto',
  ejecutar() {
    const { entorno, token } = entornoConLogin();
    const resultado = entorno.invocar('obtenerInventarioMovilApp', { rack: 'R02' }, token);
    const codigos = resultado.map(r => r.codigo).sort();

    return {
      datos: 'COD-002 y COD-003 en rack R02; COD-001 en R01',
      esperado: 'codigos=["COD-002","COD-003"]',
      obtenido: `codigos=${JSON.stringify(codigos)}`,
      pasa: codigos.length === 2 && codigos[0] === 'COD-002' && codigos[1] === 'COD-003',
    };
  },
});

prueba({
  id: 'INVM-003', grupo: 'inventario', nombre: 'obtenerInventarioMovilApp calcula el mismo estado (Agotado/Bajo/Óptimo) que el resto del sistema',
  metodo: 'EMPÍRICO',
  objetivo: 'COD-003 (existencia=0) debe salir "Agotado", COD-002 (existencia=3 < mínimo=10) "Bajo", COD-001 (100 > mínimo) "Óptimo"',
  ejecutar() {
    const { entorno, token } = entornoConLogin();
    const resultado = entorno.invocar('obtenerInventarioMovilApp', { texto: 'COD' }, token);
    const porCodigo = {};
    resultado.forEach(r => { porCodigo[r.codigo] = r.estado; });

    return {
      datos: 'COD-001 existencia=100/mín=10, COD-002 existencia=3/mín=10, COD-003 existencia=0/mín=5',
      esperado: 'COD-001=Óptimo, COD-002=Bajo, COD-003=Agotado',
      obtenido: JSON.stringify(porCodigo),
      pasa: porCodigo['COD-001'] === 'Óptimo' && porCodigo['COD-002'] === 'Bajo' && porCodigo['COD-003'] === 'Agotado',
    };
  },
});

prueba({
  id: 'INVM-004', grupo: 'inventario', nombre: 'obtenerInventarioMovilApp nunca regresa productos sin ubicación',
  metodo: 'EMPÍRICO',
  objetivo: 'COD-004 no tiene ubicación (columna vacía) — no debe aparecer ni con texto vacío ni buscando su propio nombre',
  ejecutar() {
    const { entorno, token } = entornoConLogin();
    const resultado = entorno.invocar('obtenerInventarioMovilApp', { texto: 'SIN UBICACION' }, token);

    return {
      datos: 'COD-004 "PRODUCTO SIN UBICACION" con columna Ubicación vacía',
      esperado: 'resultado=[] (se excluye aunque el nombre coincida exactamente con la búsqueda)',
      obtenido: `resultado.length=${resultado.length}`,
      pasa: resultado.length === 0,
    };
  },
});

prueba({
  id: 'INVM-005', grupo: 'inventario', nombre: 'obtenerUbicacionesUnicasApp regresa ubicaciones únicas y ordenadas, sin vacíos',
  metodo: 'EMPÍRICO',
  objetivo: 'Con 3 productos ubicados y 1 sin ubicación, debe regresar exactamente las 3 ubicaciones no vacías, ordenadas',
  ejecutar() {
    const { entorno, token } = entornoConLogin();
    const resultado = entorno.invocar('obtenerUbicacionesUnicasApp', token);

    return {
      datos: 'Ubicaciones: R01-N01-P01, R02-N02-P01, R02-N03-P02, y una vacía (COD-004)',
      esperado: 'resultado=["R01-N01-P01","R02-N02-P01","R02-N03-P02"] (ordenado, sin la vacía)',
      obtenido: JSON.stringify(resultado),
      pasa: resultado.length === 3 && resultado.join(',') === 'R01-N01-P01,R02-N02-P01,R02-N03-P02',
    };
  },
});

prueba({
  id: 'INVM-006', grupo: 'inventario', nombre: 'obtenerInventarioMovilApp exige sesión activa igual que el resto del backend',
  metodo: 'EMPÍRICO',
  objetivo: 'Un token inválido/vacío debe rechazarse antes de tocar MATRIZ, igual que cualquier otra función *App',
  ejecutar() {
    const { entorno } = entornoConLogin();
    let lanzo = false;
    try { entorno.invocar('obtenerInventarioMovilApp', { texto: 'COD' }, 'token-invalido'); }
    catch (e) { lanzo = true; }

    return {
      datos: 'token="token-invalido" (no corresponde a ninguna sesión creada)',
      esperado: 'la función lanza un error (requerirSesionActivaApp_ rechaza el token)',
      obtenido: `lanzo=${lanzo}`,
      pasa: lanzo === true,
    };
  },
});
