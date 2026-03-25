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
 
    const estBas = bienSurface && stats.min_m2    ? Math.round(parseInt(bienSurface) * stats.min_m2   ).toLocaleString('fr') : '?';
    const estHau = bienSurface && stats.max_m2    ? Math.round(parseInt(bienSurface) * stats.max_m2   ).toLocaleString('fr') : '?';
    const estMed = bienSurface && stats.mediane_m2 ? Math.round(parseInt(bienSurface) * stats.mediane_m2).toLocaleString('fr') : '?';
 
    const prompt = `Tu es un expert en estimation immobilière.
Tu dois rédiger la partie analyse de marché d'un dossier de prise de mandat
pour un agent immobilier qui va rencontrer un propriétaire vendeur.
 
Bien concerné : ${bienType || 'appartement'} de ${bienSurface || '?'}m²
situé au ${adresse}
${bienDetails ? '\nInformations complémentaires :\n' + bienDetails : ''}
 
Données de marché réelles (transactions des 24 derniers mois dans un rayon de 300m) :
- Nombre de transactions : ${stats.nb}
- Prix médian au m² : ${stats.mediane_m2 ? stats.mediane_m2.toLocaleString('fr') : '?'}€
- Fourchette : ${stats.min_m2 ? stats.min_m2.toLocaleString('fr') : '?'}€/m² à ${stats.max_m2 ? stats.max_m2.toLocaleString('fr') : '?'}€/m²
- Période couverte : ${stats.periode || '24 derniers mois'}
 
Exemples de transactions récentes :
${transactionsText || 'Aucune transaction trouvée dans ce rayon.'}
 
Rédige la synthèse en 4 blocs bien séparés. Respecte EXACTEMENT ce format :
 
===MARCHE===
[Paragraphe en prose de 3-4 phrases sur le dynamisme du marché local.
Cite les chiffres réels : prix médian, fourchette, nombre de transactions, période.]
 
===ESTIMATION===
[Paragraphe en prose de 3-4 phrases sur la valeur estimée de ce bien précis.
${bienSurface ? `Fourchette réaliste : entre ${estBas}€ et ${estHau}€, valeur médiane estimée à ${estMed}€.` : 'Positionne le bien par rapport aux transactions récentes.'}
${bienPrixDemande ? `Le propriétaire demande ${parseInt(bienPrixDemande).toLocaleString('fr')}€ — compare avec le marché et conseille franchement.` : ''}]
 
===FACTEURS===
[Liste exactement 4 à 6 facteurs qui influencent le prix de CE bien.
Format strict : un facteur par ligne, séparé par | comme ceci :
Facteur | Impact | Explication courte
Exemple :
DPE ${bienDpe || 'C'} | ${bienDpe === 'A' || bienDpe === 'B' ? '+3 à +8%' : bienDpe === 'E' || bienDpe === 'F' || bienDpe === 'G' ? '-5 à -15%' : 'Neutre'} | ${bienDpe === 'A' || bienDpe === 'B' ? 'Très recherché, argument fort post-2022' : 'Impact modéré sur le prix'}
Adapte les facteurs aux informations connues du bien.]
 
===RECOMMANDATION===
[Paragraphe en prose de 3-4 phrases avec un prix de mise en marché précis et la stratégie.
${proprietaireNom ? `Adresse-toi directement à ${proprietaireNom}.` : ''}
${motifVente ? `Tiens compte du motif de vente : ${motifVente}.` : ''}
Termine par un message de réassurance sur la maîtrise du marché local.]
 
Ton : professionnel, rassurant, factuel.
Le propriétaire doit comprendre que l'agent maîtrise parfaitement son marché.`;
 
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
 
    const raw = claudeData.content[0].text;
    console.log(`[MANDAT][SYNTHESE] Analyse rédigée (${raw.length} caractères)`);
 
    // Parse les 4 blocs délimités par ===TAG===
    // Permet au /api/pdf de les traiter différemment (tableau pour FACTEURS)
    const extract = (tag) => {
      const re = new RegExp(`===${tag}===\s*([\s\S]*?)(?====|$)`, 'i');
      const m  = raw.match(re);
      return m ? m[1].trim() : '';
    };
 
    res.json({
      synthese: raw, // texte brut complet en fallback
      blocs: {
        marche:          extract('MARCHE'),
        estimation:      extract('ESTIMATION'),
        facteurs:        extract('FACTEURS'),
        recommandation:  extract('RECOMMANDATION'),
      }
    });
 
  } catch(e) {
    console.error('[MANDAT][SYNTHESE] Erreur :', e.message);
    res.status(500).json({ error: e.message });
  }
});
 
// ÉTAPE 3 — Génération du rapport HTML
// Construit un document HTML standalone avec mise en page A4 professionnelle
// Stratégie marges : pas de @page margin:0 — on utilise un .page centré
// avec padding interne, comme pour la pige. Rendu propre sans config impression.
app.post('/api/pdf', async (req, res) => {
  const { adresse, stats, transactions, synthese, blocs, agence, bien } = req.body;
 
  try {
    console.log(`[MANDAT][PDF] Génération du rapport pour : ${adresse}`);
 
    const now_str = new Date().toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' });
 
    // ── Conversion Markdown → HTML via marked ──────────────
    const { marked } = require('marked');
 
    // Construit les 4 sections avec titres si les blocs sont disponibles
    // Sinon fallback sur le texte brut
    let syntheseHtml = '';
    if (blocs && (blocs.marche || blocs.estimation || blocs.facteurs || blocs.recommandation)) {
 
      // Section 1 — Le marché local
      if (blocs.marche) {
        syntheseHtml += `
          <h3 class="bloc-titre">Le marché local</h3>
          <div class="synthese-prose">${marked.parse(blocs.marche)}</div>`;
      }
 
      // Section 2 — Estimation de valeur
      if (blocs.estimation) {
        syntheseHtml += `
          <h3 class="bloc-titre">Estimation de valeur</h3>
          <div class="synthese-prose">${marked.parse(blocs.estimation)}</div>`;
      }
 
      // Section 3 — Facteurs distinctifs en tableau
      if (blocs.facteurs) {
        const lignesFact = blocs.facteurs
          .split('\n')
          .map(l => l.trim())
          .filter(l => l.includes('|') && !l.startsWith('Facteur')) // skip header
          .map(l => {
            const parts = l.split('|').map(p => p.trim());
            const impact = parts[1] || '';
            const couleur = impact.startsWith('+') ? '#2a8a60'
                          : impact.startsWith('-') ? '#c84040'
                          : '#8a8478';
            return `<tr>
              <td style="font-weight:500;color:#1c1a16">${parts[0] || ''}</td>
              <td style="font-weight:700;color:${couleur}">${impact}</td>
              <td style="color:#4a4640">${parts[2] || ''}</td>
            </tr>`;
          }).join('');
 
        if (lignesFact) {
          syntheseHtml += `
            <h3 class="bloc-titre">Facteurs distinctifs du bien</h3>
            <table class="fact-table">
              <thead><tr>
                <th>Facteur</th>
                <th>Impact estimé</th>
                <th>Explication</th>
              </tr></thead>
              <tbody>${lignesFact}</tbody>
            </table>`;
        }
      }
 
      // Section 4 — Recommandation
      if (blocs.recommandation) {
        syntheseHtml += `
          <h3 class="bloc-titre">Recommandation</h3>
          <div class="synthese-prose">${marked.parse(blocs.recommandation)}</div>`;
      }
 
    } else {
      // Fallback — texte brut complet converti en HTML
      syntheseHtml = marked.parse(synthese || '');
    }
 
    // ── Lignes tableau DVF ────────────────────────────────────
    const lignes = transactions.slice(0, 15).map(t => `
      <tr>
        <td>${t.date_mutation || '—'}</td>
        <td>${t.type_local || '—'}</td>
        <td>${t.surface || '—'} m²</td>
        <td>${parseInt(t.prix || 0).toLocaleString('fr-FR')} €</td>
        <td><strong>${Math.round(t.prix_m2 || 0).toLocaleString('fr-FR')} €/m²</strong></td>
        <td style="color:#8a8478;font-size:10px">
          ${[t.code_postal, t.ville].filter(Boolean).join(' ') || '—'}
        </td>
      </tr>`).join('');
 
    // ── Caractéristiques du bien ──────────────────────────────
    const bienItems = [
      bien?.type         && `<div class="bi"><span class="bi-l">Type</span><span class="bi-v">${bien.type}</span></div>`,
      bien?.surface      && `<div class="bi"><span class="bi-l">Surface</span><span class="bi-v">${bien.surface} m²</span></div>`,
      bien?.pieces       && `<div class="bi"><span class="bi-l">Pièces</span><span class="bi-v">${bien.pieces}</span></div>`,
      bien?.etage        && `<div class="bi"><span class="bi-l">Étage</span><span class="bi-v">${bien.etage}</span></div>`,
      bien?.dpe          && `<div class="bi"><span class="bi-l">DPE</span><span class="bi-v dpe-${(bien.dpe||'').toLowerCase()}">${bien.dpe}</span></div>`,
      bien?.etat         && `<div class="bi"><span class="bi-l">État</span><span class="bi-v">${bien.etat}</span></div>`,
      bien?.prix_demande && `<div class="bi"><span class="bi-l">Prix demandé</span><span class="bi-v gold">${parseInt(bien.prix_demande).toLocaleString('fr-FR')} €</span></div>`,
    ].filter(Boolean).join('');
 
    // ── Estimations calculées ─────────────────────────────────
    const surf = parseInt(bien?.surface) || 0;
    const estMin = surf && stats.min_m2    ? Math.round(surf * stats.min_m2   ).toLocaleString('fr-FR') : null;
    const estMed = surf && stats.mediane_m2? Math.round(surf * stats.mediane_m2).toLocaleString('fr-FR') : null;
    const estMax = surf && stats.max_m2    ? Math.round(surf * stats.max_m2   ).toLocaleString('fr-FR') : null;
 
    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dossier Mandat — ${adresse}</title>
<style>
/* ── Fonts ── */
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600&family=Figtree:wght@300;400;500;600&display=swap');
 
/* ── Reset ── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
 
/* ── Config impression ──
   Marges gérées par .page (padding interne)
   → rendu identique écran et impression */
@media print {
  @page { size: A4 portrait; margin: 0; }
  html, body { width: 210mm; }
  .page {
    box-shadow: none !important;
    border-radius: 0 !important;
    margin: 0 !important;
    max-width: 100% !important;
  }
  .no-print { display: none !important; }
  .cover { border-radius: 0 !important; }
}
 
/* ── Fond page et centrage ── */
html { background: #e8e0d0; min-height: 100vh; }
body {
  font-family: 'Figtree', sans-serif;
  font-size: 11.5px; line-height: 1.65; color: #1c1a16;
  padding: 24px;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
 
/* ── Conteneur page — simule les marges A4 ── */
.page {
  background: white;
  max-width: 740px;
  margin: 0 auto;
  box-shadow: 0 4px 40px rgba(0,0,0,.15);
  border-radius: 4px;
  overflow: hidden;
}
 
/* ── COVER ── */
.cover {
  background: #1c1a16;
  padding: 48px 44px 40px;
  color: #f7f4ee;
}
.cover-stripe {
  height: 4px;
  background: linear-gradient(90deg, #b8893a, #d4a853, #b8893a);
  margin: -48px -44px 36px -44px;
}
.cover-label {
  font-size: 8.5px; letter-spacing: 3px;
  text-transform: uppercase; color: #b8893a;
  font-weight: 700; margin-bottom: 14px;
}
.cover-title {
  font-family: 'Cormorant Garamond', serif;
  font-size: 30px; font-weight: 300; line-height: 1.2;
  margin-bottom: 6px;
}
.cover-adresse {
  font-size: 14px; color: rgba(247,244,238,.6);
  font-weight: 300; margin-bottom: 36px;
}
.cover-meta {
  display: flex; gap: 0;
  border-top: 1px solid rgba(255,255,255,.1);
  padding-top: 22px;
}
.cm { flex: 1; padding-right: 22px; border-right: 1px solid rgba(255,255,255,.07); margin-right: 22px; }
.cm:last-child { border-right: none; padding-right: 0; margin-right: 0; }
.cm-lbl {
  font-size: 8px; color: #b8893a; letter-spacing: 2px;
  text-transform: uppercase; font-weight: 600;
  display: block; margin-bottom: 5px;
}
.cm-val {
  font-family: 'Cormorant Garamond', serif;
  font-size: 20px; font-weight: 600; color: #f7f4ee; line-height: 1;
}
.cm-unit { font-size: 11px; color: rgba(247,244,238,.4); font-family: 'Figtree', sans-serif; margin-left: 2px; }
 
/* ── SECTIONS ── */
.section { padding: 26px 44px; border-bottom: 1px solid #ede8df; }
.section:last-of-type { border-bottom: none; }
.sec-title {
  font-size: 8.5px; letter-spacing: 2.5px;
  text-transform: uppercase; color: #9a9180; font-weight: 600;
  margin-bottom: 16px; padding-bottom: 8px;
  border-bottom: 1px solid #e8e0d0;
}
 
/* ── STATS GRID ── */
.stats-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; margin-bottom: 0; }
.stat-box {
  background: #f7f4ee; border: 1px solid #e8e0d0;
  border-radius: 8px; padding: 13px 14px;
}
.stat-box label {
  font-size: 8px; color: #9a9180; text-transform: uppercase;
  letter-spacing: 1.5px; display: block; margin-bottom: 5px; font-weight: 500;
}
.stat-box .val {
  font-family: 'Cormorant Garamond', serif;
  font-size: 22px; font-weight: 600; color: #b8893a; line-height: 1;
}
.stat-box .sub { font-size: 9.5px; color: #9a9180; margin-top: 2px; }
 
/* ── ESTIMATION ── */
.estim {
  background: #1c1a16; border-radius: 9px;
  padding: 16px 20px; margin-top: 12px;
  display: flex; align-items: center; gap: 0;
}
.estim-col { flex: 1; padding-right: 20px; border-right: 1px solid rgba(255,255,255,.07); margin-right: 20px; }
.estim-col:last-child { border-right: none; padding-right: 0; margin-right: 0; }
.estim-lbl { font-size: 8px; color: #b8893a; text-transform: uppercase; letter-spacing: 2px; font-weight: 600; margin-bottom: 5px; }
.estim-val { font-family: 'Cormorant Garamond', serif; font-size: 22px; font-weight: 600; color: #f7f4ee; line-height: 1; }
.estim-sub { font-size: 9px; color: rgba(247,244,238,.35); margin-top: 3px; }
 
/* ── BIEN ── */
.bien-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; }
.bi {
  background: #f7f4ee; border: 1px solid #e8e0d0;
  border-radius: 7px; padding: 9px 12px;
  display: flex; flex-direction: column; gap: 3px;
}
.bi-l { font-size: 8px; color: #9a9180; text-transform: uppercase; letter-spacing: 1px; font-weight: 500; }
.bi-v { font-size: 12.5px; font-weight: 500; color: #1c1a16; }
.bi-v.gold { color: #b8893a; font-weight: 600; }
.dpe-a { color: #1a7a50 !important; font-weight: 700; }
.dpe-b { color: #2a8a60 !important; font-weight: 700; }
.dpe-c { color: #7a9a20 !important; font-weight: 700; }
.dpe-d { color: #c8a020 !important; font-weight: 700; }
.dpe-e { color: #c87020 !important; font-weight: 700; }
.dpe-f { color: #c84040 !important; font-weight: 700; }
.dpe-g { color: #901010 !important; font-weight: 700; }
 
.points-box {
  margin-top: 10px; padding: 11px 14px;
  background: rgba(184,137,58,.05);
  border: 1px solid rgba(184,137,58,.2);
  border-radius: 7px;
  font-size: 11px; color: #4a4640; line-height: 1.6;
}
.points-box::before { content: '✦  '; color: #b8893a; }
 
/* ── SYNTHÈSE ── */
.synthese { font-size: 11.5px; color: #4a4640; line-height: 1.8; font-weight: 300; }
.synthese p { margin-bottom: 11px; }
.synthese h2 { font-family: 'Cormorant Garamond', serif; font-size: 15px; font-weight: 400; color: #1c1a16; margin: 16px 0 6px; }
.synthese h3 { font-size: 12px; font-weight: 600; color: #1c1a16; margin: 13px 0 5px; }
.synthese h4 { font-size: 11.5px; font-weight: 600; color: #4a4640; margin: 9px 0 4px; }
.synthese strong { font-weight: 600; color: #1c1a16; }
.synthese em { font-style: italic; }
.synthese ul { padding-left: 16px; margin: 6px 0 11px; }
.synthese li { margin-bottom: 4px; }
 
/* ── TITRES DE BLOCS ── */
.bloc-titre {
  font-size: 9px; letter-spacing: 2px; text-transform: uppercase;
  color: #b8893a; font-weight: 700; font-family: 'Figtree', sans-serif;
  margin: 20px 0 10px; padding-bottom: 6px;
  border-bottom: 1px solid rgba(184,137,58,.25);
  display: flex; align-items: center; gap: 8px;
}
.bloc-titre::before { content: ''; display: inline-block; width: 3px; height: 12px; background: #b8893a; border-radius: 2px; }
.synthese-prose p { margin-bottom: 10px; font-size: 11.5px; color: #4a4640; line-height: 1.75; font-weight: 300; }
 
/* ── TABLEAU FACTEURS DISTINCTIFS ── */
.fact-table {
  width: 100%; border-collapse: collapse; font-size: 10.5px;
  margin: 10px 0 6px; table-layout: fixed;
}
.fact-table th {
  background: #f0ebe0 !important;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
  padding: 8px 10px; text-align: left;
  font-size: 8px; letter-spacing: 1.5px; text-transform: uppercase;
  color: #b8893a; font-weight: 700;
  border-bottom: 2px solid #b8893a;
}
.fact-table th:nth-child(1) { width: 28%; }
.fact-table th:nth-child(2) { width: 20%; }
.fact-table th:nth-child(3) { width: 52%; }
.fact-table tbody tr:nth-child(even) {
  background: #f7f4ee !important;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.fact-table td { padding: 7px 10px; border-bottom: 1px solid #ede8df; vertical-align: middle; }
.fact-table tr:last-child td { border-bottom: none; }
 
/* ── TABLE DVF — CSS robuste à l'impression ──
   Pas de background sombre sur les th : les navigateurs l'ignorent souvent
   On utilise une bordure dorée en bas + texte doré sur fond crème à la place */
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 10.5px;
  margin-top: 8px;
  table-layout: fixed;
}
th {
  background: #f0ebe0 !important;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
  padding: 9px 10px;
  text-align: left;
  font-size: 8px; letter-spacing: 1.5px;
  text-transform: uppercase;
  color: #b8893a;
  font-weight: 700;
  border-bottom: 2px solid #b8893a;
}
tbody tr:nth-child(even) {
  background: #f7f4ee !important;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
td {
  padding: 7px 10px;
  border-bottom: 1px solid #ede8df;
  color: #4a4640;
  vertical-align: middle;
  word-wrap: break-word;
}
tr:last-child td { border-bottom: none; }
td strong { color: #1c1a16; font-weight: 600; }
th:nth-child(1), td:nth-child(1) { width: 14%; }
th:nth-child(2), td:nth-child(2) { width: 16%; }
th:nth-child(3), td:nth-child(3) { width: 11%; }
th:nth-child(4), td:nth-child(4) { width: 19%; }
th:nth-child(5), td:nth-child(5) { width: 15%; }
th:nth-child(6), td:nth-child(6) { width: 25%; }
 
/* ── SOURCE ── */
.source { font-size: 9px; color: #b8b0a0; font-style: italic; margin-top: 12px; padding-top: 10px; border-top: 1px solid #ede8df; }
 
/* ── FOOTER ── */
.footer {
  padding: 16px 44px;
  display: flex; justify-content: space-between; align-items: center;
  background: #faf8f4; border-top: 1px solid #e8e0d0;
}
.footer-brand { font-family: 'Cormorant Garamond', serif; font-size: 15px; color: #9a9180; }
.footer-brand em { font-style: italic; color: #b8893a; }
.footer-info { font-size: 9px; color: #b8b0a0; text-align: right; line-height: 1.6; }
 
/* ── BOUTON IMPRESSION ── */
.print-btn {
  display: block; margin: 20px auto 0;
  background: linear-gradient(135deg, #b8893a, #d4a853);
  color: white; border: none; padding: 11px 30px;
  border-radius: 8px; font-size: 13px; font-weight: 600;
  cursor: pointer; font-family: 'Figtree', sans-serif;
  transition: all .2s;
}
.print-btn:hover { opacity: .9; transform: translateY(-1px); }
</style>
</head>
<body>
 
<div class="page">
 
  <!-- ══ COVER ═══════════════════════════════════════════════ -->
  <div class="cover">
    <div class="cover-stripe"></div>
    <div class="cover-label">Dossier de prise de mandat · LeadFlow</div>
    <div class="cover-title">Analyse de marché<br>& Recommandation IA</div>
    <div class="cover-adresse">📍 ${adresse}</div>
    <div class="cover-meta">
      <div class="cm">
        <span class="cm-lbl">Prix médian</span>
        <div class="cm-val">${stats.mediane_m2 ? stats.mediane_m2.toLocaleString('fr-FR') : '—'}<span class="cm-unit">€/m²</span></div>
      </div>
      <div class="cm">
        <span class="cm-lbl">Transactions</span>
        <div class="cm-val">${stats.nb || 0}<span class="cm-unit">ventes</span></div>
      </div>
      ${estMed ? `<div class="cm">
        <span class="cm-lbl">Estimation médiane</span>
        <div class="cm-val">${estMed}<span class="cm-unit">€</span></div>
      </div>` : ''}
      <div class="cm">
        <span class="cm-lbl">Préparé par</span>
        <div class="cm-val" style="font-size:14px;font-family:'Figtree',sans-serif;font-weight:500">${agence?.nom || 'Votre agence'}</div>
      </div>
      <div class="cm">
        <span class="cm-lbl">Généré le</span>
        <div class="cm-val" style="font-size:14px;font-family:'Figtree',sans-serif;font-weight:400">${now_str}</div>
      </div>
    </div>
  </div>
 
  <!-- ══ CARACTÉRISTIQUES DU BIEN ════════════════════════════ -->
  ${bienItems ? `<div class="section">
    <div class="sec-title">Caractéristiques du bien</div>
    <div class="bien-grid">${bienItems}</div>
    ${bien?.points_forts ? `<div class="points-box">${bien.points_forts}</div>` : ''}
  </div>` : ''}
 
  <!-- ══ MARCHÉ LOCAL — DVF ═══════════════════════════════════ -->
  <div class="section">
    <div class="sec-title">Marché local · Données DVF officielles</div>
    <div class="stats-grid">
      <div class="stat-box">
        <label>Prix médian</label>
        <div class="val">${stats.mediane_m2 ? stats.mediane_m2.toLocaleString('fr-FR') : '—'}</div>
        <div class="sub">€ / m²</div>
      </div>
      <div class="stat-box">
        <label>Fourchette basse</label>
        <div class="val">${stats.min_m2 ? stats.min_m2.toLocaleString('fr-FR') : '—'}</div>
        <div class="sub">€ / m²</div>
      </div>
      <div class="stat-box">
        <label>Fourchette haute</label>
        <div class="val">${stats.max_m2 ? stats.max_m2.toLocaleString('fr-FR') : '—'}</div>
        <div class="sub">€ / m²</div>
      </div>
      <div class="stat-box">
        <label>Nb. transactions</label>
        <div class="val">${stats.nb || 0}</div>
        <div class="sub">dans 300m</div>
      </div>
    </div>
    ${estMin && estMax ? `<div class="estim">
      <div class="estim-col">
        <div class="estim-lbl">Estimation basse</div>
        <div class="estim-val">${estMin} €</div>
        <div class="estim-sub">${stats.min_m2?.toLocaleString('fr-FR')} €/m² × ${bien?.surface} m²</div>
      </div>
      <div class="estim-col">
        <div class="estim-lbl">Estimation médiane</div>
        <div class="estim-val">${estMed} €</div>
        <div class="estim-sub">${stats.mediane_m2?.toLocaleString('fr-FR')} €/m² × ${bien?.surface} m²</div>
      </div>
      <div class="estim-col">
        <div class="estim-lbl">Estimation haute</div>
        <div class="estim-val">${estMax} €</div>
        <div class="estim-sub">${stats.max_m2?.toLocaleString('fr-FR')} €/m² × ${bien?.surface} m²</div>
      </div>
    </div>` : ''}
  </div>
 
  <!-- ══ ANALYSE IA ════════════════════════════════════════════ -->
  <div class="section">
    <div class="sec-title">Analyse &amp; Recommandations · Intelligence Artificielle</div>
    <div class="synthese">${syntheseHtml}</div>
  </div>
 
  <!-- ══ TRANSACTIONS DVF ══════════════════════════════════════ -->
  <div class="section">
    <div class="sec-title">Transactions de référence · ${stats.nb || 0} ventes dans un rayon de 300m</div>
    ${lignes ? `<table>
      <thead><tr>
        <th>Date</th><th>Type</th><th>Surface</th>
        <th>Prix de vente</th><th>Prix / m²</th><th>Localisation</th>
      </tr></thead>
      <tbody>${lignes}</tbody>
    </table>` : '<p style="color:#9a9180;font-style:italic;font-size:11px;padding:8px 0">Aucune transaction DVF dans ce secteur.</p>'}
    <div class="source">
      Source : Demande de Valeurs Foncières (DVF) — Ministère de l'Économie et des Finances.
      Données officielles des transactions notariées. Période : ${stats.periode || '—'}.
    </div>
  </div>
 
  <!-- ══ FOOTER ════════════════════════════════════════════════ -->
  <div class="footer">
    <div class="footer-brand">Lead<em>Flow</em> · Mandat</div>
    <div class="footer-info">
      ${agence?.nom || 'Votre agence'}${agence?.agent ? ' · ' + agence.agent : ''}<br>
      Données DVF · ${now_str}
    </div>
  </div>
 
</div><!-- /page -->
 
<!-- Bouton impression — masqué à l'impression -->
<button class="print-btn no-print" onclick="window.print()">
  🖨&nbsp; Imprimer / Enregistrer en PDF
</button>
 
</body>
</html>`;

  // 2. ENVOYER LA RÉPONSE
  res.send(html);

  } catch(e) {
    console.error(`[MANDAT][PDF] ❌ Erreur:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

    // ── Log en base + envoi ───────────────────────────────────
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
