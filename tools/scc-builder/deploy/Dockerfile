# ════════════════════════════════════════════════════════════════════════
#  SCC Builder — imagem única: editor (dist/) + API PHP + pipeline Node.
#
#  Build (a partir de tools/scc-builder/):
#    docker build -f deploy/Dockerfile -t scc-builder .
#
#  A mesma imagem roda a API (padrão) e o worker da fila:
#    docker run ... scc-builder                              # Apache + API
#    docker run ... scc-builder php bin/worker.php --sleep=2 # worker
#
#  Segredos e destino só por variável de ambiente (SCC_BUILDER_*); a
#  imagem não carrega config.local.php. Veja deploy/README.md.
# ════════════════════════════════════════════════════════════════════════

# ── 1. Build do editor e dependências do pipeline ───────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Em produção o editor fica na raiz do domínio
RUN VITE_BASE_PATH=/ VITE_API_BASE_URL=/api npm run build \
 && npm prune --omit=dev

# ── 2. Runtime: Apache + PHP 8.3 + Node (o pipeline roda em Node) ──────
FROM php:8.3-apache-bookworm

COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node

RUN a2enmod rewrite headers expires deflate setenvif \
 && { \
      echo 'upload_max_filesize=512M'; \
      echo 'post_max_size=512M'; \
      echo 'memory_limit=512M'; \
      echo 'max_execution_time=300'; \
      echo 'display_errors=0'; \
    } > /usr/local/etc/php/conf.d/scc-builder.ini

WORKDIR /var/www/scc-builder
COPY --from=build --chown=www-data:www-data /app /var/www/scc-builder
COPY deploy/apache-scc-builder.conf /etc/apache2/sites-available/000-default.conf

# Storage fora do webroot; monte um volume aqui.
ENV SCC_BUILDER_STORAGE_DIR=/var/lib/scc-builder \
    SCC_BUILDER_NODE_BIN=/usr/local/bin/node
RUN mkdir -p /var/lib/scc-builder && chown www-data:www-data /var/lib/scc-builder
VOLUME /var/lib/scc-builder

EXPOSE 80
