const pool = require('./db');

// Permet de créer les table la première fois
async function setup() {
  const client = await pool.connect();
  try {
    await client.query(`

      -- Table leads (dashboard suivi)
      CREATE TABLE IF NOT EXISTS leads (
        id            TEXT PRIMARY KEY,
        prenom        TEXT,
        nom           TEXT,
        email         TEXT,
        tel           TEXT,
        bien          TEXT,
        ville         TEXT,
        source        TEXT,
        projet        TEXT,
        message       TEXT,
        score         TEXT,
        score_raison  TEXT,
        statut        TEXT DEFAULT 'new',
        email_bienvenue TEXT,
        relance_j2    TEXT,
        relance_j7    TEXT,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );

      -- Table emails MailMind
      CREATE TABLE IF NOT EXISTS emails (
        id            SERIAL PRIMARY KEY,
        from_addr     TEXT,
        subject       TEXT,
        body          TEXT,
        reponse       TEXT,
        sujet_reponse TEXT,
        complexite    TEXT,
        raison        TEXT,
        statut        TEXT DEFAULT 'pending',
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );

      -- Table biens pige
      CREATE TABLE IF NOT EXISTS biens_pige (
        id            TEXT PRIMARY KEY,
        type          TEXT,
        titre         TEXT,
        adresse       TEXT,
        prix          INTEGER,
        surface       INTEGER,
        pieces        INTEGER,
        etage         TEXT,
        dpe           TEXT,
        source        TEXT,
        url           TEXT,
        date_annonce  TEXT,
        statut        TEXT DEFAULT 'new',
        potentiel     TEXT,
        score         INTEGER,
        score_raison  TEXT,
        approche      TEXT,
        accroche      TEXT,
        script        TEXT,
        emoji         TEXT,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );

      -- Table dossiers mandat générés
      CREATE TABLE IF NOT EXISTS dossiers_mandat (
        id            SERIAL PRIMARY KEY,
        adresse       TEXT,
        lat           REAL,
        lon           REAL,
        nb_transactions INTEGER,
        median_m2     INTEGER,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );

    `);
    console.log('✅ Tables créées avec succès');
  } finally {
    client.release();
    await pool.end();
  }
}

setup().catch(console.error);