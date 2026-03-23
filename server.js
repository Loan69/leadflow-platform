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
      SELECT adresse, prix, surface, prix_m2, type_local, TO_CHAR(date_mutation, 'YYYY-MM') AS date_mutation, nb_pieces
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
    let syntheseHtml = synthese
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

    // ── Construction du HTML premium du rapport ─────────────────
    // Template inspiré du design LeadFlow : cover sombre, sections aérées,
    // statistiques en grande typographie, tableau DVF propre
    const now_str = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

    // Conversion Markdown → HTML pour la synthèse Claude
    syntheseHtml = (synthese || '')
      .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h2>$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>[\s\S]+?<\/li>)(\n<li>)/g, '$1$2')
      .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/^(?!<[hul\/])(.+)$/gm, (m) => m.trim() ? `<p>${m}</p>` : '');

    // Lignes du tableau DVF
    const lignes = transactions.slice(0, 15).map(t => `
      <tr>
        <td>${t.date_mutation || ''.slice(0,7) || '—'}</td>
        <td>${t.type_local || '—'}</td>
        <td>${t.surface || '—'} m²</td>
        <td>${parseInt(t.prix || 0).toLocaleString('fr-FR')} €</td>
        <td><strong>${Math.round(t.prix_m2 || 0).toLocaleString('fr-FR')} €/m²</strong></td>
        <td style="color:#8a8478;font-size:10px">${t.adresse || '—'}</td>
      </tr>`).join('');

    // Caractéristiques du bien sous forme de liste
    const bienItems = [
      bien?.type         && `<div class="bien-item"><span class="bien-lbl">Type</span><span class="bien-val">${bien.type}</span></div>`,
      bien?.surface      && `<div class="bien-item"><span class="bien-lbl">Surface</span><span class="bien-val">${bien.surface} m²</span></div>`,
      bien?.pieces       && `<div class="bien-item"><span class="bien-lbl">Pièces</span><span class="bien-val">${bien.pieces}</span></div>`,
      bien?.etage        && `<div class="bien-item"><span class="bien-lbl">Étage</span><span class="bien-val">${bien.etage}</span></div>`,
      bien?.dpe          && `<div class="bien-item"><span class="bien-lbl">DPE</span><span class="bien-val dpe-${(bien.dpe||'').toLowerCase()}">${bien.dpe}</span></div>`,
      bien?.etat         && `<div class="bien-item"><span class="bien-lbl">État</span><span class="bien-val">${bien.etat}</span></div>`,
      bien?.prix_demande && `<div class="bien-item"><span class="bien-lbl">Prix demandé</span><span class="bien-val" style="color:#b8893a;font-weight:600">${parseInt(bien.prix_demande).toLocaleString('fr-FR')} €</span></div>`,
    ].filter(Boolean).join('');

    // Calcul estimation si surface + prix médian disponibles
    const estMin = bien?.surface && stats.min_m2  ? Math.round(parseInt(bien.surface) * stats.min_m2).toLocaleString('fr-FR')  : null;
    const estMax = bien?.surface && stats.max_m2  ? Math.round(parseInt(bien.surface) * stats.max_m2).toLocaleString('fr-FR')  : null;
    const estMed = bien?.surface && stats.mediane_m2 ? Math.round(parseInt(bien.surface) * stats.mediane_m2).toLocaleString('fr-FR') : null;

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600&family=Figtree:wght@300;400;500;600&display=swap');

  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Figtree', sans-serif;
    background: #fff; color: #1c1a16;
    font-size: 11.5px; line-height: 1.65;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ── COVER — page de garde sombre ── */
  .cover {
    background: #1c1a16;
    color: #f7f4ee;
    padding: 52px 50px 44px;
    page-break-after: always;
  }
  .cover-stripe {
    height: 3px;
    background: linear-gradient(90deg, #b8893a, #d4a853, #b8893a);
    margin: -52px -50px 36px -50px;
  }
  .cover-label {
    font-size: 9px; letter-spacing: 3px;
    text-transform: uppercase; color: #b8893a;
    margin-bottom: 14px; font-weight: 600;
  }
  .cover-title {
    font-family: 'Cormorant Garamond', serif;
    font-size: 32px; font-weight: 300; line-height: 1.2;
    margin-bottom: 6px;
  }
  .cover-adresse {
    font-size: 14px; color: rgba(247,244,238,.6);
    margin-bottom: 36px; font-weight: 300;
  }
  .cover-meta {
    display: flex; gap: 0;
    border-top: 1px solid rgba(255,255,255,.1);
    padding-top: 24px; margin-top: 24px;
  }
  .cover-meta-item {
    flex: 1;
    padding-right: 24px;
    border-right: 1px solid rgba(255,255,255,.08);
    margin-right: 24px;
  }
  .cover-meta-item:last-child { border-right: none; margin-right: 0; }
  .cover-meta-item label {
    font-size: 8px; color: #b8893a;
    letter-spacing: 2px; text-transform: uppercase;
    display: block; margin-bottom: 6px; font-weight: 600;
  }
  .cover-meta-item .val {
    font-family: 'Cormorant Garamond', serif;
    font-size: 22px; font-weight: 600; color: #f7f4ee; line-height: 1;
  }
  .cover-meta-item .val-unit {
    font-size: 11px; color: rgba(247,244,238,.45);
    font-family: 'Figtree', sans-serif; font-weight: 300; margin-left: 2px;
  }

  /* ── SECTIONS ── */
  .section {
    padding: 28px 50px;
    border-bottom: 1px solid #ede8df;
  }
  .section:last-of-type { border-bottom: none; }
  .section-title {
    font-size: 8.5px; letter-spacing: 3px;
    text-transform: uppercase; color: #9a9180;
    font-weight: 600;
    margin-bottom: 18px; padding-bottom: 8px;
    border-bottom: 1px solid #e8e0d0;
    display: flex; align-items: center; gap: 10px;
  }
  .section-title::after { content: ''; flex: 1; height: 1px; background: #e8e0d0; }

  /* ── STATS GRID ── */
  .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .stat-box {
    background: #f7f4ee; border-radius: 9px;
    padding: 14px 16px; border: 1px solid #e8e0d0;
  }
  .stat-box label {
    font-size: 8.5px; color: #9a9180;
    text-transform: uppercase; letter-spacing: 1.5px;
    display: block; margin-bottom: 6px; font-weight: 500;
  }
  .stat-box .val {
    font-family: 'Cormorant Garamond', serif;
    font-size: 24px; font-weight: 600; color: #b8893a; line-height: 1;
  }
  .stat-box .sub { font-size: 10px; color: #9a9180; margin-top: 3px; }

  /* ── ESTIMATION ── */
  .estim-wrap {
    background: #1c1a16; border-radius: 10px;
    padding: 18px 20px; margin-top: 14px;
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
  }
  .estim-lbl { font-size: 8.5px; color: #b8893a; text-transform: uppercase; letter-spacing: 2px; font-weight: 600; margin-bottom: 6px; }
  .estim-val { font-family: 'Cormorant Garamond', serif; font-size: 26px; font-weight: 600; color: #f7f4ee; line-height: 1; }
  .estim-sub { font-size: 10px; color: rgba(247,244,238,.4); margin-top: 3px; }
  .estim-sep { width: 1px; height: 40px; background: rgba(255,255,255,.08); flex-shrink: 0; }

  /* ── BIEN CARACTÉRISTIQUES ── */
  .bien-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .bien-item {
    background: #f7f4ee; border: 1px solid #e8e0d0;
    border-radius: 8px; padding: 10px 13px;
    display: flex; flex-direction: column; gap: 3px;
  }
  .bien-lbl { font-size: 8.5px; color: #9a9180; text-transform: uppercase; letter-spacing: 1px; font-weight: 500; }
  .bien-val { font-size: 13px; font-weight: 500; color: #1c1a16; }
  .dpe-a { color: #2a8a60 !important; font-weight: 700; }
  .dpe-b { color: #4aaa80 !important; font-weight: 700; }
  .dpe-c { color: #8aaa40 !important; font-weight: 700; }
  .dpe-d { color: #c8a020 !important; font-weight: 700; }
  .dpe-e { color: #c87020 !important; font-weight: 700; }
  .dpe-f { color: #c84040 !important; font-weight: 700; }
  .dpe-g { color: #901010 !important; font-weight: 700; }

  /* ── POINTS FORTS ── */
  .points-box {
    background: rgba(184,137,58,.05);
    border: 1px solid rgba(184,137,58,.18);
    border-radius: 8px; padding: 12px 15px;
    font-size: 11.5px; color: #4a4640; line-height: 1.6;
    margin-top: 10px;
  }
  .points-box::before { content: '✦ '; color: #b8893a; }

  /* ── SYNTHÈSE IA ── */
  .synthese { font-size: 11.5px; color: #4a4640; line-height: 1.8; font-weight: 300; }
  .synthese p { margin-bottom: 12px; }
  .synthese h2 { font-family: 'Cormorant Garamond', serif; font-size: 16px; font-weight: 400; color: #1c1a16; margin: 18px 0 7px; }
  .synthese h3 { font-size: 12px; font-weight: 600; color: #1c1a16; margin: 14px 0 5px; }
  .synthese h4 { font-size: 11.5px; font-weight: 600; color: #4a4640; margin: 10px 0 4px; }
  .synthese strong { font-weight: 600; color: #1c1a16; }
  .synthese em { font-style: italic; color: #4a4640; }
  .synthese ul { padding-left: 16px; margin: 6px 0 12px; }
  .synthese li { margin-bottom: 4px; }

  /* ── TABLE DVF ── */
  table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  thead tr { background: #1c1a16; }
  th {
    padding: 8px 10px; text-align: left;
    font-size: 8px; letter-spacing: 1.5px;
    text-transform: uppercase; color: #d4a853;
    font-weight: 600;
  }
  tbody tr:nth-child(even) { background: #f7f4ee; }
  tbody tr:hover { background: #f0ebe0; }
  td { padding: 7px 10px; border-bottom: 1px solid #ede8df; color: #4a4640; }
  tr:last-child td { border-bottom: none; }
  td strong { color: #1c1a16; font-weight: 600; }

  /* ── FOOTER ── */
  .footer {
    padding: 16px 50px;
    display: flex; justify-content: space-between; align-items: center;
    border-top: 1px solid #e8e0d0;
    background: #faf8f4;
  }
  .footer-brand { font-family: 'Cormorant Garamond', serif; font-size: 15px; color: #9a9180; }
  .footer-brand em { font-style: italic; color: #b8893a; }
  .footer-info { font-size: 9.5px; color: #b8b0a0; text-align: right; line-height: 1.6; }
  .source {
    font-size: 9px; color: #b8b0a0; font-style: italic;
    margin-top: 14px; padding-top: 10px;
    border-top: 1px solid #ede8df;
  }

  @media print {
    .no-print { display: none !important; }
    body { font-size: 10.5px; }
  }
</style>
</head>
<body>

<!-- ══ COVER ══════════════════════════════════════════════════ -->
<div class="cover">
  <div class="cover-stripe"></div>
  <div class="cover-label">Dossier de prise de mandat · LeadFlow</div>
  <div class="cover-title">Analyse de marché<br>& Recommandation IA</div>
  <div class="cover-adresse">📍 ${adresse}</div>
  <div class="cover-meta">
    <div class="cover-meta-item">
      <label>Prix médian du secteur</label>
      <div class="val">${stats.mediane_m2 ? stats.mediane_m2.toLocaleString('fr-FR') : '—'}<span class="val-unit">€/m²</span></div>
    </div>
    <div class="cover-meta-item">
      <label>Transactions analysées</label>
      <div class="val">${stats.nb || 0}<span class="val-unit">ventes</span></div>
    </div>
    ${estMed ? `<div class="cover-meta-item">
      <label>Estimation médiane</label>
      <div class="val">${estMed}<span class="val-unit">€</span></div>
    </div>` : ''}
    <div class="cover-meta-item">
      <label>Préparé par</label>
      <div class="val" style="font-size:15px;font-family:'Figtree',sans-serif;font-weight:500">${agence?.nom || 'Votre agence'}</div>
    </div>
    <div class="cover-meta-item">
      <label>Généré le</label>
      <div class="val" style="font-size:15px;font-family:'Figtree',sans-serif;font-weight:400">${now_str}</div>
    </div>
  </div>
</div>

<!-- ══ CARACTÉRISTIQUES DU BIEN ═══════════════════════════════ -->
${bienItems ? `<div class="section">
  <div class="section-title">Caractéristiques du bien</div>
  <div class="bien-grid">${bienItems}</div>
  ${bien?.points_forts ? `<div class="points-box">${bien.points_forts}</div>` : ''}
</div>` : ''}

<!-- ══ MARCHÉ LOCAL — DONNÉES DVF ════════════════════════════ -->
<div class="section">
  <div class="section-title">Marché local · Données DVF officielles</div>
  <div class="stats-grid">
    <div class="stat-box">
      <label>Prix médian</label>
      <div class="val">${stats.mediane_m2 ? stats.mediane_m2.toLocaleString('fr-FR') : '—'}</div>
      <div class="sub">€ par m²</div>
    </div>
    <div class="stat-box">
      <label>Fourchette basse</label>
      <div class="val">${stats.min_m2 ? stats.min_m2.toLocaleString('fr-FR') : '—'}</div>
      <div class="sub">€ par m²</div>
    </div>
    <div class="stat-box">
      <label>Fourchette haute</label>
      <div class="val">${stats.max_m2 ? stats.max_m2.toLocaleString('fr-FR') : '—'}</div>
      <div class="sub">€ par m²</div>
    </div>
    <div class="stat-box">
      <label>Transactions</label>
      <div class="val">${stats.nb || 0}</div>
      <div class="sub">dans un rayon de 300m</div>
    </div>
  </div>
  ${estMin && estMax ? `<div class="estim-wrap">
    <div>
      <div class="estim-lbl">Estimation basse</div>
      <div class="estim-val">${estMin} €</div>
      <div class="estim-sub">${stats.min_m2?.toLocaleString('fr-FR')} €/m² × ${bien?.surface} m²</div>
    </div>
    <div class="estim-sep"></div>
    <div>
      <div class="estim-lbl">Estimation médiane</div>
      <div class="estim-val">${estMed} €</div>
      <div class="estim-sub">${stats.mediane_m2?.toLocaleString('fr-FR')} €/m² × ${bien?.surface} m²</div>
    </div>
    <div class="estim-sep"></div>
    <div>
      <div class="estim-lbl">Estimation haute</div>
      <div class="estim-val">${estMax} €</div>
      <div class="estim-sub">${stats.max_m2?.toLocaleString('fr-FR')} €/m² × ${bien?.surface} m²</div>
    </div>
  </div>` : ''}
</div>

<!-- ══ ANALYSE & RECOMMANDATIONS IA ══════════════════════════ -->
<div class="section">
  <div class="section-title">Analyse &amp; Recommandations · Intelligence Artificielle</div>
  <div class="synthese">${syntheseHtml}</div>
</div>

<!-- ══ TRANSACTIONS DE RÉFÉRENCE ═════════════════════════════ -->
<div class="section">
  <div class="section-title">Transactions de référence · ${stats.nb || 0} ventes dans un rayon de 300m</div>
  ${lignes ? `<table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Type</th>
        <th>Surface</th>
        <th>Prix de vente</th>
        <th>Prix / m²</th>
        <th>Rue</th>
      </tr>
    </thead>
    <tbody>${lignes}</tbody>
  </table>` : '<p style="color:#9a9180;font-style:italic;font-size:11px">Aucune transaction DVF trouvée dans ce secteur. Élargissez le rayon de recherche.</p>'}
  <div class="source">
    Source : Demande de Valeurs Foncières (DVF) — Ministère de l'Économie et des Finances.
    Données officielles des transactions notariées enregistrées auprès des services fiscaux.
    Période : ${stats.periode || 'données disponibles'}.
  </div>
</div>

<!-- ══ FOOTER ════════════════════════════════════════════════ -->
<div class="footer">
  <div class="footer-brand">Lead<em>Flow</em> · Dossier Mandat</div>
  <div class="footer-info">
    ${agence?.nom || 'Votre agence'}${agence?.agent ? ' · ' + agence.agent : ''}<br>
    Données DVF officielles · Généré le ${now_str}
  </div>
</div>

</body>
</html>`;

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