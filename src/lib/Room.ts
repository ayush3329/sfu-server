import { Router, WebRtcTransport } from "mediasoup/node/lib/types";
import { Peer } from "./Peer";
import  config  from "../configs/mediaSoup-config";

export class Room {
    public id: string;
    public router: Router;
    public peers = new Map<string, Peer>();

    constructor(roomId: string, router: Router) {
        this.id = roomId;
        this.router = router;
    }

    addPeer(peer: Peer) {
        this.peers.set(peer.id, peer);
    }

    getPeer(socketId: string) {
        return this.peers.get(socketId);
    }

    removePeer(socketId: string) {
        const peer = this.peers.get(socketId);
        if (peer) {
            peer.close();
            this.peers.delete(socketId);
        }
    }

    async createWebRtcTransport(socketId: string) {
        const peer = this.peers.get(socketId);
        if (!peer) throw new Error("Peer not found");

        const transport = await this.router.createWebRtcTransport(config.webRtcTransport);
        peer.addTransport(transport);

        return {
            params: {
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters,
            },
            transport // Return object if needed internally
        };
    }

    // This is the "Bridge" replacement for your Global Map
    findProducer(producerId: string) {
        for (const peer of this.peers.values()) {
            const producer = peer.getProducer(producerId);
            if (producer) {
                return producer;
            }
        }
        return undefined;
    }

    getProducerListForPeer(socketId: string) {
        const producerList: { producerId: string, kind: string, socketId: string, username: string }[] = [];
        this.peers.forEach((peer) => {
            if (peer.id !== socketId) {
                peer.producers.forEach((producer) => {
                    producerList.push({ 
                        producerId: producer.producer.id, 
                        kind: producer.kind, 
                        socketId: peer.id,
                        username: peer.name
                    });
                });
            }
        });
        return producerList;
    }

    getRtpCapabilities() {
        return this.router.rtpCapabilities;
    }
}