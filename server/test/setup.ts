// Runs before each test file imports the app, so config.ts sees test settings.
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'mongodb://localhost:27017/omek_leads_test',
  CORS_ORIGINS: '',
  TRUST_PROXY: '0',
  FRONTEND_DIST: './test/no-frontend',
});
