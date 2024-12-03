import { nowInSec, SkyWayAuthToken, uuidV4 } from "@skyway-sdk/room"

export const token = new SkyWayAuthToken({
  jti: uuidV4(),
  iat: nowInSec(),
  exp: nowInSec() + 60 * 60 * 24,
  scope: {
    app: {
      id: import.meta.env.VITE_SKYWAY_API_KEY,
      turn: true,
      actions: ["read"],
      channels: [
        {
          id: "*",
          name: "*",
          actions: ["write"],
          members: [
            {
              id: "*",
              name: "*",
              actions: ["write"],
              publication: {
                actions: ["write"]
              },
              subscription: {
                actions: ["write"]
              }
            }
          ],
          sfuBots: [
            {
              actions: ["write"],
              forwardings: [
                {
                  actions: ["write"]
                }
              ]
            }
          ]
        }
      ]
    }
  }
}).encode(import.meta.env.VITE_SKYWAY_SECRET_KEY)
