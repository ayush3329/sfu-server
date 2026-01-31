import * as mediasoup from "mediasoup";
import { RoomEntry,  ProducerTransport, Producer, ConsumerTransport, Consumer } from "../Types/types";
import config from "../configs/mediaSoup-config";
import User from "./User";

class PoolCollection {
    
    nextWorkerIndex = 0;
    
    // Stores the information of C++ worker we have spawned
    workerPool: Map<number,  mediasoup.types.Worker<mediasoup.types.AppData>> = new Map();
    /*
    {
      0: Worker1141,
      1: Worker21245,
      3: Worker151
    }
    */

    // Store the information of room we have created inside a worker (1 worker can have multiple room)
    roomPool: Map<string, RoomEntry> = new Map(); 
    /*
    {
      "roomA": {router: {}, workerIndex: 0, userInMeeting: 2}
      "roomB": {router: {}, workerIndex: 1, userInMeeting: 3}
      "roomC": {router: {}, workerIndex: 2, userInMeeting: 6}
    }  
    */

   
   

   

    /* ------------------------------- Room Pool ---------------------------------- */

    async createRoom(roomId: string, user: User) {
        
        // check if room Exist
        const meeting_room = this.getRoomData(roomId);
        
        if(meeting_room != undefined){
            // If the room already exist, return the room Router and update the number of user in the meeting
            user.setWorkerIndex(meeting_room.workerIndex);
            this.updateRoom(roomId, {...meeting_room, userInMeeting: meeting_room.userInMeeting+1});
            console.log(`${roomId} already exist. No of user in the meeting-room is ${this.getRoomData(roomId)?.userInMeeting}`)
            return meeting_room.router;
        }

        

        const worker = this.getWorker();
        user.setWorkerIndex(this.nextWorkerIndex-1);

        if(worker == undefined) {
            // Worker Error
            return Promise.reject({type: "worker-error", message: "Unable to create/get worker"});
        }

        // Create room Inside worker
        const room = await worker.createRouter({ mediaCodecs: config.router.mediaCodecs });

        if(room == undefined) {
            // Room Error
            return Promise.reject({type: "room-error", message: "Unable to create room"});
        }

        this.roomPool.set(roomId, { router: room, workerIndex: this.nextWorkerIndex-1 , userInMeeting: 1});

        console.log(`${roomId} does not exist, Creating new Room. No of uer in the room 1`);

        return room;
        
    }
  
    async getRoomRouter(roomId: string, user: User) {
        const room = this.roomPool.get(roomId);
        if(room == undefined){
            return await this.createRoom(roomId, user)
        }
        return room.router;
    }

    getRoomData(roomId: string) {
        return this.roomPool.get(roomId)
    }

    updateRoom(roomId: string, roomData: RoomEntry): void {
        // Updating room Data
        this.roomPool.delete(roomId);
        this.roomPool.set(roomId, roomData);
    }

    deleteRoom(roomId: string): void {
        this.roomPool.delete(roomId)
    }


    /* ------------------------------- Worker Pool ---------------------------------- */

    saveWorker(workerIndex: number, worker: mediasoup.types.Worker<mediasoup.types.AppData>): void {
        this.workerPool.set(workerIndex, worker);
    }

    getWorker() {
        const worker = this.workerPool.get(this.nextWorkerIndex); 

        const totalWorkers = this.workerPool.size;
        this.nextWorkerIndex = (this.nextWorkerIndex + 1) % totalWorkers;

        return worker;

    }
    

    /* -----------------------------------Utility--------------------------------------- */

    spawnNewWorker = async(workerIndex: number, minPort: number, maxPort: number)=>{
  
        console.log(`Spawning/Restarting ${workerIndex} worker`);

        // Each worker runs on a CORE and each worker can have multiple ROOMs inside it
        const worker = await mediasoup.createWorker({
            logLevel: config.worker.logLevel,
            logTags: config.worker.logTags,
            rtcMinPort: minPort, 
            rtcMaxPort: maxPort        
        });

        worker.on('died', () => {
            console.error(`Worker ${worker.pid} (Slot ${workerIndex}) died!`);
            this.spawnNewWorker(workerIndex, minPort, maxPort);
        });
        
        this.saveWorker(workerIndex, worker);

    }


}

export default PoolCollection; 