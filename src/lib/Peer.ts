import { Consumer, Producer, WebRtcTransport } from "mediasoup/node/lib/types";

export class Peer {
    public id: string; // Socket ID
    public name: string;
    public transports = new Map<string, WebRtcTransport>();
    public producers = new Map<string, Producer>();
    public consumers = new Map<string, Consumer>();

    constructor(socketId: string, name: string) {
        this.id = socketId;
        this.name = name;
    }

    addTransport(transport: WebRtcTransport) {
        this.transports.set(transport.id, transport);
        
        // Sr. Engineer Tip: specific listeners for cleanup
        transport.on('dtlsstatechange', (dtlsState) => {
            if (dtlsState === 'closed') transport.close();
        });
        
        transport.on('@close', () => {
             this.transports.delete(transport.id);
        });
    }

    addProducer(producer: Producer) {
        this.producers.set(producer.id, producer);
        producer.on('@close', () => this.producers.delete(producer.id));
    }

    addConsumer(consumer: Consumer) {
        this.consumers.set(consumer.id, consumer);
        consumer.on('@close', () => this.consumers.delete(consumer.id));
    }

    getProducer(producerId: string) {
        return this.producers.get(producerId);
    }

    getConsumer(consumerId: string) {
        return this.consumers.get(consumerId);
    }

    // The "Nuke" button for this user
    close() {
        this.transports.forEach(transport => transport.close());
    }
}