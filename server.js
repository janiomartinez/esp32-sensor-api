const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

let lecturas = [];
const MAX_LECTURAS = 120; // 1 hora a 30 segundos por lectura

app.post('/sensor', (req, res) => {
  const { temperatura, humedad } = req.body;
  if (temperatura === undefined || humedad === undefined) {
    return res.status(400).json({ error: 'Faltan datos' });
  }
  lecturas.unshift({
    temperatura: parseFloat(temperatura),
    humedad: parseFloat(humedad),
    timestamp: new Date().toISOString()
  });
  if (lecturas.length > MAX_LECTURAS) lecturas.pop();
  res.json({ ok: true });
});

app.get('/sensor', (req, res) => {
  res.json(lecturas.slice(0, 20));
});

app.get('/sensor/chart', (req, res) => {
  const buckets = {};
  lecturas.forEach(l => {
    const fecha = new Date(l.timestamp);
    const minuto = Math.floor(fecha.getMinutes() / 5) * 5;
    const key = fecha.getHours() + ':' + minuto.toString().padStart(2, '0');
    if (!buckets[key]) buckets[key] = { temps: [], hums: [], label: key };
    buckets[key].temps.push(l.temperatura);
    buckets[key].hums.push(l.humedad);
  });

  const promedios = Object.values(buckets)
    .map(b => ({
      label: b.label,
      temperatura: parseFloat((b.temps.reduce((a, v) => a + v, 0) / b.temps.length).toFixed(1)),
      humedad: parseFloat((b.hums.reduce((a, v) => a + v, 0) / b.hums.length).toFixed(1))
    }))
    .slice(0, 12)
    .reverse();

  res.json(promedios);
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
    .chart-box { background: #1e293b; border-radius: 16px; padding: 24px; max-width: 800px; margin: 0 auto 32px; }
    .chart-box h2 { font-size: 0.85rem; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px; text-align: center; }
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
    <h2>Promedios cada 5 min — ultima hora</h2>
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
          x: {
            ticks: { color: '#64748b' },
            grid: { color: '#1e293b' }
          },
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

    async function actualizarGrafico() {
      try {
        const res = await fetch('/sensor/chart');
        const datos = await res.json();
        if (datos.length === 0) return;
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
        const tbody = document.getElementById('tabla');
        tbody.innerHTML = datos.map(d => {
          const h = new Date(d.timestamp).toLocaleTimeString('es-AR');
          return '<tr><td>' + h + '</td><td>' + d.temperatura.toFixed(1) + '</td><td>' + d.humedad.toFixed(1) + '</td></tr>';
        }).join('');
      } catch(e) {}
    }

    actualizarTabla();
    actualizarGrafico();
    setInterval(actualizarTabla, 2000);
    setInterval(actualizarGrafico, 30000);
  </script>
</body>
</html>`);
});

app.listen(PORT, () => console.log('API corriendo en puerto ' + PORT));
