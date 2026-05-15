# Backend: Node + TeX Live para compilação LaTeX
FROM node:20-bookworm-slim

# Dependências do sistema: TeX Live (mínimo + pacotes usados pelo template)
# - texlive-latex-base: classes/básicos
# - texlive-latex-recommended: babel, hyperref, geometry, graphicx, float, booktabs
# - texlive-fonts-recommended: mathptmx (Times)
# - texlive-latex-extra: background, titlesec, enumitem
# - texlive-lang-portuguese: hifenização e brazil
# - latexmk: compilador conveniente
RUN apt-get update && apt-get install -y --no-install-recommends \
    texlive-latex-base \
    texlive-latex-recommended \
    texlive-fonts-recommended \
    texlive-latex-extra \
    texlive-lang-portuguese \
    latexmk \
    ghostscript \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

CMD ["node", "src/server.js"]
