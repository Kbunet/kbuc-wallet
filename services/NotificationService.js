import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, Alert } from 'react-native';

// Queue for pending OTP notifications
let pendingOTPNotifications = [];

// Queue for pending transaction notifications
let pendingTransactionNotifications = [];

// Global variables to track notification processing state
let isProcessingOTPNotification = false;
let otpNotificationQueue = [];

// Transaction notification handling
let isProcessingTransactionNotification = false;
let transactionNotificationQueue = [];

// Sets to track processed notification IDs to avoid duplicates
const processedOTPNotificationIds = new Set();
const processedTransactionNotificationIds = new Set();

// Store the last notification that opened the app
let lastOpenedNotification = null;

// Try to import Firebase messaging, but handle the case where it might not be configured
let messaging;
try {
  messaging = require('@react-native-firebase/messaging').default;
} catch (error) {
  console.warn('Firebase messaging not available:', error.message);
  messaging = null;
}

// The URL of the notification proxy server
const NOTIFICATION_PROXY_URL = 'https://notifier.kbunet.net/api';

/**
 * Request permission for push notifications
 * @returns {Promise<boolean>} Whether permission was granted
 */
export const requestNotificationPermission = async () => {
  try {
    // Check if Firebase messaging is available
    if (!messaging) {
      console.log('Using mock notification permission as Firebase is not configured');
      return true; // Return true for mock implementation
    }
    
    // Request permission for iOS devices
    const authStatus = await messaging().requestPermission();
    
    // Check if permission was granted
    const enabled = 
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL;
    
    console.log('Notification permission status:', enabled);
    return enabled;
  } catch (error) {
    console.error('Failed to request notification permission:', error);
    return false;
  }
};

/**
 * Get the FCM token and store it in AsyncStorage
 * @returns {Promise<string|null>} The FCM token or null if failed
 */
export const getFcmToken = async () => {
  try {
    // Check if Firebase messaging is available
    if (!messaging) {
      // Use mock implementation if Firebase is not configured
      let fcmToken = await AsyncStorage.getItem('fcmToken');
      
      if (!fcmToken) {
        // Generate a mock token
        fcmToken = 'mock-fcm-token-' + Math.random().toString(36).substring(2, 15);
        await AsyncStorage.setItem('fcmToken', fcmToken);
        console.log('Mock FCM Token generated:', fcmToken);
      }
      
      return fcmToken;
    }
    
    // Firebase is available, proceed with real implementation
    // Check if we already have a token in storage
    let fcmToken = await AsyncStorage.getItem('fcmToken');
    
    // If we have a token, verify it's still valid
    if (fcmToken) {
      try {
        // Check if the token is still valid by comparing with the current Firebase token
        const currentToken = await messaging().getToken();
        if (fcmToken !== currentToken) {
          // Token has changed, update it
          fcmToken = currentToken;
          await AsyncStorage.setItem('fcmToken', fcmToken);
          console.log('FCM Token updated:', fcmToken);
        }
      } catch (error) {
        console.warn('Error verifying FCM token, using stored token:', error.message);
      }
    } else {
      try {
        // No token in storage, get a new one from Firebase
        fcmToken = await messaging().getToken();
        if (fcmToken) {
          await AsyncStorage.setItem('fcmToken', fcmToken);
          console.log('New FCM Token stored:', fcmToken);
        }
      } catch (error) {
        console.warn('Failed to get FCM token from Firebase:', error.message);
        // Generate a mock token as fallback
        fcmToken = 'mock-fcm-token-' + Math.random().toString(36).substring(2, 15);
        await AsyncStorage.setItem('fcmToken', fcmToken);
        console.log('Mock FCM Token generated as fallback:', fcmToken);
      }
    }
    
    return fcmToken;
  } catch (error) {
    console.error('Failed to get FCM token:', error);
    return null;
  }
};

/**
 * Register a wallet with the notification proxy
 * @param {string} publicKey - The wallet's public key
 * @param {string} token - The FCM token
 * @returns {Promise<Object>} The response from the proxy
 */
export const registerWalletWithProxy = async (publicKey, token) => {
  try {
    const response = await fetch(`${NOTIFICATION_PROXY_URL}/tokens/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: publicKey, // Using public key as the user ID
        publicKey,
        token,
        deviceInfo: {
          platform: Platform.OS,
          model: 'Mobile Device',
          version: Platform.Version?.toString() || 'Unknown'
        }
      }),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.message || 'Failed to register with notification proxy');
    }
    
    console.log('Successfully registered wallet with notification proxy:', data);
    return data;
  } catch (error) {
    console.error('Error registering with notification proxy:', error);
    throw error;
  }
};

/**
 * Update FCM tokens for all allowed wallets
 * This should be called when the app starts
 */
export const updateAllWalletTokens = async () => {
  try {
    // Get the FCM token
    const fcmToken = await getFcmToken();
    
    if (!fcmToken) {
      console.log('No FCM token available, skipping wallet token update');
      return;
    }
    
    // Get the list of allowed wallets
    const storedWallets = await AsyncStorage.getItem('notificationWallets');
    
    if (!storedWallets) {
      console.log('No wallets registered for notifications');
      return;
    }
    
    const walletList = JSON.parse(storedWallets);
    
    if (!Array.isArray(walletList) || walletList.length === 0) {
      console.log('No wallets in the notification list');
      return;
    }
    
    console.log(`Updating FCM token for ${walletList.length} wallets`);
    
    // Register each wallet with the proxy
    const registrationPromises = walletList.map(publicKey => 
      registerWalletWithProxy(publicKey, fcmToken)
        .catch(error => {
          console.error(`Failed to update token for wallet ${publicKey}:`, error);
          return null;
        })
    );
    
    // Wait for all registrations to complete
    const results = await Promise.all(registrationPromises);
    
    const successCount = results.filter(result => result !== null).length;
    console.log(`Successfully updated FCM token for ${successCount}/${walletList.length} wallets`);
  } catch (error) {
    console.error('Error updating wallet tokens:', error);
  }
};

/**
 * Handle incoming notifications
 * @param {Object} remoteMessage - The remote message from FCM
 */
export const handleNotification = async (remoteMessage) => {
  console.log('Received notification:', JSON.stringify(remoteMessage));
  
  // Store notification in history
  await storeNotificationInHistory(remoteMessage);
  
  // Check if it's an OTP notification
  if (isOTPNotification(remoteMessage.data)) {
    console.log('Processing OTP notification');
    
    // Check if notification has already been processed
    if (processedOTPNotificationIds.has(remoteMessage.data.notification_id)) {
      console.log('OTP notification already processed, skipping:', remoteMessage.data.notification_id);
      return;
    }
    
    // Add to processed set
    processedOTPNotificationIds.add(remoteMessage.data.notification_id);
    
    // If OTP handler is ready, process notification, otherwise queue it
    if (global.notificationOTPHandler && !isProcessingOTPNotification) {
      isProcessingOTPNotification = true;
      try {
        await global.notificationOTPHandler.processOTPNotification(remoteMessage.data);
      } catch (error) {
        console.log('Error processing OTP notification:', error);
      } finally {
        isProcessingOTPNotification = false;
        
        // Process any queued notifications
        if (otpNotificationQueue.length > 0) {
          processPendingOTPNotifications();
        }
      }
    } else {
      console.log('OTP handler not ready, queueing notification');
      otpNotificationQueue.push(remoteMessage.data);
    }
  } 
  // Check if it's a transaction notification (send, reputation, ownership, platform)
  else if (isTransactionNotification(remoteMessage.data)) {
    console.log('Processing transaction notification of type:', remoteMessage.data.type);
    
    // Check if notification has already been processed
    if (processedTransactionNotificationIds.has(remoteMessage.data.notification_id)) {
      console.log('Transaction notification already processed, skipping:', remoteMessage.data.notification_id);
      return;
    }
    
    // Add to processed set
    processedTransactionNotificationIds.add(remoteMessage.data.notification_id);
    
    // If transaction handler is ready, process notification, otherwise queue it
    if (global.notificationTransactionHandler && !isProcessingTransactionNotification) {
      isProcessingTransactionNotification = true;
      try {
        await global.notificationTransactionHandler.processTransactionNotification(remoteMessage.data);
      } catch (error) {
        console.log('Error processing transaction notification:', error);
      } finally {
        isProcessingTransactionNotification = false;
        
        // Process any queued notifications
        if (transactionNotificationQueue.length > 0) {
          processPendingTransactionNotifications();
        }
      }
    } else {
      console.log('Transaction handler not ready, queueing notification');
      transactionNotificationQueue.push(remoteMessage.data);
    }
  } else {
    // For other notification types, store as pending approval
    console.log('Storing unknown notification type as pending approval');
    await storePendingApproval(remoteMessage.data);
  }
};

/**
 * Store a notification in history
 * @param {Object} remoteMessage - The remote message from FCM
 */
async function storeNotificationInHistory(remoteMessage) {
  try {
    // Store notification in history
    const storedNotifications = await AsyncStorage.getItem('notifications');
    const notifications = storedNotifications ? JSON.parse(storedNotifications) : [];
    
    notifications.push({
      id: remoteMessage.messageId,
      title: remoteMessage.notification?.title || 'New Notification',
      body: remoteMessage.notification?.body || '',
      data: remoteMessage.data || {},
      timestamp: new Date().toISOString(),
      read: false
    });
    
    // Keep only the last 50 notifications
    if (notifications.length > 50) {
      notifications.shift(); // Remove the oldest notification
    }
    
    await AsyncStorage.setItem('notifications', JSON.stringify(notifications));
  } catch (error) {
    console.error('Error storing notification in history:', error);
  }
}

/**
 * Store notification data as a pending approval
 * @param {Object} data - The notification data
 */
async function storePendingApproval(data) {
  try {
    // Store pending approval requests
    const storedRequests = await AsyncStorage.getItem('pendingApprovals');
    const pendingApprovals = storedRequests ? JSON.parse(storedRequests) : [];
    
    pendingApprovals.push({
      id: data.notification_id,
      appId: data.app_id,
      appName: data.app_name || data.app_id,
      data: data,
      timestamp: new Date().toISOString()
    });
    
    await AsyncStorage.setItem('pendingApprovals', JSON.stringify(pendingApprovals));
    console.log('Stored notification as pending approval');
  } catch (error) {
    console.error('Error storing pending approval:', error);
  }
}

/**
 * Send a response to a notification
 * @param {string} notificationId - The ID of the notification
 * @param {string} publicKey - The public key of the wallet
 * @param {Object} response - The response data
 * @param {string} status - The status of the response (e.g., 'responded')
 * @returns {Promise<Object>} The response from the proxy
 */
export const sendNotificationResponse = async (notificationId, publicKey, response, status = 'responded') => {
  try {
    const apiResponse = await fetch(`${NOTIFICATION_PROXY_URL}/notifications/${notificationId}/response`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        response,
        status
      }),
    });
    
    const data = await apiResponse.json();
    
    if (!apiResponse.ok) {
      throw new Error(data.message || 'Failed to send notification response');
    }
    
    console.log('Successfully sent notification response:', data);
    
    // Update pending approvals
    const storedRequests = await AsyncStorage.getItem('pendingApprovals');
    
    if (storedRequests) {
      const pendingApprovals = JSON.parse(storedRequests);
      const updatedApprovals = pendingApprovals.filter(approval => approval.id !== notificationId);
      await AsyncStorage.setItem('pendingApprovals', JSON.stringify(updatedApprovals));
    }
    
    return data;
  } catch (error) {
    console.error('Error sending notification response:', error);
    throw error;
  }
};

/**
 * Process pending OTP notifications that were queued while the handler wasn't ready
 */
export const processPendingOTPNotifications = async () => {
  console.log('Processing pending OTP notifications, queue length:', otpNotificationQueue.length);
  
  if (otpNotificationQueue.length > 0 && !isProcessingOTPNotification) {
    isProcessingOTPNotification = true;
    
    try {
      const notification = otpNotificationQueue.shift();
      if (notification && global.notificationOTPHandler) {
        await global.notificationOTPHandler.processOTPNotification(notification);
      }
    } catch (error) {
      console.log('Error processing pending OTP notification:', error);
    } finally {
      isProcessingOTPNotification = false;
      
      // Process next notification in queue if any
      if (otpNotificationQueue.length > 0) {
        processPendingOTPNotifications();
      }
    }
  }
};

/**
 * Process pending transaction notifications that were queued while the handler wasn't ready
 */
export const processPendingTransactionNotifications = async () => {
  console.log('Processing pending transaction notifications, queue length:', transactionNotificationQueue.length);
  
  if (transactionNotificationQueue.length > 0 && !isProcessingTransactionNotification) {
    isProcessingTransactionNotification = true;
    
    try {
      const notification = transactionNotificationQueue.shift();
      if (notification && global.notificationTransactionHandler) {
        await global.notificationTransactionHandler.processTransactionNotification(notification);
      }
    } catch (error) {
      console.log('Error processing pending transaction notification:', error);
    } finally {
      isProcessingTransactionNotification = false;
      
      // Process next notification in queue if any
      if (transactionNotificationQueue.length > 0) {
        processPendingTransactionNotifications();
      }
    }
  }
};

/**
 * Check if a notification is an OTP notification
 * @param {object} notificationData - The notification data
 * @returns {boolean} - True if it's an OTP notification
 */
const isOTPNotification = (notificationData) => {
  return (
    notificationData &&
    notificationData.type === 'otp' &&
    notificationData.encryptedMessage &&
    notificationData.ephemeralPublicKey &&
    notificationData.iv &&
    notificationData.authTag
  );
};

/**
 * Check if a notification is a transaction notification (send, reputation, ownership, platform)
 * @param {object} notificationData - The notification data
 * @returns {boolean} - True if it's a transaction notification
 */
const isTransactionNotification = (notificationData) => {
  return (
    notificationData &&
    ['send', 'reputation', 'ownership', 'platform'].includes(notificationData.type) &&
    notificationData.notification_id
  );
};

/**
 * Initialize the notification service
 * This should be called when the app starts
 */
export const initializeNotificationService = async () => {
  try {
    // Request permission
    const hasPermission = await requestNotificationPermission();
    
    if (!hasPermission) {
      console.log('No notification permission granted');
      return;
    }
    
    // Update FCM tokens for all allowed wallets
    await updateAllWalletTokens();
    
    // Check if Firebase messaging is available
    if (messaging) {
      try {
        // Set up notification handlers
        messaging().onMessage(handleNotification);
        messaging().setBackgroundMessageHandler(handleNotification);
        
        // Handle notification taps when app is in background
        messaging().onNotificationOpenedApp(notification => {
          console.log('Notification opened app from background state:', notification);
          lastOpenedNotification = notification;
          
          // Process the notification data
          if (notification && notification.data) {
            // Small delay to ensure the app is fully in foreground
            setTimeout(() => {
              console.log('Processing notification that opened the app');
              handleNotification(notification);
            }, 1000);
          }
        });
        
        // Handle notification taps when app is closed
        messaging().getInitialNotification().then(notification => {
          if (notification) {
            console.log('Notification opened app from closed state:', notification);
            lastOpenedNotification = notification;
            
            // Process the notification data
            if (notification && notification.data) {
              // Longer delay to ensure the app is fully initialized
              setTimeout(() => {
                console.log('Processing initial notification that opened the app');
                handleNotification(notification);
              }, 3000);
            }
          }
        });
        
        // Handle token refresh
        messaging().onTokenRefresh(async (fcmToken) => {
          console.log('FCM Token refreshed:', fcmToken);
          await AsyncStorage.setItem('fcmToken', fcmToken);
          
          // Update all registered wallets with the new token
          await updateAllWalletTokens();
        });
        
        console.log('Firebase notification service initialized');
      } catch (error) {
        console.warn('Error setting up Firebase notification handlers:', error.message);
      }
    } else {
      console.log('Using mock notification service (Firebase not configured)');
    }
  } catch (error) {
    console.error('Failed to initialize notification service:', error);
  }
};
