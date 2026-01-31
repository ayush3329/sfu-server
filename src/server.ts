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
const roomToProducerIdMap = new Map<string, Set<string>>();
const streamProducerType = new Map<string, string>();
const consumerIdToUserMap = new Map<string, { user: User; kind: string }>();

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
  
  console.log('\n User connected:', username, " ", roomId, );

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

  socket.on('getRouterRtpCapabilities', async ({ roomId }, callback) => {
    try {
      console.log(`${user.name} requested for getRouterRtpCapabilities`);
      const room = await ResourcePool.createRoom(roomId, user);
      callback(room.rtpCapabilities);
    } catch (e: any) {
      callback({ error: e.message });
    }
  });


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

  socket.on('producer-transport-connect', async ({ dtlsParameters, transportId }, callback) => {
    // Client request to connect client side producer transport with server side producer transport
    const producerTransport = user.producerTransport;

    if (producerTransport) {
      await producerTransport.connect({ dtlsParameters });
      console.log(`Successfully connected ${user.name}'s client and server side producerTransport`);
      callback();
    } else{
      console.error("Failed to connect server and client side producerTransport");
    }

  });

  socket.on('consumer-transport-connect', async ({ dtlsParameters, transportId }, callback) => {
      // Client request to connect client side producer transport with server side producer transport

      const consumerTransport = user.consumerTransport;
  
      if (consumerTransport){
        await consumerTransport.connect({ dtlsParameters });
        console.log(`Successfully connected ${user.name}'s client and server side consumerTransport `);
        callback();
      } else{
        console.error("Failed to connect server and client side consumerTransport");
      }
    

  });

  socket.on('transport-produce', async ({ kind, rtpParameters, transportId }, callback) => {
    
    /*
    Client want to create Producer, so that it can send audio or video stream
        
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
      console.error("Producer transport does not exist");
      return;
    }

    // Creating a producer inside producerTransport of user
    const producer = await producerTransport.produce({kind, rtpParameters});
    
    if(kind === "video"){
      user.saveProducer("video", producer)
      console.log(`${user.name} created Video Producer with id ${producer.id}`);
      
    } else if(kind === "audio"){
      user.saveProducer("audio", producer)
      console.log(`${user.name} created audio Producer with id ${producer.id}`);
      
    } else{
      // user.saveProducer("screen", producer) 
      console.log("Does not support Screen share transport yet")
    }

    streamProducerType.set(producer.id, kind);
    
    producerIdToUserMap.set(producer.id, {user, kind});
    // We are storing this information, so that user2 can get access of user1's information (object of User class)
    // with the help of its "audio-producer-id" or "video-producer-id" or "screen-producer-id"
    /*
    {
      "video-producer-user1": {user: user1, kind: "video"}
      "audio-producer-user1": {user: user1, kind: "audio"}
      
      "video-producer-user2": {user: user2, kind: "video"}
      "audio-producer-user3": {user: user3, kind: "audio"}
    }
    */

    roomToProducerIdMap.set(user.roomId,  
      roomToProducerIdMap.get(user.roomId) ?
       roomToProducerIdMap.get(user.roomId)!.add(producer.id) : new Set<string>([producer.id])
    )
    // We are storing all producer ids of all the user against roomId, so that when a new user joins the meet, we can give 
    // that user all the producer ids from where it need consume stream 
    
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
      socketId: socket.id 
    });
      
    setInterval(async()=>{
      const stats = await producer.getStats();
      console.log('Producer Stats:', stats[0].packetCount, " ", stats[0].bitrate);
      // console.log('Producer Stats:', stats);
    }, 2000);
    

  });
  
  // E. Client want to consumer stream of user 
  socket.on('consume', async ({ producerId, rtpCapabilities, roomId, kind }, callback) => {
    console.log(`${user.name} want to consume ${kind} stream. producerId: ${producerId}`)
    /*
    producerId -> It represent the producer id of the stream they want to consume (other user's stream)

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
        console.error(`Cannot consumer stream of producer ${producerId}`);
        return
      }
    
      const consumerTransport = user.consumerTransport;

      if(!consumerTransport){
        console.error("Consumer Transport does not exist");
        return
      }
        
      // Create a consumer inside ConsumeTransport
      const consumer = await consumerTransport.consume({
        producerId,
        rtpCapabilities,
        paused: true,
      });


      const streamingUserInfo = producerIdToUserMap.get(producerId);
      if(!streamingUserInfo){
        throw new Error("Streaming user info not found");
      }

      console.log(`${user.name} created ${kind} Consumer with id ${consumer.id}`);
      
      if(kind === "video"){
        user.saveConsumer("video", consumer);
        streamingUserInfo.user.videoProducer?.associatedConsumers.push(consumer.id);
      } 
      else if(kind === "audio"){     
        user.saveConsumer("audio", consumer);
        streamingUserInfo.user.audioProducer?.associatedConsumers.push(consumer.id);        
      } 
      else{           
        // user.saveConsumer("screen", consumer);
        streamingUserInfo.user.screenProducer?.associatedConsumers.push(consumer.id);
      }

      consumerIdToUserMap.set(consumer.id, {user, kind});

      /*
        we are storing user's info against their consumer id because when any user will resume its stream then they will use
        resume stream of all the consumer associated to that stream 
      */

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

    console.log("Stream Resume requested by ", user.name)
        
    const consumer = user.videoConsumer.get(serverConsumerId);
    
    if(!consumer){
      console.error(`${kind} Consumer with ${serverConsumerId} id does not exist`);
      return;
    }

    console.log(consumer?.consumer.id, " ", serverConsumerId)
    
    if (consumer) {
      console.log(`${user.name} resumed ${kind} stream`)
      await consumer.consumer.resume();
    } else{
      console.error(`Failed to resume ${kind} stream for ${user.name}`)
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
    const allProducersId = roomToProducerIdMap.get(roomId) ? Array.from(roomToProducerIdMap.get(roomId)!) : [];
    const data = allProducersId.map((id)=>{
      return {
        producerId: id,
        kind: streamProducerType.get(id),
        socketId: producerIdToUserMap.get(id)?.user.socketId,
        username: producerIdToUserMap.get(id)?.user.name
      }
    })
    console.log("Existing User ", data);
    callback(data);
  });

  // --- CLEANUP LOGIC ---
  socket.on('disconnect', () => {
    console.log("Disconnecting user:", socket.id);
    closeConnection();
  });

  const closeConnection = () => {
    console.log(`Starting cleanup for user: ${user.name} (${socket.id})`);

    // 1. Identify all producers owned by this user
    // We collect the wrapper objects if they exist
    const userProducers = [
      user.videoProducer,
      user.audioProducer,
      user.screenProducer
    ];

    // 2. Clean up Producer Maps
    // We iterate through the user's producers to remove them from global tracking maps
    const roomProducerSet = roomToProducerIdMap.get(roomId);

    userProducers.forEach((producerWrapper) => {
      if (producerWrapper) {
        const producerId = producerWrapper.producer.id;

        // Remove from producer -> user map
        producerIdToUserMap.delete(producerId);

        // Remove from producer -> kind map
        streamProducerType.delete(producerId);

        // Remove from the Room's Set of producers
        if (roomProducerSet) {
          roomProducerSet.delete(producerId);
        }
      }
    });

    // If the room is now empty of producers, we can optionally clean the room key
    if (roomProducerSet && roomProducerSet.size === 0) {
      roomToProducerIdMap.delete(roomId);
    }

    // 3. Clean up Consumer Maps
    // We need to look at every consumer this user has and remove it from the global map
    // Assuming videoConsumer/audioConsumer are Maps based on your usage: user.videoConsumer.get(...)
    const userConsumerMaps = [user.videoConsumer, user.audioConsumer]; // Add screenConsumer if you implement it later

    userConsumerMaps.forEach((consumerMap) => {
      if (consumerMap) {
        consumerMap.forEach((consumerWrapper) => {
          consumerIdToUserMap.delete(consumerWrapper.consumer.id);
        });
      }
    });

    // 4. Close Mediasoup Transports
    // This is the most critical step. Closing the transport automatically closes 
    // all producers and consumers associated with it on the mediasoup C++ side.
    try {
      if (user.producerTransport) user.producerTransport.close();
      if (user.consumerTransport) user.consumerTransport.close();
    } catch (error) {
      console.error(`Error closing transports for ${user.name}:`, error);
    }

    // 5. Remove from Connected Users Map
    connectedUsers.delete(socket.id);

    // 6. Notify the room
    // Notify others that the user has left so they can update their UI (remove name from list, etc.)
    socket.to(roomId).emit('user-left', { socketId: socket.id, username: user.name });

    // 7. Leave the Socket.io room
    socket.leave(roomId);

    console.log(`Cleanup complete for ${user.name}`);
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
