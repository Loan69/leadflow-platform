# LeadFlow Platform — CLAUDE.md

## Présentation du projet

SaaS immobilier (Node.js + Express + PostgreSQL) déployé sur Railway.
Modules principaux :
- **Leads** — dashboard de gestion des leads entrants (via webhook n8n ou formulaire)
- **Mandat** — génération de mandats PDF
- **Pige** — module de prospection

## Stack technique

- **Backend** : Node.js, Express (`server.js`)
- **Base de données** : PostgreSQL via `pg` (pool dans `db.js`), hébergée sur Railway
- **Frontend** : HTML/CSS/JS vanilla — un `index.html` par module dans `public/`
- **Déploiement** : Railway (`NODE_ENV=production` active SSL sur la DB)

## Lancer le projet

```bash
npm run dev      # développement (nodemon)
npm start        # production
```

## Variables d'environnement

| Variable                    | Usage                                              |
|-----------------------------|----------------------------------------------------|
| `DATABASE_URL`              | Connexion PostgreSQL (Railway)                     |
| `NODE_ENV`                  | `production` active SSL sur la DB                  |
| `N8N_SEND_EMAIL_WEBHOOK`    | URL webhook n8n pour envoi email validé (MailMind) |

Le fichier `.env` ne doit jamais être commité.

## Conventions de code

- Routes API dans `server.js`, préfixées `/api/` ou `/webhook/`
- Les colonnes JSON en base utilisent `JSONB` (ex: `history`, `email_status`, `send_history`)
- Le frontend communique avec le backend via `fetch()` en JSON
- Nommage SQL : snake_case ; nommage JS côté client : camelCase (mapping explicite dans les requêtes SQL avec `AS "emailStatus"`, etc.)

## Architecture des fichiers

```
server.js          — point d'entrée, toutes les routes Express
db.js              — pool PostgreSQL partagé
setup-db.js        — script d'initialisation du schéma
public/
  index.html       — page d'accueil / navigation
  leads/           — dashboard leads
  mandat/          — générateur de mandats
  pige/            — module pige
  mail/            — templates email
scripts/
  import-dvf.js    — import données DVF
data/              — fichiers de données statiques
```

## Points d'attention

- Le webhook `/webhook/lead` reçoit les leads depuis n8n — ne pas casser ce contrat
- `ON CONFLICT (id) DO NOTHING` sur l'insert des leads : l'`id` est la clé de déduplication
- SSL Railway : `rejectUnauthorized: false` est intentionnel en production
- Pas de framework frontend : éviter d'introduire React/Vue sans décision explicite
