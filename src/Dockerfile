FROM node:20-slim

WORKDIR /app

# pnpmのインストール
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# package.jsonのみをコピー
COPY ../package.json ./

# --no-frozen-lockfileオプションを使用してインストール
RUN pnpm install --no-frozen-lockfile

COPY . .

EXPOSE 5173

CMD ["pnpm", "dev", "--host"] 