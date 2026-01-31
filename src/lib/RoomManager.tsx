import { Worker } from "mediasoup/node/lib/types";
import { Room } from "./Room";
import * as mediasoup from "mediasoup";
import os from "os";
import config from "../configs/mediaSoup-config";

export class RoomManager {
    private rooms = new Map<string, Room>();
    private workers: Worker[] = [];
    private nextWorkerIndex = 0;

    async initialize() {
        // Initialize workers strictly once
        const PORTDIFFERENCE = (config.worker.rtcMaxPort - config.worker.rtcMinPort) + 1;
        const numWorkers = os.cpus().length;
        for (let i = 0; i < numWorkers; i++) {
            const minPort = Number(config.worker.rtcMinPort) + (i * PORTDIFFERENCE);
            const maxPort = Number(config.worker.rtcMaxPort) + (i * PORTDIFFERENCE);
            const worker = await mediasoup.createWorker({ 
                logLevel: config.worker.logLevel,
                logTags: config.worker.logTags,
                rtcMinPort: minPort, 
                rtcMaxPort: maxPort
             });
            
            worker.on('died', () => {
                console.error(`Worker ${worker.pid} died. Need logic to restart.`);
                // In production: restart logic goes here
            });
            
            this.workers.push(worker);
        }
    }

    getWorker(): Worker {
        const worker = this.workers[this.nextWorkerIndex];
        this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;
        return worker;
    }

    async joinRoom(roomId: string): Promise<Room> {
        let room = this.rooms.get(roomId);
        
        // If room doesn't exist, create it
        if (!room) {
            const worker = this.getWorker();
            const router = await worker.createRouter({ mediaCodecs: config.router.mediaCodecs });
            room = new Room(roomId, router);
            this.rooms.set(roomId, room);
            
            // Auto-cleanup when room is empty? You can handle that in removePeer logic
        }
        
        return room;
    }
    
    removePeerFromRoom(roomId: string, socketId: string) {
         const room = this.rooms.get(roomId);
         if (!room) return;
         
         room.removePeer(socketId);
         
         if (room.isEmpty()) {
             room.close();
             this.rooms.delete(roomId);
             console.log(`Room ${roomId} closed`);
         }
    }
    
    getRoom(roomId: string) {
        return this.rooms.get(roomId);
    }
}