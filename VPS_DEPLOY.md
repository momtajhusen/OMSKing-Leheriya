# OMSKing API — VPS Deploy

| Item | Value |
|------|--------|
| Domain | https://omskingapi.codersalpha.com |
| VPS path | `/home/ubuntu/Momtaj_Projects/omskingleheriya_backend` |
| Backend script | `apps/backend/src/server.js` |
| PM2 name | `omsking-backend` |
| Port (PM2 / production) | `5005` |
| Nginx `proxy_pass` | `http://127.0.0.1:5005` |
| Package manager | **`pnpm`** (npm mat use karo) |
| GitHub | https://github.com/momtajhusen/OMSKing-Leheriya.git |

## Deploy (one shot)

```bash
cd /home/ubuntu/Momtaj_Projects/omskingleheriya_backend
git pull origin main
pnpm install
pm2 restart omsking-backend --update-env
pm2 save
curl -s http://127.0.0.1:5005/
curl -s http://127.0.0.1:5005/api/v1
curl -sk https://omskingapi.codersalpha.com/api/v1
```

Expect: `"status":"running"` and `"mongo":"connected"`

## First-time / broken node_modules

```bash
cd /home/ubuntu/Momtaj_Projects/omskingleheriya_backend
pnpm install
# if nodemailer missing:
pnpm --filter @omsking/backend add nodemailer
pm2 restart omsking-backend --update-env
```

## Nginx must match PM2 port

`ecosystem.config.js` sets `PORT: 5005`. Nginx:

```nginx
proxy_pass http://127.0.0.1:5005;
```

```bash
grep proxy_pass /etc/nginx/sites-available/omskingapi
sudo nginx -t && sudo systemctl reload nginx
```

## Useful

```bash
pm2 describe omsking-backend | grep -E 'cwd|script path'
pm2 logs omsking-backend --lines 40 --nostream
ss -tlnp | grep 5005
```

## Notes

- Path is `omskingleheriya_backend` — **not** `OMSKing`.
- Root se `pnpm install` — `apps/backend` mein `npm install` mat chalao.
- `--prod` skip mat karo pehli baar; full `pnpm install` safer.
- DNS A = `148.230.67.252`; Hostinger Website/AAAA hatao.
