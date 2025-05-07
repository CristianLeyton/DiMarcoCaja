const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const Firebird = require('node-firebird');
const XLSX = require('xlsx');
const fs = require('fs');
const ExcelJS = require('exceljs');


const options = {
  host: '127.0.0.1',
  port: 3050,
  database: 'C:/winfarma/data/winfarma',
  user: 'SYSDBA',
  password: '.',
  lowercase_keys: false,
  role: null,
  pageSize: 4096
};

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Crear el menú personalizado
  const menu = Menu.buildFromTemplate([
    {
      label: 'Archivo',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R', // Puedes cambiar el atajo de teclado si lo deseas
          click: () => {
            mainWindow.reload();
          },
        },
        {
          label: 'Exit',
          accelerator: 'CmdOrCtrl+Q', // Puedes cambiar el atajo de teclado si lo deseas
          click: () => {
            app.quit();
          },
        },
      ],
    },
  ]);

  // Cambiar el menú superior
  mainWindow.setMenu(menu);

  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Función para ejecutar consultas SQL
function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    Firebird.attach(options, (err, db) => {
      if (err) {
        reject(err);
        return;
      }

      db.query(sql, params, (err, result) => {
        db.detach();
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });
  });
}

// Función para formatear números como moneda
function formatearMoneda(valor) {
  return valor;
}

// Función para formatear fechas
function formatearFecha(fecha) {
  return new Date(fecha).toLocaleString('es-AR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false // Esto fuerza el formato 24hs
  });
}

// Manejador para obtener los totales
ipcMain.handle('get-totales', async (event, { fechaInicio, fechaFin }) => {
  try {
    // Consulta para obtener totales de ventas, notas de crédito y recibos
    const sqlVentas = `
      WITH Ventas AS (
        SELECT 
          TOTALEFECTIVO,
          TOTALCTACTE,
          TOTALBRUTO,
          FECHA,
          ESTADO
        FROM FAC_MAESTRO
        WHERE FECHA BETWEEN ? AND ?
        AND ESTADO = 0
      ),
      NotasCredito AS (
        SELECT 
          -TOTALEFECTIVO as TOTALEFECTIVO,
          -TOTALCTACTE as TOTALCTACTE,
          -TOTALIMPORTE as TOTALBRUTO,
          FECHA,
          ESTADO
        FROM CRED_MAESTRO
        WHERE FECHA BETWEEN ? AND ?
        AND ESTADO = 0
      )
      SELECT 
        COALESCE(SUM(TOTALEFECTIVO), 0) as TOTAL_EFECTIVO,
        COALESCE(SUM(TOTALCTACTE), 0) as TOTAL_CTACTE,
        COALESCE(SUM(TOTALBRUTO - TOTALEFECTIVO - TOTALCTACTE), 0) as TOTAL_TARJETAS
      FROM (
        SELECT * FROM Ventas
        UNION ALL
        SELECT * FROM NotasCredito
      ) f`;

    // Consulta separada para recibos
    const sqlRecibos = `
      SELECT 
        COALESCE(SUM(IMPEFECTIVO), 0) as TOTAL_EFECTIVO,
        COALESCE(SUM(IMPORTE - IMPEFECTIVO - IMPTARJETA), 0) as TOTAL_CTACTE,
        COALESCE(SUM(IMPTARJETA), 0) as TOTAL_TARJETAS,
        COALESCE(SUM(IMPORTE), 0) as TOTAL_RECIBOS
      FROM RECIBOS
      WHERE FECHA BETWEEN ? AND ?
      AND ESTADO = 0`;

    // Consulta para obtener detalle de tarjetas incluyendo NC
    const sqlTarjetas = `SELECT
    TARJ.ID AS TARJETA_ID,
    TARJ.DESCRIPCION,
    COALESCE(SUM(FAC.TOTALCUPONES), 0) AS TOTAL_VENTAS,
    COALESCE(SUM(NC.TOTAL_NC), 0) AS TOTAL_NC,
    COALESCE(SUM(FAC.TOTALCUPONES), 0) - COALESCE(SUM(NC.TOTAL_NC), 0) AS NETO
FROM TARJ_MAESTRO TARJ
LEFT JOIN FAC_MAESTRO FAC 
    ON FAC.TARJETA = TARJ.ID
    AND FAC.FECHA BETWEEN ? AND ?
    AND FAC.ESTADO = 0

LEFT JOIN (
    SELECT
        CD.TIPOFACTURA,
        CD.SUCURSALFACTURA,
        CD.NUMEROFACTURA,
        SUM(CM.TOTALCUPONES) AS TOTAL_NC
    FROM CRED_MAESTRO CM
    JOIN CRED_DETALLE CD 
        ON CD.TIPOCREDITO = CM.TIPO
        AND CD.SUCURSALCREDITO = CM.SUCURSAL
        AND CD.NUMEROCREDITO = CM.NUMERO
    WHERE CM.FECHA BETWEEN ? AND ?
      AND CM.ESTADO = 0
    GROUP BY CD.TIPOFACTURA, CD.SUCURSALFACTURA, CD.NUMEROFACTURA
) NC ON NC.TIPOFACTURA = FAC.TIPO
     AND NC.SUCURSALFACTURA = FAC.SUCURSAL
     AND NC.NUMEROFACTURA = FAC.NUMERO

GROUP BY TARJ.ID, TARJ.DESCRIPCION
ORDER BY TARJ.DESCRIPCION;
`;

    // Consulta separada para tarjetas de recibos
    const sqlTarjetasRecibos = `
      SELECT 
        t.DESCRIPCION,
        COALESCE(SUM(r.IMPTARJETA), 0) as TOTAL
      FROM RECIBOS r
      LEFT JOIN TARJ_MAESTRO t ON r.TARJETA = t.ID
      WHERE r.FECHA BETWEEN ? AND ?
      AND r.ESTADO = 0
      AND r.TARJETA > 0
      GROUP BY t.DESCRIPCION
      HAVING COALESCE(SUM(r.IMPTARJETA), 0) > 0`;

    // Consulta para obtener movimientos de caja
    const sqlMovimientos = `
      SELECT 
  m.FECHA,
  COALESCE(t.DESCRIPCION, 'Sin descripción') AS TIPO_MOVIMIENTO,
  CASE 
    WHEN m.TIPOMOV = 1 THEN m.IMPORTE
    ELSE -m.IMPORTE
  END AS IMPORTE,
  COALESCE(m.MOTIVO, '') AS MOTIVO,
  (
    SELECT 
      SUM(
        CASE 
          WHEN m2.TIPOMOV = 1 THEN m2.IMPORTE
          ELSE -m2.IMPORTE
        END
      )
    FROM CAJA_MOVIMIENTOS m2
    WHERE m2.FECHA BETWEEN ? AND ?
  ) AS TOTAL_GENERAL
FROM CAJA_MOVIMIENTOS m
LEFT JOIN CAJA_TIPOSMOVIMIENTOS t ON m.TIPOMOV = t.ID
WHERE m.FECHA BETWEEN ? AND ?
ORDER BY m.FECHA ASC
`;

    console.log('Ejecutando consultas con fechas:', { fechaInicio, fechaFin });

    const [totalesVentas, totalesRecibos, tarjetasVentas, tarjetasRecibos, movimientos] = await Promise.all([
      query(sqlVentas, [fechaInicio, fechaFin, fechaInicio, fechaFin]),
      query(sqlRecibos, [fechaInicio, fechaFin]),
      query(sqlTarjetas, [fechaInicio, fechaFin, fechaInicio, fechaFin]),
      query(sqlTarjetasRecibos, [fechaInicio, fechaFin]),
      query(sqlMovimientos, [fechaInicio, fechaFin, fechaInicio, fechaFin])
    ]);

    // Combinar totales
    const totales = {
      TOTAL_EFECTIVO: (totalesVentas[0]?.TOTAL_EFECTIVO || 0),
      TOTAL_CTACTE: (totalesVentas[0]?.TOTAL_CTACTE || 0),
      TOTAL_TARJETAS: (totalesVentas[0]?.TOTAL_TARJETAS),
      TOTAL_RECIBOS_EFECTIVO: totalesRecibos[0]?.TOTAL_EFECTIVO || 0,
      TOTAL_RECIBOS_TARJETAS: totalesRecibos[0]?.TOTAL_TARJETAS || 0,
      TOTAL_RECIBOS: totalesRecibos[0]?.TOTAL_RECIBOS || 0
    };

    const tarjetas = [...tarjetasVentas].map(t => ({
      ...t,
      DESCRIPCION: t.DESCRIPCION.trim(),
      TOTAL: t.NETO, // mantenemos este como valor base
      TOTAL_CON_RECIBOS: t.NETO // inicializamos con el NETO
    }));

    tarjetasRecibos.forEach(recibo => {
      const descripcion = recibo.DESCRIPCION.trim();
      const existente = tarjetas.find(t => t.DESCRIPCION === descripcion);
    
      if (existente) {
        existente.TOTAL_CON_RECIBOS += recibo.TOTAL;
      } else {
        tarjetas.push({
          TARJETA_ID: null,
          DESCRIPCION: descripcion,
          TOTAL_VENTAS: 0,
          TOTAL_NC: 0,
          NETO: 0,
          TOTAL: 0,
          TOTAL_CON_RECIBOS: recibo.TOTAL
        });
      }
    });


    console.log('Resultados:', { totales, tarjetas, movimientos });

    return {
      totales,
      tarjetas,
      movimientos
    };
  } catch (error) {
    console.error('Error al obtener datos:', error);
    throw error;
  }
});

// Función reutilizable
async function obtenerNombreFarmacia() {
  const resultado = await query('SELECT VALOR FROM WFCFG WHERE ID = 202');
  return resultado[0]?.VALOR || 'Sin nombre';
}

// Manejador principal
ipcMain.handle('get-nombre-farmacia', async () => {
  try {
    const nombreFarmacia = await obtenerNombreFarmacia();
    console.log('Farmacia: ', nombreFarmacia);
    return nombreFarmacia;
  } catch (error) {
    console.error('Error al obtener el nombre de la farmacia:', error);
    throw error;
  }
});

// Manejador para exportar a Excel
ipcMain.handle('exportar-excel', async (event, { fechaInicio, fechaFin }) => {
  try {

    let nombreFarmacia = await obtenerNombreFarmacia();
    nombreFarmacia = nombreFarmacia.trim();

    // Formatear fecha para el nombre del archivo
    const formatearFechaArchivo = (fecha) => {
      const d = new Date(fecha);
      return `${d.getDate().toString().padStart(2, '0')}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getFullYear()}_${d.getHours().toString().padStart(2, '0')}${d.getMinutes().toString().padStart(2, '0')}`;
    };

    const { filePath } = await dialog.showSaveDialog({
      title: 'Guardar archivo Excel',
      defaultPath: path.join(app.getPath('documents'), `Informe-caja_${nombreFarmacia}_${formatearFechaArchivo(fechaInicio)}_${formatearFechaArchivo(fechaFin)}.xlsx`),
      filters: [
        { name: 'Excel Files', extensions: ['xlsx'] }
      ]
    });

    if (!filePath) return;

    // Obtener los datos
    const datos = await query(`
      WITH Ventas AS (
        SELECT 
          TOTALEFECTIVO,
          TOTALCTACTE,
          TOTALBRUTO,
          FECHA,
          ESTADO
        FROM FAC_MAESTRO
        WHERE FECHA BETWEEN ? AND ?
        AND ESTADO = 0
      ),
      NotasCredito AS (
        SELECT 
          -TOTALEFECTIVO as TOTALEFECTIVO,
          -TOTALCTACTE as TOTALCTACTE,
          -TOTALIMPORTE as TOTALBRUTO,
          FECHA,
          ESTADO
        FROM CRED_MAESTRO
        WHERE FECHA BETWEEN ? AND ?
        AND ESTADO = 0
      )
      SELECT 
        COALESCE(SUM(TOTALEFECTIVO), 0) as TOTAL_EFECTIVO,
        COALESCE(SUM(TOTALCTACTE), 0) as TOTAL_CTACTE,
        COALESCE(SUM(TOTALBRUTO - TOTALEFECTIVO - TOTALCTACTE), 0) as TOTAL_TARJETAS
      FROM (
        SELECT * FROM Ventas
        UNION ALL
        SELECT * FROM NotasCredito
      ) f`, [fechaInicio, fechaFin, fechaInicio, fechaFin]);

    const recibos = await query(`
      SELECT 
        COALESCE(SUM(IMPEFECTIVO), 0) as TOTAL_EFECTIVO,
        COALESCE(SUM(IMPORTE - IMPEFECTIVO - IMPTARJETA), 0) as TOTAL_CTACTE,
        COALESCE(SUM(IMPTARJETA), 0) as TOTAL_TARJETAS,
        COALESCE(SUM(IMPORTE), 0) as TOTAL_RECIBOS
      FROM RECIBOS
      WHERE FECHA BETWEEN ? AND ?
      AND ESTADO = 0`, [fechaInicio, fechaFin]);

    const tarjetas = await query(`SELECT
    TARJ.ID AS TARJETA_ID,
    TARJ.DESCRIPCION,
    COALESCE(SUM(FAC.TOTALCUPONES), 0) AS TOTAL_VENTAS,
    COALESCE(SUM(NC.TOTAL_NC), 0) AS TOTAL_NC,
    COALESCE(SUM(FAC.TOTALCUPONES), 0) - COALESCE(SUM(NC.TOTAL_NC), 0) AS NETO
FROM TARJ_MAESTRO TARJ
LEFT JOIN FAC_MAESTRO FAC 
    ON FAC.TARJETA = TARJ.ID
    AND FAC.FECHA BETWEEN ? AND ?
    AND FAC.ESTADO = 0

LEFT JOIN (
    SELECT
        CD.TIPOFACTURA,
        CD.SUCURSALFACTURA,
        CD.NUMEROFACTURA,
        SUM(CM.TOTALCUPONES) AS TOTAL_NC
    FROM CRED_MAESTRO CM
    JOIN CRED_DETALLE CD 
        ON CD.TIPOCREDITO = CM.TIPO
        AND CD.SUCURSALCREDITO = CM.SUCURSAL
        AND CD.NUMEROCREDITO = CM.NUMERO
    WHERE CM.FECHA BETWEEN ? AND ?
      AND CM.ESTADO = 0
    GROUP BY CD.TIPOFACTURA, CD.SUCURSALFACTURA, CD.NUMEROFACTURA
) NC ON NC.TIPOFACTURA = FAC.TIPO
     AND NC.SUCURSALFACTURA = FAC.SUCURSAL
     AND NC.NUMEROFACTURA = FAC.NUMERO

GROUP BY TARJ.ID, TARJ.DESCRIPCION
ORDER BY TARJ.DESCRIPCION;`, [fechaInicio, fechaFin, fechaInicio, fechaFin]);

    const tarjetasRecibos = await query(`
      SELECT 
        t.DESCRIPCION,
        COALESCE(SUM(r.IMPTARJETA), 0) as TOTAL
      FROM RECIBOS r
      LEFT JOIN TARJ_MAESTRO t ON r.TARJETA = t.ID
      WHERE r.FECHA BETWEEN ? AND ?
      AND r.ESTADO = 0
      AND r.TARJETA > 0
      GROUP BY t.DESCRIPCION
      HAVING COALESCE(SUM(r.IMPTARJETA), 0) > 0`, [fechaInicio, fechaFin]);

    const movimientos = await query(`
      SELECT 
  m.FECHA,
  COALESCE(t.DESCRIPCION, 'Sin descripción') AS TIPO_MOVIMIENTO,
  CASE 
    WHEN m.TIPOMOV = 1 THEN m.IMPORTE
    ELSE -m.IMPORTE
  END AS IMPORTE,
  COALESCE(m.MOTIVO, '') AS MOTIVO,
  (
    SELECT 
      SUM(
        CASE 
          WHEN m2.TIPOMOV = 1 THEN m2.IMPORTE
          ELSE -m2.IMPORTE
        END
      )
    FROM CAJA_MOVIMIENTOS m2
    WHERE m2.FECHA BETWEEN ? AND ?
  ) AS TOTAL_GENERAL
FROM CAJA_MOVIMIENTOS m
LEFT JOIN CAJA_TIPOSMOVIMIENTOS t ON m.TIPOMOV = t.ID
WHERE m.FECHA BETWEEN ? AND ?
ORDER BY m.FECHA ASC;
`, [fechaInicio, fechaFin, fechaInicio, fechaFin]);

    // Combinar totales
    const totales = {
      TOTAL_EFECTIVO: (datos[0]?.TOTAL_EFECTIVO || 0),
      TOTAL_CTACTE: (datos[0]?.TOTAL_CTACTE || 0),
      TOTAL_TARJETAS: (datos[0]?.TOTAL_TARJETAS || 0),
      TOTAL_RECIBOS_EFECTIVO: recibos[0]?.TOTAL_EFECTIVO || 0,
      TOTAL_RECIBOS_TARJETAS: recibos[0]?.TOTAL_TARJETAS || 0,
      TOTAL_RECIBOS: recibos[0]?.TOTAL_RECIBOS || 0
    };

// Primero, actualizamos los datos de tarjetas con los recibos
tarjetasRecibos.forEach(recibo => {
  const descripcion = recibo.DESCRIPCION.trim();
  const existente = tarjetas.find(t => t.DESCRIPCION.trim() === descripcion);
  
  if (existente) {
    existente.TOTAL_CON_RECIBOS = (existente.TOTAL_CON_RECIBOS || existente.NETO) + recibo.TOTAL;
  } else {
    tarjetas.push({
      TARJETA_ID: null,
      DESCRIPCION: descripcion,
      TOTAL_VENTAS: 0,
      TOTAL_NC: 0,
      NETO: 0,
      TOTAL: 0,
      TOTAL_CON_RECIBOS: recibo.TOTAL
    });
  }
});

// Luego, generamos la lista final para imprimir
const todasTarjetas = tarjetas.map(t => ({
  ...t,
  DESCRIPCION: t.DESCRIPCION.trim(),
  TOTAL: t.NETO,
  TOTAL_CON_RECIBOS: t.TOTAL_CON_RECIBOS ?? t.NETO
}));

    // Crear el archivo Excel
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Informe de Caja - ' + nombreFarmacia);

    // Establecer anchos de columna
    worksheet.columns = [
      { header: '', key: 'col1', width: 20 },
      { header: '', key: 'col2', width: 30 },
      { header: '', key: 'col3', width: 20 },
      { header: '', key: 'col4', width: 40 }
    ];

    // Título
    worksheet.mergeCells('A1:D1');
    const titulo = worksheet.getCell('A1');
    titulo.value = 'INFORME DE CAJA - ' + nombreFarmacia;
    titulo.font = { size: 16, bold: true };
    titulo.alignment = { horizontal: 'center' };

    // Período
    worksheet.mergeCells('A2:D2');
    const periodo = worksheet.getCell('A2');
    periodo.value = `Período: ${formatearFecha(fechaInicio)} - ${formatearFecha(fechaFin)}`;
    periodo.font = { size: 12 };
    periodo.alignment = { horizontal: 'center' };

    // Espacio
    worksheet.addRow([]);

    // Totales
    worksheet.addRow(['RESUMEN DE TOTALES', '', '', '']);
    worksheet.addRow(['Total ventas Efectivo', '', formatearMoneda(totales.TOTAL_EFECTIVO)], '');
    worksheet.addRow(['Total ventas Tarjetas', '', formatearMoneda(totales.TOTAL_TARJETAS)], '');
    worksheet.addRow(['Total ventas Cuenta Corriente', '', formatearMoneda(totales.TOTAL_CTACTE)], '');
    worksheet.addRow(['Total Recibos Efectivo', '', formatearMoneda(totales.TOTAL_RECIBOS_EFECTIVO)], '');
    worksheet.addRow(['Total Recibos Tarjetas', '', formatearMoneda(totales.TOTAL_RECIBOS_TARJETAS)], '');
    worksheet.addRow(['Total Recibos', '', formatearMoneda(totales.TOTAL_RECIBOS)], '');

    // Espacio
    worksheet.addRow([]);

    // Detalle de Tarjetas
    worksheet.addRow(['DETALLE DE TARJETAS', '', '', '']);
    todasTarjetas.forEach(tarjeta => {
      worksheet.addRow([tarjeta.DESCRIPCION.trim(), '', formatearMoneda(tarjeta.TOTAL_CON_RECIBOS)], '');
    });

    // Espacio
    worksheet.addRow([]);

    /*     // Total General
        const totalGeneral = totales.TOTAL_EFECTIVO + totales.TOTAL_CTACTE + totales.TOTAL_TARJETAS + totales.TOTAL_RECIBOS;
        worksheet.addRow(['TOTAL GENERAL', '', '', formatearMoneda(totalGeneral)]);
     */
    // Espacio
    worksheet.addRow([]);
    worksheet.addRow([]);

    // Movimientos de Caja
    worksheet.addRow(['MOVIMIENTOS DE CAJA', '', '', '']);
    worksheet.addRow(['Fecha', 'Tipo', 'Importe', 'Motivo']);
    movimientos.forEach(mov => {
      worksheet.addRow([
        formatearFecha(mov.FECHA),
        mov.TIPO_MOVIMIENTO.trim(),
        formatearMoneda(mov.IMPORTE),
        mov.MOTIVO.trim()
      ]);
    });
    worksheet.addRow(['Total movimientos caja', '', formatearMoneda(movimientos[movimientos.length - 1].TOTAL_GENERAL)], '');

    // Espacio
    worksheet.addRow([]);
    worksheet.addRow([]);   

    // Suma de efectivo
    worksheet.addRow(['TOTAL EFECTIVO EN CAJA', '', formatearMoneda(totales.TOTAL_EFECTIVO + totales.TOTAL_RECIBOS_EFECTIVO + movimientos[movimientos.length - 1].TOTAL_GENERAL)], '');

    // Estilo para los encabezados
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(2).font = { bold: true };
    worksheet.getRow(4).font = { bold: true };
    worksheet.getRow(12).font = { bold: true };
    worksheet.getRow(16 + todasTarjetas.length).font = { bold: true };
    worksheet.getRow(17 + todasTarjetas.length).font = { bold: true };
    worksheet.getRow(17 + todasTarjetas.length + movimientos.length + 1).font = { bold: true };
    worksheet.getRow(20 + todasTarjetas.length + movimientos.length + 1).font = { bold: true };
    

    // Guardar el archivo
    await workbook.xlsx.writeFile(filePath);

    return { success: true };
  } catch (error) {
    console.error('Error al exportar a Excel:', error);
    throw error;
  }
});



