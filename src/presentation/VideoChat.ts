import { RemoteDataStream, SkyWayContext, SkyWayRoom } from "@skyway-sdk/room"
import { Room } from "../domain/entities/Room"
import { Stream } from "../domain/entities/Stream"
import { TempleElement } from "../infrastructure/TempleElement"
import { fetchSkyWayToken } from "../service/skyway"
import { SkyWayConnectivityTest } from "../connectivity"

interface ConnectionStatus {
  isReady: boolean
  message: string
}

interface ConnectivityTestResult {
  iceConnectivity: boolean
  networkLatency: number
  audioSupported: boolean
  videoSupported: boolean
  recommendedConnectionType: "P2P" | "SFU" | null
  connectionState: string
}

export class VideoChat {
  private room: Room | undefined
  private context: SkyWayContext | undefined
  private lastConnectionTest: ConnectivityTestResult | null = null

  constructor(private stream: Stream, private templeElement: TempleElement) {}

  private showLoading(message: string = "接続テスト中...") {
    const overlay = document.getElementById("loading-overlay")
    const messageEl = overlay?.querySelector(".loading-message")
    if (overlay && messageEl) {
      messageEl.textContent = message
      overlay.style.display = "flex"
    }
  }

  private hideLoading() {
    const overlay = document.getElementById("loading-overlay")
    if (overlay) {
      overlay.style.display = "none"
    }
  }

  public async checkConnectionStatus(): Promise<ConnectionStatus> {
    if (!this.context) {
      return {
        isReady: false,
        message: "コンテキストが初期化されていません"
      }
    }

    try {
      this.showLoading()
      const connectivityTest = new SkyWayConnectivityTest(this.context)
      const testResult = await connectivityTest.runConnectivityTest()
      this.lastConnectionTest = testResult

      // テスト結果の表示を更新
      this.updateTestResults(testResult)

      // 接続状態の判定
      if (testResult.networkLatency > 1000) {
        return {
          isReady: false,
          message: `ネットワーク遅延が大きすぎます（${testResult.networkLatency}ms）`
        }
      }

      if (!testResult.audioSupported || !testResult.videoSupported) {
        return {
          isReady: false,
          message: "音声またはビデオデバイスにアクセスできません"
        }
      }

      return {
        isReady: true,
        message:
          testResult.networkLatency > 300
            ? "接続状態が不安定です"
            : "接続状態は良好です"
      }
    } catch (error) {
      console.error("接続テストエラー:", error)
      return {
        isReady: false,
        message: "接続テストに失敗しました"
      }
    } finally {
      this.hideLoading()
    }
  }

  async initialize() {
    try {
      const token = await fetchSkyWayToken()
      this.context = await SkyWayContext.Create(token)

      const status = await this.checkConnectionStatus()
      if (!status.isReady) {
        throw new Error(status.message)
      }

      console.log("接続テスト結果:", this.lastConnectionTest)
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
      throw new Error(
        "ルーム名には半角英数字と一の記号（.%*_-）のみ使用できます"
      )
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
    if (!this.room) return

    // メンバー参加イベント
    this.room.events.onMemberJoined?.add(event => {
      console.log("メンバーが参加しました:", event.member.id)
    })

    // メンバー退出イベント
    this.room.events.onMemberLeft?.add(event => {
      console.log("メンバーが退出しました:", event.member.id)
      const mediaElements = document.querySelectorAll(
        `[data-member-id="${event.member.id}"]`
      )
      mediaElements.forEach(element => element.remove())
    })

    // ストリーム公開イベント
    this.room.events.onStreamPublished?.add(async event => {
      console.log("新しいストリームが公開されました:", {
        publicationId: event.publication.id,
        publisherId: event.publication.publisher.id,
        contentType: event.publication.contentType
      })

      await this.handleNewPublication(event.publication)
    })

    // ストリーム公開停止イベント
    this.room.events.onStreamUnpublished?.add(event => {
      console.log("ストリームの公開が停止されました:", event.publication.id)
      const mediaElement = document.querySelector(
        `[data-publication-id="${event.publication.id}"]`
      )
      if (mediaElement) {
        mediaElement.remove()
      }
    })

    // メッセージ受信イベント
    this.room.events.onPublicationSubscribed?.add(event => {
      const { subscription } = event
      if (subscription.stream instanceof RemoteDataStream) {
        subscription.stream.onData.add((data: unknown) => {
          try {
            console.log("メッセージを受信:", data)
            const senderName = subscription.publication.publisher.name || "匿名"
            this.appendMessage(senderName, data as string)
          } catch (error) {
            console.error("メッセージ受信エラー:", error)
          }
        })
      }
    })
  }

  private async handleNewPublication(publication: any) {
    try {
      const localMemberId = this.room?.getLocalMember()?.id
      const publisherId = publication.publisher.id

      // データストリームは無視（Room クラスで処理される）
      if (publication.contentType === "data") {
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

  private generateRandomName(): string {
    const adjectives = [
      "陽気な",
      "眠そうな",
      "元気な",
      "優しい",
      "真面目な",
      "おしゃべりな"
    ]
    const animals = [
      "パンダ",
      "キリン",
      "ライオン",
      "ペンギン",
      "カンガルー",
      "コアラ"
    ]

    const randomAdjective =
      adjectives[Math.floor(Math.random() * adjectives.length)]
    const randomAnimal = animals[Math.floor(Math.random() * animals.length)]

    return `${randomAdjective}${randomAnimal}`
  }

  private async attachStreamToUI(stream: any, publication: any) {
    console.log("Attaching stream to UI:", {
      kind: stream.track.kind,
      publisherId: publication.publisher.id,
      publisherName: publication.publisher.name
    })

    // テスト用のストリームは無視する
    if (publication.publisher.name?.includes("test-room")) {
      console.log("テスト用のストリームをスキップします")
      return
    }

    const mediaElement = this.createMediaElement(stream)

    // データ属性を追加
    mediaElement.dataset.memberId = publication.publisher.id
    mediaElement.dataset.publicationId = publication.id
    mediaElement.dataset.publisherId = publication.publisher.id

    await stream.attach(mediaElement)

    // audio要素の場合は特別な配置を行う
    if (stream.track.kind === "audio") {
      // remote-audio-containerが存在しない場合は作成
      let audioContainer = document.getElementById("remote-audio-container")
      if (!audioContainer) {
        audioContainer = document.createElement("div")
        audioContainer.id = "remote-audio-container"
        document.body.appendChild(audioContainer)
      }

      // 既存の同じパブリッシャーのaudio要素があれば削除
      const existingWrapper = audioContainer.querySelector(
        `div[data-publisher-id="${publication.publisher.id}"]`
      )
      if (existingWrapper) {
        existingWrapper.remove()
      }

      console.log(this.room?.getLocalMember()?.id)
      console.log(publication.publisher.id)

      // オーディオコントロールのラッパー作成
      const audioWrapper = document.createElement("div")
      audioWrapper.className = "audio-control-wrapper"
      audioWrapper.dataset.publisherId = publication.publisher.id

      // 発行者名のラベル作成
      const publisherLabel = document.createElement("div")
      publisherLabel.className = "publisher-label"

      // ランダムな名前を生成して保存
      const randomName = this.generateRandomName()
      const isLocal =
        publication.publisher.id === this.room?.getLocalMember()?.id

      // IDと名前を組み合わせて表示
      const displayName = isLocal
        ? `${randomName}（自分）- ${publication.publisher.id}`
        : `${randomName} - ${publication.publisher.id}`

      publisherLabel.textContent = displayName

      // メタデータに名前を保存（後で参照できるように）
      if (isLocal && this.room?.getLocalMember()) {
        this.room.getLocalMember()?.updateMetadata(randomName)
      }

      // ラッパーに要素を追加
      audioWrapper.appendChild(publisherLabel)
      audioWrapper.appendChild(mediaElement)

      audioContainer.appendChild(audioWrapper)
      console.log("Audio element added to container")
    } else {
      this.templeElement.remoteMediaArea.appendChild(mediaElement)
    }
  }

  private createMediaElement(stream: any) {
    if (stream.track.kind === "video") {
      const element = document.createElement("video")
      element.autoplay = true
      element.playsInline = true
      return element
    } else {
      const element = document.createElement("audio")
      element.autoplay = true
      element.controls = true
      element.classList.add("remote-audio")
      return element
    }
  }

  async joinRoom() {
    if (!this.room) {
      await this.createRoom()
    }

    try {
      // 入室前に接続状態を再確認
      const status = await this.checkConnectionStatus()
      if (!status.isReady) {
        throw new Error(status.message)
      }

      if (status.message.includes("不安定")) {
        console.warn(status.message)
      }

      const localMember = await this.room?.join()
      if (!localMember) throw new Error("参加に失敗しました")

      // メッセージ受信コールバックを設定
      this.room?.onMessageReceived(event => {
        try {
          const { data, sender } = event
          console.log("メッセージを受信:", data, "送信者:", sender)
          this.appendMessage(sender.name, data as string)
        } catch (error) {
          console.error("メッセージ受信エラー:", error)
        }
      })

      // メッセージング機能の初期化
      console.log("メッセージング機能を初期化します")
      await this.room?.initializeMessaging()

      // 自分のIDを表示
      this.templeElement.myId.textContent = localMember.id

      // 自分のストリームを公開
      console.log("自分のストリームを公開します")
      if (this.stream.audioStream) {
        await this.room?.publishStream(this.stream.audioStream)
      }
      if (this.stream.videoStream) {
        await this.room?.publishStream(this.stream.videoStream)
      }

      // 既存のリモートストリームを購読
      const publications = this.room?.getRemotePublications() || []
      for (const publication of publications) {
        await this.handleNewPublication(publication)
      }
    } catch (error) {
      console.error("ルーム参加エラー:", error)
      throw error
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
    const audioContainer = document.getElementById("remote-audio-container")
    if (audioContainer) {
      audioContainer.innerHTML = ""
    }
  }

  // メッセージ表示関数
  private appendMessage(sender: string, content: string) {
    const messageArea = document.getElementById("message-area")
    if (!messageArea) return

    const messageDiv = document.createElement("div")
    messageDiv.className = "message"

    const time = new Date().toLocaleTimeString()
    messageDiv.innerHTML = `
      <span class="sender">${this.escapeHtml(sender)}</span>
      <span class="time">${time}</span>
      <div class="content">${this.escapeHtml(content)}</div>
    `

    messageArea.appendChild(messageDiv)
    messageArea.scrollTop = messageArea.scrollHeight
  }

  // XSS対策用のエスケープ関数
  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;")
  }

  // メッセージ送信メソッドを追加
  async sendMessage(message: string) {
    if (!this.room) throw new Error("ルームに参加していません")

    try {
      await this.room.sendMessage(message)
      // 自分のメッセージも表示
      const localMember = this.room.getLocalMember()
      const senderName = localMember?.name || "自分"
      this.appendMessage(senderName, message)
    } catch (error) {
      console.error("メッセージ送信エラー:", error)
      throw error
    }
  }

  private updateTestResults(testResult: ConnectivityTestResult) {
    const results = document.getElementById("connectivity-test-results")
    if (!results) return

    // テスト結果を表示
    results.style.display = "block"
    results.classList.add("show")

    // 各要素の更新と状態に応じたクラス付与
    this.updateTestResultItem(
      "ice-connectivity",
      testResult.iceConnectivity ? "成功" : "失敗",
      testResult.iceConnectivity ? "status-success" : "status-error"
    )

    this.updateTestResultItem(
      "network-latency",
      `${testResult.networkLatency}ms`,
      testResult.networkLatency <= 100
        ? "status-success"
        : testResult.networkLatency <= 300
        ? "status-warning"
        : "status-error"
    )

    this.updateTestResultItem(
      "audio-support",
      testResult.audioSupported ? "利用可能" : "利用不可",
      testResult.audioSupported ? "status-success" : "status-error"
    )

    this.updateTestResultItem(
      "video-support",
      testResult.videoSupported ? "利用可能" : "利用不可",
      testResult.videoSupported ? "status-success" : "status-error"
    )

    this.updateTestResultItem(
      "recommended-type",
      testResult.recommendedConnectionType || "不明",
      testResult.recommendedConnectionType === "P2P"
        ? "status-success"
        : "status-warning"
    )

    this.updateTestResultItem(
      "test-connection-state",
      testResult.connectionState,
      testResult.connectionState === "connected"
        ? "status-success"
        : "status-warning"
    )

    // 接続メトリクスの更新
    if (this.templeElement.connectionState) {
      this.templeElement.connectionState.textContent =
        testResult.connectionState
    }
  }

  private updateTestResultItem(id: string, value: string, statusClass: string) {
    const element = document.getElementById(id)
    if (element) {
      element.textContent = value
      element.className = `value ${statusClass}`
    }
  }
}
