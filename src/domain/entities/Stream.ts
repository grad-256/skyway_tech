import { LocalAudioStream, LocalVideoStream, SkyWayStreamFactory } from "@skyway-sdk/room"

export class Stream {
  private _audioStream: LocalAudioStream | null = null;
  private _videoStream: LocalVideoStream | null = null;

  constructor() {}

  async initialize() {
    try {
      // ユーザーのメディアデバイスへのアクセスを要求
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true
      });

      // SkyWayのストリームを作成
      const { audio, video } = await SkyWayStreamFactory.createMicrophoneAudioAndCameraStream({
        video: {
          deviceId: mediaStream.getVideoTracks()[0].getSettings().deviceId
        },
        audio: {
          deviceId: mediaStream.getAudioTracks()[0].getSettings().deviceId
        }
      });

      this._audioStream = audio;
      this._videoStream = video;

      // ローカルビデオの表示
      const localVideo = document.getElementById("local-video") as HTMLVideoElement;
      if (localVideo && this._videoStream) {
        await this._videoStream.attach(localVideo);
        await localVideo.play().catch(e => {
          console.warn("自動再生に失敗しました。ユーザーの操作が必要かもしれません:", e);
        });
      }
    } catch (error) {
      console.error("ストリーム初期化エラー:", error);
      throw error;
    }
  }

  get audioStream(): LocalAudioStream | null {
    return this._audioStream;
  }

  get videoStream(): LocalVideoStream | null {
    return this._videoStream;
  }

  async release() {
    try {
      if (this._audioStream) {
        await this._audioStream.release();
        this._audioStream = null;
      }
      if (this._videoStream) {
        await this._videoStream.release();
        this._videoStream = null;
      }
    } catch (error) {
      console.error("ストリーム解放エラー:", error);
      throw error;
    }
  }
}
