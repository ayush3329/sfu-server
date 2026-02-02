// import { Worker } from "mediasoup/node/lib/types";
// import { Room } from "./Room";
// import * as mediasoup from "mediasoup";
// import os from "os";
// import config from "../configs/mediaSoup-config";

// export class RoomManager {
//     private rooms = new Map<string, Room>();
//     private workers: Worker[] = [];
//     private nextWorkerIndex = 0;

//     async initialize() {
//         // Initialize workers strictly once
//         const PORTDIFFERENCE = (config.worker.rtcMaxPort - config.worker.rtcMinPort) + 1;
//         const numWorkers = os.cpus().length;
//         for (let i = 0; i < numWorkers; i++) {
//             const minPort = Number(config.worker.rtcMinPort) + (i * PORTDIFFERENCE);
//             const maxPort = Number(config.worker.rtcMaxPort) + (i * PORTDIFFERENCE);
//             const worker = await mediasoup.createWorker({ 
//                 logLevel: config.worker.logLevel,
//                 logTags: config.worker.logTags,
//                 rtcMinPort: minPort, 
//                 rtcMaxPort: maxPort
//              });
            
//             worker.on('died', () => {
//                 console.error(`Worker ${worker.pid} died. Need logic to restart.`);
//                 // In production: restart logic goes here
//             });
            
//             this.workers.push(worker);
//         }
//     }

//     getWorker(): Worker {
//         const worker = this.workers[this.nextWorkerIndex];
//         this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;
//         return worker;
//     }

//     async joinRoom(roomId: string): Promise<Room> {
//         let room = this.rooms.get(roomId);
        
//         // If room doesn't exist, create it
//         if (!room) {
//             const worker = this.getWorker();
//             const router = await worker.createRouter({ mediaCodecs: config.router.mediaCodecs });
//             room = new Room(roomId, router);
//             this.rooms.set(roomId, room);
            
//             // Auto-cleanup when room is empty? You can handle that in removePeer logic
//         }
        
//         return room;
//     }
    
//     removePeerFromRoom(roomId: string, socketId: string) {
//          const room = this.rooms.get(roomId);
//          if (!room) return;
         
//          room.removePeer(socketId);
         
//          if (room.isEmpty()) {
//              room.close();
//              this.rooms.delete(roomId);
//              console.log(`Room ${roomId} closed`);
//          }
//     }
    
//     getRoom(roomId: string) {
//         return this.rooms.get(roomId);
//     }
// }


import * as mediasoup from "mediasoup";
import { Worker } from "mediasoup/node/lib/types";
import { Room } from "./Room";
import  config  from "../configs/mediaSoup-config";
import os from "os"
import { Peer } from "./Peer";

export class RoomManager {
    private rooms = new Map<string, Room>();
    private workers: Worker[] = [];
    private nextWorkerIndex = 0;

    async initialize() {
        console.log("Initializing workers...");
        const PORTDIFFERENCE = (config.worker.rtcMaxPort - config.worker.rtcMinPort) + 1;
        const numWorkers = os.cpus().length;
        
        for (let i = 0; i < numWorkers; i++) {
            
            const minPort = Number(config.worker.rtcMinPort) + (i * PORTDIFFERENCE);
            const maxPort = Number(config.worker.rtcMaxPort) + (i * PORTDIFFERENCE);

            const worker = await mediasoup.createWorker({
                logLevel: config.worker.logLevel,
                logTags: config.worker.logTags,
                rtcMinPort: minPort,
                rtcMaxPort: maxPort,
            });

            worker.on('died', () => {
                console.error(`Worker ${worker.pid} died. Exiting...`);
                process.exit(1); 
            });

            this.workers.push(worker);
        }

        console.log(`Started ${this.workers.length} workers.`);
    }

    getWorker(): Worker {
        const worker = this.workers[this.nextWorkerIndex];
        this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;
        return worker;
    }

    async joinRoom(roomId: string, socketId: string, username: string): Promise<{ room: Room, peer: Peer }> {
        let room = this.rooms.get(roomId); //rooms -> Object of Room Class

        // CREATE ROOM IF NOT EXISTS
        if (!room) {
            console.log(`Creating new room: ${roomId}`);
            const worker = this.getWorker();
            const router = await worker.createRouter({ mediaCodecs: config.router.mediaCodecs });
            room = new Room(roomId, router); 
            this.rooms.set(roomId, room);
        }

        // Add Peer to Room
        let peer = room.getPeer(socketId); //peer-> Object of Peer Class

        if (!peer) {
            peer = new Peer(socketId, username);
            room.addPeer(peer);
        }

        return { room, peer };
    }

    leaveRoom(roomId: string, socketId: string) {
        const room = this.rooms.get(roomId);
        if (!room) return;

        room.removePeer(socketId);
        
        // Auto-close empty room
        if (room.peers.size === 0) {
            console.log(`Room ${roomId} is empty. Closing...`);
            room.router.close();
            this.rooms.delete(roomId);
        }
    }

    getRoom(roomId: string) {
        return this.rooms.get(roomId);
    }
}