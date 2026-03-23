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

  // Log réception
  console.log(`[PIGE][POST] Réception — id: ${b.id} | adresse: ${b.adresse || b.localisation || '—'} | score: ${b.score} | potentiel: ${b.potentiel}`);

  if (!b.id) {
    console.warn('[PIGE][POST] ⚠️  id manquant — rejeté');
    return res.status(400).json({ error: 'Champ id manquant' });
  }

  try {
    const id = String(b.id);

    // Vérification doublon par URL
    if (b.url) {
      const existing = await pool.query(
        'SELECT id FROM biens_pige WHERE url = $1 LIMIT 1',
        [b.url]
      );
      if (existing.rows.length > 0) {
        console.log(`[PIGE][POST] 🔁 Doublon URL — déjà en base (id: ${existing.rows[0].id})`);
        return res.json({ status: 'duplicate', message: 'Bien déjà en base (URL identique)' });
      }
      console.log(`[PIGE][POST] ✓ URL nouvelle`);
    }

    const result = await pool.query(`
      INSERT INTO biens_pige
        (id, type, titre, adresse, prix, surface, pieces, etage, dpe,
         source, url, date_annonce, potentiel, score, score_raison,
         approche, accroche, script, emoji)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `, [
      id,
      b.type    || '',
      b.titre   || b.localisation || '',
      b.adresse || b.localisation || '',
      parseInt(b.prix)    || 0,
      parseInt(b.surface) || 0,
      parseInt(b.pieces)  || 0,
      b.etage   || b.etages || '—',
      b.dpe     || '',
      b.source  || 'PAP',
      b.url     || '',
      b.date_annonce || b.date || '',
      b.potentiel || '',
      parseInt(b.score) || 0,
      b.score_raison || b.analyse || '',
      b.approche || b.script || b.sript || '',
      b.accroche || '',
      b.script   || b.sript || '',
      b.emoji    || '🏠'
    ]);

    if (result.rows.length === 0) {
      console.log(`[PIGE][POST] 🔁 Doublon id — déjà en base (id: ${id})`);
      return res.json({ status: 'duplicate', message: 'Bien déjà en base (id identique)' });
    }

    console.log(`[PIGE][POST] ✅ Inséré — id: ${id} | ${b.adresse || b.localisation}`);

    res.json({ status: 'ok', id });

  } catch(e) {
    console.error(`[PIGE][POST] ❌ Erreur:`, e.message);
    console.error(`[PIGE][POST] Body:`, JSON.stringify(b, null, 2));
    res.status(500).json({ error: e.message });
  }
});

// Dashboard pige récupère tous les biens
// date_annonce retourné AS date pour le dashboard
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
    console.log(`[PIGE][GET] ${result.rows.length} biens retournés`);
    res.json(result.rows);
  } catch(e) {
    console.error(`[PIGE][GET] ❌ Erreur:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// Mettre à jour le statut d'un bien (envoyé / contacté / ignoré)
app.patch('/api/pige/bien/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { statut } = req.body;
    console.log(`[PIGE][PATCH] id: ${id} → statut: ${statut}`);
    await pool.query(
      'UPDATE biens_pige SET statut = $1 WHERE id = $2',
      [statut, id]
    );
    res.json({ status: 'updated' });
  } catch(e) {
    console.error(`[PIGE][PATCH] ❌ Erreur:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── MANDAT — ROUTES FONCTIONNELLES ───────────────────────────
// Ces 3 routes sont appelées dans l'ordre par public/mandat/index.html
// Étape 1 : géocodage de l'adresse + récupération des transactions DVF
// Étape 2 : rédaction de l'analyse par Claude
// Étape 3 : génération du PDF (HTML → blob téléchargeable)

// ÉTAPE 1 — Géocodage + DVF
// Appelle l'API adresse.data.gouv.fr pour obtenir les coordonnées GPS
// puis récupère les transactions DVF dans un rayon de 300m en base PostgreSQL
app.post('/api/analyse', async (req, res) => {
  const { adresse } = req.body;
  if (!adresse) return res.status(400).json({ error: 'Adresse manquante' });

  try {
    console.log(`[MANDAT][ANALYSE] Géocodage : ${adresse}`);

    // Géocodage via API gouvernementale (gratuite, sans clé)
    const geoRes  = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(adresse)}&limit=1`);
    const geoData = await geoRes.json();

    if (!geoData.features?.length) {
      return res.status(404).json({ error: 'Adresse introuvable — vérifiez la saisie' });
    }

    const feat = geoData.features[0];
    const [lon, lat] = feat.geometry.coordinates;
    const adresseNormalisee = feat.properties.label;
    console.log(`[MANDAT][ANALYSE] Coordonnées : ${lat}, ${lon} — ${adresseNormalisee}`);

    // Récupération des transactions DVF dans un rayon ~300m (0.003 degré ≈ 300m)
    const rayon = 0.003;
    const result = await pool.query(`
      SELECT adresse, prix, surface, prix_m2, type_local, TO_CHAR(date_mutation, 'YYYY-MM') as date_mutation, nb_pieces
      FROM dvf
      WHERE lat BETWEEN $1 AND $2
        AND lon BETWEEN $3 AND $4
        AND type_local IN ('Appartement', 'Maison')
        AND surface > 10
      ORDER BY date_mutation DESC
      LIMIT 20
    `, [lat - rayon, lat + rayon, lon - rayon, lon + rayon]);

    const transactions = result.rows;
    console.log(`[MANDAT][ANALYSE] ${transactions.length} transactions DVF trouvées`);

    // Calcul des statistiques
    let stats = { nb: 0, mediane_m2: null, min_m2: null, max_m2: null, periode: null };
    if (transactions.length > 0) {
      const prix_m2 = transactions.map(t => parseFloat(t.prix_m2)).filter(p => p > 0).sort((a,b) => a-b);
      const mid = Math.floor(prix_m2.length / 2);
      stats = {
        nb:         transactions.length,
        mediane_m2: Math.round(prix_m2.length % 2 ? prix_m2[mid] : (prix_m2[mid-1]+prix_m2[mid])/2),
        min_m2:     Math.round(prix_m2[0]),
        max_m2:     Math.round(prix_m2[prix_m2.length-1]),
        periode:    `${transactions[transactions.length-1].date_mutation?.slice(0,7)} → ${transactions[0].date_mutation?.slice(0,7)}`
      };
    }

    res.json({ adresse: adresseNormalisee, lat, lon, stats, transactions });

  } catch(e) {
    console.error('[MANDAT][ANALYSE] Erreur :', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ÉTAPE 2 — Synthèse IA via Claude
// Reçoit les données DVF + infos du bien et rédige une analyse professionnelle
app.post('/api/synthese', async (req, res) => {
  const { adresse, stats, transactions, bienSurface, bienType, bienPieces, bienEtage, bienDpe, bienEtat, bienPointsForts, bienPrixDemande, proprietaireNom, motifVente } = req.body;

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Clé API Anthropic manquante (variable ANTHROPIC_API_KEY)' });
  }

  try {
    console.log(`[MANDAT][SYNTHESE] Rédaction analyse IA pour : ${adresse}`);

    // Construction du prompt enrichi avec tous les champs du formulaire
    const transactionsText = transactions.slice(0, 10).map(t =>
      `• ${t.adresse} — ${t.type_local} ${t.surface}m² — ${parseInt(t.prix).toLocaleString('fr')}€ (${Math.round(t.prix_m2)}€/m²) — ${t.date_mutation?.slice(0,7)}`
    ).join('\n');

    const bienDetails = [
      bienType     && `Type : ${bienType}`,
      bienSurface  && `Surface : ${bienSurface}m²`,
      bienPieces   && `Pièces : ${bienPieces}`,
      bienEtage    && `Étage : ${bienEtage}`,
      bienDpe      && `DPE : ${bienDpe}`,
      bienEtat     && `État général : ${bienEtat}`,
      bienPointsForts && `Points forts : ${bienPointsForts}`,
      bienPrixDemande  && `Prix demandé par le propriétaire : ${parseInt(bienPrixDemande).toLocaleString('fr')}€`,
      proprietaireNom  && `Propriétaire : ${proprietaireNom}`,
      motifVente       && `Motif de vente : ${motifVente}`,
    ].filter(Boolean).join('\n');

    const prompt = `Tu es un expert immobilier. Rédige un dossier de prise de mandat professionnel et percutant pour l'adresse suivante.

BIEN À EXPERTISER :
Adresse : ${adresse}
${bienDetails}

MARCHÉ LOCAL — Transactions récentes dans un rayon de 300m :
${transactionsText || 'Aucune transaction trouvée dans ce rayon.'}

STATISTIQUES DU SECTEUR :
- Nombre de transactions : ${stats.nb}
- Prix médian : ${stats.mediane_m2 ? stats.mediane_m2.toLocaleString('fr') + '€/m²' : 'données insuffisantes'}
- Fourchette : ${stats.min_m2 && stats.max_m2 ? stats.min_m2.toLocaleString('fr') + '€/m² → ' + stats.max_m2.toLocaleString('fr') + '€/m²' : '—'}
- Période couverte : ${stats.periode || '—'}

Rédige en Markdown une synthèse structurée avec :
1. **Estimation de valeur** — fourchette réaliste basée sur les données DVF, comparaison avec le prix demandé si fourni
2. **Analyse du marché local** — dynamisme, délai de vente estimé, profil acheteur type
3. **Atouts du bien** — points forts à valoriser dans l'annonce
4. **Recommandations stratégiques** — positionnement prix, timing, conseils pour maximiser la vente
5. **Conclusion** — message de réassurance pour le propriétaire${proprietaireNom ? ' (' + proprietaireNom + ')' : ''}

Sois précis, professionnel, et utilise les chiffres réels. Maximum 500 mots.`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model:      'claude-opus-4-5',
        max_tokens: 1500,
        messages:   [{ role: 'user', content: prompt }]
      })
    });

    const claudeData = await claudeRes.json();
    if (!claudeRes.ok) throw new Error(claudeData.error?.message || 'Erreur API Claude');

    const synthese = claudeData.content[0].text;
    console.log(`[MANDAT][SYNTHESE] Analyse rédigée (${synthese.length} caractères)`);
    res.json({ synthese });

  } catch(e) {
    console.error('[MANDAT][SYNTHESE] Erreur :', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ÉTAPE 3 — Génération du PDF
// Construit un HTML de rapport et le retourne en blob téléchargeable
// Le navigateur le reçoit et déclenche le téléchargement
app.post('/api/pdf', async (req, res) => {
  const { adresse, stats, transactions, synthese, agence, bien } = req.body;

  try {
    console.log(`[MANDAT][PDF] Génération du rapport pour : ${adresse}`);

    // Conversion Markdown → HTML pour la synthèse
    // On fait une conversion basique sans dépendance externe
    const syntheseHtml = synthese
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/^\* (.+)$/gm, '<li>$1</li>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/^(?!<[hul])(.+)$/gm, '<p>$1</p>');

    const transHtml = transactions.slice(0, 12).map(t => `
      <tr>
        <td>${t.adresse || '—'}</td>
        <td>${t.type_local || '—'}</td>
        <td>${t.surface || '—'} m²</td>
        <td>${parseInt(t.prix || 0).toLocaleString('fr')} €</td>
        <td><strong>${Math.round(t.prix_m2 || 0).toLocaleString('fr')} €/m²</strong></td>
        <td>${t.date_mutation?.slice(0,7) || '—'}</td>
      </tr>`).join('');

    const bienInfos = [
      bien?.type    && `<li><strong>Type :</strong> ${bien.type}</li>`,
      bien?.surface && `<li><strong>Surface :</strong> ${bien.surface} m²</li>`,
      bien?.pieces  && `<li><strong>Pièces :</strong> ${bien.pieces}</li>`,
      bien?.etage   && `<li><strong>Étage :</strong> ${bien.etage}</li>`,
      bien?.dpe     && `<li><strong>DPE :</strong> ${bien.dpe}</li>`,
      bien?.etat    && `<li><strong>État :</strong> ${bien.etat}</li>`,
      bien?.points_forts && `<li><strong>Points forts :</strong> ${bien.points_forts}</li>`,
    ].filter(Boolean).join('');

    const now = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

    const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8">
<style>
  @page { size: A4; margin: 18mm 20mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11px; color: #1c1a16; line-height: 1.65; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .header { background: #1c1a16; color: #f7f4ee; padding: 20px 24px; margin-bottom: 24px; }
  .header-top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid rgba(184,137,58,.3); padding-bottom: 12px; margin-bottom: 12px; }
  .brand { font-size: 18px; font-style: italic; color: #d4a853; }
  .header-date { font-size: 9px; color: rgba(247,244,238,.45); }
  .header-addr { font-size: 17px; font-weight: 300; color: #f7f4ee; margin-bottom: 4px; }
  .header-agence { font-size: 9px; color: rgba(247,244,238,.45); letter-spacing: 1.5px; text-transform: uppercase; }
  .stripe { height: 3px; background: linear-gradient(90deg, #b8893a, #d4a853); }
  section { margin-bottom: 20px; }
  h2 { font-size: 9px; text-transform: uppercase; letter-spacing: 2px; color: #b8893a; font-weight: 700; margin-bottom: 10px; padding-bottom: 5px; border-bottom: 1px solid #e0d8c8; }
  h3 { font-size: 12px; font-weight: 600; color: #1c1a16; margin: 12px 0 4px; }
  p { margin-bottom: 8px; font-size: 10.5px; color: #4a4640; }
  strong { color: #1c1a16; font-weight: 600; }
  ul { margin: 6px 0 10px 16px; }
  li { margin-bottom: 3px; font-size: 10.5px; color: #4a4640; }
  .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px; }
  .stat-box { background: #f7f4ee; border: 1px solid #e0d8c8; border-radius: 6px; padding: 10px; text-align: center; }
  .stat-val { font-size: 18px; font-weight: 700; color: #b8893a; font-family: Georgia, serif; line-height: 1; margin-bottom: 3px; }
  .stat-lbl { font-size: 8px; color: #8a8478; text-transform: uppercase; letter-spacing: 1px; }
  .bien-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
  thead tr { background: #1c1a16; color: #d4a853; }
  thead th { padding: 6px 8px; text-align: left; font-weight: 600; font-size: 8px; text-transform: uppercase; letter-spacing: 1px; }
  tbody tr:nth-child(even) { background: #f7f4ee; }
  tbody td { padding: 5px 8px; border-bottom: 1px solid #e8e0d0; color: #4a4640; }
  .footer { margin-top: 24px; padding-top: 10px; border-top: 1px solid #e0d8c8; display: flex; justify-content: space-between; font-size: 8px; color: #b8b0a0; }
</style></head><body>
<div class="stripe"></div>
<div class="header">
  <div class="header-top">
    <div class="brand">LeadFlow · Mandat</div>
    <div class="header-date">Généré le ${now}</div>
  </div>
  <div class="header-addr">${adresse}</div>
  <div class="header-agence">${agence?.nom || 'Votre agence'}</div>
</div>

${bienInfos ? `<section>
  <h2>Caractéristiques du bien</h2>
  <ul class="bien-grid">${bienInfos}</ul>
</section>` : ''}

<section>
  <h2>Marché local — Données DVF</h2>
  <div class="stats-grid">
    <div class="stat-box"><div class="stat-val">${stats.nb || 0}</div><div class="stat-lbl">Transactions</div></div>
    <div class="stat-box"><div class="stat-val">${stats.mediane_m2 ? stats.mediane_m2.toLocaleString('fr') : '—'}</div><div class="stat-lbl">€/m² médian</div></div>
    <div class="stat-box"><div class="stat-val">${stats.min_m2 ? stats.min_m2.toLocaleString('fr') : '—'}</div><div class="stat-lbl">€/m² min</div></div>
    <div class="stat-box"><div class="stat-val">${stats.max_m2 ? stats.max_m2.toLocaleString('fr') : '—'}</div><div class="stat-lbl">€/m² max</div></div>
  </div>
  ${transHtml ? `<table><thead><tr><th>Adresse</th><th>Type</th><th>Surface</th><th>Prix</th><th>€/m²</th><th>Date</th></tr></thead><tbody>${transHtml}</tbody></table>` : '<p style="color:#8a8478;font-style:italic">Aucune transaction DVF dans ce secteur.</p>'}
</section>

<section>
  <h2>Analyse &amp; Recommandations IA</h2>
  ${syntheseHtml}
</section>

<div class="footer">
  <span>LeadFlow — Dossier de prise de mandat</span>
  <span>${agence?.nom || ''} · ${adresse}</span>
</div>
</body></html>`;

    // Log du dossier en base
    try {
      await pool.query(
        'INSERT INTO dossiers_mandat (adresse, nb_transactions, median_m2) VALUES ($1,$2,$3)',
        [adresse, stats.nb || 0, stats.mediane_m2 || 0]
      );
    } catch(dbErr) {
      console.warn('[MANDAT][PDF] Log DB échoué (non bloquant) :', dbErr.message);
    }

    console.log(`[MANDAT][PDF] ✅ HTML généré — ${html.length} caractères`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="dossier-mandat.html"');
    res.send(html);

  } catch(e) {
    console.error('[MANDAT][PDF] Erreur :', e.message);
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