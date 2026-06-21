# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Cegin Contributors
# This file is part of Cegin — https://github.com/Callummadden/cegin
#!/usr/bin/env python3
"""One-time setup: copies secrets from .env into ./secrets/ for Docker Compose."""
import os, pathlib

env_path = pathlib.Path(__file__).parent / '.env'
secrets_dir = pathlib.Path(__file__).parent / 'secrets'
secrets_dir.mkdir(mode=0o700, exist_ok=True)

# Map env var names to secret file names
SECRET_KEYS = ['TEXT_API_KEY', 'VISION_API_KEY', 'JWT_SECRET',
               'DEEPSEEK_API_KEY', 'GOOGLE_API_KEY']

# Parse .env
env = {}
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip()

created = []
for key in SECRET_KEYS:
    val = env.get(key, '')
    if not val or val.startswith('***'):
        continue
    secret_file = secrets_dir / key
    secret_file.write_text(val + '\n')
    secret_file.chmod(0o600)
    created.append(key)

if created:
    print(f"Created secret files: {', '.join(created)}")
else:
    print("No secrets found in .env to copy.")
    print("Add your API keys to .env and re-run, or create files manually in secrets/")
