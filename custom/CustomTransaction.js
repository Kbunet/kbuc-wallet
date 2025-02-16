const bitcoin = require('bitcoinjs-lib');
const varuint = require('varuint-bitcoin');
const bufferutils_1 = require('./bufferutils');
const types = require('./types');
const bcrypto = require('./crypto');

const { typeforce } = types;
function varSliceSize(someScript) {
  const length = someScript.length;
  return bufferutils_1.varuint.encodingLength(length) + length;
}
function vectorSize(someVector) {
  const length = someVector.length;
  return (
    bufferutils_1.varuint.encodingLength(length) +
    someVector.reduce((sum, witness) => {
      return sum + varSliceSize(witness);
    }, 0)
  );
}
const EMPTY_BUFFER = Buffer.allocUnsafe(0);
const EMPTY_WITNESS = [];
const ZERO = Buffer.from(
  '0000000000000000000000000000000000000000000000000000000000000000',
  'hex',
);
const ONE = Buffer.from(
  '0000000000000000000000000000000000000000000000000000000000000001',
  'hex',
);
const VALUE_UINT64_MAX = Buffer.from('ffffffffffffffff', 'hex');
const BLANK_OUTPUT = {
  script: EMPTY_BUFFER,
  valueBuffer: VALUE_UINT64_MAX,
};
function isOutput(out) {
  return out.value !== undefined;
}

// Custom Transaction class to handle additional fields
class CustomTransaction extends bitcoin.Transaction {
  constructor() {
    super();
    // this.issuedBy = null;
    // this.signature = null;
    this.vTickets = [];
  }

  // Override toHex method to include new fields
  toHex() {
    return super.toHex();
    const baseHex = super.toHex();
    // const issuedByHex = this.issuedBy ? Buffer.from(this.issuedBy, 'hex').toString('hex') : '';
    // const signatureHex = this.signature ? Buffer.from(this.signature, 'hex').toString('hex') : '';
    const ticketsHex = this.vTickets.length ? this.vTickets.map(ticket => Buffer.from(ticket, 'hex').toString('hex')).join('') : '';
    return `${baseHex}${ticketsHex}`;
  }

  // Override fromHex method to extract new fields
  static fromHex2(hex) {
    const buffer = Buffer.from(hex, 'hex');
    let offset = 0;

    const tx = new CustomTransaction();
    tx.version = buffer.readInt32LE(offset);
    offset += 4;

    const vinLen = varuint.decode(buffer, offset);
    offset += varuint.decode.bytes;
    for (let i = 0; i < vinLen; ++i) {
      const vin = {};
      vin.hash = buffer.slice(offset, offset + 32);
      offset += 32;
      vin.index = buffer.readUInt32LE(offset);
      offset += 4;
      const scriptLen = varuint.decode(buffer, offset);
      offset += varuint.decode.bytes;
      vin.script = buffer.slice(offset, offset + scriptLen);
      offset += scriptLen;
      vin.sequence = buffer.readUInt32LE(offset);
      offset += 4;
      tx.ins.push(vin);
    }

    const voutLen = varuint.decode(buffer, offset);
    offset += varuint.decode.bytes;
    for (let i = 0; i < voutLen; ++i) {
      const vout = {};
      vout.value = Number(buffer.readBigUInt64LE(offset)); // Convert BigInt to Number
      console.log(`Output ${i}: value=${vout.value}`); // Add logging to trace values
      offset += 8;
      const scriptLen = varuint.decode(buffer, offset);
      offset += varuint.decode.bytes;
      vout.script = buffer.slice(offset, offset + scriptLen);
      offset += scriptLen;
      tx.outs.push(vout);
    }

    tx.locktime = buffer.readUInt32LE(offset);
    offset += 4;

    // Extract custom fields
    const issuedByLength = 33 * 2; // Length of compressed public key in hex
    const signatureLength = 64 * 2; // Length of Schnorr signature in hex

    const issuedByHex = hex.slice(offset * 2, offset * 2 + issuedByLength);
    const signatureHex = hex.slice(offset * 2 + issuedByLength, offset * 2 + issuedByLength + signatureLength);
    const ticketsHex = hex.slice(offset * 2 + issuedByLength + signatureLength);

    tx.issuedBy = issuedByHex;
    tx.signature = signatureHex;

    for (let i = 0; i < ticketsHex.length; i += 128) { // Each ticket is 64 bytes (128 hex chars)
      tx.vTickets.push(ticketsHex.slice(i, i + 128));
    }

    // Check if there's any remaining data that wasn't parsed
    const expectedLength = offset * 2 + issuedByLength + signatureLength + ticketsHex.length;
    if (hex.length !== expectedLength) {
      console.error(`Expected length: ${expectedLength}, actual length: ${hex.length}`);
      throw new Error('Transaction has unexpected data');
    }

    console.log(`Deserialized custom transaction from hex: issuedBy=${tx.issuedBy}, signature=${tx.signature}, tickets=${tx.vTickets}`);
    return tx;
  }
  
  static fromBuffer(buffer, _NO_STRICT) {
    const bufferReader = new bufferutils_1.BufferReader(buffer);
    const tx = new CustomTransaction();
    tx.version = bufferReader.readInt32();
    const marker = bufferReader.readUInt8();
    const flag = bufferReader.readUInt8();
    let hasWitnesses = false;
    if (
      marker === bitcoin.Transaction.ADVANCED_TRANSACTION_MARKER &&
      flag === bitcoin.Transaction.ADVANCED_TRANSACTION_FLAG
    ) {
      hasWitnesses = true;
    } else {
      bufferReader.offset -= 2;
    }
    const vinLen = bufferReader.readVarInt();
    for (let i = 0; i < vinLen; ++i) {
      tx.ins.push({
        hash: bufferReader.readSlice(32),
        index: bufferReader.readUInt32(),
        // nType: bufferReader.readUInt32(),
        script: bufferReader.readVarSlice(),
        sequence: bufferReader.readUInt32(),
        witness: EMPTY_WITNESS,
      });
    }
    const voutLen = bufferReader.readVarInt();
    for (let i = 0; i < voutLen; ++i) {
      tx.outs.push({
        value: bufferReader.readUInt64(),
        script: bufferReader.readVarSlice(),
      });
    }
    if (hasWitnesses) {
      for (let i = 0; i < vinLen; ++i) {
        tx.ins[i].witness = bufferReader.readVector();
      }
      // was this pointless?
      if (!tx.hasWitnesses())
        throw new Error('Transaction has superfluous witness data');
    }
    tx.locktime = bufferReader.readUInt32();
    // read tickets
    const vticketsLen = bufferReader.readVarInt();
    // console.log(`Tickets length:`, vticketsLen);
    // console.log(`Buffer size:`, bufferReader.offset);
    for (let i = 0; i < vticketsLen; ++i) {
      const supportedHash = bufferReader.readVarSlice();
      // console.log(`Buffer size:`, bufferReader.offset);
      const workerPubKey = bufferReader.readVarSlice();
      // console.log(`Buffer size:`, bufferReader.offset);
      const nHeight = bufferReader.readInt32();
      // console.log(`Buffer size:`, bufferReader.offset);
      const supportPubKey = bufferReader.readVarSlice();
      // console.log(`Buffer size:`, bufferReader.offset);
      const rewardType = bufferReader.readUInt8();
      // console.log(`Buffer size:`, bufferReader.offset);
      const timestamp = bufferReader.readInt32();
      // console.log(`Buffer size:`, bufferReader.offset);
      const nonce = bufferReader.readInt32();
      // console.log(`Buffer size:`, bufferReader.offset);
      const ticket = {
        supportedHash,
        workerPubKey,
        supportPubKey,
        nHeight,
        rewardType,
        timestamp,
        nonce
      }
      console.log(`Ticket:`, ticket);
      tx.vTickets.push(ticket);
    }
    if (_NO_STRICT) return tx;
    if (bufferReader.offset !== buffer.length)
      throw new Error('Transaction has unexpected data');

    return tx;
  }

  static fromHex(hex) {
    return CustomTransaction.fromBuffer(Buffer.from(hex, 'hex'), true);
  }

  
  byteLength(_ALLOW_WITNESS = true, isPure = false) {
    let baseLength = super.byteLength(_ALLOW_WITNESS);
    console.log(`Base Length:`, baseLength);
    // Calculate the size of the tickets
    const ticketsSize = this.vTickets.reduce((sum, ticket) => sum + ticket.byteLength(), 0);
    console.log(`Base Length:`, ticketsSize);
    if (isPure) {
      return baseLength;
    } else {
      return baseLength + ticketsSize + 1;
    }
  }

  __toBuffer(buffer, initialOffset, _ALLOW_WITNESS = false, isPure = false) {
    if (!buffer) buffer = Buffer.allocUnsafe(this.byteLength(_ALLOW_WITNESS, isPure));
    const bufferWriter = new bufferutils_1.BufferWriter(
      buffer,
      initialOffset || 0,
    );
    bufferWriter.writeInt32(this.version);
    const hasWitnesses = _ALLOW_WITNESS && this.hasWitnesses();
    if (hasWitnesses) {
      bufferWriter.writeUInt8(bitcoin.Transaction.ADVANCED_TRANSACTION_MARKER);
      bufferWriter.writeUInt8(bitcoin.Transaction.ADVANCED_TRANSACTION_FLAG);
    }
    bufferWriter.writeVarInt(this.ins.length);
    this.ins.forEach(txIn => {
      bufferWriter.writeSlice(txIn.hash);
      bufferWriter.writeUInt32(txIn.index);
      // bufferWriter.writeUInt32(0);
      bufferWriter.writeVarSlice(txIn.script);
      bufferWriter.writeUInt32(txIn.sequence);
    });
    bufferWriter.writeVarInt(this.outs.length);
    this.outs.forEach(txOut => {
      if (isOutput(txOut)) {
        bufferWriter.writeUInt64(txOut.value);
      } else {
        bufferWriter.writeSlice(txOut.valueBuffer);
      }
      bufferWriter.writeVarSlice(txOut.script);
    });
    if (hasWitnesses) {
      this.ins.forEach(input => {
        bufferWriter.writeVector(input.witness);
      });
    }
    bufferWriter.writeUInt32(this.locktime);
    if (!isPure) {
      // write the tickets
      // console.log(`Tickets length:`, this.vTickets.length);
      bufferWriter.writeVarInt(this.vTickets.length);
      // console.log(`Buffer size:`, bufferWriter.offset);
      this.vTickets.forEach(ticket => {
        bufferWriter.writeVarSlice(ticket.supportedHash);
        // console.log(`Buffer size:`, bufferWriter.offset);
        bufferWriter.writeVarSlice(ticket.workerPubKey);
        // console.log(`Buffer size:`, bufferWriter.offset);
        bufferWriter.writeUInt32(ticket.nHeight);
        // console.log(`Buffer size:`, bufferWriter.offset);
        bufferWriter.writeVarSlice(ticket.supportPubKey);
        // console.log(`Buffer size:`, bufferWriter.offset);
        bufferWriter.writeUInt8(ticket.rewardType);
        // console.log(`Buffer size:`, bufferWriter.offset);
        bufferWriter.writeUInt32(ticket.timestamp);
        // console.log(`Buffer size:`, bufferWriter.offset);
        bufferWriter.writeUInt32(ticket.nonce);
        // console.log(`Buffer size:`, bufferWriter.offset);
      });
    }
    // avoid slicing unless necessary
    if (initialOffset !== undefined)
      return buffer.slice(initialOffset, bufferWriter.offset);
    return buffer;
  }

  toBuffer(buffer, initialOffset, isPure = false) {
    return this.__toBuffer(buffer, initialOffset, true, isPure);
  }
  
  getHash(forWitness, isPure = false) {
    // wtxid for coinbase is always 32 bytes of 0x00
    if (forWitness && this.isCoinbase()) return Buffer.alloc(32, 0);
    return bcrypto.hash256(this.__toBuffer(undefined, undefined, forWitness, isPure));
  }

  getPureId() {
    // transaction hash's are displayed in reverse order
    return (0, bufferutils_1.reverseBuffer)(this.getHash(false, true)).toString(
      'hex',
    );
  }
}


module.exports = CustomTransaction;