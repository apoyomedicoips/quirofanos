// Parámetros de Google Sheets
const SHEET_ID = "13mzYK7HsvwiKyMXDpZJ3d1fLRvkwPYbOKUeedYSUh68";
const SHEET_NAME = "Registros";
// CSV directo de la hoja "Registros


// CSV directo de la hoja "Registros"
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`;

// ---------------------------------------------------------------------
// Utilidades generales
// ---------------------------------------------------------------------

// Parser CSV robusto para comas dentro de comillas
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
            // tolerar \r\n
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

// Normaliza fecha dd/mm/yyyy -> Date
function parseFechaDIA(str) {
    if (!str || typeof str !== "string") return null;
    const parts = str.trim().split("/");
    if (parts.length !== 3) return null;
    const [dd, mm, yyyy] = parts.map(p => p.trim());
    const day = parseInt(dd, 10);
    const mon = parseInt(mm, 10) - 1;
    const yr = parseInt(yyyy, 10);
    const d = new Date(yr, mon, day);
    if (isNaN(d.getTime())) return null;
    return d;
}

// Normaliza timestamp dd/mm/yyyy hh:mm:ss -> Date
function parseFechaTimestamp(str) {
    if (!str || typeof str !== "string") return null;
    // ejemplo "20/06/2025 10:50:22"
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

// Convierte Date -> "YYYY-MM-DD"
function toISODate(d) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${da}`;
}

// Convierte Date -> "DD/MM/YYYY"
function toDMY(d) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return "";
    const da = String(d.getDate()).padStart(2, "0");
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const y = d.getFullYear();
    return `${da}/${m}/${y}`;
}

// Sanitiza string
function normStr(x) {
    if (x === null || x === undefined) return "";
    return String(x).trim();
}

// A número, por ejemplo Cantidad
function toNumber(x) {
    if (x === null || x === undefined || x === "") return 0;
    const n = Number(String(x).replace(",", "."));
    return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------
// Descarga de datos y preparación
// ---------------------------------------------------------------------

async function cargarDatos() {
    const resp = await fetch(CSV_URL, {
        cache: "no-store"
    });
    const text = await resp.text();
    const rows = parseCSV(text);
    if (!rows.length) {
        console.error("Sin filas en CSV");
        return [];
    }

    // Primera fila es encabezado
    const header = rows[0].map(h => normStr(h));
    const body = rows.slice(1);

    // Mapeo esperado
    // Fecha, Farmacia, Turno, Tipo, Nombre, Quirófano Nro,
    // Codigo_kit, Nombre_kit, Cantidad, Observaciones, Usuario, Timestamp
    function rowToObj(r) {
        const o = {};
        header.forEach((colName, j) => {
            o[colName] = r[j] !== undefined ? r[j] : "";
        });
        return o;
    }

    const registros = body
        .map(rowToObj)
        .map(raw => {
            const fechaCir = parseFechaDIA(normStr(raw["Fecha"]));
            const fechaTS  = parseFechaTimestamp(normStr(raw["Timestamp"]));

            return {
                Fecha_raw: normStr(raw["Fecha"]),
                Fecha: fechaCir,
                Fecha_iso: toISODate(fechaCir),

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

                Timestamp_raw: normStr(raw["Timestamp"]),
                Timestamp: fechaTS,
                Timestamp_iso: toISODate(fechaTS)
            };
        })
        .filter(r => r.Fecha_iso !== null && r.Farmacia !== "");

    return registros;
}

// ---------------------------------------------------------------------
// Cálculos estadísticos
// ---------------------------------------------------------------------

function resumenGlobal(registros) {
    // total descargas
    const totalDescargas = registros.length;

    // total unidades (suma Cantidad)
    const totalUnidades = registros.reduce((acc, r) => acc + r.Cantidad, 0);

    // farmacias únicas
    const setFarm = new Set(registros.map(r => r.Farmacia));
    const totalFarmacias = setFarm.size;

    // rango de fechas
    const fechasValidas = registros
        .map(r => r.Fecha)
        .filter(d => d instanceof Date && !isNaN(d.getTime()));

    let minFecha = null;
    let maxFecha = null;
    if (fechasValidas.length > 0) {
        minFecha = new Date(Math.min(...fechasValidas.map(d => d.getTime())));
        maxFecha = new Date(Math.max(...fechasValidas.map(d => d.getTime())));
    }

    return {
        totalDescargas,
        totalUnidades,
        totalFarmacias,
        minFecha,
        maxFecha
    };
}

// tabla diaria farmacia: Cantidad de descargas (conteo de filas) y total unidades (suma Cantidad)
function estadisticaDiaFarmacia(registros) {
    // estructura:
    // stats[fecha_iso][farmacia] = { nDescargas, totalUnidades }
    const stats = {};

    for (const r of registros) {
        if (!r.Fecha_iso || !r.Farmacia) continue;
        if (!stats[r.Fecha_iso]) {
            stats[r.Fecha_iso] = {};
        }
        if (!stats[r.Fecha_iso][r.Farmacia]) {
            stats[r.Fecha_iso][r.Farmacia] = { nDescargas: 0, totalUnidades: 0 };
        }
        stats[r.Fecha_iso][r.Farmacia].nDescargas += 1;
        stats[r.Fecha_iso][r.Farmacia].totalUnidades += r.Cantidad;
    }

    // también generamos lista tabular plana para la tabla HTML
    const filasTabla = [];
    Object.keys(stats).sort().forEach(fecha_iso => {
        Object.keys(stats[fecha_iso]).sort().forEach(farm => {
            filasTabla.push({
                fecha_iso,
                farmacia: farm,
                nDescargas: stats[fecha_iso][farm].nDescargas,
                totalUnidades: stats[fecha_iso][farm].totalUnidades
            });
        });
    });

    return {
        stats,
        filasTabla
    };
}

// Para el gráfico, construir series por farmacia a lo largo del tiempo
function prepararSeriesGraficoDiaFarmacia(estad) {
    // fechas ordenadas
    const fechas = [...new Set(
        estad.filasTabla.map(f => f.fecha_iso)
    )].sort();

    // farmacias distintas
    const farmacias = [...new Set(
        estad.filasTabla.map(f => f.farmacia)
    )].sort();

    // dataset por farmacia: vector alineado con fechas
    const datasets = farmacias.map(farm => {
        const dataFarm = fechas.map(fecha => {
            const match = estad.filasTabla.find(
                x => x.fecha_iso === fecha && x.farmacia === farm
            );
            return match ? match.nDescargas : 0;
        });
        return {
            label: farm,
            data: dataFarm,
            borderWidth: 2,
            tension: 0.2,
            fill: false
        };
    });

    return { labels: fechas, datasets };
}

// ---------------------------------------------------------------------
// Renderizado en DOM
// ---------------------------------------------------------------------

function renderResumenCard(idSpan, valor) {
    const el = document.getElementById(idSpan);
    if (el) el.textContent = valor;
}

function renderRangoFechas(idSpan, minD, maxD) {
    const el = document.getElementById(idSpan);
    if (!el) return;
    if (!minD || !maxD) {
        el.textContent = "Sin datos";
    } else {
        el.textContent = `${toDMY(minD)} - ${toDMY(maxD)}`;
    }
}

function renderTablaDiaFarmacia(tbodyId, filas) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    // limpiamos
    while (tbody.firstChild) {
        tbody.removeChild(tbody.firstChild);
    }

    // filas ordenadas por fecha y luego farmacia
    filas.sort((a, b) => {
        if (a.fecha_iso < b.fecha_iso) return -1;
        if (a.fecha_iso > b.fecha_iso) return 1;
        if (a.farmacia < b.farmacia) return -1;
        if (a.farmacia > b.farmacia) return 1;
        return 0;
    });

    for (const f of filas) {
        const tr = document.createElement("tr");

        // fecha_iso como DD/MM/YYYY
        const dparts = f.fecha_iso.split("-");
        let fechaDMY = f.fecha_iso;
        if (dparts.length === 3) {
            const [yyyy, mm, dd] = dparts;
            fechaDMY = `${dd}/${mm}/${yyyy}`;
        }

        const tdFecha = document.createElement("td");
        tdFecha.textContent = fechaDMY;
        tdFecha.className = "px-2 py-1 border";

        const tdFarm = document.createElement("td");
        tdFarm.textContent = f.farmacia;
        tdFarm.className = "px-2 py-1 border";

        const tdDesc = document.createElement("td");
        tdDesc.textContent = f.nDescargas;
        tdDesc.className = "px-2 py-1 text-right border";

        const tdCant = document.createElement("td");
        tdCant.textContent = f.totalUnidades;
        tdCant.className = "px-2 py-1 text-right border";

        tr.appendChild(tdFecha);
        tr.appendChild(tdFarm);
        tr.appendChild(tdDesc);
        tr.appendChild(tdCant);

        tbody.appendChild(tr);
    }
}

let graficoFarmDia = null;

function renderGraficoDiaFarmacia(canvasId, chartData) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext("2d");

    // destruir gráfico previo si existe
    if (graficoFarmDia) {
        graficoFarmDia.destroy();
        graficoFarmDia = null;
    }

    graficoFarmDia = new Chart(ctx, {
        type: "line",
        data: {
            labels: chartData.labels.map(fecha_iso => {
                // convertir a DD/MM/YYYY para ejes
                const [yyyy, mm, dd] = fecha_iso.split("-");
                return `${dd}/${mm}/${yyyy}`;
            }),
            datasets: chartData.datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: "index",
                intersect: false
            },
            plugins: {
                legend: {
                    position: "bottom"
                },
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
                    title: { display: true, text: "Fecha" },
                    ticks: {
                        maxRotation: 0,
                        minRotation: 0
                    }
                },
                y: {
                    beginAtZero: true,
                    title: { display: true, text: "Descargas (conteo de filas)" }
                }
            }
        }
    });
}

// ---------------------------------------------------------------------
// Control principal
// ---------------------------------------------------------------------

async function main() {
    // 1. Cargar datos crudos desde Google Sheets
    const registros = await cargarDatos();

    // 2. Calcular resúmenes
    const resumen = resumenGlobal(registros);
    const estadFarmDia = estadisticaDiaFarmacia(registros);
    const chartFarmDia = prepararSeriesGraficoDiaFarmacia(estadFarmDia);

    // 3. Poblar tarjetas resumen
    renderResumenCard("card-total-descargas", resumen.totalDescargas);
    renderResumenCard("card-total-unidades", resumen.totalUnidades);
    renderResumenCard("card-total-farmacias", resumen.totalFarmacias);
    renderRangoFechas("card-rango-fechas", resumen.minFecha, resumen.maxFecha);

    // 4. Tabla de descargas por día y farmacia
    renderTablaDiaFarmacia("tbody-dia-farmacia", estadFarmDia.filasTabla);

    // 5. Gráfico línea por farmacia
    renderGraficoDiaFarmacia("chart-dia-farmacia", chartFarmDia);

    // 6. Tabla cruda base (opcional) para auditoría
    renderTablaDetalle("tbody-detalle", registros);
}

// Render tabla detalle transaccional
function renderTablaDetalle(tbodyId, registros) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    // limpio
    while (tbody.firstChild) {
        tbody.removeChild(tbody.firstChild);
    }

    // Ordenar descendente por Fecha + Timestamp
    registros.sort((a, b) => {
        const ta = a.Timestamp instanceof Date ? a.Timestamp.getTime() : 0;
        const tb = b.Timestamp instanceof Date ? b.Timestamp.getTime() : 0;
        return tb - ta;
    });

    for (const r of registros) {
        const tr = document.createElement("tr");

        const tdFecha = document.createElement("td");
        tdFecha.textContent = toDMY(r.Fecha);
        tdFecha.className = "px-2 py-1 border";

        const tdFarm = document.createElement("td");
        tdFarm.textContent = r.Farmacia;
        tdFarm.className = "px-2 py-1 border";

        const tdTurno = document.createElement("td");
        tdTurno.textContent = r.Turno;
        tdTurno.className = "px-2 py-1 border";

        const tdTipo = document.createElement("td");
        tdTipo.textContent = r.Tipo;
        tdTipo.className = "px-2 py-1 border";

        const tdNombre = document.createElement("td");
        tdNombre.textContent = r.Nombre;
        tdNombre.className = "px-2 py-1 border";

        const tdKit = document.createElement("td");
        tdKit.textContent = r.Nombre_kit;
        tdKit.className = "px-2 py-1 border";

        const tdCant = document.createElement("td");
        tdCant.textContent = r.Cantidad;
        tdCant.className = "px-2 py-1 text-right border";

        const tdUser = document.createElement("td");
        tdUser.textContent = r.Usuario;
        tdUser.className = "px-2 py-1 border";

        const tdTS = document.createElement("td");
        if (r.Timestamp instanceof Date && !isNaN(r.Timestamp.getTime())) {
            const d = r.Timestamp;
            const fecha = toDMY(d);
            const hh = String(d.getHours()).padStart(2, "0");
            const mi = String(d.getMinutes()).padStart(2, "0");
            const ss = String(d.getSeconds()).padStart(2, "0");
            tdTS.textContent = `${fecha} ${hh}:${mi}:${ss}`;
        } else {
            tdTS.textContent = r.Timestamp_raw;
        }
        tdTS.className = "px-2 py-1 border";

        tr.appendChild(tdFecha);
        tr.appendChild(tdFarm);
        tr.appendChild(tdTurno);
        tr.appendChild(tdTipo);
        tr.appendChild(tdNombre);
        tr.appendChild(tdKit);
        tr.appendChild(tdCant);
        tr.appendChild(tdUser);
        tr.appendChild(tdTS);

        tbody.appendChild(tr);
    }
}

// ---------------------------------------------------------------------
// Inicialización al cargar la página
// ---------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    main().catch(err => {
        console.error("Error en main():", err);
        const errBox = document.getElementById("error-box");
        if (errBox) {
            errBox.textContent = "No fue posible cargar los datos. Verifique permisos de la hoja y CORS.";
        }
    });
});
