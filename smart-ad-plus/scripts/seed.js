require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const seed = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('🌱 Seeding Smart Ad+ database...\n');

    // ── Admin ──────────────────────────────────────────────────────────────
    const adminEmail    = process.env.ADMIN_EMAIL    || 'admin@smartadplus.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123456';
    const adminHash     = await bcrypt.hash(adminPassword, 12);

    const { rows: [admin] } = await client.query(
      `INSERT INTO admins (email, password_hash, name)
       VALUES ($1, $2, 'Platform Admin')
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id, email`,
      [adminEmail, adminHash]
    );
    console.log(`✅ Admin:       ${admin.email}  (password: ${adminPassword})`);

    // ── Advertiser ─────────────────────────────────────────────────────────
    const advHash = await bcrypt.hash('Advertiser@123', 12);
    const { rows: [advertiser] } = await client.query(
      `INSERT INTO advertisers (email, password_hash, company_name, contact_name, balance, is_verified)
       VALUES ($1, $2, 'Acme Corp', 'John Doe', 500.000000, TRUE)
       ON CONFLICT (email) DO UPDATE SET balance = 500.000000
       RETURNING id, email, balance`,
      ['advertiser@acme.com', advHash]
    );
    console.log(`✅ Advertiser:  ${advertiser.email}  (password: Advertiser@123)  balance: $${advertiser.balance}`);

    // Ledger entry for initial advertiser balance (deposit)
    const depositId = uuidv4();
    await client.query(
      `INSERT INTO payments (id, advertiser_id, amount, currency, gateway, gateway_ref, status)
       VALUES ($1,$2,500,'GHS','seed','SEED_DEPOSIT','SUCCESS')`,
      [depositId, advertiser.id]
    );
    await client.query(
      `INSERT INTO ledger
         (user_id, advertiser_id, type, amount, balance_before, balance_after,
          reference_id, reference_type, description)
       VALUES (NULL,$1,'DEPOSIT',500,0,500,$2,'payment','Seed initial balance')`,
      [advertiser.id, depositId]
    );

    // ── Approved Ad ────────────────────────────────────────────────────────
    const { rows: [ad] } = await client.query(
      `INSERT INTO ads
         (advertiser_id, title, description, media_url, click_url, ad_type,
          status, cpm, total_budget, target_countries, frequency_cap, frequency_cap_hours,
          approved_at, approved_by)
       VALUES ($1,
         'Acme Summer Sale',
         'Get 50% off all products this summer!',
         'https://via.placeholder.com/800x450.png?text=Acme+Summer+Sale',
         'https://acme.com/sale',
         'IMAGE', 'APPROVED', 2.50, 500, '{GH}', 3, 24, NOW(), $2)
       RETURNING id, title, cpm, status`,
      [advertiser.id, admin.id]
    );
    console.log(`✅ Ad:          "${ad.title}"  CPM: $${ad.cpm}  Status: ${ad.status}`);

    // ── Test User ──────────────────────────────────────────────────────────
    const { rows: [user] } = await client.query(
      `INSERT INTO users (phone, device_id, consent_given, consent_at, balance)
       VALUES ('+233201234567', 'test-device-001', TRUE, NOW(), 0)
       ON CONFLICT (phone) DO UPDATE SET device_id = 'test-device-001'
       RETURNING id, phone`,
    );
    console.log(`✅ Test User:   ${user.phone}  (use OTP flow to login)`);

    await client.query('COMMIT');

    console.log('\n─────────────────────────────────────────────────────────');
    console.log('🎉 Seed complete!\n');
    console.log('Quick start:');
    console.log(`  POST /auth/send-otp     { "phone": "${user.phone}" }`);
    console.log(`  POST /auth/verify-otp   { "phone": "${user.phone}", "code": "<otp>", "deviceId": "test-device-001", "consentGiven": true }`);
    console.log(`  POST /ads/getAd         { "userId": "${user.id}", "deviceId": "test-device-001", "eventType": "CALL_ENDED" }`);
    console.log('─────────────────────────────────────────────────────────\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
};

seed();
