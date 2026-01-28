import * as mediasoup from "mediasoup";
import express from "express"
import {Server} from "socket.io"
import config from "./configs/mediaSoup-config"
import http from "http"
import os from "os"
import { WebRtcTransport } from "mediasoup/node/lib/WebRtcTransportTypes";
import { RoomEntry, TransportEntry } from "./Types/types";
import User from "./Utility/User";
import PoolCollection from "./Utility/Pool";


const ResourcePool = new PoolCollection();
const app = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORTDIFFERENCE = (config.worker.rtcMaxPort - config.worker.rtcMinPort) + 1;

let producers = [];
let consumers = [];


// Pools

let TransportPool: Map<string, TransportEntry>= new Map(); //It holds all the transport connection
/*
{
   "transportId__1": {transport: {}, socketId: "some random Text 1", consumer: false, roomId: "ayush-room"},
   "transportId__2": {transport: {}, socketId: "some random Text 2", consumer: true,  roomId: "ayush-room"}
}

*/


// Spawning Functions (Utility functions are used inside Spawning functions)
const createWorkerPool = async()=>{

  const numWorkers = os.cpus().length;
  console.log(`Spinning ${numWorkers} number of CORES`);
  
  for (let i = 0; i < numWorkers; i++) {

    const minPort = Number(config.worker.rtcMinPort) + (i * PORTDIFFERENCE);
    const maxPort = Number(config.worker.rtcMaxPort) + (i * PORTDIFFERENCE);

      /*
      worker 1->
        minPort = 2000 + (0*21) -> 2000
        maxPort = 2020 + (0*21) -> 2020
      
      worker 2-> 
        minPort = 2000 + (1*21) -> 2021
        maxPort = 2020 + (1*21) -> 2041
        
      worker 3-> 
        minPort = 2000 + (2*21) -> 2042
        maxPort = 2020 + (2*21) -> 2062
          
      */

    await ResourcePool.spawnNewWorker(i, minPort, maxPort);

  }
  
}


io.on('connection', (socket) => {

  const { username, roomId } = socket.handshake.query as { username?: string; roomId?: string;};
  console.log('\nUser connected:', username," ", socket.id, " ", roomId, );

  if (roomId) {
    socket.join(roomId);
  }

  if(!roomId || !username) return;

  const user = new User(username, roomId, socket.id);

  // A. Handshake (Requires Room ID)
  socket.on('getRouterRtpCapabilities', async ({ roomId }, callback) => {

    try {
      // Creating new meeting-room for client
      console.log("getRouterRtpCapabilities");
      const room = await ResourcePool.createRoom(roomId, user);
      callback(room.rtpCapabilities);
    } catch (e) {
      callback({ error: e.message });
    }
    
  });

  // B. Create Transport
  socket.on('createWebRtcTransport', async ({ sender, roomId }, callback) => {
    try {
      // getting the roomRouter information for this pariticular "roomId"
      const roomRouter = await ResourcePool.getRoomRouter(roomId, user); 
    
      // Creating New Transport (New UDP connection) for this client
      // Every client have unique Transport 
      const transport: WebRtcTransport = await roomRouter.createWebRtcTransport(config.webRtcTransport);
      {
        /*

        Whenever we request server to create a new Transport for client. Server opens a new UDP port for that user.
        It then shares the configuration of that port with the user
        like:
            1. ICE Parameter-> usernamefragment and password for allowing client's packet
            2. ICE Candidate-> server's IP, Port, Protocol
            3. Dtls params-> server's fingerprint, so that client can identify the server

            ICE Params is for server to verify client
            Dtls Params is for client to verify server

        */
      }

      console.log("createWebRtcTransport ", user.name, sender === true ? "Sender Transport " : "Receiver Transport ", transport.id)

      

      // Store transport with socketId to find it later
      TransportPool.set(transport.id, {
        consumer: !sender,
        roomId: roomId,
        socketId: socket.id,
        transport
      })

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

  // C. Connect Transport (DTLS)
  socket.on('transport-connect', async ({ dtlsParameters, transportId }, callback) => {

    console.log("transport-connect \n\n")

    const transportObj = TransportPool.get(transportId);

    if (transportObj) {
      await transportObj.transport.connect({ dtlsParameters });
      callback();
    }
  });

  // D. Produce (Send Media)
  socket.on('transport-produce', async ({ kind, rtpParameters, transportId }, callback) => {

    console.log("transport-produce ", kind, " ", rtpParameters.encodings[0].ssrc )

    // rtpParameters.encodings[0].ssrc -> This is a unique 32 bit integer, It help us in identifying the type of data packet
    // 2352523-> data packet contain video data
    // 2312312-> data packet contain audio data
    // 1231231-> data packet contain screen-sharing data
    
    const transportObj = TransportPool.get(transportId);
    
    if (transportObj) {
      const producer = await transportObj.transport.produce({ kind, rtpParameters });

      producers.push({ socketId: socket.id, producer, roomId: transportObj.roomId });

      callback({ id: producer.id });

      // Notify ONLY users in the SAME room
      // We filter sockets by "room" logic roughly here
      // In a real app, use socket.join(roomId) and socket.to(roomId).emit(...)
      socket.to(transportObj.roomId).emit('new-producer', { 
        producerId: producer.id, 
        roomId: transportObj.roomId 
      });
    }
  });

  // E. Consume (Receive Media)
  socket.on('consume', async ({ producerId, rtpCapabilities, transportId, roomId }, callback) => {
    try {

      const router = await ResourcePool.getRoomRouter(roomId, user); // Get the room's router
      
      // Check if the router can handle this codec
      if (router.canConsume({ producerId, rtpCapabilities })) {
        
        const transportObj = TransportPool.get(transportId);
        
        const consumer = await transportObj.transport.consume({
          producerId,
          rtpCapabilities,
          paused: true, // Always start paused
        });

        consumers.push({ socketId: socket.id, consumer, roomId });

        callback({
          params: {
            id: consumer.id,
            producerId: producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
          }
        });
        
        // await consumer.resume();
      }
    } catch (error) {
      console.error("Consume error", error);
      callback({ error: error.message });
    }
  });
  
  socket.on('consumer-resume', async ({ serverConsumerId }) => {
    console.log("consumer-resume", serverConsumerId);

    const consumerData = consumers.find(c => c.consumer.id === serverConsumerId);
    console.log("consumerData ", consumerData)
    if (consumerData) {
      await consumerData.consumer.resume();
    }
  });


  // H. Get Existing Producers
  socket.on('getProducers', ({ roomId }, callback) => {
    // Return all producer IDs in the room, EXCEPT the requester's own
    const existingProducers = producers.filter(p => p.roomId === roomId && p.socketId !== socket.id);
    
    // Send back the list of producer IDs
    callback(existingProducers.map(p => p.producer.id));
  });
  

  // Cleanup on Disconnect
  socket.on('disconnect', () => {
     // Clean up transports, producers, consumers for this socket...
     try{
        console.log("Disconnect ", user.name, user.roomId)
        const roomData = ResourcePool.getRoomData(roomId);
        

       if(roomData != undefined){
         if(roomData.userInMeeting == 1){
            // Last member is leaving the meet
            // release transport, consumer and producer also
            
            closeServices();
            
            // Room Deleted
            ResourcePool.deleteRoom(roomId);
          } else{
            roomData.userInMeeting--;
            ResourcePool.updateRoom(roomId, roomData);
          }
        } else{
          throw new Error(`${roomId} Room Does not exist`)
        }
        console.log('User disconnected:', socket.id);
     } catch(e){
      console.error("Disconnection error ", e)
     }
  });
  

  const closeServices = (socketId: string, roomId: string)=>{
    console.log(`Cleaning up resources for user: ${socketId}`);
    // Release Transport connection
    // Close all the Producers
  }


});


// STARTUP
const startUp = async()=>{
  try {
    await createWorkerPool();
    httpServer.listen(3000, () => {
      console.log('Mediasoup Server running on port 3000');
    });
  } catch (err) {
    console.error("Failed to start server:", err);
  }
}

startUp();

