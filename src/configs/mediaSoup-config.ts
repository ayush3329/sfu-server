module.exports = {
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
        announcedIp: '127.0.0.1' // REPLACE with Public IP on production!
      }
    ],
    maxIncomingBitrate: 1500000,
    initialAvailableOutgoingBitrate: 1000000,
  }
};

