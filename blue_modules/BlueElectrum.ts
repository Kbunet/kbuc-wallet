import AsyncStorage from '@react-native-async-storage/async-storage';
import BigNumber from 'bignumber.js';
import * as bitcoin from 'bitcoinjs-lib';
import DefaultPreference from 'react-native-default-preference';
import RNFS from 'react-native-fs';
import Realm from 'realm';

import { LegacyWallet, SegwitBech32Wallet, SegwitP2SHWallet, TaprootWallet } from '../class';
import presentAlert from '../components/Alert';
import loc from '../loc';
import { GROUP_IO_BLUEWALLET } from './currency';
import CustomTransaction from '../custom/CustomTransaction';
import { toOutputScript } from '../custom/address';

const ElectrumClient = require('electrum-client');
const net = require('net');
const tls = require('tls');

type Utxo = {
  height: number;
  value: number;
  address: string;
  txid: string;
  vout: number;
  wif?: string;
};

type ElectrumTransaction = {
  txid: string;
  hash: string;
  version: number;
  size: number;
  vsize: number;
  weight: number;
  locktime: number;
  vin: {
    txid: string;
    vout: number;
    scriptSig: { asm: string; hex: string };
    txinwitness: string[];
    sequence: number;
    addresses?: string[];
    value?: number;
  }[];
  vout: {
    value: number;
    n: number;
    scriptPubKey: {
      asm: string;
      hex: string;
      reqSigs: number;
      type: string;
      addresses: string[];
    };
  }[];
  blockhash: string;
  confirmations: number;
  time: number;
  blocktime: number;
};

type ElectrumTransactionWithHex = ElectrumTransaction & {
  hex: string;
};

type MempoolTransaction = {
  height: 0;
  tx_hash: string;
  fee: number;
};

type Peer =
  | {
      host: string;
      ssl: string;
      tcp?: undefined;
    }
  | {
      host: string;
      tcp: string;
      ssl?: undefined;
    };

export const ELECTRUM_HOST = 'electrum_host';
export const ELECTRUM_TCP_PORT = 'electrum_tcp_port';
export const ELECTRUM_SSL_PORT = 'electrum_ssl_port';
export const ELECTRUM_SERVER_HISTORY = 'electrum_server_history';
const ELECTRUM_CONNECTION_DISABLED = 'electrum_disabled';
const storageKey = 'ELECTRUM_PEERS';
// const defaultPeer = { host: 'electrum1.bluewallet.io', ssl: '443' };
const defaultPeer = { host: '1.tcp.ap.ngrok.io', tcp: '21920' };
export const hardcodedPeers: Peer[] = [
  // { host: 'mainnet.foundationdevices.com', ssl: '50002' },
  // { host: 'bitcoin.lukechilds.co', ssl: '50002' },
  // { host: 'electrum.jochen-hoenicke.de', ssl: '50006' },
  // { host: 'electrum1.bluewallet.io', ssl: '443' },
  // { host: 'electrum.acinq.co', ssl: '50002' },
  // { host: 'electrum.bitaroo.net', ssl: '50002' },
];

let mainClient: typeof ElectrumClient | undefined;
let mainConnected: boolean = false;
let wasConnectedAtLeastOnce: boolean = false;
let serverName: string | false = false;
let disableBatching: boolean = false;
let connectionAttempt: number = 0;
let currentPeerIndex = Math.floor(Math.random() * hardcodedPeers.length);
let latestBlock: { height: number; time: number } | { height: undefined; time: undefined } = { height: undefined, time: undefined };
const txhashHeightCache: Record<string, number> = {};
let _realm: Realm | undefined;

async function _getRealm() {
  if (_realm) return _realm;

  const cacheFolderPath = RNFS.CachesDirectoryPath; // Path to cache folder
  const password = bitcoin.crypto.sha256(Buffer.from('fyegjitkyf[eqjnc.lf')).toString('hex');
  const buf = Buffer.from(password + password, 'hex');
  const encryptionKey = Int8Array.from(buf);
  const path = `${cacheFolderPath}/electrumcache.realm`; // Use cache folder path

  const schema = [
    {
      name: 'Cache',
      primaryKey: 'cache_key',
      properties: {
        cache_key: { type: 'string', indexed: true },
        cache_value: 'string', // stringified json
      },
    },
  ];

  // @ts-ignore schema doesn't match Realm's schema type
  _realm = await Realm.open({
    schema,
    path,
    encryptionKey,
  });

  return _realm;
}

export async function isDisabled(): Promise<boolean> {
  let result;
  try {
    const savedValue = await AsyncStorage.getItem(ELECTRUM_CONNECTION_DISABLED);
    if (savedValue === null) {
      result = false;
    } else {
      result = savedValue;
    }
  } catch {
    result = false;
  }
  return !!result;
}

export async function setDisabled(disabled = true) {
  return AsyncStorage.setItem(ELECTRUM_CONNECTION_DISABLED, disabled ? '1' : '');
}

function getCurrentPeer() {
  return hardcodedPeers[currentPeerIndex];
}

/**
 * Returns NEXT hardcoded electrum server (increments index after use)
 */
function getNextPeer() {
  const peer = getCurrentPeer();
  currentPeerIndex++;
  if (currentPeerIndex + 1 >= hardcodedPeers.length) currentPeerIndex = 0;
  return peer;
}

async function getSavedPeer(): Promise<Peer | null> {
  const host = await AsyncStorage.getItem(ELECTRUM_HOST);
  const tcpPort = await AsyncStorage.getItem(ELECTRUM_TCP_PORT);
  const sslPort = await AsyncStorage.getItem(ELECTRUM_SSL_PORT);

  if (!host) {
    return null;
  }

  if (sslPort) {
    return { host, ssl: sslPort };
  }

  if (tcpPort) {
    return { host, tcp: tcpPort };
  }

  return null;
}

export async function connectMain(): Promise<void> {
  if (await isDisabled()) {
    console.log('Electrum connection disabled by user. Skipping connectMain call');
    return;
  }
  let usingPeer = getNextPeer();
  const savedPeer = await getSavedPeer();
  if (savedPeer && savedPeer.host && (savedPeer.tcp || savedPeer.ssl)) {
    usingPeer = savedPeer;
  }

  await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
  try {
    if (usingPeer.host.endsWith('onion')) {
      const randomPeer = getCurrentPeer();
      await DefaultPreference.set(ELECTRUM_HOST, randomPeer.host);
      await DefaultPreference.set(ELECTRUM_TCP_PORT, randomPeer.tcp ?? '');
      await DefaultPreference.set(ELECTRUM_SSL_PORT, randomPeer.ssl ?? '');
    } else {
      await DefaultPreference.set(ELECTRUM_HOST, usingPeer.host);
      await DefaultPreference.set(ELECTRUM_TCP_PORT, usingPeer.tcp ?? '');
      await DefaultPreference.set(ELECTRUM_SSL_PORT, usingPeer.ssl ?? '');
    }
  } catch (e) {
    // Must be running on Android
    console.log(e);
  }

  try {
    console.log('begin connection:', JSON.stringify(usingPeer));
    mainClient = new ElectrumClient(net, tls, usingPeer.ssl || usingPeer.tcp, usingPeer.host, usingPeer.ssl ? 'tls' : 'tcp');

    mainClient.onError = function (e: { message: string }) {
      console.log('electrum mainClient.onError():', e.message);
      if (mainConnected) {
        // most likely got a timeout from electrum ping. lets reconnect
        // but only if we were previously connected (mainConnected), otherwise theres other
        // code which does connection retries
        mainClient.close();
        mainConnected = false;
        // dropping `mainConnected` flag ensures there wont be reconnection race condition if several
        // errors triggered
        console.log('reconnecting after socket error');
        setTimeout(connectMain, usingPeer.host.endsWith('.onion') ? 4000 : 500);
      }
    };
    const ver = await mainClient.initElectrum({ client: 'bluewallet', version: '1.4' });
    if (ver && ver[0]) {
      console.log('connected to ', ver);
      serverName = ver[0];
      mainConnected = true;
      wasConnectedAtLeastOnce = true;
      if (ver[0].startsWith('ElectrumPersonalServer') || ver[0].startsWith('electrs') || ver[0].startsWith('Fulcrum')) {
        disableBatching = true;

        // exeptions for versions:
        const [electrumImplementation, electrumVersion] = ver[0].split(' ');
        switch (electrumImplementation) {
          case 'electrs':
            if (semVerToInt(electrumVersion) >= semVerToInt('0.9.0')) {
              disableBatching = false;
            }
            break;
          case 'electrs-esplora':
            // its a different one, and it does NOT support batching
            // nop
            break;
          case 'Fulcrum':
            if (semVerToInt(electrumVersion) >= semVerToInt('1.9.0')) {
              disableBatching = false;
            }
            break;
        }
      }
      const header = await mainClient.blockchainHeaders_subscribe();
      if (header && header.height) {
        latestBlock = {
          height: header.height,
          time: Math.floor(+new Date() / 1000),
        };
      }
      // AsyncStorage.setItem(storageKey, JSON.stringify(peers));  TODO: refactor
    }
  } catch (e) {
    mainConnected = false;
    console.log('bad connection:', JSON.stringify(usingPeer), e);
  }

  if (!mainConnected) {
    console.log('retry');
    connectionAttempt = connectionAttempt + 1;
    mainClient.close && mainClient.close();
    if (connectionAttempt >= 5) {
      presentNetworkErrorAlert(usingPeer);
    } else {
      console.log('reconnection attempt #', connectionAttempt);
      await new Promise(resolve => setTimeout(resolve, 500)); // sleep
      return connectMain();
    }
  }
}

const presentNetworkErrorAlert = async (usingPeer?: Peer) => {
  if (await isDisabled()) {
    console.log(
      'Electrum connection disabled by user. Perhaps we are attempting to show this network error alert after the user disabled connections.',
    );
    return;
  }
  presentAlert({
    allowRepeat: false,
    title: loc.errors.network,
    message: loc.formatString(
      usingPeer ? loc.settings.electrum_unable_to_connect : loc.settings.electrum_error_connect,
      usingPeer ? { server: `${usingPeer.host}:${usingPeer.ssl ?? usingPeer.tcp}` } : {},
    ),
    buttons: [
      {
        text: loc.wallets.list_tryagain,
        onPress: () => {
          connectionAttempt = 0;
          mainClient.close() && mainClient.close();
          setTimeout(connectMain, 500);
        },
        style: 'default',
      },
      {
        text: loc.settings.electrum_reset,
        onPress: () => {
          presentAlert({
            title: loc.settings.electrum_reset,
            message: loc.settings.electrum_reset_to_default,
            buttons: [
              {
                text: loc._.cancel,
                style: 'cancel',
                onPress: () => {},
              },
              {
                text: loc._.ok,
                style: 'destructive',
                onPress: async () => {
                  await AsyncStorage.setItem(ELECTRUM_HOST, '');
                  await AsyncStorage.setItem(ELECTRUM_TCP_PORT, '');
                  await AsyncStorage.setItem(ELECTRUM_SSL_PORT, '');
                  try {
                    await DefaultPreference.setName('group.io.bluewallet.bluewallet');
                    await DefaultPreference.clear(ELECTRUM_HOST);
                    await DefaultPreference.clear(ELECTRUM_SSL_PORT);
                    await DefaultPreference.clear(ELECTRUM_TCP_PORT);
                  } catch (e) {
                    console.log(e); // Must be running on Android
                  }
                  presentAlert({ message: loc.settings.electrum_saved });
                  setTimeout(connectMain, 500);
                },
              },
            ],
            options: { cancelable: true },
          });
          connectionAttempt = 0;
          mainClient.close() && mainClient.close();
        },
        style: 'destructive',
      },
      {
        text: loc._.cancel,
        onPress: () => {
          connectionAttempt = 0;
          mainClient.close() && mainClient.close();
        },
        style: 'cancel',
      },
    ],
    options: { cancelable: false },
  });
};

/**
 * Returns random electrum server out of list of servers
 * previous electrum server told us. Nearly half of them is
 * usually offline.
 * Not used for now.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getRandomDynamicPeer(): Promise<Peer> {
  try {
    let peers = JSON.parse((await AsyncStorage.getItem(storageKey)) as string);
    peers = peers.sort(() => Math.random() - 0.5); // shuffle
    for (const peer of peers) {
      const ret = {
        host: peer[1] as string,
        tcp: '',
      };
      for (const item of peer[2]) {
        if (item.startsWith('t')) {
          ret.tcp = item.replace('t', '');
        }
      }
      if (ret.host && ret.tcp) return ret;
    }

    return defaultPeer; // failed to find random client, using default
  } catch (_) {
    return defaultPeer; // smth went wrong, using default
  }
}

export const getBalanceByAddress = async function (address: string): Promise<{ confirmed: number; unconfirmed: number }> {
  if (!mainClient) throw new Error('Electrum client is not connected');
  const script = toOutputScript(address);
  const hash = bitcoin.crypto.sha256(script);
  const reversedHash = Buffer.from(hash).reverse();
  const balance = await mainClient.blockchainScripthash_getBalance(reversedHash.toString('hex'));
  balance.addr = address;
  return balance;
};

export const getConfig = async function () {
  if (!mainClient) throw new Error('Electrum client is not connected');
  return {
    host: mainClient.host,
    port: mainClient.port,
    serverName,
    connected: mainClient.timeLastCall !== 0 && mainClient.status,
  };
};

export const getSecondsSinceLastRequest = function () {
  return mainClient && mainClient.timeLastCall ? (+new Date() - mainClient.timeLastCall) / 1000 : -1;
};

export const getTransactionsByAddress = async function (address: string): Promise<ElectrumHistory[]> {
  if (!mainClient) throw new Error('Electrum client is not connected');
  const script = toOutputScript(address);
  const hash = bitcoin.crypto.sha256(script);
  const reversedHash = Buffer.from(hash).reverse();
  const history = await mainClient.blockchainScripthash_getHistory(reversedHash.toString('hex'));
  for (const h of history || []) {
    if (h.tx_hash) txhashHeightCache[h.tx_hash] = h.height; // cache tx height
  }

  return history;
};

export const getMempoolTransactionsByAddress = async function (address: string): Promise<MempoolTransaction[]> {
  if (!mainClient) throw new Error('Electrum client is not connected');
  const script = toOutputScript(address);
  const hash = bitcoin.crypto.sha256(script);
  const reversedHash = Buffer.from(hash).reverse();
  return mainClient.blockchainScripthash_getMempool(reversedHash.toString('hex'));
};

export const ping = async function () {
  try {
    await mainClient.server_ping();
  } catch (_) {
    mainConnected = false;
    return false;
  }
  return true;
};

// exported only to be used in unit tests
export function txhexToElectrumTransaction(txhex: string): ElectrumTransactionWithHex {
  const tx = CustomTransaction.fromHex(txhex);

  console.log("txhexToElectrumTransaction:", tx);

  const ret: ElectrumTransactionWithHex = {
    txid: tx.getId(),
    hash: tx.getId(),
    version: tx.version,
    size: Math.ceil(txhex.length / 2),
    vsize: tx.virtualSize(),
    weight: tx.weight(),
    locktime: tx.locktime,
    vin: [],
    vout: [],
    hex: txhex,
    blockhash: '',
    confirmations: 0,
    time: 0,
    blocktime: 0,
  };

  if (txhashHeightCache[ret.txid]) {
    // got blockheight where this tx was confirmed
    ret.confirmations = estimateCurrentBlockheight() - txhashHeightCache[ret.txid];
    if (ret.confirmations < 0) {
      // ugly fix for when estimator lags behind
      ret.confirmations = 1;
    }
    ret.time = calculateBlockTime(txhashHeightCache[ret.txid]);
    ret.blocktime = calculateBlockTime(txhashHeightCache[ret.txid]);
  }

  for (const inn of tx.ins) {
    const txinwitness = [];
    if (inn.witness[0]) txinwitness.push(inn.witness[0].toString('hex'));
    if (inn.witness[1]) txinwitness.push(inn.witness[1].toString('hex'));

    ret.vin.push({
      txid: Buffer.from(inn.hash).reverse().toString('hex'),
      vout: inn.index,
      scriptSig: { hex: inn.script.toString('hex'), asm: '' },
      txinwitness,
      sequence: inn.sequence,
    });
  }

  let n = 0;
  for (const out of tx.outs) {
    const value = new BigNumber(out.value).dividedBy(100000000).toNumber();
    let address: false | string = false;
    let type: false | string = false;

    if (SegwitBech32Wallet.scriptPubKeyToAddress(out.script.toString('hex'))) {
      address = SegwitBech32Wallet.scriptPubKeyToAddress(out.script.toString('hex'));
      type = 'witness_v0_keyhash';
    } else if (SegwitP2SHWallet.scriptPubKeyToAddress(out.script.toString('hex'))) {
      address = SegwitP2SHWallet.scriptPubKeyToAddress(out.script.toString('hex'));
      type = '???'; // TODO
    } else if (LegacyWallet.scriptPubKeyToAddress(out.script.toString('hex'))) {
      address = LegacyWallet.scriptPubKeyToAddress(out.script.toString('hex'));
      type = '???'; // TODO
    } else {
      address = TaprootWallet.scriptPubKeyToAddress(out.script.toString('hex'));
      type = 'witness_v1_taproot';
    }

    if (!address) {
      throw new Error('Internal error: unable to decode address from output script');
    }

    ret.vout.push({
      value,
      n,
      scriptPubKey: {
        asm: '',
        hex: out.script.toString('hex'),
        reqSigs: 1, // todo
        type,
        addresses: [address],
      },
    });
    n++;
  }
  return ret;
}

export const getTransactionsFullByAddress = async (address: string): Promise<ElectrumTransaction[]> => {
  const txs = await getTransactionsByAddress(address);
  const ret: ElectrumTransaction[] = [];
  for (const tx of txs) {
    let full;
    try {
      full = await mainClient.blockchainTransaction_get(tx.tx_hash, true);
    } catch (error: any) {
      if (String(error?.message ?? error).startsWith('verbose transactions are currently unsupported')) {
        // apparently, stupid esplora instead of returning txhex when it cant return verbose tx started
        // throwing a proper exception. lets fetch txhex manually and decode on our end
        const txhex = await mainClient.blockchainTransaction_get(tx.tx_hash, false);
        full = txhexToElectrumTransaction(txhex);
      } else {
        // nope, its something else
        throw new Error(String(error?.message ?? error));
      }
    }
    full.address = address;
    for (const input of full.vin) {
      // now we need to fetch previous TX where this VIN became an output, so we can see its amount
      let prevTxForVin;
      try {
        prevTxForVin = await mainClient.blockchainTransaction_get(input.txid, true);
      } catch (error: any) {
        if (String(error?.message ?? error).startsWith('verbose transactions are currently unsupported')) {
          // apparently, stupid esplora instead of returning txhex when it cant return verbose tx started
          // throwing a proper exception. lets fetch txhex manually and decode on our end
          const txhex = await mainClient.blockchainTransaction_get(input.txid, false);
          prevTxForVin = txhexToElectrumTransaction(txhex);
        } else {
          // nope, its something else
          throw new Error(String(error?.message ?? error));
        }
      }
      if (prevTxForVin && prevTxForVin.vout && prevTxForVin.vout[input.vout]) {
        input.value = prevTxForVin.vout[input.vout].value;
        // also, we extract destination address from prev output:
        if (prevTxForVin.vout[input.vout].scriptPubKey && prevTxForVin.vout[input.vout].scriptPubKey.addresses) {
          input.addresses = prevTxForVin.vout[input.vout].scriptPubKey.addresses;
        }
        // in bitcoin core 22.0.0+ they removed `.addresses` and replaced it with plain `.address`:
        if (prevTxForVin.vout[input.vout]?.scriptPubKey?.address) {
          input.addresses = [prevTxForVin.vout[input.vout].scriptPubKey.address];
        }
      }
    }

    for (const output of full.vout) {
      if (output?.scriptPubKey && output.scriptPubKey.addresses) output.addresses = output.scriptPubKey.addresses;
      // in bitcoin core 22.0.0+ they removed `.addresses` and replaced it with plain `.address`:
      if (output?.scriptPubKey?.address) output.addresses = [output.scriptPubKey.address];
    }
    full.inputs = full.vin;
    full.outputs = full.vout;
    delete full.vin;
    delete full.vout;
    delete full.hex; // compact
    delete full.hash; // compact
    ret.push(full);
  }

  return ret;
};

type MultiGetBalanceResponse = {
  balance: number;
  unconfirmed_balance: number;
  addresses: Record<string, { confirmed: number; unconfirmed: number }>;
};

export const multiGetBalanceByAddress = async (addresses: string[], batchsize: number = 200): Promise<MultiGetBalanceResponse> => {
  if (!mainClient) throw new Error('Electrum client is not connected');
  const ret = {
    balance: 0,
    unconfirmed_balance: 0,
    addresses: {} as Record<string, { confirmed: number; unconfirmed: number }>,
  };

  const chunks = splitIntoChunks(addresses, batchsize);
  for (const chunk of chunks) {
    const scripthashes = [];
    const scripthash2addr: Record<string, string> = {};
    for (const addr of chunk) {
      const script = toOutputScript(addr);
      const hash = bitcoin.crypto.sha256(script);
      const reversedHash = Buffer.from(hash).reverse().toString('hex');
      scripthashes.push(reversedHash);
      scripthash2addr[reversedHash] = addr;
    }

    let balances = [];

    if (disableBatching) {
      const promises = [];
      const index2scripthash: Record<number, string> = {};
      for (let promiseIndex = 0; promiseIndex < scripthashes.length; promiseIndex++) {
        promises.push(mainClient.blockchainScripthash_getBalance(scripthashes[promiseIndex]));
        index2scripthash[promiseIndex] = scripthashes[promiseIndex];
      }
      const promiseResults = await Promise.all(promises);
      for (let resultIndex = 0; resultIndex < promiseResults.length; resultIndex++) {
        balances.push({ result: promiseResults[resultIndex], param: index2scripthash[resultIndex] });
      }
    } else {
      balances = await mainClient.blockchainScripthash_getBalanceBatch(scripthashes);
    }

    for (const bal of balances) {
      if (bal.error) console.warn('multiGetBalanceByAddress():', bal.error);
      ret.balance += +bal.result.confirmed;
      ret.unconfirmed_balance += +bal.result.unconfirmed;
      ret.addresses[scripthash2addr[bal.param]] = bal.result;
    }
  }

  return ret;
};

export const multiGetUtxoByAddress = async function (addresses: string[], batchsize: number = 100): Promise<Record<string, Utxo[]>> {
  if (!mainClient) throw new Error('Electrum client is not connected');
  const ret: Record<string, any> = {};

  const chunks = splitIntoChunks(addresses, batchsize);
  for (const chunk of chunks) {
    const scripthashes = [];
    const scripthash2addr: Record<string, string> = {};
    for (const addr of chunk) {
      const script = toOutputScript(addr);
      const hash = bitcoin.crypto.sha256(script);
      const reversedHash = Buffer.from(hash).reverse().toString('hex');
      scripthashes.push(reversedHash);
      scripthash2addr[reversedHash] = addr;
    }

    let results = [];

    if (disableBatching) {
      // ElectrumPersonalServer doesnt support `blockchain.scripthash.listunspent`
      // electrs OTOH supports it, but we dont know it we are currently connected to it or to EPS
      // so it is pretty safe to do nothing, as caller can derive UTXO from stored transactions
    } else {
      results = await mainClient.blockchainScripthash_listunspentBatch(scripthashes);
    }

    for (const utxos of results) {
      ret[scripthash2addr[utxos.param]] = utxos.result;
      for (const utxo of ret[scripthash2addr[utxos.param]]) {
        utxo.address = scripthash2addr[utxos.param];
        utxo.txid = utxo.tx_hash;
        utxo.vout = utxo.tx_pos;
        delete utxo.tx_pos;
        delete utxo.tx_hash;
      }
    }
  }

  return ret;
};

export type ElectrumHistory = {
  tx_hash: string;
  height: number;
  address: string;
};

export const multiGetHistoryByAddress = async function (
  addresses: string[],
  batchsize: number = 100,
): Promise<Record<string, ElectrumHistory[]>> {
  if (!mainClient) throw new Error('Electrum client is not connected');
  const ret: Record<string, ElectrumHistory[]> = {};

  const chunks = splitIntoChunks(addresses, batchsize);
  for (const chunk of chunks) {
    const scripthashes = [];
    const scripthash2addr: Record<string, string> = {};
    for (const addr of chunk) {
      const script = toOutputScript(addr);
      const hash = bitcoin.crypto.sha256(script);
      const reversedHash = Buffer.from(hash).reverse().toString('hex');
      scripthashes.push(reversedHash);
      scripthash2addr[reversedHash] = addr;
    }

    let results = [];

    if (disableBatching) {
      const promises = [];
      const index2scripthash: Record<number, string> = {};
      for (let promiseIndex = 0; promiseIndex < scripthashes.length; promiseIndex++) {
        index2scripthash[promiseIndex] = scripthashes[promiseIndex];
        promises.push(mainClient.blockchainScripthash_getHistory(scripthashes[promiseIndex]));
      }
      const histories = await Promise.all(promises);
      for (let historyIndex = 0; historyIndex < histories.length; historyIndex++) {
        results.push({ result: histories[historyIndex], param: index2scripthash[historyIndex] });
      }
    } else {
      results = await mainClient.blockchainScripthash_getHistoryBatch(scripthashes);
    }

    for (const history of results) {
      if (history.error) console.warn('multiGetHistoryByAddress():', history.error);
      ret[scripthash2addr[history.param]] = history.result || [];
      for (const result of history.result || []) {
        if (result.tx_hash) txhashHeightCache[result.tx_hash] = result.height; // cache tx height
      }

      for (const hist of ret[scripthash2addr[history.param]]) {
        hist.address = scripthash2addr[history.param];
      }
    }
  }
  // console.log("ret:", ret);
  return ret;
};

// if verbose === true ? Record<string, ElectrumTransaction> : Record<string, string>
type MultiGetTransactionByTxidResult<T extends boolean> = T extends true ? Record<string, ElectrumTransaction> : Record<string, string>;

// TODO: this function returns different results based on the value of `verboseParam`, consider splitting it into two
export async function multiGetTransactionByTxid<T extends boolean>(
  txids: string[],
  verbose: T,
  batchsize: number = 45,
): Promise<MultiGetTransactionByTxidResult<T>> {
  txids = txids.filter(txid => !!txid); // failsafe: removing 'undefined' or other falsy stuff from txids array
  // this value is fine-tuned so althrough wallets in test suite will occasionally
  // throw 'response too large (over 1,000,000 bytes', test suite will pass
  if (!mainClient) throw new Error('Electrum client is not connected');
  const ret: MultiGetTransactionByTxidResult<T> = {};
  txids = [...new Set(txids)]; // deduplicate just for any case

  // lets try cache first:
  const realm = await _getRealm();
  const cacheKeySuffix = verbose ? '_verbose' : '_non_verbose';
  const keysCacheMiss = [];
  for (const txid of txids) {
    const jsonString = realm.objectForPrimaryKey('Cache', txid + cacheKeySuffix); // search for a realm object with a primary key
    if (jsonString && jsonString.cache_value) {
      try {
        ret[txid] = JSON.parse(jsonString.cache_value as string);
      } catch (error) {
        console.log(error, 'cache failed to parse', jsonString.cache_value);
      }
    }

    if (!ret[txid]) keysCacheMiss.push(txid);
  }

  if (keysCacheMiss.length === 0) {
    return ret;
  }

  txids = keysCacheMiss;
  // end cache

  const chunks = splitIntoChunks(txids, batchsize);
  for (const chunk of chunks) {
    let results = [];

    if (disableBatching) {
      try {
        // in case of ElectrumPersonalServer it might not track some transactions (like source transactions for our transactions)
        // so we wrap it in try-catch. note, when `Promise.all` fails we will get _zero_ results, but we have a fallback for that
        const promises = [];
        const index2txid: Record<number, string> = {};
        for (let promiseIndex = 0; promiseIndex < chunk.length; promiseIndex++) {
          const txid = chunk[promiseIndex];
          index2txid[promiseIndex] = txid;
          promises.push(mainClient.blockchainTransaction_get(txid, verbose));
        }

        const transactionResults = await Promise.all(promises);
        for (let resultIndex = 0; resultIndex < transactionResults.length; resultIndex++) {
          let tx = transactionResults[resultIndex];
          console.log("transactionResults:", tx);
          if (typeof tx === 'string' && verbose) {
            // apparently electrum server (EPS?) didnt recognize VERBOSE parameter, and  sent us plain txhex instead of decoded tx.
            // lets decode it manually on our end then:
            tx = txhexToElectrumTransaction(tx);
          }
          const txid = index2txid[resultIndex];
          results.push({ result: tx, param: txid });
        }
      } catch (error: any) {
        if (String(error?.message ?? error).startsWith('verbose transactions are currently unsupported')) {
          // electrs-esplora. cant use verbose, so fetching txs one by one and decoding locally
          for (const txid of chunk) {
            try {
              let tx = await mainClient.blockchainTransaction_get(txid, false);
              tx = txhexToElectrumTransaction(tx);
              results.push({ result: tx, param: txid });
            } catch (err) {
              console.log(err);
            }
          }
        } else {
          // fallback. pretty sure we are connected to EPS.  we try getting transactions one-by-one. this way we wont
          // fail and only non-tracked by EPS transactions will be omitted
          for (const txid of chunk) {
            try {
              let tx = await mainClient.blockchainTransaction_get(txid, verbose);
              if (typeof tx === 'string' && verbose) {
                // apparently electrum server (EPS?) didnt recognize VERBOSE parameter, and  sent us plain txhex instead of decoded tx.
                // lets decode it manually on our end then:
                tx = txhexToElectrumTransaction(tx);
              }
              results.push({ result: tx, param: txid });
            } catch (err) {
              console.log(err);
            }
          }
        }
      }
    } else {
      results = await mainClient.blockchainTransaction_getBatch(chunk, verbose);
    }

    for (const txdata of results) {
      if (txdata.error && txdata.error.code === -32600) {
        // response too large
        // lets do single call, that should go through okay:
        txdata.result = await mainClient.blockchainTransaction_get(txdata.param, false);
        // since we used VERBOSE=false, server sent us plain txhex which we must decode on our end:
        txdata.result = txhexToElectrumTransaction(txdata.result);
      }
      ret[txdata.param] = txdata.result;
      // @ts-ignore: hex property
      if (ret[txdata.param]) delete ret[txdata.param].hex; // compact
    }
  }

  // in bitcoin core 22.0.0+ they removed `.addresses` and replaced it with plain `.address`:
  for (const txid of Object.keys(ret)) {
    const tx = ret[txid];
    if (typeof tx === 'string') continue;
    for (const vout of tx?.vout ?? []) {
      // @ts-ignore: address is not in type definition
      if (vout?.scriptPubKey?.address) vout.scriptPubKey.addresses = [vout.scriptPubKey.address];
    }
  }

  // saving cache:
  realm.write(() => {
    for (const txid of Object.keys(ret)) {
      const tx = ret[txid];
      // dont cache immature txs, but only for 'verbose', since its fully decoded tx jsons. non-verbose are just plain
      // strings txhex
      if (verbose && typeof tx !== 'string' && (!tx?.confirmations || tx.confirmations < 7)) {
        continue;
      }

      realm.create(
        'Cache',
        {
          cache_key: txid + cacheKeySuffix,
          cache_value: JSON.stringify(ret[txid]),
        },
        Realm.UpdateMode.Modified,
      );
    }
  });

  return ret;
}

/**
 * Simple waiter till `mainConnected` becomes true (which means
 * it Electrum was connected in other function), or timeout 30 sec.
 */
export const waitTillConnected = async function (): Promise<boolean> {
  let waitTillConnectedInterval: NodeJS.Timeout | undefined;
  let retriesCounter = 0;
  if (await isDisabled()) {
    console.warn('Electrum connections disabled by user. waitTillConnected skipping...');
    return false;
  }
  return new Promise(function (resolve, reject) {
    waitTillConnectedInterval = setInterval(() => {
      if (mainConnected) {
        clearInterval(waitTillConnectedInterval);
        return resolve(true);
      }

      if (wasConnectedAtLeastOnce && mainClient.status === 1) {
        clearInterval(waitTillConnectedInterval);
        mainConnected = true;
        return resolve(true);
      }

      if (wasConnectedAtLeastOnce && retriesCounter++ >= 150) {
        // `wasConnectedAtLeastOnce` needed otherwise theres gona be a race condition with the code that connects
        // electrum during app startup
        clearInterval(waitTillConnectedInterval);
        presentNetworkErrorAlert();
        reject(new Error('Waiting for Electrum connection timeout'));
      }
    }, 100);
  });
};

// Returns the value at a given percentile in a sorted numeric array.
// "Linear interpolation between closest ranks" method
function percentile(arr: number[], p: number) {
  if (arr.length === 0) return 0;
  if (typeof p !== 'number') throw new TypeError('p must be a number');
  if (p <= 0) return arr[0];
  if (p >= 1) return arr[arr.length - 1];

  const index = (arr.length - 1) * p;
  const lower = Math.floor(index);
  const upper = lower + 1;
  const weight = index % 1;

  if (upper >= arr.length) return arr[lower];
  return arr[lower] * (1 - weight) + arr[upper] * weight;
}

/**
 * The histogram is an array of [fee, vsize] pairs, where vsizen is the cumulative virtual size of mempool transactions
 * with a fee rate in the interval [feen-1, feen], and feen-1 > feen.
 */
export const calcEstimateFeeFromFeeHistorgam = function (numberOfBlocks: number, feeHistorgram: number[][]) {
  // first, transforming histogram:
  let totalVsize = 0;
  const histogramToUse = [];
  for (const h of feeHistorgram) {
    let [fee, vsize] = h;
    let timeToStop = false;

    if (totalVsize + vsize >= 1000000 * numberOfBlocks) {
      vsize = 1000000 * numberOfBlocks - totalVsize; // only the difference between current summarized sige to tip of the block
      timeToStop = true;
    }

    histogramToUse.push({ fee, vsize });
    totalVsize += vsize;
    if (timeToStop) break;
  }

  // now we have histogram of precisely size for numberOfBlocks.
  // lets spread it into flat array so its easier to calculate percentile:
  let histogramFlat: number[] = [];
  for (const hh of histogramToUse) {
    histogramFlat = histogramFlat.concat(Array(Math.round(hh.vsize / 25000)).fill(hh.fee));
    // division is needed so resulting flat array is not too huge
  }

  histogramFlat = histogramFlat.sort(function (a, b) {
    return a - b;
  });

  return Math.round(percentile(histogramFlat, 0.5) || 1);
};

export const estimateFees = async function (): Promise<{ fast: number; medium: number; slow: number }> {
  let histogram;
  let timeoutId;
  try {
    histogram = await Promise.race([
      mainClient.mempool_getFeeHistogram(),
      new Promise(resolve => (timeoutId = setTimeout(resolve, 15000))),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }

  // fetching what electrum (which uses bitcoin core) thinks about fees:
  const _fast = await estimateFee(1);
  const _medium = await estimateFee(18);
  const _slow = await estimateFee(144);

  /**
   * sanity check, see
   * @see https://github.com/cculianu/Fulcrum/issues/197
   * (fallback to bitcoin core estimates)
   */
  if (!histogram || histogram?.[0]?.[0] > 1000) return { fast: _fast, medium: _medium, slow: _slow };

  // calculating fast fees from mempool:
  const fast = Math.max(2, calcEstimateFeeFromFeeHistorgam(1, histogram));
  // recalculating medium and slow fees using bitcoincore estimations only like relative weights:
  // (minimum 1 sat, just for any case)
  const medium = Math.max(1, Math.round((fast * _medium) / _fast));
  const slow = Math.max(1, Math.round((fast * _slow) / _fast));
  return { fast, medium, slow };
};

/**
 * Returns the estimated transaction fee to be confirmed within a certain number of blocks
 *
 * @param numberOfBlocks {number} The number of blocks to target for confirmation
 * @returns {Promise<number>} Satoshis per byte
 */
export const estimateFee = async function (numberOfBlocks: number): Promise<number> {
  if (!mainClient) throw new Error('Electrum client is not connected');
  numberOfBlocks = numberOfBlocks || 1;
  const coinUnitsPerKilobyte = await mainClient.blockchainEstimatefee(numberOfBlocks);
  if (coinUnitsPerKilobyte === -1) return 1;
  return Math.round(new BigNumber(coinUnitsPerKilobyte).dividedBy(1024).multipliedBy(100000000).toNumber());
};

export const serverFeatures = async function () {
  if (!mainClient) throw new Error('Electrum client is not connected');
  return mainClient.server_features();
};

export const broadcast = async function (hex: string) {
  if (!mainClient) throw new Error('Electrum client is not connected');
  try {
    const res = await mainClient.blockchainTransaction_broadcast(hex);
    return res;
  } catch (error) {
    return error;
  }
};

export const broadcastV2 = async function (hex: string): Promise<string> {
  if (!mainClient) throw new Error('Electrum client is not connected');
  return mainClient.blockchainTransaction_broadcast(hex);
};

export const estimateCurrentBlockheight = function (): number {
  if (latestBlock.height) {
    const timeDiff = Math.floor(+new Date() / 1000) - latestBlock.time;
    const extraBlocks = Math.floor(timeDiff / (9.93 * 60));
    return latestBlock.height + extraBlocks;
  }

  const baseTs = 1587570465609; // uS
  const baseHeight = 627179;
  return Math.floor(baseHeight + (+new Date() - baseTs) / 1000 / 60 / 9.93);
};

export const calculateBlockTime = function (height: number): number {
  if (latestBlock.height) {
    return Math.floor(latestBlock.time + (height - latestBlock.height) * 9.93 * 60);
  }

  const baseTs = 1585837504; // sec
  const baseHeight = 624083;
  return Math.floor(baseTs + (height - baseHeight) * 9.93 * 60);
};

/**
 * @returns {Promise<boolean>} Whether provided host:port is a valid electrum server
 */
export const testConnection = async function (host: string, tcpPort?: number, sslPort?: number): Promise<boolean> {
  const client = new ElectrumClient(net, tls, sslPort || tcpPort, host, sslPort ? 'tls' : 'tcp');

  client.onError = () => {}; // mute
  let timeoutId: NodeJS.Timeout | undefined;
  try {
    const rez = await Promise.race([
      new Promise(resolve => {
        timeoutId = setTimeout(() => resolve('timeout'), 5000);
      }),
      client.connect(),
    ]);
    if (rez === 'timeout') return false;

    await client.server_version('2.7.11', '1.4');
    await client.server_ping();
    return true;
  } catch (_) {
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    client.close();
  }

  return false;
};

export const forceDisconnect = (): void => {
  mainClient.close();
};

export const setBatchingDisabled = () => {
  disableBatching = true;
};

export const setBatchingEnabled = () => {
  disableBatching = false;
};

const splitIntoChunks = function (arr: any[], chunkSize: number) {
  const groups = [];
  let i;
  for (i = 0; i < arr.length; i += chunkSize) {
    groups.push(arr.slice(i, i + chunkSize));
  }
  return groups;
};

const semVerToInt = function (semver: string): number {
  if (!semver) return 0;
  if (semver.split('.').length !== 3) return 0;

  const ret = Number(semver.split('.')[0]) * 1000000 + Number(semver.split('.')[1]) * 1000 + Number(semver.split('.')[2]) * 1;

  if (isNaN(ret)) return 0;

  return ret;
};

/**
 * Verify a profile
 * @param profileID
 */
export const verifyProfile = async function (profileID: string): Promise<any> {
  let profile;
  let timeoutId;
  
  // Default profile structure with all required fields
  const defaultProfile = {
    creator: '',
    owner: '',
    signer: '',
    name: '',
    link: '',
    appData: '',
    rps: 0,
    generatedRPs: 0,
    ownedProfilesCount: 0,
    isRented: false,
    tenant: '',
    rentedAt: 0,
    duration: 0,
    isCandidate: false,
    isBanned: false,
    contribution: 0,
    isDomain: false,
    offeredAt: 0,
    bidAmount: 0,
    buyer: '',
    balance: 0,
    bidTarget: '',
    ownedProfiles: []
  };
  
  if (!mainClient) throw new Error('Electrum client is not connected');
  try {
    // First, get the raw profile data
    const rawProfile = await Promise.race([
      mainClient.blockchainScripthash_getProfile(profileID),
      new Promise(resolve => (timeoutId = setTimeout(() => resolve(null), 15000))),
    ]);
    
    // If no profile was found, return the default profile
    if (!rawProfile) {
      console.log('No profile found');
      return defaultProfile;
    }
    
    // Extract properties manually to avoid circular references
    try {
      // Create a new object with only the properties we need
      profile = { ...defaultProfile };
      console.log('Profile:', JSON.stringify(profile, null, 2));
      
      // Safely extract all primitive properties
      const extractProps = (source: any, target: any) => {
        if (!source || typeof source !== 'object') return;
        
        // List of properties to extract
        const props = [
          'creator', 'owner', 'signer', 'name', 'link', 'appData', 'rps', 
          'generatedRPs', 'isRented', 'tenant', 'rentedAt', 'duration', 
          'isCandidate', 'isBanned', 'contribution', 'isDomain', 'offeredAt', 
          'bidAmount', 'buyer', 'balance', 'bidTarget'
        ] as const;
        
        // Extract each property safely
        props.forEach(prop => {
          if (source[prop] !== undefined) {
            // Use type assertion to avoid TypeScript errors
            const key = prop as keyof typeof defaultProfile;
            
            // For string properties, ensure they're strings
            if (typeof defaultProfile[key] === 'string') {
              target[key] = String(source[prop] || '');
            }
            // For number properties, ensure they're numbers
            else if (typeof defaultProfile[key] === 'number') {
              target[key] = Number(source[prop] || 0);
            }
            // For boolean properties, ensure they're booleans
            else if (typeof defaultProfile[key] === 'boolean') {
              target[key] = Boolean(source[prop]);
            }
          }
        });
        
        // Handle ownedProfiles array specially
        if (Array.isArray(source.ownedProfiles)) {
          // Just count the profiles, don't include the actual objects
          target.ownedProfilesCount = source.ownedProfiles.length;
          target.ownedProfiles = source.ownedProfiles;
        }
      };
      
      // Extract properties from the raw profile
      extractProps(rawProfile, profile);
      
      console.log('Safely extracted profile:', profile);
    } catch (extractError) {
      console.error('Error extracting profile properties:', extractError);
      return defaultProfile;
    }
  } catch (error) {
    console.error('Error verifying profile:', error);
    return defaultProfile;
  } finally {
    clearTimeout(timeoutId);
  }

  return profile;
};
