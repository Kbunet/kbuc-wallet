import React from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';

interface Props {
  wallets: any[];
  onSelect: (wallet: any) => void;
  onCancel: () => void;
}

export const WalletSelectDialog: React.FC<Props> = ({ wallets, onSelect, onCancel }) => {
  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={true}
      onRequestClose={onCancel}
    >
      <View style={styles.centeredView}>
        <View style={styles.modalView}>
          <Text style={styles.modalTitle}>Select Wallet</Text>
          <ScrollView style={styles.walletList}>
            {wallets.map((wallet, index) => (
              <TouchableOpacity
                key={index}
                style={styles.walletItem}
                onPress={() => onSelect(wallet)}
              >
                <Text style={styles.walletName}>
                  {wallet.getLabel() || `Wallet ${index + 1}`}
                </Text>
                <Text style={styles.walletBalance}>
                  {wallet.getBalance ? `${wallet.getBalance()} BTC` : 'Balance unavailable'}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity
            style={[styles.button, styles.cancelButton]}
            onPress={onCancel}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  centeredView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalView: {
    width: '80%',
    maxHeight: '80%',
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  walletList: {
    width: '100%',
    maxHeight: '70%',
  },
  walletItem: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    width: '100%',
  },
  walletName: {
    fontSize: 16,
    fontWeight: '500',
  },
  walletBalance: {
    fontSize: 14,
    color: '#666',
    marginTop: 5,
  },
  button: {
    borderRadius: 10,
    padding: 10,
    marginTop: 15,
    minWidth: 100,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#dee2e6',
  },
  cancelButtonText: {
    color: '#212529',
    fontSize: 16,
  },
});

export default WalletSelectDialog;
