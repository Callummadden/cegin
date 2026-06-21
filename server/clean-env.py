# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Cegin Contributors
# This file is part of Cegin — https://github.com/Callummadden/cegin
"""Remove secret keys from .env — they should only live in secrets/ dir."""
import pathlib

env_path = pathlib.Path(__file__).parent / '.env'
lines = env_path.read_text().splitlines()

# These keys should NOT be in .env (they're in secrets/ now)
SECRET_KEYS = set()
SECRET_KEYS.add('TEXT_API_KEY')
SECRET_KEYS.add('VISION_API_KEY')
SECRET_KEYS.add('JWT_SECRET')
SECRET_KEYS.add('DEEPSEEK_API_KEY')
SECRET_KEYS.add('GOOGLE_API_KEY')

filtered = []
for line in lines:
    stripped = line.strip()
    if stripped and not stripped.startswith('#'):
        key = stripped.split('=', 1)[0].strip()
        if key in SECRET_KEYS:
            continue  # skip secret keys
    filtered.append(line)

env_path.write_text('\n'.join(filtered) + '\n')
print(f"Removed secret keys from .env (kept {len(filtered)} lines)")
