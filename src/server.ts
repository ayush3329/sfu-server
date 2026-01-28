import * as mediasoup from "mediasoup";
import express from "express";
import { Server } from "socket.io";
import config from "./configs/mediaSoup-config";
import http from "http";
import os from "os";
import { WebRtcTransport } from "mediasoup/node/lib/WebRtcTransportTypes";
import { Consumer, ConsumerTransport, ProducerTransport } from "./Types/types";
import User from "./Utility/User";
import PoolCollection from "./Utility/Pool";

const ResourcePool = new PoolCollection();
const app = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});


// Track Connected Users: SocketId -> User Info
const connectedUsers = new Map<string, { username: string, roomId: string, socketId: string }>();
const PORTDIFFERENCE = (config.worker.rtcMaxPort - config.worker.rtcMinPort) + 1;


const createWorkerPool = async () => {
  const numWorkers = os.cpus().length;
  for (let i = 0; i < numWorkers; i++) {
    const minPort = Number(config.worker.rtcMinPort) + (i * PORTDIFFERENCE);
    const maxPort = Number(config.worker.rtcMaxPort) + (i * PORTDIFFERENCE);
    await ResourcePool.spawnNewWorker(i, minPort, maxPort);
  }
};

io.on('connection', (socket) => {

  const { username, roomId } = socket.handshake.query as { username?: string; roomId?: string; };
  
  console.log('\nUser connected:', username," ", socket.id, " ", roomId, );

  if (!roomId || !username) {
    socket.emit('missing-detail', {
      message: "Username or roomId is missing"
    })
    return;
  }

  const user = new User(username, roomId, socket.id);
  
  // 1. Add to User Map and Notify Room
  connectedUsers.set(socket.id, { username, roomId, socketId: socket.id });

  // 2. Send list of existing users to the new client
  const usersInRoom = Array.from(connectedUsers.values()).filter(u => u.roomId === roomId && u.socketId !== socket.id);
  socket.emit('all-users', usersInRoom);

  // 3. Notify others that a new user joined (Peer, not just producer)
  socket.to(roomId).emit('user-joined', { socketId: socket.id, username });

  socket.join(roomId);

  // A. Client will ask rtpCapability of room
  socket.on('getRouterRtpCapabilities', async ({ roomId }, callback) => {
    try {
      console.log("getRouterRtpCapabilities");
      const room = await ResourcePool.createRoom(roomId, user);
      callback(room.rtpCapabilities);
    } catch (e: any) {
      callback({ error: e.message });
    }
  });

  //B. Client emits a request to create server side Transport
  // We need to differentiate between the producer and consumer transports
  socket.on('createWebRtcTransport', async ({ sender, roomId }, callback) => {
    try {
      const roomRouter = await ResourcePool.getRoomRouter(roomId, user);
      const transport: WebRtcTransport = await roomRouter.createWebRtcTransport(config.webRtcTransport);

      if(sender){
          // If sender = true, it means client want to create a producerTransport

          const transportData: ProducerTransport = {
            consumer: !sender,
            roomId: roomId,
            socketId: socket.id,
            transport,
    
            audioProducer: null,
            screenProducer: null,
            videoProducer: null,
          };
          console.log(`${user.name} successfully created Producertransport with id ${transport.id}\n`)
          ResourcePool.saveProducerTransport(transport.id, transportData);
          user.setProducerTransport(transport.id);

      } else{
          // If sender = false, it means client want to create a consumerTransport

          const transportData: ConsumerTransport = {
            consumer: !sender,
            roomId: roomId,
            socketId: socket.id,
            transport,
    
            audioConsumer: null,
            screenConsumer: null,
            videoConsumer: null,
          };

          console.log(`${user.name} successfully created consumertransport with id ${transport.id}\n`)
          ResourcePool.saveConsumerTransport(transport.id, transportData);
          user.setConsumerTransport(transport.id);

      }

      callback({
        params: {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        }
      });
    } catch (error: any) {
      callback({ error: error.message });
    }
  });

  // C. Client sends its dtlsParameters and connect to producer-transport 
  socket.on('producer-transport-connect', async ({ dtlsParameters, transportId }, callback) => {

    console.log(`(producer-transport-connect) ${user.name} sends its dtls Params `, dtlsParameters);
    
    const producerTransport = ResourcePool.getProducerTransort(transportId);

    if (producerTransport) {
      await producerTransport.transport.connect({ dtlsParameters });
      console.log(`Successfully connected ${user.name}'s client Side producerTransport with server side producerTransport with id: `, transportId, "\n\n");
      callback();
    } else{
      console.log("Failed to connect dtls params");
    }

  });

  // C. Client sends its dtlsParameters and connect to consumer-transport
  socket.on('consumer-transport-connect', async ({ dtlsParameters, transportId }, callback) => {

    console.log(`(consumer-transport-connect) ${user.name} sends its dtls Params `, dtlsParameters);
    
      const consumerTransport = ResourcePool.getConsumerTransort(transportId);
  
      if (consumerTransport){
        await consumerTransport.transport.connect({ dtlsParameters });
        console.log(`Successfully connected ${user.name}'ss client Side consumerTransport with server side consumerTransport with id: `, transportId, "\n\n");
        callback();
      } else{
        console.log("Failed to connect dtls params");
      }
    

  });

  // D. Client want to create Producer, so that it can send audio or video stream
  socket.on('transport-produce', async ({ kind, rtpParameters, transportId }, callback) => {

    // Client want to create an audio (or video or screen share) producer inside its producerTransport
    const producerTransport = ResourcePool.getProducerTransort(transportId);

    if(!producerTransport){
      console.log("Producer transport does not exist");
      return;
    }

    const producer = await producerTransport.transport.produce({kind, rtpParameters});

    const data = {
      producer, 
      roomId: user.roomId, 
      transportId, socketId: 
      socket.id, 
      username: user.name
    }

    if(kind === "video"){
      
      // save Video Prodcuer
      ResourcePool.saveVideoProducer(producer.id, data);
      ResourcePool.updateProducerTransport(transportId, "video", producer.id);

      console.log(`${user.name} created Video Producer with id ${producer.id}`);
      console.log(`packet ssrc -> `, rtpParameters.encodings[0].ssrc, "\n\n");
      
    } else if(kind === "audio"){
      
      // save audio Producer
      ResourcePool.saveAudioProducer(producer.id, data);
      ResourcePool.updateProducerTransport(transportId, "audio", producer.id);

      console.log(`${user.name} created audio Producer with id ${producer.id}`);
      console.log(`packet ssrc -> `, rtpParameters.encodings[0].ssrc, "\n\n");
      
    } else{
      console.log("Does not support Screen share transport yet")
    }
    
    // Notify others (Include socketId so they know WHO produced)
    
    callback({ id: producer.id, kind });

    producer.on('transportclose', () => {
      console.log('Video Producer transport closed');
      producer.close();
    });


    socket.to(producerTransport.roomId).emit('new-producer', {
      producerId: producer.id,
      roomId: producerTransport.roomId,
      kind,
      socketId: socket.id // Add this
    });
      
    

  });
  
  // E. Client want to consumer stream of user 
  socket.on('consume', async ({ producerId, rtpCapabilities, transportId, roomId, kind }, callback) => {
    /*
    Client want to consume the stream from producer "producerId"
    Client will now create a consumer inside its own consumerTransport

    transportId -> It represent the transport id of client's consumerTransport 
    */

    try {
      console.log("Consuming stream of ", producerId)
      const router = await ResourcePool.getRoomRouter(roomId, user);

      if(!router.canConsume({producerId, rtpCapabilities})){
        console.log(`Cannot consumer stream of producer ${producerId}`);
        return
      }
      
      console.log(`${user.name} can consume stream of `, producerId);
      const consumerTransport = ResourcePool.getConsumerTransort(transportId);

      if(!consumerTransport){
        console.log("Consumer Transport does not exist");
        return
      }
        
      // Create a consumer inside ConsumeTransport
      const consumer = await consumerTransport.transport.consume({
        producerId,
        rtpCapabilities,
        paused: true,
      });
      
      const data: Consumer = {
        consumer,
        roomId: user.roomId,
        socketId: socket.id,
        transportId,
        username: user.name
      }

      if(kind === "video"){
        ResourcePool.updateConsumerTransport(transportId, "video", consumer.id, data);
        console.log(`${user.name} created Video Consumer with id ${consumer.id}`);
      } 
      else if(kind === "audio"){             
        ResourcePool.updateConsumerTransport(transportId, "audio", consumer.id, data);
        console.log(`${user.name} created Audio Consumer with id ${consumer.id}`);
      } 
      else{           
        ResourcePool.updateConsumerTransport(transportId, "screen", consumer.id, data);
        console.log(`${user.name} created Video Consumer with id ${consumer.id}`);
      }

      consumer.on('transportclose', () => {
         console.log("Consumer transport closed");
         consumer.close();
      });

      consumer.on('producerclose', () => {
         console.log("Associated producer closed, closing consumer");
         socket.emit("producer-closed", { producerId }); 
         consumer.close();
        //  consumers = consumers.filter(c => c.consumer.id !== consumer.id);
      });

      callback({
        params: {
          id: consumer.id,
          producerId: producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        }
      });
        
    } catch (error: any) {
      callback({ error: error.message });
    }
  });

  socket.on('consumer-resume', async ({ serverConsumerId, kind }) => {
    console.log("consumer-resume ")
    
    const consumerTranportId = user.consumerTransport;

    const consumer = ResourcePool.getConsumer(consumerTranportId, kind, serverConsumerId);
    if (consumer) {
      console.log("Cosumption started ", consumer);
      await consumer.consumer.resume();
    }
  });

  // NEW: Explicitly close producer when user toggles off camera/mic
  // socket.on('close-producer', ({ producerId }) => {
  //    console.log(`Explicitly closing producer: ${producerId}`);
  //    const producerIndex = producers.findIndex(p => p.producer.id === producerId);
     
  //    if (producerIndex !== -1) {
  //        const { producer, roomId, socketId } = producers[producerIndex];
  //        producer.close();
  //        producers.splice(producerIndex, 1);
         
  //        // Notify clients to stop consuming this specific producer
  //        socket.to(roomId).emit("producer-closed", { producerId, socketId });
  //    }
  // });



  // socket.on('getProducers', ({ roomId }, callback) => {
  //   // Return producer ID AND socket ID
  //   const existingProducers = producers
  //       .filter(p => p.roomId === roomId && p.socketId !== socket.id)
  //       .map(p => ({ producerId: p.producer.id, socketId: p.socketId }));
    
  //   callback(existingProducers);
  // });

  // --- CLEANUP LOGIC ---
  socket.on('disconnect', () => {
    console.log("Disconnecting user:", socket.id);
    
    // Notify room that user left (remove tile)
    if(connectedUsers.has(socket.id)) {
        const { roomId } = connectedUsers.get(socket.id)!;
        socket.to(roomId).emit('user-left', { socketId: socket.id });
        connectedUsers.delete(socket.id);
    }

    consumers = removeAndClose(consumers, socket.id, 'consumer');
    producers = removeAndClose(producers, socket.id, 'producer');
    transports = removeAndClose(transports, socket.id, 'transport');

    for (const [key, value] of TransportPool.entries()) {
        if (value.socketId === socket.id) {
            TransportPool.delete(key);
        }
    }
  });

  const removeAndClose = (items: any[], socketId: string, type: string) => {
     const [toClose, keep] = items.reduce((result, item) => {
        result[item.socketId === socketId ? 0 : 1].push(item);
        return result;
     }, [[], []]);

     toClose.forEach((item: any) => {
         try {
             item[type].close(); 
             console.log(`Closed ${type}: ${item[type].id}`);
         } catch(e) { console.error(`Error closing ${type}`, e); }
     });

     return keep;
  };
});

const startUp = async () => {
  try {
    await createWorkerPool();
    httpServer.listen(3000, () => {
      console.log('Mediasoup Server running on port 3000');
    });
  } catch (err) {
    console.error("Failed to start server:", err);
  }
};

startUp();

/*

1. As soon our server spins up, We first create n workers (n = no. of cores in the system)



*/
