# Security Policy

## Secrets

Only `.env.example` may be committed. Real values belong in the ignored root `.env`.

Never put these values in `VITE_*` variables:

- Supabase database password
- Supabase service-role key
- JWT `SECRET_KEY`
- Groq API key

Vite variables are embedded in frontend JavaScript and are not private.

## If credentials are exposed

1. Rotate the Supabase database password.
2. Rotate the Supabase service-role key.
3. Rotate the Groq API key if configured.
4. Replace the backend JWT `SECRET_KEY`; existing sessions will become invalid.
5. Update the private `.env` and rebuild installers.
6. Remove secrets from Git history before making the repository public. Deleting a file in a later commit is not sufficient.

## Desktop distribution model

The internal desktop build bundles `.env` with the local backend. Distribute installers only to trusted users. A public release should use a separately hosted HTTPS backend and must not contain database or service-role credentials.

## Reporting

Do not open a public issue containing credentials, personal information, database exports, or installer logs with sensitive values. Contact the repository owner privately.
