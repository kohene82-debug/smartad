/**
 * PAYMENT GATEWAY SERVICE
 * Abstraction layer supporting Paystack, Stripe, and Flutterwave.
 * Toggle active gateway via PAYMENT_GATEWAY env variable.
 */

const logger = require('../utils/logger');

const GATEWAY = process.env.PAYMENT_GATEWAY || 'paystack';

// ─── PAYSTACK ─────────────────────────────────────────────────────────────────

const paystackInitialize = async ({ email, amountGHS, reference, advertiserId }) => {
  /* REAL IMPLEMENTATION (uncomment in production):
  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      amount: Math.round(amountGHS * 100), // pesewas
      reference,
      metadata: { advertiser_id: advertiserId },
      callback_url: `${process.env.APP_URL}/advertiser/payment/callback`,
    }),
  });
  const data = await response.json();
  if (!data.status) throw new Error(data.message);
  return { authorizationUrl: data.data.authorization_url, reference: data.data.reference };
  */

  // MOCK
  logger.info('Paystack mock initialize', { email, amountGHS, reference });
  return {
    authorizationUrl: `https://paystack.com/pay/mock-${reference}`,
    reference,
    gateway: 'paystack',
  };
};

const paystackVerify = async (reference) => {
  /* REAL IMPLEMENTATION:
  const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
  });
  const data = await response.json();
  if (!data.status || data.data.status !== 'success') throw new Error('Payment not successful');
  return { amount: data.data.amount / 100, currency: data.data.currency, reference };
  */

  // MOCK
  logger.info('Paystack mock verify', { reference });
  return { status: 'success', amount: 100, currency: 'GHS', reference };
};

// ─── STRIPE ───────────────────────────────────────────────────────────────────

const stripeInitialize = async ({ email, amountUSD, reference, advertiserId }) => {
  /* REAL IMPLEMENTATION:
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    customer_email: email,
    line_items: [{ price_data: { currency: 'usd', product_data: { name: 'Ad Credit' },
      unit_amount: Math.round(amountUSD * 100) }, quantity: 1 }],
    mode: 'payment',
    success_url: `${process.env.APP_URL}/advertiser/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${process.env.APP_URL}/advertiser/payment/cancel`,
    metadata: { advertiser_id: advertiserId, reference },
  });
  return { authorizationUrl: session.url, reference: session.id };
  */

  logger.info('Stripe mock initialize', { email, amountUSD, reference });
  return {
    authorizationUrl: `https://checkout.stripe.com/mock-${reference}`,
    reference,
    gateway: 'stripe',
  };
};

// ─── FLUTTERWAVE ──────────────────────────────────────────────────────────────

const flutterwaveInitialize = async ({ email, amountGHS, reference, name, phone }) => {
  /* REAL IMPLEMENTATION:
  const response = await fetch('https://api.flutterwave.com/v3/payments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tx_ref: reference,
      amount: amountGHS,
      currency: 'GHS',
      redirect_url: `${process.env.APP_URL}/advertiser/payment/callback`,
      customer: { email, name, phone_number: phone },
      customizations: { title: 'Smart Ad+ Credits' },
    }),
  });
  const data = await response.json();
  if (data.status !== 'success') throw new Error(data.message);
  return { authorizationUrl: data.data.link, reference };
  */

  logger.info('Flutterwave mock initialize', { email, amountGHS, reference });
  return {
    authorizationUrl: `https://flutterwave.com/pay/mock-${reference}`,
    reference,
    gateway: 'flutterwave',
  };
};

// ─── MOBILE MONEY PAYOUT ──────────────────────────────────────────────────────

const initiateMobileMoneyPayout = async ({ amount, network, mobileNumber, reference }) => {
  /* REAL IMPLEMENTATION (Paystack):
  const response = await fetch('https://api.paystack.co/transfer', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source: 'balance',
      amount: Math.round(amount * 100),
      recipient: { type: 'mobile_money', currency: 'GHS',
        mobile_money: { phone: mobileNumber, provider: network.toLowerCase() } },
      reason: 'Smart Ad+ withdrawal',
      reference,
    }),
  });
  const data = await response.json();
  if (!data.status) throw new Error(data.message);
  return { transferCode: data.data.transfer_code, reference };
  */

  logger.info('Mobile money payout mock', { amount, network, mobileNumber, reference });
  return {
    status: 'PROCESSING',
    reference,
    transferCode: `MOCK_TRANSFER_${reference}`,
  };
};

// ─── UNIFIED API ──────────────────────────────────────────────────────────────

const initializePayment = async (options) => {
  switch (GATEWAY) {
    case 'stripe':      return stripeInitialize(options);
    case 'flutterwave': return flutterwaveInitialize(options);
    case 'paystack':
    default:            return paystackInitialize(options);
  }
};

const verifyPayment = async (reference) => {
  switch (GATEWAY) {
    case 'paystack':
    default: return paystackVerify(reference);
  }
};

module.exports = {
  initializePayment,
  verifyPayment,
  initiateMobileMoneyPayout,
};
