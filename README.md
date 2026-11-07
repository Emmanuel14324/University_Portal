# St Jude University Portal

A Next.js App Router student information portal for St Jude University. Authenticated student and administrator pages load account-specific records through protected server APIs. Password, TOTP, WebAuthn, and server-side application sessions require a configured Supabase project and applied migrations before they can be used.

## Project structure

- `src/app/(auth)/` — three-factor login, authenticator/passkey preview screens, and account recovery
- `src/app/student/[page]/` — student dashboard, courses, results, fees, profile, and security pages
- `src/app/admin/[page]/` — administration dashboard, students, academics, results, finance, security, user management, and settings pages
- `src/app/api/` — API areas for auth, TOTP, WebAuthn, and admin operations
- `src/components/` — shared portal and authentication UI components
- `src/lib/` — Supabase, authentication, security, and validation utilities
- `src/types/` — shared TypeScript types
- `src/proxy.ts` — pass-through request proxy scaffold
- `supabase/migrations/` — database migrations

## Portal pages

- `/` — portal landing page
- `/login`, `/recovery` — three-factor sign-in and account-recovery screens
- `/verify-otp`, `/verify-biometric` — legacy standalone previews; use `/login` for the connected factor sequence
- `/student/dashboard`, `/student/courses`, `/student/results`, `/student/fees`, `/student/profile`, `/student/security`
- `/admin/dashboard`, `/admin/students`, `/admin/academics`, `/admin/results`, `/admin/finance`, `/admin/security`, `/admin/users`, `/admin/settings`

Student and administrator pages require an authenticated application session and load their information from Supabase; the displayed name and student information are tied to the signed-in account. Student profile edits, eligible course registrations, administrator preferences, course creation, result entry/publication, and user invitations are persisted through role-protected APIs. Student records and administrator directory/results/finance/security views are read from the database. Finance is currently read-only and supports report export; payment processing requires a payment provider and is not included.

Add local Supabase credentials to `.env.local` when configuring the backend; do not commit secrets.

## Getting started

Install dependencies and start the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the app.

## Supabase setup

1. Create a Supabase project.
2. Copy `.env.example` to `.env.local`.
3. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env.local` using the project's API settings.
4. Restart the development server after changing environment variables.

The browser client is available from `@/lib/supabase/client` through `getSupabaseClient()`. The cookie-aware server client is available from `@/lib/supabase/server` through `getSupabaseServerClient()` for Route Handlers and Server Actions. Both require the environment variables above and use the publishable key; never expose a Supabase secret or service-role key through a `NEXT_PUBLIC_` variable. The server client uses HTTP-only, SameSite=Lax cookies and requires HTTPS in production.

SQL migrations in `supabase/migrations/` define the initial St Jude schema, row-level security policies, secure session RPCs, database-clock challenge consumption, atomic TOTP enrollment and recovery, atomic WebAuthn completion, and persisted portal preferences. Apply every migration in filename order to the Supabase project before using the application. RLS is enabled on application tables, and sensitive authentication tables have no client policies; trusted server code is required for those operations.

`POST /api/auth/login` verifies a pre-provisioned student registration number or account email with Supabase Auth, rate-limits password failures, and issues only a short-lived HTTP-only authentication-transaction cookie. The password → TOTP → WebAuthn transaction lasts 15 minutes; authenticator codes remain six digits and rotate every 30 seconds. It does not expose the Supabase Auth session or grant access. The `/login` flow continues to `/api/totp/challenge`, `/api/totp/enroll`, `/api/totp/verify-enrollment`, and `/api/totp/verify` for authenticator setup and TOTP verification. TOTP secrets are encrypted with AES-256-GCM; enrollment returns a QR code and one-time recovery codes. A saved recovery code can replace the TOTP step once if the authenticator is unavailable; recovery-code consumption is atomic, audited, and advances to the WebAuthn factor. QR codes are only shown during authenticator enrollment, not on each sign-in. The TOTP factor does not create an authenticated application session.

WebAuthn is implemented in `/api/webauthn/register/{options,verify}` and `/api/webauthn/authenticate/{options,verify}` with `@simplewebauthn/server` and browser helpers in `src/lib/security/webauthn-browser.ts`. Credential public keys and counters are stored server-side; user verification is required. Platform authenticators are preferred for registration. **WebAuthn user verification can be a device PIN or biometrics; the server cannot prove which method the operating system used, and it never receives/stores biometric data.**

`POST /api/auth/complete` atomically verifies the password → TOTP → WebAuthn evidence, consumes the one-time completion token, records an audit event, and creates an eight-hour application session. The raw session token is held only in an HTTP-only, SameSite=Lax cookie (`Secure` and `__Host-` prefixed in production); only its SHA-256 hash is stored in the database. `GET /api/auth/session` validates the current session and role, while `POST /api/auth/logout` revokes the current session and records the revocation. Student pages require an active student session; admin pages require an admin or super-admin session.

These are custom application sessions and do not create a Supabase Auth JWT. Protected server APIs must call the server-side session validator and enforce roles explicitly; browser clients cannot use these cookies to query Supabase directly under the authenticated RLS role. Trusted APIs use `SUPABASE_SECRET_KEY` server-side and must never expose it to browser code.

The protected student API includes `GET /api/student/me`, `/courses`, `/results`, `/fees`, `/security`, and `/course-catalog`; `PATCH /api/student/profile` only accepts whitelisted contact fields, and `POST /api/student/course-registrations` checks active status, programme/year eligibility, course availability, and the semester registration window in a database RPC. Results are limited to published records, and student queries are always scoped to the signed-in account.

The admin API provides paginated `GET /api/admin/students`, plus academic, results, finance, security, user, settings, and overview data. The admin security page shows login session names and user IDs, sign-in times, sign-out or expiry times, and the existing security audit events. Administrators can invite and provision students, create courses assigned to a programme/year, and record or publish results. Only a super administrator can invite administrator accounts. Settings are persisted as university preferences; they do not themselves create semesters, open registration, or change account policies. The security endpoint omits source-IP hashes and credentials. To use these workflows, configure the Supabase environment variables, apply every migration, and provision the initial accounts and role records through trusted university administration.

Run `npm test` for focused security-policy and request-validation tests covering role access, expiry/revocation, attempt limits, TOTP replay, incomplete/out-of-order factor chains, and API input restrictions. Live database authorization and migration behavior still need integration testing against a configured Supabase project.

Student accounts must be created and linked by authorized university staff; public self-registration is intentionally not enabled. The admin student-invitation workflow sends an invitation and provisions the student identity and profile. Administrator invitations are restricted to super administrators.

Password reset and payment processing are not implemented. Configure the WebAuthn relying party for your deployment in `.env.local`; local development can use `WEBAUTHN_RP_ID=localhost` and `WEBAUTHN_ORIGIN=http://localhost:3000`. Production must use the exact HTTPS portal origin and matching RP domain. Generate keys locally and add them to an untracked `.env.local` file: `AUTH_RATE_LIMIT_SECRET` and `TOTP_RECOVERY_HASH_KEY` should each be random values of at least 32 characters; `TOTP_ENCRYPTION_KEY` should be base64 for 32 random bytes (for example `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`). Keep all these values, especially `SUPABASE_SECRET_KEY`, server-only.
