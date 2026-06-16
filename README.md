# CRM Platform — Multi-Tenant SaaS

A production-grade, HubSpot-style CRM built as a cloud-native SaaS platform with:
- Multi-tenant isolation via PostgreSQL Row-Level Security
- Voice bot connectivity (Twilio, Vonage, Plivo, custom)
- Modular plugin architecture
- REST + GraphQL API with API key support
- Outbound webhook system
- Cloud or on-prem deployment

---

## Quick Start (Node.js — no Docker needed)

### 1. Install Node.js 20+
Download from https://nodejs.org (choose the macOS LTS installer)

### 2. Install and start PostgreSQL + Redis
```bash
# Using Homebrew (install from https://brew.sh if needed):
brew install postgresql@16 redis
brew services start postgresql@16
brew services start redis

# Create the database:
psql postgres -c "CREATE USER crm WITH PASSWORD 'crm_dev_password';"
psql postgres -c "CREATE DATABASE crm_platform OWNER crm;"
```

### 3. Install dependencies, migrate, seed, and run
```bash
cd /Users/mba/crm-platform
npm install
npm run db:migrate        # creates all tables
npm run db:seed           # creates demo workspace + sample data
npm run dev               # starts API (port 3000) + Frontend (port 5173)
```

### 4. Log in
Open http://localhost:5173 and enter:
- **Workspace**: `demo`
- **Email**: `admin@demo.com`
- **Password**: `Demo1234!`

### API docs: http://localhost:3000/docs

---

## Quick Start (Docker — no Node.js needed)

Install Docker Desktop from https://www.docker.com/products/docker-desktop/ then:
```bash
cd /Users/mba/crm-platform
npm run docker:dev
```

---

## Architecture

```
crm-platform/
├── packages/
│   ├── shared/          # Types, contracts shared across all packages
│   ├── core/            # Database client, EventBus, ModuleRegistry, TenantService
│   ├── api/             # Fastify REST + GraphQL API server
│   └── frontend/        # React + Tailwind dashboard
├── modules/
│   ├── contacts/        # Contacts CRUD, lead scoring
│   ├── companies/       # Company management
│   ├── deals/           # Pipeline + Kanban board
│   ├── activities/      # Tasks, calls, emails, notes
│   ├── voice/           # Voice bot bridge (provider-agnostic)
│   ├── analytics/       # Dashboard, revenue, funnel, leaderboard
│   └── connectors/      # Twilio, Vonage, Slack, Zapier, Webhooks
└── infra/
    ├── docker/          # docker-compose.dev.yml + docker-compose.prod.yml
    ├── k8s/             # Kubernetes manifests
    └── nginx/           # Reverse proxy + wildcard subdomain routing
```

---

## Multi-Tenancy

**How it works:**

1. Every tenant gets a subdomain: `acme.yourcrm.com`
2. Custom domain support: `crm.acme.com` → looked up in DB
3. **Every table** has a `tenant_id` column with PostgreSQL **Row-Level Security**
4. The API sets `app.tenant_id` as a session variable at the start of every DB transaction
5. RLS policies automatically filter all queries — a bug in app code **cannot** leak data across tenants
6. Usage metrics tracked per tenant per month for billing

**Tenant lifecycle:**
```
Self-signup → Trial (14 days) → Paid plan → [Suspended | Cancelled]
```

**Plans:**

| Plan         | Seats | Contacts | Voice Min/Mo | API Calls/Mo |
|-------------|-------|----------|-------------|-------------|
| Free        | 2     | 500      | 0           | 1,000       |
| Starter     | 5     | 5,000    | 100         | 10,000      |
| Professional| 25    | 50,000   | 1,000       | 100,000     |
| Enterprise  | ∞     | ∞        | ∞           | ∞           |

---

## Voice Bot Integration

The voice system is **provider-agnostic** via the `VoiceProviderAdapter` interface:

```ts
interface VoiceProviderAdapter {
  initiateCall(options): Promise<ProviderCallResult>
  normalizeWebhook(provider, body, headers): VoiceWebhookEvent
  webhookAck(eventType): unknown
}
```

**Inbound webhook flow:**
```
Twilio/Vonage/Custom → POST /api/v1/voice/webhook/:provider
  → Signature verification
  → Normalize to VoiceWebhookEvent
  → Process: match contact, log call, track usage
  → Publish to EventBus → subscribers react (create deal, notify agent)
  → Return provider-specific ACK (TwiML / NCCO)
```

**Live streaming:** WebSocket at `/api/v1/voice/calls/:id/stream` streams real-time transcript and intent detection to the frontend.

**Auto-actions from bot intents:**
- `intent.detected: schedule_demo` → creates a deal + activity
- `intent.detected: request_quote` → triggers CRM workflow
- `transfer.requested` → routes to human agent + notifies via Slack

---

## Adding a New Module

1. Create `modules/your-module/src/index.ts` implementing `CRMModule`:

```ts
export class YourModule implements CRMModule {
  name = 'your-module';
  version = '1.0.0';
  requiredPlan = 'starter';

  async onLoad(ctx: ModuleContext) {
    // Register event listeners, set up background workers
    ctx.eventBus.on('deal.won', async (event) => { /* ... */ });
  }

  async registerRoutes(fastify, prefix) {
    fastify.get('/your-endpoint', async (req) => { /* ... */ });
  }
}
```

2. Register in `packages/api/src/server.ts`:

```ts
moduleRegistry.register(new YourModule());
```

That's it. The module registry handles load order, dependency resolution, and graceful shutdown.

---

## API Authentication

**JWT (human users):**
```
Authorization: Bearer <token>
```

**API Keys (programmatic access):**
```
Authorization: ApiKey crm_live_xxxxxxxxxxxxxxxx
X-Tenant-ID: <tenant-uuid>
```

API keys have scoped permissions: `contacts:read`, `deals:write`, `voice:read`, etc.

**Multi-tenant API calls:**
Tenant is resolved from (in priority order):
1. `X-Tenant-ID` header
2. Subdomain (`acme.yourcrm.com`)
3. Custom domain (`crm.acme.com`)
4. JWT claim

---

## Webhook System

Every tenant can subscribe to CRM events and receive them at their endpoint:

```http
POST /api/v1/webhooks
{
  "name": "My Zapier Hook",
  "url": "https://hooks.zapier.com/...",
  "events": ["deal.won", "contact.created", "voice.call_completed"]
}
```

Webhooks are signed with HMAC-SHA256. Verify with:
```ts
const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
```

---

## Deployment

**Cloud (any provider — AWS, GCP, Azure, DigitalOcean):**
```bash
# Set environment variables in .env
npm run docker:prod
```

**On-premises:**
```bash
# Same command — works on any Linux server with Docker
docker-compose -f infra/docker/docker-compose.prod.yml up -d
```

**Kubernetes:**
```bash
kubectl apply -f infra/k8s/
```

**Environment variables:**
```env
DATABASE_URL=postgresql://user:pass@host:5432/crm_platform
REDIS_URL=redis://:password@host:6379
JWT_SECRET=your-256-bit-secret
PLATFORM_DOMAIN=yourcrm.com
API_BASE_URL=https://api.yourcrm.com
CORS_ORIGINS=https://yourcrm.com,https://*.yourcrm.com
```

---

## Super Admin Portal

Manage all tenants at `/super-admin/*` (requires `super_admin` role):

- `GET /super-admin/tenants` — list all tenants with usage stats
- `POST /super-admin/tenants` — provision new tenant
- `PATCH /super-admin/tenants/:id/plan` — upgrade/downgrade plan
- `POST /super-admin/tenants/:id/suspend` — suspend tenant
- `GET /super-admin/metrics` — platform-wide MRR, churn, plan distribution
