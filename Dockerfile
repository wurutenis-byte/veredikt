FROM alpine:3.19

# Instalar dependencias
RUN apk add --no-cache ca-certificates wget unzip nodejs npm

# Versión de PocketBase
ARG PB_VERSION=0.22.14

# Descargar PocketBase
RUN wget -q https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip \
    && unzip pocketbase_${PB_VERSION}_linux_amd64.zip -d /pb \
    && rm pocketbase_${PB_VERSION}_linux_amd64.zip \
    && chmod +x /pb/pocketbase

# Crear directorios
RUN mkdir -p /pb/pb_public /pb/pb_hooks /pb/pb_migrations /pb/pb_data

# Copiar frontend al directorio público de PocketBase
COPY index.html      /pb/pb_public/
COPY css/            /pb/pb_public/css/
COPY js/             /pb/pb_public/js/

# Copiar hooks (recálculo automático de votos/ratings)
COPY pocketbase/pb_hooks/ /pb/pb_hooks/

# Copiar seed script
COPY seed_categories.js /pb/seed_categories.js
COPY package.json       /pb/package.json

# Puerto que expone Railway
EXPOSE 8090

# Arrancar PocketBase
# --http binds al puerto que Railway asigna (usa PORT si está definido)
CMD ["/bin/sh", "-c", "/pb/pocketbase serve --http=0.0.0.0:${PORT:-8090} --dir=/pb/pb_data --publicDir=/pb/pb_public --hooksDir=/pb/pb_hooks --migrationsDir=/pb/pb_migrations"]
