FROM node:20-slim

WORKDIR /app

# pnpmのインストール
RUN corepack enable && corepack prepare pnpm@latest --activate

# package.jsonのみをコピー
COPY package.json ./

# --no-frozen-lockfileオプションを使用してインストール
RUN pnpm install --no-frozen-lockfile

COPY . .

EXPOSE 3001

CMD ["pnpm", "dev"] 