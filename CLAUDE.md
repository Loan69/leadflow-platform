# LeadFlow Platform — CLAUDE.md

## Contexte business

LeadFlow est un SaaS immobilier B2B en phase d'amorçage. L'objectif immédiat est d'obtenir
le premier client pilote (gratuit 2 mois) puis les premiers clients payants.

**Cible** : agences immobilières indépendantes (pas de franchise : pas Orpi, Century 21, IAD,
Laforêt), 1 à 5 agents, 10 à 50 avis Google, note 3,5 à 4,5/5, zone Lyon et métropole.

**Pricing validé** (basé sur la valeur créée, pas sur le MRR cible) :
- Offre Solo : 250€ install + 397€/mois (1-2 agents)
- Offre Pro : 250€ install + 597€/mois (3-5 agents) ← cœur de cible
- Offre Équipe : sur devis 997€+/mois (5+ agents)
- Marge nette ~527€/client/mois sur l'offre Pro après ~70€ de coûts variables

**Plan acquisition (Bloc 1 en cours)** :
1. Cartographier 50 agences cibles sur Google Maps
2. Email personnalisé + appel J+3 + relance J+7 (3 touches max par prospect)
3. RDV démo (écoute 5 min → démo 3 modules → proposition partenariat test gratuit)
4. Onboarding accompagné (appel hebdo, WhatsApp, tableau de bord partagé)
5. Conversion à 597€/mois à la fin des 2 mois de test

**La métrique qui vend tout** : mandats supplémentaires décrochés grâce à LeadFlow.
Une agence qui rentre 1 mandat de plus/mois (~5 000€ commission) amortit le SaaS en 1 jour.

**Leviers de rétention** : données propriétaires accumulées, rapport mensuel de performance,
intégration profonde dans le workflow quotidien (pige 8h, relances auto, rédaction mandats).

---

## Présentation du projet

SaaS immobilier (Node.js + Express + PostgreSQL) déployé sur Railway.
Modules principaux :
- **Leads** — dashboard de gestion des leads entrants (via webhook n8n ou formulaire)
- **Mandat** — génération de mandats PDF
- **Pige** — module de prospection automatisée (scraping PAP, analyse IA, email récap Brevo)

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
