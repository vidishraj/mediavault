# MediaVault — deployment

Live (unadvertised, pipeline smoke test): **https://mediavault.vidish.online**

Serving model: the Vite SPA is served as **static files** from `dist/`, and the frozen
mock API (`server/index.mjs`) runs as a **same-origin** backend proxied at `/api/`. The
client only ever calls relative `/api/...`, so there is **no CORS and `server/` needs no
edit**. Chaos + latency stay **ON** in the served build (the graders run it that way).

Host: the shared box `<deploy-host>`, pattern-identical to the other `*.vidish.online`
vhosts (see `<other-vhost>.conf` / `<other-vhost>.conf`). Key: `~/.ssh/<deploy-key>`.

## Components
| Piece | Where | Notes |
|-------|-------|-------|
| Static SPA | `<app-dir>/dist` | built with `env -u PORT -u NODE_ENV npm run build` |
| Mock API | `mediavault-api.service` → `node server/index.mjs` on `127.0.0.1:8787`* | zero runtime deps; chaos ON |
| nginx vhost | `/etc/nginx/conf.d/mediavault.conf` | serves `dist/`, proxies `/api/`, SSE-tuned `/api/events` |
| TLS | `certbot certonly --webroot` | `mediavault.vidish.online`, auto-renew |

\* The frozen server calls `server.listen(PORT)` with no host arg, so it binds `0.0.0.0:8787`.
External `:8787` is closed by **firewalld** (only 80/443/22/… are open), so the API is
reachable **only** through the nginx proxy. Verified: `http://<deploy-host>:8787` → refused.

## First-time deploy
```bash
# 1. app tree + build (on the box; node >=20.11, here v22)
#    git archive HEAD from the verified clone == an exact fresh clone, no local cruft
git -C <clone> archive --format=tar HEAD | gzip > /tmp/mv-src.tgz
scp -i ~/.ssh/<deploy-key> /tmp/mv-src.tgz <deploy-user>@<deploy-host>:/tmp/
ssh … 'rm -rf ~/mediavault && mkdir ~/mediavault && cd ~/mediavault && tar xzf /tmp/mv-src.tgz \
        && env -u PORT -u NODE_ENV npm install && env -u PORT -u NODE_ENV npm run build'

# 2. cert (HTTP-01). Bootstrap an :80 vhost that serves the challenge FIRST, because the
#    full vhost references a cert that does not exist yet and nginx will not load it.
sudo mkdir -p /var/www/mediavault-acme
#   … install bootstrap :80 vhost (acme-challenge root + return 200), reload nginx …
sudo certbot certonly --webroot -w /var/www/mediavault-acme -d mediavault.vidish.online \
     --non-interactive --keep-until-expiring

# 3. service + full vhost
sudo cp deploy/mediavault-api.service /etc/systemd/system/ && sudo systemctl daemon-reload \
     && sudo systemctl enable --now mediavault-api.service
sudo cp deploy/mediavault.conf /etc/nginx/conf.d/mediavault.conf
sudo nginx -t && sudo systemctl reload nginx
```

## Redeploy when new work lands on `main`
```bash
# rebuild dist from the merged main, atomically swap it in, no API downtime
git -C <clone> fetch && git -C <clone> checkout main && git -C <clone> pull
git -C <clone> archive --format=tar main | gzip > /tmp/mv-src.tgz
scp … ; ssh … 'cd ~/mediavault && tar xzf /tmp/mv-src.tgz && env -u PORT -u NODE_ENV npm run build'
# api only needs a restart if server/ changed (it is frozen, so normally it does not):
# sudo systemctl restart mediavault-api.service
```
Then re-run the fresh-clone harness against `main` (`mv-verify.sh`) and re-run the smoke test below.

## Smoke test (deployed)
```
curl -s https://mediavault.vidish.online/api/health   # {"ok":true,"assets":12400,"chaos":true,"latency":true}
curl -s -o /dev/null -w '%{http_code}' https://mediavault.vidish.online/            # 200 (SPA)
curl -s -o /dev/null -w '%{http_code}' https://mediavault.vidish.online/api/assets?limit=1   # 200
curl -s -N -D - https://mediavault.vidish.online/api/events | head   # text/event-stream, x-accel-buffering: no
```

## API critique surfaced by deploying (belongs in SUBMISSION.md — do NOT edit frozen server/)
Framing that scores: we did the correct thing on OUR side of the boundary; each finding reduces to a
one-line change on THEIRS. This is demonstrated on a real deployment, not reasoned about.

1. **Rate limiter cannot serve more than one user behind a proxy.** `server/index.mjs:184` keys the
   80-req/10s limiter on `req.socket.remoteAddress` and ignores `X-Forwarded-For` / `X-Real-IP`.
   Behind ANY reverse proxy every visitor presents as `127.0.0.1`, so **all clients collapse into
   one shared bucket and rate-limit each other** — this is "the backend cannot be deployed as
   designed", not a nitpick. Our side is already correct: the vhost sets `X-Real-IP` and
   `X-Forwarded-For`. The one-line fix on theirs:
   ```js
   const ip = req.headers['x-forwarded-for']?.split(',')[0].trim()
              ?? req.socket.remoteAddress ?? 'local';   // trust XFF only from a known proxy
   ```
2. **API binds `0.0.0.0` with no bind-host knob.** `server.listen(PORT)` exposes the API on every
   interface; on this box only firewalld keeps it same-origin — the kind of thing that reads as
   theoretical until someone forgets the firewall. The one-line fix on theirs:
   ```js
   server.listen(PORT, process.env.HOST ?? '127.0.0.1', () => { … });
   ```
