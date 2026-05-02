const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'CRON_SECRET',
  'ANTHROPIC_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_MESSAGING_SERVICE_SID',
] as const;

const OPTIONAL_ENV_VARS = ['NEXT_PUBLIC_APP_URL'] as const;

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
