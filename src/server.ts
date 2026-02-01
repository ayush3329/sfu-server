import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { RoomManager } from './lib/RoomManager';
import  config  from './configs/mediaSoup-config';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const roomManager = new RoomManager();

const startServer = async()=>{
  try{
    await roomManager.initialize();
    httpServer.listen(3000, () => {
            console.log(`Mediasoup Server running on port ${3000}`);
    });
  } catch(err){

  }
}


io.on('connection', (socket) => {
    const { roomId, username } = socket.handshake.query as { roomId: string, username: string };

    if (!roomId || !username) {
        socket.emit('missing-detail', { message: "Username or roomId is missing" });
        socket.disconnect();
        return;
    }

    console.log(`User connected: ${username} (${socket.id}) in room ${roomId}`);

    // Initialize User in Room
    // Using self-executing async function to handle the join logic smoothly
    (async () => {
        const { room, peer } = await roomManager.joinRoom(roomId, socket.id, username);
        //room -> Object of Room class. It holds all necessary information of a meeting Room. Like, all peers
        // peer -> Object of Peer class. It holds all necessary information about a single (current) user.
        
        socket.join(roomId);

        // 1. Send list of existing users (Event: 'all-users')
        const usersInRoom = Array.from(room.peers.values())
            .filter(p => p.id !== socket.id)
            .map(p => ({ username: p.name, roomId: room.id, socketId: p.id }));
        
        socket.emit('all-users', usersInRoom);

        // 2. Notify others (Event: 'user-joined')
        socket.to(roomId).emit('user-joined', { socketId: socket.id, username });


        // --- EVENT 1: getRouterRtpCapabilities ---
        socket.on('getRouterRtpCapabilities', ({}, callback) => {
            try {
                console.log(`${peer.name} requested getRouterRtpCapabilities`);
                // The room logic handles the router retrieval
                const capabilities = room.getRtpCapabilities();
                callback(capabilities);
            } catch (e: any) {
                callback({ error: e.message });
            }
        });

        // --- EVENT 2: createWebRtcTransport ---
        socket.on('createWebRtcTransport', async ({ sender }, callback) => {
            try {
                // Room handles transport creation logic
                const { params, transport } = await room.createWebRtcTransport(socket.id);
                // User needs to know if this is producer or consumer transport? 
                // In your old code you stored them in specific variables. 
                // In Peer class, we just store them in a map, but we can log it.
                console.log(`${peer.name} created ${sender ? 'Producer' : 'Consumer'} transport ${params.id}`);
                callback({ params });
            } catch (e: any) {
                callback({ error: e.message });
            }
        });

        // --- EVENT 3: producer-transport-connect ---
        socket.on('producer-transport-connect', async ({ dtlsParameters, transportId }, callback) => {
            const transport = peer.getTransport(transportId);
            if (transport) {
                await transport.connect({ dtlsParameters });
                console.log(`Producer Transport connected for ${peer.name}`);
                callback();
            } else {
                console.error("Producer transport not found");
            }
        });

        // --- EVENT 4: consumer-transport-connect ---
        socket.on('consumer-transport-connect', async ({ dtlsParameters, transportId }, callback) => {
            const transport = peer.getTransport(transportId);
            if (transport) {
                await transport.connect({ dtlsParameters });
                console.log(`Consumer Transport connected for ${peer.name}`);
                callback();
            } else {
                console.error("Consumer transport not found");
            }
        });

        // --- EVENT 5: transport-produce ---
        socket.on('transport-produce', async ({ kind, rtpParameters, transportId }, callback) => {
            const transport = peer.getTransport(transportId);
            if (!transport) return callback({ error: "Transport not found" });

            try {
                const producer = await transport.produce({ kind, rtpParameters });
                
                peer.addProducer(producer, kind);
                
                // Save the kind mapping in the peer (if needed for later lookups)
                // The Peer class handles the storage logic.

                console.log(`${peer.name} produced ${kind} with id ${producer.id}`);

                // Notify Room
                socket.to(roomId).emit('new-producer', {
                    producerId: producer.id,
                    kind,
                    socketId: socket.id,
                    username: peer.name
                });

                producer.on('@close', () => {
                    console.log('Producer transport closed');
                    producer.close();
                });
                
                // Fix for the interval memory leak:
                if(kind === "audio"){
                    const statsInterval = setInterval(async () => {
                            if(producer.closed) {
                                clearInterval(statsInterval);
                                return;
                            }
                            const stats = await producer.getStats();
                            console.log("Stats:", stats[0].bitrate);
                    }, 2000);
                }
                callback({ id: producer.id, kind });

            } catch (e: any) {
                callback({ error: e.message });
            }
        });

        // --- EVENT 6: consume ---
        socket.on('consume', async ({ producerId, rtpCapabilities, kind, consumerTransportId }, callback) => {
            console.log(`${peer.name} wants to consume ${kind}`);

            try {
                // 1. Find producer (Using Room instead of Global Map)
                const remoteProducer = room.findProducer(producerId);
                if (!remoteProducer) return callback({ error: "Producer not found" });

                // 2. Check capabilities
                if (!room.router.canConsume({ producerId, rtpCapabilities })) {
                    return callback({ error: "Cannot consume" });
                }

                // 3. Get Consumer Transport (In new design, we just find the transport you created earlier)
                // Note: You usually need to pass transportId from client, but if you only have one consumer transport
                // per user, we can find it. For safety, let's assume the client passes `transportId` OR 
                // we find the first transport that isn't producing.
                // **Improvement**: Your client SHOULD send transportId here. 
                // If not, we have to iterate peer transports.
                let consumerTransport = peer.getTransport(consumerTransportId); 
                
                if (!consumerTransport) return callback({ error: "Consumer transport not found" });

                const consumer = await consumerTransport.consume({
                    producerId: remoteProducer.id,
                    rtpCapabilities,
                    paused: true,
                });

                peer.addConsumer(consumer, kind);
                
                console.log(`${peer.name} consuming ${kind} (id: ${consumer.id})`);

                consumer.on('@close', () => {
                    socket.emit("producer-closed", { producerId });
                    consumer.close();
                    peer.consumers.delete(consumer.id);
                });

                callback({
                    params: {
                        id: consumer.id,
                        producerId,
                        kind: consumer.kind,
                        rtpParameters: consumer.rtpParameters,
                    }
                });

            } catch (e: any) {
                callback({ error: e.message });
            }
        });

        // --- EVENT 7: consumer-resume ---
        socket.on('consumer-resume', async ({ serverConsumerId, kind }) => {
            const consumer = peer.getConsumer(serverConsumerId);
            if (consumer) {
                await consumer.resume();
                console.log(`${peer.name} resumed ${kind}`);
            }
        });

        // --- EVENT 8: close-producer (Explicit Close) ---
        socket.on('close-producer', ({ producerId, kind }) => {
            const producer = peer.getProducer(producerId);
            if (producer) {
                producer.close();
                peer.producers.delete(producerId); // Explicit cleanup
                
                // Notify Room
                socket.to(roomId).emit("producer-closed", { producerId, socketId: socket.id, kind });
                console.log(`Closed producer ${producerId}`);
            }
        });

        // --- EVENT 9: pause-producer ---
        socket.on('pause-producer', async ({ kind }) => {
            // Your original code paused based on 'kind'.
            // We need to find the producer of that kind.
            const producer = Array.from(peer.producers.values()).find(p => p.kind === kind);
            
            if (producer) {
                await producer.producer.pause();
                socket.to(roomId).emit("remote-producer-paused", { socketId: socket.id, kind });
                console.log(`Paused ${kind} stream`);
            }
        });

        // --- EVENT 10: resume-stream (Producer Resume) ---
        socket.on('resume-stream', async ({ kind }) => {
            const producer = Array.from(peer.producers.values()).find(p => p.kind === kind);
            
            if (producer) {
                await producer.producer.resume();
                socket.to(roomId).emit("remote-stream-resumed", { socketId: socket.id, kind });
                console.log(`Resumed ${kind} stream`);
            }
        });

        // --- EVENT 11: getProducers ---
        socket.on('getProducers', ({ roomId }, callback) => {
            // Logic moved to Room class helper
            const producerList = room.getProducerListForPeer(socket.id);
            console.log("Sending existing producers", producerList.length);
            callback(producerList);
        });

        // --- EVENT 12: Disconnect ---
        socket.on('disconnect', () => {
            console.log(`Disconnecting: ${username}`);
            roomManager.leaveRoom(roomId, socket.id); // Handles all cleanup logic
            socket.to(roomId).emit('user-left', { socketId: socket.id, username });
        });

    })(); // End async init
});

startServer();

