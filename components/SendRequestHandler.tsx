import React, { useEffect, useContext, useState } from 'react';
import { Linking } from 'react-native';
import { StorageContext } from './Context/StorageProvider';
import presentAlert from './Alert';
import { WalletSelectDialog } from './WalletSelectDialog';
import { navigate } from '../NavigationService';
import { BitcoinUnit } from '../models/bitcoinUnits';

interface AddressAmount {
  address: string;
  amount: string;
  txType: string;
  ownershipId?: string;  // Required for ownership type
  ownershipAmount?: number;  // Optional for ownership type
}

interface Props {
  onSendRequest?: (addresses: AddressAmount[], selectedWallet: any) => void;
}

const log = (message: string, error?: any) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] SendRequestHandler: ${message}`);
  if (error) {
    console.error(`[${timestamp}] SendRequestHandler Error:`, error);
  }
};

// Helper function to parse address-amount pairs
const validateOwnershipId = (id: string): boolean => {
  // Validate that ownershipId is a valid hex string of correct length (40 characters)
  return /^[0-9a-f]{40}$/i.test(id);
};

const parseAddressData = (addressString: string): AddressAmount => {
  const parts = addressString.split('-');
  const [address, amount, txType, ...additionalParams] = parts;

  if (!address || !amount) {
    throw new Error('Address and amount are required');
  }

  const result: AddressAmount = {
    address,
    amount,
    txType: txType || 'standard'
  };

  // Handle ownership type specific parameters
  if (txType === 'ownership') {
    const [ownershipId, ownershipAmountStr] = additionalParams;

    if (!ownershipId) {
      throw new Error('Ownership ID is required for ownership type');
    }

    if (!validateOwnershipId(ownershipId)) {
      throw new Error('Invalid ownership ID format');
    }

    result.ownershipId = ownershipId;
    
    // Parse optional ownership amount if provided
    if (ownershipAmountStr !== undefined) {
      const ownershipAmount = parseInt(ownershipAmountStr);
      if (isNaN(ownershipAmount) || ownershipAmount <= 0) {
        throw new Error('Ownership amount must be a positive integer');
      }
      result.ownershipAmount = ownershipAmount;
    }
  }

  return result;
};

// Helper function to parse URL query parameters
const parseQueryParams = (urlString: string): { addresses?: AddressAmount[] } => {
  try {
    // Extract addresses parameter from URL
    const addressesMatch = urlString.match(/[?&]addresses=([^&]+)/);
    if (!addressesMatch) {
      console.log('DEBUG - No addresses found in URL');
      return {};
    }

    // Split addresses string into individual address-amount pairs
    const addressesStr = decodeURIComponent(addressesMatch[1]);
    const addressesList = addressesStr.split(',');

    // Parse each address-amount pair
    const parsedAddresses = addressesList.map(addressStr => {
      try {
        return parseAddressData(addressStr);
      } catch (error) {
        console.log('ERROR - Failed to parse address data:', error.message);
        throw error;
      }
    });

    console.log('DEBUG - Final address amounts:', parsedAddresses);

    return { addresses: parsedAddresses };
  } catch (e) {
    log('Error parsing URL parameters', e);
    return {};
  }
};

export const SendRequestHandler: React.FC<Props> = ({ onSendRequest }) => {
  const { wallets, walletsInitialized } = useContext(StorageContext);
  const [showWalletSelect, setShowWalletSelect] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<AddressAmount[] | null>(null);

  useEffect(() => {
    if (!walletsInitialized) {
      log('Wallets not initialized yet');
      return;
    }

    // log('Setting up URL handler');
    // log(`Found ${wallets.length} wallets`);

    const handleURL = async (event: { url: string } | string) => {
      try {
        // Handle both event object and direct URL string
        const url = typeof event === 'string' ? event : event.url;
        
        if (!url) {
          return;
        }
        
        // Check if this is a send URL
        if (!url.toLowerCase().includes('bluewallet:send')) {
          return;
        }

        // Parse URL parameters
        const params = parseQueryParams(url);
        const addresses = params.addresses || [];

        if (addresses.length === 0) {
          log('No addresses provided in URL');
          return;
        }

        // Store the pending request and show wallet selection
        setPendingRequest(addresses);
        setShowWalletSelect(true);

      } catch (error) {
        log('Error handling URL', error);
        presentAlert({
          title: 'Error',
          message: 'Failed to process send request',
        });
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
  }, [walletsInitialized, wallets]);

  const handleWalletSelect = (selectedWallet: any) => {
    setShowWalletSelect(false);
    if (pendingRequest && pendingRequest.length > 0) {
      setTimeout(() => {
        // Create BIP21 URI for the first address
        const firstPair = pendingRequest[0];
        const uri = `bitcoin:${firstPair.address}${firstPair.amount ? `?amount=${firstPair.amount}` : ''}`;

        // Create base navigation params
        const params = {
          walletID: selectedWallet.getID(),
          uri: uri,
          txType: firstPair.txType || 'standard',
          supportRewardAddress: '',
          supportRewardAmount: 0,
          isEditable: true
        };

        // Add ownership specific parameters if txType is ownership
        if (firstPair.txType === 'ownership') {
          // Pass ownershipId as profile
          params.profile = firstPair.ownershipId;
          // Pass ownershipAmount as period if provided
          if (firstPair.ownershipAmount !== undefined) {
            params.period = String(firstPair.ownershipAmount);
          }
        }

        console.log('DEBUG - Navigation params:', params);

        navigate('SendDetailsRoot', {
          screen: 'SendDetails',
          params
        });

        // Add additional recipients after initial navigation
        if (pendingRequest.length > 1) {
          setTimeout(() => {
            pendingRequest.slice(1).forEach((pair) => {
              const nextUri = `bitcoin:${pair.address}${pair.amount ? `?amount=${pair.amount}` : ''}`;
              const nextParams = {
                uri: nextUri,
                txType: pair.txType || 'standard'
              };

              // Add ownership specific parameters if txType is ownership
              if (pair.txType === 'ownership') {
                nextParams.profile = pair.ownershipId;
                if (pair.ownershipAmount !== undefined) {
                  nextParams.period = String(pair.ownershipAmount);
                }
              }

              navigate('SendDetailsRoot', {
                screen: 'SendDetails',
                params: nextParams
              });
            });
          }, 200);
        }
      }, 100);

      if (onSendRequest) {
        onSendRequest(pendingRequest, selectedWallet);
      }
    }
    setPendingRequest(null);
  };

  return (
    <>
      {showWalletSelect && pendingRequest && (
        <WalletSelectDialog
          wallets={wallets}
          onSelect={handleWalletSelect}
          onCancel={() => {
            setShowWalletSelect(false);
            setPendingRequest(null);
          }}
        />
      )}
    </>
  );
};

export default SendRequestHandler;
