import { WebRtcTransport } from "mediasoup/node/lib/WebRtcTransportTypes";
import { Router } from "mediasoup/node/lib/RouterTypes";
import * as mediasoup from "mediasoup";



export interface RoomEntry {
  router: Router; // room Router
  workerIndex: number; //index on worker on which room is created
  userInMeeting: number; // number of users in the room
}

interface Transport {
  transport: WebRtcTransport;
  socketId: string;
  roomId: string;
  consumer: boolean;
}

export interface ProducerTransport extends Transport{
  videoProducer: string|null;
  audioProducer: string|null;
  screenProducer: string|null;
}

export interface ConsumerTransport  extends Transport{
  videoConsumer: Map<string, Consumer> | null;
  audioConsumer: Map<string, Consumer> | null;
  screenConsumer: Map<string, Consumer> | null;
}

export interface Producer {
  roomId: string;
  username: string;
  socketId: string;
  transportId: string;
  producer: mediasoup.types.Producer<mediasoup.types.AppData>
}

export interface Consumer {
  roomId: string;
  username: string;
  socketId: string;
  transportId: string;
  consumer: mediasoup.types.Consumer<mediasoup.types.AppData>
}
