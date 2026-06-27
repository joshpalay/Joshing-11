const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'CRON_SECRET',
  'ANTHROPIC_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_MESSAGING_SERVICE_SID',
] as const;

// ADMIN_USER_IDS (B-Report-5): comma-separated users.id allowlist for the content-
// report review queue. Optional by design — unset ⇒ the queue is unreachable and the
// app boots fine. Never promote to REQUIRED.
// OPENAI_API_KEY (B-LLM-PROVIDER-AB-SWITCH): only needed when a provider toggle is
// flipped to OpenAI. The feature defaults to Anthropic, so unset is fine — server
// boots and every surface stays on Anthropic. Never promote to REQUIRED.
// LLM_COST_REPORT_EMAIL (B-LLM-COST-LATENCY-REPORT-01, B3): recipient for the weekly
// cost & latency digest email. Unset ⇒ the cron still stores the digest and simply
// skips the email. Never promote to REQUIRED.
const OPTIONAL_ENV_VARS = ['NEXT_PUBLIC_APP_URL', 'ADMIN_USER_IDS', 'OPENAI_API_KEY', 'LLM_COST_REPORT_EMAIL'] as const;

export default function checkEnv() {
  const jwtSecret = process.env.JWT_SECRET?.trim() || process.env.AUTH_SECRET?.trim();
  if (!jwtSecret) {
    throw new Error('Missing required environment variable: JWT_SECRET (or AUTH_SECRET)');
  }

  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]?.trim()) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  for (const key of OPTIONAL_ENV_VARS) {
    if (!process.env[key]?.trim()) {
      console.warn(`Warning: optional env var ${key} is not set`);
    }
  }
}
