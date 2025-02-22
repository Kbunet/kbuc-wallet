import React, { useEffect } from 'react';
import { Linking } from 'react-native';
import { navigate } from '../NavigationService';

const log = (message: string, error?: any) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ProfileVerificationHandler: ${message}`);
  if (error) {
    console.error(`[${timestamp}] ProfileVerificationHandler Error:`, error);
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

export const ProfileVerificationHandler: React.FC = () => {
  useEffect(() => {
    const handleURL = async (event: { url: string } | string) => {
      try {
        // Handle both event object and direct URL string
        const url = typeof event === 'string' ? event : event.url;
        
        log('Received URL:', url);
        
        if (!url) {
          log('URL is empty or undefined');
          return;
        }
        
        // Check if this is a verify URL
        if (!url.toLowerCase().startsWith('bluewallet:verify')) {
          log('Not a verify URL:', url);
          return;
        }

        log('Processing verify URL:', url);

        // Parse URL parameters
        const params = parseQueryParams(url);
        const profileHash = params['profile'];
        
        if (!profileHash) {
          log('No profile hash provided');
          return;
        }

        log('Navigating to profile verification with hash:', profileHash);
        
        // Navigate to the profile verification screen with the hash
        navigate('ProfileVerification', { profileId: profileHash });

      } catch (error) {
        log('Error handling URL', error);
      }
    };

    // Set up URL handling
    Linking.addEventListener('url', handleURL as any);

    // Check for initial URL
    Linking.getInitialURL().then(url => {
      if (url) {
        handleURL(url);
      }
    });

    // Cleanup
    return () => {
      // Remove event listener (if using older RN version)
      try {
        Linking.removeEventListener('url', handleURL as any);
      } catch (error) {
        // Ignore errors for newer RN versions where this isn't needed
      }
    };
  }, []);

  return null; // This component doesn't render anything
};

export default ProfileVerificationHandler;
