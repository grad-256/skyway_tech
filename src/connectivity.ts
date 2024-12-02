import { 
    SkyWayContext, 
    SkyWayRoom, 
    LocalP2PRoomMember,
    RoomPublication,
    LocalVideoStream,
    TransportConnectionState,
    P2PRoom
  } from '@skyway-sdk/room';
  import { SkyWayStreamFactory } from '@skyway-sdk/room';
  
  interface ConnectivityTestResult {
    iceConnectivity: boolean;
    networkLatency: number;
    audioSupported: boolean;
    videoSupported: boolean;
    recommendedConnectionType: 'P2P' | 'SFU' | null;
    connectionState: TransportConnectionState;
  }
  
  export class SkyWayConnectivityTest {
    private context: SkyWayContext;
    private testRoom: P2PRoom | null = null;
    private localMember: LocalP2PRoomMember | null = null;
    private publication: RoomPublication<LocalVideoStream> | null = null;
  
    constructor(context: SkyWayContext) {
      this.context = context;
    }
  
    async runConnectivityTest(): Promise<ConnectivityTestResult> {
      try {
        // テスト用のルームを作成
        this.testRoom = await SkyWayRoom.FindOrCreate(this.context, {
          type: 'p2p',
          name: `test-room-${Date.now()}`
        });
        // テストルームに参加
        this.localMember = await this.testRoom?.join();
        // メディアデバイスのテスト
        const mediaTestResult = await this.testMediaDevices();
        // 実際の通信テスト
        const { iceTestResult, connectionState } = await this.testConnection();
        
        // ネットワークレイテンシーテスト
        const latency = await this.measureNetworkLatency();
  
        return {
          iceConnectivity: iceTestResult,
          networkLatency: latency,
          audioSupported: mediaTestResult.audio,
          videoSupported: mediaTestResult.video,
          recommendedConnectionType: this.determineRecommendedConnectionType(latency),
          connectionState
        };
      } catch (error) {
        console.error('Connectivity test failed:', error);
        // エラー時のフォールバック値を返す
        return {
          iceConnectivity: false,
          networkLatency: 2000,
          audioSupported: false,
          videoSupported: false,
          recommendedConnectionType: null,
          connectionState: 'disconnected' as TransportConnectionState
        };
      } finally {
        await this.cleanup();
      }
    }
  
    private async testMediaDevices(): Promise<{ audio: boolean; video: boolean }> {
      try {
        // SkyWayStreamFactoryを使用
        const video = await SkyWayStreamFactory.createCameraVideoStream()
          .catch(() => null);
        const audio = await SkyWayStreamFactory.createMicrophoneAudioStream()
          .catch(() => null);
  
        return {
          audio: !!audio,
          video: !!video
        };
      } catch (error) {
        console.warn('Media device test failed:', error);
        return { audio: false, video: false };
      }
    }
  
    private async testConnection(): Promise<{ 
      iceTestResult: boolean; 
      connectionState: TransportConnectionState 
    }> {
      try {
        // テスト用のビデオストリームをPublish
        const video = await SkyWayStreamFactory.createCameraVideoStream();
        this.publication = await this.localMember!.publish(video);
  
        // 接続状態の確認
        return new Promise((resolve) => {
          setTimeout(async () => {
            const transport = await video._getTransport(this.localMember!.id);
            const state = transport?.connectionState || 'disconnected';
            resolve({
              iceTestResult: state === 'connected',
              connectionState: state as TransportConnectionState
            });
          }, 3000);
        });
      } catch (error) {
        console.error('Connection test failed:', error);
        return {
          iceTestResult: false,
          connectionState: 'disconnected' as TransportConnectionState
        };
      }
    }
  
    private async measureNetworkLatency(): Promise<number> {
      try {
        const measurements: number[] = [];
        
        // STUN/TURNサーバーへの接続時間を測定
        const pc = new RTCPeerConnection({
          iceServers: [{
            urls: 'stun:stun.l.google.com:19302'
          }]
        });

        const startTime = performance.now();
        
        return new Promise((resolve) => {
          // ICE candidate生成時の処理
          pc.onicecandidate = (event) => {
            if (event.candidate) {
              const elapsed = performance.now() - startTime;
              measurements.push(elapsed);
            }
          };

          // タイムアウト処理（5秒）
          setTimeout(() => {
            pc.close();
            if (measurements.length === 0) {
              resolve(2000); // タイムアウト時は高遅延として扱う
            } else {
              // 測定値の平均を計算
              const avgLatency = measurements.reduce((a, b) => a + b, 0) / measurements.length;
              resolve(Math.round(avgLatency));
            }
          }, 5000);

          // 接続プロセスを開始
          pc.createDataChannel("test");
          pc.createOffer()
            .then(offer => pc.setLocalDescription(offer))
            .catch(() => resolve(2000));
        });

      } catch (error) {
        console.warn('Network latency test failed:', error);
        return 2000;  // エラー時は高遅延として扱う
      }
    }
  
    private determineRecommendedConnectionType(latency: number): 'P2P' | 'SFU' | null {
      if (latency < 0) return null;
      if (latency <= 100) return 'P2P';
      if (latency <= 300) return 'P2P';  // 閾値を緩和
      return 'SFU';
    }
  
    private async cleanup(): Promise<void> {
      try {
        if (this.publication) {
          await this.localMember?.unpublish(this.publication.id);
          this.publication = null;
        }
        if (this.localMember) {
          await this.localMember.leave();
          this.localMember = null;
        }
        if (this.testRoom) {
          await this.testRoom.dispose();
          this.testRoom = null;
        }
        
        // オーディオ要素のクリーンアップ
        const audioContainer = document.getElementById('remote-audio-container');
        if (audioContainer) {
          const testAudios = audioContainer.querySelectorAll('audio[data-publisher-id*="test-room"]');
          testAudios.forEach(audio => audio.remove());
        }
      } catch (error) {
        console.error('Cleanup error:', error);
      }
    }
  }
  