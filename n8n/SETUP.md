# LeadFlow — Workflows n8n

## Architecture

```
[IMAP]  ──→  workflow-source-imap.json        ──→ (webhook interne) ──→
                                                                        workflow-traitement-lead.json
[SweepBright]  ──→  workflow-source-sweepbright.json  ──→ (webhook interne) ──→
```

**workflow-traitement-lead.json** — workflow principal :
1. Reçoit le lead normalisé
2. Claude analyse le message → score, température (chaud/tiède/froid), 3 emails
3. Enregistre dans LeadFlow (dashboard)
4. Brevo → email de bienvenue J0 au lead
5. Brevo → récapitulatif à l'agent
6. Attente 2 jours → Brevo relance J2
7. Attente 5 jours → Brevo relance J7

---

## Import dans n8n

1. **Settings → Workflows → Import** — importer d'abord `workflow-traitement-lead.json`
2. Importer ensuite `workflow-source-imap.json` et/ou `workflow-source-sweepbright.json`

---

## Variables à configurer (Settings → Variables)

| Variable             | Description                                         | Exemple                          |
|----------------------|-----------------------------------------------------|----------------------------------|
| `ANTHROPIC_API_KEY`  | Clé API Anthropic (Claude)                          | `sk-ant-api03-...`               |
| `BREVO_API_KEY`      | Clé API Brevo — utilisée pour emails ET SMS         | `xkeysib-...`                    |
| `LEADFLOW_URL`       | URL du backend LeadFlow (sans slash final)          | `https://xxx.railway.app`        |
| `N8N_WEBHOOK_BASE`   | URL de base de cette instance n8n                   | `https://n8n.exemple.com`        |
| `AGENT_NAME`         | Nom affiché comme expéditeur email                  | `Sophie Martin`                  |
| `AGENT_EMAIL`        | Email de l'agent (expéditeur + répondre-à)          | `sophie@agence.com`              |
| `AGENT_PHONE`        | Numéro de l'agent pour SMS (format E.164)           | `+33612345678`                   |
| `SENDER_EMAIL`       | Email expéditeur Brevo (optionnel, = AGENT_EMAIL)   | `noreply@agence.com`             |
| `SWEEPBRIGHT_API_KEY`| Clé API SweepBright (si applicable)                 | `sb_live_...`                    |

---

## Credentials à configurer

### Credential IMAP (workflow-source-imap.json)
- Type : **IMAP**
- Nom suggéré : `IMAP Agence`
- Configurer dans n8n : Settings → Credentials → Add → Email (IMAP)

### Credentials Anthropic & Brevo
Les clés sont passées via les **Variables** (pas Credentials) pour plus de flexibilité.
Utiliser des Credentials HTTP Header Auth si vous préférez la sécurité renforcée.

---

## Logique de déduplication

- **IMAP** : l'ID du lead = `imap_<Message-ID>` — chaque email n'est traité qu'une fois (marqué comme lu)
- **SweepBright** : l'ID du lead = `sb_<contact.id>` — stable, `ON CONFLICT DO NOTHING` côté LeadFlow
- **LeadFlow** : `INSERT ... ON CONFLICT (id) DO NOTHING` — protection finale côté base

---

## Adapter le mapping SweepBright

L'API SweepBright peut varier selon la configuration. Dans le node **"Normaliser Contacts SweepBright"**,
ajuster les champs si nécessaire :
- `c.first_name` / `c.last_name` → selon la réponse API réelle
- `c.properties_of_interest[0]` → selon le schéma SweepBright de votre agence
- `c.notes` / `c.message` → selon où SweepBright stocke le message du contact

---

## Températures et scores

| Température | Score  | Critères                                               |
|-------------|--------|--------------------------------------------------------|
| 🔥 Chaud    | 80-100 | Projet défini, délai < 3 mois, message détaillé        |
| 🌤️ Tiède   | 50-79  | Projet en cours, délai 3-6 mois                        |
| ❄️ Froid   | 0-49   | Projet vague, délai > 6 mois ou peu d'informations     |

Ces critères sont dans le prompt Claude — ajustable dans le node **"Construire Prompt Claude"**.
