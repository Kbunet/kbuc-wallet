import { useFocusEffect, useRoute, useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerWalletWithProxy, getFcmToken } from '../../services/NotificationService';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Clipboard,
  Dimensions,
  findNodeHandle,
  FlatList,
  I18nManager,
  InteractionManager,
  LayoutAnimation,
  Modal,
  PixelRatio,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Button,
  TouchableOpacity,
  Animated,
  TextInput,
  Platform,
  StatusBar
} from 'react-native';
import { Icon } from '@rneui/themed';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import { isDesktop } from '../../blue_modules/environment';
import * as fs from '../../blue_modules/fs';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../blue_modules/hapticFeedback';
import { LightningCustodianWallet, MultisigHDWallet, WatchOnlyWallet } from '../../class';
import presentAlert, { AlertType } from '../../components/Alert';
import { FButton, FContainer } from '../../components/FloatButtons';
import { useTheme } from '../../components/themes';
import { TransactionListItem } from '../../components/TransactionListItem';
import TransactionsNavigationHeader, { actionKeys } from '../../components/TransactionsNavigationHeader';
import QRCodeComponent from '../../components/QRCodeComponent';
import { scanOtpQrHelper, scanQrHelper } from '../../helpers/scan-qr';
import { unlockWithBiometrics, useBiometrics } from '../../hooks/useBiometrics';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import loc from '../../loc';
import { Chain } from '../../models/bitcoinUnits';
import ActionSheet from '../ActionSheet';
import { useStorage } from '../../hooks/context/useStorage';
import WatchOnlyWarning from '../../components/WatchOnlyWarning';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';
import { Transaction, TWallet } from '../../class/wallets/types';
import getWalletTransactionsOptions from '../../navigation/helpers/getWalletTransactionsOptions';
import { presentWalletExportReminder } from '../../helpers/presentWalletExportReminder';
import selectWallet from '../../helpers/select-wallet';
import assert from 'assert';
import { BlueSpacing10 } from '../../BlueComponents';
import { Image } from 'react-native';
import { BlurView } from '@react-native-community/blur';
import { useWindowDimensions } from 'react-native';
import * as crypto from '../../custom/crypto';

const buttonFontSize =
  PixelRatio.roundToNearestPixel(Dimensions.get('window').width / 26) > 22
    ? 22
    : PixelRatio.roundToNearestPixel(Dimensions.get('window').width / 26);

type WalletTransactionsProps = NativeStackScreenProps<DetailViewStackParamList, 'WalletTransactions'>;

const WalletTransactions: React.FC<WalletTransactionsProps> = ({ route }) => {

  const { wallets, saveToDisk, setSelectedWalletID, isElectrumDisabled, setReloadTransactionsMenuActionFunction } = useStorage();
  const { isBiometricUseCapableAndEnabled } = useBiometrics();
  const [isLoading, setIsLoading] = useState(false);
  const { walletID } = route.params;
  const { name } = useRoute();
  const wallet = useMemo(() => wallets.find(w => w.getID() === walletID), [walletID, wallets]);
  const [limit, setLimit] = useState(15);
  const [pageSize] = useState(20);
  const navigation = useExtendedNavigation();
  const { setOptions, navigate } = navigation;
  const { colors } = useTheme();
  const walletActionButtonsRef = useRef<View>(null);

  const stylesHook = StyleSheet.create({
    listHeaderText: {
      color: colors.foregroundColor,
    },
    list: {
      backgroundColor: colors.background,
    },
  });

  useFocusEffect(
    useCallback(() => {
      setOptions(getWalletTransactionsOptions({ route }));
    }, [route, setOptions]),
  );

  const getTransactions = useCallback(
    (lmt = Infinity): Transaction[] => {
      if (!wallet) return [];
      const txs = wallet.getTransactions();
      txs.sort((a: { received: string }, b: { received: string }) => +new Date(b.received) - +new Date(a.received));
      return txs.slice(0, lmt);
    },
    [wallet],
  );

  const loadMoreTransactions = useCallback(() => {
    if (getTransactions(Infinity).length > limit) {
      setLimit(prev => prev + pageSize);
    }
  }, [getTransactions, limit, pageSize]);

  const refreshTransactions = useCallback(async () => {
    console.debug('refreshTransactions, ', wallet?.getLabel());
    if (!wallet || isElectrumDisabled || isLoading) return;
    setIsLoading(true);
    let smthChanged = false;
    try {
      await BlueElectrum.waitTillConnected();
      if (wallet.allowBIP47() && wallet.isBIP47Enabled() && 'fetchBIP47SenderPaymentCodes' in wallet) {
        await wallet.fetchBIP47SenderPaymentCodes();
      }
      const oldBalance = wallet.getBalance();
      await wallet.fetchBalance();
      if (oldBalance !== wallet.getBalance()) smthChanged = true;
      const oldTxLen = wallet.getTransactions().length;
      await wallet.fetchTransactions();
      if ('fetchPendingTransactions' in wallet) {
        await wallet.fetchPendingTransactions();
      }
      if ('fetchUserInvoices' in wallet) {
        await wallet.fetchUserInvoices();
      }
      if (oldTxLen !== wallet.getTransactions().length) smthChanged = true;
    } catch (err) {
      presentAlert({ message: (err as Error).message, type: AlertType.Toast });
    } finally {
      if (smthChanged) {
        await saveToDisk();
        setLimit(prev => prev + pageSize);
      }
      setIsLoading(false);
    }
  }, [wallet, isElectrumDisabled, isLoading, saveToDisk, pageSize]);

  useFocusEffect(
    useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        if (wallet && wallet.getLastTxFetch() === 0) {
          refreshTransactions();
        }
      });

      return () => task.cancel();
    }, [refreshTransactions, wallet]),
  );

  useEffect(() => {
    if (wallet) {
      setSelectedWalletID(walletID);
    }
  }, [wallet, setSelectedWalletID, walletID]);

  const isLightning = (): boolean => wallet?.chain === Chain.OFFCHAIN || false;

  const renderListFooterComponent = () => {
    // if not all txs rendered - display indicator
    return wallet && wallet.getTransactions().length > limit ? <ActivityIndicator style={styles.activityIndicator} /> : <View />;
  };

  const renderListHeaderComponent = () => {
    const style: any = {};
    if (!isDesktop) {
      // we need this button for testing
      style.opacity = 0;
      style.height = 1;
      style.width = 1;
    } else if (isLoading) {
      style.opacity = 0.5;
    } else {
      style.opacity = 1.0;
    }

    return (
      <View style={styles.flex}>
        <View style={styles.listHeaderTextRow}>
          <Text style={[styles.listHeaderText, stylesHook.listHeaderText]}>{loc.transactions.list_title}</Text>
        </View>
      </View>
    );
  };

  const navigateToSendScreen = (txType = "transfer", scannedTarget?: string, profile?: string, duration?: string, metaData?: { metaName?: string, metaLink?: string, metaAppData?: string }) => {
    console.debug('navigateToSendScreen:', `${profile ?? ""}, ${scannedTarget ?? ""}, ${txType ?? ""}`);
    navigate('SendDetailsRoot', {
      screen: 'SendDetails',
      params: {
        walletID,
        txType,
        scannedTarget,
        profile,
        duration,
        metaName: metaData?.metaName,
        metaLink: metaData?.metaLink,
        metaAppData: metaData?.metaAppData
      },
    });
  };

  const onWalletSelect = async (selectedWallet: TWallet) => {
    assert(wallet?.type === LightningCustodianWallet.type, `internal error, wallet is not ${LightningCustodianWallet.type}`);
    navigate('WalletTransactions', {
      walletType: wallet?.type,
      walletID,
      key: `WalletTransactions-${walletID}`,
    }); // navigating back to ln wallet screen

    // getting refill address, either cached or from the server:
    let toAddress;
    if (wallet?.refill_addressess.length > 0) {
      toAddress = wallet.refill_addressess[0];
    } else {
      try {
        await wallet?.fetchBtcAddress();
        toAddress = wallet?.refill_addressess[0];
      } catch (Err) {
        return presentAlert({ message: (Err as Error).message, type: AlertType.Toast });
      }
    }

    // navigating to pay screen where user can pay to refill address:
    navigate('SendDetailsRoot', {
      screen: 'SendDetails',
      params: {
        memo: loc.lnd.refill_lnd_balance,
        address: toAddress,
        walletID: selectedWallet.getID(),
      },
    });
  };

  const navigateToViewEditCosigners = () => {
    navigate('ViewEditMultisigCosignersRoot', {
      screen: 'ViewEditMultisigCosigners',
      params: {
        walletID,
      },
    });
  };

  const onManageFundsPressed = (id?: string) => {
    if (id === actionKeys.Refill) {
      const availableWallets = wallets.filter(item => item.chain === Chain.ONCHAIN && item.allowSend());
      if (availableWallets.length === 0) {
        presentAlert({ message: loc.lnd.refill_create });
      } else {
        selectWallet(navigate, name, Chain.ONCHAIN).then(onWalletSelect);
      }
    } else if (id === actionKeys.RefillWithExternalWallet) {
      navigate('ReceiveDetailsRoot', {
        screen: 'ReceiveDetails',
        params: {
          walletID,
        },
      });
    }
  };

  const _keyExtractor = (_item: any, index: number) => index.toString();

  const getItemLayout = (_: any, index: number) => ({
    length: 64,
    offset: 64 * index,
    index,
  });

  const renderItem = (item: { item: Transaction }) => (
    <TransactionListItem item={item.item} itemPriceUnit={wallet?.preferredBalanceUnit} walletID={walletID} />
  );

  const onBarCodeRead = useCallback(
    (ret?: { data?: any }) => {
      if (!isLoading) {
        setIsLoading(true);
        const params = {
          walletID,
          uri: ret?.data ? ret.data : ret,
        };
        if (wallet?.chain === Chain.ONCHAIN) {
          navigate('SendDetailsRoot', { screen: 'SendDetails', params });
        } else {
          navigate('ScanLndInvoiceRoot', { screen: 'ScanLndInvoice', params });
        }
        setIsLoading(false);
      }
    },
    [isLoading, walletID, wallet?.chain, navigate],
  );

  const choosePhoto = () => {
    fs.showImagePickerAndReadImage()
      .then(data => {
        if (data) {
          onBarCodeRead({ data });
        }
      })
      .catch(error => {
        console.log(error);
        triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
        presentAlert({ title: loc.errors.error, message: error.message });
      });
  };

  const pasteFromClipboard = async () => {
    onBarCodeRead({ data: await Clipboard.getString() });
  };

  const sendButtonPress = (txType="transfer", scannedData?: string, profile?: string, duration?: string, metaData?: { metaName?: string, metaLink?: string, metaAppData?: string }) => {
    if (wallet?.chain === Chain.OFFCHAIN) {
      return navigate('ScanLndInvoiceRoot', { screen: 'ScanLndInvoice', params: { walletID, txType } });
    }

    if (wallet?.type === WatchOnlyWallet.type && wallet.isHd() && !wallet.useWithHardwareWalletEnabled()) {
      return Alert.alert(
        loc.wallets.details_title,
        loc.transactions.enable_offline_signing,
        [
          {
            text: loc._.ok,
            onPress: async () => {
              wallet.setUseWithHardwareWalletEnabled(true);
              await saveToDisk();
              navigateToSendScreen(txType);
            },
            style: 'default',
          },
          { text: loc._.cancel, onPress: () => {}, style: 'cancel' },
        ],
        { cancelable: false },
      );
    }

    navigateToSendScreen(txType, scannedData, profile, duration, metaData);
  };

  const sendButtonLongPress = async () => {
    const isClipboardEmpty = (await Clipboard.getString()).trim().length === 0;
    const options = [loc._.cancel, loc.wallets.list_long_choose, loc.wallets.list_long_scan];
    const cancelButtonIndex = 0;

    if (!isClipboardEmpty) {
      options.push(loc.wallets.paste_from_clipboard);
    }

    ActionSheet.showActionSheetWithOptions(
      {
        title: loc.send.header,
        options,
        cancelButtonIndex,
        anchor: findNodeHandle(walletActionButtonsRef.current) ?? undefined,
      },
      async buttonIndex => {
        switch (buttonIndex) {
          case 0:
            break;
          case 1: {
            choosePhoto();
            break;
          }
          case 2: {
            const data = await scanQrHelper(name, true);
            if (data) {
              onBarCodeRead({ data });
            }
            break;
          }
          case 3:
            if (!isClipboardEmpty) {
              pasteFromClipboard();
            }
            break;
        }
      },
    );
  };

  useFocusEffect(
    useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        setReloadTransactionsMenuActionFunction(() => refreshTransactions);
      });
      return () => {
        task.cancel();
        setReloadTransactionsMenuActionFunction(() => {});
      };
    }, [setReloadTransactionsMenuActionFunction, refreshTransactions]),
  );

  
  

  const onScanButtonPressed = useCallback(() => {
    scanOtpQrHelper(name, walletID, "segwitBech32", true, undefined, false);
  }, [name]);

  const [isOtpModalVisible, setIsOtpModalVisible] = useState(false);
  const [decryptedOtp, setDecryptedOtp] = useState('');
  const [scannedTarget, setScannedTarget] = useState('');
  const [profile, setProfile] = useState('');
  const [duration, setDuration] = useState('');

  console.log('route.params', route.params);
  useEffect(() => {
    const scannedData = route.params?.scannedData;
    if (scannedData) {
      if (route.params?.isRps) {
        setScannedTarget(scannedData);
        console.log('scannedTarget', scannedTarget);
        sendButtonPress('reputation', scannedData);
        return;
      }
      // handle ownership transfer
      if (route.params?.isOwnership) {
        console.log('Handling ownership transfer:', {
          scannedTarget: scannedData,
          profile: route.params?.profile,
          duration: route.params?.duration
        });
        setScannedTarget(scannedData);
        setProfile(route.params?.profile);
        setDuration(route.params?.duration);
        sendButtonPress('ownership', scannedData, route.params?.profile, route.params?.duration);
        return;
      }
      // handle profile reclaim
      if (route.params?.isReclaim) {
        console.log('Handling profile reclaim:', {
          scannedTarget: scannedData,
          profile: route.params?.profile
        });
        setScannedTarget(scannedData);
        setProfile(route.params?.profile);
        sendButtonPress('reclaim', scannedData, route.params?.profile);
        return;
      }
      if (route.params?.isOTP) {
        console.log('Attempting to decrypt OTP:', scannedData);
        console.log('walletID:', walletID);
        const otp = wallet ? wallet.decryptOtp(scannedData) : false;
        console.log('Decrypted OTP result:', otp);
        if (otp) {
          console.log('Setting decrypted OTP:', otp);
          setDecryptedOtp(otp);
          setIsOtpModalVisible(true);
        } else {
          console.log('Failed to decrypt OTP');
        }
      }
    }
  }, [route.params?.scannedData, route.params?.scanTime]);

  // useEffect(() => {
  //   // console.log('params:', route.params);
  //   const scannedData = route.params?.scannedData;
  //   if (scannedData) {
  //     // here we decrypt otp
  //     console.log('scannedData', scannedData);
  //     const otp = wallet ? wallet.decryptOtp(scannedData) : false;
  //     onBarScanned(scannedData);
  //   }
  //   // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, [route.params?.scannedData]);

  const refreshProps = isDesktop || isElectrumDisabled ? {} : { refreshing: isLoading, onRefresh: refreshTransactions };

  const { height: windowHeight } = useWindowDimensions();
  const [isButtonPanelVisible, setIsButtonPanelVisible] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  
  // Tab state for transactions and profiles
  const [activeTab, setActiveTab] = useState('transactions'); // 'transactions' or 'profiles'
  
  // Function to handle tab switching with debug logging
  const handleTabSwitch = (tab: string) => {
    console.log('Switching to tab:', tab);
    setActiveTab(tab);
  }

  const HEADER_HEIGHT = Platform.OS === 'ios' ? 44 : 56; // Standard header heights
  const STATUS_BAR_HEIGHT = Platform.OS === 'ios' ? 20 : StatusBar.currentHeight || 0;
  const availableHeight = windowHeight - HEADER_HEIGHT - STATUS_BAR_HEIGHT;

  const toggleButtonPanel = () => {
    const toValue = isButtonPanelVisible ? 0 : 1;
    setIsButtonPanelVisible(!isButtonPanelVisible);
    
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue,
        useNativeDriver: true,
        friction: 8,
        tension: 40
      }),
      Animated.timing(fadeAnim, {
        toValue,
        duration: 200,
        useNativeDriver: true
      })
    ]).start();
  };

  const handleButtonPress = (buttonType: string, profileData?: any) => {
    switch (buttonType) {
      case 'receive':
        navigate('ReceiveDetailsRoot', {
          screen: 'ReceiveDetails',
          params: {
            walletID,
          },
        });
        break;
      case 'send':
        sendButtonPress('transfer');
        break;
      case 'sendrps':
        if (profileData && profileData.id) {
          // Pass the profile ID as the address for the reputation action
          const address = profileData.id;
          sendButtonPress('reputation', address);
        } else {
          sendButtonPress('reputation');
        }
        break;
      case 'join':
        sendButtonPress('join');
        break;
      case 'leave':
        sendButtonPress('leave');
        break;
      case 'transfer':
        if (profileData && profileData.id) {
          // Pass the profile ID as the address for the ownership transfer action
          const address = profileData.id;
          sendButtonPress('ownership', address);
        } else {
          sendButtonPress('ownership');
        }
        break;
      case 'reclaim':
        sendButtonPress('reclaim');
        break;
      case 'metadata':
        if (profileData) {
          // Pass profile data if available to pre-populate the metadata fields
          // Also pass the profile ID as the address
          const address = profileData.id;
          sendButtonPress('metadata', address, profileData.id, undefined, {
            metaName: profileData.name || '',
            metaLink: profileData.link || '',
            metaAppData: profileData.appData || ''
          });
        } else {
          sendButtonPress('metadata');
        }
        break;
      case 'domain':
        sendButtonPress('domain');
        break;
      case 'bid':
        sendButtonPress('bid');
        break;
      case 'offer':
        if (profileData && profileData.id) {
          // Pass the profile ID as the address for the offer action
          const address = profileData.id;
          sendButtonPress('offer', address);
        } else {
          sendButtonPress('offer');
        }
        break;
      case 'ensurance':
        sendButtonPress('ensurance');
        break;
      case 'increaseReputation':
        sendButtonPress('increaseReputation');
        break;
      case 'releaseEnsurance':
        sendButtonPress('releaseEnsurance');
        break;
      case 'vote':
        sendButtonPress('vote');
        break;
      case 'getkey':
        handleGetKeyPress();
        break;
      case 'scan':
        onScanButtonPressed();
        break;
      case 'paste':
        handlePasteButtonPress();
        break;
    }
  };

  const [isPasteModalVisible, setIsPasteModalVisible] = useState(false);
  const [encryptedJson, setEncryptedJson] = useState('');
  const [decryptedOTP, setDecryptedOTP] = useState('');

  const handlePasteButtonPress = async () => {
    setIsPasteModalVisible(true);
    toggleButtonPanel();
    
    // Try to get content from clipboard
    try {
      const clipboardContent = await Clipboard.getString();
      if (clipboardContent) {
        setEncryptedJson(clipboardContent);
      }
    } catch (error) {
      console.log('Failed to paste from clipboard:', error);
    }
  };

  const handleDecryptOTP = async () => {
    try {
      // TODO: Implement actual decryption logic
      const encryptedOtp = JSON.parse(encryptedJson);
      console.log('encryptedOtp', encryptedOtp.encryptedMessage);
      const decrypted = wallet ? wallet.decryptOtp(encryptedOtp) : "";
      setDecryptedOTP(decrypted);
    } catch (error) {
      console.error('Error decrypting OTP:', error);
      Alert.alert('Error', 'Failed to decrypt OTP. Please check your input.');
    }
  };

  const handleCopyOTP = async () => {
    if (decryptedOTP) {
      await Clipboard.setString(decryptedOTP);
      triggerHapticFeedback(HapticFeedbackTypes.Selection);
      setDecryptedOTP('Copied to clipboard'); // Temporary feedback
      setTimeout(() => {
        setDecryptedOTP(decryptedOTP || '');
      }, 1000);
    }
  };

  const handleGetKeyPress = () => {
    if (wallet) {
      const publicKey = wallet.getPubKey();
      if (publicKey) {
        setWalletPubKey(publicKey);
        setShowPubKeyHash(false); // Reset to show public key by default
      }
    }
    setIsKeyModalVisible(true);
    toggleButtonPanel();
  };

  const [walletPubKey, setWalletPubKey] = useState("");
  const [isKeyModalVisible, setIsKeyModalVisible] = useState(false);
  const [showPubKeyHash, setShowPubKeyHash] = useState(false); // New state to toggle between pubkey and hash160
  const [hasCopiedPublicKey, setHasCopiedPublicKey] = useState(false);
  const [hasCopiedProfileId, setHasCopiedProfileId] = useState(false);
  const [displayedText, setDisplayedText] = useState("");
  
  // Profiles state
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(false);
  const [profilesError, setProfilesError] = useState('');
  const [walletProfiles, setWalletProfiles] = useState<any[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<any>(null);
  const [isProfileModalVisible, setIsProfileModalVisible] = useState(false);

  const toggleKeyDisplay = () => {
    if (wallet && walletPubKey) {
      setShowPubKeyHash(!showPubKeyHash);
    }
  };

  const getPublicKey = () => {
    return walletPubKey || '';
  };


  const [currentProfileId, setCurrentProfileId] = useState('');
  const getProfileId = () => {
    try {
      const pubkey = wallet?.getPubKey();
      // Convert hex string to buffer for hash160
      const buffer = Buffer.from(pubkey, 'hex');
      const hash = crypto.hash160(buffer);

      return hash.toString('hex');
    } catch (error) {
      console.log('Error calculating hash160:', error);
      return 'Error calculating hash';
    }
  };
  
  // Function to fetch profiles using the wallet's public key hash
  const fetchWalletProfiles = async () => {
    if (!wallet) return;
    
    setIsLoadingProfiles(true);
    setProfilesError('');
    
    try {
      const profileId = getProfileId();
      console.log('Fetching profiles for:', profileId);
      
      setCurrentProfileId(profileId);
      
      if (!profileId) {
        setProfilesError('Could not generate profile ID');
        return;
      }
      
      const result = await BlueElectrum.verifyProfile(profileId);
      console.log('Profiles API Response:', JSON.stringify(result, null, 2));
      
      if (result) {
        // Check if the profile exists in the root level
        if (result.owner) {
          // Add the main profile to the list if it exists
          const mainProfile = {
            id: profileId,
            creator: result.creator || '',
            owner: result.owner || '',
            signer: result.signer || '',
            name: result.name || '',
            link: result.link || '',
            appData: result.appData || '',
            rps: result.rps || 0,
            generatedRPs: result.generatedRPs || 0,
            isRented: result.isRented || false,
            tenant: result.tenant || '',
            rentedAt: result.rentedAt || 0,
            duration: result.duration || 0,
            isCandidate: result.isCandidate || false,
            isBanned: result.isBanned || false,
            contribution: result.contribution || 0,
            isDomain: result.isDomain || false,
            offeredAt: result.offeredAt || 0,
            bidAmount: result.bidAmount || 0,
            buyer: result.buyer || '',
            balance: result.balance || 0,
            bidTarget: result.bidTarget || ''
          };
          
          // Get owned profiles from the result
          const ownedProfiles = Array.isArray(result.ownedProfiles) ? result.ownedProfiles : [];
          
          // Combine main profile with owned profiles
          setWalletProfiles([mainProfile, ...ownedProfiles]);
        } 
        // If there's no main profile, just use owned profiles
        else if (result.ownedProfiles?.length > 0) {
          setWalletProfiles(result.ownedProfiles);
        }
        // No profiles found
        else {
          setWalletProfiles([]);
          setProfilesError('No profiles found for this wallet');
        }
      } else {
        setWalletProfiles([]);
        setProfilesError('Failed to fetch profiles');
      }
    } catch (error) {
      console.error('Error fetching profiles:', error);
      setProfilesError('Error fetching profiles: ' + (error as Error).message);
      setWalletProfiles([]);
    } finally {
      setIsLoadingProfiles(false);
    }
  };
  
  // Function to open profile details modal
  const openProfileDetails = (profile: any) => {
    setSelectedProfile(profile);
    setIsProfileModalVisible(true);
  };
  
  // Function to close profile details modal
  const closeProfileDetails = () => {
    setIsProfileModalVisible(false);
    setSelectedProfile(null);
  };

  // For QR code display
  const getDisplayValue = () => {
    return getPublicKey();
  };
  
  // Format profile ID for display (truncate middle)
  const formatProfileId = (id: string) => {
    if (!id) return '';
    return id.length > 10 ? `${id.substring(0, 6)}...${id.substring(id.length - 4)}` : id;
  };

  // Format large numbers with K, M, B suffixes
  const formatNumberWithSuffix = (num: number | string | undefined) => {
    if (num === undefined) return '0';
    
    const value = typeof num === 'string' ? parseFloat(num) : num;
    
    if (isNaN(value)) return '0';
    
    if (value < 1000) return value.toString();
    
    const tier = Math.floor(Math.log10(value) / 3);
    const suffix = ['', 'K', 'M', 'B', 'T'][tier] || '';
    const scale = Math.pow(10, tier * 3);
    
    // Format with one decimal place and remove trailing .0
    const formatted = (value / scale).toFixed(1).replace(/\.0$/, '');
    
    return formatted + suffix;
  };
  
  // Load profiles when tab changes to profiles
  useEffect(() => {
    // if (activeTab === 'profiles' && walletPubKey) {
      fetchWalletProfiles();
    // }
  }, [wallet]);

  const handleCopyPublicKey = async () => {
    const valueToCopy = getDisplayValue();
    if (valueToCopy) {
      setHasCopiedText(true);
      await Clipboard.setString(valueToCopy);
      triggerHapticFeedback(HapticFeedbackTypes.Selection);
      
      const currentText = displayedText || valueToCopy;
      setDisplayedText(loc.wallets.xpub_copiedToClipboard);
      
      setTimeout(() => {
        setHasCopiedText(false);
        setDisplayedText(currentText);
      }, 1000);
    }
  };

  return (
    <View style={styles.flex}>
      {wallet && (
        <TransactionsNavigationHeader
          wallet={wallet}
          onWalletUnitChange={async selectedUnit => {
            wallet.preferredBalanceUnit = selectedUnit;
            await saveToDisk();
          }}
          unit={wallet.preferredBalanceUnit}
          onWalletBalanceVisibilityChange={async isShouldBeVisible => {
            const isBiometricsEnabled = await isBiometricUseCapableAndEnabled();
            if (wallet?.hideBalance && isBiometricsEnabled) {
              const unlocked = await unlockWithBiometrics();
              if (!unlocked) throw new Error('Biometrics failed');
            }
            wallet!.hideBalance = isShouldBeVisible;
            await saveToDisk();
          }}
          onManageFundsPressed={id => {
            if (wallet?.type === MultisigHDWallet.type) {
              navigateToViewEditCosigners();
            } else if (wallet?.type === LightningCustodianWallet.type) {
              if (wallet.getUserHasSavedExport()) {
                if (!id) return;
                onManageFundsPressed(id);
              } else {
                presentWalletExportReminder()
                  .then(async () => {
                    if (!id) return;
                    wallet!.setUserHasSavedExport(true);
                    await saveToDisk();
                    onManageFundsPressed(id);
                  })
                  .catch(() => {
                    navigate('WalletExportRoot', {
                      screen: 'WalletExport',
                      params: {
                        walletID,
                      },
                    });
                  });
              }
            }
          }}
        />
      )}
      {/* Tab navigation - moved outside the list container to avoid touch event issues */}
      <View style={styles.tabContainer}>
        <TouchableOpacity 
          style={[styles.tabButton, activeTab === 'transactions' ? [styles.activeTab, { borderBottomColor: colors.buttonAlternativeTextColor }] : null]} 
          onPress={() => {
            console.log('Transaction tab pressed');
            handleTabSwitch('transactions');
            triggerHapticFeedback(HapticFeedbackTypes.Selection);
          }}
          activeOpacity={0.7}
          testID="transactionsTab"
        >
          <View style={styles.tabButtonContent}>
            <Text style={[styles.tabText, activeTab === 'transactions' ? [styles.activeTabText, { color: colors.buttonAlternativeTextColor }] : { color: colors.foregroundColor }]}>{loc.wallets.transactions_tab}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.tabButton, activeTab === 'profiles' ? [styles.activeTab, { borderBottomColor: colors.buttonAlternativeTextColor }] : null]} 
          onPress={() => {
            console.log('Profiles tab pressed');
            handleTabSwitch('profiles');
            triggerHapticFeedback(HapticFeedbackTypes.Selection);
          }}
          activeOpacity={0.7}
          testID="profilesTab"
        >
          <View style={styles.tabButtonContent}>
            <Text style={[styles.tabText, activeTab === 'profiles' ? [styles.activeTabText, { color: colors.buttonAlternativeTextColor }] : { color: colors.foregroundColor }]}>{loc.wallets.profiles_tab}</Text>
          </View>
        </TouchableOpacity>
      </View>

      <View style={[styles.list, stylesHook.list]}>
        {wallet?.type === WatchOnlyWallet.type && wallet.isWatchOnlyWarningVisible && (
          <WatchOnlyWarning
            handleDismiss={() => {
              wallet.isWatchOnlyWarningVisible = false;
              LayoutAnimation.configureNext(LayoutAnimation.Presets.linear);
              saveToDisk();
            }}
          />
        )}
        
        {/* Transactions Tab Content */}
        {activeTab === 'transactions' && (
          <FlatList
          getItemLayout={getItemLayout}
          updateCellsBatchingPeriod={30}
          ListHeaderComponent={renderListHeaderComponent}
          onEndReachedThreshold={0.3}
          onEndReached={loadMoreTransactions}
          ListFooterComponent={renderListFooterComponent}
          ListEmptyComponent={
            <ScrollView style={styles.flex} contentContainerStyle={styles.scrollViewContent}>
              <Text numberOfLines={0} style={styles.emptyTxs}>
                {(isLightning() && loc.wallets.list_empty_txs1_lightning) || loc.wallets.list_empty_txs1}
              </Text>
              {isLightning() && <Text style={styles.emptyTxsLightning}>{loc.wallets.list_empty_txs2_lightning}</Text>}
            </ScrollView>
          }
          {...refreshProps}
          data={getTransactions(limit)}
          extraData={wallet}
          keyExtractor={_keyExtractor}
          renderItem={renderItem}
          initialNumToRender={10}
          removeClippedSubviews
          contentInset={{ top: 0, left: 0, bottom: 90, right: 0 }}
          maxToRenderPerBatch={15}
          windowSize={25}
        />)}
        
        {/* Profiles Tab Content */}
        {activeTab === 'profiles' && (
          <ScrollView style={styles.profilesContainer} contentContainerStyle={styles.profilesContent}>
            
            {/* Wallet Profiles List */}
            {/* <View style={styles.profileCard}> */}
              <Text style={styles.profileTitle}>{loc.wallets.my_profiles}</Text>
              
              {isLoadingProfiles ? (
                <ActivityIndicator size="large" color={colors.buttonBackgroundColor} style={styles.profilesLoader} />
              ) : profilesError ? (
                <View style={styles.profilesErrorContainer}>
                  <Text style={styles.profilesErrorText}>{profilesError}</Text>
                  <TouchableOpacity 
                    style={[styles.profileButton, { backgroundColor: colors.buttonBackgroundColor, marginTop: 16 }]}
                    onPress={fetchWalletProfiles}
                  >
                    <Text style={[styles.profileButtonText, { color: colors.buttonAlternativeTextColor }]}>{loc.wallets.try_again}</Text>
                  </TouchableOpacity>
                </View>
              ) : walletProfiles.length === 0 ? (
                <View style={styles.profilesEmptyContainer}>
                  <Text style={styles.profilesEmptyText}>{loc.wallets.no_profiles_found}</Text>
                </View>
              ) : (
                <View style={styles.profilesList}>
                  {walletProfiles.map((profile, index) => (
                    <TouchableOpacity 
                      key={profile.id || index} 
                      style={styles.profileListItem}
                      onPress={() => openProfileDetails(profile)}
                    >
                      <View style={styles.profileListItemLeft}>
                        <Text style={styles.profileListItemId}>{formatProfileId(profile.id)}</Text>
                        {profile.name && <Text style={styles.profileListItemName}>{profile.name}</Text>}
                        {profile.id == currentProfileId && <View style={styles.ownerBadge}><Text style={styles.ownerBadgeText}>{loc.wallets.owner}</Text></View>}
                        {profile.isDomain && <View style={styles.domainBadge}><Text style={styles.domainBadgeText}>{loc.wallets.profile_domain_badge}</Text></View>}
                        {profile.id != currentProfileId && !profile.isDomain && <View style={styles.nftBadge}><Text style={styles.nftBadgeText}>{loc.wallets.nft}</Text></View>}
                      </View>
                      <View style={styles.profileListItemRight}>
                        <View style={styles.profileListItemStat}>
                          <Icon name="star" size={14} type="font-awesome" color={colors.foregroundColor} />
                          <Text style={styles.profileListItemStatText}>{formatNumberWithSuffix(profile.rps)}</Text>
                        </View>
                        <View style={styles.profileListItemStat}>
                          <Icon name="money" size={14} type="font-awesome" color={colors.foregroundColor} />
                          <Text style={styles.profileListItemStatText}>{formatNumberWithSuffix(profile.balance)}</Text>
                        </View>
                        <Icon name="chevron-right" size={16} type="font-awesome" color={colors.foregroundColor} />
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            {/* </View> */}

          </ScrollView>
        )}
      </View>

      <SafeAreaView style={isButtonPanelVisible ? styles.safeArea : { display: 'none' }}>
        <View style={styles.buttonPanelContainer}>
          {isButtonPanelVisible && (
            <Animated.View 
              style={[
                styles.blurContainer,
                {
                  opacity: fadeAnim,
                  height: availableHeight,
                }
              ]}>
            </Animated.View>
          )}
          
          <Animated.View 
            style={[
              styles.buttonPanel,
              {
                opacity: fadeAnim,
                transform: [{
                  translateY: slideAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [availableHeight, 0]
                  })
                }],
                height: availableHeight,
                backgroundColor: colors.elevated,
              }
            ]}>
            <ScrollView 
              style={styles.buttonPanelScroll} 
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.buttonPanelContent}>
              <View style={styles.buttonGroup}>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('getkey')}>
                  <View style={styles.iconContainer}>
                    <Icon name="id-card" size={22} type="font-awesome" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>{loc.wallets.get_id}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('receive')}>
                  <View style={styles.iconContainer}>
                    <Icon name="download" size={24} type="font-awesome-5" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>{loc.wallets.show_address}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('send')}>
                  <View style={styles.iconContainer}>
                    <Icon name="paper-plane" size={22} type="font-awesome" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>{loc.wallets.send_coins}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('sendrps')}>
                  <View style={styles.iconContainer}>
                    <Icon name="star" size={24} type="font-awesome" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>{loc.wallets.buy_reputation}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('releaseEnsurance')}>
                  <View style={styles.iconContainer}>
                    <Icon name="attach-money" size={22} type="material" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>{loc.wallets.liquidate_balance}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('increaseReputation')}>
                  <View style={styles.iconContainer}>
                    <Icon name="arrow-circle-up" size={22} type="font-awesome" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>{loc.wallets.increase_reputation}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('ensurance')}>
                  <View style={styles.iconContainer}>
                    <Icon name="trending-up" size={22} type="material" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>{loc.wallets.increase_balance}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('join')}>
                  <View style={styles.iconContainer}>
                    <Icon name="handshake" size={20} type="font-awesome-5" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>{loc.wallets.join_pool}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('leave')}>
                  <View style={styles.iconContainer}>
                    <Icon name="sign-out-alt" size={24} type="font-awesome-5" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>{loc.wallets.leave_pool}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.separator} />

              <View style={styles.buttonGroup}>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('metadata')}>
                  <View style={styles.iconContainer}>
                    <Icon name="edit" size={24} type="font-awesome" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>{loc.wallets.register_update_nft}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('domain')}>
                  <View style={styles.iconContainer}>
                    <Icon name="globe" size={24} type="font-awesome" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>{loc.wallets.register_update_domain}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('transfer')}>
                  <View style={styles.iconContainer}>
                    <Icon name="exchange-alt" size={24} type="font-awesome-5" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>{loc.wallets.transfer_ownership}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('reclaim')}>
                  <View style={styles.iconContainer}>
                    <Icon name="undo" size={24} type="font-awesome" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>{loc.wallets.reclaim_profile}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('offer')}>
                  <View style={styles.iconContainer}>
                    <Icon name="tag" size={24} type="font-awesome" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>{loc.wallets.sell_in_auction}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('bid')}>
                  <View style={styles.iconContainer}>
                    <Icon name="gavel" size={24} type="font-awesome" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>{loc.wallets.make_bid}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('vote')}>
                  <View style={styles.iconContainer}>
                    <Icon name="check-square" size={22} type="font-awesome" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>{loc.wallets.cast_vote}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.separator} />

              <View style={styles.buttonGroup}>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('scan')}>
                  <View style={styles.iconContainer}>
                    <Icon name="qrcode" size={22} type="font-awesome" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>{loc.wallets.scan}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('paste')}>
                  <View style={styles.iconContainer}>
                    <Icon name="paste" size={22} type="font-awesome" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>{loc.wallets.paste}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </Animated.View>

        </View>
      </SafeAreaView>

      <View style={styles.fabContainer}>
          <TouchableOpacity 
                style={styles.fab}
                onPress={toggleButtonPanel}>
                <Icon 
                  name={isButtonPanelVisible ? "chevron-down" : "chevron-up"} 
                  size={24} 
                  type="font-awesome" 
                  color="#FFFFFF" 
                />
          </TouchableOpacity>
      </View>

      <Modal
        animationType="slide"
        transparent={true}
        visible={isOtpModalVisible}
        onRequestClose={() => {
          setIsOtpModalVisible(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.elevated }]}>
            <Text style={[styles.modalText, { color: colors.foregroundColor }]}>
              {loc.wallets.decrypted_otp}: {decryptedOtp}
            </Text>
            <TouchableOpacity
              style={styles.modalButton}
              onPress={() => {
                setIsOtpModalVisible(false);
              }}
            >
              <Text style={styles.modalButtonText}>{loc.wallets.close}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        transparent={true}
        visible={isPasteModalVisible}
        onRequestClose={() => setIsPasteModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{loc.wallets.paste_encrypted_otp}</Text>
            
            <TextInput
              style={styles.jsonInput}
              multiline
              numberOfLines={4}
              placeholder={loc.wallets.paste_json_here}
              value={encryptedJson}
              onChangeText={setEncryptedJson}
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              contextMenuHidden={false}
            />

            <View style={{
              marginVertical: 16,
              width: '100%',
              alignItems: I18nManager.isRTL ? 'flex-end' : 'flex-start',
            }}>
              <Text style={{
                fontSize: 16,
                fontWeight: '600',
                marginBottom: 8,
                textAlign: I18nManager.isRTL ? 'right' : 'left',
                width: '100%',
              }}>{loc.wallets.decrypted_otp}:</Text>
              <View style={{
                backgroundColor: '#F5F5F5',
                borderRadius: 8,
                padding: 12,
                minHeight: 48,
                justifyContent: 'center',
                width: '100%',
              }}>
                <Text style={{
                  fontSize: 16,
                  color: '#333',
                  textAlign: I18nManager.isRTL ? 'right' : 'left',
                }}>{decryptedOTP}</Text>
              </View>
            </View>

            <View style={{
              flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row',
              justifyContent: 'space-between',
              width: '100%',
              marginTop: 20,
            }}>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: '#34C759' }]}
                onPress={handleDecryptOTP}
              >
                <Text style={styles.modalButtonText}>{loc.wallets.decrypt}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: '#0070FF' }]}
                onPress={handleCopyOTP}
              >
                <Text style={styles.modalButtonText}>{loc.wallets.copy}</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: '#FF3B30' }]}
                onPress={() => {
                  setIsPasteModalVisible(false);
                  setEncryptedJson('');
                  setDecryptedOTP('');
                }}
              >
                <Text style={styles.modalButtonText}>{loc.wallets.close}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        transparent={true}
        visible={isKeyModalVisible}
        onRequestClose={() => setIsKeyModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{loc.wallets.your_wallet_id}</Text>
            
            <QRCodeComponent 
              value={getDisplayValue()} 
              size={250} 
              isLogoRendered={true}
              ecl="H"
            />

            <View style={{
              marginBottom: 20,
              width: '100%',
            }}>
              <Text style={{
                fontSize: 16,
                fontWeight: '600',
                color: '#444',
                marginBottom: 8,
                textAlign: I18nManager.isRTL ? 'right' : 'left',
              }}>{loc.wallets.public_key}:</Text>
              <TouchableOpacity
                onPress={() => {
                  Clipboard.setString(getPublicKey());
                  setHasCopiedPublicKey(true);
                  triggerHapticFeedback(HapticFeedbackTypes.Selection);
                  setTimeout(() => setHasCopiedPublicKey(false), 1500);
                }}
                disabled={hasCopiedPublicKey}
                style={styles.copyTouchable}
                testID="CopyPublicKeyText"
              >
                <Text 
                  style={styles.keyValue} 
                  numberOfLines={2} 
                  ellipsizeMode="middle"
                >
                  {hasCopiedPublicKey ? loc.wallets.xpub_copiedToClipboard : getPublicKey()}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={{
              marginBottom: 20,
              width: '100%',
              marginTop: 16,
            }}>
              <Text style={{
                fontSize: 16,
                fontWeight: '600',
                color: '#444',
                marginBottom: 8,
                textAlign: I18nManager.isRTL ? 'right' : 'left',
              }}>{loc.wallets.profile_id}:</Text>
              <TouchableOpacity
                onPress={() => {
                  Clipboard.setString(getProfileId());
                  setHasCopiedProfileId(true);
                  triggerHapticFeedback(HapticFeedbackTypes.Selection);
                  setTimeout(() => setHasCopiedProfileId(false), 1500);
                }}
                disabled={hasCopiedProfileId}
                style={styles.copyTouchable}
                testID="CopyProfileIdText"
              >
                <Text 
                  style={styles.keyValue} 
                  numberOfLines={2} 
                  ellipsizeMode="middle"
                >
                  {hasCopiedProfileId ? loc.wallets.xpub_copiedToClipboard : getProfileId()}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={{
              flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row',
              justifyContent: 'space-between',
              width: '100%',
              marginTop: 20,
            }}>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: '#FF3B30', width: '100%' }]}
                onPress={() => setIsKeyModalVisible(false)}
              >
                <Text style={styles.modalButtonText}>{loc.wallets.close}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Profile Details Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={isProfileModalVisible}
        onRequestClose={closeProfileDetails}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.profileModalContent, { backgroundColor: colors.elevated }]}>
            <View style={styles.profileModalHeader}>
              <Text style={[styles.profileModalTitle, { color: colors.foregroundColor }]}>
                {loc.wallets.profile_details}
              </Text>
              <TouchableOpacity onPress={closeProfileDetails}>
                <Icon name="times" size={24} type="font-awesome-5" color={colors.foregroundColor} />
              </TouchableOpacity>
            </View>

            {selectedProfile && (
              <ScrollView style={styles.profileModalScroll}>
                {/* Profile ID */}
                <View style={styles.profileDetailItem}>
                  <Text style={[styles.profileDetailLabel, { color: colors.foregroundColor }]}>{loc.wallets.profile_id}:</Text>
                  <TouchableOpacity 
                    style={styles.profileDetailValueContainer}
                    onPress={() => {
                      Clipboard.setString(selectedProfile.id);
                      triggerHapticFeedback(HapticFeedbackTypes.Selection);
                      presentAlert({
                        message: `${loc.wallets.profile_id} ${loc.wallets.xpub_copiedToClipboard}`,
                        type: AlertType.Toast
                      });
                    }}
                  >
                    <Text 
                      style={[styles.profileDetailValue, { color: colors.foregroundColor }]} 
                      numberOfLines={1} 
                      ellipsizeMode="middle"
                    >
                      {selectedProfile.id}
                    </Text>
                    <Icon name="copy" size={16} type="font-awesome" color={colors.foregroundColor} />
                  </TouchableOpacity>
                </View>

                {/* Profile Type */}
                <View style={styles.profileDetailItem}>
                  <Text style={[styles.profileDetailLabel, { color: colors.foregroundColor }]}>{loc.wallets.profile_type}:</Text>
                  <Text style={[styles.profileDetailValue, { color: colors.foregroundColor }]}>
                    {selectedProfile.isDomain ? loc.wallets.domain : loc.wallets.profile}
                  </Text>
                </View>

                {/* Profile Name */}
                {selectedProfile.name && (
                  <View style={styles.profileDetailItem}>
                    <Text style={[styles.profileDetailLabel, { color: colors.foregroundColor }]}>{loc.wallets.profile_name}:</Text>
                    <Text style={[styles.profileDetailValue, { color: colors.foregroundColor }]}>{selectedProfile.name}</Text>
                  </View>
                )}

                {/* Profile Link */}
                {selectedProfile.link && (
                  <View style={styles.profileDetailItem}>
                    <Text style={[styles.profileDetailLabel, { color: colors.foregroundColor }]}>{loc.wallets.profile_link}:</Text>
                    <Text style={[styles.profileDetailValue, { color: colors.foregroundColor }]}>{selectedProfile.link}</Text>
                  </View>
                )}

                {/* Reputation */}
                <View style={styles.profileDetailItem}>
                  <Text style={[styles.profileDetailLabel, { color: colors.foregroundColor }]}>{loc.wallets.profile_reputation}:</Text>
                  <Text style={[styles.profileDetailValue, { color: colors.foregroundColor }]}>{selectedProfile.rps || 0}</Text>
                </View>

                {/* Balance */}
                <View style={styles.profileDetailItem}>
                  <Text style={[styles.profileDetailLabel, { color: colors.foregroundColor }]}>{loc.wallets.profile_balance}:</Text>
                  <Text style={[styles.profileDetailValue, { color: colors.foregroundColor }]}>{selectedProfile.balance || 0}</Text>
                </View>

                {/* Owner */}
                {selectedProfile.owner && (
                  <View style={styles.profileDetailItem}>
                    <Text style={[styles.profileDetailLabel, { color: colors.foregroundColor }]}>{loc.wallets.profile_owner}:</Text>
                    <Text 
                      style={[styles.profileDetailValue, { color: colors.foregroundColor }]}
                      numberOfLines={1}
                      ellipsizeMode="middle"
                    >
                      {selectedProfile.owner}
                    </Text>
                  </View>
                )}

                {/* Rental Status */}
                {selectedProfile.isRented && (
                  <>
                    <View style={styles.profileDetailItem}>
                      <Text style={[styles.profileDetailLabel, { color: colors.foregroundColor }]}>{loc.wallets.rental_status}:</Text>
                      <Text style={[styles.profileDetailValue, { color: colors.foregroundColor }]}>{loc.wallets.rented}</Text>
                    </View>
                    {selectedProfile.tenant && (
                      <View style={styles.profileDetailItem}>
                        <Text style={[styles.profileDetailLabel, { color: colors.foregroundColor }]}>{loc.wallets.tenant}:</Text>
                        <Text 
                          style={[styles.profileDetailValue, { color: colors.foregroundColor }]}
                          numberOfLines={1}
                          ellipsizeMode="middle"
                        >
                          {selectedProfile.tenant}
                        </Text>
                      </View>
                    )}
                  </>
                )}

                {/* Actions */}
                {selectedProfile.id != currentProfileId && (
                  <View style={styles.profileModalActions}>
                    <Text style={[styles.profileModalSectionTitle, { color: colors.foregroundColor }]}>{loc.wallets.profile_actions}</Text>
                    
                    <TouchableOpacity 
                      style={[styles.profileModalButton, { backgroundColor: colors.buttonBackgroundColor }]}
                    onPress={() => {
                      closeProfileDetails();
                      // Pass the selected profile data to pre-populate metadata fields
                      handleButtonPress('metadata', selectedProfile);
                    }}
                  >
                    <Text style={[styles.profileModalButtonText, { color: colors.buttonAlternativeTextColor }]}>{loc.wallets.update_metadata}</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity 
                    style={[styles.profileModalButton, { backgroundColor: colors.buttonBackgroundColor }]}
                    onPress={() => {
                      closeProfileDetails();
                      // Pass the profile ID for the reputation increase action
                      handleButtonPress('sendrps', { id: selectedProfile.id });
                    }}
                  >
                    <Text style={[styles.profileModalButtonText, { color: colors.buttonAlternativeTextColor }]}>{loc.wallets.increase_reputation}</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity 
                    style={[styles.profileModalButton, { backgroundColor: colors.buttonBackgroundColor }]}
                    onPress={() => {
                      closeProfileDetails();
                      // Pass the profile ID for the transfer ownership action
                      handleButtonPress('transfer', { id: selectedProfile.id });
                    }}
                  >
                    <Text style={[styles.profileModalButtonText, { color: colors.buttonAlternativeTextColor }]}>{loc.wallets.transfer_ownership}</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity 
                    style={[styles.profileModalButton, { backgroundColor: colors.buttonBackgroundColor }]}
                    onPress={() => {
                      closeProfileDetails();
                      // Pass the profile ID for the make offer action
                      handleButtonPress('offer', { id: selectedProfile.id });
                    }}
                  >
                    <Text style={[styles.profileModalButtonText, { color: colors.buttonAlternativeTextColor }]}>{loc.wallets.make_offer}</Text>
                  </TouchableOpacity>
                  </View>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );

};

export default WalletTransactions;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollViewContent: { flex: 1, justifyContent: 'center', paddingHorizontal: 16, paddingBottom: 40 },
  activityIndicator: { marginVertical: 20 },
  listHeaderTextRow: { flex: 1, margin: 16, flexDirection: 'row', justifyContent: 'space-between' },
  listHeaderText: { marginTop: 8, marginBottom: 8, fontWeight: 'bold', fontSize: 24 },
  list: { flex: 1 },
  emptyTxs: { fontSize: 18, color: '#9aa0aa', textAlign: 'center', marginVertical: 16 },
  emptyTxsLightning: { fontSize: 18, color: '#9aa0aa', textAlign: 'center', fontWeight: '600' },
  sendIcon: { transform: [{ rotate: I18nManager.isRTL ? '-225deg' : '225deg' }] },
  receiveIcon: { transform: [{ rotate: I18nManager.isRTL ? '45deg' : '-45deg' }] },
  buttonGroup: {
    width: '100%',
    flexDirection: 'column',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  separator: {
    width: '90%',
    height: 1,
    backgroundColor: '#E0E0E0',
    marginVertical: 8,
    alignSelf: 'center',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    width: '100%',
  },
  iconContainer: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 24,
  },
  buttonText: {
    fontSize: 16,
    marginLeft: 15,
    fontWeight: '500',
  },
  buttonPanel: {
    zIndex: 3000000,
    borderRadius: 16,
    padding: 8,
    width: '85%',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  blurContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  buttonPanelScroll: {
    flex: 1,
  },
  buttonPanelContent: {
    flexGrow: 1,
    justifyContent: 'space-evenly',
    paddingVertical: 16,
  },
  tabContainer: {
    flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    marginBottom: 10,
    zIndex: 1, // Ensure tabs are above other elements
    backgroundColor: 'transparent',
    width: '100%',
  },
  tabButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    minHeight: 48, // Ensure a minimum touchable height
    //zIndex: 1, // Ensure buttons are above other elements
    backgroundColor: 'transparent',
  },
  tabButtonContent: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeTab: {
    borderBottomWidth: 2,
  },
  tabText: {
    fontSize: 16,
    fontWeight: '500',
  },
  activeTabText: {
    fontWeight: '700',
  },
  profilesContainer: {
    flex: 1,
  },
  profilesContent: {
    padding: 16,
    paddingBottom: 40,
  },
  profileCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.1)',
  },
  profileTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: I18nManager.isRTL ? 'right' : 'left',
    width: '100%',
  },
  profileInfoContainer: {
    marginBottom: 12,
  },
  profileLabel: {
    fontSize: 14,
    marginBottom: 4,
    color: '#666',
    textAlign: I18nManager.isRTL ? 'right' : 'left',
    width: '100%',
  },
  profileValueContainer: {
    flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    borderRadius: 8,
    padding: 10,
  },
  profileValue: {
    fontSize: 14,
    flex: 1,
    marginRight: I18nManager.isRTL ? 0 : 8,
    marginLeft: I18nManager.isRTL ? 8 : 0,
    textAlign: I18nManager.isRTL ? 'right' : 'left',
  },
  profileButton: {
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 8,
    alignItems: 'center',
  },
  profileButtonText: {
    fontSize: 16,
    fontWeight: '500',
  },
  profilesLoader: {
    marginVertical: 20,
  },
  profilesErrorContainer: {
    alignItems: 'center',
    padding: 16,
  },
  profilesErrorText: {
    fontSize: 16,
    color: '#FF3B30',
    textAlign: 'center',
  },
  profilesEmptyContainer: {
    alignItems: 'center',
    padding: 16,
  },
  profilesEmptyText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  profilesList: {
    marginTop: 8,
  },
  profileListItem: {
    flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.05)',
  },
  profileListItemLeft: {
    flex: 1,
    flexDirection: 'column',
  },
  profileListItemId: {
    fontSize: 14,
    fontWeight: '500',
  },
  profileListItemName: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  profileListItemRight: {
    flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row',
    alignItems: 'center',
  },
  profileListItemStat: {
    flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row',
    alignItems: 'center',
    marginRight: I18nManager.isRTL ? 0 : 16,
    marginLeft: I18nManager.isRTL ? 16 : 0,
  },
  profileListItemStatText: {
    fontSize: 14,
    marginLeft: I18nManager.isRTL ? 0 : 4,
    marginRight: I18nManager.isRTL ? 4 : 0,
  },
  domainBadge: {
    backgroundColor: '#4CAF50',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 4,
    alignSelf: I18nManager.isRTL ? 'flex-end' : 'flex-start',
  },
  domainBadgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
  },
  ownerBadge: {
    backgroundColor: '#FFA000', // Gold/amber color for owner badge
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 4,
    alignSelf: I18nManager.isRTL ? 'flex-end' : 'flex-start',
    borderWidth: 1,
    borderColor: '#FF8F00', // Slightly darker border
  },
  ownerBadgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
  },
  nftBadge: {
    backgroundColor: '#7E57C2', // Purple color for NFT badge
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 4,
    alignSelf: I18nManager.isRTL ? 'flex-end' : 'flex-start',
  },
  nftBadgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
  },
  quickActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  quickActionButton: {
    width: '48%',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginBottom: 8,
  },
  quickActionText: {
    fontSize: 14,
    fontWeight: '500',
    marginTop: 8,
  },
  profileModalContent: {
    width: '90%',
    maxHeight: '80%',
    borderRadius: 16,
    padding: 0,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  profileModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.1)',
  },
  profileModalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  profileModalScroll: {
    padding: 16,
  },
  profileDetailItem: {
    marginBottom: 16,
  },
  profileDetailLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  profileDetailValue: {
    fontSize: 16,
  },
  profileDetailValueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    borderRadius: 8,
    padding: 10,
  },
  profileModalActions: {
    marginTop: 24,
    marginBottom: 16,
  },
  profileModalSectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  profileModalButton: {
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 8,
    alignItems: 'center',
  },
  profileModalButtonText: {
    fontSize: 16,
    fontWeight: '500',
  },
  buttonPanelContainer: {
    zIndex: 30,
    width: '100%',
    height: '100%',
    alignItems: 'center',
  },
  safeArea: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '100%',
    backgroundColor: 'transparent',
    zIndex: 3000000,


  },
  fabContainer: {
    position: 'absolute',
    bottom: 0,
    zIndex: 3000001,
    width: '100%',
    backgroundColor: 'transparent',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    gap: 16,
  },
  fab: {
    position: 'absolute',
    bottom: 0,
    backgroundColor: '#4F71B6',
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    zIndex: 3000001,

  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.75)', // Darker overlay for better contrast
  },
  modalContent: {
    margin: 20,
    borderRadius: 20,
    padding: 35,
    alignItems: 'center',
    backgroundColor: '#FFFFFF', // Solid white background for all modals
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    width: '85%', // Make modal wider
  },
  modalText: {
    marginBottom: 15,
    textAlign: 'center',
    fontSize: 16,
  },
  modalButton: {
    borderRadius: 20,
    padding: 10,
    elevation: 2,
    backgroundColor: '#2196F3',
  },
  modalButtonText: {
    color: 'white',
    fontWeight: 'bold',
    textAlign: 'center',
  },
  jsonInput: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    padding: 12,
    minHeight: 100,
    marginBottom: 16,
    textAlignVertical: 'top',
    fontSize: 14,
    fontFamily: 'Courier',
    textAlign: I18nManager.isRTL ? 'right' : 'left',
  },
  keyValue: {
    fontSize: 14,
    color: '#333',
    fontFamily: 'Courier',
    backgroundColor: '#F5F5F5',
    padding: 10,
    borderRadius: 6,
    width: '100%',
    overflow: 'hidden',
    textAlign: I18nManager.isRTL ? 'right' : 'left',
  },
  otpContainer: {
    marginVertical: 16,
    width: '100%',
    alignItems: I18nManager.isRTL ? 'flex-end' : 'flex-start',
  },
  otpLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: I18nManager.isRTL ? 'right' : 'left',
    width: '100%',
  },
  otpDisplay: {
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    padding: 12,
    minHeight: 48,
    justifyContent: 'center',
    width: '100%',
  },
  otpText: {
    fontSize: 16,
    color: '#333',
    textAlign: I18nManager.isRTL ? 'right' : 'left',
  },
  modalButtons: {
    flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 20,
  },
  decryptButton: {
    backgroundColor: '#34C759', // Green color for decrypt
  },
  copyButton: {
    backgroundColor: '#0070FF',
  },
  closeButton: {
    backgroundColor: '#FF3B30',
  },
  qrContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'white',
    borderRadius: 12,
    marginBottom: 16,
  },
  keyText: {
    marginBottom: 20,
    width: '100%',
  },
  keyLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#444',
    marginBottom: 8,
    textAlign: I18nManager.isRTL ? 'right' : 'left',
  },
  hashButton: {
    backgroundColor: '#4CAF50',
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#333',
    textAlign: I18nManager.isRTL ? 'right' : 'left',
    width: '100%',
  },
  copyTouchable: {
    width: '100%',
  },
});
