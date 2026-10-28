#!/usr/bin/env node
/**
 * Generate the owner password hash for the private console.
 *
 * Usage:
 *   node scripts/hash-password.mjs
 *   printf '%s' 'your-long-password' | node scripts/hash-password.mjs
 *
 * Set the printed value as ATTENDANCE_ADMIN_PASSWORD_HASH in Vercel.
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
    console.error(
      [
        'Usage:',
        "  node scripts/hash-password.mjs 'your password'",
        "  read -s PW; printf '%s' \"$PW\" | node scripts/hash-password.mjs",
      ].join('\n')
    );
    process.exit(1);
  }

  if (!password) {
    console.error('Password is empty. Nothing generated.');
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
