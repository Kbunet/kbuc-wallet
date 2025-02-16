
const bufferutils_1 = require('./bufferutils');

class SupportTicket {
    constructor(ticket) {
      this.supportedHash =  Buffer.from(ticket.supportedHash);
      this.workerPubKey =  Buffer.from(ticket.workerPubKey);
      this.nHeight =  ticket.nHeight;
      this.supportPubKey =  Buffer.from(ticket.supportPubKey);
      this.rewardType =  ticket.rewardType;
      this.timestamp =  ticket.timestamp;
      this.nonce =  ticket.nonce;

      // console.log('supportedHash:', this.supportedHash);
      // console.log('workerPubKey:', this.workerPubKey);
      // console.log('supportPubKey:', this.supportPubKey);
    }

    byteLength() {
        // Assume supportedHash, workerPubKey, supportPubKey are 32-byte hashes
        const hashSize = 64; // 32 bytes for each hash
        const pubKeySize = 40; // 33 bytes for a compressed public key
        const nHeight = 4;
        const rewardType = 1; // 4 bytes for timestamp as a 32-bit integer
        const timestampSize = 4; // 4 bytes for timestamp as a 32-bit integer
        const nonceSize = 4; // 4 bytes for nonce as a 32-bit integer

        return 3 + hashSize + pubKeySize + pubKeySize + nHeight + rewardType + timestampSize + nonceSize;
    }

    // toHex() {
    //     let buffer = Buffer.allocUnsafe(this.byteLength());
    //     const bufferWriter = new bufferutils_1.BufferWriter(buffer, 0);
    //     bufferWriter.writeVarSlice(this.supportedHash);
    //     // console.log(`Buffer size:`, bufferWriter.offset);
    //     bufferWriter.writeVarSlice(this.workerPubKey);
    //     // console.log(`Buffer size:`, bufferWriter.offset);
    //     bufferWriter.writeUInt32(this.nHeight);
    //     // console.log(`Buffer size:`, bufferWriter.offset);
    //     bufferWriter.writeVarSlice(this.supportPubKey);
    //     // console.log(`Buffer size:`, bufferWriter.offset);
    //     bufferWriter.writeUInt8(this.rewardType);
    //     // console.log(`Buffer size:`, bufferWriter.offset);
    //     bufferWriter.writeUInt32(this.timestamp);
    //     // console.log(`Buffer size:`, bufferWriter.offset);
    //     bufferWriter.writeUInt32(this.nonce);

    //     return bufferWriter.toString('hex');
    // }

    // static fromHex(hex, _NO_STRICT=true) {
    //     let buffer = Buffer.from(hex, 'hex');
    //     const bufferReader = new bufferutils_1.BufferReader(buffer);
    //     const st = new SupportTicket();
    //     st.supportedHash = bufferReader.readSlice(32);
    //     st.workerPubKey = bufferReader.readSlice(32);
    //     st.supportPubKey = bufferReader.readSlice(32);
    //     st.timestamp = bufferReader.readUInt32();
    //     st.nonce = bufferReader.readInt32();
    //     if (_NO_STRICT) return st;
    //     if (bufferReader.offset !== buffer.length)
    //       throw new Error('Support ticket has unexpected data');
    
    //     return st;
    //   }

}

module.exports = SupportTicket;