import db from "./db.js";

export async function createSubscription(
  userId,
  plan,
  expiresAt = null,
  source = "legacy"
) {
  if (plan !== "free" && plan !== "premium") {
    throw new Error("Invalid subscription plan");
  }

  const allowedSources = [
    "free",
    "trial",
    "paid",
    "admin",
    "legacy"
  ];

  if (!allowedSources.includes(source)) {
    throw new Error("Invalid subscription source");
  }

  await db.execute({
    sql: `
      INSERT INTO subscriptions (
        user_id,
        plan,
        expires_at,
        status,
        source
      )
      VALUES (?, ?, ?, 'active', ?)
    `,
    args: [
      userId,
      plan,
      expiresAt,
      source
    ]
  });
}

export async function getActiveSubscription(userId) {
  const result = await db.execute({
    sql: `
      SELECT *
      FROM subscriptions
      WHERE user_id = ?
        AND status = 'active'
        AND (
          expires_at IS NULL
          OR datetime(expires_at) > datetime('now')
        )
      ORDER BY id DESC
      LIMIT 1
    `,
    args: [userId]
  });

  return result.rows[0] ?? null;
}

// An active Premium (paid or trial) of the user, the one that ends last.
async function getLatestPremium(userId) {
  const result = await db.execute({
    sql: `
      SELECT id, source, expires_at
      FROM subscriptions
      WHERE user_id = ?
        AND plan = 'premium'
        AND status = 'active'
        AND expires_at IS NOT NULL
        AND datetime(expires_at) > datetime('now')
      ORDER BY datetime(expires_at) DESC, id DESC
      LIMIT 1
    `,
    args: [userId]
  });

  return result.rows[0] ?? null;
}

// Premium for `days` days, counted from the end of the current Premium if there is one
// (a trial that is still running is not lost). The user's token is never touched: Free and
// Premium use the same token, only the subscription row changes. Returns the new expiry.
export async function grantPremium(userId, days, now = Date.now()) {
  const latest = await getLatestPremium(userId);
  const current = latest ? new Date(latest.expires_at).getTime() : 0;
  const base = Math.max(now, Number.isNaN(current) ? 0 : current);
  const expiresAt = new Date(base + days * 86400000).toISOString();

  if (latest && latest.source === "paid") {
    await db.execute({
      sql: "UPDATE subscriptions SET expires_at = ? WHERE id = ?",
      args: [expiresAt, latest.id]
    });
  } else {
    // a new row is the newest one, so it is the one shown to the user
    await createSubscription(userId, "premium", expiresAt, "paid");
  }

  return expiresAt;
}

export async function hasUsedTrial(userId) {
  const result = await db.execute({
    sql: "SELECT 1 AS used FROM subscriptions WHERE user_id = ? AND source = 'trial' LIMIT 1",
    args: [userId]
  });

  return result.rows.length > 0;
}

// The trial is offered once per user and never while Premium is already active.
export async function canStartTrial(userId) {
  if (await hasUsedTrial(userId)) {
    return false;
  }

  return (await getLatestPremium(userId)) === null;
}

// Returns the expiry, or null if the user is not allowed a trial (already used / Premium active).
// INSERT OR IGNORE + the unique index subscriptions_trial_once make double clicks safe.
export async function grantTrial(userId, days, now = Date.now()) {
  if (!(await canStartTrial(userId))) {
    return null;
  }

  const expiresAt = new Date(now + days * 86400000).toISOString();

  const result = await db.execute({
    sql: `
      INSERT OR IGNORE INTO subscriptions (
        user_id,
        plan,
        expires_at,
        status,
        source
      )
      VALUES (?, 'premium', ?, 'active', 'trial')
    `,
    args: [userId, expiresAt]
  });

  return result.rowsAffected === 1 ? expiresAt : null;
}

// Had Premium (bought or trial) at some point: its end is what "subscription ended" refers to.
export async function hadPremium(userId) {
  const result = await db.execute({
    sql: `
      SELECT 1 AS had
      FROM subscriptions
      WHERE user_id = ?
        AND plan = 'premium'
        AND source IN ('paid', 'trial')
      LIMIT 1
    `,
    args: [userId]
  });

  return result.rows.length > 0;
}
