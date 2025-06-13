import 'react-native-gesture-handler'; // should be on top

import { NavigationContainer } from '@react-navigation/native';
import React, { useEffect, useRef, RefObject } from 'react';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LargeScreenProvider } from './components/Context/LargeScreenProvider';
import { SettingsProvider } from './components/Context/SettingsProvider';
import { BlueDarkTheme, BlueDefaultTheme } from './components/themes';
import MasterView from './navigation/MasterView';
import { navigationRef } from './NavigationService';
import { StorageProvider } from './components/Context/StorageProvider';
import OTPHandler from './components/OTPHandler';
import NotificationOTPHandler, { NotificationOTPHandlerRef } from './components/NotificationOTPHandler';
import NotificationTransactionHandler, { NotificationTransactionHandlerRef } from './components/NotificationTransactionHandler';
import SendRequestHandler from './components/SendRequestHandler';
import ProfileVerificationHandler from './components/ProfileVerificationHandler';
import { initializeNotificationService, processPendingOTPNotifications, processPendingTransactionNotifications } from './services/NotificationService';

const App = () => {
  const colorScheme = useColorScheme();
  const notificationOTPHandlerRef = useRef<NotificationOTPHandlerRef>(null);
  const notificationTransactionHandlerRef = useRef<NotificationTransactionHandlerRef>(null);

  // Initialize notification service when the app starts
  useEffect(() => {
    console.log('App mounted - initializing notification service');
    const initialize = async () => {
      try {
        await initializeNotificationService();
        console.log('Notification service initialized successfully');
      } catch (error) {
        console.error('Failed to initialize notification service:', error);
      }
    };
    
    initialize();
    
    return () => {
      console.log('App unmounting - cleaning up notification service');
    };
  }, []);
  

  // Process any pending OTP notifications after a delay
  useEffect(() => {
    // Process any pending OTP notifications after a short delay
    const timer = setTimeout(() => {
      console.log('Processing any pending OTP notifications');
      processPendingOTPNotifications();
    }, 2000); // Longer delay to ensure everything is properly initialized
    
    return () => {
      clearTimeout(timer);
    };
  }, []);
  
  // Process any pending transaction notifications after a delay
  useEffect(() => {
    // Process any pending transaction notifications after a short delay
    const timer = setTimeout(() => {
      console.log('Processing any pending transaction notifications');
      processPendingTransactionNotifications();
    }, 2500); // Slightly longer delay than OTP to avoid conflicts
    
    return () => {
      clearTimeout(timer);
    };
  }, []);

  return (
    <LargeScreenProvider>
      <NavigationContainer ref={navigationRef} theme={colorScheme === 'dark' ? BlueDarkTheme : BlueDefaultTheme}>
        <SafeAreaProvider>
          <StorageProvider>
            <SettingsProvider>
              <OTPHandler />
              <NotificationOTPHandler ref={notificationOTPHandlerRef} />
              <NotificationTransactionHandler ref={notificationTransactionHandlerRef} />
              <SendRequestHandler />
              <ProfileVerificationHandler />
              <MasterView />
            </SettingsProvider>
          </StorageProvider>
        </SafeAreaProvider>
      </NavigationContainer>
    </LargeScreenProvider>
  );
};

export default App;
