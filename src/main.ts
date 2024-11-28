import { VideoChat } from "./presentation/VideoChat";
import { Stream } from "./domain/entities/Stream";
import { TempleElement } from "./infrastructure/TempleElement";

window.addEventListener("load", async () => {
  try {
    // Streamインスタンスの作成と初期化
    const stream = new Stream();
    await stream.initialize();  // メディアストリームの初期化

    const templeElement = new TempleElement();
    const videoChat = new VideoChat(stream, templeElement);

    // 初期化
    await videoChat.initialize();

    // イベントリスナーの設定
    const joinButton = document.getElementById("join") as HTMLButtonElement;
    joinButton?.addEventListener("click", async () => {
      console.log("join");
      await videoChat.joinRoom();
    }, false);

    const leaveButton = document.getElementById("leave") as HTMLButtonElement;
    leaveButton?.addEventListener("click", async () => {
      console.log("leave");
      await videoChat.leaveRoom();
    }, false);

    // ペッセージ送信のイベントリスナー設定
    const messageForm = document.getElementById('message-form') as HTMLFormElement;
    const messageInput = document.getElementById('message-input') as HTMLInputElement;

    messageForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const message = messageInput.value.trim();
      if (!message) return;

      try {
        await videoChat.sendMessage(message);
        messageInput.value = '';
      } catch (error) {
        console.error('メッセージ送信エラー:', error);
        alert('メッセージの送信に失敗しました');
      }
    });

    // ページアンロード時のクリーンアップ
    window.addEventListener("beforeunload", async () => {
      await stream.release();
    });

  } catch (error) {
    console.error("初期化エラー:", error);
    alert("カメラとマイクへのアクセスを許可してください");
  }
});
