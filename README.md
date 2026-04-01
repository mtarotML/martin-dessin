# martin-dessin

Projet pédagogique couvrant les fondamentaux de l'administration système et du développement web : **base de données, conteneurisation, reverse proxy, authentification, HTTPS, hébergement cloud**.

Le dépôt est déployé sur une **VM Oracle Cloud Free Tier** et remplit deux rôles :

1. **Reverse proxy Nginx** pour [martintarot.com](https://martintarot.com) (GitHub Pages, Heroku, etc.)
2. **Application web de concours de dessin** (FastAPI + PostgreSQL)

## Stack technique

| Couche | Technologie |
|---|---|
| Backend | Python 3.11, FastAPI, Uvicorn |
| Base de données | PostgreSQL 15 |
| Conteneurisation | Docker, Docker Compose |
| Reverse proxy | Nginx |
| TLS | Let's Encrypt (Certbot) |
| Hébergement | Oracle Cloud — VM ARM Free Tier |

## Architecture

```
Internet
  │
  ├─ HTTPS ──▶ Nginx (port 443)
  │              ├─ /                 → GitHub Pages (martintarot.com)
  │              ├─ /martin-dessin/   → FastAPI (app de dessin)
  │              └─ /fashion-mnist/   → Heroku
  │
  └─ HTTP (80) ──▶ redirection HTTPS + ACME challenge
```

## Thématiques abordées

- **Conteneurisation** — multi-services avec Docker Compose (profils `proxy` pour la prod)
- **Base de données** — schéma relationnel PostgreSQL (users, sessions, drawings, reactions, comments)
- **Authentification** — hachage PBKDF2-SHA256, sessions cookie HTTP-only, token admin
- **Reverse proxy** — routage Nginx vers plusieurs backends
- **Sécurité / HTTPS** — certificats Let's Encrypt, redirection HTTP→HTTPS, headers de sécurité
- **Sysadmin** — déploiement sur VM cloud, gestion des certificats, persistance des données

## Lancement local

```bash
cp .env.example .env   # configurer les variables
docker compose up -d   # démarre db + web
```

En production (avec Nginx + TLS) :

```bash
COMPOSE_PROFILES=proxy docker compose up -d
```
