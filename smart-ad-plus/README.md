# Smart Ad+ Backend — API Documentation & Deployment Guide

## Table of Contents
1. [Quick Start](#quick-start)
2. [API Reference](#api-reference)
3. [WebSocket Events](#websocket-events)
4. [Deployment: Render](#deployment-render)
5. [Deployment: Railway](#deployment-railway)
6. [Test Flow (curl)](#test-flow-curl)
7. [Financial System](#financial-system)
8. [Google Play Compliance](#google-play-compliance)

---

## Quick Start

```bash
git clone <repo>
cd smart-ad-plus

# 1. Install dependencies
npm install

# 2. Copy and configure environment
cp .env.example .env
# Edit .env with your DATABASE_URL, JWT_SECRET, etc.

# 3. Run migrations
npm run migrate

# 4. Seed test data
npm run seed

# 5. Start server
npm start
# → http://localhost:3000
# → ws://localhost:3000/ws
```

---

## API Reference

All responses follow this envelope:
```json
{ "success": true|false, "message": "...", "data": { ... } }
```

---

### AUTH

#### POST /auth/send-otp
Send OTP to phone number.

**Request:**
```json
{ "phone": "+233201234567" }
```
**Response (mock mode):**
```json
{ "data": { "phone": "+233201234567", "dev_otp": "123456" } }
```

---

#### POST /auth/verify-otp
Verify OTP and receive JWT.

**Request:**
```json
{
  "phone": "+233201234567",
  "code": "123456",
  "deviceId": "android-unique-device-id",
  "consentGiven": true
}
```
**Response:**
```json
{
  "data": {
    "token": "eyJhbGciOiJIUzI1NiJ9...",
    "user": { "id": "uuid", "phone": "+233...", "consentGiven": true, "balance": 0 }
  }
}
```

---

### ADS

All ad endpoints require `Authorization: Bearer <user_jwt>`.

#### POST /ads/getAd
Fetch an ad after a phone call ends.

**Request:**
```json
{
  "userId": "uuid",
  "deviceId": "android-device-id",
  "eventType": "CALL_ENDED",
  "lat": 5.6037,
  "lng": -0.1870,
  "country": "GH"
}
```
**Response:**
```json
{
  "data": {
    "ad": {
      "id": "uuid",
      "title": "Acme Summer Sale",
      "mediaUrl": "https://...",
      "clickUrl": "https://...",
      "adType": "IMAGE",
      "cpm": 2.50
    }
  }
}
```

---

#### POST /ads/impression
Track that a user viewed an ad and trigger reward.

**Request:**
```json
{
  "adId": "uuid",
  "userId": "uuid",
  "deviceId": "android-device-id",
  "eventType": "CALL_ENDED",
  "lat": 5.6037,
  "lng": -0.1870
}
```
**Response:**
```json
{
  "data": {
    "impressionId": "uuid",
    "reward": 0.0015,
    "balance": 0.0015
  }
}
```

---

#### POST /ads/click
Track a click on an ad.

**Request:**
```json
{
  "impressionId": "uuid",
  "adId": "uuid",
  "userId": "uuid",
  "deviceId": "android-device-id"
}
```

---

### USERS

All user endpoints require `Authorization: Bearer <user_jwt>`.

#### GET /users/rewards
Get user balance, earnings history, and stats.

**Response:**
```json
{
  "data": {
    "user": { "id": "uuid", "phone": "+233...", "balance": 1.50, "totalEarned": 5.00 },
    "stats": { "totalImpressions": 100, "todayImpressions": 5 },
    "ledger": [ { "type": "USER_REWARD", "amount": 0.0015, "balance_after": 1.50, ... } ]
  }
}
```

---

#### POST /users/withdraw
Withdraw earnings via mobile money.

**Request:**
```json
{
  "amount": 10.00,
  "network": "MTN",
  "mobileNumber": "+233201234567"
}
```
**Response:**
```json
{
  "data": {
    "withdrawalId": "uuid",
    "amount": 10.00,
    "status": "PROCESSING",
    "newBalance": 0.00
  }
}
```

---

#### DELETE /users/delete-data
GDPR: anonymize all personal data.

---

### ADVERTISERS

#### POST /advertiser/register
```json
{
  "email": "brand@company.com",
  "password": "SecurePass123",
  "companyName": "My Brand",
  "contactName": "Jane Smith",
  "phone": "+233201234567"
}
```

#### POST /advertiser/login
```json
{ "email": "brand@company.com", "password": "SecurePass123" }
```

#### POST /advertiser/createAd
Requires `Authorization: Bearer <advertiser_jwt>`.
```json
{
  "title": "My Ad Campaign",
  "mediaUrl": "https://cdn.example.com/ad.jpg",
  "clickUrl": "https://example.com/landing",
  "adType": "IMAGE",
  "cpm": 2.00,
  "totalBudget": 100.00,
  "dailyBudget": 10.00,
  "targetCountries": ["GH"],
  "frequencyCap": 3,
  "frequencyCapHours": 24
}
```

#### GET /advertiser/ads
Returns all ads for the authenticated advertiser.

#### POST /advertiser/fundAccount
Initialize a payment to fund advertiser wallet.
```json
{ "amount": 100.00, "currency": "GHS" }
```
Returns `authorizationUrl` to redirect user for payment.

#### POST /advertiser/payment/init
Verify a completed payment and credit wallet.
```json
{ "reference": "SAP_XXXX_XXXX" }
```

---

### ADMIN

#### POST /admin/login
```json
{ "email": "admin@smartadplus.com", "password": "Admin@123456" }
```

#### GET /admin/dashboard
Platform overview: users, ads, impressions, revenue.

#### GET /admin/ledger
Full financial ledger. Query params: `?page=1&limit=50`

#### GET /admin/platform-earnings
Daily revenue breakdown.

#### PATCH /admin/ads/:id/approve
```json
{ "status": "APPROVED" }
// or
{ "status": "REJECTED", "rejectedReason": "Violates policy" }
```

#### GET /admin/users
List all users. Query params: `?page=1&limit=50`

#### PATCH /admin/users/:id/flag
```json
{ "flagged": true, "reason": "Suspicious impression pattern" }
```

---

## WebSocket Events

Connect: `ws://host/ws?token=<user_jwt>`

**Server → Client events:**

```json
// On connect
{ "type": "CONNECTED", "userId": "uuid", "timestamp": "..." }

// After impression rewarded
{ "type": "BALANCE_UPDATE", "balance": 1.5015, "earned": 0.0015, "impressionId": "uuid" }

// After withdrawal
{ "type": "BALANCE_UPDATE", "balance": 0.00, "event": "WITHDRAWAL", "amount": 10.00 }
```

**Client → Server:**
```json
{ "type": "PING" }
// Server responds:
{ "type": "PONG", "timestamp": "..." }
```

---

## Financial System

Every impression triggers a 3-step atomic PostgreSQL transaction:

```
Advertiser balance  -$0.0025  (CPM $2.50 / 1000)
  └─ User reward    +$0.0015  (60% share)
  └─ Platform fee   +$0.0010  (40% share)
```

Configure split in `.env`:
```
USER_REVENUE_SHARE=0.60
PLATFORM_REVENUE_SHARE=0.40
```

The ledger table is **immutable** — database triggers prevent UPDATE/DELETE on ledger rows.

---

## Deployment: Render

### 1. Create a PostgreSQL database
- Render Dashboard → New → PostgreSQL
- Copy the **External Database URL**

### 2. Create a Redis instance
- Render Dashboard → New → Redis
- Copy the **Redis URL**

### 3. Deploy the Web Service
- Render Dashboard → New → Web Service
- Connect your GitHub repo
- **Build Command:** `npm install`
- **Start Command:** `npm run migrate && npm start`
- **Instance Type:** Starter (or higher for production)

### 4. Environment Variables (set in Render dashboard)
```
DATABASE_URL=postgresql://...
JWT_SECRET=<generate: openssl rand -base64 64>
ADVERTISER_JWT_SECRET=<another random string>
ADMIN_JWT_SECRET=<another random string>
REDIS_URL=redis://...
NODE_ENV=production
PORT=3000
OTP_MOCK_MODE=false
TWILIO_ACCOUNT_SID=ACxxxx
TWILIO_AUTH_TOKEN=xxxx
TWILIO_PHONE_NUMBER=+1xxx
PAYMENT_GATEWAY=paystack
PAYSTACK_SECRET_KEY=sk_live_xxx
USER_REVENUE_SHARE=0.60
PLATFORM_REVENUE_SHARE=0.40
ALLOWED_ORIGINS=https://yourdomain.com
```

### 5. Seed data (one-time)
In Render Shell:
```bash
npm run seed
```

---

## Deployment: Railway

### 1. Create project
```bash
npm install -g @railway/cli
railway login
railway init
```

### 2. Add services
```bash
# PostgreSQL
railway add --service postgresql

# Redis
railway add --service redis
```

### 3. Set environment variables
```bash
railway variables set JWT_SECRET="$(openssl rand -base64 64)"
railway variables set NODE_ENV=production
railway variables set OTP_MOCK_MODE=false
# ... (set all other vars from .env.example)
```

### 4. Deploy
```bash
railway up
```

Railway auto-sets `DATABASE_URL` and `REDIS_URL` from linked services.

### 5. Run migrations
```bash
railway run npm run migrate
railway run npm run seed
```

---

## Test Flow (curl)

### Step 1 — Request OTP
```bash
curl -X POST http://localhost:3000/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phone":"+233201234567"}'
```

### Step 2 — Verify OTP (use dev_otp from response)
```bash
curl -X POST http://localhost:3000/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{
    "phone":"+233201234567",
    "code":"<dev_otp>",
    "deviceId":"test-device-001",
    "consentGiven":true
  }'
# → save the token as USER_TOKEN
```

### Step 3 — Get an Ad
```bash
curl -X POST http://localhost:3000/ads/getAd \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId":"<userId from step 2>",
    "deviceId":"test-device-001",
    "eventType":"CALL_ENDED",
    "lat":5.6037,
    "lng":-0.1870
  }'
# → save adId
```

### Step 4 — Track Impression (triggers reward)
```bash
curl -X POST http://localhost:3000/ads/impression \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "adId":"<adId>",
    "userId":"<userId>",
    "deviceId":"test-device-001",
    "eventType":"CALL_ENDED"
  }'
# → reward amount and new balance returned
```

### Step 5 — Verify Ledger
```bash
# Admin login first
curl -X POST http://localhost:3000/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@smartadplus.com","password":"Admin@123456"}'
# → save ADMIN_TOKEN

curl http://localhost:3000/admin/ledger \
  -H "Authorization: Bearer $ADMIN_TOKEN"
# → See AD_SPEND, USER_REWARD, PLATFORM_REVENUE entries
```

### Step 6 — Check User Balance
```bash
curl http://localhost:3000/users/rewards \
  -H "Authorization: Bearer $USER_TOKEN"
```

### Step 7 — Withdraw
```bash
curl -X POST http://localhost:3000/users/withdraw \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 5.00,
    "network": "MTN",
    "mobileNumber": "+233201234567"
  }'
```

---

## Google Play Compliance

- ✅ Ads triggered ONLY on `CALL_ENDED` event — no call content accessed
- ✅ Explicit `consentGiven` flag stored with timestamp
- ✅ No contacts, recordings, or call content used
- ✅ Only `deviceId` and coarse location (±0.1°) stored
- ✅ `DELETE /users/delete-data` anonymizes all PII (GDPR)
- ✅ Transparent audit trail via immutable ledger
- ✅ Optional triggers: SMS activity, messaging apps (user-controlled)
