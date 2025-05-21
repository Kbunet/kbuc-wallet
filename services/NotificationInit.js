import { initializeNotificationService } from './NotificationService';

/**
 * Initialize the notification service when the app starts
 * This function should be called in the app's entry point (e.g., App.js)
 */
export const initializeNotifications = async () => {
  console.log('Initializing notification services...');
  
  try {
    // Initialize the notification service
    await initializeNotificationService();
    console.log('Notification services initialized successfully');
  } catch (error) {
    console.error('Failed to initialize notification services:', error);
  }
};

// Export other notification-related functions for convenience
export * from './NotificationService';
