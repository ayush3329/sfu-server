class User {

    name: string; // name of user
    roomId: string; // we can get room Router of user from resource pool with the help of roomId
    socketId: string; 
    workerIndex: number; //index of worker in which the room is created for this user (will be same for all the user which are in the same meeting)

    producerTransport: string;
    consumerTransport: string;


    // 2. Initialize them using a constructor
    constructor(name: string, roomId: string, socketId: string) {
        this.name = name;
        this.roomId = roomId;
        this.socketId = socketId;
    }

    // A method to change the user's status
    setWorkerIndex(index: number): void {
        this.workerIndex = index;
    }
    
    setProducerTransport(id: string){
        this.producerTransport = id;
    }

    setConsumerTransport(id: string){
        this.consumerTransport = id;
    }

}

export default User;