# Veldr

Veldr is a personal note writing system with a Vue/Vite frontend and an Express + SQLite backend.

This repository has been reorganized as a full-stack project. It is intended for private writing, image-heavy notes, drafts, and personal article management.
The backend can also host the lightweight CMS/knowledge-base API from `github-cms` under a separate namespace, so one Node process can serve multiple frontends with isolated data stores.

## Current Positioning

- Use Veldr for personal notes and longer writing.
- New articles default to private.
- Chinese titles are supported without requiring a URL slug.
- `Slug` is optional. Leave it empty for personal notes; use it only when an English URL identifier is useful.
- Uploaded images and SQLite runtime data stay local and are ignored by Git.

## Project Structure

```text
veldr/
├─ backend/              # Express API, SQLite data, uploads, cleanup scripts
├─ frontend/             # Vue 3 + Vite admin and reader UI
├── cms-frontend/         # Standalone NoteFlow-style CMS frontend
├─ public/               # Legacy/static assets kept from the original project
├─ .gitignore
└─ README.md
```

## Local Development

Start the backend:

```bash
cd backend
npm install
cp .env.example .env
npm start
```

Backend default URL:

```text
http://127.0.0.1:5000/api
http://127.0.0.1:5000/api/health
```

Start the frontend:

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Frontend default URL:

```text
http://127.0.0.1:5173
```

Start the standalone CMS frontend:

```bash
cd cms-frontend
npm install
cp .env.example .env
npm run dev
```

CMS frontend default URL:

```text
http://127.0.0.1:5174
```

## Environment

Backend:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `5000` | Backend listening port |
| `DB_DIALECT` | `sqlite` | Database dialect |
| `DB_STORAGE` | `public/data/cms.sqlite` | Main SQLite database |
| `SECURITY_DB_STORAGE` | `public/data/security.sqlite` | Password/auth SQLite database |
| `DB_LOGGING` | `false` | Sequelize query logging |
| `DEFAULT_PASSWORD` | `123456` | Initial password value when no security DB exists |
| `JWT_SECRET` | development fallback | Secret used to sign admin auth JWTs |
| `JWT_EXPIRES_IN` | `12h` | Auth session lifetime |
| `AUTH_COOKIE_NAME` | `veldr_auth` | HttpOnly auth cookie name |
| `AUTH_COOKIE_MAX_AGE_MS` | `43200000` | Auth cookie lifetime in milliseconds |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed frontend origin |
| `CMS_DATA_DIR` | `public/data/cms` | JSON data directory for the CMS module |
| `CMS_DB_FILE` | `db.json` | CMS JSON database filename |
| `CMS_UPLOAD_DIR` | `public/uploads/cms` | CMS upload directory |

Frontend:

| Variable | Default | Description |
| --- | --- | --- |
| `VITE_FRONTEND_PORT` | `5173` | Vite dev server port |
| `VITE_API_BASE_URL` | `http://localhost:5000/api` | API base URL |
| `VITE_UPLOAD_BASE_URL` | `http://localhost:5000/uploads` | Upload file base URL |
| `VITE_TINYMCE_API_KEY` | empty | Optional TinyMCE Cloud API key |

CMS frontend:

| Variable | Default | Description |
| --- | --- | --- |
| `VITE_CMS_FRONTEND_PORT` | `5174` | CMS Vite dev server port |
| `VITE_BACKEND_BASE_URL` | `http://localhost:5000` | Dev proxy target for the unified backend |
| `VITE_CMS_API_BASE` | `/api/cms` | Runtime CMS API base used by `public/config.js` |
| `VITE_CMS_UPLOAD_BASE` | `/uploads/cms` | Runtime CMS upload base used by `public/config.js` |

## Production Configuration

Before running Veldr in production:

- Use Node 20 LTS. The repository includes `.nvmrc`.
- Set `NODE_ENV=production`.
- Set a strong random `JWT_SECRET`; the backend refuses to start in production without it.
- Set `CORS_ORIGIN` to the exact frontend origin, for example `https://notes.example.com`.
- Set `VITE_API_BASE_URL` and `VITE_UPLOAD_BASE_URL` to the public backend URLs used by the deployed frontend.
- For `cms-frontend`, keep same-origin proxying for `/api/cms` and `/uploads/cms`, or replace `public/config.js` during deployment with the public unified backend URLs.
- Keep `backend/public/data/`, `backend/public/uploads/`, and `backend/temp/` writable by the backend process.
- Serve the frontend and backend over HTTPS so the auth cookie can use `secure: true`.
- For a separate CMS frontend, proxy its `/api/cms/*` and `/uploads/cms/*` requests to this backend.

Example production backend environment:

```env
NODE_ENV=production
PORT=5000
CORS_ORIGIN=https://notes.example.com
JWT_SECRET=replace-with-at-least-32-random-bytes
JWT_EXPIRES_IN=12h
AUTH_COOKIE_NAME=veldr_auth
DB_STORAGE=public/data/cms.sqlite
SECURITY_DB_STORAGE=public/data/security.sqlite
CMS_DATA_DIR=public/data/cms
CMS_UPLOAD_DIR=public/uploads/cms
```

## Unified Backend Namespaces

One deployed backend can serve both Veldr and the lightweight CMS:

```text
Veldr API:  /api/articles, /api/password, /api/upload
CMS API:    /api/cms/notes, /api/cms/menus, /api/cms/auth, /api/cms/upload
Veldr media: /uploads/*
CMS media:   /uploads/cms/*
```

Veldr data remains in SQLite. CMS data remains JSON-based for simple migration from `cms` or legacy `github-cms`; copy `data/db.json` into the configured `CMS_DATA_DIR` to reuse existing notes.

The checked-in `cms-frontend` is based on the standalone NoteFlow CMS UI. It keeps the original knowledge-base strengths: searchable note cards, category/tag filters, favorites, Markdown preview, image insertion, editable top menus, keyboard shortcuts, and detail-page table of contents. Its backend calls are adapted to the unified Veldr namespace.

## Password Notes

Do not commit real local passwords. Runtime password data is stored in:

```text
backend/public/data/security.sqlite
```

The checked-in README documents how the password system works, but not any private local password currently in use.

Passwords are stored as bcrypt hashes. The backend sets an HttpOnly JWT cookie after password verification; protected write APIs require that cookie.

The CMS editor password is the same six-digit password used by the Veldr admin flow. CMS does not keep a separate editor secret. A successful `POST /api/cms/auth` also issues the same HttpOnly cookie session, so the CMS frontend no longer stores the plain key in localStorage; `POST /api/cms/logout` clears the session.

CMS notes tagged `private` (case-insensitive) are only visible in editor mode: the backend filters them out of `GET /api/cms/notes` and returns 404 from `GET /api/cms/notes/:id` for viewer-role requests.

## Data And Cleanup

Runtime files are intentionally ignored by Git:

- `backend/public/data/*.sqlite`
- `backend/public/uploads/`
- `backend/public/backups/`
- `backend/temp/`

To preview unused image cleanup:

```bash
cd backend
node scripts/cleanup-unused-images.js
```

To delete unused images with a backup:

```bash
cd backend
node scripts/cleanup-unused-images.js --delete
```

CMS uploads that have not been referenced by a note for at least 24 hours can be cleaned with:

```bash
cd backend
node scripts/cleanup-cms-uploads.js
```

To install the production daily cleanup timer, opt in explicitly during backend deployment. Normal backend deployments do not add, change, or reload this timer.

```powershell
.\scripts\deploy-backend.ps1 -Deploy -SshKey C:\Users\indep\.ssh\id_ed25519 -DeployCmsCleanupTimer
```

The timer runs daily at 03:20 with up to 15 minutes of randomized delay. Check it with `systemctl status veldr-cms-upload-cleanup.timer` or inspect runs with `journalctl -u veldr-cms-upload-cleanup.service`.

## Verification

Useful checks before pushing:

```bash
cd backend
npm test
npm run build

cd ../frontend
npm run build

cd ../cms-frontend
npm run build
```

## Git Remote

```text
origin: https://github.com/lieshy521-9577/veldr.git
```
