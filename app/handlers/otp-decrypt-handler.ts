import { Linking } from 'react-native';
import { decryptOTP } from '../class/otp-decrypt';
import { Alert } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';

class OTPDecryptHandler {
  private static instance: OTPDecryptHandler;

  private constructor() {
    // Initialize URL handler
    Linking.addEventListener('url', this.handleURL);
  }

  public static getInstance(): OTPDecryptHandler {
    if (!OTPDecryptHandler.instance) {
      OTPDecryptHandler.instance = new OTPDecryptHandler();
    }
    return OTPDecryptHandler.instance;
  }

  private handleURL = async (event: { url: string }) => {
    try {
      const { url } = event;
      
      // Check if this is a decrypt URL
      if (!url.startsWith('bluewallet://decrypt')) {
        return;
      }

      // Parse the URL
      const parsedUrl = new URL(url);
      const encryptedOtp = parsedUrl.searchParams.get('otp');

      if (!encryptedOtp) {
        throw new Error('No OTP provided');
      }

      // Decrypt the OTP
      const decryptedOtp = await decryptOTP(encryptedOtp);

      // Copy to clipboard
      Clipboard.setString(decryptedOtp);

      // Show success message
      Alert.alert(
        'OTP Decrypted',
        'The decrypted OTP has been copied to your clipboard. Return to the game and paste it.',
        [
          {
            text: 'OK',
            onPress: () => {
              // Try to return to the game
              Linking.openURL('mygame://otp-result?success=true');
            },
          },
        ],
      );
    } catch (error) {
      console.error('Error handling decrypt URL:', error);
      Alert.alert(
        'Decryption Failed',
        'Failed to decrypt the OTP. Please try again.',
        [
          {
            text: 'OK',
            onPress: () => {
              // Notify game of failure
              Linking.openURL('mygame://otp-result?success=false');
            },
          },
        ],
      );
    }
  };

  public cleanup() {
    // Remove the event listener when no longer needed
    Linking.removeAllListeners('url');
  }
}

export default OTPDecryptHandler;
