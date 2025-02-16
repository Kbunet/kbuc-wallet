import React, { useState } from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity, ScrollView, Platform, Switch } from 'react-native';
import { Icon } from '@rneui/themed';
import { useTheme } from './themes';
import { satoshiToBTC } from '../blue_modules/currency';

interface Props {
  wallets: any[];
  onSelect: (wallet: any) => void;
  onCancel: () => void;
}

export const WalletSelectDialog: React.FC<Props> = ({ wallets, onSelect, onCancel }) => {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [hideEmptyWallets, setHideEmptyWallets] = useState(true);

  const filteredWallets = wallets.filter(wallet => {
    if (!hideEmptyWallets) return true;
    const balance = wallet.getBalance ? wallet.getBalance() : 0;
    return balance > 0;
  });

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={true}
      onRequestClose={onCancel}
    >
      <View style={styles.centeredView}>
        <View style={styles.modalView}>
          <View style={styles.header}>
            <Text style={styles.modalTitle}>Select Wallet</Text>
            <TouchableOpacity onPress={onCancel} style={styles.closeButton}>
              <Icon name="close" size={24} color={colors.foregroundColor} />
            </TouchableOpacity>
          </View>

          <View style={styles.filterContainer}>
            <Text style={styles.filterText}>Hide Empty Wallets</Text>
            <Switch
              value={hideEmptyWallets}
              onValueChange={setHideEmptyWallets}
              trackColor={{ false: colors.inputBorderColor, true: colors.buttonBackgroundColor }}
              thumbColor={colors.foregroundColor}
            />
          </View>
          
          <ScrollView style={styles.walletList}>
            {filteredWallets.length === 0 ? (
              <View style={styles.emptyState}>
                <Icon 
                  name="wallet" 
                  type="entypo" 
                  size={40} 
                  color={colors.alternativeTextColor}
                  style={styles.emptyIcon} 
                />
                <Text style={styles.emptyText}>
                  {hideEmptyWallets ? 
                    'No wallets with balance found' : 
                    'No wallets found'}
                </Text>
              </View>
            ) : (
              filteredWallets.map((wallet, index) => {
                const balance = wallet.getBalance ? satoshiToBTC(wallet.getBalance()) : null;
                const label = wallet.getLabel() || `Wallet ${index + 1}`;
                
                return (
                  <TouchableOpacity
                    key={index}
                    style={styles.walletItem}
                    onPress={() => onSelect(wallet)}
                  >
                    <View style={styles.walletIcon}>
                      <Icon 
                        name="wallet" 
                        type="entypo" 
                        size={24} 
                        color={colors.foregroundColor}
                        style={styles.icon} 
                      />
                    </View>
                    <View style={styles.walletInfo}>
                      <Text style={styles.walletName} numberOfLines={1} ellipsizeMode="tail">
                        {label}
                      </Text>
                      {balance && (
                        <Text style={styles.walletBalance}>
                          {balance} BTC
                        </Text>
                      )}
                    </View>
                    <Icon 
                      name="chevron-right" 
                      type="feather" 
                      size={20} 
                      color={colors.alternativeTextColor}
                    />
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const getStyles = (colors: any) => StyleSheet.create({
  centeredView: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalView: {
    backgroundColor: colors.elevated,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    width: '100%',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
      },
      android: {
        elevation: 5,
      },
    }),
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.inputBorderColor,
  },
  filterContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.inputBorderColor,
  },
  filterText: {
    fontSize: 16,
    color: colors.foregroundColor,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.foregroundColor,
  },
  closeButton: {
    padding: 4,
  },
  walletList: {
    width: '100%',
  },
  emptyState: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIcon: {
    marginBottom: 12,
    opacity: 0.5,
  },
  emptyText: {
    fontSize: 16,
    color: colors.alternativeTextColor,
    textAlign: 'center',
  },
  walletItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.inputBorderColor,
  },
  walletIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.buttonBackgroundColor,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  icon: {
    opacity: 0.8,
  },
  walletInfo: {
    flex: 1,
    marginRight: 8,
  },
  walletName: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.foregroundColor,
    marginBottom: 4,
  },
  walletBalance: {
    fontSize: 14,
    color: colors.alternativeTextColor,
  },
});

export default WalletSelectDialog;
