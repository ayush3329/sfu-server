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
    
    producerTransport: Map<string, ProducerTransport>= new Map();
        videoProducer: Map<string,  Producer> = new Map();
        audioProducer: Map<string,  Producer> = new Map();
        screenProducer: Map<string,  Producer> = new Map();


    consumerTransport: Map<string, ConsumerTransport>= new Map(); 

    // TransportPool: Map<string, TransportEntry>= new Map(); //It holds all the transport connection
    /*
    {
       "transportId__1": {transport: {}, socketId: "some random Text 1", consumer: false, roomId: "ayush-room"},
       "transportId__2": {transport: {}, socketId: "some random Text 2", consumer: true,  roomId: "ayush-room"}
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


    /* ------------------------------- Producer Transport ---------------------------------- */

    saveProducerTransport(tranportId: string, data: ProducerTransport): void {
        this.producerTransport.set(tranportId, data);
    }

    getProducerTransort(transportId: string) {
        return this.producerTransport.get(transportId);
    }

    updateProducerTransport(transportId: string, type: "video" | "audio" | "screen", producerId: string): void {
        if(type === "video"){
            let producerTransport = this.producerTransport.get(transportId);
            if(producerTransport){
                this.producerTransport.set(transportId, {...producerTransport, videoProducer: producerId});
            }
        } else if(type === "audio"){
            let producerTransport = this.producerTransport.get(transportId);
            if(producerTransport){
                this.producerTransport.set(transportId, {...producerTransport, audioProducer: producerId});
            }
        } else{
            let producerTransport = this.producerTransport.get(transportId);
            if(producerTransport){
                this.producerTransport.set(transportId, {...producerTransport, screenProducer: producerId});
            }
        }
    }


    /* ------------------------------- Producers ---------------------------------- */

    saveVideoProducer(videoProducerId: string, data: Producer) {
        this.videoProducer.set(videoProducerId, data);
    }

    saveAudioProducer(audioProducerId: string, data: Producer) {
        this.audioProducer.set(audioProducerId, data);
    }

    saveScreenProducer(screenProducerId: string, data: Producer) {
        this.screenProducer.set(screenProducerId, data);
    }

    getProducer(producerId: string, kind: "video" | "audio" | "screen"){
        if(kind === "video")
            return this.videoProducer.get(producerId);
        else if(kind === "audio")
            return this.audioProducer.get(producerId);
        else 
            return this.screenProducer.get(producerId);
    }

    deleteProducer(producerId: string, producerTransportId: string, kind: "audio" | "video" | "screen"){
        if(kind === "video"){
            this.videoProducer.delete(producerId);
            const transport = this.producerTransport.get(producerTransportId);
            if(!transport) return;
            transport.videoProducer = null;
            this.producerTransport.set(producerTransportId, transport);
        } else if(kind === "audio"){
            this.audioProducer.delete(producerId);
            const transport = this.producerTransport.get(producerTransportId);
            if(!transport) return;
            transport.audioProducer = null;
            this.producerTransport.set(producerTransportId, transport);
        } else{
            this.screenProducer.delete(producerId);
            const transport = this.producerTransport.get(producerTransportId);
            if(!transport) return;
            transport.screenProducer = null;
            this.producerTransport.set(producerTransportId, transport);
        }
            
    }

    updateVideoProducer(producerId: string, consumerId: string) {
        const data = this.videoProducer.get(producerId);
        if(!data) return;
        data.associatedConsumers.push(consumerId);
    }

    updateAudioProducer(producerId: string, consumerId: string) {
        const data = this.audioProducer.get(producerId);
        if(!data) return;
        data.associatedConsumers.push(consumerId);
    }

    updateScreenProducer(producerId: string, consumerId: string) {
        const data = this.screenProducer.get(producerId);
        if(!data) return;
        data.associatedConsumers.push(consumerId);
    }




    
    /* ------------------------------- Consumer Transport ---------------------------------- */
    
    saveConsumerTransport(tranportId: string, data: ConsumerTransport): void {
        this.consumerTransport.set(tranportId, data);
    }

    getConsumerTransort(transportId: string) {
        return this.consumerTransport.get(transportId);
    }

    updateConsumerTransport(transportId: string, type: "video" | "audio" | "screen", consumerId: string, data: Consumer): void {
        
        let consumerTransport = this.consumerTransport.get(transportId);

        if(!consumerTransport){
            console.log("Consumer transport does not exist")
            return;
        }

        if(type === "video"){
            if(!consumerTransport.videoConsumer) consumerTransport.videoConsumer = new Map<string, Consumer>()
            consumerTransport.videoConsumer.set(consumerId, data);
        } else if(type === "audio"){
            if(!consumerTransport.audioConsumer) consumerTransport.audioConsumer = new Map<string, Consumer>()
            consumerTransport.audioConsumer.set(consumerId, data);
        } else{
            if(!consumerTransport.screenConsumer) consumerTransport.screenConsumer = new Map<string, Consumer>()
            consumerTransport.screenConsumer.set(consumerId, data);
        }
    }


    /* ------------------------------- Consumer ---------------------------------- */

    getConsumer(consumerTransportId: string, kind: "audio" | "video" | "screen", consumerId: string){
        const consumerTransport = this.consumerTransport.get(consumerTransportId);
        if(!consumerTransport) {
            console.log("Consumer transport does not exist");
            return null;
        }
        
        if(kind === "video"){
            if(!consumerTransport.videoConsumer){
                console.log("Video Consumers are empty");
                return null;
            }
            const consumer = consumerTransport.videoConsumer.get(consumerId);

            if(!consumer){
                console.log("Video Consumers are empty 2");
                return null;
            }
            return consumer;
        } else if(kind === "audio"){
            if(!consumerTransport.audioConsumer){
                console.log("Audio Consumers are empty");
                return null;
            }
            const consumer = consumerTransport.audioConsumer.get(consumerId);

            if(!consumer){
                console.log("Audio Consumers are empty 2");
                return null;
            }
            return consumer;
        } else{
            if(!consumerTransport.screenConsumer){
                console.log("Screen Consumers are empty");
                return null;
            }
            const consumer = consumerTransport.screenConsumer.get(consumerId);

            if(!consumer){
                console.log("Screen Consumers are empty 2");
                return null;
            }
            return consumer;
        }

        
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