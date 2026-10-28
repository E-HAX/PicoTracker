#!/usr/bin/env node
/**
 * Generate the owner password hash for the private console.
 *
 * Usage:
 *   node scripts/hash-password.mjs
 *   printf '%s' 'your-long-password' | node scripts/hash-password.mjs
 *
 * Running it directly opens a hidden prompt. The password is not echoed to
 * the terminal. Set the printed value as ATTENDANCE_ADMIN_PASSWORD_HASH in
 * Vercel.
 */

import crypto from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 24;

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function promptHidden(query) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let value = '';
    let escapeState = 0;
    let finished = false;

    const cleanup = () => {
      if (finished) return;
      finished = true;
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };

    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          cleanup();
          stdout.write('\n');
          resolve(value);
          return;
        }

        if (char === '\u0003') {
          cleanup();
          stdout.write('\n');
          process.exit(130);
        }

        if (escapeState === 1) {
          escapeState = char === '[' || char === 'O' ? 2 : 0;
          continue;
        }
        if (escapeState === 2) {
          if (char >= '@' && char <= '~') escapeState = 0;
          continue;
        }
        if (char === '\u001b') {
          escapeState = 1;
          continue;
        }

        if (char === '\u007f' || char === '\b') {
          if (value.length > 0) value = value.slice(0, -1);
          continue;
        }

        if (char >= ' ') value += char;
      }
    };

    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    stdout.write(query);
    stdin.on('data', onData);
  });
}

function scrypt(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      KEY_LENGTH,
      { N, r: R, p: P, maxmem: 128 * 1024 * 1024 },
      (error, derived) => {
        if (error) reject(error);
        else resolve(derived);
      }
    );
  });
}

async function main() {
  let password;
  if (process.argv[2]) {
    password = process.argv[2];
  } else if (!process.stdin.isTTY) {
    password = (await readStdin()).replace(/\r?\n$/, '');
  } else {
    console.log(
      'Type your admin password and press Enter. Input is hidden.\n'
    );
    password = await promptHidden('Admin password: ');
  }

  if (!password) {
    console.error(
      'Password is empty. Run the command again and type your password when prompted (nothing will appear while typing).'
    );
    process.exit(1);
  }

  if (password.length < 16) {
    console.error(
      'Warning: use at least 20 characters for a production admin password.'
    );
  }

  const salt = crypto.randomBytes(SALT_BYTES);
  const derived = await scrypt(password, salt);
  const hash = [
    'scrypt',
    N,
    R,
    P,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');

  console.log(`ATTENDANCE_ADMIN_PASSWORD_HASH=${hash}`);
}

main().catch((error) => {
  console.error('Could not generate password hash:', error.message);
  process.exit(1);
});
