import { AbTempleElement } from "../interfaces/AbTempleElement"

export class TempleElement implements AbTempleElement {
  public localVideo: HTMLVideoElement | HTMLAudioElement
  public buttonArea: HTMLButtonElement
  public remoteMediaArea: HTMLButtonElement
  public roomNameInput: HTMLInputElement
  public myId: HTMLElement
  // public joinButton: HTMLButtonElement
  public subscribeButton: HTMLButtonElement

  // 通信状態表示用の要素を追加
  public connectionState: HTMLElement
  public bytesSent: HTMLElement
  public bytesReceived: HTMLElement
  public rtt: HTMLElement

  constructor() {
    this.localVideo = document.getElementById("local-video") as
      | HTMLVideoElement
      | HTMLAudioElement
    this.buttonArea = document.getElementById(
      "button-area"
    ) as HTMLButtonElement
    this.remoteMediaArea = document.getElementById(
      "remote-media-area"
    ) as HTMLButtonElement
    this.roomNameInput = document.getElementById(
      "room-name"
    ) as HTMLInputElement
    this.myId = document.getElementById("my-id") as HTMLElement
    // this.joinButton = document.getElementById("join") as HTMLButtonElement
    this.subscribeButton = document.createElement("button")

    this.connectionState = document.getElementById("connection-state") as HTMLElement
    this.bytesSent = document.getElementById("bytes-sent") as HTMLElement
    this.bytesReceived = document.getElementById("bytes-received") as HTMLElement
    this.rtt = document.getElementById("rtt") as HTMLElement
  }
}
