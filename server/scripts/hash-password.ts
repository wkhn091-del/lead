import { hashPassword } from '../src/lib/password.js';

/** Reads a line without echoing it (or from a pipe: echo "…" | npm run hash-password). */
async function readPassword(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  }

  process.stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();
  return new Promise((resolve) => {
    let input = '';
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(input);
          return;
        }
        if (char === '\u0003') process.exit(130);
        input = char === '\u007f' ? input.slice(0, -1) : input + char;
      }
    };
    stdin.on('data', onData);
  });
}

const password = await readPassword('Password (input hidden): ');
if (password.length < 12) {
  console.error('Use a password of at least 12 characters.');
  process.exit(1);
}

console.log('\nAdd this line to server/.env (or your host’s environment settings):\n');
console.log(`ADMIN_PASSWORD_HASH=${await hashPassword(password)}`);
