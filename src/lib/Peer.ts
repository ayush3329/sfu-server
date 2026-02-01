import { Consumer, Producer, WebRtcTransport } from "mediasoup/node/lib/types";

export class Peer {
    public id: string; // Socket ID
    public name: string;
    public transports = new Map<string, WebRtcTransport>();

    public producers = new Map<string, {producer: Producer, kind: string}>();
    public consumers = new Map<string, {consumer: Consumer, kind: string}>();

    constructor(socketId: string, name: string) {
        this.id = socketId;
        this.name = name;
    }

    addTransport(transport: WebRtcTransport) {
        this.transports.set(transport.id, transport);

        transport.on('@close', () => {
            console.log(this.name,"'s Transport is closed");
            this.transports.delete(transport.id);
        });
    }

    getTransport(transportId: string) {
        return this.transports.get(transportId);
    }

    addProducer(producer: Producer, kind: string) {
        this.producers.set(producer.id, {producer: producer, kind: kind});
        producer.on('@close', () => {
            this.producers.delete(producer.id);
        });
    }

    getProducer(producerId: string) {
        return this.producers.get(producerId)?.producer;
    }

    getConsumer(consumerId: string){
        return this.consumers.get(consumerId)?.consumer
    }

    addConsumer(consumer: Consumer, kind: string) {
        this.consumers.set(consumer.id, {consumer: consumer, kind: kind});
        consumer.on('@close', () => {
            this.consumers.delete(consumer.id);
        });
    }

    close() {
        this.transports.forEach(transport => transport.close());
    }
}