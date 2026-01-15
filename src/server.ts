const mediasoup = require('mediasoup');
const config = require('./configs/mediaSoup-config');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

let worker;
let router;
let producers = [];
let consumers = [];
let transports = [];

// 1. Start Mediasoup
(async () => {
  worker = await mediasoup.createWorker(config.worker);
  
  worker.on('died', () => {
    console.error('mediasoup worker died, exiting in 2 seconds... [pid:%d]', worker.pid);
    setTimeout(() => process.exit(1), 2000);
  });

  router = await worker.createRouter({ mediaCodecs: config.router.mediaCodecs });
  console.log('Mediasoup Router created');
})();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // --- A. HANDSHAKE ---
  // FIXED: Accepts (data, callback)
  socket.on('getRouterRtpCapabilities', (data, callback) => {
    router ? callback(router.rtpCapabilities) : callback({ error: "Router not ready" });
  });

  // --- B. CREATE TRANSPORT ---
  // FIXED: Accepts (data, callback)
  socket.on('createWebRtcTransport', async ({ sender }, callback) => {
    try {
      const transport = await router.createWebRtcTransport(config.webRtcTransport);
      
      transports.push({ socketId: socket.id, transport, consumer: !sender });

      callback({
        params: {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        }
      });
    } catch (error) {
      console.error(error);
      callback({ error: error.message });
    }
  });

  // --- C. CONNECT TRANSPORT ---
  socket.on('transport-connect', async ({ dtlsParameters, transportId }, callback) => {
    const transportObj = transports.find(t => t.transport.id === transportId);
    if (transportObj) {
      await transportObj.transport.connect({ dtlsParameters });
      callback(); // Success
    }
  });

  // --- D. PRODUCE ---
  socket.on('transport-produce', async ({ kind, rtpParameters, transportId }, callback) => {
    const transportObj = transports.find(t => t.transport.id === transportId);
    if (transportObj) {
      const producer = await transportObj.transport.produce({ kind, rtpParameters });
      
      producers.push({ socketId: socket.id, producer });

      callback({ id: producer.id });

      // Notify others
      socket.broadcast.emit('new-producer', { producerId: producer.id });
    }
  });

  // --- E. CONSUME ---
  socket.on('consume', async ({ producerId, rtpCapabilities, transportId }, callback) => {
    try {
      if (router.canConsume({ producerId, rtpCapabilities })) {
        const transportObj = transports.find(t => t.transport.id === transportId);
        
        const consumer = await transportObj.transport.consume({
          producerId,
          rtpCapabilities,
          paused: true,
        });

        consumers.push({ socketId: socket.id, consumer });

        callback({
          params: {
            id: consumer.id,
            producerId: producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
          }
        });
        
        await consumer.resume();
      }
    } catch (error) {
      console.error("Consume error", error);
      callback({ error: error.message });
    }
  });
});

httpServer.listen(3000, () => {
  console.log('Server running on port 3000');
});