const express = require('express');
const path    = require('path');
const app     = express();

app.use(express.json());

// ── CORS pour n8n et les outils locaux ──
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── Fichiers statiques — le hub et tous les outils ──
app.use(express.static(path.join(__dirname, 'public')));

// ── Routes des outils ──
// Leads
const leadsRouter  = require('./routes/leads');
const mailRouter   = require('./routes/mail');
const mandatRouter = require('./routes/mandat');
const pigeRouter   = require('./routes/pige');

app.use('/api/leads',  leadsRouter);
app.use('/api/mail',   mailRouter);
app.use('/api/mandat', mandatRouter);
app.use('/api/pige',   pigeRouter);

// ── Fallback — redirige tout vers le hub ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`LeadFlow Platform → port ${PORT}`));