import { VideoChat } from "./presentation/VideoChat"
import { Stream } from "./domain/entities/Stream"
import { TempleElement } from "./infrastructure/TempleElement"

window.addEventListener("load", async () => {
  try {
    // Streamインスタンスの作成と初期化
    const stream = new Stream()
    await stream.initialize() // メディアストリームの初期化

    const templeElement = new TempleElement()
    const connectivityContainer = document.getElementById("connectivity-test-results")
    const videoChat = new VideoChat(stream, templeElement, connectivityContainer)

    // 初期化
    await videoChat.initialize()
    // イベントリスナーの設定
    const joinButton = document.getElementById("join") as HTMLButtonElement
    joinButton?.addEventListener(
      "click",
      async () => {
        try {
          console.log("Joining room...")
          await videoChat.joinRoom()
          console.log("Successfully joined room")

          // 参加成功後にメッセージフォームを有効化
          const messageForm = document.getElementById(
            "message-form"
          ) as HTMLFormElement
          const messageInput = document.getElementById(
            "message-input"
          ) as HTMLInputElement
          if (messageForm && messageInput) {
            messageInput.disabled = false
            messageForm.disabled = false
          }
        } catch (error) {
          console.error("Failed to join room:", error)
          alert("ルームへの参加に失敗しました")
        }
      },
      false
    )

    const leaveButton = document.getElementById("leave") as HTMLButtonElement
    leaveButton?.addEventListener(
      "click",
      async () => {
        try {
          console.log("Leaving room...")
          await videoChat.leaveRoom()
          console.log("Successfully left room")

          // 退室後にメッセージフォームを無効化
          const messageForm = document.getElementById(
            "message-form"
          ) as HTMLFormElement
          const messageInput = document.getElementById(
            "message-input"
          ) as HTMLInputElement
          if (messageForm && messageInput) {
            messageInput.disabled = true
            messageForm.disabled = true
          }
        } catch (error) {
          console.error("Failed to leave room:", error)
          alert("ルームからの退室に失敗しました")
        }
      },
      false
    )

    // メッセージ送信のイベントリスナー設定
    const messageForm = document.getElementById(
      "message-form"
    ) as HTMLFormElement
    const messageInput = document.getElementById(
      "message-input"
    ) as HTMLInputElement

    // 初期状態ではメッセージフォームを無効化
    if (messageForm && messageInput) {
      messageInput.disabled = true
      messageForm.disabled = true
    }

    messageForm?.addEventListener("submit", async e => {
      e.preventDefault()
      console.log("Message form submitted")

      const message = messageInput.value.trim()
      if (!message) {
        console.log("Empty message, skipping")
        return
      }

      try {
        console.log("Sending message:", message)
        await videoChat.sendMessage(message)
        console.log("Message sent successfully")
        messageInput.value = ""
      } catch (error) {
        console.error("メッセージ送信エラー:", error)
        alert("メッセージの送信に失敗しました")
      }
    })

    // ページアンロード時のクリーンアップ
    window.addEventListener("beforeunload", async () => {
      console.log("Cleaning up...")
      await stream.release()
      console.log("Cleanup completed")
    })

    // 接続テストボタンのイベントリスナー
    const startTestButton = document.getElementById(
      "start-test"
    ) as HTMLButtonElement
    const stopTestButton = document.getElementById(
      "stop-test"
    ) as HTMLButtonElement

    startTestButton?.addEventListener("click", async () => {
      try {
        startTestButton.disabled = true
        stopTestButton.disabled = false
        await videoChat.checkConnectionStatus()
      } catch (error) {
        console.error("接続テストエラー:", error)
        alert("接続テストに失敗しました")
      } finally {
        startTestButton.disabled = false
        stopTestButton.disabled = true
      }
    })
  } catch (error) {
    console.error("初期化エラー:", error)
    alert("カメラとマイクへのアクセスを許可してください")
  }
})
