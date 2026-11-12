PAYPILOT AI FRONTEND REDESIGN

This package contains a redesigned frontend only. It preserves the existing API routes:
- GET /api/health
- GET /api/invoices
- POST /api/invoices
- POST /api/ai/chat
- GET /api/transactions (the current backend does not implement this route yet)

INSTALL
1. Stop the running Node server with Ctrl+C.
2. In your existing project, open the public folder.
3. Replace public/index.html with this package's public/index.html.
4. Replace public/css/style.css with this package's public/css/style.css.
5. Replace public/js/app.js with this package's public/js/app.js.
6. Do NOT replace server.js, package.json, package-lock.json, .env, or your database.
7. Start the server: npm.cmd run dev
8. Open http://localhost:3000 and press Ctrl+F5.

NOTES
- Invoice creation still uses the existing backend and SQLite API.
- AI chat still uses the existing /api/ai/chat endpoint (Groq).
- Search and status filtering are frontend-only over loaded invoice records.
- The transactions screen clearly reports that the current backend has no transactions API.
- PayPal order creation/capture is not implemented by this frontend package.
- Never upload or share your .env file or API keys.
