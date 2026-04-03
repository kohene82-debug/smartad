-- Smart Ad+ Initial Schema Migration
-- Run: psql $DATABASE_URL -f migrations/001_initial_schema.sql

BEGIN;

-- ─── ENUMS ────────────────────────────────────────────────────────────────────

CREATE TYPE ledger_type AS ENUM (
  'AD_SPEND',
  'USER_REWARD',
  'PLATFORM_REVENUE',
  'WITHDRAWAL',
  'DEPOSIT'
);

CREATE TYPE ad_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'EXHAUSTED');
CREATE TYPE ad_type   AS ENUM ('IMAGE', 'VIDEO');
CREATE TYPE event_type AS ENUM ('CALL_ENDED', 'SMS_RECEIVED', 'APP_OPEN');
CREATE TYPE withdrawal_status AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE payment_status AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- ─── USERS ────────────────────────────────────────────────────────────────────

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         VARCHAR(20) UNIQUE NOT NULL,
  device_id     VARCHAR(255),
  consent_given BOOLEAN NOT NULL DEFAULT FALSE,
  consent_at    TIMESTAMPTZ,
  balance       NUMERIC(18, 6) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  total_earned  NUMERIC(18, 6) NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  is_flagged    BOOLEAN NOT NULL DEFAULT FALSE,
  flag_reason   TEXT,
  country       VARCHAR(10) DEFAULT 'GH',
  coarse_lat    NUMERIC(9, 4),
  coarse_lng    NUMERIC(9, 4),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── OTP CODES ────────────────────────────────────────────────────────────────

CREATE TABLE otp_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      VARCHAR(20) NOT NULL,
  code_hash  VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN NOT NULL DEFAULT FALSE,
  attempts   INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── ADVERTISERS ──────────────────────────────────────────────────────────────

CREATE TABLE advertisers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          VARCHAR(255) UNIQUE NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  company_name   VARCHAR(255) NOT NULL,
  contact_name   VARCHAR(255),
  phone          VARCHAR(20),
  balance        NUMERIC(18, 6) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  total_spent    NUMERIC(18, 6) NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  is_verified    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── ADS ──────────────────────────────────────────────────────────────────────

CREATE TABLE ads (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advertiser_id       UUID NOT NULL REFERENCES advertisers(id) ON DELETE CASCADE,
  title               VARCHAR(255) NOT NULL,
  description         TEXT,
  media_url           TEXT NOT NULL,
  click_url           TEXT,
  ad_type             ad_type NOT NULL DEFAULT 'IMAGE',
  status              ad_status NOT NULL DEFAULT 'PENDING',
  cpm                 NUMERIC(10, 4) NOT NULL CHECK (cpm > 0),
  daily_budget        NUMERIC(18, 6),
  total_budget        NUMERIC(18, 6) NOT NULL,
  spent_today         NUMERIC(18, 6) NOT NULL DEFAULT 0,
  total_spent         NUMERIC(18, 6) NOT NULL DEFAULT 0,
  target_countries    TEXT[] DEFAULT ARRAY['GH'],
  target_lat          NUMERIC(9, 4),
  target_lng          NUMERIC(9, 4),
  target_radius_km    NUMERIC(8, 2),
  frequency_cap       INT NOT NULL DEFAULT 3,
  frequency_cap_hours INT NOT NULL DEFAULT 24,
  impressions_count   BIGINT NOT NULL DEFAULT 0,
  clicks_count        BIGINT NOT NULL DEFAULT 0,
  approved_at         TIMESTAMPTZ,
  approved_by         UUID,
  rejected_reason     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── IMPRESSIONS ──────────────────────────────────────────────────────────────

CREATE TABLE impressions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_id         UUID NOT NULL REFERENCES ads(id),
  user_id       UUID NOT NULL REFERENCES users(id),
  advertiser_id UUID NOT NULL REFERENCES advertisers(id),
  device_id     VARCHAR(255),
  event_type    event_type NOT NULL DEFAULT 'CALL_ENDED',
  cpm_charged   NUMERIC(10, 4) NOT NULL,
  user_reward   NUMERIC(18, 6) NOT NULL,
  platform_fee  NUMERIC(18, 6) NOT NULL,
  lat           NUMERIC(9, 4),
  lng           NUMERIC(9, 4),
  rewarded      BOOLEAN NOT NULL DEFAULT FALSE,
  flagged       BOOLEAN NOT NULL DEFAULT FALSE,
  flag_reason   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── CLICKS ───────────────────────────────────────────────────────────────────

CREATE TABLE clicks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  impression_id UUID NOT NULL REFERENCES impressions(id),
  ad_id         UUID NOT NULL REFERENCES ads(id),
  user_id       UUID NOT NULL REFERENCES users(id),
  device_id     VARCHAR(255),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── LEDGER (CRITICAL - IMMUTABLE) ───────────────────────────────────────────

CREATE TABLE ledger (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES users(id),
  advertiser_id  UUID REFERENCES advertisers(id),
  type           ledger_type NOT NULL,
  amount         NUMERIC(18, 6) NOT NULL,
  balance_before NUMERIC(18, 6) NOT NULL,
  balance_after  NUMERIC(18, 6) NOT NULL,
  reference_id   UUID,
  reference_type VARCHAR(50),
  description    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ledger_entity_check CHECK (
    (user_id IS NOT NULL AND advertiser_id IS NULL) OR
    (advertiser_id IS NOT NULL AND user_id IS NULL)
  )
);

-- ─── TRANSACTIONS ─────────────────────────────────────────────────────────────

CREATE TABLE transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advertiser_id   UUID REFERENCES advertisers(id),
  user_id         UUID REFERENCES users(id),
  impression_id   UUID REFERENCES impressions(id),
  advertiser_debit  NUMERIC(18, 6),
  user_credit       NUMERIC(18, 6),
  platform_credit   NUMERIC(18, 6),
  status          VARCHAR(20) NOT NULL DEFAULT 'COMPLETED',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── WITHDRAWALS ──────────────────────────────────────────────────────────────

CREATE TABLE withdrawals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  amount          NUMERIC(18, 6) NOT NULL CHECK (amount > 0),
  network         VARCHAR(20) NOT NULL,
  mobile_number   VARCHAR(20) NOT NULL,
  status          withdrawal_status NOT NULL DEFAULT 'PENDING',
  gateway_ref     VARCHAR(255),
  gateway_response JSONB,
  processed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── PAYMENTS ─────────────────────────────────────────────────────────────────

CREATE TABLE payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advertiser_id   UUID NOT NULL REFERENCES advertisers(id),
  amount          NUMERIC(18, 6) NOT NULL CHECK (amount > 0),
  currency        VARCHAR(10) NOT NULL DEFAULT 'GHS',
  gateway         VARCHAR(20) NOT NULL,
  gateway_ref     VARCHAR(255),
  gateway_response JSONB,
  status          payment_status NOT NULL DEFAULT 'PENDING',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── PLATFORM REVENUE ─────────────────────────────────────────────────────────

CREATE TABLE platform_revenue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  impression_id UUID REFERENCES impressions(id),
  amount        NUMERIC(18, 6) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── INDEXES ──────────────────────────────────────────────────────────────────

CREATE INDEX idx_users_phone          ON users(phone);
CREATE INDEX idx_users_device_id      ON users(device_id);
CREATE INDEX idx_users_is_active      ON users(is_active);
CREATE INDEX idx_users_is_flagged     ON users(is_flagged);

CREATE INDEX idx_otp_phone            ON otp_codes(phone);
CREATE INDEX idx_otp_expires_at       ON otp_codes(expires_at);

CREATE INDEX idx_ads_advertiser_id    ON ads(advertiser_id);
CREATE INDEX idx_ads_status           ON ads(status);
CREATE INDEX idx_ads_cpm              ON ads(cpm DESC);
CREATE INDEX idx_ads_target_countries ON ads USING GIN(target_countries);

CREATE INDEX idx_impressions_user_id      ON impressions(user_id);
CREATE INDEX idx_impressions_ad_id        ON impressions(ad_id);
CREATE INDEX idx_impressions_advertiser_id ON impressions(advertiser_id);
CREATE INDEX idx_impressions_created_at   ON impressions(created_at DESC);
CREATE INDEX idx_impressions_device_id    ON impressions(device_id);
CREATE INDEX idx_impressions_user_ad      ON impressions(user_id, ad_id, created_at DESC);

CREATE INDEX idx_clicks_ad_id         ON clicks(ad_id);
CREATE INDEX idx_clicks_user_id       ON clicks(user_id);
CREATE INDEX idx_clicks_impression_id ON clicks(impression_id);

CREATE INDEX idx_ledger_user_id       ON ledger(user_id);
CREATE INDEX idx_ledger_advertiser_id ON ledger(advertiser_id);
CREATE INDEX idx_ledger_type          ON ledger(type);
CREATE INDEX idx_ledger_created_at    ON ledger(created_at DESC);
CREATE INDEX idx_ledger_reference_id  ON ledger(reference_id);

CREATE INDEX idx_withdrawals_user_id  ON withdrawals(user_id);
CREATE INDEX idx_withdrawals_status   ON withdrawals(status);

CREATE INDEX idx_payments_advertiser_id ON payments(advertiser_id);
CREATE INDEX idx_payments_status        ON payments(status);

CREATE INDEX idx_transactions_impression_id ON transactions(impression_id);

-- ─── TRIGGERS: updated_at ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at     BEFORE UPDATE ON users     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER advertisers_updated_at BEFORE UPDATE ON advertisers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER ads_updated_at       BEFORE UPDATE ON ads       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER payments_updated_at  BEFORE UPDATE ON payments  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── TRIGGER: Protect ledger from updates/deletes ────────────────────────────

CREATE OR REPLACE FUNCTION protect_ledger()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Ledger entries are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger FOR EACH ROW EXECUTE FUNCTION protect_ledger();
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger FOR EACH ROW EXECUTE FUNCTION protect_ledger();

-- ─── TRIGGER: Protect impressions from updates ───────────────────────────────

CREATE OR REPLACE FUNCTION protect_impressions_rewarded()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.rewarded = TRUE AND NEW.rewarded = FALSE THEN
    RAISE EXCEPTION 'Cannot un-reward an impression';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER impressions_protect_rewarded
  BEFORE UPDATE ON impressions
  FOR EACH ROW EXECUTE FUNCTION protect_impressions_rewarded();

-- ─── ADMIN USER TABLE ────────────────────────────────────────────────────────

CREATE TABLE admins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(255),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
