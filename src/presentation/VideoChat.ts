import { RemoteDataStream, SkyWayContext, SkyWayRoom } from "@skyway-sdk/room"
import { Room } from "../domain/entities/Room"
import { Stream } from "../domain/entities/Stream"
import { TempleElement } from "../infrastructure/TempleElement"
import { fetchSkyWayToken } from "../service/skyway"

export class VideoChat {
  private room: Room | undefined
  private context: SkyWayContext | undefined

  constructor(private stream: Stream, private templeElement: TempleElement) {}

  async initialize() {
    try {
      const token = await fetchSkyWayToken()
      this.context = await SkyWayContext.Create(token)
    } catch (error) {
      console.error("初期化エラー:", error)
      throw error
    }
  }

  async createRoom() {
    if (!this.context) throw new Error("Contextが初期化されていません")
    
    const roomName = this.templeElement.roomNameInput.value
    if (roomName === "") return

    // ルーム名のバリデーション
    const roomNamePattern = /^[.A-Za-z0-9%*_-]+$/
    if (!roomNamePattern.test(roomName)) {
      throw new Error("ルーム名には半角英数字と一部の記号（.%*_-）のみ使用できます")
    }

    try {
      const skyWayRoom = await SkyWayRoom.FindOrCreate(this.context, {
        type: "p2p",
        name: roomName
      })
      this.room = new Room(skyWayRoom)

      // イベントリスナーの設定
      this.setupRoomEventListeners()
    } catch (error) {
      console.error("ルーム作成エラー:", error)
      throw error
    }
  }

  private setupRoomEventListeners() {
    if (!this.room) return;

    // メンバー参加イベント
    this.room.events.onMemberJoined?.add((event) => {
      console.log("メンバーが参加しました:", event.member.id);
    });

    // メンバー退出イベント
    this.room.events.onMemberLeft?.add((event) => {
      console.log("メンバーが退出しました:", event.member.id);
      const mediaElements = document.querySelectorAll(
        `[data-member-id="${event.member.id}"]`
      );
      mediaElements.forEach(element => element.remove());
    });

    // ストリーム公開イベント
    this.room.events.onStreamPublished?.add(async (event) => {
      console.log("新しいストリームが公開されました:", {
        publicationId: event.publication.id,
        publisherId: event.publication.publisher.id,
        contentType: event.publication.contentType
      });
      await this.handleNewPublication(event.publication);
    });

    // ストリーム公開停止イベント
    this.room.events.onStreamUnpublished?.add((event) => {
      console.log("ストリームの公開が停止されました:", event.publication.id);
      const mediaElement = document.querySelector(
        `[data-publication-id="${event.publication.id}"]`
      );
      if (mediaElement) {
        mediaElement.remove();
      }
    });

    this.room.events.onPublicationSubscribed?.add((event) => {
      console.log("パブリケーション購読イベント:", event);
      try {
        // const { data, subscription } = event;
        // console.log("メッセージを受信:", data);
        // const senderName = subscription.publication.publisher.name || '匿名';
        this.appendMessage('匿名', 'メッセージ受信');
      } catch (error) {
        console.error('メッセージ受信エラー:', error);
      }
    });

    // メッセージ受信イベントの設定
    this.room.onDataReceived((event) => {
      try {
        const { data, subscription } = event;
        console.log("メッセージを受信:", data);
        const senderName = subscription.publication.publisher.name || '匿名';
        this.appendMessage(senderName, data as string);
      } catch (error) {
        console.error('メッセージ受信エラー:', error);
      }
    });
  }

  private async handleNewPublication(publication: any) {
    try {
      const localMemberId = this.room?.getLocalMember()?.id
      const publisherId = publication.publisher.id
      
      // データストリームは無視（Room クラスで処理される）
      if (publication.contentType === 'data') {
        return
      }

      // 自分の公開したストリームは購読しない
      if (publisherId === localMemberId) {
        console.log("自分のストリームなのでスキップします")
        return
      }

      console.log("メディアストリームを購読します:", {
        publicationId: publication.id,
        publisherId: publication.publisher.id,
        contentType: publication.contentType
      })

      const subscription = await this.room?.subscribeStream(publication.id)
      if (subscription) {
        await this.attachStreamToUI(subscription.stream, publication)
      }
    } catch (error) {
      console.error("ストリーム購読エラー:", error)
    }
  }

  private async attachStreamToUI(stream: any, publication: any) {
    const mediaElement = this.createMediaElement(stream)
    // データ属性を追加して、後で要素の特定を容易にする
    mediaElement.dataset.memberId = publication.publisher.id
    mediaElement.dataset.publicationId = publication.id

    await stream.attach(mediaElement)
    this.templeElement.remoteMediaArea.appendChild(mediaElement)
  }

  private createMediaElement(stream: any) {
    const element =
      stream.track.kind === "video"
        ? document.createElement("video")
        : document.createElement("audio")

    element.playsInline = true
    element.autoplay = true
    if (stream.track.kind === "audio") {
      element.controls = true
    }
    return element
  }

  private setupConnectionMonitoring() {
    if (!this.room) return

    // 接続状態の監視
    this.room.onConnectionStateChanged((state: string) => {
      this.templeElement.connectionState.textContent = state
    })

    // 定期的な統計情報の更新
    // setInterval(async () => {
    //   if (!this.room) return;

    //   try {
    //     const stats = await this.room.getStats();
    //     console.log({stats});

    //     if (!stats) return;

    //     // 送受信バイト数の更新
    //     let totalBytesSent = 0;
    //     let totalBytesReceived = 0;
    //     let avgRtt = 0;
    //     let rttCount = 0;

    //     stats.forEach(stat => {
    //       if (stat.type === 'candidate-pair') {
    //         totalBytesSent += stat.bytesSent || 0;
    //         totalBytesReceived += stat.bytesReceived || 0;
    //         if (stat.currentRoundTripTime) {
    //           avgRtt += stat.currentRoundTripTime * 1000;
    //           rttCount++;
    //         }
    //       }
    //     });

    //     // UI更新
    //     this.templeElement.bytesSent.textContent = totalBytesSent.toString();
    //     this.templeElement.bytesReceived.textContent = totalBytesReceived.toString();
    //     this.templeElement.rtt.textContent = rttCount > 0
    //       ? Math.round(avgRtt / rttCount).toString()
    //       : '0';

    //   } catch (error) {
    //     console.error('統計情報の取得に失敗:', error);
    //   }
    // }, 1000);
  }

  async joinRoom() {
    if (!this.room) {
      await this.createRoom();
    }

    try {
      const localMember = await this.room?.join();
      if (!localMember) throw new Error("参加に失敗しました");

      // メッセージング機能の初期化
      console.log("メッセージング機能を初期化します");
      await this.room?.initializeMessaging();

      // 自分のIDを表示
      this.templeElement.myId.textContent = localMember.id;

      // 自分のストリームを公開
      console.log("自分のストリームを公開します");
      if (this.stream.audioStream) {
        await this.room?.publishStream(this.stream.audioStream);
      }
      if (this.stream.videoStream) {
        await this.room?.publishStream(this.stream.videoStream);
      }

      // 既存のリモートストリームを購読
      const publications = this.room?.getRemotePublications() || [];
      for (const publication of publications) {
        await this.handleNewPublication(publication);
      }

    } catch (error) {
      console.error("ルーム参加エラー:", error);
      throw error;
    }
  }

  async leaveRoom() {
    try {
      await this.room?.leave()
      this.cleanupUI()
    } catch (error) {
      console.error("退室エラー:", error)
      throw error
    }
  }

  private cleanupUI() {
    if (this.templeElement.remoteMediaArea) {
      this.templeElement.remoteMediaArea.innerHTML = ""
    }
    if (this.templeElement.myId) {
      this.templeElement.myId.textContent = ""
    }
    // その他のUI要素のクリーンアップ
  }

  // メッセージ表示関数
  private appendMessage(sender: string, content: string) {
    const messageArea = document.getElementById('message-area');
    if (!messageArea) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    
    const time = new Date().toLocaleTimeString();
    messageDiv.innerHTML = `
      <span class="sender">${this.escapeHtml(sender)}</span>
      <span class="time">${time}</span>
      <div class="content">${this.escapeHtml(content)}</div>
    `;
    
    messageArea.appendChild(messageDiv);
    messageArea.scrollTop = messageArea.scrollHeight;
  }

  // XSS対策用のエスケープ関数
  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // メッセージ送信メソッドを追加
  async sendMessage(message: string) {
    if (!this.room) throw new Error("ルームに参加していません");
    
    try {
      await this.room.sendMessage(message);
      // 自分のメッセージも表示
      const localMember = this.room.getLocalMember();
      const senderName = localMember?.name || '自分';
      this.appendMessage(senderName, message);
    } catch (error) {
      console.error("メッセージ送信エラー:", error);
      throw error;
    }
  }
}
