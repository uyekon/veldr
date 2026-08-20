# Veldr Production Deployment

This deployment layout uses one Node backend and two independent frontend sites.

## Domains

```text
notes.lifetip.top -> /var/www/veldr/dist
cms.lifetip.top   -> /var/www/veldr-cms/dist
backend API       -> 127.0.0.1:5000
```

## Backend

Create a production env file before the first backend deployment:

```powershell
Copy-Item .\deploy\env\backend.env.prod.example .\backend\.env.prod
```

Edit `backend\.env.prod` and set strong production values, especially:

```text
JWT_SECRET
ADMIN_USERNAME
DEFAULT_PASSWORD
```

`DEFAULT_PASSWORD` may be the existing six-digit password during migration, but the first password change must use 8-128 characters. Set `JWT_EXPIRES_IN=60d` and `AUTH_COOKIE_MAX_AGE_MS=5184000000` for the long-lived administrator session.

Deploy backend:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-backend.ps1 -Deploy -UploadEnv -SshKey "C:\Users\indep\.ssh\id_ed25519"
```

After the first deployment, you can deploy code only and keep the remote `.env`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-backend.ps1 -Deploy -SshKey "C:\Users\indep\.ssh\id_ed25519"
```

Check service logs:

```bash
sudo systemctl status veldr-backend
sudo journalctl -u veldr-backend -f
```

## Frontends

Deploy both frontends:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-frontends.ps1 -Deploy -SshKey "C:\Users\indep\.ssh\id_ed25519"
```

## Nginx

Deploy the Veldr HTTP nginx config with:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-nginx.ps1 -SshKey "C:\Users\indep\.ssh\id_ed25519"
```

The shared 443 SNI map also routes `nav`, `gotify`, `igotify`, and `ws`; it is not touched by normal Veldr releases. Only use `-ReplaceSharedStream` after updating the complete shared map in `deploy/nginx/veldr-stream.conf` and intentionally reviewing every mapped service.

Config files:

```text
deploy/nginx/veldr-frontends.conf  -> /etc/nginx/conf.d/veldr-frontends.conf
deploy/nginx/veldr-stream.conf     -> /etc/nginx/stream-conf.d/veldr-sni.conf
```

## HTTPS / port 443 architecture

Port 443 is shared with the sing-box proxy via nginx stream SNI routing:

```text
:443 (nginx stream, ssl_preread)
  ├─ SNI notes.lifetip.top / cms.lifetip.top -> 127.0.0.1:8501 (nginx https, Let's Encrypt)
  └─ any other SNI (ws.lifetip.top proxy)    -> 127.0.0.1:8500 (sing-box vless-ws-tls-in)
```

- The stream include lives at the bottom of `/etc/nginx/nginx.conf` (`stream { include /etc/nginx/stream-conf.d/*.conf; }`), module `libnginx-mod-stream`.
- sing-box's former `:443` inbound was moved to `127.0.0.1:8500` (backup at `/etc/sing-box/config.json.bak-before-sni`); proxy clients still connect to `ws.lifetip.top:443` unchanged.
- Certificates: one cert covers notes+cms (`/etc/letsencrypt/live/notes.lifetip.top/`), issued by `scripts/setup-https.ps1`. Renewal is automatic via `certbot.timer` (HTTP-01 on port 80); `certbot renew --dry-run` verified.
- Because HTTPS is live, the backend env sets `AUTH_COOKIE_SECURE=true`.
- Note: the http layer sees client IP 127.0.0.1 (stream hop); per-IP rate limiting is therefore global.
