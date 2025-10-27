// ====================================================================
// Parámetros de Google Sheets
// ====================================================================
const SHEET_ID = "13mzYK7HsvwiKyMXDpZJ3d1fLRvkwPYbOKUeedYSUh68";
const SHEET_NAME = "Registros";

// Endpoint CSV público de la hoja
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`;

// ====================================================================
// Estado global en memoria (datos crudos y filtrados)
// ====================================================================
let DATA_ORIGINAL = [];   // registros completos
let DATA_FILTRADA = [];   // registros luego de aplicar filtros activos
let chartDiaFarmacia = null; // instancia Chart.js

// ====================================================================
// Utilidades de parseo y formateo
// ====================================================================

// Parser CSV robusto hecho a mano (evita dependencias adicionales)
function parseCSV(text) {
    const rows = [];
    let current = [];
    let value = "";
    let insideQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        const next = text[i + 1];

        if (c === '"' && insideQuotes && next === '"') {
            value += '"';
            i++;
        } else if (c === '"') {
            insideQuotes = !insideQuotes;
        } else if (c === "," && !insideQuotes) {
            current.push(value);
            value = "";
        } else if ((c === "\n" || c === "\r") && !insideQuotes) {
            if (value !== "" || current.length > 0) {
                current.push(value);
                rows.push(current);
                current = [];
                value = "";
            }
            if (c === "\r" && next === "\n") {
                i++;
            }
        } else {
            value += c;
        }
    }

    if (value !== "" || current.length > 0) {
        current.push(value);
        rows.push(current);
    }
    return rows;
}

// Fecha "dd/mm/yyyy" -> Date
function parseFechaDIA(str) {
    if (!str || typeof str !== "string") return null;
    const parts = str.trim().split("/");
    if (parts.length !== 3) return null;
    const [dd, mm, yyyy] = parts.map(s => s.trim());
    const day = parseInt(dd, 10);
    const mon = parseInt(mm, 10) - 1;
    const yr = parseInt(yyyy, 10);
    const d = new Date(yr, mon, day);
    if (isNaN(d.getTime())) return null;
    return d;
}

// Timestamp "dd/mm/yyyy hh:mm:ss" -> Date
function parseFechaTimestamp(str) {
    if (!str || typeof str !== "string") return null;
    const [fechaParte, horaParte] = str.trim().split(" ");
    if (!fechaParte) return null;
    const base = parseFechaDIA(fechaParte);
    if (!base) return null;
    if (!horaParte) return base;
    const [hh, mi, ss] = horaParte.split(":").map(x => parseInt(x, 10));
    if (
        Number.isFinite(hh) &&
        Number.isFinite(mi) &&
        Number.isFinite(ss)
    ) {
        base.setHours(hh, mi, ss, 0);
    }
    return base;
}

// Date -> "DD/MM/YYYY"
function toDMY(d) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return "";
    const da = String(d.getDate()).padStart(2, "0");
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const y = d.getFullYear();
    return `${da}/${m}/${y}`;
}

// Date -> "YYYY-MM-DD" (para filtros <input type="date">)
function toISODate(d) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${da}`;
}

function normStr(x) {
    if (x === null || x === undefined) return "";
    return String(x).trim();
}

// Cantidad numérica
function toNumber(x) {
    if (x === null || x === undefined || x === "") return 0;
    const n = Number(String(x).replace(",", "."));
    return Number.isFinite(n) ? n : 0;
}

// ====================================================================
// Carga de datos desde Google Sheets (CSV público)
// ====================================================================
async function cargarDatos() {
    const resp = await fetch(CSV_URL, { cache: "no-store" });
    const text = await resp.text();
    const rows = parseCSV(text);

    if (!rows.length) {
        console.error("CSV vacío o no accesible");
        return [];
    }

    // Cabecera
    const header = rows[0].map(h => normStr(h));
    const body   = rows.slice(1);

    // Transformar cada fila en objeto usando encabezados
    const registros = body.map(row => {
        const tmp = {};
        header.forEach((colName, j) => {
            tmp[colName] = row[j] !== undefined ? row[j] : "";
        });
        return tmp;
    });

    // Proyección al esquema interno
    // Columnas esperadas:
    // Fecha, Farmacia, Turno, Tipo, Nombre, Quirófano Nro,
    // Codigo_kit, Nombre_kit, Cantidad, Observaciones, Usuario, Timestamp
    const data = registros
        .map(raw => {
            const fechaCir = parseFechaDIA(normStr(raw["Fecha"]));
            const fechaTS  = parseFechaTimestamp(normStr(raw["Timestamp"]));

            return {
                Fecha: fechaCir,                               // Date
                Fecha_raw: normStr(raw["Fecha"]),              // string
                Fecha_iso: toISODate(fechaCir),                // "YYYY-MM-DD"

                Farmacia: normStr(raw["Farmacia"]),
                Turno: normStr(raw["Turno"]),
                Tipo: normStr(raw["Tipo"]),
                Nombre: normStr(raw["Nombre"]),
                Quirofano: normStr(raw["Quirófano Nro"]),
                Codigo_kit: normStr(raw["Codigo_kit"]),
                Nombre_kit: normStr(raw["Nombre_kit"]),
                Cantidad: toNumber(raw["Cantidad"]),
                Observaciones: normStr(raw["Observaciones"]),
                Usuario: normStr(raw["Usuario"]),

                Timestamp: fechaTS,                            // Date
                Timestamp_raw: normStr(raw["Timestamp"]),
            };
        })
        // descartar filas totalmente vacías o sin farmacia/fecha
        .filter(r => r.Fecha_iso !== null && r.Farmacia !== "");

    return data;
}

// ====================================================================
// Filtros en UI
// ====================================================================
function leerFiltros() {
    const inpDesde = document.getElementById("filtroDesde");
    const inpHasta = document.getElementById("filtroHasta");
    const selFarm  = document.getElementById("filtroFarmacia");

    const fDesde = inpDesde && inpDesde.value ? inpDesde.value : null; // "YYYY-MM-DD"
    const fHasta = inpHasta && inpHasta.value ? inpHasta.value : null; // "YYYY-MM-DD"
    const fFarm  = selFarm  && selFarm.value  ? selFarm.value : "__ALL__";

    return { fDesde, fHasta, fFarm };
}

function aplicarFiltros() {
    const { fDesde, fHasta, fFarm } = leerFiltros();

    DATA_FILTRADA = DATA_ORIGINAL.filter(r => {
        // filtrar por farmacia
        if (fFarm !== "__ALL__" && r.Farmacia !== fFarm) {
            return false;
        }

        // filtrar por rango de fecha de cirugía (r.Fecha_iso)
        if (fDesde && r.Fecha_iso && r.Fecha_iso < fDesde) {
            return false;
        }
        if (fHasta && r.Fecha_iso && r.Fecha_iso > fHasta) {
            return false;
        }

        return true;
    });
}

// llena el combo de farmacias disponibles según DATA_ORIGINAL
function poblarFarmacias() {
    const selFarm = document.getElementById("filtroFarmacia");
    if (!selFarm) return;

    // recolectar únicas
    const farms = Array.from(new Set(DATA_ORIGINAL.map(r => r.Farmacia))).sort();

    // limpiar opciones antiguas
    while (selFarm.firstChild) selFarm.removeChild(selFarm.firstChild);

    // opción Todas
    const optAll = document.createElement("option");
    optAll.value = "__ALL__";
    optAll.textContent = "Todas";
    selFarm.appendChild(optAll);

    farms.forEach(f => {
        const o = document.createElement("option");
        o.value = f;
        o.textContent = f;
        selFarm.appendChild(o);
    });
    selFarm.value = "__ALL__";
}

// reset de filtros
function resetFiltros() {
    const inpDesde = document.getElementById("filtroDesde");
    const inpHasta = document.getElementById("filtroHasta");
    const selFarm  = document.getElementById("filtroFarmacia");
    if (inpDesde) inpDesde.value = "";
    if (inpHasta) inpHasta.value = "";
    if (selFarm)  selFarm.value  = "__ALL__";
}

// ====================================================================
// Cálculos estadísticos en base a DATA_FILTRADA
// ====================================================================

function calcKPIs(data) {
    const totalDescargas = data.length;
    const totalUnidades = data.reduce((acc, r) => acc + r.Cantidad, 0);

    const farmSet = new Set(data.map(r => r.Farmacia));
    const farmaciasActivas = farmSet.size;

    // rango de fechas
    const fechasValidas = data
        .map(r => r.Fecha)
        .filter(d => d instanceof Date && !isNaN(d.getTime()));
    let minFecha = null;
    let maxFecha = null;
    if (fechasValidas.length > 0) {
        minFecha = new Date(Math.min(...fechasValidas.map(d => d.getTime())));
        maxFecha = new Date(Math.max(...fechasValidas.map(d => d.getTime())));
    }

    // promedio diario = descargas / nro de días distintos
    const diasSet = new Set(data.map(r => r.Fecha_iso));
    const nDias = diasSet.size || 1;
    const promedioDiario = totalDescargas / nDias;

    return {
        totalDescargas,
        totalUnidades,
        farmaciasActivas,
        minFecha,
        maxFecha,
        promedioDiario
    };
}

// tabla agregada día-farmacia, para gráfico
function buildDiaFarmacia(data) {
    // stats[fecha_iso][farmacia] = count descargas
    const stats = {};
    for (const r of data) {
        if (!r.Fecha_iso || !r.Farmacia) continue;
        if (!stats[r.Fecha_iso]) stats[r.Fecha_iso] = {};
        if (!stats[r.Fecha_iso][r.Farmacia]) {
            stats[r.Fecha_iso][r.Farmacia] = { nDescargas: 0 };
        }
        stats[r.Fecha_iso][r.Farmacia].nDescargas += 1;
    }

    // flatten para render
    const filas = [];
    Object.keys(stats).sort().forEach(fecha_iso => {
        Object.keys(stats[fecha_iso]).sort().forEach(farm => {
            filas.push({
                fecha_iso,
                farmacia: farm,
                nDescargas: stats[fecha_iso][farm].nDescargas
            });
        });
    });

    return filas;
}

// prepara datasets Chart.js
function prepararSeriesParaChart(filasDiaFarm) {
    const fechas = [...new Set(filasDiaFarm.map(f => f.fecha_iso))].sort();
    const farmacias = [...new Set(filasDiaFarm.map(f => f.farmacia))].sort();

    const datasets = farmacias.map(farm => {
        const serie = fechas.map(fecha => {
            const found = filasDiaFarm.find(
                x => x.fecha_iso === fecha && x.farmacia === farm
            );
            return found ? found.nDescargas : 0;
        });
        return {
            label: farm,
            data: serie,
            borderWidth: 2,
            tension: 0.2,
            fill: false
        };
    });

    // etiquetas en formato dd/mm/yyyy
    const labels = fechas.map(fecha_iso => {
        const [y, m, d] = fecha_iso.split("-");
        return `${d}/${m}/${y}`;
    });

    return { labels, datasets };
}

// ====================================================================
// Render en el DOM
// ====================================================================

function renderKPIs(kpis) {
    const elDesc = document.getElementById("kpiDescargas");
    const elProm = document.getElementById("kpiPromedioDiario");
    const elFarm = document.getElementById("kpiFarmaciasActivas");

    if (elDesc) elDesc.textContent = kpis.totalDescargas.toLocaleString("es-PY");
    if (elProm) elProm.textContent = kpis.promedioDiario.toFixed(2);
    if (elFarm) elFarm.textContent = kpis.farmaciasActivas.toLocaleString("es-PY");
}

function renderTablaDetalle(data) {
    // tablaDetalle > tbody
    const tabla = document.getElementById("tablaDetalle");
    if (!tabla) return;
    const tbody = tabla.querySelector("tbody");
    if (!tbody) return;

    // limpiar
    while (tbody.firstChild) tbody.removeChild(tbody.firstChild);

    // ordenar por Timestamp descendente
    const ordenados = [...data].sort((a, b) => {
        const ta = a.Timestamp instanceof Date ? a.Timestamp.getTime() : 0;
        const tb = b.Timestamp instanceof Date ? b.Timestamp.getTime() : 0;
        return tb - ta;
    });

    // máximo 100 filas para no explotar el DOM
    const limite = Math.min(100, ordenados.length);

    for (let i = 0; i < limite; i++) {
        const r = ordenados[i];
        const tr = document.createElement("tr");

        const tdFecha = document.createElement("td");
        tdFecha.textContent = toDMY(r.Fecha);
        tr.appendChild(tdFecha);

        const tdFarm = document.createElement("td");
        tdFarm.textContent = r.Farmacia;
        tr.appendChild(tdFarm);

        const tdTurno = document.createElement("td");
        tdTurno.textContent = r.Turno;
        tr.appendChild(tdTurno);

        const tdTipo = document.createElement("td");
        tdTipo.textContent = r.Tipo;
        tr.appendChild(tdTipo);

        const tdNombre = document.createElement("td");
        tdNombre.textContent = r.Nombre;
        tr.appendChild(tdNombre);

        const tdQx = document.createElement("td");
        tdQx.textContent = r.Quirofano;
        tr.appendChild(tdQx);

        const tdKit = document.createElement("td");
        tdKit.textContent = r.Nombre_kit;
        tr.appendChild(tdKit);

        const tdCant = document.createElement("td");
        tdCant.textContent = r.Cantidad;
        tdCant.style.textAlign = "right";
        tr.appendChild(tdCant);

        const tdUser = document.createElement("td");
        tdUser.textContent = r.Usuario;
        tr.appendChild(tdUser);

        const tdTS = document.createElement("td");
        if (r.Timestamp instanceof Date && !isNaN(r.Timestamp.getTime())) {
            const d = r.Timestamp;
            const hh = String(d.getHours()).padStart(2, "0");
            const mi = String(d.getMinutes()).padStart(2, "0");
            const ss = String(d.getSeconds()).padStart(2, "0");
            tdTS.textContent = `${toDMY(d)} ${hh}:${mi}:${ss}`;
        } else {
            tdTS.textContent = r.Timestamp_raw;
        }
        tr.appendChild(tdTS);

        tbody.appendChild(tr);
    }
}

function renderChartDiaFarmacia(filasDiaFarm) {
    const canvas = document.getElementById("chartDiaFarmacia");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const { labels, datasets } = prepararSeriesParaChart(filasDiaFarm);

    // destruir gráfico previo
    if (chartDiaFarmacia) {
        chartDiaFarmacia.destroy();
        chartDiaFarmacia = null;
    }

    chartDiaFarmacia = new Chart(ctx, {
        type: "line",
        data: {
            labels,
            datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: "index",
                intersect: false
            },
            plugins: {
                legend: { position: "bottom" },
                tooltip: {
                    callbacks: {
                        label: function(ctx) {
                            const v = ctx.parsed.y;
                            return `${ctx.dataset.label}: ${v} descargas`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: { display: true, text: "Fecha cirugía" },
                    ticks: { maxRotation: 0, minRotation: 0 }
                },
                y: {
                    beginAtZero: true,
                    title: { display: true, text: "Descargas (conteo registros)" }
                }
            }
        }
    });
}

// ====================================================================
// Ciclo de render completo tras filtros
// ====================================================================
function refrescarVista() {
    aplicarFiltros();  // actualiza DATA_FILTRADA según UI

    const kpis = calcKPIs(DATA_FILTRADA);
    renderKPIs(kpis);

    const filasDiaFarm = buildDiaFarmacia(DATA_FILTRADA);
    renderChartDiaFarmacia(filasDiaFarm);

    renderTablaDetalle(DATA_FILTRADA);
}

// ====================================================================
// Inicialización principal
// ====================================================================
async function init() {
    try {
        DATA_ORIGINAL = await cargarDatos();
    } catch (err) {
        console.error("Error cargando datos:", err);
        alert("No fue posible descargar datos desde la hoja. Revise permisos públicos y nombre de la hoja.");
        return;
    }

    // poblar lista de farmacias
    poblarFarmacias();

    // primera carga de vista
    refrescarVista();

    // listeners de filtros
    const inpDesde = document.getElementById("filtroDesde");
    const inpHasta = document.getElementById("filtroHasta");
    const selFarm  = document.getElementById("filtroFarmacia");
    const btnReset = document.getElementById("btnReset");

    if (inpDesde) inpDesde.addEventListener("change", refrescarVista);
    if (inpHasta) inpHasta.addEventListener("change", refrescarVista);
    if (selFarm)  selFarm.addEventListener("change", refrescarVista);
    if (btnReset) btnReset.addEventListener("click", () => {
        resetFiltros();
        refrescarVista();
    });
}

// Levanta todo al cargar el DOM
document.addEventListener("DOMContentLoaded", () => {
    init();
});
