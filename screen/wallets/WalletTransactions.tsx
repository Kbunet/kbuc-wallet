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

  const navigateToSendScreen = (txType = "transfer", scannedTarget?: string, profile?: string, duration?: string) => {
    console.debug('navigateToSendScreen:', `${profile ?? ""}, ${scannedTarget ?? ""}, ${txType ?? ""}`);
    navigate('SendDetailsRoot', {
      screen: 'SendDetails',
      params: {
        walletID,
        txType,
        scannedTarget,
        profile,
        duration
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

  const sendButtonPress = (txType="transfer", scannedData?: string, profile?: string, duration?: string) => {
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

    navigateToSendScreen(txType, scannedData, profile, duration);
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

  const handleButtonPress = (buttonType: string) => {
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
        sendButtonPress('reputation');
        break;
      case 'join':
        sendButtonPress('join');
        break;
      case 'leave':
        sendButtonPress('leave');
        break;
      case 'transfer':
        sendButtonPress('ownership');
        break;
      case 'reclaim':
        sendButtonPress('reclaim');
        break;
      case 'metadata':
        sendButtonPress('metadata');
        break;
      case 'bid':
        sendButtonPress('bid');
        break;
      case 'offer':
        sendButtonPress('offer');
        break;
      case 'ensurance':
        sendButtonPress('ensurance');
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

  const toggleKeyDisplay = () => {
    if (wallet && walletPubKey) {
      setShowPubKeyHash(!showPubKeyHash);
    }
  };

  const getPublicKey = () => {
    return walletPubKey || '';
  };

  const getProfileId = () => {
    if (!walletPubKey) return '';
    
    try {
      // Convert hex string to buffer for hash160
      const buffer = Buffer.from(walletPubKey, 'hex');
      const hash = crypto.hash160(buffer);
      return hash.toString('hex');
    } catch (error) {
      console.log('Error calculating hash160:', error);
      return 'Error calculating hash';
    }
  };

  // For QR code display
  const getDisplayValue = () => {
    return getPublicKey();
  };

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
        />
      </View>
      <SafeAreaView style={styles.safeArea}>
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
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('receive')}>
                  <View style={styles.iconContainer}>
                    <Icon name="download" size={24} type="font-awesome-5" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>Receive</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('send')}>
                  <View style={styles.iconContainer}>
                    <Icon name="paper-plane" size={22} type="font-awesome" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>Send</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('sendrps')}>
                  <View style={styles.iconContainer}>
                    <Icon name="star" size={24} type="font-awesome" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>Reputation</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.separator} />

              <View style={styles.buttonGroup}>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('join')}>
                  <View style={styles.iconContainer}>
                    <Icon name="handshake" size={20} type="font-awesome-5" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>Join Pool</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('leave')}>
                  <View style={styles.iconContainer}>
                    <Icon name="sign-out-alt" size={24} type="font-awesome-5" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>Leave Pool</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('transfer')}>
                  <View style={styles.iconContainer}>
                    <Icon name="exchange-alt" size={24} type="font-awesome-5" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>Transfer Ownership</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('reclaim')}>
                  <View style={styles.iconContainer}>
                    <Icon name="undo" size={24} type="font-awesome" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>Reclaim Profile</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('metadata')}>
                  <View style={styles.iconContainer}>
                    <Icon name="edit" size={24} type="font-awesome" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>Update metadata</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('offer')}>
                  <View style={styles.iconContainer}>
                    <Icon name="tag" size={24} type="font-awesome" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>Make an Offer</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('bid')}>
                  <View style={styles.iconContainer}>
                    <Icon name="gavel" size={24} type="font-awesome" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>Make a Bid</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('ensurance')}>
                  <View style={styles.iconContainer}>
                    <Icon name="trending-up" size={22} type="material" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>Increase Balance</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('releaseEnsurance')}>
                  <View style={styles.iconContainer}>
                    <Icon name="attach-money" size={22} type="material" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>Liquidate Balance</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('vote')}>
                  <View style={styles.iconContainer}>
                    <Icon name="check-square" size={22} type="font-awesome" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>Cast a Vote</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.separator} />

              <View style={styles.buttonGroup}>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('getkey')}>
                  <View style={styles.iconContainer}>
                    <Icon name="id-card" size={22} type="font-awesome" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>Get ID</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('scan')}>
                  <View style={styles.iconContainer}>
                    <Icon name="qrcode" size={22} type="font-awesome" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>Scan</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => handleButtonPress('paste')}>
                  <View style={styles.iconContainer}>
                    <Icon name="paste" size={22} type="font-awesome" color={colors.buttonAlternativeTextColor} />
                  </View>
                  <Text style={[styles.buttonText, { color: colors.buttonAlternativeTextColor }]}>Paste</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </Animated.View>

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
      </SafeAreaView>
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
              Decrypted OTP: {decryptedOtp}
            </Text>
            <TouchableOpacity
              style={styles.modalButton}
              onPress={() => {
                setIsOtpModalVisible(false);
              }}
            >
              <Text style={styles.modalButtonText}>Close</Text>
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
            <Text style={styles.modalTitle}>Paste Encrypted OTP</Text>
            
            <TextInput
              style={styles.jsonInput}
              multiline
              numberOfLines={4}
              placeholder="Paste JSON here"
              value={encryptedJson}
              onChangeText={setEncryptedJson}
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              contextMenuHidden={false}
            />

            <View style={styles.otpContainer}>
              <Text style={styles.otpLabel}>Decrypted OTP:</Text>
              <View style={styles.otpDisplay}>
                <Text style={styles.otpText}>{decryptedOTP}</Text>
              </View>
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.decryptButton]}
                onPress={handleDecryptOTP}
              >
                <Text style={styles.modalButtonText}>Decrypt</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalButton, styles.copyButton]}
                onPress={handleCopyOTP}
              >
                <Text style={styles.modalButtonText}>Copy</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.modalButton, styles.closeButton]}
                onPress={() => {
                  setIsPasteModalVisible(false);
                  setEncryptedJson('');
                  setDecryptedOTP('');
                }}
              >
                <Text style={styles.modalButtonText}>Close</Text>
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
            <Text style={styles.modalTitle}>Your Wallet ID</Text>
            
            <QRCodeComponent 
              value={getDisplayValue()} 
              size={250} 
              isLogoRendered={true}
              ecl="H"
            />

            <View style={styles.keyText}>
              <Text style={styles.keyLabel}>Public Key:</Text>
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

            <View style={[styles.keyText, { marginTop: 16 }]}>
              <Text style={styles.keyLabel}>Profile ID:</Text>
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

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.closeButton, { width: '100%' }]}
                onPress={() => setIsKeyModalVisible(false)}
              >
                <Text style={styles.modalButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
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
  buttonPanelContainer: {
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
  },
  otpContainer: {
    marginBottom: 16,
  },
  otpLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  otpDisplay: {
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    padding: 12,
    minHeight: 48,
    justifyContent: 'center',
  },
  otpText: {
    fontSize: 16,
    color: '#333',
  },
  modalButtons: {
    flexDirection: 'row',
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
  },
  hashButton: {
    backgroundColor: '#4CAF50',
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#333',
  },
  copyTouchable: {
    width: '100%',
  },
});
