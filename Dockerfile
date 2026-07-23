# syntax=docker/dockerfile:1

# ─── Etape 1 : dependances de production uniquement ───
# argon2 est un module natif : il se compile a l'installation, d'ou les
# outils de build ici. Ils ne sont PAS embarques dans l'image finale.
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ─── Etape 2 : image finale ───
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# On ne tourne pas en root. L'image node fournit deja un utilisateur `node`
# non privilegie : autant s'en servir plutot que d'en creer un.
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node migrations ./migrations

USER node
EXPOSE 3000

# Le serveur ecoute deja sur 0.0.0.0 et expose /health : la sonde interroge
# ce point, elle ne se contente pas de verifier que le processus vit.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Les migrations ne sont PAS lancees ici. Un conteneur qui migre au demarrage
# fait tourner le schema autant de fois qu'il y a de replicas, et rejoue tout
# a chaque redemarrage. On les declenche explicitement :
#   docker compose run --rm api npm run migrate
CMD ["node", "src/server.js"]
