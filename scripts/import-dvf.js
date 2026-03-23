const { Pool } = require('pg');
const fs       = require('fs');
const { parse } = require('csv-parse');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Chemin du fichier CSV à importer
// Lance avec : node scripts/import-dvf.js 69/mutations.csv
const fichier = process.argv[2];
if (!fichier) {
  console.error('Usage : node scripts/import-dvf.js <chemin/mutations.csv>');
  process.exit(1);
}

async function importDVF() {
  const client = await pool.connect();
  let count = 0;
  let skipped = 0;

  console.log(`Importation de ${fichier}...`);

  const parser = fs.createReadStream(fichier).pipe(
    parse({ columns: true, skip_empty_lines: true, trim: true })
  );

  // Traitement par batch de 500 pour ne pas surcharger PostgreSQL
  let batch = [];

  for await (const row of parser) {
    // On ne garde que les appartements et maisons avec surface > 0
    const typeLocal = row['type_local'];
    if (!['Appartement', 'Maison'].includes(typeLocal)) continue;

    const surface = parseFloat(row['surface_reelle_bati']);
    const valeur  = parseFloat(row['valeur_fonciere']?.replace(',', '.'));
    const lat     = parseFloat(row['latitude']);
    const lon     = parseFloat(row['longitude']);

    if (!surface || surface <= 0 || !valeur || !lat || !lon) {
      skipped++;
      continue;
    }

    const adresse = [
      row['no_voie'], row['type_voie'], row['voie']
    ].filter(Boolean).join(' ');

    batch.push([
      adresse,
      typeLocal,
      surface,
      parseInt(row['nombre_pieces_principales']) || null,
      valeur,
      Math.round(valeur / surface),
      row['date_mutation'] || null,
      lat,
      lon,
      row['code_postal'] || null,
      row['commune']     || null,
    ]);

    // Insertion par batch de 500
    if (batch.length >= 500) {
      await insertBatch(client, batch);
      count += batch.length;
      batch = [];
      process.stdout.write(`\r${count} lignes importées...`);
    }
  }

  // Insérer le dernier batch
  if (batch.length > 0) {
    await insertBatch(client, batch);
    count += batch.length;
  }

  console.log(`\n✅ Import terminé — ${count} transactions importées, ${skipped} ignorées`);
  client.release();
  await pool.end();
}

async function insertBatch(client, rows) {
  // Génère les placeholders : ($1,$2,...,$11), ($12,$13,...,$22), ...
  const values = [];
  const placeholders = rows.map((row, i) => {
    const offset = i * 11;
    values.push(...row);
    return `($${offset+1},$${offset+2},$${offset+3},$${offset+4},$${offset+5},$${offset+6},$${offset+7},$${offset+8},$${offset+9},$${offset+10},$${offset+11})`;
  });

  await client.query(
    `INSERT INTO dvf (adresse, type_local, surface, nb_pieces, prix, prix_m2, date_mutation, lat, lon, code_postal, ville)
     VALUES ${placeholders.join(',')}
     ON CONFLICT DO NOTHING`,
    values
  );
}

importDVF().catch(console.error);