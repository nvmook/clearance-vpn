import db from "./db.js";

// A successful_payment can be delivered more than once (Telegram re-sends an update that was
// not acknowledged), so every charge is keyed by telegram_payment_charge_id and is granted
// exactly once: the payment is recorded first, then claimed by one worker, then granted.

const CLAIM_TIMEOUT_MS = 2 * 60 * 1000;

export async function recordPayment({
  userId,
  chargeId,
  providerChargeId = null,
  amount,
  currency,
  payload = null,
  plan,
  days
}) {
  await db.execute({
    sql: `
      INSERT OR IGNORE INTO payments (
        user_id,
        telegram_charge_id,
        provider_charge_id,
        amount,
        currency,
        payload,
        plan,
        days,
        status,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?)
    `,
    args: [
      userId,
      chargeId,
      providerChargeId,
      amount,
      currency,
      payload,
      plan,
      days,
      new Date().toISOString()
    ]
  });
}

export async function getPayment(chargeId) {
  const result = await db.execute({
    sql: `
      SELECT *
      FROM payments
      WHERE telegram_charge_id = ?
      LIMIT 1
    `,
    args: [chargeId]
  });

  return result.rows[0] ?? null;
}

// true for exactly one caller. A claim left behind by a crashed worker
// (status "granting" for longer than CLAIM_TIMEOUT_MS) can be taken over.
export async function claimPayment(chargeId) {
  const result = await db.execute({
    sql: `
      UPDATE payments
      SET status = 'granting',
          claimed_at = ?
      WHERE telegram_charge_id = ?
        AND (
          status = 'paid'
          OR (status = 'granting' AND claimed_at < ?)
        )
    `,
    args: [
      new Date().toISOString(),
      chargeId,
      new Date(Date.now() - CLAIM_TIMEOUT_MS).toISOString()
    ]
  });

  return result.rowsAffected === 1;
}

export async function markGranted(chargeId, expiresAt) {
  await db.execute({
    sql: `
      UPDATE payments
      SET status = 'granted',
          granted_at = ?,
          expires_at = ?
      WHERE telegram_charge_id = ?
    `,
    args: [new Date().toISOString(), expiresAt, chargeId]
  });
}
