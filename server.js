const express = require('express');
const path    = require('path');
const pool    = require('./db');
const app     = express();

app.use(express.json());

// ── CORS ─────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── LEADS ────────────────────────────────────────────────────

// n8n envoie un lead ici
app.post('/webhook/lead', async (req, res) => {
  const l = req.body;
  try {
    await pool.query(`
      INSERT INTO leads (id, prenom, nom, email, tel, bien, ville, source,
        projet, message, score, score_raison, statut, email_bienvenue, relance_j2, relance_j7)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'new',$13,$14,$15)
      ON CONFLICT (id) DO NOTHING
    `, [
      l.id || Date.now().toString(),
      l.prenom, l.nom, l.email, l.tel,
      l.bien, l.ville, l.source, l.projet, l.message,
      l.score, l.score_raison,
      l.email_bienvenue, l.relance_j2, l.relance_j7
    ]);
    res.json({ status: 'ok' });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Dashboard leads récupère tous les leads
app.get('/api/leads', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM leads ORDER BY created_at DESC');
    res.json(result.rows);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Mettre à jour le statut d'un lead
app.patch('/api/leads/:id', async (req, res) => {
  try {
    await pool.query(
      'UPDATE leads SET statut = $1 WHERE id = $2',
      [req.body.statut, req.params.id]
    );
    res.json({ status: 'updated' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── MAILMIND ─────────────────────────────────────────────────

// n8n envoie un email analysé ici
app.post('/webhook/email', async (req, res) => {
  const e = req.body;
  try {
    const result = await pool.query(`
      INSERT INTO emails (from_addr, subject, body, reponse, sujet_reponse, complexite, raison)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING id
    `, [
      e.from, e.subject, e.body,
      e.reponse, e.sujet_reponse,
      (e.complexite || '').toLowerCase().trim(),
      e.raison
    ]);
    res.json({ status: 'ok', id: result.rows[0].id });
  } catch(e2) {
    res.status(500).json({ error: e2.message });
  }
});

// MailMind récupère les emails
app.get('/api/emails', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM emails ORDER BY created_at DESC LIMIT 50'
    );
    res.json(result.rows);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Mettre à jour statut email
app.patch('/api/emails/:id', async (req, res) => {
  try {
    await pool.query(
      'UPDATE emails SET statut = $1 WHERE id = $2',
      [req.body.statut, req.params.id]
    );
    res.json({ status: 'updated' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PIGE ─────────────────────────────────────────────────────

// n8n envoie un bien analysé ici
// Anti-doublon sur DEUX critères :
//   1. id identique (ON CONFLICT DO NOTHING)
//   2. url identique — vérification préalable avant INSERT
app.post('/api/pige/bien', async (req, res) => {
  const b = req.body;
  try {
    const id = String(b.id);

    // ── Vérification doublon par URL ──────────────────────────
    // Couvre le cas où n8n renvoie le même bien avec un id différent
    if (b.url) {
      const existing = await pool.query(
        'SELECT id FROM biens_pige WHERE url = $1 LIMIT 1',
        [b.url]
      );
      if (existing.rows.length > 0) {
        // Bien déjà en base — on ignore silencieusement
        console.log(`Doublon ignoré — URL déjà présente : ${b.url}`);
        return res.json({ status: 'duplicate', message: 'Bien déjà en base (URL identique)' });
      }
    }

    // ── INSERT avec ON CONFLICT sur l'id ─────────────────────
    // Mapping des champs n8n → colonnes PostgreSQL :
    //   b.date         → date (colonne renommée, retournée AS date par le GET)
    //   b.approche || b.script || b.sript → approche (stratégie rédigée par Claude)
    //   b.accroche     → accroche (point fort court, utilisé comme mail_corps fallback)
    //   b.script || b.sript → script (mail complet rédigé par Claude)
    await pool.query(`
      INSERT INTO biens_pige
        (id, type, titre, adresse, prix, surface, pieces, etage, dpe,
         source, url, date_annonce, potentiel, score, score_raison,
         approche, accroche, script, emoji)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      ON CONFLICT (id) DO NOTHING
    `, [
      id,
      b.type   || '',
      b.titre  || b.localisation || '',
      b.adresse || b.localisation || '',
      parseInt(b.prix)     || 0,
      parseInt(b.surface)  || 0,
      parseInt(b.pieces)   || 0,
      b.etage  || b.etages || '—',
      b.dpe    || '',
      b.source || 'PAP',
      b.url    || '',
      // Stocke la date de l'annonce (champ 'date' ou 'date_annonce' selon n8n)
      b.date_annonce || b.date || '',
      b.potentiel || '',
      parseInt(b.score) || 0,
      b.score_raison || b.analyse || '',
      // approche = stratégie complète rédigée par Claude
      b.approche || b.script || b.sript || '',
      // accroche = phrase courte / point fort (utilisée comme fallback mail_corps)
      b.accroche || '',
      // script = mail complet rédigé par Claude
      b.script || b.sript || '',
      b.emoji  || '🏠'
    ]);

    console.log(`Bien inséré : ${id} — ${b.adresse || b.localisation}`);
    res.json({ status: 'ok' });

  } catch(e) {
    console.error('Erreur INSERT pige :', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Dashboard pige récupère les biens
// ── CORRECTION CLÉ ────────────────────────────────────────────
// La colonne en base s'appelle 'date_annonce'
// Le dashboard cherche 'date' dans les objets retournés
// → on utilise AS pour renommer à la volée dans le SELECT
app.get('/api/pige/biens', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id, type, titre, adresse, prix, surface, pieces, etage, dpe,
        source, url, statut, potentiel, score, score_raison,
        approche, accroche, script, emoji, created_at,
        date_annonce AS date
      FROM biens_pige
      ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Mettre à jour le statut d'un bien (marquer envoyé / contacté / ignoré)
app.patch('/api/pige/bien/:id', async (req, res) => {
  try {
    await pool.query(
      'UPDATE biens_pige SET statut = $1 WHERE id = $2',
      [req.body.statut, req.params.id]
    );
    res.json({ status: 'updated' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── MANDAT ───────────────────────────────────────────────────

// Enregistre un dossier généré
app.post('/api/mandat/log', async (req, res) => {
  const { adresse, lat, lon, nb_transactions, median_m2 } = req.body;
  try {
    await pool.query(`
      INSERT INTO dossiers_mandat (adresse, lat, lon, nb_transactions, median_m2)
      VALUES ($1,$2,$3,$4,$5)
    `, [adresse, lat, lon, nb_transactions, median_m2]);
    res.json({ status: 'ok' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── STATS GLOBALES (hub) ─────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  try {
    const [leads, emails, biens, mandats] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM leads'),
      pool.query("SELECT COUNT(*) FROM emails WHERE statut = 'pending'"),
      pool.query("SELECT COUNT(*) FROM biens_pige WHERE potentiel = 'fort'"),
      pool.query('SELECT COUNT(*) FROM dossiers_mandat'),
    ]);
    res.json({
      leads_total:    parseInt(leads.rows[0].count),
      emails_pending: parseInt(emails.rows[0].count),
      pige_fort:      parseInt(biens.rows[0].count),
      mandats_total:  parseInt(mandats.rows[0].count),
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── STATIQUES ────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`LeadFlow → port ${PORT}`));