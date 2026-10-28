#!/usr/bin/env python3
"""Generate the owner password hash for the private console (Python version).

Usage:
    python3 scripts/hash_password.py
    printf '%s' 'your-long-password' | python3 scripts/hash_password.py

Running it directly opens a hidden prompt. The password is not echoed to the
terminal. The Node version in scripts/hash-password.mjs produces the same hash
format.
"""

import base64
import getpass
import hashlib
import os
import sys

N = 16384
R = 8
P = 1
KEY_LENGTH = 64
SALT_BYTES = 24
MAX_MEM = 128 * 1024 * 1024


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def read_password() -> str:
    if sys.stdin.isatty():
        return getpass.getpass("Admin password: ")
    return sys.stdin.read().replace("\r\n", "\n").removesuffix("\n")


def main() -> int:
    password = read_password()
    if not password:
        print(
            "Password is empty. Run the command again and type your password "
            "when prompted (nothing will appear while typing).",
            file=sys.stderr,
        )
        return 1

    if len(password) < 16:
        print(
            "Warning: use at least 20 characters for a production admin password.",
            file=sys.stderr,
        )

    salt = os.urandom(SALT_BYTES)
    derived = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=N,
        r=R,
        p=P,
        dklen=KEY_LENGTH,
        maxmem=MAX_MEM,
    )

    value = f"scrypt${N}${R}${P}${b64(salt)}${b64(derived)}"
    print(f"ATTENDANCE_ADMIN_PASSWORD_HASH={value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
