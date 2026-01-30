import * as mediasoup from "mediasoup";
import { WebRtcTransport } from "mediasoup/node/lib/WebRtcTransportTypes";

class StreamProducer {
    // VideoProducer or AudioProducer or ScreenProducer
    kind: string;
    producer: mediasoup.types.Producer<mediasoup.types.AppData>;
    associatedConsumers: string[] = [];

    constructor(kind: string, producer: mediasoup.types.Producer<mediasoup.types.AppData>) {
        this.kind = kind;
        this.producer = producer;
    }
}

class StreamConsumer {
    // VideoConsumer or AudioConsumer or ScreenConsumer
    kind: string;
    consumer: mediasoup.types.Consumer<mediasoup.types.AppData>;
    
    constructor(kind: string, consumer: mediasoup.types.Consumer<mediasoup.types.AppData>) {
        this.kind = kind;
        this.consumer = consumer;
    }


}

class User {
    
    name: string; // name of user
    roomId: string; // we can get room Router of user from resource pool with the help of roomId
    socketId: string; 
    workerIndex: number; //index of worker in which the room is created for this user (will be same for all the user which are in the same meeting)

    producerTransport: WebRtcTransport | null; // transport for sending media to server
    consumerTransport: WebRtcTransport | null; // transport for receiving media from server

    videoProducer: StreamProducer | null; // producer for sending video to server
    audioProducer: StreamProducer | null; // producer for sending audio to server
    screenProducer: StreamProducer | null; // producer for sending screen to server

    videoConsumer: Map<string, StreamConsumer>; // consumers for receiving video from server
    audioConsumer: Map<string, StreamConsumer>; // consumers for receiving audio from server
    screenConsumer: Map<string, StreamConsumer>; // consumers for receiving screen from server


    constructor(name: string, roomId: string, socketId: string) {
        this.name = name;
        this.roomId = roomId;
        this.socketId = socketId;
        this.producerTransport = null;
        this.consumerTransport = null;
        this.workerIndex = -1; 

        this.videoProducer = null;
        this.audioProducer = null;
        this.screenProducer = null;
        
        // Consumers (multiple consumers for each kind as multiple users)
        this.videoConsumer = new Map<string, StreamConsumer>();
        this.audioConsumer = new Map<string, StreamConsumer>();
        this.screenConsumer = new Map<string, StreamConsumer>();
    }

    // A method to change the user's status
    setWorkerIndex(index: number): void {
        this.workerIndex = index;
    }

    saveProducer(kind: string, producer: mediasoup.types.Producer<mediasoup.types.AppData>){
        const streamProducer = new StreamProducer(kind, producer);

        if(kind === "video"){
            this.videoProducer = streamProducer;
        } else if(kind === "audio"){
            this.audioProducer = streamProducer;
        } else if(kind === "screen"){
            this.screenProducer = streamProducer;
        } else{
            console.log("saving N/A Producer");
        }
    }

    saveConsumer(kind: string, consumer: mediasoup.types.Consumer<mediasoup.types.AppData>){
        
        const streamConsumer = new StreamConsumer(kind, consumer);
        if(kind === "video"){
            this.videoConsumer.set(consumer.id, streamConsumer);
        } else if(kind === "audio"){
            this.audioConsumer.set(consumer.id, streamConsumer);
        } else if(kind === "screen"){
            this.screenConsumer.set(consumer.id, streamConsumer);
        }
    }



}

export default User;