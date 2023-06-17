import { AbTempleElement } from "../interfaces/AbTempleElement"

export class TempleElement implements AbTempleElement {
  public localVideo: HTMLVideoElement | HTMLAudioElement
  public buttonArea: HTMLButtonElement
  public remoteMediaArea: HTMLButtonElement
  public roomNameInput: HTMLInputElement
  public myId: HTMLElement
  // public joinButton: HTMLButtonElement
  public subscribeButton: HTMLButtonElement

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
  }
}
