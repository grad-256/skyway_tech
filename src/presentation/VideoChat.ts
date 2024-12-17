import {
  LocalAudioStream,
  LocalP2PRoomMember,
  P2PRoom,
  RemoteDataStream,
  SkyWayContext,
  SkyWayRoom
} from "@skyway-sdk/room"
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
  private hasCompletedInitialTest: boolean = false
  private testContext: SkyWayContext | null = null
  private testRoom: P2PRoom | null = null
  private memberA: LocalP2PRoomMember | null = null
  private testContainer: HTMLElement | null = null
  private memberB: LocalP2PRoomMember | null = null
  private roomB: P2PRoom | null = null
  private testContextB: SkyWayContext | null = null

  constructor(
    private stream: Stream,
    private templeElement: TempleElement
  ) {}

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

  private async testLocalStream(): Promise<void> {
    if (this.hasCompletedInitialTest) return

    try {
      this.showLoading("ローカルストリームをテスト中...")

      // テスト用のコンテナを作成
      this.testContainer = this.createTestContainer()
      const videoPreviewContainer =
        this.testContainer.querySelector<HTMLDivElement>(
          ".video-preview-container"
        )
      const audioPreviewContainer =
        this.testContainer.querySelector<HTMLDivElement>(
          ".audio-preview-container"
        )

      if (!videoPreviewContainer || !audioPreviewContainer) {
        throw new Error("プレビューコンテナが見つかりません")
      }

      // テスト用のコンテキストとルームの設定
      const testToken = await fetchSkyWayToken()
      this.testContext = await SkyWayContext.Create(testToken)
      const testRoomName = `test-room-${Date.now()}`
      this.testRoom = await SkyWayRoom.FindOrCreate(this.testContext, {
        type: "p2p",
        name: testRoomName,
        options: {
          turnPolicy: "turnOnly"
        }
      })

      this.memberA = await this.testRoom.join()

      // MemberB用の別のコンテキスト
      const testTokenB = await fetchSkyWayToken()
      this.testContextB = await SkyWayContext.Create(testTokenB)
      this.roomB = await SkyWayRoom.FindOrCreate(this.testContextB, {
        type: "p2p",
        name: testRoomName,
        options: {
          turnPolicy: "turnOnly" // TURN経由の通信を強制
        }
      })
      this.memberB = await this.roomB.join()
      // ビデオプレビューの設定
      if (this.stream.videoStream) {
        const videoPublication = await this.memberA.publish(
          this.stream.videoStream
        )
        console.log("映像ストリームを公開:", videoPublication.id)
        const videoSubscription = await this.memberB.subscribe(
          videoPublication.id
        )

        // MemberBが映像をサブスクライブ
        console.log("映像ストリームをサブスクライブ:", videoSubscription)
        const videoPreview = document.createElement("video")
        videoPreview.autoplay = true
        videoPreview.playsInline = true
        videoPreview.muted = true
        videoPreview.style.cssText = `
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: 4px;
        `
        // RemoteVideoStreamの場合のみattachメソッドを使用
        if ("attach" in videoSubscription.stream) {
          await videoSubscription.stream.attach(videoPreview)
        }
        videoPreviewContainer.appendChild(videoPreview)
      } else {
        videoPreviewContainer.innerHTML = `
          <div class="no-video-message" style="
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: #666;
          ">
            カメラが利用できません
          </div>
        `
      }

      // オーディオプレビューの設定
      if (this.stream.audioStream) {
        // 音声ストリームの公開
        const audioPublication = await this.memberA.publish(
          this.stream.audioStream
        )
        console.log("音声ストリームを公開:", audioPublication.id)

        // MemberBが音声をサブスクライブ
        const audioSubscription = await this.memberB.subscribe(
          audioPublication.id
        )
        console.log("音声ストリームをサブスクライブ:", audioSubscription)
        const audioMeter = document.createElement("div")
        audioMeter.className = "audio-meter"
        audioMeter.innerHTML = `
          <div style="
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
          ">
            <span>音声レベル:</span>
            <div class="meter-bar" style="
              flex-grow: 1;
              height: 20px;
              background: #1a1a1a;
              border-radius: 10px;
              overflow: hidden;
            ">
              <div class="meter-fill" style="
                width: 0%;
                height: 100%;
                background: #4caf50;
                transition: width 0.1s ease;
              "></div>
            </div>
          </div>
        `
        audioPreviewContainer.appendChild(audioMeter)

        // 音声レベルの可視化
        const cleanup = this.visualizeAudio(
          audioSubscription.stream as any,
          audioMeter.querySelector(".meter-fill")
        )

        // 10秒後にクリーンアップ
        setTimeout(() => {
          if (cleanup) cleanup()
        }, 10000)
      } else {
        audioPreviewContainer.innerHTML = `
          <div style="
            color: #666;
            text-align: center;
            padding: 10px;
          ">
            マイクが利用できません
          </div>
        `
      }
    } catch (error) {
      console.error("ローカルストリームテストエラー:", error)
      this.hideLoading()
      // クリーンアップ
      if (this.memberA) await this.memberA.leave()
      if (this.memberB) await this.memberB.leave()
      if (this.testRoom) await this.testRoom.dispose()
      if (this.roomB) await this.roomB.dispose()
      if (this.testContext) await this.testContext.dispose()
      if (this.testContextB) await this.testContextB.dispose()
      if (this.testContainer) this.testContainer.remove()
      throw error
    }
  }

  // 音声レベルの可視化メソッドを追加
  private visualizeAudio(
    audioStream: LocalAudioStream,
    meterElement: HTMLElement | null
  ) {
    if (!meterElement || !audioStream.track) return

    // MediaStreamを作成
    const mediaStream = new MediaStream([audioStream.track])

    try {
      const audioContext = new AudioContext()
      const source = audioContext.createMediaStreamSource(mediaStream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)

      const dataArray = new Uint8Array(analyser.frequencyBinCount)

      const updateMeter = () => {
        analyser.getByteFrequencyData(dataArray)
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length
        const level = Math.min(100, (average / 128) * 100)

        meterElement.style.width = `${level}%`
        meterElement.style.backgroundColor = level > 50 ? "#4caf50" : "#ffd700"

        requestAnimationFrame(updateMeter)
      }

      updateMeter()

      // AudioContextのクリーンアップ用の関数を返す
      return () => {
        try {
          source.disconnect()
          audioContext.close()
        } catch (error) {
          console.error("AudioContext cleanup error:", error)
        }
      }
    } catch (error) {
      console.error("Audio visualization error:", error)
      return () => {}
    }
  }

  private createTestContainer(): HTMLElement {
    const container = document.createElement("div")
    container.className = "stream-test-container"
    container.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 0, 0, 0.95);
      padding: 20px;
      border-radius: 8px;
      z-index: 1000;
      color: white;
      text-align: center;
      min-width: 500px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    `

    container.innerHTML = `
      <div class="test-header">
        <h3 style="margin: 0 0 10px 0; color: white; font-size: 1.2em;">通信テスト中...</h3>
        <p style="margin: 0 0 20px 0; color: #e0e0e0;">ビデオと音声の確認を行っています</p>
      </div>
      <div class="video-preview-container" style="
        width: 480px;
        height: 360px;
        background: #1a1a1a;
        margin: 0 auto 20px;
        border-radius: 4px;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.1);
      "></div>
      <div class="audio-preview-container" style="
        margin: 10px auto;
        padding: 10px;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 4px;
      "></div>
      <div class="test-status" style="
        margin-top: 10px;
        font-size: 14px;
        color: #e0e0e0;
      ">
        <p>残り時間: <span class="test-timer" style="color: white; font-weight: bold;">10</span>秒</p>
        <button class="test-next-button" style="
          background: #4CAF50;
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          margin-left: 10px;
          display: none;
        ">
        次へ進む
      </button>
      </div>
    `

    document.body.appendChild(container)

    // タイマーの更新
    let timeLeft = 10
    const timerElement = container.querySelector(
      ".test-timer"
    ) as HTMLDivElement
    const actionsContainer = container.querySelector(
      ".test-next-button"
    ) as HTMLDivElement
    const timer = setInterval(async () => {
      timeLeft--
      if (timerElement) timerElement.textContent = timeLeft.toString()
      if (timeLeft <= 0) {
        clearInterval(timer)
        if (actionsContainer && timerElement) {
          actionsContainer.style.display = "block"
          timerElement.parentElement!.style.display = "none" // タイマーを非表示
        }
      }
    }, 1000)

    // 次へ進むボタンのイベントハンドラ
    actionsContainer?.addEventListener("click", async () => {
      if (this.memberA) await this.memberA.leave()
      if (this.memberB) await this.memberB.leave()
      if (this.testRoom) await this.testRoom.dispose()
      if (this.roomB) await this.roomB.dispose()
      if (this.testContext) await this.testContext.dispose()
      if (this.testContextB) await this.testContextB.dispose()
      if (this.testContainer) this.testContainer.remove()
      // ローディングを非表示
      this.hideLoading()
      container.remove()
      // 必要に応じて追加の処理（例：通信状況の確認画面を表示）
    })

    return container
  }

  async initialize() {
    try {
      const token = await fetchSkyWayToken()
      this.context = await SkyWayContext.Create(token)

      // 接続状態チェック
      const status = await this.checkConnectionStatus()      
      if (!status.isReady) {
        throw new Error(status.message)
      }

      // ローカルストリームのテスト
      await this.testLocalStream()
      this.hasCompletedInitialTest = true

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

      // IDと名前をみ合わせて表示
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

  private async showConnectivityTestModal(): Promise<boolean> {
    try {
      const modalContainer = document.createElement("div")
      modalContainer.className = "connectivity-test-modal"
      modalContainer.innerHTML = `
        <div class="modal-content">
          <h2>通信状況の確認</h2>
          <div class="test-phase">
            <div class="test-status">
              <div class="status-indicator"></div>
              <p class="status-message">通信テストを開始します</p>
            </div>
            
            <div class="test-preview">
              <div class="video-preview-container" style="
                width: 480px;
                height: 360px;
                background: #1a1a1a;
                margin: 0 auto 20px;
                border-radius: 4px;
                overflow: hidden;
                border: 1px solid rgba(255, 255, 255, 0.1);
              "></div>
              <div class="audio-preview-container" style="
                margin: 10px auto;
                padding: 10px;
                background: rgba(255, 255, 255, 0.05);
                border-radius: 4px;
              "></div>
            </div>

            <div id="test-results" class="test-results">
              <div class="result-item">
                <span class="label">ICE接続状態:</span>
                <span class="value" id="test-ice-status">-</span>
              </div>
              <div class="result-item">
                <span class="label">ネットワーク遅延:</span>
                <span class="value" id="test-latency">-</span>
              </div>
              <div class="result-item">
                <span class="label">音声デバイス:</span>
                <span class="value" id="test-audio">-</span>
              </div>
              <div class="result-item">
                <span class="label">映像デバイス:</span>
                <span class="value" id="test-video">-</span>
              </div>
            </div>
          </div>

          <div class="modal-actions">
            <button class="cancel-test">キャンセル</button>
            <button class="start-room" disabled>入室する</button>
          </div>
        </div>
      `
      document.body.appendChild(modalContainer)

      // 接続テストの実行
      const testResult = await this.runConnectivityTest(modalContainer)

      // テスト結果に基づいてUIを更新
      this.updateTestUI(modalContainer, testResult)

      // ユーザー選択を待つ
      return new Promise(resolve => {
        const startButton = modalContainer.querySelector(
          ".start-room"
        ) as HTMLButtonElement
        const cancelButton = modalContainer.querySelector(
          ".cancel-test"
        ) as HTMLButtonElement

        startButton.disabled = !testResult.isReady

        startButton.addEventListener("click", () => {
          modalContainer.remove()
          resolve(true)
        })

        cancelButton.addEventListener("click", () => {
          modalContainer.remove()
          resolve(false)
        })
      })
    } catch (error) {
      console.error("接続テストエラー:", error)
      return false
    }
  }

  private async runConnectivityTest(
    modalContainer: HTMLElement
  ): Promise<ConnectionStatus> {
    try {
      const statusIndicator = modalContainer.querySelector(".status-indicator")
      const statusMessage = modalContainer.querySelector(".status-message")

      if (statusIndicator && statusMessage) {
        statusIndicator.className = "status-indicator testing"
        statusMessage.textContent = "接続テスト実行中..."
      }

      // テスト用のルームを作成し���ストリームをテスト
      await this.testLocalStream()

      // 接続状態のチェック
      const status = await this.checkConnectionStatus()

      if (statusIndicator && statusMessage) {
        statusIndicator.className = `status-indicator ${
          status.isReady ? "success" : "error"
        }`
        statusMessage.textContent = status.message
      }

      return status
    } catch (error) {
      console.error("接続テスト実行エラー:", error)
      throw error
    }
  }

  // joinRoom メソッドを更新
  async joinRoom() {
    if (!this.room) {
      await this.createRoom()
    }

    try {
      // 接続テストモーダルを表示
      const canProceed = await this.showConnectivityTestModal()
      if (!canProceed) {
        throw new Error("ユーザーがキャンセルしました")
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
      results,
      "ice-connectivity",
      testResult.iceConnectivity ? "成功" : "失敗",
      testResult.iceConnectivity ? "success" : "error"
    )

    this.updateTestResultItem(
      results,
      "network-latency",
      `${testResult.networkLatency}ms`,
      testResult.networkLatency <= 100
        ? "success"
        : testResult.networkLatency <= 300
          ? "warning"
          : "error"
    )

    this.updateTestResultItem(
      results,
      "audio-support",
      testResult.audioSupported ? "利用可能" : "利用不可",
      testResult.audioSupported ? "success" : "error"
    )

    this.updateTestResultItem(
      results,
      "video-support",
      testResult.videoSupported ? "利用可能" : "利用不可",
      testResult.videoSupported ? "success" : "error"
    )

    this.updateTestResultItem(
      results,
      "recommended-type",
      testResult.recommendedConnectionType || "不明",
      testResult.recommendedConnectionType === "P2P" ? "success" : "warning"
    )

    this.updateTestResultItem(
      results,
      "test-connection-state",
      testResult.connectionState,
      testResult.connectionState === "connected" ? "success" : "warning"
    )

    // 接続メトリクスの更新
    if (this.templeElement.connectionState) {
      this.templeElement.connectionState.textContent =
        testResult.connectionState
    }
  }

  private updateTestUI(
    modalContainer: HTMLElement,
    testResult: ConnectionStatus
  ): void {
    try {
      this.updateStatusIndicator(modalContainer, testResult)
      this.updateDetailedTestResults(modalContainer)
      this.updateStartButton(modalContainer, testResult)
    } catch (error) {
      console.error("テストUI更新エラー:", error)
    }
  }

  private updateStatusIndicator(
    modalContainer: HTMLElement,
    testResult: ConnectionStatus
  ): void {
    const statusIndicator =
      modalContainer.querySelector<HTMLElement>(".status-indicator")
    const statusMessage =
      modalContainer.querySelector<HTMLElement>(".status-message")

    if (!statusIndicator || !statusMessage) {
      console.warn("ステータス表示要素が見つかりません")
      return
    }

    statusIndicator.className = `status-indicator ${
      testResult.isReady ? "success" : "error"
    }`
    statusMessage.textContent = testResult.message
  }

  private updateDetailedTestResults(modalContainer: HTMLElement): void {
    if (!this.lastConnectionTest) {
      console.warn("接続テスト結果が存在しません")
      return
    }

    const testResults: Array<{
      id: string
      value: string
      getStatus: () => "success" | "warning" | "error"
    }> = [
      {
        id: "test-ice-status",
        value: this.lastConnectionTest.iceConnectivity ? "成功" : "失敗",
        getStatus: () =>
          this.lastConnectionTest?.iceConnectivity ? "success" : "error"
      },
      {
        id: "test-latency",
        value: `${this.lastConnectionTest.networkLatency}ms`,
        getStatus: () => {
          const latency = this.lastConnectionTest?.networkLatency ?? 0
          if (latency <= 100) return "success"
          if (latency <= 300) return "warning"
          return "error"
        }
      },
      {
        id: "test-audio",
        value: this.lastConnectionTest.audioSupported ? "利用可能" : "利用不可",
        getStatus: () =>
          this.lastConnectionTest?.audioSupported ? "success" : "error"
      },
      {
        id: "test-video",
        value: this.lastConnectionTest.videoSupported ? "利用可能" : "利用不可",
        getStatus: () =>
          this.lastConnectionTest?.videoSupported ? "success" : "error"
      }
    ]

    testResults.forEach(({ id, value, getStatus }) => {
      this.updateTestResultItem(modalContainer, id, value, getStatus())
    })
  }

  private updateStartButton(
    modalContainer: HTMLElement,
    testResult: ConnectionStatus
  ): void {
    const startButton =
      modalContainer.querySelector<HTMLButtonElement>(".start-room")
    if (!startButton) {
      console.warn("入室ボタンが見つかりません")
      return
    }

    startButton.disabled = !testResult.isReady
  }

  private updateTestResultItem(
    modalContainer: HTMLElement,
    id: string,
    value: string,
    statusClass: "success" | "warning" | "error"
  ): void {
    const element = modalContainer.querySelector<HTMLElement>(`#${id}`)
    if (!element) {
      console.warn(`テスト結果要素が見つかりません: ${id}`)
      return
    }

    element.textContent = value
    element.className = `value ${statusClass}`
  }
}
