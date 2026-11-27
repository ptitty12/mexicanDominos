# Deploying with Dokploy

How to put the site on your VPS at `dominos.ptaylor.dev` using only Dokploy's
web pages, the same way as your other apps. No SSH, no commands, nothing to
configure afterwards: the site is static files behind nginx, with no data and
no settings.

Technical details are in `deploy/docker-compose.yml`, `deploy/Dockerfile` and
`deploy/nginx.conf`.

## Before you start

In your DNS provider's panel, give `dominos.ptaylor.dev` an **A record**
pointing to the VPS's public IP address — the same address `mvp.ptaylor.dev`
points to. If you use Cloudflare, set that record to **DNS only** (grey
cloud). Skip this if `*.ptaylor.dev` already points at the VPS.

## 1. Create the app

1. In Dokploy, open a project, then **Create Service → Compose**. Name it
   `dominos`, keep the type **Docker Compose**, and create it.
2. Open the **General** tab and choose the **Git** provider:
   - Repository URL: `https://github.com/ptitty12/mexicanDominos.git`
   - Branch: `main`
   - Compose Path: `./deploy/docker-compose.yml`

   Click **Save**.

## 2. Domain

Open the **Domains** tab and click **Add Domain**:

| Field | Value |
|---|---|
| Service Name | `dominos` |
| Host | `dominos.ptaylor.dev` |
| Path | `/` |
| Container Port | `8080` |
| HTTPS | on |
| Certificate | Let's Encrypt |

Click **Create**.

## 3. Deploy

On the **General** tab, click **Deploy**. The build takes well under a minute.
When the **Deployments** log ends without errors, open
`https://dominos.ptaylor.dev`. The first visit can take a few seconds while
the certificate is issued.

## Updating

After new commits reach `main`, click **Deploy** again (or turn on
**Autodeploy** on the General tab to have Dokploy do it on every push).
Browsers pick up the new version on their next visit.

## Trying the image on your own computer

```sh
docker compose -f deploy/docker-compose.yml build
docker run --rm -p 8080:8080 deploy-dominos
```

Then open http://localhost:8080.
