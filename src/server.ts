import * as mediasoup from "mediasoup";
import express from "express";
import { Server } from "socket.io";
import config from "./configs/mediaSoup-config";
import http from "http";
import os from "os";
import { WebRtcTransport } from "mediasoup/node/lib/WebRtcTransportTypes";
import { Consumer, ConsumerTransport, Producer, ProducerTransport } from "./Types/types";
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

/*
producerIdToUserMap helps to find out which user produced a particular producer
Key: producerId
Value: { user: User, kind: string }

consumerIdToUserMap helps to find out which user is consuming a particular consumer
Key: consumerId
Value: { user: User, kind: string }

roomToProducerIdMap helps to find out all the producers in a particular room
Key: roomId
Value: Set of producerIds
*/
const producerIdToUserMap = new Map<string, { user: User; kind: string }>();
const consumerIdToUserMap = new Map<string, { user: User; kind: string }>();
const roomToProducerIdMap = new Map<string, Set<string>>();

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
      console.log(`${user.name} requested for getRouterRtpCapabilities`);
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
          console.log(`${user.name} successfully created Producertransport with id ${transport.id}`)          
          user.producerTransport = transport;
      } else{
          // If sender = false, it means client want to create a consumerTransport
          console.log(`${user.name} successfully created consumertransport with id ${transport.id}`)
          user.consumerTransport = transport;
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
    
    const producerTransport = user.producerTransport;

    if (producerTransport) {
      await producerTransport.connect({ dtlsParameters });
      console.log(`Successfully connected ${user.name}'s client and server side producerTransport`);
      callback();
    } else{
      console.log("Failed to connect server and client side producerTransport");
    }

  });

  // C. Client sends its dtlsParameters and connect to consumer-transport
  socket.on('consumer-transport-connect', async ({ dtlsParameters, transportId }, callback) => {

      const consumerTransport = user.consumerTransport;
  
      if (consumerTransport){
        await consumerTransport.connect({ dtlsParameters });
        console.log(`Successfully connected ${user.name}'s client and server side consumerTransport `);
        callback();
      } else{
        console.log("Failed to connect server and client side consumerTransport");
      }
    

  });

  // D. Client want to create Producer, so that it can send audio or video stream
  socket.on('transport-produce', async ({ kind, rtpParameters, transportId }, callback) => {
    
    /*
     1. Get the producerTransport of the user
     2. Create a producer inside the transport with given kind and rtpParameters
     3. Save the producer inside the user object for future use
     4. Send back the producer id to client
     5. Client will use this id to create client side producer
     6. Once client side producer is created, It will send a request to server to inform that producer is ready
     7. Server will now notify all other clients in the room about new producer 
    */

    const producerTransport = user.producerTransport;

    if(!producerTransport){
      console.log("Producer transport does not exist");
      return;
    }

    const producer = await producerTransport.produce({kind, rtpParameters});

    if(kind === "video"){
      user.saveProducer("video", producer)
      console.log(`\n${user.name} created Video Producer with id ${producer.id}`);
      
    } else if(kind === "audio"){
      user.saveProducer("audio", producer)
      console.log(`${user.name} created audio Producer with id ${producer.id}`);
      
    } else{
      // user.saveProducer("screen", producer) 
      console.log("Does not support Screen share transport yet")
    }

    producerIdToUserMap.set(producer.id, {user, kind});

    roomToProducerIdMap.set(user.roomId,  
      roomToProducerIdMap.get(user.roomId) ?
        roomToProducerIdMap.get(user.roomId)!.add(producer.id)
        :
        new Set<string>([producer.id])
    )
    
    // Notify others (Include socketId so they know WHO produced)
    
    callback({ id: producer.id, kind });

    producer.on('transportclose', () => {
      console.log('Video Producer transport closed');
      producer.close();
    });


    socket.to(user.roomId).emit('new-producer', {
      producerId: producer.id,
      roomId: user.roomId,
      kind,
      socketId: socket.id // Add this
    });
      
    // setInterval(async()=>{
    //   const stats = await producer.getStats();
    //   console.log('Producer Stats:', stats[0].packetCount, " ", stats[0].bitrate);
    // }, 2000);
    

  });
  
  // E. Client want to consumer stream of user 
  socket.on('consume', async ({ producerId, rtpCapabilities, roomId, kind }, callback) => {
    console.log("\n consume", user.name)
    /*
    Client want to consume the stream from producer "producerId"
    Client will now create a consumer inside its own consumerTransport
    
    producerId -> It represent the producer id of the stream they want to consum
    transportId -> It represent the transport id of client's consumerTransport 

    1. Get the router for the room
    2. Check if the router can consume the stream with given rtpCapabilities
    3. Get the consumerTransport of the client
    4. Create a consumer inside the consumerTransport
    5. Send back the consumer parameters to client
    6. Client will use these parameters to create client side consumer
    7. Once client side consumer is created, it will send a request to server to resume the consumer
    8. Server will resume the consumer
    9. Client will now receive the stream
    */

    try {
      const router = await ResourcePool.getRoomRouter(roomId, user);

      if(!router.canConsume({producerId, rtpCapabilities})){
        console.log(`Cannot consumer stream of producer ${producerId}`);
        return
      }
    
      const consumerTransport = user.consumerTransport;

      if(!consumerTransport){
        console.log("Consumer Transport does not exist");
        return
      }
        
      // Create a consumer inside ConsumeTransport
      const consumer = await consumerTransport.consume({
        producerId,
        rtpCapabilities,
        paused: true,
      });

      console.log("Consumer ", consumer.id);

      const streamingUserInfo = producerIdToUserMap.get(producerId);
      if(!streamingUserInfo){
        throw new Error("Streaming user info not found");
      }

      if(kind === "video"){
        user.saveConsumer("video", consumer);
        streamingUserInfo.user.videoProducer?.associatedConsumers.push(consumer.id);
        console.log(`${user.name} created Video Consumer with id ${consumer.id}`);
      } 
      else if(kind === "audio"){     
        user.saveConsumer("audio", consumer);
        streamingUserInfo.user.audioProducer?.associatedConsumers.push(consumer.id);        
        console.log(`${user.name} created Audio Consumer with id ${consumer.id}`);
      } 
      else{           
        // user.saveConsumer("screen", consumer);
        streamingUserInfo.user.screenProducer?.associatedConsumers.push(consumer.id);
        console.log(`${user.name} created Video Consumer with id ${consumer.id}`);
      }

      consumerIdToUserMap.set(consumer.id, {user, kind});

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

    console.log("\n consumer-resume", user.name)
        
    const consumer = user.videoConsumer.get(serverConsumerId);
    
    console.log("Consumer-resume ", consumer, " ", serverConsumerId)
    
    if (consumer) {
      console.log(`${user.name} resumed ${kind} stream`)
      await consumer.consumer.resume();
    } else{
      console.log(`Failed to resume ${kind} stream for ${user.name}`)
    }
  });

  // NEW: Explicitly close producer when user toggles off camera/mic
  socket.on('close-producer', ({ producerId, producerTransportId, kind  }) => {
     console.log(`Explicitly closing producer: ${producerId}`);
    //  const producerIndex = producers.findIndex(p => p.producer.id === producerId);
     const streamProducer = ResourcePool.getProducer(producerId, kind);

     if(!streamProducer){
      console.log(kind, " producer does not exist");
      return
     }
     
    const { producer, roomId, socketId, transportId } = streamProducer;
    producer.close();
    ResourcePool.deleteProducer(producerId, transportId, kind)    
         
         // Notify clients to stop consuming this specific producer
    socket.to(roomId).emit("producer-closed", { producerId, socketId, kind });
     
  });

  socket.on('pause-producer', async ({ kind })=>{
    // This event will be fire by the user who turn off their camera but they are still in the meeting
    // producerId-> It represent the porducer id of the stream they stop sending
    
    console.log(`Pausing ${kind} stream`);
    
    let streamProducer = null;

    if(kind === "video"){
      streamProducer = user.videoProducer;
    } else if(kind === "audio"){
      streamProducer = user.audioProducer;
    } else if(kind === "screen"){
      streamProducer = user.screenProducer;
    }

    
    if(!streamProducer){
      console.log(kind, " stream producer does not exist");
      return;
    }

    await streamProducer.producer.pause();

    socket.to(roomId).emit("remote-producer-paused", {socketId: user.socketId, kind});
    
  })

  socket.on("resume-stream", async({kind})=>{
    console.log(`Resuming ${kind} stream`);
    
    let streamProducer = null;

    if(kind === "video"){
      streamProducer = user.videoProducer;
    } else if(kind === "audio"){
      streamProducer = user.audioProducer;
    } else if(kind === "screen"){
      streamProducer = user.screenProducer;
    } 

    if(!streamProducer){
      console.log(kind, " stream producer does not exist");
      return;
    }

    await streamProducer.producer.resume();

    streamProducer.associatedConsumers.forEach(async(consumerId)=>{
      await consumerIdToUserMap.get(consumerId)?.user.videoConsumer.get(consumerId)?.consumer.resume();
    })

    console.log(`Producer ${streamProducer.producer.id} paused? ${streamProducer.producer.paused}`);
    // Check if the producer is actually receiving data from User 1


    socket.to(roomId).emit("remote-stream-resumed", {socketId: user.socketId, kind});
    
  })



  socket.on('getProducers', ({ roomId }, callback) => {
    // Return producer ID AND socket ID
    const existingProducers = roomToProducerIdMap.get(roomId) ?
      Array.from(roomToProducerIdMap.get(roomId)!) : [];
    console.log("Existing User ", existingProducers);
    callback(existingProducers);
  });

  // --- CLEANUP LOGIC ---
  socket.on('disconnect', () => {
    console.log("Disconnecting user:", socket.id);

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


