# Admin MFA: TOTP (RFC 6238) + `qrcode` 1.5.4: our notes

> Saved 2026-11-05. Code: `packages/auth/src/totp.ts` (algorithm), `packages/auth/src/mfa.ts` (storage,
> setup, sign-in check), `apps/admin/app/[locale]/mfa/setup/`. Tests: `packages/auth/test/totp.test.ts`
> (RFC vectors), `mfa-crypto.test.ts`, E2E `scripts/e2e/browser-admin-mfa.ts`.

## Decisions (user, 2026-11-05)

- Authenticator app (TOTP) for every admin + 10 one-time recovery codes. No emailed codes (anyone with
  the inbox would get in). Lost phone + codes → `npm run admin:create` again (resets password + MFA).

## Standards (what the code follows)

| Thing | Value | Source |
|---|---|---|
| HOTP | HMAC-SHA1(secret, 8-byte big-endian counter) → "dynamic truncation" → mod 10^6 | RFC 4226 §5.3 |
| TOTP | counter = floor(unix seconds / 30) | RFC 6238 §4 |
| Test vectors | secret ASCII `12345678901234567890`; t=59 → `94287082`, t=1111111109 → `07081804`, t=1234567890 → `89005924`, t=20000000000 → `65353130` (8 digits; 6-digit = last 6) | RFC 6238 Appendix B |
| Secret size | 160 bits (20 bytes) for SHA-1 | RFC 4226 §4 R6 |
| Drift window | accept ±1 step (RFC suggests at most one step back for network delay) | RFC 6238 §5.2 |
| Replay | a used step must not be accepted again: we store `mfa.lastStep`, update only if newer (atomic) | RFC 6238 §5.2 |
| QR payload | `otpauth://totp/<Issuer>:<account>?secret=<BASE32>&issuer=<Issuer>&algorithm=SHA1&digits=6&period=30` | Google Authenticator "Key Uri Format" (de facto standard) |
| Base32 | RFC 4648 alphabet `A–Z2–7`, no padding | RFC 4648 §6 |

Why SHA-1 is OK here: HMAC-SHA1 isn't broken by SHA-1 collisions, and it's the only algorithm every
authenticator app supports (many ignore `algorithm=SHA256`).

## `qrcode` (npm, MIT, pinned 1.5.4) + `@types/qrcode` 1.5.6

- Server-side only: `QRCode.toDataURL(text, { errorCorrectionLevel: "M", margin: 1, width: 240 })` →
  `data:image/png;base64,...`, shown with a plain `<img>` (never inject SVG markup into the page).
- Other APIs: `toString(text, { type: "svg" })`, `toBuffer`, `toFile`. All return Promises when no callback.
- Runtime deps: `pngjs`, `dijkstrajs`, `yargs` (CLI only).

## Storage (User.mfa, `select: false` on every secret)

- `secretEnc` / `pendingSecretEnc`: `v1.<iv>.<tag>.<ciphertext>`, AES-256-GCM, 12-byte random IV,
  AAD = user id (a secret copied to another user won't decrypt). Key = `MFA_ENCRYPTION_KEY` (32 bytes,
  base64url), separate from `NEXTAUTH_SECRET`.
- `recoveryCodeHashes`: HMAC-SHA256 with an HKDF-derived key (`sos/mfa-recovery/v1`); a code is removed
  with an atomic `$pull` when used.
- Changing/losing `MFA_ENCRYPTION_KEY` makes every stored secret unreadable → each admin re-runs setup.
  Future rotation: add `v2` format + keep the old key for decryption.

## Gotchas found while building

- `new URL("otpauth://totp/Label")`: `host` is `totp`, `pathname` is `/Label`.
- Mongoose `.select("+a +b c")`: a bare `c` switches to "only these fields" and drops everything else
  (e.g. `mfa.enabled`). Use only `+field` entries to add hidden fields.
