const express = require("express")
const cors = require("cors")
const { SkyWayAuthToken, uuidV4, nowInSec } = require("@skyway-sdk/token")

const app = express()
const port = 3001
require("dotenv").config()

// 環境変数または直接指定
const API_KEY = process.env.SKYWAY_API_KEY // SkyWay APIキー
const SECRET_KEY = process.env.SKYWAY_SECRET_KEY // シークレットキー

app.use(cors()) // クライアントからのリクエストを許可

// トークン生成エンドポイント
app.get("/generate-token", (req, res) => {
  try {
    const token = new SkyWayAuthToken({
      jti: uuidV4(),
      iat: nowInSec(),
      exp: nowInSec() + 60 * 60 * 24,
      scope: {
        app: {
          id: API_KEY,
          turn: true,
          actions: ["read", "write", "manage", "create"],
          channels: [
            {
              id: "test", // 任意のチャンネルアクセスを許可
              name: "test",
              actions: ["read", "write", "manage", "create"],
              members: [
                {
                  id: "*",
                  name: "*",
                  actions: ["write", "read", "manage", "create"],
                  publication: {
                    actions: ["write", "read", "manage", "create"]
                  },
                  subscription: {
                    actions: ["write", "read", "manage", "create"]
                  }
                }
              ],
              sfuBots: [
                {
                  actions: ["write", "read", "manage", "create"],
                  forwardings: [
                    {
                      actions: ["write", "read", "manage", "create"]
                    }
                  ]
                }
              ]
            }
          ]
        }
      }
    })

    const encodedToken = token.encode(SECRET_KEY)
    res.json({ token: encodedToken })
  } catch (error) {
    console.error("Error generating token:", error)
    res.status(500).json({ error: "Failed to generate token" })
  }
})

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
})

// 仮の認証ミドルウェア（例: JWT認証を利用）
// function authenticateUser(req, res, next) {
//     const authHeader = req.headers.authorization;

//     if (!authHeader) {
//         return res.status(401).json({ error: 'Unauthorized' });
//     }

//     const token = authHeader.split(' ')[1];
//     try {
//         const user = verifyJwtToken(token); // JWTを検証してユーザー情報を取得
//         req.user = user;
//         next();
//     } catch (err) {
//         res.status(401).json({ error: 'Invalid token' });
//     }
// }
