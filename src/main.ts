import {
  LocalP2PRoomMember,
  P2PRoom,
  SkyWayContext,
  SkyWayRoom,
  SkyWayStreamFactory
} from "@skyway-sdk/room"
import { token } from "./config/token"
import { Stream } from "./domain/entities/Stream"
import { TempleElement } from "./infrastructure/TempleElement"
import { VideoChatFactory } from "./domain/factories/VideoChatFactory"
import { ConcreteVideoChatFactory } from "./domain/factories/ConcreteVideoChatFactory"

interface IVideoChat {
  stream: Stream
  templeElement: TempleElement
  room: P2PRoom | undefined
  startChat(): Promise<void>
  createRoom(): Promise<void>
  joinRoom(): Promise<void>
}

export class VideoChat implements IVideoChat {
  public stream: Stream
  public templeElement: TempleElement
  public room: P2PRoom | undefined

  constructor(stream: Stream, templeElement: TempleElement) {
    this.stream = stream
    this.templeElement = templeElement
  }

  async startChat() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true
    })
    const { audio, video } =
      // @ts-ignore
      await SkyWayStreamFactory.createMicrophoneAudioAndCameraStream(stream)
    this.stream = new Stream(audio, video)
    video.attach(this.templeElement.localVideo)
    await this.templeElement.localVideo.play()
  }

  async createRoom() {
    if (this.templeElement.roomNameInput.value === "") return

    // MEMO: グローバルな情報を管理するオブジェクトです。認証・認可や、ログの設定などの情報を管理
    const context = await SkyWayContext.Create(token)

    // MEMO: もしすでに同じnameのroomが存在しなければ作成し、存在する場合にはそのroomを取得する
    const room = await SkyWayRoom.FindOrCreate(context, {
      type: "p2p",
      name: this.templeElement.roomNameInput.value
    })

    this.room = room
  }

  private createSubscribeAndAttach(me: LocalP2PRoomMember, publication: any) {
    if (publication.publisher.id === me.id) return

    if (!this.templeElement.subscribeButton) { // ボタンがまだ存在しない場合のみ作成
      this.templeElement.subscribeButton = document.createElement("button");
      this.templeElement.buttonArea.appendChild(this.templeElement.subscribeButton);
    }

    this.templeElement.subscribeButton.textContent = `${publication.publisher.id}: ${publication.contentType}`
    this.templeElement.buttonArea.appendChild(
      this.templeElement.subscribeButton
    )

    this.templeElement.subscribeButton.onclick = async () => {
      const { stream } = await me.subscribe(publication.id)

      let newMedia
      // @ts-ignore
      switch (stream.track.kind) {
        case "video":
          newMedia = document.createElement("video")
          newMedia.playsInline = true
          newMedia.autoplay = true
          break
        case "audio":
          newMedia = document.createElement("audio")
          newMedia.controls = true
          newMedia.autoplay = true
          break
        default:
          return
      }
      // @ts-ignore
      stream.attach(newMedia)
      this.templeElement.remoteMediaArea.appendChild(newMedia)
    }
  }

  // roomの作成と入室
  async joinRoom() {
    if (this.templeElement.roomNameInput.value === "") return

    await this.createRoom()

    // MEMO: 自分のIDを表示する
    const me = await this.room!.join()
    this.templeElement.myId.textContent = me.id

    // MEMO: Member オブジェクトの publish 関数の引数に、先ほど取得した audio と video を渡して、音声・映像を publish します。
    if (this.stream.audioStream) await me.publish(this.stream.audioStream)
    if (this.stream.videoStream) await me.publish(this.stream.videoStream)

    const subscribeAndAttach = this.createSubscribeAndAttach.bind(this, me)
    this.room!.publications.forEach(subscribeAndAttach)
    this.room!.onStreamPublished.add((e: any) =>
      subscribeAndAttach(e.publication)
    )
  }
}

window.addEventListener("load", async () => {
  const factory: VideoChatFactory = new ConcreteVideoChatFactory()
  const stream: Stream = factory.createStream()
  const templeElement: TempleElement = factory.createTempleElement()
  const videoChat: VideoChat = factory.createVideoChat(stream, templeElement)

  await videoChat.startChat()

  const joinButton = document.getElementById("join") as HTMLButtonElement
  joinButton?.addEventListener(
    "click",
    async () => {
      console.log("join")
      await videoChat.joinRoom()
    },
    false
  )

  //   videoChat.subscribeButton?.addEventListener("click", async () => {}, false)
})
