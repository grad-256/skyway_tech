import {
  P2PRoom,
  LocalP2PRoomMember,
  LocalStream,
  LocalDataStream,
  RemoteDataStream,
  RoomSubscription,
  RemoteStream,
  StreamPublishedEvent
} from "@skyway-sdk/room"

export class Room {
  private localMember: LocalP2PRoomMember | null = null
  private messageStream: LocalDataStream | null = null
  private subscriptions: Map<
    string,
    {
      subscription: RoomSubscription<RemoteStream>
      stream: RemoteStream
    }
  > = new Map()
  private messageCallbacks: Set<(event: MessageEvent) => void> = new Set()

  constructor(private skyWayRoom: P2PRoom) {}

  onMessageReceived(callback: (event: MessageEvent) => void) {
    this.messageCallbacks.add(callback)
  }

  async initializeMessaging() {
    if (!this.localMember) throw new Error("メンバーが参加していません")

    try {
      // LocalDataStreamを作成
      const dataStream = new LocalDataStream()
      this.messageStream = dataStream

      // データストリームを公開
      const publication = await this.localMember.publish(dataStream)
      console.log("データストリームを公開しました:", {
        id: publication.id,
        publisher: publication.publisher.id,
        contentType: publication.contentType
      })

      // 既存のパブリケーションを確認
      const publications = this.getRemotePublications()
      console.log("既存のパブリケーション:", publications.length)

      // 既存データストリームを購読
      for (const pub of publications) {
        if (
          pub.contentType === "data" &&
          pub.publisher.id !== this.localMember.id
        ) {
          console.log("既存のデータストリームを発見:", pub.id)
          await this.trySubscribeToMessages(pub.id)
        }
      }
    } catch (error) {
      console.error("メッセージング初期化エラー:", error)
      throw error
    }
  }

  private async trySubscribeToMessages(publicationId: string) {
    if (this.subscriptions.has(publicationId)) return

    try {
      const subscription = await this.localMember!.subscribe(publicationId)
      if (subscription.stream instanceof RemoteDataStream) {
        this.subscriptions.set(publicationId, subscription)

        subscription.stream.onData.add(data => {
          try {
            console.log("データストリームからメッセージを受信:", data)

            const senderId = "unknown"
            const senderName = "匿名"

            const messageEvent: MessageEvent = {
              data,
              sender: {
                id: senderId,
                name: senderName
              }
            }

            this.messageCallbacks.forEach(cb => {
              try {
                cb(messageEvent)
              } catch (error) {
                console.error("メッセージコールバックエラー:", error)
              }
            })
          } catch (error) {
            console.error("メッセージ処理エラー:", error)
          }
        })
      }
    } catch (error) {
      console.warn("購読試行エラー:", publicationId, error)
    }
  }

  async sendMessage(message: string) {
    if (!this.messageStream)
      throw new Error("メッセージングが初期化されていません")
    console.log("メッセージを送信します:", message)
    this.messageStream.write(message)
  }

  get events() {
    return {
      onMemberJoined: this.skyWayRoom.onMemberJoined,
      onMemberLeft: this.skyWayRoom.onMemberLeft,
      onStreamPublished: {
        add: (callback: (event: StreamPublishedEvent) => void) => {
          this.skyWayRoom.onStreamPublished.add(async event => {
            const publication = event.publication
            if (
              publication.contentType === "data" &&
              publication.publisher.id !== this.localMember?.id
            ) {
              await this.trySubscribeToMessages(publication.id)
            } else {
              callback(event)
            }
          })
        }
      },
      onStreamUnpublished: this.skyWayRoom.onStreamUnpublished,
      onPublicationSubscribed: {
        add: (callback: (event: any) => void) => {
          this.skyWayRoom.onPublicationSubscribed.add(event => {
            const { subscription } = event
            if (subscription.stream instanceof RemoteDataStream) {
              subscription.stream.onData.add(data => {
                try {
                  const messageEvent = {
                    data,
                    subscription,
                    sender: {
                      id: subscription.publication.publisher.id,
                      name: subscription.publication.publisher.name || "匿名"
                    }
                  }
                  this.messageCallbacks.forEach(cb => cb(messageEvent))
                } catch (error) {
                  console.error("メッセージ処理エラー:", error)
                }
              })
            }
            callback(event)
          })
        }
      }
    }
  }

  async subscribeToMessages(publicationId: string) {
    if (!this.localMember) throw new Error("メンバーが参加していません")
    if (this.subscriptions.has(publicationId)) {
      console.log("既に購読済みのパブリケーション:", publicationId)
      return this.subscriptions.get(publicationId)!
    }

    try {
      console.log("メッセージを購読します:", publicationId)
      const subscription = await this.localMember.subscribe(publicationId)

      if (subscription.stream instanceof RemoteDataStream) {
        this.subscriptions.set(publicationId, subscription)
        console.log("データストリームの購読完了:", publicationId)
      }

      return subscription
    } catch (error) {
      console.error("メッセージ購読エラー:", error)
      throw error
    }
  }

  async join(): Promise<LocalP2PRoomMember> {
    try {
      this.localMember = await this.skyWayRoom.join()
      return this.localMember
    } catch (error) {
      console.error("ルーム参加エラー:", error)
      throw error
    }
  }

  getLocalMember() {
    return this.localMember
  }

  async publishStream(stream: LocalStream) {
    if (!this.localMember) throw new Error("メンバーが参加していません")
    return await this.localMember.publish(stream)
  }

  async subscribeStream(publicationId: string) {
    if (!this.localMember) throw new Error("メンバーが参加していません")
    if (this.subscriptions.has(publicationId)) {
      console.log("既に購読済みのストリーム:", publicationId)
      return this.subscriptions.get(publicationId)!
    }

    try {
      const subscription = await this.localMember.subscribe(publicationId)
      this.subscriptions.set(publicationId, subscription)
      return subscription
    } catch (error) {
      console.error("ストリーム購読エラー:", error)
      throw error
    }
  }

  getRemotePublications() {
    return Array.from(this.skyWayRoom.publications.values())
  }

  async leave() {
    if (this.localMember) {
      await this.localMember.leave()
      this.localMember = null
    }
  }
}

// メッセージ受信イベントの型定義を追加
interface MessageEvent {
  data: any
  sender: {
    id: string
    name: string
  }
}
