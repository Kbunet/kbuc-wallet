import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View, ScrollView, ActivityIndicator, TouchableOpacity, Alert, Animated, Text } from 'react-native';
import { BlueButtonLink, BlueCard, BlueSpacing10, BlueSpacing20 } from '../../BlueComponents';
import Button from '../../components/Button';
import { useTheme } from '../../components/themes';
import { useRoute, RouteProp, ParamListBase } from '@react-navigation/native';
import { Icon } from '@rneui/themed';
import Clipboard from '@react-native-clipboard/clipboard';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../blue_modules/hapticFeedback';
import loc from '../../loc';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import { scanQrHelper } from '../../helpers/scan-qr';

interface ProfileData {
  creator: string;
  owner: string;
  signer: string;
  name: string;
  link: string;
  appData: string;
  rps: number;
  generatedRPs: number;
  ownedProfilesCount: number;
  isRented: boolean;
  tenant: string;
  rentedAt: number;
  duration: number;
  isCandidate: boolean;
  isBanned: boolean;
  contribution: number;
  isDomain: boolean;
  offeredAt: number;
  bidAmount: number;
  buyer: string;
  balance: number;
  bidTarget: string;
}

interface ProfileResponse {
  rps: number;
  owner: string;
  tenant: string;
  rentedAt: number;
  duration: number;
  ownedProfiles: Array<{
    id: string;
    owner: string;
    rps: number;
    ownershipType: string;
    tenant: string;
    rentedAt: number;
    duration: number;
    isCandidate: boolean;
    isBanned: boolean;
  }>;
  ownedProfilesCount: number;
}

interface ProfileVerificationParams extends ParamListBase {
  ProfileVerification: {
    scannedData?: string;
    scanTime?: number;
    profileId?: string;
  };
}

const ProfileVerification: React.FC = () => {
  const route = useRoute<RouteProp<ProfileVerificationParams, 'ProfileVerification'>>();
  const { colors } = useTheme();
  const [profileId, setProfileId] = useState<string>('');
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const scanButtonRef = useRef<any>();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;

  const animateProfileIn = () => {
    slideAnim.setValue(50);
    fadeAnim.setValue(0);
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const [copiedMap, setCopiedMap] = useState<{ [key: string]: boolean }>({});
  const copyAnimations = useRef<{ [key: string]: Animated.Value }>({});

  const handleCopyText = (text: string, label: string) => {
    Clipboard.setString(text);
    
    // Create animation if it doesn't exist
    if (!copyAnimations.current[label]) {
      copyAnimations.current[label] = new Animated.Value(0);
    }

    // Show copied state
    setCopiedMap(prev => ({ ...prev, [label]: true }));

    // Animate the feedback
    Animated.sequence([
      Animated.timing(copyAnimations.current[label], {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.delay(1000),
      Animated.timing(copyAnimations.current[label], {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Reset copied state
      setCopiedMap(prev => ({ ...prev, [label]: false }));
    });

    triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
  };

  const handleVerify = async (id?: string | any) => {
    // Check if id is an object (likely an event) and not a string
    if (id && typeof id !== 'string' && id.nativeEvent) {
      console.log('Received event object instead of profile ID, using state profileId');
      id = undefined; // Reset to undefined so we use the profileId from state
    }
    
    const profileToVerify = typeof id === 'string' ? id : profileId;
    console.log('Verifying profile:', profileToVerify);
    
    if (!profileToVerify) return;
    
    setIsLoading(true);
    setError('');
    
    try {
      const result = await BlueElectrum.verifyProfile(profileToVerify);
      console.log('API Response:', JSON.stringify(result, null, 2));
      
      if (result) {
        // Check if the profile exists in the root level
        if (result.owner && result.rps) {
          // Map all available profile data to our ProfileData interface
          setProfile({
            creator: result.creator || '',
            owner: result.owner || '',
            signer: result.signer || '',
            name: result.name || '',
            link: result.link || '',
            appData: result.appData || '',
            rps: result.rps || 0,
            generatedRPs: result.generatedRPs || 0,
            ownedProfilesCount: Array.isArray(result.ownedProfiles) ? result.ownedProfiles.length : 0,
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
          });
          animateProfileIn();
          triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
        } 
        // If not in root, check ownedProfiles array
        else if (result.ownedProfiles?.length > 0) {
          // Find the specific profile in the ownedProfiles array
          const targetProfile = result.ownedProfiles.find(
            p => p.id?.toLowerCase() === profileToVerify.toLowerCase()
          );

          if (targetProfile) {
            // Map all available profile data from the target profile
            setProfile({
              creator: targetProfile.creator || result.creator || '',
              owner: targetProfile.owner || '',
              signer: targetProfile.signer || result.signer || '',
              name: targetProfile.name || '',
              link: targetProfile.link || '',
              appData: targetProfile.appData || '',
              rps: targetProfile.rps || 0,
              generatedRPs: targetProfile.generatedRPs || 0,
              ownedProfilesCount: result.ownedProfiles.length,
              isRented: targetProfile.isRented || false,
              tenant: targetProfile.tenant || '',
              rentedAt: targetProfile.rentedAt || 0,
              duration: targetProfile.duration || 0,
              isCandidate: targetProfile.isCandidate || false,
              isBanned: targetProfile.isBanned || false,
              contribution: targetProfile.contribution || 0,
              isDomain: targetProfile.isDomain || false,
              offeredAt: targetProfile.offeredAt || 0,
              bidAmount: targetProfile.bidAmount || 0,
              buyer: targetProfile.buyer || '',
              balance: targetProfile.balance || 0,
              bidTarget: targetProfile.bidTarget || ''
            });
            animateProfileIn();
            triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
          } else {
            console.log('Profile IDs:', {
              searching: profileToVerify,
              available: result.ownedProfiles.map(p => p.id)
            });
            setError('Profile not found in owned profiles');
            triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
          }
        } else {
          setError('No profile data found');
          triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
        }
      }
    } catch (err: any) {
      console.error('Profile verification error:', err);
      setError(err?.message || 'Failed to verify profile');
      triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (route.params?.profileId) {
      setProfileId(route.params.profileId);
      handleVerify(route.params.profileId);  
    }
  }, [route.params?.profileId]);

  const importScan = async () => {
    const data = await scanQrHelper(route.name, true, undefined, true);
    if (data) {
      onBarScanned(data);
    }
  };

  const onBarScanned = (data: string) => {
    setProfileId(data);
    setError(null);
  };

  useEffect(() => {
    if (route.params?.scannedData) {
      onBarScanned(route.params.scannedData);
    }
  }, [route.params?.scannedData, route.params?.scanTime]);

  const formatRPs = (num: number): { formatted: string, smallAmount: string | null } => {
    if (num === 0) return { formatted: '0', smallAmount: null };
    
    // Format with 8 decimal places and remove trailing zeros
    const formatted = num.toFixed(8).replace(/\.?0+$/, '');
    
    return { formatted, smallAmount: null };
  };

  const formatLargeNumber = (num: number): string => {
    const absNum = Math.abs(num);
    if (absNum >= 1e9) {
      return (num / 1e9).toFixed(2) + 'B';
    } else if (absNum >= 1e6) {
      return (num / 1e6).toFixed(2) + 'M';
    } else if (absNum >= 1e3) {
      return (num / 1e3).toFixed(2) + 'K';
    }
    return num.toString();
  };

  const InfoRow = ({ label, value, copyable = false, info }: { label: string; value: string | number; copyable?: boolean; info?: string }) => {
    // Don't truncate labels, only truncate values if they're too long
    const displayValue = typeof value === 'string' ? 
      (value.length > 10 ? value.substring(0, 10) + '...' : value) : 
      value;

    const isTrustLevel = label === 'Trust Level';
    const isRentalPeriod = label === 'Rental Period';
    
    let finalValue = displayValue;

    if (isTrustLevel && typeof value === 'number') {
      const { formatted } = formatRPs(value);
      finalValue = formatted + ' RPs';
    } else if (isRentalPeriod) {
      finalValue = `${value} blocks (~${((Number(value) * 10)/86400).toFixed(2)} days)`;
    }

    // Get or create animation value for this row
    if (copyable && !copyAnimations.current[label]) {
      copyAnimations.current[label] = new Animated.Value(0);
    }
      
    return (
      <TouchableOpacity 
        style={styles.infoRow}
        onPress={() => info && Alert.alert(label, info)}
        activeOpacity={info ? 0.7 : 1}
      >
        <View style={styles.infoRowLeft}>
          <Text style={[styles.label, stylesHook.label]}>{label}</Text>
          {info && (
            <Icon
              name="info"
              type="feather"
              size={16}
              style={stylesHook.infoIcon}
            />
          )}
        </View>
        <View style={styles.infoRowRight}>
          <Text style={[styles.value, stylesHook.value]}>
            {finalValue}
          </Text>
          {copyable && (
            <TouchableOpacity
              onPress={() => handleCopyText(value.toString(), label)}
              style={styles.copyButton}
            >
              <Animated.View
                style={{
                  transform: [{
                    scale: copyAnimations.current[label].interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 0.8],
                    }),
                  }],
                }}
              >
                <Icon
                  name={copiedMap[label] ? 'check' : 'copy'}
                  type="feather"
                  size={16}
                  style={copiedMap[label] ? stylesHook.copiedIcon : stylesHook.copyIcon}
                />
              </Animated.View>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const stylesHook = StyleSheet.create({
    input: {
      borderColor: colors.formBorder,
      borderBottomColor: colors.formBorder,
      backgroundColor: colors.inputBackgroundColor,
      color: colors.foregroundColor,
    },
    card: {
      backgroundColor: colors.elevated,
      padding: 0,
      marginBottom: 0,
    },
    label: {
      color: colors.alternativeTextColor,
      opacity: 0.85,
      fontSize: 16,
      fontWeight: '500',
    },
    value: {
      color: colors.foregroundColor,
      fontWeight: '600',
      fontSize: 16,
    },
    errorText: {
      color: colors.failedColor,
      fontWeight: '500',
    },
    infoIcon: {
      color: colors.alternativeTextColor,
      marginLeft: 8,
      opacity: 0.75,
    },
    copyIcon: {
      color: colors.foregroundColor,
      opacity: 0.8,
    },
    copiedIcon: {
      color: colors.successColor,
      opacity: 1,
    },
    sectionTitle: {
      color: colors.foregroundColor,
      fontSize: 18,
      fontWeight: 'bold',
      marginTop: 16,
      marginBottom: 8,
      paddingBottom: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.formBorder,
    },
    verifyButton: {
      backgroundColor: colors.buttonBackgroundColor,
      minHeight: 48,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    verifyButtonText: {
      color: colors.buttonAlternativeTextColor,
      fontSize: 16,
      fontWeight: '600',
      textAlign: 'center',
    },
    verifyButtonDisabled: {
      opacity: 0.7,
    },
    scanButton: {
      marginTop: 8,
    },
    profileCard: {
      backgroundColor: colors.elevated,
      borderWidth: 1,
      borderColor: colors.formBorder,
    }
  });

  const styles = StyleSheet.create({
    scrollView: {
      flex: 1,
    },
    container: {
      flexDirection: 'column',
      padding: 16,
    },
    inputContainer: {
      marginBottom: 16,
    },
    input: {
      flexDirection: 'row',
      borderWidth: 1,
      borderBottomWidth: 0.5,
      minHeight: 48,
      height: 48,
      alignItems: 'center',
      borderRadius: 8,
      paddingHorizontal: 16,
      fontSize: 14,
      marginBottom: 8,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: 'bold',
      marginTop: 16,
      marginBottom: 8,
      paddingBottom: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    errorContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 8,
      padding: 12,
      borderRadius: 8,
      backgroundColor: `${colors.failedColor}15`,
      borderWidth: 1,
      borderColor: `${colors.failedColor}30`,
    },
    errorText: {
      marginLeft: 8,
      fontSize: 14,
    },
    loadingContainer: {
      marginTop: 24,
      alignItems: 'center',
    },
    verifyButtonContainer: {
      marginVertical: 16,
      paddingHorizontal: 16,
    },
    verifyButton: {
      minHeight: 48,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    profileContainer: {
      marginTop: 24,
      borderRadius: 12,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: {
        width: 0,
        height: 4,
      },
      shadowOpacity: 0.15,
      shadowRadius: 8,
      elevation: 8,
    },
    profileContent: {
      padding: 16,
    },
    infoRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: `${colors.formBorder}50`,
      minHeight: 52,
    },
    infoRowLeft: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      flex: 0.4,
      paddingRight: 12,
    },
    infoRowRight: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 0.6,
      justifyContent: 'flex-end',
    },
    label: {
      fontSize: 16,
      flex: 1,
    },
    value: {
      fontSize: 16,
      textAlign: 'right',
      marginRight: 8,
      flex: 1,
    },
    copyButton: {
      padding: 8,
      marginLeft: 8,
    },
    copyIcon: {
      color: colors.foregroundColor,
      opacity: 0.6,
    },
    copiedIcon: {
      color: colors.successColor,
      opacity: 1,
    },
    smallAmountRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 8,
      backgroundColor: `${colors.formBorder}15`,
    },
    smallAmountLabel: {
      fontSize: 14,
      color: colors.foregroundColor,
      opacity: 0.85,
    },
  });

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={styles.scrollView}>
      <BlueCard style={stylesHook.card}>
        <View style={styles.container}>
          <View style={styles.inputContainer}>
            <TextInput
              value={profileId}
              onChangeText={text => {
                setProfileId(text);
                setError(null);
              }}
              placeholder={loc.profile_verification?.enter_profile_id ?? 'Enter Profile ID'}
              placeholderTextColor={colors.alternativeTextColor}
              style={[styles.input, stylesHook.input]}
              autoCorrect={false}
              autoCapitalize="none"
              spellCheck={false}
              multiline={false}
              numberOfLines={1}
              testID="ProfileIdInput"
            />
            <BlueButtonLink 
              ref={scanButtonRef} 
              title="Scan QR" 
              onPress={importScan}
              style={stylesHook.scanButton}
            />
          </View>

          {error && (
            <View style={styles.errorContainer}>
              <Icon name="error" size={16} color={colors.failedColor} />
              <Text style={[styles.errorText, stylesHook.errorText]}>{error}</Text>
            </View>
          )}

          <View style={styles.verifyButtonContainer}>
            <Button
              onPress={handleVerify}
              title={isLoading ? 'Verifying...' : 'Verify'}
              disabled={!profileId || isLoading}
              testID="VerifyButton"
              style={[
                styles.verifyButton,
                stylesHook.verifyButton,
                (!profileId || isLoading) && stylesHook.verifyButtonDisabled
              ]}
              buttonTextColor={stylesHook.verifyButtonText?.color}
            />
          </View>
          
          {isLoading && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.foregroundColor} />
            </View>
          )}
          
          {profile && (
            <Animated.View 
              style={[
                styles.profileContainer,
                stylesHook.profileCard,
                {
                  opacity: fadeAnim,
                  transform: [{ translateY: slideAnim }]
                }
              ]}
            >
              <View style={styles.profileContent}>
                {/* Basic Information */}
                <Text style={[styles.sectionTitle, stylesHook.sectionTitle]}>Basic Information</Text>
                <InfoRow 
                  label="Trust Level" 
                  value={profile.rps} 
                  info="Reputation Points (RPs) indicate the trust level of this profile"
                />
                <InfoRow 
                  label="Generated RPs" 
                  value={profile.generatedRPs} 
                  info="Reputation Points generated by this profile"
                />
                <InfoRow 
                  label="Balance" 
                  value={profile.balance} 
                  info="Current balance of this profile in satoshis"
                />
                <InfoRow 
                  label="Creator" 
                  value={profile.creator} 
                  copyable 
                  info="The creator of this profile"
                />
                <InfoRow 
                  label="Owner" 
                  value={profile.owner} 
                  copyable 
                  info="The current owner of this profile"
                />
                <InfoRow 
                  label="Signer" 
                  value={profile.signer} 
                  copyable 
                  info="The signer key for this profile"
                />
                <InfoRow 
                  label="Status" 
                  value={profile.isBanned ? "Banned" : profile.isCandidate ? "Candidate" : "Active"}
                  info="Current status of the profile"
                />
                <InfoRow 
                  label="Is Domain" 
                  value={profile.isDomain ? "Yes" : "No"}
                  info="Whether this profile represents a domain"
                />
                
                {/* Profile Details */}
                {(profile.name || profile.link || profile.appData) && (
                  <>
                    <Text style={[styles.sectionTitle, stylesHook.sectionTitle]}>Profile Details</Text>
                    {profile.name && (
                      <InfoRow 
                        label="Name" 
                        value={profile.name} 
                        info="The name associated with this profile"
                      />
                    )}
                    {profile.link && (
                      <InfoRow 
                        label="Link" 
                        value={profile.link} 
                        copyable
                        info="External link associated with this profile"
                      />
                    )}
                    {profile.appData && (
                      <InfoRow 
                        label="App Data" 
                        value={profile.appData} 
                        copyable
                        info="Application-specific data for this profile"
                      />
                    )}
                  </>
                )}
                
                {/* Ownership Information */}
                <Text style={[styles.sectionTitle, stylesHook.sectionTitle]}>Ownership Information</Text>
                <InfoRow 
                  label="Owned Profiles" 
                  value={profile.ownedProfilesCount}
                  info="Number of profiles owned by this owner"
                />
                <InfoRow 
                  label="Contribution" 
                  value={profile.contribution}
                  info="Contribution level of this profile"
                />
                
                {/* Rental Information */}
                {(profile.isRented || profile.tenant) && (
                  <>
                    <Text style={[styles.sectionTitle, stylesHook.sectionTitle]}>Rental Information</Text>
                    <InfoRow 
                      label="Is Rented" 
                      value={profile.isRented ? "Yes" : "No"}
                      info="Whether this profile is currently rented"
                    />
                    {profile.tenant && (
                      <InfoRow 
                        label="Rented To" 
                        value={profile.tenant} 
                        copyable
                        info="Current tenant of this profile"
                      />
                    )}
                    {(profile.duration > 0) && (
                      <InfoRow 
                        label="Rental Period" 
                        value={profile.duration}
                        info="Duration of the current rental period in blocks and approximate days"
                      />
                    )}
                    {(profile.rentedAt > 0) && (
                      <InfoRow 
                        label="Rented at Block" 
                        value={profile.rentedAt}
                        info="Block number when the rental started"
                      />
                    )}
                  </>
                )}
                
                {/* Market Information */}
                {(profile.offeredAt > 0 || profile.bidAmount > 0 || profile.buyer || profile.bidTarget || profile.balance > 0) && (
                  <>
                    <Text style={[styles.sectionTitle, stylesHook.sectionTitle]}>Market Information</Text>
                    {profile.offeredAt > 0 && (
                      <InfoRow 
                        label="Offered At" 
                        value={profile.offeredAt}
                        info="Block number when this profile was offered for sale"
                      />
                    )}
                    {profile.bidAmount > 0 && (
                      <InfoRow 
                        label="Bid Amount" 
                        value={profile.bidAmount}
                        info="Current bid amount for this profile"
                      />
                    )}
                    {profile.buyer && (
                      <InfoRow 
                        label="Buyer" 
                        value={profile.buyer}
                        copyable
                        info="Current buyer for this profile"
                      />
                    )}
                    {profile.bidTarget && (
                      <InfoRow 
                        label="Bid Target" 
                        value={profile.bidTarget}
                        copyable
                        info="Target of the current bid"
                      />
                    )}
                    {profile.balance > 0 && (
                      <InfoRow 
                        label="Balance" 
                        value={profile.balance}
                        info="Current balance of this profile"
                      />
                    )}
                  </>
                )}
              </View>
            </Animated.View>
          )}
        </View>
      </BlueCard>
    </ScrollView>
  );
};

export default ProfileVerification;
