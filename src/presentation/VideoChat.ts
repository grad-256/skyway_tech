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

interface VideoQualityPreset {
  width: number;
  height: number;
  frameRate: number;
  maxBitrate?: number;
  minWidth?: number;
  minHeight?: number;
  minFrameRate?: number;
  minBitrate?: number;
}

const QUALITY_PRESETS: Record<'high' | 'medium' | 'low', VideoQualityPreset> = {
  high: {
    width: 1280,
    height: 720,
    frameRate: 30,
    minWidth: 640,
    minHeight: 480,
    minFrameRate: 15,
  },
  medium: {
    width: 640,
    height: 480,
    frameRate: 24,
    minWidth: 320,
    minHeight: 240,
    minFrameRate: 12,
  },
  low: {
    width: 320,
    height: 240,
    frameRate: 15,
    minWidth: 160,
    minHeight: 120,
    minFrameRate: 8,
  }
};

interface NetworkQualityMetrics {
  bytesReceived: number;
  packetsReceived: number;
  packetsLost: number;
  timestamp: number;
  nackCount: number;
  pliCount: number;
  roundTripTime: number;
  availableBitrate: number;
  jitter: number;
  freezeCount: number;
  freezeDuration: number;
  connectionState: string;
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
  private lastMetrics: NetworkQualityMetrics | null = null;
  private qualityHistory: ('good' | 'bad')[] = [];
  private readonly HISTORY_SIZE = 5;
  private maxRetryAttempts = 3;
  private currentRetryAttempt = 0;
  private retryTimeout = 2000; // 2秒
  private loadingIndicator: HTMLElement | null = null;
  private qualityMonitoringInterval: NodeJS.Timer | null = null;
  private qualityRecoveryTimeouts: number[] = [];
  private messageArea: HTMLElement | null = null;
  
  constructor(
    private stream: Stream,
    private templeElement: TempleElement,
    private connectivityContainer: HTMLElement | null
  ) {
    window.addEventListener('beforeunload', () => {
      console.log('ページアンロードによるクリーンアップを実行します');
      this.dispose();
    });

    // ESCキーでの退室処理
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        console.log('ESCキーによる退室処理を実行します');
        this.dispose();
      }
    });
  }

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

  private async testLocalStream(autoRetry: boolean = true, noneTestCompleted: boolean | undefined = undefined): Promise<void> {
    if (noneTestCompleted === false) {
      this.hasCompletedInitialTest = false
    } else if (noneTestCompleted === true) {
      return
    }

    if (this.hasCompletedInitialTest) return
    
    try {
      this.hasCompletedInitialTest = false
      await this.cleanupTestResources();
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

      // MemberAの参加を待つ
      this.memberA = await this.testRoom.join()

      // ビデオストリームの公開を待つ
      let videoPublication
      if (this.stream.videoStream) {
          videoPublication = await this.memberA.publish(this.stream.videoStream)
          console.log("映像ストリームを公開:", videoPublication.id)
      }

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
      if (videoPublication) {
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
      this.hasCompletedInitialTest = true
    } catch (error) {
      console.error("ローカルストリームテストエラー:", error)
      this.hideLoading()
      this.hasCompletedInitialTest = false
      await this.cleanupTestResources();
      // クリーンアップ
      if (autoRetry && this.currentRetryAttempt < this.maxRetryAttempts) {
        this.showRetryDialog();
        // 自動再接続
        // this.currentRetryAttempt++;
        // console.log(`自動再接続を試みます (${this.currentRetryAttempt}/${this.maxRetryAttempts})`);
        
        // await new Promise(resolve => setTimeout(resolve, this.retryTimeout));
        // return this.testLocalStream(true);
      } else {
        // 手動再接続のUIを表示
        this.showRetryDialog();
      }
      
    }
  }

  // クリーンアップ処理を別メソッドに切り出し
  private async cleanupTestResources(): Promise<void> {
    try {
      if (this.memberA) {
        await this.memberA.leave();
        this.memberA = null;
      }
      if (this.memberB) {
        await this.memberB.leave();
        this.memberB = null;
      }
      if (this.testRoom) {
        await this.testRoom.dispose();
        this.testRoom = null;
      }
      if (this.roomB) {
        await this.roomB.dispose();
        this.roomB = null;
      }
      if (this.testContext) {
        await this.testContext.dispose();
        this.testContext = null;
      }
      if (this.testContextB) {
        await this.testContextB.dispose();
        this.testContextB = null;
      }
      if (this.testContainer) {
        this.testContainer.remove();
        this.testContainer = null;
      }
    } catch (cleanupError) {
      console.error("クリーンアップ中にエラーが発生:", cleanupError);
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

  // 手動再接続用のダイアログを表示
private showRetryDialog(): void {
  const dialogContainer = document.createElement('div');
  dialogContainer.className = 'retry-dialog';
  dialogContainer.style.cssText = `
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
  `;

  dialogContainer.innerHTML = `
    <h3 style="margin: 0 0 10px 0;">接続エラー</h3>
    <p style="margin: 0 0 20px 0;">ローカルストリームのテストに失敗しました</p>
    <button class="retry-button" style="
      background: #4CAF50;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 4px;
      cursor: pointer;
      margin-right: 10px;
    ">
      再試行
    </button>
  `;

  document.body.appendChild(dialogContainer);

  // イベントリスナーの設定
  const retryButton = dialogContainer.querySelector('.retry-button');
  retryButton?.addEventListener('click', async () => {
    dialogContainer.remove();
    this.currentRetryAttempt = 0; // リトライカウントをリセット
    await this.testLocalStream(false, false); // 手動再試行
  });
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
      await this.testLocalStream(true)
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

      // 自分のストリームはスキップ
      if (publisherId === localMemberId) {
        console.log("自分のストリームなのでスキップします");
        return;
      }

      console.log("新規配信を処理:", {
        contentType: publication.contentType,
        publisherId,
        isLocal: publisherId === localMemberId
      });

      // データストリームは無視（Room クラスで処理される）
      if (publication.contentType === "data") {
        console.log("データストリームは別途処理されます");
        return
      }

      console.log(`${publication.contentType}ストリームを購読開始:`, {
        publicationId: publication.id,
        publisherId: publication.publisher.id,
        contentType: publication.contentType
      })

      const subscription = await this.room?.subscribeStream(publication.id)
      if (!subscription) {
        console.error("音声ストリームの購読に失敗");
        return;
      }

      // ストリーム接続前の状態をロ��
      console.log('ストリーム接続前:', subscription.subscription.state);
      if (publication.contentType === 'audio') {
        console.log("音声ストリームのUI処理を開始");
        const audioElement = await this.attachStreamToUI(subscription.stream, publication);
        
        // 音量メーターの追加（必要な場合）
        this.setupAudioMeter(subscription.stream, audioElement);
      }
      if (publication.contentType === 'video') {
        console.log('接続前の状態:', subscription.subscription.state);
        subscription.subscription.onConnectionStateChanged.add(state => {
          console.log('[イベント発火] 接続状態変更:', {
            oldState: subscription.subscription.getConnectionState(),
            newState: state,
            timestamp: new Date().toISOString()
          });

          // 状態に応じたユーザー通知と対応
          this.handleConnectionStateChange(state);
        });
        await this.attachStreamToUI(subscription.stream, publication);
      }
      // ストリーム接続後の状態をログ
      console.log('ストリーム接続後:', subscription.subscription.state);
    } catch (error) {
      console.error("ストリーム購読エラー:", error)
    }
  }

  // 音量メーターのセットアップ（オプション）
  private setupAudioMeter(stream: any, audioElement: HTMLAudioElement | null) {
    if (!audioElement) return;
    try {
      audioElement.muted = false;

      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(new MediaStream([stream.track]));
      const analyser = audioContext.createAnalyser();
      source.connect(analyser);
      
      // 音量の可視化処理を追加する場合はここに実装
    } catch (error) {
      console.error("音量メーターのセットアップエラー:", error);
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
      "ペンギルー",
      "カンガルー",
      "コアラ"
    ]

    const randomAdjective =
      adjectives[Math.floor(Math.random() * adjectives.length)]
    const randomAnimal = animals[Math.floor(Math.random() * animals.length)]

    return `${randomAdjective}${randomAnimal}`
  }

  private async attachStreamToUI(stream: any, publication: any) {
    const localMemberId = this.room?.getLocalMember()?.id;
    if (publication.publisher.id === localMemberId && publication.contentType === 'audio') {
      console.log("自分の音声ストリームなのでUIをスキップします");
      return;
    }

    console.log("Attaching stream to UI:", {
      streamType: typeof stream,
      trackExists: !!stream.track,
      trackType: typeof stream.track,
      kind: stream.track?.kind,
      contentType: publication.contentType,  // SkyWayのcontentTypeも確認
      publication: {
        id: publication.id,
        publisherId: publication.publisher.id,
        contentType: publication.contentType
      }
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

    console.log("attachStreamToUI", publication.contentType)
    console.log("mediaElement", mediaElement)
    // audio要素の場合は特別な配置を行う
    if (publication.contentType === 'audio') {
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
    } else if (publication.contentType === "video") {
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
              <span class="label">往復時間(RTT):</span>
              <span class="value" id="test-rtt">-</span>
            </div>
            <div class="result-item">
              <span class="label">利用可能帯域:</span>
              <span class="value" id="test-bitrate">-</span>
            </div>
            <div class="result-item">
              <span class="label">接続状態:</span>
              <span class="value" id="test-connection-state">-</span>
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

      // テスト結果に基づいてUI更新
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

      // テスト用の���ームを作成しストリームをテスト
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
    try {
      if (this.room) {
        console.log('再参加のため、既存のルームをクリーンアップします');
        await this.leaveRoom();
      }
      
      await this.createRoom()

      if (!this.room) {
        throw new Error("ルームの作成に失敗しました");
      }
      // 接続テストモーダルを表示
      const canProceed = await this.showConnectivityTestModal()
      if (!canProceed) {
        throw new Error("ユーザーがキャンセルしました")
      }

      // 初期品質設定
      await this.setInitialVideoQuality();
      
      // SkyWayのルーム参加処理
      const localMember = await this.room?.join();
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
        console.log("音声ストリームを公開します", {
          trackEnabled: this.stream.audioStream.track.enabled,
          trackMuted: this.stream.audioStream.track.muted
        });
        const audioPublication = await this.room?.publishStream(this.stream.audioStream);
        console.log("音声ストリーム公開完了:", {
          publicationId: audioPublication?.id,
          publisherId: this.room?.getLocalMember()?.id
        });
  
        // 自分の音声のUIも表示
        // await this.attachStreamToUI(this.stream.audioStream, {
        //   contentType: 'audio',
        //   publisher: {
        //     id: this.room?.getLocalMember()?.id,
        //     name: 'local'
        //   },
        //   id: audioPublication?.id
        // });
      }
      if (this.stream.videoStream) {
        console.log("ビデオストリームを公開します");
        const videoPublication = await this.room?.publishStream(this.stream.videoStream);
        console.log("ビデオストリーム公開完了:", videoPublication?.id);
      }

      // 既存のリモートストリームを購読
      const publications = this.room?.getRemotePublications() || []
      console.log("既存のリモート配信を確認:", {
        count: publications.length,
        types: publications.map(p => p.contentType)
      });

      for (const publication of publications) {
        console.log("配信タイプを確認:", publication.contentType);
        if (publication.contentType === 'audio' || publication.contentType === 'video') {
          await this.handleNewPublication(publication);
        }
      }

      this.room?.events.onStreamPublished?.add(async (e) => {
        console.log("新規ストリーム公開を検知:", {
          contentType: e.publication.contentType,
          publisherId: e.publication.publisher.id
        });
        await this.handleNewPublication(e.publication);
      });
      // 品質モニタリングを開始（確実に最後に実行）
      console.log('ルーム参加後に品質モニタリングを開始します');
      this.ensureQualityMonitoring();
    } catch (error) {
      console.error("ルーム参加エラー:", error)
      throw error
    }
  }

  // 新しく追加: 品質モニタリングの確実な開始を保証
private async ensureQualityMonitoring() {
  // 一度停止して確実に再開始
  this.stopQualityMonitoring();
  
  // 少し待機して、他の処理が完了するのを待つ
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  if (!this.qualityMonitoringInterval) {
    this.startQualityMonitoring();
    
    // モニタリングが開始されたか確認
    if (!this.qualityMonitoringInterval) {
      console.error('品質モニタリングの開始に失敗しました');
    } else {
      console.log('品質モニタリングが正常に開始されました');
    }
  }
}

  async leaveRoom() {
    try {
      console.log('退室処理を開始します');
      
      // 品質モニタリングを停止
      this.stopQualityMonitoring();
       // 品質回復タイマーをクリア
      this.clearQualityRecoveryTimeouts();
      if (this.room) {
        await this.room.leave();
        this.room = undefined;
        console.log('ルームから正常に退室しました');
      }
      this.cleanupUI()

            // 状態をリセット
      this.lastMetrics = null;
      this.qualityHistory = [];
      this.currentRetryAttempt = 0;
      console.log('退室処理が完了しました。Room状態:', {
        hasRoom: !!this.room,
        subscriptions: this.room
      });
    } catch (error) {
      console.error("退室エラー:", error)
      throw error
    }
  }

  private cleanupUI() {
      // メッセージ履歴をクリア
    if (this.messageArea) {
      this.messageArea.innerHTML = '';
    }

    // リモートメディアエリアをクリア
    if (this.templeElement.remoteMediaArea) {
      this.templeElement.remoteMediaArea.innerHTML = ""
    }

    // 自分のIDをクリア
    if (this.templeElement.myId) {
      this.templeElement.myId.textContent = ""
    }

    // リモート音声エリアをクリア
    const audioContainer = document.getElementById("remote-audio-container")
    if (audioContainer) {
      audioContainer.innerHTML = ""
    }

    // リモート映像エリアをクリア
    const videoContainer = document.getElementById("remote-video-container")
    if (videoContainer) {
      videoContainer.innerHTML = ""
    }
  }

  // メッセージ表示関数
  private appendMessage(sender: string, content: string) {
    this.messageArea = document.getElementById("message-area")
    if (!this.messageArea) return

    const messageDiv = document.createElement("div")
    messageDiv.className = "message"

    const time = new Date().toLocaleTimeString()
    messageDiv.innerHTML = `
      <span class="sender">${this.escapeHtml(sender)}</span>
      <span class="time">${time}</span>
      <div class="content">${this.escapeHtml(content)}</div>
    `

    this.messageArea.appendChild(messageDiv)
    this.messageArea.scrollTop = this.messageArea.scrollHeight
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

  private async updateTestResults(testResult: ConnectivityTestResult) {
    this.connectivityContainer = document.getElementById("connectivity-test-results")
    if (!this.connectivityContainer) return

    // テスト結果を表示
    this.connectivityContainer.style.display = "block"
    this.connectivityContainer.classList.add("show")

    // 各要素の更新と状態に応じたクラス付与
    this.updateTestResultItem(
      this.connectivityContainer,
      "ice-connectivity",
      testResult.iceConnectivity ? "成功" : "失敗",
      testResult.iceConnectivity ? "success" : "error"
    )

    this.updateTestResultItem(
      this.connectivityContainer,
      "network-latency",
      `${testResult.networkLatency}ms`,
      testResult.networkLatency <= 100
        ? "success"
        : testResult.networkLatency <= 300
          ? "warning"
          : "error"
    )

    this.updateTestResultItem(
      this.connectivityContainer,
      "audio-support",
      testResult.audioSupported ? "利用可能" : "利用不可",
      testResult.audioSupported ? "success" : "error"
    )

    this.updateTestResultItem(
      this.connectivityContainer,
      "video-support",
      testResult.videoSupported ? "利用可能" : "利用不可",
      testResult.videoSupported ? "success" : "error"
    )

    this.updateTestResultItem(
      this.connectivityContainer,
      "recommended-type",
      testResult.recommendedConnectionType || "不明",
      testResult.recommendedConnectionType === "P2P" ? "success" : "warning"
    )

    this.updateTestResultItem(
      this.connectivityContainer,    
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
      console.warn("ステータス表示要素が見つかりま��ん")
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

  private async setInitialVideoQuality() {
    console.log("setInitialVideoQuality 起動");
    
    if (!this.stream.videoStream) return;

    try {
      const initialQuality = QUALITY_PRESETS.medium;
      await this.stream.videoStream.track?.applyConstraints({
        width: { 
          ideal: initialQuality.width,
          min: initialQuality.minWidth 
        },
        height: { 
          ideal: initialQuality.height,
          min: initialQuality.minHeight 
        },
        frameRate: { 
          ideal: initialQuality.frameRate,
          min: initialQuality.minFrameRate 
        }
      });
    } catch (error) {
      console.error('ビデオ品質の初期設定に失敗:', error);
    }
  }

  private startQualityMonitoring() {
    this.stopQualityMonitoring();

    if (!this.stream.videoStream) {
      console.warn('ビデオストリームが存在しないため、品質モニタリングを開始できません');
      return;
    }

    console.log('品質モニタリングを開始します');

      // 初期状態の確認
    console.log('初期状態:', {
      room: !!this.room,
      subscriptions: this.room ? Array.from(this.room.subscriptions.values()) : [],
      videoStream: !!this.stream.videoStream,
      videoTrack: !!this.stream.videoStream?.track
    });
    
    const intervalId = window.setInterval(async () => {
      try {
        if (!this.stream.videoStream?.track || !this.room) {
          console.warn('必要なリソースが存在しないため、モニタリングを停止します', {
            hasVideoTrack: !!this.stream.videoStream?.track,
            hasRoom: !!this.room
          });
          this.stopQualityMonitoring();
          return;
        }

        const settings = this.stream.videoStream?.track?.getSettings();
        const currentQuality = {
          width: settings?.width,
          height: settings?.height,
          frameRate: settings?.frameRate
        };

        // 現在の品質をログ出力
        // メトリクス取得前の状態確認
        console.log('メトリクス取得前の状態:', {
          subscriptionsCount: this.room.subscriptions.size,
          currentQuality
        });

        // ネットワーク品質メトリクスの取得
        const metrics = await this.getNetworkMetrics();
        console.log({metrics});
        console.log(this.connectivityContainer);
        
        if (metrics && this.connectivityContainer) {
          this.updateTestResultItem(
            this.connectivityContainer,
            "rtt",
            `${(metrics.roundTripTime * 1000).toFixed(1)}ms`,
            this.getRTTStatusClass(metrics.roundTripTime)
          );
  
          this.updateTestResultItem(
            this.connectivityContainer,
            "available-bitrate",
            `${(metrics.availableBitrate / 1000000).toFixed(1)}Mbps`,
            this.getBitrateStatusClass(metrics.availableBitrate)
          );
      
          this.updateTestResultItem(
            this.connectivityContainer,
            "connection-state",
            metrics.connectionState,
            this.getConnectionStatusClass(metrics.connectionState)
          );
    
          const qualityStatus = this.analyzeNetworkQuality(metrics);
          this.updateQualityHistory(qualityStatus);
          
          console.log('現在の品質態:', {
            currentQuality,
            networkMetrics: metrics,
            qualityStatus,
            history: this.qualityHistory
          });

          if (this.shouldUpgradeQuality()) {
            if (
              this.isQualityMaintained(currentQuality, QUALITY_PRESETS.medium) && 
              (
                (currentQuality.width || 0) < QUALITY_PRESETS.high.width ||
                (currentQuality.height || 0) < QUALITY_PRESETS.high.height ||
                (currentQuality.frameRate || 0) < QUALITY_PRESETS.high.frameRate
              )
            ) {
              console.log("ネットワーク状態が安定しているため、高品質への引き上げを試みます");
              this.attemptHighQuality();
            }
          } else if (this.shouldDowngradeQuality()) {
            console.log("ネットワーク状態が悪化しているため、品質を下げます");
            this.handleLowQuality();
          }
        }
        
      } catch (error) {
        console.error('品質モニタリングエラー:', error);
      }
    }, 5000) as unknown as NodeJS.Timeout; // 5秒ごとにモニタリング

    this.qualityMonitoringInterval = intervalId;
    console.log('品質モニタリングのインターバルID:', this.qualityMonitoringInterval);
  }

  private stopQualityMonitoring() {
    if (this.qualityMonitoringInterval) {
      console.log('品質モニタリングを停止します');
      window.clearInterval(this.qualityMonitoringInterval as NodeJS.Timeout);
      this.qualityMonitoringInterval = null;
    }
  }

  private async getNetworkMetrics(): Promise<NetworkQualityMetrics | null> {
    try {
      if (!this.room) {
        console.warn('ルームが存在しないため、メトリクスを取得できません');
        return null;
      }

      const subscriptions = Array.from(this.room?.subscriptions.values() || []);
      console.log('現在のサブスクリプション:', subscriptions);

      const videoSubscription = subscriptions.find(
        sub => sub.subscription.contentType === 'video'
      );
      
      if (!videoSubscription) {
        console.warn('ビデオサブスクリプションが見つかりません');
        return null;
      }

      const stats = await videoSubscription.subscription.getStats();
      console.log('取得したStats:', stats);

      if (!stats || stats.length === 0) {
        console.warn('統計情報が取得できません');
        return null;
      }

      const videoStats = stats.find(stat => stat.type === 'inbound-rtp' && stat.kind === 'video');
      const candidatePair = stats.find(stat => stat.type === 'candidate-pair' && stat.nominated);
      const transport = stats.find(stat => stat.type === 'transport');

      if (!videoStats || !candidatePair || !transport) {
        console.warn('必要な統計情報が不足しています:', {
          hasVideoStats: !!videoStats,
          hasCandidatePair: !!candidatePair,
          hasTransport: !!transport
        });
        return null;
      }

      return {
        // 基本メトリクス
        bytesReceived: videoStats.bytesReceived,
        packetsReceived: videoStats.packetsReceived,
        packetsLost: videoStats.packetsLost,
        nackCount: videoStats.nackCount,
        pliCount: videoStats.pliCount,
        timestamp: Date.now(),
        
        // 追加メトリクス
        roundTripTime: candidatePair.currentRoundTripTime,
        availableBitrate: candidatePair.availableOutgoingBitrate,
        jitter: videoStats.jitter,
        freezeCount: videoStats.freezeCount,
        freezeDuration: videoStats.totalFreezesDuration,
        connectionState: `ICE: ${transport.iceState}, DTLS: ${transport.dtlsState}`
      };
    } catch (error) {
      console.error('ネットワークメトリクス取得エラー:', error);
      return null;
    }
  }

  private analyzeNetworkQuality(metrics: NetworkQualityMetrics): 'good' | 'bad' {
    if (!this.lastMetrics) {
      this.lastMetrics = metrics;
      return 'good';
    }

    const timeDiff = (metrics.timestamp - this.lastMetrics.timestamp) / 1000; // 秒単位
    
    // パケットロス率の計算
    const totalPackets = metrics.packetsReceived + metrics.packetsLost;
    const lastTotalPackets = this.lastMetrics.packetsReceived + this.lastMetrics.packetsLost;
    const packetLossRate = 
      ((metrics.packetsLost - this.lastMetrics.packetsLost) / 
      (totalPackets - lastTotalPackets)) * 100;

    // スループットの計算 (bps)
    const throughput = 
      ((metrics.bytesReceived - this.lastMetrics.bytesReceived) * 8) / timeDiff;

    // NACK（再送要求）とPLI（キーフレーム要求）の増加率
    const nackRate = (metrics.nackCount - this.lastMetrics.nackCount) / timeDiff;
    const pliRate = (metrics.pliCount - this.lastMetrics.pliCount) / timeDiff;

    this.lastMetrics = metrics;

    // 品質判定の基準値
    const isGoodQuality = 
      packetLossRate < 5 && // パケットロス率5%未満
      throughput > 500000 && // スループット500kbps以上
      nackRate < 5 && // 1秒あたりのNACK数5未満
      pliRate < 2; // 1秒あたりのPLI数2未満

    return isGoodQuality ? 'good' : 'bad';
  }

  private updateQualityHistory(quality: 'good' | 'bad') {
    this.qualityHistory.push(quality);
    if (this.qualityHistory.length > this.HISTORY_SIZE) {
      this.qualityHistory.shift();
    }
  }

  private shouldUpgradeQuality(): boolean {
    const goodCount = this.qualityHistory.filter(q => q === 'good').length;
    return goodCount >= Math.ceil(this.HISTORY_SIZE * 0.8);
  }

  private shouldDowngradeQuality(): boolean {
    const badCount = this.qualityHistory.filter(q => q === 'bad').length;
    return badCount >= Math.ceil(this.HISTORY_SIZE * 0.5);
  }

  private handleLowQuality() {
    // ユーザーに通知
    this.showQualityWarning(
      '通信品質が低下しています。ネットワーク環境をご確認ください。'
    );

    // 必要に応じて品質回復のための処理
    this.attemptQualityRecovery();
  }

  private showQualityWarning(message: string) {
    const warningElement = document.createElement('div');
    warningElement.className = 'quality-warning';
    warningElement.textContent = message;
    
    // スタイル設定
    Object.assign(warningElement.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      padding: '10px 20px',
      backgroundColor: 'rgba(255, 193, 7, 0.9)',
      color: '#000',
      borderRadius: '4px',
      zIndex: '1000'
    });
    
    document.body.appendChild(warningElement);
    
    // 10秒後に警告を消す
    setTimeout(() => warningElement.remove(), 10000);
  }

  private async attemptQualityRecovery() {
    if (!this.stream.videoStream?.track) return;

    try {
      // 既存のタイマーをクリア
      this.clearQualityRecoveryTimeouts();
      // 一度低品質に落として、徐々に回復を試みる
      await this.stream.videoStream.track.applyConstraints({
        width: { ideal: QUALITY_PRESETS.low.width },
        height: { ideal: QUALITY_PRESETS.low.height },
        frameRate: { ideal: QUALITY_PRESETS.low.frameRate }
      });

      // 30秒後に中品質への回復を試みる
      const mediumQualityTimeout = window.setTimeout(async () => {
        try {
          await this.stream.videoStream?.track?.applyConstraints({
            width: { ideal: QUALITY_PRESETS.medium.width },
            height: { ideal: QUALITY_PRESETS.medium.height },
            frameRate: { ideal: QUALITY_PRESETS.medium.frameRate }
          });

          // さらに30秒後に高品質への回復を試みる
          const highQualityTimeout = window.setTimeout(async () => {
            try {
              const settings = this.stream.videoStream?.track?.getSettings();
              const currentQuality = {
                width: settings?.width,
                height: settings?.height,
                frameRate: settings?.frameRate
              };

              // 中品質維持でている場合のみ高品質に引き上げる
              if (this.isQualityMaintained(currentQuality, QUALITY_PRESETS.medium)) {
                console.log("高品質に引き上げます");
                
                await this.stream.videoStream?.track?.applyConstraints({
                  width: { ideal: QUALITY_PRESETS.high.width },
                  height: { ideal: QUALITY_PRESETS.high.height },
                  frameRate: { ideal: QUALITY_PRESETS.high.frameRate }
                });
                console.log('高品質に引き上げました');
              }
            } catch (error) {
              console.error('高品質への引き上げに失敗:', error);
            }
          }, 30000); // さらに30秒後

          this.qualityRecoveryTimeouts.push(highQualityTimeout);

        } catch (error) {
          console.error('中品質への回復に失敗:', error);
        }
      }, 30000); // 30秒後

      this.qualityRecoveryTimeouts.push(mediumQualityTimeout);

    } catch (error) {
      console.error('品質調整に失敗:', error);
    }
  }

  // タイマーをクリアするメソッドを追加
  private clearQualityRecoveryTimeouts() {
    this.qualityRecoveryTimeouts.forEach(timeoutId => {
      window.clearTimeout(timeoutId);
    });
    this.qualityRecoveryTimeouts = [];
  }

  // 高品質への引き上げを試みるメソッドを追加
  private async attemptHighQuality() {
    if (!this.stream.videoStream?.track) return;

    try {
      console.log('高品質への引き上げを試みます');
      await this.stream.videoStream.track.applyConstraints({
        width: { 
          ideal: QUALITY_PRESETS.high.width,
          min: QUALITY_PRESETS.high.minWidth 
        },
        height: { 
          ideal: QUALITY_PRESETS.high.height,
          min: QUALITY_PRESETS.high.minHeight 
        },
        frameRate: { 
          ideal: QUALITY_PRESETS.high.frameRate,
          min: QUALITY_PRESETS.high.minFrameRate 
        }
      });
      
      // 成功通知
      this.showQualityInfo('通信品質が安定したため、高品質モードに切り替えました。');
      console.log('高品質に引き上げました');
      
    } catch (error) {
      console.error('高品質への引き上げに失敗:', error);
    }
  }

  // 情報通知用のメソッドを追加
  private showQualityInfo(message: string) {
    const infoElement = document.createElement('div');
    infoElement.className = 'quality-info';
    infoElement.textContent = message;
    
    // スタイル設定
    Object.assign(infoElement.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      padding: '10px 20px',
      backgroundColor: 'rgba(33, 150, 243, 0.9)', // 青系の色を使用
      color: '#fff',
      borderRadius: '4px',
      zIndex: '1000'
    });
    
    document.body.appendChild(infoElement);
    
    // 5秒後に通知を消す
    setTimeout(() => infoElement.remove(), 5000);
  }

  private isQualityMaintained(
    currentQuality: {
      width?: number;
      height?: number;
      frameRate?: number;
    },
    targetQuality: VideoQualityPreset
  ): boolean {
    // 現在の品質が目標品質の90%以上を維持できているかチェック
    return (
      (currentQuality.width || 0) >= (targetQuality.minWidth || 0) &&
      (currentQuality.height || 0) >= (targetQuality.minHeight || 0) &&
      (currentQuality.frameRate || 0) >= (targetQuality.minFrameRate || 0)
    );
  }

  private getRTTStatusClass(rtt: number): 'success' | 'warning' | 'error' {
    if (rtt < 0.1) return 'success';  // 100ms未満
    if (rtt < 0.3) return 'warning';  // 300ms未満
    return 'error';
  }
  
  private getBitrateStatusClass(bitrate: number): 'success' | 'warning' | 'error' {
    if (bitrate > 2000000) return 'success';  // 2Mbps以上
    if (bitrate > 1000000) return 'warning';  // 1Mbps以上
    return 'error';
  }
  
  private getConnectionStatusClass(state: string): 'success' | 'warning' | 'error' {
    return state.includes('connected') ? 'success' : 'warning';
  }

  private handleConnectionStateChange(state: string) {
    // 状態に応じたメッセージとアクション
    const stateActions: Record<string, { 
      message: string, 
      type: 'info' | 'warning' | 'error',
      action: () => void 
    }> = {
      'connecting': {
        message: '接続を確立しています...',
        type: 'info',
        action: () => this.showLoadingIndicator()
      },
      'connected': {
        message: '接続が確立されました',
        type: 'info',
        action: () => {
          this.hideLoadingIndicator();
          this.ensureQualityMonitoring(); // 接続確立後に品質モニタリングを開始
        }
      },
      'disconnected': {
        message: '接続が切断されました。再接続を試みます...',
        type: 'warning',
        action: () => this.attemptReconnection()
      },
      'failed': {
        message: '接続に失敗しました。ネットワーク環境をご確認ください',
        type: 'error',
        action: () => this.handleConnectionFailure()
      }
    };

    const stateInfo = stateActions[state] || {
      message: `接続状態が変更されました: ${state}`,
      type: 'info',
      action: () => {}
    };

    // ユーザーへの通知
    this.showNotification(stateInfo.message, stateInfo.type);
    
    // 対応するアクションの実行
    stateInfo.action();
  }

  private showNotification(message: string, type: 'info' | 'warning' | 'error') {
    const notificationElement = document.createElement('div');
    notificationElement.className = `connection-notification ${type}`;
    notificationElement.textContent = message;

    // スタイル設定
    Object.assign(notificationElement.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      padding: '12px 20px',
      borderRadius: '4px',
      zIndex: '1000',
      animation: 'fadeInOut 4s ease-in-out',
      backgroundColor: type === 'error' ? 'rgba(244, 67, 54, 0.9)' :
                      type === 'warning' ? 'rgba(255, 193, 7, 0.9)' :
                      'rgba(33, 150, 243, 0.9)',
      color: '#fff'
    });

    document.body.appendChild(notificationElement);
    setTimeout(() => notificationElement.remove(), 4000);
  }

  private async attemptReconnection(retryCount = 0, maxRetries = 3) {
    if (retryCount >= maxRetries) {
      this.showNotification('再接続に失敗しました。ページを更新してください。', 'error');
      return;
    }

    try {
      await new Promise(resolve => setTimeout(resolve, 2000 * (retryCount + 1))); // 指数バックオフ
      // 再接続ロジックの実装
      // ...

    } catch (error) {
      console.error('再接続失敗:', error);
      await this.attemptReconnection(retryCount + 1, maxRetries);
    }
  }

  private handleConnectionFailure() {
    // 接続失敗時の処理
    this.cleanupTestResources();
    this.showRetryDialog();
  }

  private showLoadingIndicator() {
    if (this.loadingIndicator) return;

    this.loadingIndicator = document.createElement('div');
    this.loadingIndicator.className = 'loading-indicator';
    
    Object.assign(this.loadingIndicator.style, {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      background: 'rgba(0, 0, 0, 0.7)',
      padding: '20px',
      borderRadius: '8px',
      color: 'white',
      zIndex: '1000',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '10px'
    });

    this.loadingIndicator.innerHTML = `
      <div class="spinner" style="
        width: 40px;
        height: 40px;
        border: 4px solid #f3f3f3;
        border-top: 4px solid #3498db;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      "></div>
      <div>接続中...</div>
    `;

    // スピナーのアニメーションスタイルを追加
    const style = document.createElement('style');
    style.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);

    document.body.appendChild(this.loadingIndicator);
  }

  private hideLoadingIndicator() {
    if (this.loadingIndicator) {
      this.loadingIndicator.remove();
      this.loadingIndicator = null;
    }
  }

  // コンポーネントの破棄時にも確実にクリーンアップ
  public dispose() {
    console.log('VideoChat インスタンスの破棄を開始します');

    // イベントリスナーの削除
    window.removeEventListener('beforeunload', this.dispose);
    document.removeEventListener('keydown', this.dispose);
    this.clearQualityRecoveryTimeouts();
    this.stopQualityMonitoring();
    this.leaveRoom();

    console.log('VideoChat インスタンスの破棄が完了しました');
  }
}
