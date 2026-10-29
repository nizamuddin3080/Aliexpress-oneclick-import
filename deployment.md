# Deployment and Operations Guide — AliExpress to Shopify One-Click Importer

## 1. System Requirements and Prerequisites

### 1.1 Host Environment
- **Node.js:** `v20.x` LTS or later
- **Package Manager:** `npm` (v10+)
- **Operating System:** Linux (Ubuntu 22.04+ recommended for production), macOS, or Windows
- **Browser:** Google Chrome `v120+` (supporting Manifest V3 service workers)

### 1.2 Shopify Configuration
- An active Shopify store (Development store, Basic, Shopify, Advanced, or Plus)
- Admin privileges to configure Custom Apps in **Settings > Apps and sales channels > Develop apps** via the **Dev Dashboard**
- **Admin API Access Scopes:**
  - `write_products` (implicitly includes `read_products`)
- **API Distribution Mode:** Custom distribution (targeted to your specific single store)

---

## 2. Environment Configuration

### 2.1 Backend Secrets (`server/.env`)

```env
# Server Runtime
PORT=3456
NODE_ENV=development
BACKEND_URL=http://localhost:3456

# Shopify Dev Dashboard App Credentials
SHOPIFY_CLIENT_ID=your_shopify_client_id
SHOPIFY_CLIENT_SECRET=your_shopify_client_secret

# Cryptographic Keys (Generate with `openssl rand -hex 32`)
JWT_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
ENCRYPTION_KEY=fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210

# Database Persistence
DATABASE_PATH=./data/importer.db

# Shopify API Version (Verified against Shopify GraphQL Changelog)
SHOPIFY_API_VERSION=2026-01
SHOPIFY_SCOPES=write_products

# Chrome Extension Identity (Pinned for CORS and OAuth redirect)
# Development: Unpacked extension ID from chrome://extensions
# Production: Pinned Web Store Extension ID
EXTENSION_ID=abcdefghijklmnopabcdefghijklmnop
```

### 2.2 Extension Client Configuration (`extension/src/shared/config.ts`)

```typescript
// NOTE: Zero secrets permitted in extension client files.
export const CONFIG = {
  BACKEND_URL: process.env.BACKEND_URL || 'http://localhost:3456',
  API_TIMEOUT_MS: 30000,
  SUPPORTED_CURRENCIES: ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'],
} as const;
```

---

## 3. Chrome Extension Identity & Callback Setup

### 3.1 Understanding the Extension ID Difference
- **Development (Unpacked):** When you load an unpacked directory in `chrome://extensions/`, Chrome generates a 32-character extension ID based on the local file path.
- **Production (Packaged / Web Store):** A published extension has a stable, permanent extension ID derived from the developer key.

### 3.2 Configuration Procedure

#### Development Setup:
1. Run `npm run build` inside `extension/`.
2. Open Chrome at `chrome://extensions/` and enable **Developer mode**.
3. Click **Load unpacked** and select the `extension/dist/` directory.
4. Locate the newly loaded extension and copy its 32-character ID (e.g., `oeknbhffknedjnmld...`).
5. Paste this ID into `server/.env` under `EXTENSION_ID=<your-id>`.
6. Configure the Allowed redirection URL in your Shopify Dev Dashboard app to:
   ```
   http://localhost:3456/auth/shopify/callback
   ```
7. Restart the backend server.

#### Production Setup:
1. Ensure the backend domain has a valid HTTPS certificate (e.g., `https://importer-api.example.com`).
2. Update the Shopify Dev Dashboard Allowed redirection URL to:
   ```
   https://importer-api.example.com/auth/shopify/callback
   ```
3. Set `EXTENSION_ID` in production `.env` to your published Chrome Web Store ID.
4. Set `BACKEND_URL=https://importer-api.example.com` when compiling the extension build:
   ```bash
   cd extension && BACKEND_URL=https://importer-api.example.com npm run build
   ```

---

## 4. Local Development Walkthrough (Step-by-Step)

```bash
# 1. Clone repository
git clone <repo-url>
cd aliexpres-oneclick-import

# 2. Setup server dependencies and secrets
cd server
npm install
cp .env.example .env
# Edit .env and supply your credentials and generated hex keys

# 3. Start development server
npm run dev
# Server initializes SQLite in WAL mode and listens on http://localhost:3456

# 4. Build extension
cd ../extension
npm install
npm run build

# 5. Load unpacked extension in Chrome
# Follow Section 3.2 to load extension/dist and record EXTENSION_ID in server/.env

# 6. Test OAuth connection
# Open popup, enter store domain (e.g., teststore.myshopify.com), approve OAuth
```

---

## 5. Production Deployment Architecture

### 5.1 Docker / VPS Topology

```
[ Chrome Browser Extension ]
            │
            ▼ (HTTPS Only)
   [ Nginx Reverse Proxy ]
     - Let's Encrypt SSL
     - Rate Limiting (10 req/min)
     - Security Headers (HSTS, CSP)
            │
            ▼ (Internal HTTP)
   [ Node.js Express App (PM2) ]
     - Safe Fetch Engine (SSRF Guard)
     - Reservation State Machine
            │
            ▼
   [ Persistent Volume (/data) ]
     - importer.db (SQLite in WAL mode)
```

### 5.2 Nginx Hardened Configuration

```nginx
server {
    listen 443 ssl http2;
    server_name importer-api.example.com;

    ssl_certificate /etc/letsencrypt/live/importer-api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/importer-api.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    # Enforce Request Size Limit
    client_max_body_size 1M;

    # CORS Enforcement for Chrome Extension Origin
    set $cors_origin "";
    if ($http_origin ~* "^chrome-extension://[a-p]{32}$") {
        set $cors_origin $http_origin;
    }

    location / {
        if ($cors_origin != "") {
            add_header 'Access-Control-Allow-Origin' $cors_origin always;
            add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
            add_header 'Access-Control-Allow-Headers' 'Authorization, Content-Type' always;
        }

        if ($request_method = 'OPTIONS') {
            return 204;
        }

        proxy_pass http://127.0.0.1:3456;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_connect_timeout 10s;
        proxy_read_timeout 45s;
    }
}
```

---

## 6. Database Operations & Disaster Recovery

### 6.1 Persistent Volume Guarantee
- In production (Docker, Kubernetes, Railway, Fly.io), the SQLite database path `DATABASE_PATH=/data/importer.db` **must** mount to a persistent storage volume.
- Ephemeral containers will lose stored OAuth tokens and import reservation history on restart.

### 6.2 Hot Backup Procedure
SQLite supports safe online backups without stopping the server using SQLite's online backup API:

```bash
# Automated cron backup script (runs daily)
sqlite3 /data/importer.db ".backup /backups/importer-$(date +%Y%m%d_%H%M%S).db"
```

### 6.3 Restore & Verification Procedure
```bash
# 1. Stop backend service
pm2 stop importer-api

# 2. Restore file
cp /backups/importer-20261029_120000.db /data/importer.db
chmod 600 /data/importer.db

# 3. Verify SQLite integrity
sqlite3 /data/importer.db "PRAGMA integrity_check;"
# Must output: ok

# 4. Restart service
pm2 start importer-api
```

### 6.4 Store Disconnect & Secure Token Wipe
When a merchant disconnects a store via the extension:
1. Backend issues a `BEGIN IMMEDIATE` transaction.
2. The encrypted token, initialization vector, and auth tag fields in `stores` are overwritten with zeroes (`0x00`) before row deletion or marking `is_active = 0`.
3. The JWT for that session is immediately invalidated.

---

## 7. Production Readiness Checklist

| # | Check Item | Verification Method | Passed |
|---|------------|---------------------|--------|
| 1 | Production backend enforces valid HTTPS certificate | `curl -Iv https://importer-api.example.com` | [ ] |
| 2 | `NODE_ENV=production` set | Inspect environment | [ ] |
| 3 | Extension client compiled with production `BACKEND_URL` | Inspect `extension/dist/config.js` | [ ] |
| 4 | No plaintext passwords, keys, or tokens in git | `git log -S "shpat_" -p` | [ ] |
| 5 | SQLite database resides on persistent mounted volume | Verify Docker mount volume | [ ] |
| 6 | Database file permissions restricted to app process (`600`) | `ls -la /data/importer.db` | [ ] |
| 7 | Production `EXTENSION_ID` matches published Chrome ID | Cross-check Chrome Web Store dashboard | [ ] |
| 8 | Shopify Dev Dashboard redirect URL matches production | Dev Dashboard App Settings | [ ] |
| 9 | Request body size capped at 1 MB | Test 2 MB upload → 413 | [ ] |
| 10 | Daily SQLite backup cron active and verified | Run `PRAGMA integrity_check` on backup | [ ] |
