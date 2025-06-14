import { Psbt } from 'bitcoinjs-lib';
import { CreateTransactionTarget, CreateTransactionUtxo, TWallet } from '../class/wallets/types';
import { BitcoinUnit, Chain } from '../models/bitcoinUnits';

export type SendDetailsParams = {
  transactionMemo?: string;
  isTransactionReplaceable?: boolean;
  payjoinUrl?: string;
  feeUnit?: BitcoinUnit;
  frozenBalance?: number;
  amountUnit?: BitcoinUnit;
  address?: string;
  amount?: number;
  amountSats?: number;
  unit?: BitcoinUnit;
  noRbf?: boolean;
  walletID: string;
  launchedBy?: string;
  utxos?: CreateTransactionUtxo[] | null;
  isEditable?: boolean;
  uri?: string;
  addRecipientParams?: {
    address: string;
    amount?: number;
    memo?: string;
  };
  txType: string;
  supportRewardAddress: string;
  supportRewardAmount: number;
  // Profile parameters
  profile?: string;
  period?: string;
  // Metadata parameters
  metaName?: string;
  metaLink?: string;
  metaAppData?: string;
};

export type SendDetailsStackParamList = {
  SendDetails: SendDetailsParams;
  Confirm: {
    fee: number;
    memo?: string;
    walletID: string;
    tx: string;
    targets?: CreateTransactionTarget[]; // needed to know if there were paymentCodes, which turned into addresses in `recipients`
    recipients: CreateTransactionTarget[];
    satoshiPerByte: number;
    payjoinUrl?: string | null;
    psbt: Psbt;
    supportRewardAddress: string;
    supportRewardAmount: number;
    txType: string;
  };
  PsbtWithHardwareWallet: {
    memo?: string;
    walletID: string;
    launchedBy?: string;
    psbt?: Psbt;
    txhex?: string;
  };
  CreateTransaction: {
    wallet: TWallet;
    memo?: string;
    psbt?: Psbt;
    txhex?: string;
    tx: string;
    fee: number;
    showAnimatedQr?: boolean;
    recipients: CreateTransactionTarget[];
    satoshiPerByte: number;
    feeSatoshi?: number;
  };
  PsbtMultisig: {
    memo?: string;
    psbtBase64: string;
    walletID: string;
    launchedBy?: string;
  };
  PsbtMultisigQRCode: {
    memo?: string;
    psbtBase64: string;
    fromWallet: string;
    launchedBy?: string;
  };
  Success: {
    fee: number;
    amount: number;
    txid?: string;
  };
  SelectWallet: {
    chainType: Chain;
  };
  CoinControl: {
    walletID: string;
  };
  PaymentCodeList: {
    walletID: string;
  };
};
