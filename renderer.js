const { ipcRenderer } = require('electron');

// Elementos del DOM
const fechaInicio = document.getElementById('fechaInicio');
const fechaFin = document.getElementById('fechaFin');
const btnFiltrar = document.getElementById('btnFiltrar');
const btnExportarExcel = document.getElementById('btnExportarExcel');
const btnImprimir = document.getElementById('btnImprimir');
const totalEfectivo = document.getElementById('totalEfectivo');
const totalCtaCte = document.getElementById('totalCtaCte');
const totalTarjetas = document.getElementById('totalTarjetas');
const totalRecibos = document.getElementById('totalRecibos');
const tablaTarjetas = document.getElementById('tablaTarjetas');
const tablaMovimientos = document.getElementById('tablaMovimientos');
const totalEfectivoEnCaja = document.getElementById('totalEfectivoEnCaja');
const periodo = document.getElementById('periodo');
const nombreFarmacia = document.getElementById('nombreFarmacia');
const totalRecibosEfectivo = document.getElementById('totalRecibosEfectivo');
const totalRecibosTarjetas = document.getElementById('totalRecibosTarjetas');


// Función para formatear números como moneda
function formatearMoneda(valor) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS'
  }).format(valor || 0);
}

// Función para formatear fechas
function formatearFecha(fecha) {
  return new Date(fecha).toLocaleDateString('es-AR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false // Esto fuerza el formato 24hs
  });
}

// Función para actualizar la tabla de tarjetas
function actualizarTablaTarjetas(tarjetas) {
  tablaTarjetas.innerHTML = '';
  tarjetas.forEach(tarjeta => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td class="px-6 py-4 print:py-1 whitespace-nowrap text-sm print:text-xs text-gray-900">${tarjeta.DESCRIPCION.trim()}</td>
      <td class="px-6 py-4 print:py-1 whitespace-nowrap text-sm print:text-xs text-gray-900">${formatearMoneda(tarjeta.TOTAL_CON_RECIBOS)}</td>
    `;
    tablaTarjetas.appendChild(row);
  });
}

function actualizarTablaMovimientos(movimientos) {
  tablaMovimientos.innerHTML = '';

  let total = 0;

  movimientos.forEach(mov => {
    total += mov.IMPORTE;

    const row = document.createElement('tr');
    row.innerHTML = `
      <td class="px-6 py-4 print:py-1 whitespace-nowrap text-sm print:text-xs text-gray-900">${formatearFecha(mov.FECHA)}</td>
      <td class="px-6 py-4 print:py-1 whitespace-nowrap text-sm print:text-xs text-gray-900">${mov.TIPO_MOVIMIENTO.trim()}</td>
      <td class="px-6 py-4 print:py-1 whitespace-nowrap text-sm print:text-xs text-gray-900">${formatearMoneda(mov.IMPORTE)}</td>
      <td class="px-6 py-4 print:py-1 whitespace-nowrap text-sm print:text-xs text-gray-900">${mov.MOTIVO || ''}</td>
    `;
    tablaMovimientos.appendChild(row);
  });

  const rowFinal = document.createElement('tr');
  rowFinal.innerHTML = `
    <td class="px-6 py-4 print:py-1 whitespace-nowrap text-sm print:text-xs font-bold text-gray-900">Total movimientos caja:</td>
    <td class="px-6 py-4 print:py-1 whitespace-nowrap text-sm print:text-xs text-gray-900"></td>
    <td class="px-6 py-4 print:py-1 whitespace-nowrap text-sm print:text-xs font-bold text-gray-900">${formatearMoneda(total)}</td>
    <td class="px-6 py-4 print:py-1 whitespace-nowrap text-sm print:text-xs text-gray-900"></td>
  `;
  tablaMovimientos.appendChild(rowFinal);
}


// Función para exportar a Excel
async function exportarExcel() {
  try {
    const fechaInicioValor = fechaInicio.value;
    const fechaFinValor = fechaFin.value;

    await ipcRenderer.invoke('exportar-excel', {
      fechaInicio: fechaInicioValor,
      fechaFin: fechaFinValor
    });
  } catch (error) {
    console.error('Error al exportar a Excel:', error);
    alert('Error al exportar a Excel. Por favor, intente nuevamente.');
  }
}

// Función para imprimir
function imprimir() {
  window.print();
}

// Función para cargar los datos
async function cargarDatos() {
  try {
    const fechaInicioValor = fechaInicio.value;
    const fechaFinValor = fechaFin.value;

    if (!fechaInicioValor || !fechaFinValor) {
      alert('Por favor, seleccione ambas fechas');
      return;
    }

    const datos = await ipcRenderer.invoke('get-totales', {
      fechaInicio: fechaInicioValor,
      fechaFin: fechaFinValor
    });

    // Usar valores por defecto en caso de que alguna propiedad no exista
    const totalEfectivoVal = datos.totales?.TOTAL_EFECTIVO ?? 0;
    const totalCtaCteVal = datos.totales?.TOTAL_CTACTE ?? 0;
    const totalTarjetasVal = datos.totales?.TOTAL_TARJETAS ?? 0;
    const totalRecibosEfectivoVal = datos.totales?.TOTAL_RECIBOS_EFECTIVO ?? 0;
    const totalRecibosTarjetasVal = datos.totales?.TOTAL_RECIBOS_TARJETAS ?? 0;
    const totalRecibosVal = datos.totales?.TOTAL_RECIBOS ?? 0;
    const totalMovCaja = datos.movimientos?.[datos.movimientos.length - 1]?.TOTAL_GENERAL ?? 0;

    // Actualizar totales
    totalEfectivo.textContent = formatearMoneda(totalEfectivoVal);
    totalCtaCte.textContent = formatearMoneda(totalCtaCteVal);
    totalTarjetas.textContent = formatearMoneda(totalTarjetasVal);
    totalRecibosEfectivo.textContent = formatearMoneda(totalRecibosEfectivoVal);
    totalRecibosTarjetas.textContent = formatearMoneda(totalRecibosTarjetasVal);
    totalRecibos.textContent = formatearMoneda(totalRecibosVal);
    totalEfectivoEnCaja.textContent = formatearMoneda(totalEfectivoVal + totalRecibosEfectivoVal + totalMovCaja);

    // Actualizar tablas
    actualizarTablaTarjetas(datos.tarjetas ?? []);
    actualizarTablaMovimientos(datos.movimientos ?? []);

    // Actualizar periodo
    periodo.textContent = `${formatearFecha(fechaInicioValor)}hs - ${formatearFecha(fechaFinValor)}hs`;
  } catch (error) {
    console.error('Error al cargar datos:', error);
    alert('Error al cargar los datos. Por favor, revise las fechas seleccionadas.');
  }
}


// Event listeners
btnFiltrar.addEventListener('click', cargarDatos);
// Ejecutar con Enter en inputs de fecha
[fechaInicio, fechaFin].forEach(input => {
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault(); // Previene comportamientos inesperados
      cargarDatos();
    }
  });
});
btnExportarExcel.addEventListener('click', exportarExcel);
btnImprimir.addEventListener('click', imprimir);

// Establecer fechas por defecto (hoy)
const hoy = new Date();
const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 0, 0, 0);
const finHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59);

// Función para formatear fecha para input datetime-local
function formatearFechaInput(fecha) {
  const year = fecha.getFullYear();
  const month = String(fecha.getMonth() + 1).padStart(2, '0');
  const day = String(fecha.getDate()).padStart(2, '0');
  const hours = String(fecha.getHours()).padStart(2, '0');
  const minutes = String(fecha.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

fechaInicio.value = formatearFechaInput(inicioHoy);
fechaFin.value = formatearFechaInput(finHoy);

// Cargar nombre de la farmacia
ipcRenderer.invoke('get-nombre-farmacia').then(nombre => {
  nombreFarmacia.textContent = nombre;
});

// Cargar datos iniciales
cargarDatos();