import React, { useContext, useImperativeHandle, forwardRef, useRef } from 'react';
import { Alert } from 'react-native';
import loc from '../loc';
import Clipboard from '@react-native-clipboard/clipboard';
import { StorageContext } from './Context/StorageProvider';
import { SegwitBech32Wallet } from '../class/wallets/segwit-bech32-wallet';
import presentAlert from './Alert';

// Define the structure of OTP notification data
interface OTPNotificationData {
  app_id: string;
  app_name: string;
  authTag: string;
  callback_url: string;
  encryptedMessage: string;
  ephemeralPublicKey: string;
  iv: string;
  notification_id: string;
  publicKey: string;
  recipient_public_key: string;
  type: string;
}

// Component props
interface Props {
  onOTPDecrypted?: (otp: string) => void;
}

// Handler ref type
export interface NotificationOTPHandlerRef {
  processOTPNotification: (notificationData: OTPNotificationData) => Promise<void>;
}

// Logger function with proper error handling
const log = (message: string, error?: unknown) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] NotificationOTPHandler: ${message}`);
  if (error) {
    if (error instanceof Error) {
      console.error(`[${timestamp}] NotificationOTPHandler Error:`, error.message);
    } else {
      console.error(`[${timestamp}] NotificationOTPHandler Error:`, String(error));
    }
  }
};

/**
 * Find the wallet that matches the recipient public key
 */
const findTargetWallet = (wallets: any[], recipientPublicKey: string) => {
  if (!recipientPublicKey) return null;
  
  for (const wallet of wallets) {
    if (wallet instanceof SegwitBech32Wallet) {
      try {
        const pubKey = wallet.getPubKey();
        if (pubKey && pubKey === recipientPublicKey) {
          return wallet;
        }
      } catch (error) {
        log(`Error getting public key for wallet`, error);
      }
    }
  }
  return null;
};

/**
 * Component to handle OTP notifications
 */
const NotificationOTPHandler = forwardRef<NotificationOTPHandlerRef, Props>(
  ({ onOTPDecrypted }, ref) => {
    const { wallets } = useContext(StorageContext);
    
    // Keep track of processed OTP notifications to prevent duplicates
    const processedOTPNotifications = useRef<Set<string>>(new Set());
    
    // Create a handler object that will be exposed via ref and globally
    const handler = {
      processOTPNotification: async (notificationData: OTPNotificationData) => {
        try {
          log('Processing OTP notification');
          log(`App: ${notificationData.app_name}, Type: ${notificationData.type}`);
          
          // Generate a unique notification ID to track processed notifications
          const notificationId = notificationData.notification_id || 
                               `${notificationData.app_id}-${notificationData.recipient_public_key}-${Date.now()}`;
          
          // Check if we've already processed this notification
          if (processedOTPNotifications.current.has(notificationId)) {
            log(`Skipping already processed notification: ${notificationId}`);
            return;
          }

          // Find the wallet that matches the recipient public key
          const targetWallet = findTargetWallet(wallets, notificationData.recipient_public_key);
          
          if (!targetWallet) {
            log(`No matching wallet found for public key: ${notificationData.recipient_public_key}`);
            Alert.alert('Error', 'No matching wallet found for this request');
            return;
          }

          const walletName = targetWallet.getLabel();
          log(`Found matching wallet: ${walletName}`);

          // Create the OTP data object for decryption
          const otpData = {
            encryptedMessage: notificationData.encryptedMessage,
            ephemeralPublicKey: notificationData.ephemeralPublicKey,
            iv: notificationData.iv,
            authTag: notificationData.authTag,
            appName: notificationData.app_name,
            appId: notificationData.app_id,
          };

          // Show confirmation dialog
          Alert.alert(
            loc.notifications.authorization_request_title,
            loc.notifications.authorization_request_message
              .replace('{app_name}', notificationData.app_name)
              .replace('{wallet_name}', walletName),
            [
              {
                text: loc.notifications.reject,
                style: 'cancel',
                onPress: () => {
                  log('User rejected authorization');
                  Alert.alert(loc.notifications.cancelled_title, loc.notifications.cancelled_message);
                },
              },
              {
                text: loc.notifications.approve,
                style: 'default',
                onPress: async () => {
                  try {
                    log('User approved authorization, decrypting OTP');
                    const decryptedOtp = targetWallet.decryptOtp(otpData);
                    
                    if (!decryptedOtp) {
                      throw new Error('Failed to decrypt OTP');
                    }
                    
                    log('OTP decrypted successfully');

                    // If there's a callback URL, send the decrypted OTP
                    if (notificationData.callback_url) {
                      log(`Sending response to callback URL: ${notificationData.callback_url}`);
                      
                      try {
                        const response = await fetch(notificationData.callback_url, {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                          },
                          body: JSON.stringify({
                            pubkey: notificationData.recipient_public_key,
                            notification_id: notificationData.notification_id,
                            otp: decryptedOtp,
                            status: 'approved',
                          }),
                        });
                        
                        const responseData = await response.json();
                        log('Callback response:', responseData);
                        
                        if (!response.ok) {
                          throw new Error(responseData.message || 'Failed to send response to app');
                        }
                      } catch (error) {
                        log('Error sending callback', error);
                        Alert.alert(
                          loc.notifications.warning_title,
                          loc.notifications.otp_callback_failed
                        );
                      }
                    }

                    // Mark this notification as processed
                    processedOTPNotifications.current.add(notificationId);
                    
                    // Copy to clipboard
                    Clipboard.setString(decryptedOtp);
                    log('Copied decrypted OTP to clipboard');

                    // Show success message
                    Alert.alert(loc.notifications.success_title, loc.notifications.otp_success);

                    // Notify parent component
                    if (onOTPDecrypted) {
                      log('Notifying parent component');
                      onOTPDecrypted(decryptedOtp);
                    }
                  } catch (error) {
                    log('Error during OTP decryption', error);
                    Alert.alert(loc.errors.error, error instanceof Error ? error.message : loc.notifications.processing_error);
                  }
                },
              },
            ]
          );
        } catch (error) {
          log('Error processing OTP notification', error);
          Alert.alert(loc.errors.error, loc.notifications.processing_error);
        }
      }
    };
    
    // Set the global reference directly
    // @ts-ignore - Global type is not fully defined
    global.notificationOTPHandler = handler;
    console.log('NotificationOTPHandler set globally:', global.notificationOTPHandler);
    
    // Also expose via ref for React components
    useImperativeHandle(ref, () => handler);



    return null;
  }
);

// Add type declaration for global object
declare global {
  var notificationOTPHandler: NotificationOTPHandlerRef | null;
}

export default NotificationOTPHandler;