import { LocalAudioStream, LocalVideoStream } from "@skyway-sdk/room"

interface IStream {
  audioStream: LocalAudioStream | undefined
  videoStream: LocalVideoStream | undefined
}

export class Stream implements IStream {
  public audioStream: LocalAudioStream | undefined
  public videoStream: LocalVideoStream | undefined

  constructor(
    audioStream: LocalAudioStream | undefined,
    videoStream: LocalVideoStream | undefined
  ) {
    this.audioStream = audioStream
    this.videoStream = videoStream
  }
}
