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

    // ページアンロード時のクリーンアップ
    window.addEventListener("beforeunload", async () => {
      await stream.release();
    });

  } catch (error) {
    console.error("初期化エラー:", error);
    alert("カメラとマイクへのアクセスを許可してください");
  }
});
