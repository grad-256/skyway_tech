import { TempleElement } from "../../infrastructure/TempleElement"
import { VideoChat } from "../../main"
import { Stream } from "../entities/Stream"
import { VideoChatFactory } from "./VideoChatFactory"

export class ConcreteVideoChatFactory implements VideoChatFactory {
  createStream(): Stream {
    return new Stream(undefined, undefined)
  }

  createTempleElement(): TempleElement {
    return new TempleElement()
  }

  createVideoChat(stream: Stream, templeElement: TempleElement): VideoChat {
    return new VideoChat(stream, templeElement)
  }
}
