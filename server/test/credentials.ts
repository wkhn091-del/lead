export const TEST_EMAIL = 'owner@example.com';
export const TEST_PASSWORD = 'correct horse battery staple';

/** The test database is emptied before each run, so its name must end in _test. */
export function assertTestDatabase(url: string) {
  const name = url.replace(/^[^/]*\/\/[^/]*\/?/, '').split('?')[0];
  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests against "${name || 'no database name'}". Point TEST_DATABASE_URL at a database whose name ends in _test.`,
    );
  }
}
