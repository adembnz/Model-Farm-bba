# Security status

The project has been upgraded from a browser-only prototype to a server-backed application.

## Main changes

- Bookings are stored in PostgreSQL instead of browser storage.
- Administrator authentication is server-side with bcrypt password hashing.
- Sessions use HttpOnly/SameSite cookies and PostgreSQL session storage.
- State-changing requests use a server-issued CSRF token.
- Login, booking, and admin endpoints have rate limits.
- Admin endpoints enforce authentication and role checks.
- Uploads accept JPEG/PNG/WebP, inspect image metadata with Sharp, resize to WebP, and use random filenames.
- User input is validated with Zod and database queries are parameterized.
- Helmet security headers and a restrictive CSP are enabled.
- Production secrets are read from environment variables.
- Audit logging records important administrative/security events without storing passwords or session tokens.
- Customer booking data is never exposed through public endpoints.

## Important

No web application can honestly be declared 100% secure. Before production, configure HTTPS, a strong unique `SESSION_SECRET`, a real production database, trusted CORS origin, backups, monitoring, dependency updates, and a reverse proxy/firewall.

The existing Arabic/French/English frontend design is preserved as much as possible.
