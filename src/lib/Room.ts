import { Router, Worker } from "mediasoup/node/lib/types";
import { Peer } from "./Peer";
import config from "../configs/mediaSoup-config"; // Assume you have this

export class Room {
    public id: string;
    public router: Router;
    public peers = new Map<string, Peer>(); // socketId -> Peer

    constructor(id: string, router: Router) {
        this.id = id;
        this.router = router;
    }

    addPeer(peer: Peer) {
        this.peers.set(peer.id, peer);
    }

    removePeer(socketId: string) {
        const peer = this.peers.get(socketId);
        if (peer) {
            peer.close(); // Stop all their streams
            this.peers.delete(socketId);
        }
    }

    // Helper: Get all producers in this room (except the requester's own)
    getProducerListForPeer(socketId: string) {
        const producerList: { producerId: string }[] = [];
        this.peers.forEach((peer) => {
            if (peer.id !== socketId) {
                peer.producers.forEach((producer) => {
                    producerList.push({ producerId: producer.id });
                });
            }
        });
        return producerList;
    }
    
    // Check if room is empty
    isEmpty() {
        return this.peers.size === 0;
    }

    close() {
        this.router.close();
    }
}