# Master Access

## Canonical authentication

LegalWhat now has one master-access authority:

- Authentication is **password-only**.
- No master email or username is requested or accepted as part of the credential.
- The credential lives only in the deployment secret `MASTER_ADMIN_PASSWORD`.
- No plaintext master credential or reusable password verifier belongs in source control.
- Successful master login begins at `/welcome`.
- The persistent master navigator is the only traversal authority between master panels.
- Back and Forward wrap across the complete registered master-panel sequence.
- Logout remains available from that navigation bar.
- Gesture-driven page switching is disabled for the master shell so normal mobile scrolling cannot change panels.

## Server contract

Master login uses:

```
POST /api/master-login
{ "password": "<deployment master password>" }
```

On success the server issues a finite, HttpOnly, signed master session cookie and returns the master route metadata. Master authentication is intentionally independent of the ordinary user database so administrative recovery is still possible while normal user storage is degraded.

## Security rules

- Rate-limit master authentication attempts.
- Use HTTPS in production.
- Use Secure, HttpOnly and SameSite cookie protections.
- Never log the master password or signed session token.
- Never add a second master-password authority to Passport, a client component, or another route.
- Rotate the deployment secret only when the credential is intentionally changed or compromise is suspected.
- `SESSION_SECRET` signs master sessions and must remain a strong deployment secret.

## Panel authority

The canonical panel sequence is defined once in `client/src/components/MasterPanelNavigator.tsx`. Aliases may point to an existing panel, but every distinct master/admin operational surface must appear exactly once in the canonical sequence.

The master session supersedes client-side feature toggles for master-only operational panels. Server-side authorization remains authoritative for privileged API actions.

## Ordinary users

Normal users do not use the master credential. Signup and login remain separate user-account flows, with unique persisted email identities and password hashes stored in the normal authentication tables.
