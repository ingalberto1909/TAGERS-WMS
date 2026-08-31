'use strict';

/*
 * Auditoría de evolución continua: ProgramacionConteos.gs (generarConteosDelDia,
 * guardarProgramacion) está completo pero HUÉRFANO — nada en 📁 App.gs.gs,
 * index.html ni triggers instalados lo invoca (confirmado con grep cruzado).
 * Al revisarlo para decidir si era seguro conectarlo a un trigger diario, se
 * encontró que su llamada a registrarAuditoria() pasaba solo 3 argumentos
 * posicionales cuando la función real recibe 9 (usuario, modulo, accion,
 * folio, codigo, producto, cantidadAnterior, cantidadNueva, observacion) —
 * habría escrito filas de auditoría con las columnas corridas y Diferencia=NaN
 * en cuanto alguien lo conectara. Se corrigió el bug (código nunca antes
 * ejecutado en producción, cero riesgo de romper algo existente), pero
 * NO se instaló ningún trigger — conectar la generación automática es una
 * decisión de negocio pendiente (atribución del usuario "Sistema", horario,
 * si debe reusar el flujo más completo de generarConteoRacksApp que sí
 * registra CONTROL_CONTEOS). Esta prueba solo confirma que, llamada
 * manualmente, la función ya no corrompe AUDITORIA.
 */

const { prueba } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase } = require('../lib/datos-prueba');

const DIAS_SEMANA_ = ['DOMINGO', 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'];

prueba({
  id: 'LEG-010', grupo: 'legado', nombre: 'generarConteosDelDia ya no corrompe AUDITORIA (bug de argumentos corregido)', metodo: 'EMPÍRICO',
  objetivo: 'La llamada a registrarAuditoria dentro de generarConteosDelDia debe usar los 9 parámetros reales, en el orden correcto, para que la fila de AUDITORIA quede completa y legible',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const diaHoy = DIAS_SEMANA_[new Date().getDay()];

    entorno.hojas.PROGRAMACION_CONTEOS._filas().push(['PC-0001', 'A', diaHoy, 'DIARIA', 'Admin', 'ACTIVO', '']);

    const auditoriaAntes = entorno.leerHoja('AUDITORIA').length;
    const resultado = entorno.invocar('generarConteosDelDia');
    const auditoria = entorno.leerHoja('AUDITORIA');
    // generarConteoRacks (Código.gs) también deja su propia fila de
    // auditoría de la generación del conteo en sí — la fila que interesa
    // aquí es la que agrega ESTE archivo (acción "GENERACION CONTEO
    // PROGRAMADA"), no necesariamente la última.
    const filasNuevas = auditoria.slice(auditoriaAntes);
    const filaProgramada = filasNuevas.find(f => f[5] === 'GENERACION CONTEO PROGRAMADA');

    const columnasOk = filaProgramada
      && filaProgramada[3] === 'Sistema (programación automática)' // Usuario
      && filaProgramada[4] === 'CONTEO'                              // Módulo
      && filaProgramada[6] === 'A'                                   // Folio (racks del día)
      && Number.isFinite(Number(filaProgramada[11]));                // Diferencia no debe ser NaN

    return {
      datos: `PROGRAMACION_CONTEOS con 1 programa ACTIVO para hoy (${diaHoy}), rack A`,
      esperado: 'generarConteosDelDia genera el conteo (generado=true) y deja una fila bien formada en AUDITORIA para la acción "GENERACION CONTEO PROGRAMADA", sin columnas corridas ni NaN',
      obtenido: `generado=${resultado.generado}, filasNuevasAuditoria=${filasNuevas.length}, ` +
        `usuario=${filaProgramada && filaProgramada[3]}, modulo=${filaProgramada && filaProgramada[4]}, ` +
        `folio=${filaProgramada && filaProgramada[6]}, diferencia=${filaProgramada && filaProgramada[11]}`,
      pasa: resultado.generado === true && columnasOk,
    };
  },
});

prueba({
  id: 'LEG-011', grupo: 'legado', nombre: 'generarConteosDelDia no genera dos veces el mismo día', metodo: 'EMPÍRICO',
  objetivo: 'Si "Última generación" ya es hoy, una segunda llamada el mismo día no debe volver a generar ni a duplicar auditoría',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const diaHoy = DIAS_SEMANA_[new Date().getDay()];

    entorno.hojas.PROGRAMACION_CONTEOS._filas().push(['PC-0001', 'A', diaHoy, 'DIARIA', 'Admin', 'ACTIVO', '']);

    const primera = entorno.invocar('generarConteosDelDia');
    const auditoriaTrasPrimera = entorno.leerHoja('AUDITORIA').length;
    const segunda = entorno.invocar('generarConteosDelDia');
    const auditoriaTrasSegunda = entorno.leerHoja('AUDITORIA').length;

    return {
      datos: 'generarConteosDelDia llamada 2 veces seguidas el mismo día',
      esperado: '1ª: generado=true. 2ª: generado=false (ya se generó hoy), sin fila nueva en AUDITORIA',
      obtenido: `1ª.generado=${primera.generado}, 2ª.generado=${segunda.generado}, auditoriaTrasPrimera=${auditoriaTrasPrimera}, auditoriaTrasSegunda=${auditoriaTrasSegunda}`,
      pasa: primera.generado === true && segunda.generado === false && auditoriaTrasSegunda === auditoriaTrasPrimera,
    };
  },
});
