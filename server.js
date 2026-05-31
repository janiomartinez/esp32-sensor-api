const express = require('express');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

app.use(express.json());

// Schema
const lecturaSchema = new mongoose.Schema({
  temperatura: Number,
  humedad: Number,
  timestamp: { type: Date, default: Date.now }
});
const Lectura = mongoose.model('Lectura', lecturaSchema);

// Conexion MongoDB
mongoose.connect(MONGODB_URI)
  .then(() => console.log('MongoDB conectado'))
  .catch(err => console.error('Error MongoDB:', err));

// Recibir datos del ESP32
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

// Ultimas 20 lecturas para la tabla
app.get('/sensor', async (req, res) => {
  const datos = await Lectura.find().sort({ timestamp: -1 }).limit(20);
  res.json(datos);
});

// Promedios cada 5 minutos para el grafico
app.get('/sensor/chart', async (req, res) => {
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
});

// Datos historicos por rango de fecha
app.get('/sensor/history', async (req, res) => {
  const { desde, hasta } = req.query;
  const query = {};
  if (desde) query.timestamp = { $gte: new Date(desde) };
  if (hasta) query.timestamp = { ...query.timestamp, $lte: new Date(hasta) };
  const datos = await Lectura.find(query).sort({ timestamp: -1 }).limit(5000);
  res.json(datos);
});

// Exportar CSV
app.get('/sensor/export', async (req, res) => {
  const { desde, hasta } = req.query;
  const query = {};
  if (desde) query.timestamp = { $gte: new Date(desde) };
  if (hasta) query.timestamp = { ...query.timestamp, $lte: new Date(hasta) };
  const datos = await Lectura.find(query).sort({ timestamp: 1 });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=sensor_data.csv');
  res.write('timestamp,temperatura,humedad\n');
  datos.forEach(d => res.write(d.timestamp.toISOString() + ',' + d.temperatura + ',' + d.humedad + '\n'));
  res.end();
});

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ESP32 Sensor</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0f172a; color: #e2e8f0; font-family: 'Segoe UI', sans-serif; padding: 24px; }
    h1 { text-align: center; font-size: 1.5rem; color: #94a3b8; margin-bottom: 24px; letter-spacing: 2px; }
    .cards { display: flex; gap: 20px; justify-content: center; flex-wrap: wrap; margin-bottom: 20px; }
    .card { background: #1e293b; border-radius: 16px; padding: 32px 48px; text-align: center; min-width: 180px; }
    .card .label { font-size: 0.85rem; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
    .card .value { font-size: 3rem; font-weight: 700; }
    .card .unit { font-size: 1.2rem; color: #94a3b8; }
    .temp .value { color: #f97316; }
    .hum .value { color: #38bdf8; }
    .status { text-align: center; font-size: 0.8rem; color: #475569; margin-bottom: 20px; }
    .chart-box { background: #1e293b; border-radius: 16px; padding: 24px; max-width: 800px; margin: 0 auto 24px; }
    .chart-box h2 { font-size: 0.85rem; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px; text-align: center; }
    .filtros { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-bottom: 16px; align-items: center; }
    .filtros input { background: #0f172a; border: 1px solid #334155; color: #e2e8f0; padding: 6px 10px; border-radius: 8px; font-size: 0.85rem; }
    .filtros button { background: #3b82f6; color: white; border: none; padding: 6px 16px; border-radius: 8px; cursor: pointer; font-size: 0.85rem; }
    .filtros button:hover { background: #2563eb; }
    .btn-export { background: #16a34a; color: white; border: none; padding: 6px 16px; border-radius: 8px; cursor: pointer; font-size: 0.85rem; text-decoration: none; }
    table { width: 100%; max-width: 600px; margin: 0 auto; border-collapse: collapse; }
    th { background: #1e293b; color: #64748b; font-size: 0.8rem; text-transform: uppercase; padding: 10px 16px; }
    td { padding: 10px 16px; border-bottom: 1px solid #1e293b; font-size: 0.9rem; text-align: center; }
    tr:hover td { background: #1e293b; }
  </style>
</head>
<body>
  <h1>ESP32 + DHT11</h1>
  <div class="cards">
    <div class="card temp">
      <div class="label">Temperatura</div>
      <div class="value" id="temp">--</div>
      <div class="unit">°C</div>
    </div>
    <div class="card hum">
      <div class="label">Humedad</div>
      <div class="value" id="hum">--</div>
      <div class="unit">%</div>
    </div>
  </div>
  <div class="status" id="status">Esperando datos...</div>

  <div class="chart-box">
    <h2>Promedios cada 5 min</h2>
    <div class="filtros">
      <input type="datetime-local" id="desde" />
      <input type="datetime-local" id="hasta" />
      <button onclick="cargarGrafico()">Ver periodo</button>
      <button onclick="ultimaHora()">Ultima hora</button>
      <a class="btn-export" id="btnExport" href="/sensor/export" download>Descargar CSV</a>
    </div>
    <canvas id="grafico" height="120"></canvas>
  </div>

  <table>
    <thead><tr><th>Hora</th><th>Temp (°C)</th><th>Humedad (%)</th></tr></thead>
    <tbody id="tabla"></tbody>
  </table>

  <script>
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
            backgroundColor: 'rgba(249,115,22,0.1)',
            tension: 0.3,
            fill: true,
            yAxisID: 'yTemp'
          },
          {
            label: 'Humedad (%)',
            data: [],
            borderColor: '#38bdf8',
            backgroundColor: 'rgba(56,189,248,0.1)',
            tension: 0.3,
            fill: true,
            yAxisID: 'yHum'
          }
        ]
      },
      options: {
        animation: false,
        plugins: { legend: { labels: { color: '#94a3b8' } } },
        scales: {
          x: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } },
          yTemp: {
            position: 'left',
            ticks: { color: '#f97316' },
            grid: { color: '#334155' },
            title: { display: true, text: 'Temp (°C)', color: '#f97316' }
          },
          yHum: {
            position: 'right',
            ticks: { color: '#38bdf8' },
            grid: { drawOnChartArea: false },
            title: { display: true, text: 'Humedad (%)', color: '#38bdf8' }
          }
        }
      }
    });

    function toLocalInput(date) {
      const d = new Date(date);
      d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
      return d.toISOString().slice(0, 16);
    }

    function ultimaHora() {
      const hasta = new Date();
      const desde = new Date(hasta - 60 * 60 * 1000);
      document.getElementById('desde').value = toLocalInput(desde);
      document.getElementById('hasta').value = toLocalInput(hasta);
      cargarGrafico();
    }

    async function cargarGrafico() {
      const desde = document.getElementById('desde').value;
      const hasta  = document.getElementById('hasta').value;
      let url = '/sensor/chart';
      const params = [];
      if (desde) params.push('desde=' + encodeURIComponent(new Date(desde).toISOString()));
      if (hasta)  params.push('hasta='  + encodeURIComponent(new Date(hasta).toISOString()));
      if (params.length) url += '?' + params.join('&');

      const exportUrl = '/sensor/export' + (params.length ? '?' + params.join('&') : '');
      document.getElementById('btnExport').href = exportUrl;

      try {
        const res = await fetch(url);
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
        if (datos.length === 0) return;
        document.getElementById('temp').textContent = datos[0].temperatura.toFixed(1);
        document.getElementById('hum').textContent = datos[0].humedad.toFixed(1);
        const hora = new Date(datos[0].timestamp).toLocaleTimeString('es-AR');
        document.getElementById('status').textContent = 'Ultima actualizacion: ' + hora;
        document.getElementById('tabla').innerHTML = datos.map(d => {
          const h = new Date(d.timestamp).toLocaleTimeString('es-AR');
          return '<tr><td>' + h + '</td><td>' + d.temperatura.toFixed(1) + '</td><td>' + d.humedad.toFixed(1) + '</td></tr>';
        }).join('');
      } catch(e) {}
    }

    ultimaHora();
    actualizarTabla();
    setInterval(actualizarTabla, 2000);
    setInterval(() => cargarGrafico(), 30000);
  </script>
</body>
</html>`);
});

app.listen(PORT, () => console.log('API corriendo en puerto ' + PORT));
