import { TempleElement } from "../../infrastructure/TempleElement"
import { VideoChat } from "../../main"
import { Stream } from "../entities/Stream"

export abstract class VideoChatFactory {
  abstract createStream(): Stream
  abstract createTempleElement(): TempleElement
  abstract createVideoChat(
    stream: Stream,
    templeElement: TempleElement
  ): VideoChat
}
