import {
  P2PRoom,
  LocalP2PRoomMember,
  Publication,
  LocalStream,
  LocalDataStream,
  RemoteDataStream,
  RoomSubscription
} from "@skyway-sdk/room"

export class Room {
  private localMember: LocalP2PRoomMember | null = null
  private messageStream: LocalDataStream | null = null
  private subscriptions: Map<string, RoomSubscription> = new Map()
  private messageCallbacks: Set<(data: any) => void> = new Set()

  constructor(private skyWayRoom: P2PRoom) {}

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

      // 既存のデータストリームを購読
      for (const pub of publications) {
        if (pub.contentType === 'data' && 
            pub.publisher.id !== this.localMember.id) {
          console.log("既存のデータストリームを発見:", pub.id)
          await this.trySubscribeToMessages(pub.id)
        }
      }

      this.isInitialized = true
    } catch (error) {
      console.error("メッセージング初期化エラー:", error)
      throw error
    }
  }

  private async trySubscribeToMessages(publicationId: string) {
    if (this.subscriptions.has(publicationId)) {
      console.log("既に購読済み:", publicationId)
      return
    }

    try {
      const subscription = await this.localMember!.subscribe(publicationId)
      if (subscription.stream instanceof RemoteDataStream) {
        this.subscriptions.set(publicationId, subscription)
        console.log("購読成功:", publicationId)
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
        add: (callback: (event: { publication: Publication }) => void) => {
          this.skyWayRoom.onStreamPublished.add(async (event) => {
            const publication = event.publication
            if (publication.contentType === 'data' && 
                publication.publisher.id !== this.localMember?.id) {
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
          this.skyWayRoom.onPublicationSubscribed.add((event) => {
            const { subscription } = event
            if (subscription.stream instanceof RemoteDataStream) {
              subscription.stream.onData.add((data) => {
                this.messageCallbacks.forEach(cb => cb({
                  data,
                  subscription,
                  publisher: subscription.publication.publisher
                }))
              })
            }
            callback(event)
          })
        }
      }
    }
  }

  // メッセージ受信コールバックの登録
  onDataReceived(callback: (data: any) => void) {
    this.messageCallbacks.add(callback)
    
    // 既存の購読済みデータストリームにもコールバックを設定
    this.subscriptions.forEach(subscription => {
      if (subscription.stream instanceof RemoteDataStream) {
        subscription.stream.onData.add((data) => {
          callback({
            data,
            subscription,
            publisher: subscription.publication.publisher
          })
        })
      }
    })
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
