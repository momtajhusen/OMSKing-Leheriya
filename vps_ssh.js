==========================================================
OMSKING — VPS COMMANDS (step by step)
==========================================================

====================================
1) SERVER LOGIN
====================================

ssh root@148.230.67.252

Password:
4546@#Bijaysharma

====================================
2) PROJECT FACTS
====================================

Domain:     https://omskingapi.codersalpha.com
Admin:      https://omsking.codersalpha.com   (Hostinger)
VPS path:   /home/ubuntu/Momtaj_Projects/omskingleheriya_backend
Backend:    apps/backend/src/server.js
.env path:  /home/ubuntu/Momtaj_Projects/omskingleheriya_backend/.env
PM2 name:   omsking-backend
Port:       5005
Nginx:      proxy_pass http://127.0.0.1:5005;
Pkg:        pnpm   (npm mat use karo)
GitHub:     https://github.com/momtajhusen/OMSKing-Leheriya.git
Mobile:     none in this monorepo (admin + backend only)
API prefix: /api/v1

====================================
3) PROJECT DIRECTORY
====================================

cd /home/ubuntu/Momtaj_Projects/omskingleheriya_backend

pwd
ls -la
ls -la apps/backend

====================================
4) PM2 (APP MANAGEMENT)
====================================

pm2 status

pm2 describe omsking-backend | grep -E 'cwd|script path|status|PORT|env'

pm2 logs omsking-backend --lines 100

pm2 monit

pm2 restart omsking-backend --update-env

pm2 reload omsking-backend

pm2 stop omsking-backend

# First-time start (from repo root — adjust if ecosystem exists)
pm2 start apps/backend/src/server.js --name omsking-backend --cwd /home/ubuntu/Momtaj_Projects/omskingleheriya_backend

pm2 delete omsking-backend

pm2 flush

pm2 save

pm2 startup

====================================
5) GIT DEPLOYMENT
====================================

git branch
git status
git log -1
git log --oneline -5

git pull origin main

# Full deployment (one shot) — USE pnpm
cd /home/ubuntu/Momtaj_Projects/omskingleheriya_backend
git pull origin main
pnpm install
pm2 restart omsking-backend --update-env
pm2 save

# One line
git pull origin main && pnpm install && pm2 restart omsking-backend --update-env && pm2 save

====================================
6) NODE / PNPM
====================================

node -v
pnpm -v

pnpm install

# If nodemailer / package missing after pull:
pnpm --filter @omsking/backend add nodemailer
pnpm --filter @omsking/backend install

====================================
7) ENV FILE
====================================

# Repo-root .env (not only apps/backend)
cat .env
nano .env
# Save: CTRL+O | Exit: CTRL+X

# Required (example):
# PORT=5005
# MONGODB_URI=mongodb://omsking:PASSWORD@127.0.0.1:27017/omsking?authSource=omsking
# CORS_ORIGIN=http://localhost:5173,https://omsking.codersalpha.com
# JWT_SECRET=...

# After .env change ALWAYS:
pm2 restart omsking-backend --update-env
pm2 save

====================================
8) BACKEND HEALTH
====================================

curl -s http://127.0.0.1:5005/
curl -s http://127.0.0.1:5005/api/v1
curl -sk https://omskingapi.codersalpha.com/api/v1

# Expect: "status":"running" and "mongo":"connected"

# Login smoke (admin):
# curl -s -X POST http://127.0.0.1:5005/api/v1/auth/login \
#   -H 'Content-Type: application/json' \
#   -d '{"email":"...","password":"..."}'

====================================
9) PORT CHECK
====================================

sudo ss -tulpn | grep :80
sudo ss -tulpn | grep :443
sudo ss -tulpn | grep :5005

====================================
10) NGINX
====================================

sudo systemctl status nginx
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl restart nginx

grep -n "server_name\|proxy_pass\|listen" /etc/nginx/sites-available/omskingapi
grep -n "server_name\|proxy_pass\|listen" /etc/nginx/sites-enabled/*omsking* 2>/dev/null

# Must be: proxy_pass http://127.0.0.1:5005;
# Wrong port → 502

====================================
11) SSL CERTIFICATE
====================================

sudo certbot certificates
sudo certbot renew
sudo certbot renew --dry-run

sudo certbot --nginx -d omskingapi.codersalpha.com

sudo systemctl status certbot.timer
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer

openssl s_client -connect omskingapi.codersalpha.com:443 -servername omskingapi.codersalpha.com </dev/null 2>/dev/null | openssl x509 -noout -dates -subject

====================================
12) MONGODB (local on VPS)
====================================

sudo systemctl status mongod
sudo systemctl start mongod

# Shell (adjust user/db if needed)
mongosh
# use omsking
# db.auth("omsking", "YOUR_PASSWORD")
# db.stats()

# URI special chars in password must be URL-encoded
# e.g. ! → %21

====================================
13) SERVER / FIREWALL
====================================

date
timedatectl status
df -h
free -h
uptime
sudo ufw status

====================================
14) PROJECT-ONLY COMMANDS (OMSKing)
====================================

# Seed (from repo root or backend package)
cd /home/ubuntu/Momtaj_Projects/omskingleheriya_backend
pnpm --filter @omsking/backend run seed
# or:
cd apps/backend && node src/seeds/phase2.js

# CORS check (live admin must be listed)
grep CORS_ORIGIN .env

# Describe running process + env
pm2 show omsking-backend

====================================
15) QUICK DEPLOY (LIVE)
====================================

# Full guide: VPS_DEPLOY.md

cd /home/ubuntu/Momtaj_Projects/omskingleheriya_backend
git pull origin main
pnpm install
pm2 restart omsking-backend --update-env
pm2 save
pm2 logs omsking-backend --lines 50 --nostream

curl -s http://127.0.0.1:5005/
curl -s http://127.0.0.1:5005/api/v1
curl -sk https://omskingapi.codersalpha.com/api/v1

# Notes:
# - Always pnpm (not npm)
# - Port 5005 everywhere (PM2 + nginx)
# - CORS_ORIGIN must include https://omsking.codersalpha.com

====================================
16) ADMIN PANEL (your Mac — Hostinger)
====================================

cd apps/admin
pnpm install
pnpm run build
# Uses .env.production → https://omskingapi.codersalpha.com/api/v1
# Upload apps/admin/dist/ → Hostinger site for omsking.codersalpha.com

====================================
17) BROWSER URLS
====================================

https://omskingapi.codersalpha.com
https://omskingapi.codersalpha.com/api/v1
https://omsking.codersalpha.com

==========================================================
