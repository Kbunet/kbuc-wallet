import React, { useEffect, useContext, useRef } from 'react';
import { Linking } from 'react-native';
import { findTargetWallet } from '../class/otp-decrypt';
import { SegwitBech32Wallet } from '../class/wallets/segwit-bech32-wallet';
import Clipboard from '@react-native-clipboard/clipboard';
import { StorageContext } from './Context/StorageProvider';
import presentAlert from './Alert';

interface Props {
  onOTPDecrypted?: (otp: string) => void;
}

const log = (message: string, error?: any) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] OTPHandler: ${message}`);
  if (error) {
    console.error(`[${timestamp}] OTPHandler Error:`, error);
  }
};

// Helper function to parse URL query parameters
const parseQueryParams = (url: string): { [key: string]: string } => {
  try {
    const queryStart = url.indexOf('?');
    if (queryStart === -1) return {};

    const query = url.slice(queryStart + 1);
    const pairs = query.split('&');
    const params: { [key: string]: string } = {};

    pairs.forEach(pair => {
      const [key, value] = pair.split('=');
      if (key && value) {
        params[decodeURIComponent(key)] = decodeURIComponent(value);
      }
    });

    return params;
  } catch (e) {
    log('Error parsing query parameters', e);
    return {};
  }
};

// Extract scheme from URL
const extractScheme = (url: string): string => {
  try {
    const matches = url.match(/^([^:]+):/);
    return matches ? matches[1] : '';
  } catch (e) {
    log('Error extracting scheme', e);
    return '';
  }
};

export const OTPHandler: React.FC<Props> = ({ onOTPDecrypted }) => {
  const { wallets, walletsInitialized } = useContext(StorageContext);
  // Keep track of processed OTP requests to prevent duplicates
  const processedOTPRequests = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!walletsInitialized) {
      log('Wallets not initialized yet');
      return;
    }

    log('Setting up URL handler');

    // Log available wallets and their public keys
    log(`Found ${wallets.length} wallets`);
    wallets.forEach((wallet, index) => {
      if (wallet instanceof SegwitBech32Wallet) {
        const pubKey = wallet.getPubKey();
        log(`Wallet ${index + 1}: ${wallet.type}, Public Key: ${pubKey || 'N/A'}`);
      }
    });

    const handleURL = async (event: { url: string } | string) => {
      try {
        // Handle both event object and direct URL string
        const url = typeof event === 'string' ? event : event.url;
        log(`Received URL: ${url}`);
        
        if (!url) {
          log('No URL provided');
          return;
        }
        
        // Generate a unique request ID from the URL to track processed requests
        const requestId = url.trim();
        
        // Check if we've already processed this exact request
        if (processedOTPRequests.current.has(requestId)) {
          log(`Skipping already processed OTP request: ${requestId.substring(0, 20)}...`);
          return;
        }
        
        // Check if this is a decrypt URL and validate URL format
        const isDecryptUrl = url.toLowerCase().startsWith('bluewallet:decrypt') || 
                           url.toLowerCase().startsWith('otp://');
        if (!isDecryptUrl) {
          log('Not a decrypt URL:', url);
          return;
        }

        // Validate URL has query parameters
        if (url.indexOf('?') === -1) {
          log('Invalid URL format - missing query parameters');
          return;
        }

        log('Processing decrypt URL:', url);

        // Parse URL parameters manually
        const params = parseQueryParams(url);
        let encryptedOtp = params['otp'];
        const callbackScheme = params['callback_scheme']; // Get callback scheme from params
        
        // If the URL starts with otp://, the OTP data in the query parameter must be present and valid
        if (url.toLowerCase().startsWith('otp://')) {
          if (!encryptedOtp) {
            log('Missing OTP data for otp:// URL');
            return;
          }

          try {
            // The OTP must be a valid JSON string
            const otpData = JSON.parse(encryptedOtp);
            if (!otpData || typeof otpData !== 'object') {
              log('Invalid OTP data format');
              return;
            }
            encryptedOtp = JSON.stringify(otpData); // Re-stringify to ensure consistent format
          } catch (e) {
            log('Error parsing OTP data', e);
            return;
          }
        }

        log('Extracted OTP parameter:', encryptedOtp ? 'Present' : 'Missing');

        if (!encryptedOtp) {
          log('No OTP provided in URL', new Error('Missing OTP parameter'));
          presentAlert({
            title: 'Error',
            message: 'No OTP provided',
          });
          return;
        }

        try {
          // Clean and parse the OTP data
          const cleanOtpString = decodeURIComponent(encryptedOtp)
            .replace(/\s+/g, '')  // Remove all whitespace
            .replace(/\+/g, ' '); // Replace + with space
          
          // Validate OTP data structure
          let otpData;
          try {
            otpData = JSON.parse(cleanOtpString);
            if (!otpData || typeof otpData !== 'object') {
              throw new Error('Invalid OTP data format');
            }
          } catch (e) {
            log('Failed to parse OTP data', e);
            presentAlert({
              title: 'Error',
              message: 'Invalid OTP data format',
            });
            return;
          }

          log('OTP data structure:', Object.keys(otpData).join(', '));
          log('Target Public Key:', otpData.publicKey);

          // Validate required OTP fields
          const requiredFields = ['ephemeralPublicKey', 'iv', 'encryptedMessage', 'publicKey', 'authTag'];
          const missingFields = requiredFields.filter(field => !otpData[field]);
          
          if (missingFields.length > 0) {
            log(`Missing required OTP fields: ${missingFields.join(', ')}`);
            presentAlert({
              title: 'Error',
              message: 'Invalid OTP data: missing required fields',
            });
            return;
          }

          // Find the target wallet based on public key
          log('Finding target wallet');
          const targetWallet = await findTargetWallet(otpData.publicKey, wallets);
          
          if (!targetWallet) {
            log('No matching wallet found', new Error('No matching wallet'));
            presentAlert({
              title: 'Error',
              message: 'No matching wallet found for this request',
            });
            return;
          }

          // Ask for user approval
          log('Requesting user approval');
          const walletName = targetWallet.getLabel() || 'Unknown Wallet';
          const appName = otpData.appName || 'Unknown App';
          
          presentAlert({
            title: 'Authorization Request',
            message: `${appName} is requesting authorization to decrypt an OTP using your wallet "${walletName}". Do you want to approve this request?`,
            buttons: [
              {
                text: 'Reject',
                style: 'cancel',
                onPress: () => {
                  log('User rejected authorization');
                  presentAlert({
                    title: 'Cancelled',
                    message: 'Authorization request rejected',
                  });
                },
              },
              {
                text: 'Approve',
                style: 'default',
                onPress: async () => {
                  try {
                    log('User approved authorization, decrypting OTP');
                    const decryptedOtp = targetWallet.decryptOtp(otpData);
                    if (!decryptedOtp) {
                      throw new Error('Failed to decrypt OTP');
                    }
                    log('OTP decrypted successfully');

                    // Use callback_scheme from URL parameters if provided, otherwise use appId
                    const responseScheme = callbackScheme || otpData.appId || 'unknown';
                    
                    // Construct the response URL using the callback scheme
                    const responseUrl = `${responseScheme}://?otp=${encodeURIComponent(decryptedOtp)}`;
                    log('Sending decrypted OTP back to requester:', responseUrl);
                    
                    // Use Linking to open the URL
                    const supported = await Linking.canOpenURL(responseUrl);
                    if (!supported) {
                      log('URL is not supported:', responseUrl);
                      throw new Error(`App ${responseScheme} does not support ${responseScheme}:// scheme`);
                    }
                    await Linking.openURL(responseUrl);

                    // Mark this request as processed
                    processedOTPRequests.current.add(requestId);
                    
                    // Show success message
                    presentAlert({
                      title: 'Success',
                      message: 'OTP decrypted successfully',
                    });

                    // Copy to clipboard
                    Clipboard.setString(decryptedOtp);
                    log('Copied decrypted OTP to clipboard');

                    // Notify parent component
                    if (onOTPDecrypted) {
                      log('Notifying parent component');
                      onOTPDecrypted(decryptedOtp);
                    }
                  } catch (error) {
                    log('Error during OTP decryption', error);
                    presentAlert({
                      title: 'Error',
                      message: error instanceof Error ? error.message : 'Failed to decrypt OTP',
                    });
                  }
                },
              },
            ],
          });
        } catch (e) {
          log('Failed to parse OTP data', e);
          presentAlert({
            title: 'Error',
            message: 'Invalid OTP format',
          });
        }
      } catch (error) {
        log('Error handling URL', error);
        presentAlert({
          title: 'Error',
          message: error instanceof Error ? error.message : 'Failed to process request',
        });
      }
    };

    // Add event listener
    log('Adding URL event listener');
    const subscription = Linking.addEventListener('url', handleURL);

    // Check for initial URL
    Linking.getInitialURL()
      .then(url => {
        if (url) {
          log('Found initial URL:', url);
          handleURL(url);
        } else {
          log('No initial URL found');
        }
      })
      .catch(err => log('Error getting initial URL', err));

    // Cleanup
    return () => {
      log('Cleaning up URL handler');
      subscription.remove();
      // Clear processed requests on unmount
      processedOTPRequests.current.clear();
    };
  }, [onOTPDecrypted, wallets, walletsInitialized]);

  return null;
};

export default OTPHandler;
