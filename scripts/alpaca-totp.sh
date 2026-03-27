#!/bin/bash
# Generate Alpaca TOTP code from .env secret
# Usage: bash scripts/alpaca-totp.sh
cd "$(dirname "$0")/.."
SECRET=$(grep ALPACA_MFA_SECRET .env | cut -d= -f2)
python3 -c "
import hmac, hashlib, struct, time, base64
secret = '$SECRET'
secret += '=' * (-len(secret) % 8)
key = base64.b32decode(secret, casefold=True)
t = int(time.time()) // 30
msg = struct.pack('>Q', t)
h = hmac.new(key, msg, hashlib.sha1).digest()
o = h[-1] & 0x0F
code = (struct.unpack('>I', h[o:o+4])[0] & 0x7FFFFFFF) % 1000000
remaining = 30 - (int(time.time()) % 30)
print(f'{code:06d} ({remaining}s remaining)')
"
