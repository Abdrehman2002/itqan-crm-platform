# CRM Platform — Deployment Guide

Supports **cloud** (AWS, GCP, Azure, DigitalOcean) and **on-premises** deployments using the same Docker Compose stack.

---

## Quick Start (Both Cloud & On-Prem)

### 1. Clone and configure
```bash
git clone <your-repo>
cd crm-platform
cp .env.example .env
```

Edit `.env` and fill in:
```env
# Required
JWT_SECRET=<run: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
POSTGRES_PASSWORD=<strong-password>
REDIS_PASSWORD=<strong-password>
APP_URL=https://yourcrm.com          # your domain (used in CSAT email links)
PLATFORM_DOMAIN=yourcrm.com
CORS_ORIGINS=https://yourcrm.com

# Email (pick one)
SMTP_HOST=smtp.sendgrid.net
SMTP_USER=apikey
SMTP_PASS=<sendgrid-api-key>
SMTP_FROM=noreply@yourcrm.com
```

### 2. Deploy
```bash
# Production (recommended)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Development (with ports exposed for debugging)
docker compose up
```

That's it. On first start:
- PostgreSQL initialises an empty database
- The `migrate` service runs all SQL migrations automatically
- The API starts only after migrations succeed
- The frontend is served via nginx on port 80

---

## Cloud Deployment

### AWS / GCP / Azure / DigitalOcean

1. **Provision a VM** (minimum: 2 vCPU, 4 GB RAM)
2. Install Docker + Docker Compose:
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
3. Clone repo, configure `.env`, run `docker compose up -d`
4. Point your domain DNS → server IP
5. Set up SSL (Let's Encrypt via Certbot or Caddy)

### Managed Database (recommended for cloud)
Point `DATABASE_URL` to RDS / Cloud SQL / Supabase and **remove** the `postgres` service from docker-compose — the `migrate` service will still run against your managed DB.

```env
DATABASE_URL=postgresql://user:pass@your-rds-endpoint:5432/crm_platform
```

### Managed Redis
Point `REDIS_URL` to ElastiCache / Upstash and remove the `redis` service:
```env
REDIS_URL=redis://:password@your-redis-endpoint:6379
```

---

## On-Premises Deployment

Everything runs locally — no external cloud services required.

### File Storage (on-prem S3)
Uncomment the `minio` service in `docker-compose.yml`:
```yaml
minio:
  image: minio/minio:latest
  ...
```
Then set:
```env
S3_ENDPOINT=http://minio:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=<strong-password>
```

### SSL for On-Prem
Use Caddy (easiest) as a reverse proxy in front of the stack:
```bash
# Caddyfile
yourcrm.com {
  reverse_proxy frontend:80
}
api.yourcrm.com {
  reverse_proxy api:3000
}
```

---

## Upgrading

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

The `migrate` service automatically applies any new SQL migrations before the API restarts. Zero manual steps.

---

## Architecture

```
Internet
    │
    ▼
nginx (port 80/443)
    ├── /              → Frontend (React SPA, nginx static)
    ├── /api/*         → API (Fastify, Node.js)
    ├── /auth/*        → API
    ├── /public/csat/* → API (no auth — CSAT survey links)
    └── /graphql       → API
         │
         ├── PostgreSQL (multi-tenant RLS)
         └── Redis (queues, sessions, cache)
```

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | ✅ | 64-byte random hex string |
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `REDIS_URL` | ✅ | Redis connection string |
| `APP_URL` | ✅ | Public URL of your app (used in email links) |
| `PLATFORM_DOMAIN` | ✅ | Root domain for tenant subdomains |
| `CORS_ORIGINS` | ✅ | Comma-separated allowed origins |
| `SMTP_HOST/USER/PASS` | ✅ | Email delivery |
| `TWILIO_*` | Optional | Voice calls & SMS |
| `STRIPE_*` | Optional | Card payments |
| `JAZZCASH_*` | Optional | Pakistan mobile payments |
| `S3_*` | Optional | File uploads (AWS S3 or MinIO) |

Full reference: `.env.example`
