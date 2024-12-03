import express, { Request, Response } from "express"
import cors from "cors"
import { SkyWayAuthToken, uuidV4, nowInSec } from "@skyway-sdk/token"
import dotenv from "dotenv"

const app = express()
const port = process.env.PORT || 3001
dotenv.config()

// 環境変数の型定義
type SkyWayApiKey = string & { readonly __brand: "SkyWayApiKey" }
type SkyWaySecretKey = string & { readonly __brand: "SkyWaySecretKey" }

// 環境変数または直接指定
const API_KEY = process.env.SKYWAY_API_KEY as SkyWayApiKey // SkyWay APIキー
const SECRET_KEY = process.env.SKYWAY_SECRET_KEY as SkyWaySecretKey // シークレットキー

app.use(cors()) // クライアントからのリクエストを許可

// トークン生成エンドポイント
app.get("/generate-token", (req: Request, res: Response) => {
  try {
    const token = new SkyWayAuthToken({
      jti: uuidV4(),
      iat: nowInSec(),
      exp: nowInSec() + 60 * 60 * 24,
      scope: {
        app: {
          id: API_KEY,
          turn: true,
          actions: ["read", "write"],
          channels: [
            {
              id: "*",
              name: "*",
              actions: ["read", "write", "create", "delete", "updateMetadata"],
              members: [
                {
                  id: "*",
                  name: "*",
                  actions: [
                    "write",
                    "create",
                    "delete",
                    "signal",
                    "updateMetadata"
                  ],
                  publication: {
                    actions: [
                      "write",
                      "create",
                      "delete",
                      "updateMetadata",
                      "enable",
                      "disable"
                    ]
                  },
                  subscription: {
                    actions: ["write", "create", "delete"]
                  }
                }
              ],
              sfuBots: [
                {
                  actions: ["write", "create", "delete"],
                  forwardings: [
                    {
                      actions: ["write", "create", "delete"]
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
