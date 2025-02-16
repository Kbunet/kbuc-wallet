import { SegwitBech32Wallet } from './wallets/segwit-bech32-wallet';
import { BlueApp } from '.';
import type { TWallet } from './wallets/types';

const log = (message: string, error?: any) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] OTPDecryptor: ${message}`);
  if (error) {
    console.error(`[${timestamp}] OTPDecryptor Error:`, error);
  }
};

interface OTPData {
  ephemeralPublicKey: string;
  iv: string;
  encryptedMessage: string;
  publicKey: string;
  authTag: string;
}

// Find the target wallet based on public key
export async function findTargetWallet(targetPubKey: string, wallets: TWallet[]): Promise<SegwitBech32Wallet | null> {
  log('Finding wallet for public key:', targetPubKey);
  
  try {
    log(`Checking ${wallets.length} wallets`);

    // Find matching SegwitBech32Wallet
    for (const wallet of wallets) {
      if (wallet instanceof SegwitBech32Wallet) {
        const pubKey = wallet.getPubKey();
        if (pubKey && pubKey === targetPubKey) {
          log('Found matching wallet');
          return wallet;
        }
      }
    }

    log('No matching wallet found');
    return null;
  } catch (error) {
    log('Error finding target wallet', error);
    throw error;
  }
}

// Helper function to decrypt OTP
export async function decryptOTP(encryptedData: string, wallets: TWallet[]): Promise<string> {
  try {
    log('Starting decryptOTP helper function');
    
    // Parse the encrypted data
    log('Parsing encrypted data');
    const otpData = JSON.parse(encryptedData);
    log('Successfully parsed encrypted data');

    // Find the target wallet based on public key
    log('Finding target wallet');
    const targetWallet = await findTargetWallet(otpData.publicKey, wallets);
    if (!targetWallet) {
      log('No matching wallet found', new Error('No matching wallet found'));
      throw new Error('No matching wallet found');
    }

    // Decrypt the OTP using the target wallet
    log('Decrypting OTP using target wallet');
    const decryptedOtp = targetWallet.decryptOtp(otpData);
    if (decryptedOtp === false) {
      throw new Error('Failed to decrypt OTP');
    }
    
    log('Successfully decrypted OTP');
    return decryptedOtp;
  } catch (error) {
    log('Failed to decrypt OTP', error);
    throw error;
  }
}
