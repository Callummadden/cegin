# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Cegin Contributors
# This file is part of Cegin — https://github.com/cmadzz/cegin
import secrets, pathlib
jwt_secret = secrets.token_hex(32)
env_path = pathlib.Path(__file__).parent / '.env'
env_path.write_text(env_path.read_text() + f'JWT_SECRET={jwt_secret}\n')
print('Generated JWT_SECRET and added to .env')
