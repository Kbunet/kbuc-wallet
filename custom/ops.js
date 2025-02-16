const bitcoin = require('bitcoinjs-lib');

// Define a new opcode, choosing a value that doesn't conflict with existing opcodes
const OPS = {
  ...bitcoin.opcodes,
  OP_REPUTATION: 192 // Example: 0xb5 is a hypothetical unused opcode value
};

// Optionally, extend the library’s `opcodes` object with your new opcode
bitcoin.opcodes = OPS;
