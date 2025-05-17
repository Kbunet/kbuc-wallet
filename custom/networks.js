'use strict';
// https://en.bitcoin.it/wiki/List_of_address_prefixes
// Dogecoin BIP32 is a proposed standard: https://bitcointalk.org/index.php?topic=409731
Object.defineProperty(exports, '__esModule', { value: true });
exports.testnet = exports.regtest = exports.bitcoin = void 0;
/**
 * Represents the Bitcoin network configuration.
 */
exports.bitcoin = {
  /**
   * The message prefix used for signing Bitcoin messages.
   */
  messagePrefix: '\x18Kbunet Signed Message:\n',
  /**
   * The Bech32 prefix used for Bitcoin addresses.
   */
  bech32: 'kc',
  /**
   * The BIP32 key prefixes for Bitcoin.
   */
  bip32: {
    /**
     * The public key prefix for BIP32 extended public keys.
     */
    public: 0x049D7CB2,
    /**
     * The private key prefix for BIP32 extended private keys.
     */
    private: 0x049D7878,
  },
  /**
   * The prefix for Bitcoin public key hashes.
   */
  pubKeyHash: 0x2D,
  /**
   * The prefix for Bitcoin script hashes.
   */
  scriptHash: 0x05,
  /**
   * The prefix for Bitcoin Wallet Import Format (WIF) private keys.
   */
  wif: 0x80,
};/**
* Represents the Bitcoin network configuration.
*/
exports.kbunet = {
 /**
  * The message prefix used for signing Bitcoin messages.
  */
 messagePrefix: '\x18Kbunet Signed Message:\n',
 /**
  * The Bech32 prefix used for Bitcoin addresses.
  */
 bech32: 'kc',
 /**
  * The BIP32 key prefixes for Bitcoin.
  */
 bip32: {
   /**
    * The public key prefix for BIP32 extended public keys.
    */
   public: 0x049D7CB2,
   /**
    * The private key prefix for BIP32 extended private keys.
    */
   private: 0x049D7878,
 },
 /**
  * The prefix for Bitcoin public key hashes.
  */
 pubKeyHash: 0x2D,
 /**
  * The prefix for Bitcoin script hashes.
  */
 scriptHash: 0x05,
 /**
  * The prefix for Bitcoin Wallet Import Format (WIF) private keys.
  */
 wif: 0x80,
};
/**
 * Represents the regtest network configuration.
 */
exports.regtest = {
  messagePrefix: '\x18Kbunet Signed Message:\n',
  bech32: 'kncrt',
  bip32: {
    public: 0x0f3587cf,
    private: 0x0f358394,
  },
  pubKeyHash: 0x6b,
  scriptHash: 0xc4,
  wif: 0xef,
};
/**
 * Represents the testnet network configuration.
 */
exports.testnet = {
  messagePrefix: '\x18Kbunet Signed Message:\n',
  bech32: 'tk',
  bip32: {
    public: 0x0f3587cf,
    private: 0x0f358394,
  },
  pubKeyHash: 0x6b,
  scriptHash: 0xc4,
  wif: 0xef,
};
