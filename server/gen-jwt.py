import secrets, pathlib
jwt_secret = secrets.token_hex(32)
env_path = pathlib.Path(__file__).parent / '.env'
env_path.write_text(env_path.read_text() + f'JWT_SECRET={jwt_secret}\n')
print('Generated JWT_SECRET and added to .env')
