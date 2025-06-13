import React, { useContext, useImperativeHandle, forwardRef } from 'react';
import { Alert } from 'react-native';
import loc from '../loc';
import { StorageContext } from './Context/StorageProvider';
import { SegwitBech32Wallet } from '../class/wallets/segwit-bech32-wallet';
import { navigate } from '../NavigationService';
import { ParamListBase } from '@react-navigation/native';

// Define the structure of transaction notification data
export interface TransactionNotificationData {
  app_id: string;
  app_name: string;
  notification_id: string;
  recipient_public_key?: string;
  type: 'send' | 'reputation' | 'ownership' | 'platform';
  address?: string;
  amount?: string;
  profile_id?: string;
  owner_id?: string;
  duration?: string;
  appdata?: string;
}

// Component props
interface Props {
  onNotificationProcessed?: (data: TransactionNotificationData, success: boolean) => void;
}

// Handler ref type
export interface NotificationTransactionHandlerRef {
  processTransactionNotification: (notificationData: TransactionNotificationData) => Promise<void>;
}

// Create a global set to track processed notification IDs
// This ensures we don't process the same notification twice, even across component remounts
if (!global.processedTransactionIds) {
  global.processedTransactionIds = new Set<string>();
}

// Flag to track if a notification is currently showing an alert
let isShowingAlert = false;

// Logger function with proper error handling
const log = (message: string, error?: unknown): void => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] NotificationTransactionHandler: ${message}`);
  if (error) {
    if (error instanceof Error) {
      console.error(`[${timestamp}] NotificationTransactionHandler Error:`, error.message);
    } else {
      console.error(`[${timestamp}] NotificationTransactionHandler Error:`, String(error));
    }
  }
};

/**
 * Find the wallet that matches the recipient public key
 * Checks in this order:
 * 1. Wallet with matching public key
 * 2. Wallet with matching public key hash
 * 3. Wallet with matching address
 */
const findTargetWallet = (wallets: any[], recipientPublicKey?: string): any => {
  if (!recipientPublicKey) {
    // If no recipient public key is provided, return the first wallet
    return wallets.length > 0 ? wallets[0] : null;
  }
  
  // First check: Find wallet by public key match
  for (const wallet of wallets) {
    try {
      const pubKey = wallet.getPubKey?.();
      if (pubKey && pubKey === recipientPublicKey) {
        log(`Found matching wallet by public key: ${wallet.getID()}`);
        return wallet;
      }
    } catch (error) {
      log(`Error getting public key for wallet`, error);
    }
  }
  
  // Second check: Find wallet by public key hash match
  for (const wallet of wallets) {
    try {
      const pubKeyHash = wallet.getPublicKeyHash?.();
      if (pubKeyHash && pubKeyHash === recipientPublicKey) {
        log(`Found matching wallet by public key hash: ${wallet.getID()}`);
        return wallet;
      }
    } catch (error) {
      log(`Error getting public key hash for wallet`, error);
    }
  }
  
  // Third check: Find wallet by address match
  for (const wallet of wallets) {
    try {
      const address = wallet.getAddress?.();
      if (address && address === recipientPublicKey) {
        log(`Found matching wallet by address: ${wallet.getID()}`);
        return wallet;
      }
    } catch (error) {
      log(`Error getting address for wallet`, error);
    }
  }
  
  // If no matching wallet is found, return the first wallet as fallback
  log('No matching wallet found, using first wallet as fallback');
  return wallets.length > 0 ? wallets[0] : null;
};

/**
 * Component to handle transaction notifications
 */
const NotificationTransactionHandler = forwardRef<NotificationTransactionHandlerRef, Props>(
  ({ onNotificationProcessed }, ref) => {
    const { wallets } = useContext(StorageContext);
    
    // Create a handler object that will be exposed via ref and globally
    const handler = {
      processTransactionNotification: async (notificationData: TransactionNotificationData): Promise<void> => {
        return new Promise((resolve) => {
          try {
            log('Processing transaction notification');
            log(`App: ${notificationData.app_name || notificationData.app_id}, Type: ${notificationData.type}`);
            
            // Generate a unique notification ID to track processed notifications
            const notificationId = notificationData.notification_id || 
                                `${notificationData.app_id}-${notificationData.type}-${Date.now()}`;
            
            // Check if we've already processed this notification
            if (global.processedTransactionIds.has(notificationId)) {
              log(`Skipping already processed notification: ${notificationId}`);
              if (onNotificationProcessed) {
                onNotificationProcessed(notificationData, false);
              }
              resolve();
              return;
            }

            // Check if we're already showing an alert
            if (isShowingAlert) {
              log('Already showing an alert, skipping this notification');
              if (onNotificationProcessed) {
                onNotificationProcessed(notificationData, false);
              }
              resolve();
              return;
            }
            
            // Find the wallet that matches the recipient public key
            const targetWallet = findTargetWallet(wallets, notificationData.recipient_public_key);
            if (!targetWallet) {
              log('No wallet available');
              Alert.alert('Error', 'No wallet available to process this transaction');
              if (onNotificationProcessed) {
                onNotificationProcessed(notificationData, false);
              }
              resolve();
              return;
            }
            
            // Mark this notification as processed
            global.processedTransactionIds.add(notificationId);
            isShowingAlert = true;
            
            // Show an alert to the user asking for approval
            Alert.alert(
              loc.notifications.transaction_request_title.replace('{app_name}', notificationData.app_name || notificationData.app_id),
              loc.notifications.transaction_request_message.replace('{type}', notificationData.type),
              [
                {
                  text: loc.notifications.cancel,
                  style: 'cancel',
                  onPress: () => {
                    log('User cancelled transaction notification');
                    isShowingAlert = false;
                    if (onNotificationProcessed) {
                      onNotificationProcessed(notificationData, false);
                    }
                    resolve();
                  },
                },
                {
                  text: loc.notifications.approve,
                  style: 'default',
                  onPress: () => {
                    log('User approved transaction notification');
                    isShowingAlert = false;
                    
                    // Add a small delay before navigation to avoid UI conflicts
                    setTimeout(() => {
                      // Navigate to the appropriate screen based on notification type
                      // Use type assertion to satisfy TypeScript's navigation parameter requirements
                      type NavigationParams = {
                        screen: string;
                        params: Record<string, any>;
                      };
                      
                      const screenParams: Record<string, any> = {
                        walletID: targetWallet.getID(),
                        isEditable: true,
                        feeUnit: 'KBUC',
                        amountUnit: 'KBUC',
                      };
                      
                      switch (notificationData.type) {
                        case 'send':
                          screenParams.txType = 'send';
                          screenParams.address = notificationData.address || '';
                          screenParams.amount = notificationData.amount || '';
                          break;
                        case 'reputation':
                          screenParams.txType = 'reputation';
                          screenParams.address = notificationData.profile_id || '';
                          screenParams.amount = notificationData.amount || '0.00001';
                          break;
                        case 'ownership':
                          screenParams.txType = 'ownership';
                          screenParams.address = notificationData.owner_id || '';
                          screenParams.profile = notificationData.profile_id || '';
                          screenParams.period = notificationData.duration || '';
                          screenParams.amount = '0.00001'; // Minimal amount
                          break;
                        case 'platform':
                          screenParams.txType = 'metadata';
                          screenParams.address = notificationData.profile_id || '';
                          screenParams.metaAppData = notificationData.appdata || '';
                          screenParams.amount = '0.00001'; // Minimal amount
                          break;
                      }
                      
                      // Navigate to the SendDetails screen with the appropriate parameters
                      const navigationConfig: NavigationParams = {
                        screen: 'SendDetails',
                        params: screenParams
                      };
                      
                      navigate('SendDetailsRoot', navigationConfig as unknown as ParamListBase);
                      
                      if (onNotificationProcessed) {
                        onNotificationProcessed(notificationData, true);
                      }
                      resolve();
                    }, 800);
                  },
                },
              ],
              {
                cancelable: false, // Prevent dismissing by tapping outside
              }
            );
          } catch (error) {
            log('Error processing transaction notification', error);
            isShowingAlert = false;
            Alert.alert('Error', 'Failed to process transaction notification');
            if (onNotificationProcessed) {
              onNotificationProcessed(notificationData, false);
            }
            resolve();
          }
        });
      }
    };
    
    // Set the global reference directly
    // @ts-ignore - Global type is not fully defined
    global.notificationTransactionHandler = handler;
    console.log('NotificationTransactionHandler set globally:', global.notificationTransactionHandler);
    
    // Also expose via ref for React components
    useImperativeHandle(ref, () => handler);

    return null;
  }
);

// Add type declaration for global object
declare global {
  var notificationTransactionHandler: NotificationTransactionHandlerRef | null;
  var processedTransactionIds: Set<string>;
}

export default NotificationTransactionHandler;
