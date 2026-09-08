# المزرعة النموذجية السياحية — Production

This package preserves the existing frontend and adds a real Node.js + Express + PostgreSQL backend for bookings, administrator authentication, sessions, and persistent image uploads.

## 1. Requirements

- Node.js 20+ (22 LTS recommended)
- npm
- PostgreSQL 15+ or Docker Desktop
- A production HTTPS reverse proxy such as Nginx/Caddy when deployed

## 2. Project structure

```text
المزرعة النموذجية السياحية/
├── index.html
├── admin.html
├── style.css
├── script.js
├── admin.js
├── i18n.js
├── site-images.js
├── images/
├── uploads/
├── backend/
│   ├── package.json
│   └── src/
│       ├── app.js
│       ├── db.js
│       ├── migrate.js
│       ├── create-admin.js
│       └── middleware/
├── database/migrations/001_initial.sql
├── docker-compose.yml
├── .env.example
├── .gitignore
├── robots.txt
├── sitemap.xml
└── SECURITY.md
```

## 3. Local setup

### Option A — PostgreSQL with Docker

From the project directory:

```bash
docker compose up -d
```

The included database is exposed on `localhost:5432` with:
- database: `farm_tourism`
- user: `farm_user`
- password: `change_me_local_only`

Copy `.env.example` to `.env` and use:

```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://farm_user:change_me_local_only@localhost:5432/farm_tourism
SESSION_SECRET=replace_with_a_random_string_at_least_32_characters
CORS_ORIGIN=http://localhost:3000
UPLOAD_DIR=./uploads
MAX_UPLOAD_MB=8
TRUST_PROXY=0
```

Generate a strong session secret, for example with Node:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Install and migrate

```bash
npm run install:backend
npm run migrate
npm run create-admin
npm run dev
```

The admin creation command asks for the username/email and password interactively. Passwords are never stored in plaintext.

Open:

```text
http://localhost:3000/
http://localhost:3000/admin.html
```

## 4. Admin access

Use the account created by:

```bash
npm run create-admin
```

There is no default password in the source code.

The dashboard is available at `/admin.html`. Changing the URL is not a security feature; all admin API routes are protected server-side.

## 5. Booking workflow

The public form sends `POST /api/bookings`.

The server validates:
- name
- phone
- optional email
- visitor count
- booking type
- date
- time
- message

Bookings are stored in PostgreSQL with `pending` status.

The server also checks for an existing pending/confirmed request at the requested time. The final business rules can be made stricter if the farm needs resource-specific schedules.

## 6. Admin API

```text
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me
GET    /api/auth/csrf

POST   /api/bookings

GET    /api/admin/dashboard
GET    /api/admin/bookings
PATCH  /api/admin/bookings/:id
DELETE /api/admin/bookings/:id

GET    /api/admin/images
POST   /api/admin/images/:slot
DELETE /api/admin/images/:slot
```

All state-changing authenticated requests require the session's CSRF token.

## 7. Image management

The admin dashboard can replace images for the existing slots.

Accepted input formats:
- JPEG
- PNG
- WebP

The server:
1. validates the multipart upload,
2. limits file size,
3. inspects the actual image,
4. rejects invalid dimensions,
5. rotates according to image metadata,
6. resizes without enlarging,
7. converts to WebP,
8. creates a random server-side filename,
9. stores metadata in PostgreSQL.

Images are not stored in localStorage or sessionStorage.

## 8. Database schema

### users
Administrator accounts, bcrypt hashes, role, status and login timestamps.

### bookings
Customer booking information, requested date/time, visitor count and status.

### site_images
Image slot, generated storage filename, MIME type, dimensions and size.

### site_content
Reserved for server-managed editable website content.

### audit_logs
Important administrative/security events.

PostgreSQL session storage is also used by `connect-pg-simple`.

## 9. Production environment

Set:

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://...
SESSION_SECRET=<long random secret>
CORS_ORIGIN=https://YOUR-DOMAIN.example
UPLOAD_DIR=/var/lib/farm-tourism/uploads
MAX_UPLOAD_MB=8
TRUST_PROXY=1
```

Never commit `.env`.

## 10. Production deployment

Recommended architecture:

```text
Internet
   |
HTTPS reverse proxy
   |
Node.js / Express
   |
PostgreSQL
```

1. Provision a private PostgreSQL database.
2. Deploy the project on a server.
3. Run `npm run install:backend`.
4. Create production `.env`.
5. Run `npm run migrate`.
6. Run `npm run create-admin`.
7. Start with `npm start`.
8. Put Nginx/Caddy in front of Node.
9. Configure HTTPS and redirect HTTP to HTTPS.
10. Point `CORS_ORIGIN` to the exact production origin.
11. Back up PostgreSQL and the `uploads/` directory.
12. Keep Node and dependencies updated.

Example systemd process command:

```bash
npm start
```

For real deployments, use a process manager/systemd/container orchestration and a reverse proxy rather than exposing Node directly.

## 11. Domain and SEO

Replace `https://example.com/` in:
- `index.html` canonical/OG URL
- `robots.txt`
- `sitemap.xml`

with the real production domain before launch.

The admin page has `noindex, nofollow`, but this is not used as an authentication mechanism.

## 12. Security checklist

- [x] Server-side authentication
- [x] Server-side authorization
- [x] Password hashing
- [x] PostgreSQL database
- [x] Secure sessions
- [x] CSRF protection
- [x] XSS-aware output escaping in admin-generated HTML
- [x] Parameterized SQL
- [x] Rate limiting
- [x] Secure image uploads
- [x] Restricted CORS
- [x] CSP/security headers
- [ ] HTTPS certificate — configure on production server
- [x] Safe error responses
- [x] Audit logging
- [ ] Off-site backups — configure operationally
- [ ] Continuous dependency monitoring — configure operationally
- [x] Production configuration via environment variables

## 13. Manual testing

### Public booking
1. Open `/`.
2. Enter valid data.
3. Submit.
4. Confirm the request appears in the admin dashboard.
5. Try an invalid date, invalid phone and excessive visitor count.

### Admin
1. Open `/admin.html`.
2. Log in with the account created by `npm run create-admin`.
3. Search bookings.
4. Change a booking status.
5. Delete a booking.
6. Log out.
7. Try loading `/api/admin/bookings` without a session; it must return 401.

### Upload
1. Log in.
2. Open the images tab.
3. Upload JPEG/PNG/WebP.
4. Refresh the public site.
5. Confirm the new image persists after closing the browser.
6. Try a non-image file; it must be rejected.

### Authorization
Do not trust the browser UI. Directly call admin endpoints without a valid session and verify they return 401/403.

## 14. Backups

Back up both:
- PostgreSQL
- `uploads/`

Example PostgreSQL dump:

```bash
pg_dump "$DATABASE_URL" > farm_tourism_backup.sql
```

Test restores periodically on a separate environment.

## 15. Important production notes

This package is a real server-backed implementation, but production readiness also depends on the hosting environment: HTTPS, firewall rules, OS updates, database backups, DNS, reverse proxy configuration, monitoring, secret management and dependency updates must be configured correctly.
