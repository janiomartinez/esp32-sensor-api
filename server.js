const express = require('express');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

app.use(express.json());

const lecturaSchema = new mongoose.Schema({
  temperatura: Number,
  humedad: Number,
  timestamp: { type: Date, default: Date.now }
});
const Lectura = mongoose.model('Lectura', lecturaSchema);

mongoose.connect(MONGODB_URI)
  .then(() => console.log('MongoDB conectado'))
  .catch(err => console.error('Error MongoDB:', err));

app.post('/sensor', async (req, res) => {
  const { temperatura, humedad } = req.body;
  if (temperatura === undefined || humedad === undefined) {
    return res.status(400).json({ error: 'Faltan datos' });
  }
  try {
    await Lectura.create({ temperatura: parseFloat(temperatura), humedad: parseFloat(humedad) });
    res.json({ ok: true });
  } catch (err) {
    console.error('Error guardando lectura:', err.message);
    res.status(500).json({ error: 'Error guardando datos' });
  }
});

app.get('/sensor', async (req, res) => {
  try {
    const datos = await Lectura.find().sort({ timestamp: -1 }).limit(20);
    res.json(datos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/sensor/chart', async (req, res) => {
  try {
    const ahora = new Date();
    const desde = req.query.desde ? new Date(req.query.desde) : new Date(ahora - 60 * 60 * 1000);
    const hasta = req.query.hasta ? new Date(req.query.hasta) : ahora;

    const datos = await Lectura.aggregate([
      { $match: { timestamp: { $gte: desde, $lte: hasta } } },
      {
        $group: {
          _id: {
            year:     { $year: '$timestamp' },
            month:    { $month: '$timestamp' },
            day:      { $dayOfMonth: '$timestamp' },
            hour:     { $hour: '$timestamp' },
            interval: { $floor: { $divide: [{ $minute: '$timestamp' }, 5] } }
          },
          temperatura: { $avg: '$temperatura' },
          humedad:     { $avg: '$humedad' },
          timestamp:   { $min: '$timestamp' }
        }
      },
      { $sort: { timestamp: 1 } }
    ]);

    res.json(datos.map(d => ({
      label: new Date(d.timestamp).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
      timestamp: d.timestamp,
      temperatura: parseFloat(d.temperatura.toFixed(1)),
      humedad: parseFloat(d.humedad.toFixed(1))
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/sensor/stats', async (req, res) => {
  try {
    const total = await Lectura.countDocuments();
    const ultima = await Lectura.findOne().sort({ timestamp: -1 });
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    const hoy_count = await Lectura.countDocuments({ timestamp: { $gte: hoy } });
    const stats = await Lectura.aggregate([
      { $group: { _id: null, maxTemp: { $max: '$temperatura' }, minTemp: { $min: '$temperatura' }, avgTemp: { $avg: '$temperatura' }, maxHum: { $max: '$humedad' }, minHum: { $min: '$humedad' } } }
    ]);
    res.json({ total, hoy: hoy_count, ultima: ultima?.timestamp, ...(stats[0] || {}) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/sensor/export', async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const query = {};
    if (desde) query.timestamp = { $gte: new Date(desde) };
    if (hasta) query.timestamp = { ...query.timestamp, $lte: new Date(hasta) };
    const datos = await Lectura.find(query).sort({ timestamp: 1 });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=janfernand_sensor_data.csv');
    res.write('timestamp,temperatura_c,humedad_%\n');
    datos.forEach(d => res.write(d.timestamp.toISOString() + ',' + d.temperatura + ',' + d.humedad + '\n'));
    res.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>JANFERNAND — IoT Monitor</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    :root {
      --bg: #0a0f1e;
      --surface: #111827;
      --surface2: #1a2235;
      --border: #1f2d45;
      --text: #f1f5f9;
      --muted: #64748b;
      --orange: #f97316;
      --blue: #38bdf8;
      --green: #22c55e;
      --red: #ef4444;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: var(--bg); color: var(--text); font-family: 'Inter', sans-serif; font-size: 14px; min-height: 100vh; }

    /* HEADER */
    header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 0 32px; display: flex; align-items: center; justify-content: space-between; height: 60px; position: sticky; top: 0; z-index: 100; }
    .logo { display: flex; align-items: center; gap: 10px; }
    .logo-icon { width: 32px; height: 32px; background: linear-gradient(135deg, var(--orange), #ea580c); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 16px; }
    .logo-text { font-size: 18px; font-weight: 700; letter-spacing: 1px; }
    .logo-sub { font-size: 11px; color: var(--muted); font-weight: 400; letter-spacing: 2px; text-transform: uppercase; }
    .header-right { display: flex; align-items: center; gap: 16px; }
    .badge-online { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500; color: var(--green); background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.2); border-radius: 20px; padding: 4px 12px; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--green); animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
    .header-time { color: var(--muted); font-size: 12px; }

    /* MAIN */
    main { max-width: 1200px; margin: 0 auto; padding: 32px 24px; }

    /* SECTION TITLES */
    .section-title { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 2px; margin-bottom: 16px; }

    /* CARDS ROW */
    .cards-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 32px; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px 24px; }
    .card-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
    .card-value { font-size: 2.4rem; font-weight: 700; line-height: 1; margin-bottom: 4px; }
    .card-unit { font-size: 13px; color: var(--muted); }
    .card-sub { font-size: 11px; color: var(--muted); margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
    .temp-val { color: var(--orange); }
    .hum-val  { color: var(--blue); }
    .stat-val { color: var(--text); font-size: 1.6rem; }

    /* CHART BOX */
    .chart-box { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 24px; margin-bottom: 32px; }
    .chart-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; }
    .chart-title { font-size: 15px; font-weight: 600; }
    .chart-controls { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .btn { border: none; border-radius: 8px; padding: 7px 14px; font-size: 12px; font-weight: 500; cursor: pointer; font-family: inherit; transition: opacity .15s; }
    .btn:hover { opacity: 0.85; }
    .btn-primary  { background: var(--orange); color: white; }
    .btn-ghost    { background: var(--surface2); color: var(--text); border: 1px solid var(--border); }
    .btn-green    { background: var(--green); color: white; }
    .btn-active   { background: rgba(249,115,22,0.15); color: var(--orange); border: 1px solid rgba(249,115,22,0.3); }
    input[type="datetime-local"] { background: var(--surface2); border: 1px solid var(--border); color: var(--text); padding: 7px 10px; border-radius: 8px; font-size: 12px; font-family: inherit; }
    .range-btns { display: flex; gap: 6px; }

    /* TABLE */
    .table-box { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; margin-bottom: 32px; }
    .table-header { padding: 16px 24px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
    .table-header span { font-size: 15px; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; }
    th { background: var(--surface2); color: var(--muted); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; padding: 12px 24px; text-align: left; }
    td { padding: 12px 24px; border-bottom: 1px solid var(--border); font-size: 13px; }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr:hover td { background: var(--surface2); }
    .temp-cell { color: var(--orange); font-weight: 500; }
    .hum-cell  { color: var(--blue);   font-weight: 500; }

    /* API DOCS */
    .api-box { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 24px; margin-bottom: 32px; }
    .endpoints { display: flex; flex-direction: column; gap: 12px; margin-top: 16px; }
    .endpoint { display: flex; align-items: center; gap: 12px; background: var(--surface2); border-radius: 8px; padding: 12px 16px; }
    .method { font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 4px; min-width: 44px; text-align: center; }
    .get  { background: rgba(56,189,248,0.15); color: var(--blue); }
    .post { background: rgba(34,197,94,0.15);  color: var(--green); }
    .endpoint-path { font-family: monospace; font-size: 13px; color: var(--text); min-width: 200px; }
    .endpoint-desc { color: var(--muted); font-size: 13px; }

    /* FOOTER */
    footer { border-top: 1px solid var(--border); padding: 24px 32px; display: flex; justify-content: space-between; align-items: center; flex-wrap: gap; color: var(--muted); font-size: 12px; }
    .footer-brand { font-weight: 600; color: var(--text); }

    /* STATUS BAR */
    .status-bar { display: flex; gap: 24px; flex-wrap: wrap; margin-bottom: 32px; }
    .status-item { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; }
    .status-item strong { color: var(--text); }

    @media (max-width: 600px) {
      header { padding: 0 16px; }
      main { padding: 20px 16px; }
      .chart-header { flex-direction: column; align-items: flex-start; }
    }
  </style>
</head>
<body>

<header>
  <div class="logo">
    <div class="logo-icon">JF</div>
    <div>
      <div class="logo-text">JANFERNAND</div>
      <div class="logo-sub">IoT Monitor</div>
    </div>
  </div>
  <div class="header-right">
    <div class="badge-online"><div class="dot"></div> En linea</div>
    <div class="header-time" id="reloj"></div>
  </div>
</header>

<main>

  <!-- STATUS BAR -->
  <div class="status-bar" id="statusBar">
    <div class="status-item">Ultima lectura: <strong id="ultima">--</strong></div>
    <div class="status-item">Total registros: <strong id="total">--</strong></div>
    <div class="status-item">Lecturas hoy: <strong id="hoy">--</strong></div>
    <div class="status-item">Temp max/min: <strong id="maxmin">--</strong></div>
  </div>

  <!-- CARDS -->
  <div class="section-title">Valores actuales</div>
  <div class="cards-row">
    <div class="card">
      <div class="card-label">Temperatura</div>
      <div class="card-value temp-val" id="temp">--</div>
      <div class="card-unit">grados Celsius</div>
      <div class="card-sub" id="tempSub">Esperando datos...</div>
    </div>
    <div class="card">
      <div class="card-label">Humedad relativa</div>
      <div class="card-value hum-val" id="hum">--</div>
      <div class="card-unit">porcentaje</div>
      <div class="card-sub" id="humSub">Esperando datos...</div>
    </div>
    <div class="card">
      <div class="card-label">Dispositivo</div>
      <div class="card-value stat-val" style="font-size:1.1rem;padding-top:6px">ESP32 + DHT11</div>
      <div class="card-unit">Sensor de ambiente</div>
      <div class="card-sub">Intervalo: cada 30 seg</div>
    </div>
  </div>

  <!-- CHART -->
  <div class="chart-box">
    <div class="chart-header">
      <div class="chart-title">Temperatura y Humedad — promedios cada 5 min</div>
      <div class="chart-controls">
        <div class="range-btns">
          <button class="btn btn-active" id="btn1h" onclick="setRango(1)">1H</button>
          <button class="btn btn-ghost" id="btn6h" onclick="setRango(6)">6H</button>
          <button class="btn btn-ghost" id="btn24h" onclick="setRango(24)">24H</button>
        </div>
        <input type="datetime-local" id="desde" />
        <input type="datetime-local" id="hasta" />
        <button class="btn btn-primary" onclick="cargarGrafico()">Ver</button>
        <a class="btn btn-green" id="btnExport" href="/sensor/export" download>Exportar CSV</a>
      </div>
    </div>
    <canvas id="grafico" height="90"></canvas>
  </div>

  <!-- TABLE -->
  <div class="table-box">
    <div class="table-header">
      <span>Lecturas recientes</span>
      <span style="color:var(--muted);font-size:12px">Ultimos 20 registros</span>
    </div>
    <table>
      <thead>
        <tr>
          <th>Fecha y hora</th>
          <th>Temperatura (°C)</th>
          <th>Humedad (%)</th>
        </tr>
      </thead>
      <tbody id="tabla"></tbody>
    </table>
  </div>

  <!-- API DOCS -->
  <div class="api-box">
    <div class="section-title">Endpoints disponibles</div>
    <div class="endpoints">
      <div class="endpoint">
        <span class="method post">POST</span>
        <span class="endpoint-path">/sensor</span>
        <span class="endpoint-desc">Recibe datos del dispositivo ESP32. Body: <code>{ "temperatura": 25.3, "humedad": 60.1 }</code></span>
      </div>
      <div class="endpoint">
        <span class="method get">GET</span>
        <span class="endpoint-path">/sensor</span>
        <span class="endpoint-desc">Retorna las ultimas 20 lecturas en formato JSON.</span>
      </div>
      <div class="endpoint">
        <span class="method get">GET</span>
        <span class="endpoint-path">/sensor/chart</span>
        <span class="endpoint-desc">Promedios por intervalos de 5 minutos. Params: <code>desde</code>, <code>hasta</code> (ISO 8601).</span>
      </div>
      <div class="endpoint">
        <span class="method get">GET</span>
        <span class="endpoint-path">/sensor/export</span>
        <span class="endpoint-desc">Descarga datos historicos en formato CSV. Params: <code>desde</code>, <code>hasta</code>.</span>
      </div>
      <div class="endpoint">
        <span class="method get">GET</span>
        <span class="endpoint-path">/sensor/stats</span>
        <span class="endpoint-desc">Estadisticas generales: total de registros, maximos, minimos y promedios.</span>
      </div>
    </div>
  </div>

</main>

<footer>
  <span><span class="footer-brand">JANFERNAND IoT Monitor</span> — Plataforma de monitoreo ambiental en tiempo real</span>
  <span>ESP32 + DHT11 &nbsp;·&nbsp; MongoDB Atlas &nbsp;·&nbsp; Railway &copy; 2026</span>
</footer>

<script>
  // Reloj
  function actualizarReloj() {
    document.getElementById('reloj').textContent = new Date().toLocaleTimeString('es-AR');
  }
  actualizarReloj();
  setInterval(actualizarReloj, 1000);

  // Chart
  const ctx = document.getElementById('grafico').getContext('2d');
  const grafico = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Temperatura (°C)',
          data: [],
          borderColor: '#f97316',
          backgroundColor: 'rgba(249,115,22,0.08)',
          tension: 0.4,
          fill: true,
          pointBackgroundColor: '#f97316',
          pointRadius: 3,
          borderWidth: 2,
          yAxisID: 'yTemp'
        },
        {
          label: 'Humedad (%)',
          data: [],
          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56,189,248,0.08)',
          tension: 0.4,
          fill: true,
          pointBackgroundColor: '#38bdf8',
          pointRadius: 3,
          borderWidth: 2,
          yAxisID: 'yHum'
        }
      ]
    },
    options: {
      responsive: true,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#94a3b8', usePointStyle: true, pointStyleWidth: 8 } },
        tooltip: {
          backgroundColor: '#1a2235',
          borderColor: '#1f2d45',
          borderWidth: 1,
          titleColor: '#f1f5f9',
          bodyColor: '#94a3b8'
        }
      },
      scales: {
        x: { ticks: { color: '#475569', font: { size: 11 } }, grid: { color: '#1f2d45' } },
        yTemp: {
          position: 'left',
          ticks: { color: '#f97316', font: { size: 11 } },
          grid: { color: '#1f2d45' },
          title: { display: true, text: 'Temp (°C)', color: '#f97316', font: { size: 11 } }
        },
        yHum: {
          position: 'right',
          ticks: { color: '#38bdf8', font: { size: 11 } },
          grid: { drawOnChartArea: false },
          title: { display: true, text: 'Humedad (%)', color: '#38bdf8', font: { size: 11 } }
        }
      }
    }
  });

  function toLocalInput(date) {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  let rangoHoras = 1;
  function setRango(h) {
    rangoHoras = h;
    ['1h','6h','24h'].forEach(id => document.getElementById('btn'+id).className = 'btn btn-ghost');
    document.getElementById('btn'+h+'h').className = 'btn btn-active';
    const hasta = new Date();
    const desde = new Date(hasta - h * 60 * 60 * 1000);
    document.getElementById('desde').value = toLocalInput(desde);
    document.getElementById('hasta').value = toLocalInput(hasta);
    cargarGrafico();
  }

  async function cargarGrafico() {
    const desdeVal = document.getElementById('desde').value;
    const hastaVal = document.getElementById('hasta').value;
    const params = [];
    if (desdeVal) params.push('desde=' + encodeURIComponent(new Date(desdeVal).toISOString()));
    if (hastaVal) params.push('hasta=' + encodeURIComponent(new Date(hastaVal).toISOString()));
    const qs = params.length ? '?' + params.join('&') : '';
    document.getElementById('btnExport').href = '/sensor/export' + qs;
    try {
      const res = await fetch('/sensor/chart' + qs);
      const datos = await res.json();
      grafico.data.labels = datos.map(d => d.label);
      grafico.data.datasets[0].data = datos.map(d => d.temperatura);
      grafico.data.datasets[1].data = datos.map(d => d.humedad);
      grafico.update();
    } catch(e) {}
  }

  async function actualizarTabla() {
    try {
      const res = await fetch('/sensor');
      const datos = await res.json();
      if (!datos.length) return;
      const d0 = datos[0];
      document.getElementById('temp').textContent = d0.temperatura.toFixed(1);
      document.getElementById('hum').textContent  = d0.humedad.toFixed(1);
      const hora = new Date(d0.timestamp).toLocaleString('es-AR');
      document.getElementById('tempSub').textContent = 'Actualizado: ' + hora;
      document.getElementById('humSub').textContent  = 'Actualizado: ' + hora;
      document.getElementById('tabla').innerHTML = datos.map(d => {
        const h = new Date(d.timestamp).toLocaleString('es-AR');
        return '<tr><td>' + h + '</td><td class="temp-cell">' + d.temperatura.toFixed(1) + '</td><td class="hum-cell">' + d.humedad.toFixed(1) + '</td></tr>';
      }).join('');
    } catch(e) {}
  }

  async function actualizarStats() {
    try {
      const res = await fetch('/sensor/stats');
      const s = await res.json();
      document.getElementById('total').textContent  = s.total?.toLocaleString() || '--';
      document.getElementById('hoy').textContent    = s.hoy?.toLocaleString() || '--';
      document.getElementById('ultima').textContent = s.ultima ? new Date(s.ultima).toLocaleTimeString('es-AR') : '--';
      document.getElementById('maxmin').textContent = s.maxTemp != null ? s.maxTemp.toFixed(1) + ' / ' + s.minTemp.toFixed(1) + ' °C' : '--';
    } catch(e) {}
  }

  setRango(1);
  actualizarTabla();
  actualizarStats();
  setInterval(actualizarTabla, 5000);
  setInterval(() => { cargarGrafico(); actualizarStats(); }, 30000);
</script>
</body>
</html>`);
});

app.listen(PORT, () => console.log('API corriendo en puerto ' + PORT));
