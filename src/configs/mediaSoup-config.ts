
import { WorkerLogLevel, WorkerLogTag } from "mediasoup/node/lib/WorkerTypes";

interface WorkerConfig {
  logLevel: WorkerLogLevel;
  logTags?: WorkerLogTag[];
  rtcMinPort: number;
  rtcMaxPort: number;
}

interface RouterConfig {
  mediaCodecs: any[]; // (you can type this later)
}

interface WebRtcTransportConfig {
  listenIps: { ip: string; announcedIp?: string }[];
  maxIncomingBitrate: number;
  initialAvailableOutgoingBitrate: number;
}

interface AppConfig {
  worker: WorkerConfig;
  router: RouterConfig;
  webRtcTransport: WebRtcTransportConfig;
}


const config: AppConfig = {
  // Worker settings
  worker: {
    rtcMinPort: 2000,
    rtcMaxPort: 2020, // OPEN THESE PORTS ON FIREWALL
    logLevel: 'warn',
    logTags: [ 'info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp' ],
  },
  // Router settings (Codecs)
  router: {
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2
      },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
          'x-google-start-bitrate': 1000
        }
      },
    ]
  },
  // Transport settings
  webRtcTransport: {
    listenIps: [
      {
        ip: '0.0.0.0', // Listen on all interfaces
        announcedIp: '10.240.48.223' // REPLACE with Public IP on production!
      }
    ],
    maxIncomingBitrate: 1500000,
    initialAvailableOutgoingBitrate: 1000000,
  },
  
};

export default config