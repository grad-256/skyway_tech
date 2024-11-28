import { P2PRoom, LocalP2PRoomMember, Publication, Member, LocalStream } from "@skyway-sdk/room";

export class Room {
  private localMember: LocalP2PRoomMember | null = null;

  constructor(private skyWayRoom: P2PRoom) {}

  async join(): Promise<LocalP2PRoomMember> {
    try {
      this.localMember = await this.skyWayRoom.join();
      return this.localMember;
    } catch (error) {
      console.error("ルーム参加エラー:", error);
      throw error;
    }
  }

  getLocalMember() {
    return this.localMember;
  }

  async publishStream(stream: LocalStream) {
    if (!this.localMember) throw new Error("メンバーが参加していません");
    return await this.localMember.publish(stream);
  }

  async subscribeStream(publicationId: string) {
    if (!this.localMember) throw new Error("メンバーが参加していません");
    return await this.localMember.subscribe(publicationId);
  }

  getRemotePublications() {
    return Array.from(this.skyWayRoom.publications.values());
  }

  get events() {
    return {
      onMemberJoined: this.skyWayRoom.onMemberJoined,
      onMemberLeft: this.skyWayRoom.onMemberLeft,
      onStreamPublished: this.skyWayRoom.onStreamPublished,
      onStreamUnpublished: this.skyWayRoom.onStreamUnpublished
    };
  }

  async leave() {
    if (this.localMember) {
      await this.localMember.leave();
      this.localMember = null;
    }
  }
} 