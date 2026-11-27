# The Mexican Train solver as a static site, for Dokploy
# (deploy/docker-compose.yml; the owner's guide: docs/DEPLOY_DOKPLOY.md).
#
# Build context: the repository root. There is no build step: the page, its
# styles, scripts and the example photo are copied in as they are.
FROM nginx:1.27-alpine

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/
COPY css /usr/share/nginx/html/css
COPY js /usr/share/nginx/html/js
COPY examples /usr/share/nginx/html/examples

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
