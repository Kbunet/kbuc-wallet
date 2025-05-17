import * as bitcoin from 'bitcoinjs-lib';
import { CoinSelectTarget } from 'coinselect';
import { ECPairFactory } from 'ecpair';
import * as tinysecp from 'tiny-secp256k1';
import ecc from '../../blue_modules/noble_ecc';
import { LegacyWallet } from './legacy-wallet';
import { CreateTransactionResult, CreateTransactionUtxo } from './types';
import CustomPsbt from '../../custom/psbt';
import crypto from 'crypto';
import { toOutputScript } from '../../custom/address';

const ECPair = ECPairFactory(ecc);

export class SegwitBech32Wallet extends LegacyWallet {
  static readonly type = 'segwitBech32';
  static readonly typeReadable = 'P2 WPKH';
  // @ts-ignore: override
  public readonly type = SegwitBech32Wallet.type;
  // @ts-ignore: override
  public readonly typeReadable = SegwitBech32Wallet.typeReadable;
  public readonly segwitType = 'p2wpkh';

  getPubKey(): string | false {
    try {
      const keyPair = ECPair.fromWIF(this.secret);
      return keyPair.publicKey.toString('hex');
    } catch (err) { 
      console.log('decryptOtp error:', err);
      return false;
    }
  } 

  decryptOtp(otp): string | false {
    try {
      console.log('decryptOtp input:', {
        ephemeralPublicKey: otp.ephemeralPublicKey,
        iv: otp.iv,
        authTag: otp.authTag,
        encryptedMessage: otp.encryptedMessage
      });

      if (!this.secret) {
        console.log('decryptOtp error: No secret available');
        return false;
      }

      const keyPair = ECPair.fromWIF(this.secret);
      if (!keyPair.privateKey) {
        console.log('decryptOtp error: No private key available');
        return false;
      }

      // Convert keys and other data to buffers
      console.log('Converting ephemeral public key to buffer');
      const ephemeralKeyPair = ECPair.fromPublicKey(Buffer.from(otp.ephemeralPublicKey, "hex"));
      
      // Derive the shared secret using multiply
      console.log('Deriving shared secret');
      const sharedSecret = tinysecp.pointMultiply(ephemeralKeyPair.publicKey, keyPair.privateKey);
      if (!sharedSecret) {
        console.log('decryptOtp error: Failed to derive shared secret');
        return false;
      }
      console.log('Shared secret derived successfully');

      // Hash the shared secret
      console.log('Hashing shared secret');
      const sharedSecretHash = crypto.createHash("sha256").update(sharedSecret).digest();
      console.log('Shared secret hash:', sharedSecretHash.toString('hex'));

      // Convert IV and auth tag to buffers
      console.log('Converting IV and auth tag to buffers');
      const ivBuffer = Buffer.from(otp.iv, "hex");
      const authTagBuffer = Buffer.from(otp.authTag, "hex");
      console.log('IV length:', ivBuffer.length);
      console.log('Auth tag length:', authTagBuffer.length);

      // Decrypt the message using AES-256-GCM
      console.log('Creating decipher');
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        sharedSecretHash,
        ivBuffer
      );
      console.log('Setting auth tag');
      decipher.setAuthTag(authTagBuffer);

      console.log('Decrypting message');
      let decrypted = decipher.update(otp.encryptedMessage, "hex", "utf8");
      decrypted += decipher.final("utf8");
      console.log('Decryption successful');

      return decrypted;
    } catch (err) {
      console.log('decryptOtp error:', err);
      return false;
    }
  }

  getAddress(): string | false {
    if (this._address) return this._address;
    let address;
    try {
      const keyPair = ECPair.fromWIF(this.secret);
      if (!keyPair.compressed) {
        console.warn('only compressed public keys are good for segwit');
        return false;
      }
      address = bitcoin.payments.p2wpkh({
        pubkey: keyPair.publicKey,
      }).address;
    } catch (err) {
      return false;
    }
    this._address = address ?? false;

    return this._address;
  }

  static witnessToAddress(witness: string): string | false {
    try {
      const pubkey = Buffer.from(witness, 'hex');
      return (
        bitcoin.payments.p2wpkh({
          pubkey,
          network: bitcoin.networks.bitcoin,
        }).address ?? false
      );
    } catch (_) {
      return false;
    }
  }

  /**
   * Converts script pub key to bech32 address if it can. Returns FALSE if it cant.
   *
   * @param scriptPubKey
   * @returns {boolean|string} Either bech32 address or false
   */
  static scriptPubKeyToAddress(scriptPubKey: string): string | false {
    try {
      const scriptPubKey2 = Buffer.from(scriptPubKey, 'hex');
      return (
        bitcoin.payments.p2wpkh({
          output: scriptPubKey2,
          network: bitcoin.networks.bitcoin,
        }).address ?? false
      );
    } catch (_) {
      return false;
    }
  }

  createTransaction(
    utxos: CreateTransactionUtxo[],
    targets: CoinSelectTarget[],
    feeRate: number,
    changeAddress: string,
    sequence: number,
    skipSigning = false,
    masterFingerprint: number,
    txType: string,
  ): CreateTransactionResult {
    if (targets.length === 0) throw new Error('No destination provided');
    // compensating for coinselect inability to deal with segwit inputs, and overriding script length for proper vbytes calculation
    for (const u of utxos) {
      u.script = { length: 27 };
    }
    

    for (const t of targets) {
      if (t.address && t.address.startsWith('kc1')) {
        // in case address is non-typical and takes more bytes than coinselect library anticipates by default
        t.script = { length: toOutputScript(t.address).length + 3 };
      }

      if (t.script?.hex) {
        // setting length for coinselect lib manually as it is not aware of our field `hex`
        t.script.length = t.script.hex.length / 2 - 4;
      }
    }
    // console.log("bech31 txType:", txType);
    const { inputs, outputs, fee } = this.coinselect(utxos, targets, feeRate);
    // console.log("bech31 outputs:", outputs);
    // console.log("bech31 fee:", fee);
    // console.log("bech31 feeRate:", feeRate);
    sequence = sequence || 0xffffffff; // disable RBF by default
    const psbt = new CustomPsbt();
    let c = 0;
    const values: Record<number, number> = {};
    const keyPair = ECPair.fromWIF(this.secret);

    inputs.forEach(input => {
      values[c] = input.value;
      c++;

      const pubkey = keyPair.publicKey;
      const p2wpkh = bitcoin.payments.p2wpkh({ pubkey });
      if (!p2wpkh.output) {
        throw new Error('Internal error: no p2wpkh.output during createTransaction()');
      }

      psbt.addInput({
        hash: input.txid,
        index: input.vout,
        sequence,
        witnessUtxo: {
          script: p2wpkh.output,
          value: input.value,
        },
      });
    });
    
    const supportValue = outputs.at(0)?.value ?? 0;
    // console.log("supportValue:", supportValue);
    outputs.forEach(output => {
      // if output has no address - this is change output
      // if (!output.address && !output.script?.hex) {
      if (!output.address && !output.script?.hex) {
        output.address = changeAddress;
        // output.value = output.value + supportValue - fee;
        // output.value = output.value + fee;
      }

      const outputData = {
        address: output.address,
        value: output.value,
        script: output.script?.hex ? Buffer.from(output.script.hex, 'hex') : undefined,
      };

      psbt.addOutput(outputData);
    });

    if (!skipSigning) {
      // skiping signing related stuff
      for (let cc = 0; cc < c; cc++) {
        psbt.signInput(cc, keyPair);
      }
    }

    let tx;
    if (!skipSigning) {
      tx = psbt.finalizeAllInputs().extractTransaction();
    }
    return { tx, inputs, outputs, fee, psbt };
  }

  
  createUnstakingTransaction(
    utxos: CreateTransactionUtxo[],
    targets: CoinSelectTarget[],
    feeRate: number,
    changeAddress: string,
    sequence: number,
    skipSigning = false,
    masterFingerprint: number,
    txType: string,
  ): CreateTransactionResult {
    if (targets.length === 0) throw new Error('No destination provided');
    // compensating for coinselect inability to deal with segwit inputs, and overriding script length for proper vbytes calculation
    for (const u of utxos) {
      u.script = { length: 27 };
    }
    
    // console.log("bech31 txType:", txType);
    const { inputs, outputs, fee } = this.coinselect(utxos, targets, feeRate);
    // console.log("bech31 outputs:", outputs);
    // console.log("bech31 fee:", fee);
    // console.log("bech31 feeRate:", feeRate);
    sequence = sequence || 0xffffffff; // disable RBF by default
    const psbt = new CustomPsbt();
    const keyPair = ECPair.fromWIF(this.secret);
    const pubkey = keyPair.publicKey;

    
    // 🔹 Generate the Special TXID (zeros + hash160)
    const hash160 = bitcoin.crypto.ripemd160(bitcoin.crypto.sha256(pubkey));
    const specialTxid = Buffer.concat([Buffer.alloc(12, 0), hash160]); // 12 bytes of 0s + hash160
    // const specialTxid = Buffer.alloc(32, 0); // 12 bytes of 0s + hash160
    // console.log("Special TXID:", specialTxid.toString('hex'));
    // 🔹 Define the unstaking input
    const unstakingInput = {
      hash: specialTxid.toString('hex'), // TXID (special format)
      index: 0, // Output index
      sequence,
      witnessUtxo: {
          script: Buffer.from('0014' + hash160.toString('hex'), 'hex'), // P2WPKH script
          value: targets[0].value, // Amount (in satoshis)
      }
    };
    // Add special unstaking input
    psbt.addInput(unstakingInput);
    
    
    // 🔹 Define the unstaking output (P2WPKH for issuer)
    const p2wpkh = bitcoin.payments.p2wpkh({ pubkey });
    // console.log("Issuer P2WPKH Address:", p2wpkh.address);
    // Add output (issuer's P2WPKH)
    psbt.addOutput({
      address: p2wpkh.address,
      value: targets[0].value - (psbt.toBuffer().byteLength * feeRate), // Deducting a small fee
      // script: p2wpkh.output,
    });

    // Sign the transaction
    // console.log("Sigining the transaction");
    // psbt.signAllInputs(keyPair);
    // console.log("Finalizing the transaction");
    psbt.finalizeInput(0, (inputIndex, input) => {
      return {
        hash: specialTxid.toString('hex'), // TXID (special format)
        index: 0, // Output index
        sequence,
        finalScriptSig: bitcoin.script.compile([
          bitcoin.script.number.encode(680000), // Example custom script
          bitcoin.opcodes.OP_0
        ])
      };
    });
    // psbt.finalizeAllInputs();
    // console.log("Extracting the transaction");
    const tx = psbt.extractTransaction();
    // console.log("Unstake tx: ", tx.toHex());
    return { tx, inputs, outputs, fee, psbt };
  }

  allowSend() {
    return true;
  }

  allowSendMax() {
    return true;
  }

  isSegwit() {
    return true;
  }

  allowSignVerifyMessage() {
    return true;
  }
}
