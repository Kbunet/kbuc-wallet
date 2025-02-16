import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Alert, Keyboard, LayoutAnimation, Platform, ScrollView, StyleSheet, Switch, TextInput, View, FlatList } from 'react-native';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../blue_modules/hapticFeedback';
import { BlueCard, BlueSpacing10, BlueSpacing20, BlueText } from '../../BlueComponents';
import DeeplinkSchemaMatch from '../../class/deeplink-schema-match';
import presentAlert from '../../components/Alert';
import Button from '../../components/Button';
import { scanQrHelper } from '../../helpers/scan-qr';
import loc from '../../loc';
import {
  DoneAndDismissKeyboardInputAccessory,
  DoneAndDismissKeyboardInputAccessoryViewID,
} from '../../components/DoneAndDismissKeyboardInputAccessory';
import DefaultPreference from 'react-native-default-preference';

import { DismissKeyboardInputAccessory, DismissKeyboardInputAccessoryViewID } from '../../components/DismissKeyboardInputAccessory';
import { useTheme } from '../../components/themes';
import { RouteProp, useRoute } from '@react-navigation/native';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { CommonToolTipActions } from '../../typings/CommonToolTipActions';
import { Divider } from '@rneui/themed';
import { Header } from '../../components/Header';
import AddressInput from '../../components/AddressInput';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GROUP_IO_BLUEWALLET } from '../../blue_modules/currency';
import { Action } from '../../components/types';
import { useStorage } from '../../hooks/context/useStorage';
import ListItem, { PressableWrapper } from '../../components/ListItem';
import HeaderMenuButton from '../../components/HeaderMenuButton';
import { Text } from '@rneui/themed';
import { Icon } from '@rneui/base';
import { getAvailableDifficulaties } from '../../custom/providers/SupportServer';
import { Difficulty, SupportServerType } from '../../custom/types';

type RouteProps = RouteProp<DetailViewStackParamList, 'ElectrumSettings'>;

export interface SupportServerItem {
  host: string;
  port?: number;
  address?: string;
}

const SupportSettings: React.FC = () => {
  const { colors } = useTheme();
  const { server } = useRoute<RouteProps>().params;
  const { setOptions } = useExtendedNavigation();
  const [isLoading, setIsLoading] = useState(false);
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [serverHistory, setServerHistory] = useState<SupportServerItem[]>([]);
  const [config, setConfig] = useState<{ connected?: number; host?: string; port?: string }>({});
  const [host, setHost] = useState<string>('');
  const [port, setPort] = useState<number | undefined>();
  const [difficulties, setDifficulties] = useState<Difficulty[]>([]);
  const [address, setAddress] = useState<string | ''>();
  const [sslPort, setSslPort] = useState<number | undefined>(undefined);
  const [isAndroidNumericKeyboardFocused, setIsAndroidNumericKeyboardFocused] = useState(false);
  const [isAndroidAddressKeyboardVisible, setIsAndroidAddressKeyboardVisible] = useState(false);
  const { setIsElectrumDisabled } = useStorage();

  const stylesHook = StyleSheet.create({
    inputWrap: {
      borderColor: colors.formBorder,
      backgroundColor: colors.inputBackgroundColor,
    },
    containerConnected: {
      backgroundColor: colors.feeLabel,
    },
    containerDisconnected: {
      backgroundColor: colors.redBG,
    },
    textConnected: {
      color: colors.feeValue,
    },
    textDisconnected: {
      color: colors.redText,
    },
    hostname: {
      color: colors.foregroundColor,
    },
    inputText: {
      color: colors.foregroundColor,
    },
    usePort: {
      color: colors.foregroundColor,
    },
  });

  useEffect(() => {
    async function getServer () {
      const settingsStr = await AsyncStorage.getItem('support_server');
      if (settingsStr) {
        const settings = JSON.parse(settingsStr);
        setHost(settings.host);
        setPort(settings.port);
        setAddress(settings.address);
      }
    };
    getServer();
  }, []);

  const save = async () => {
    
    const supportServer : SupportServerType = {
      host,
      port
    }
    console.log(supportServer);
    setIsLoading(true);
    // await AsyncStorage.setItem('support_server', JSON.stringify(supportServer));
    addSupportServer(supportServer);
    setIsLoading(false);
  }

  const onBarScanned = (value: string) => {
    let v = value;
    if (value && DeeplinkSchemaMatch.getServerFromSetElectrumServerAction(value)) {
      v = DeeplinkSchemaMatch.getServerFromSetElectrumServerAction(value) as string;
    }
    const [scannedHost, scannedPort, type] = v?.split(':') ?? [];
    setHost(scannedHost);
    if (type === 's') {
      setSslPort(Number(scannedPort));
      setPort(undefined);
    } else {
      setPort(Number(scannedPort));
      setSslPort(undefined);
    }
  };

  const importScan = async () => {
    const scanned = await scanQrHelper('ElectrumSettings', true);
    if (scanned) {
      onBarScanned(scanned);
    }
  };

  const handleSelectServer = (server:SupportServerType) => {
    setHost(server.host);
    setPort(server?.port);
    setDifficulties(server?.difficulties || []);
  }

  const handleDeleteServer = async (server:SupportServerType) => {
    console.log(`Deleteing server ${server.host}:${server.port}`);
    const filterServers = servers.filter(s => s != server);
    console.log(filterServers);
    await AsyncStorage.setItem("support_servers", JSON.stringify(filterServers));
    setServers(filterServers);
  }

  const renderItem = ({ index, item }: { index: number; item: SupportServerType}) => {
    console.log(item);
    return (
        <ListItem
          title={`${item.host}:${item.port}`}
          onPress={() => handleSelectServer(item)}
          onDeletePressed={() => handleDeleteServer(item)}
          // checkmark={isSelected}
          // disabled={isCustomEnabled}
          containerStyle={[{ backgroundColor: colors.background }, styles.rowHeight]}
          swipeable={true}
        />
    );
  };

  const renderDifficultyItem = ({ index, item }: { index: number; item: Difficulty}) => {
    console.log(item);
    return (
        <ListItem
          title={`Support time around ${(item.time)} seconds (${item.amount})`}
          containerStyle={[{ backgroundColor: colors.background }, styles.rowHeight]}
        />
    );
  };
  

  const [servers, setServers] = useState<SupportServerType[]>( []);

  const loadSupportServerFromStorage = async () => {
    const serversStr = await AsyncStorage.getItem("support_servers");
    if (serversStr) {
      const supportServers : SupportServerType[] =  JSON.parse(serversStr);
      setServers(supportServers);
    }
  }
  useEffect(() => {
    loadSupportServerFromStorage();
  }, []);

  const addSupportServer = async (server : SupportServerType) => {
    let currentServers = [...servers];
    const currentServer = currentServers.find(s => s.host == server.host);
    if (currentServer) {
      currentServer.port = port;
    } else {
      const response = await getAvailableDifficulaties(`${server.host}:${server.port}`);
      console.log(response);
      let diffs: Difficulty[];
      if (response.status) {
        diffs = response.difficulties?.map(diff => {
          const d : Difficulty  = {amount: diff.reward, time: diff.time, address: diff.address};
          return d;
        });
      }
      
      currentServers.push({...server, difficulties: diffs});
    }
    await AsyncStorage.setItem("support_servers", JSON.stringify(currentServers));
    setServers(currentServers);
  }

  const renderElectrumSettings = () => {
    return (
      <>
        <Divider />
        <BlueSpacing20 />
        <Header leftText={loc.settings.electrum_status} />
        <BlueSpacing20 />

        
        <FlatList
          scrollEnabled={servers.length > 1}
          extraData={servers}
          data={servers}
          renderItem={renderItem}
          keyExtractor={(_item, index) => `${index}`}
          style={[styles.root, { backgroundColor: colors.background }]}
        />

        {/* <BlueSpacing10 /> */}
        {/* <BlueSpacing20 /> */}

        {/* <Header leftText={loc.settings.electrum_preferred_server} /> */}
        <BlueCard>
          {/* <BlueText>{loc.settings.electrum_preferred_server_description}</BlueText> */}
          <BlueSpacing20 />
          <AddressInput
            testID="HostInput"
            placeholder={loc.formatString(loc.settings.electrum_host, { example: '10.20.30.40' })}
            address={host}
            onChangeText={text => setHost(text.trim())}
            editable={!isLoading}
            onBarScanned={importScan}
            keyboardType="default"
            onBlur={() => setIsAndroidAddressKeyboardVisible(false)}
            onFocus={() => setIsAndroidAddressKeyboardVisible(true)}
            inputAccessoryViewID={DoneAndDismissKeyboardInputAccessoryViewID}
            isLoading={isLoading}
          />
          <BlueSpacing20 />
          <View style={styles.portWrap}>
            <View style={[styles.inputWrap, stylesHook.inputWrap]}>
              <TextInput
                placeholder={loc.formatString(loc.settings.electrum_port, { example: '50001' })}
                value={sslPort?.toString() === '' || sslPort === undefined ? port?.toString() || '' : sslPort?.toString() || ''}
                onChangeText={text => {
                  const parsed = Number(text.trim());
                  if (Number.isNaN(parsed)) {
                    // Handle invalid input
                    sslPort === undefined ? setPort(undefined) : setSslPort(undefined);
                    return;
                  }
                  sslPort === undefined ? setPort(parsed) : setSslPort(parsed);
                }}
                numberOfLines={1}
                style={[styles.inputText, stylesHook.inputText]}
                editable={!isLoading}
                placeholderTextColor="#81868e"
                underlineColorAndroid="transparent"
                autoCorrect={false}
                autoCapitalize="none"
                keyboardType="number-pad"
                inputAccessoryViewID={DismissKeyboardInputAccessoryViewID}
                testID="PortInput"
                onFocus={() => setIsAndroidNumericKeyboardFocused(true)}
                onBlur={() => setIsAndroidNumericKeyboardFocused(false)}
              />
            </View>
          </View>
          <View style={styles.portWrap}>
            <FlatList
              scrollEnabled={difficulties.length > 1}
              extraData={difficulties}
              data={difficulties}
              renderItem={renderDifficultyItem}
              keyExtractor={(_item, index) => `${index}`}
              style={[styles.root, { backgroundColor: colors.background }]}
            />
          </View>
        </BlueCard>
        <BlueCard>
          <BlueSpacing20 />
          <Button showActivityIndicator={isLoading} disabled={isLoading} testID="Save" onPress={save} title={loc.settings.save} />
        </BlueCard>

        {Platform.select({
          ios: <DismissKeyboardInputAccessory />,
          android: isAndroidNumericKeyboardFocused && <DismissKeyboardInputAccessory />,
        })}

        {Platform.select({
          ios: (
            <DoneAndDismissKeyboardInputAccessory
              onClearTapped={() => setHost('')}
              onPasteTapped={text => {
                setHost(text);
                Keyboard.dismiss();
              }}
            />
          ),
          android: isAndroidAddressKeyboardVisible && (
            <DoneAndDismissKeyboardInputAccessory
              onClearTapped={() => {
                setHost('');
                Keyboard.dismiss();
              }}
              onPasteTapped={text => {
                setHost(text);
                Keyboard.dismiss();
              }}
            />
          ),
        })}
      </>
    );
  };

  return (
    <ScrollView
      keyboardShouldPersistTaps="always"
      automaticallyAdjustContentInsets
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      testID="ElectrumSettingsScrollView"
    >
      

      {!isOfflineMode && renderElectrumSettings()}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  connectWrap: {
    width: 'auto',
    height: 34,
    flexWrap: 'wrap',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  hostname: {
    textAlign: 'center',
  },
  container: {
    paddingTop: 6,
    paddingBottom: 6,
    paddingLeft: 16,
    paddingRight: 16,
    borderRadius: 20,
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    borderWidth: 1,
    borderBottomWidth: 0.5,
    minHeight: 44,
    height: 44,
    alignItems: 'center',
    borderRadius: 4,
  },
  portWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  inputText: {
    flex: 1,
    marginHorizontal: 8,
    minHeight: 36,
    height: 36,
  },
  textConnectionStatus: {
    fontWeight: 'bold',
  },
  usePort: {
    marginHorizontal: 16,
  },
  cardTop: {
    flexGrow: 8,
    marginTop: 16,
    alignItems: 'center',
    maxHeight: '70%',
  },
  root: {
    flex: 1,
  },
  rowHeight: {
    minHeight: 60,
  },
});

export default SupportSettings;
