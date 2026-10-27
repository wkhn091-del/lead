import { hashPassword } from '../src/lib/password.js';
import { TEST_EMAIL, TEST_PASSWORD } from './credentials.js';

// Runs before each test file imports the app, so config.ts sees test settings.
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'mongodb://localhost:27017/omek_leads_test',
  ADMIN_EMAIL: TEST_EMAIL,
  ADMIN_PASSWORD_HASH: await hashPassword(TEST_PASSWORD),
  CORS_ORIGINS: '',
  COOKIE_SAMESITE: 'lax',
  TRUST_PROXY: '0',
  FRONTEND_DIST: './test/no-frontend',
});
