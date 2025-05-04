'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.encodeParamValue =
  exports.encodeMonetaryValue =
    void 0;

/**
 * Converts a decimal value to the appropriate byte representation based on parameter type
 * @param {number} paramId - The parameter ID
 * @param {number|string} decimalValue - The value in decimal format
 * @returns {Buffer} - The encoded parameter value
 */
const encodeParamValue = (paramId, decimalValue) => {
    // Get parameter type based on paramId
    const paramType = getParameterType(paramId);
    
    switch (paramType) {
      case 'TYPE_SIZE_T':
        return encodeSizeT(decimalValue);
      
      case 'TYPE_INT':
        return encodeInt(decimalValue);
      
      case 'TYPE_INT64':
        return encodeInt64(decimalValue);
      
      default:
        throw new Error(`Unknown parameter type for parameter ID: ${paramId}`);
    }
  }

  exports.encodeParamValue = encodeParamValue;
  
  /**
   * Returns the type of a parameter based on its ID
   * @param {number} paramId - The parameter ID
   * @returns {string} - The parameter type ('TYPE_SIZE_T', 'TYPE_INT', or 'TYPE_INT64')
   */
  const getParameterType = (paramId) => {
    // This mapping should match your C++ parameterTypes map
    const parameterTypes = {
      1: 'TYPE_SIZE_T',    // SENATE_MAX_SIZE
      2: 'TYPE_SIZE_T',    // SENATE_MIN_SIZE
      3: 'TYPE_INT',       // ACTIVE_PROFILES_WINDOW
      4: 'TYPE_SIZE_T',    // PROFILE_DECAY_FACTOR
      5: 'TYPE_INT64',     // TOTAL_SUPPLY_LIMIT
      6: 'TYPE_INT64',     // MINIMUM_PAYMENT
      7: 'TYPE_INT64',     // LEADERSHIP_THRESHOLD
      8: 'TYPE_INT64',     // SENATE_THRESHOLD
      9: 'TYPE_INT64',     // ORGANIZATION_THRESHOLD
      10: 'TYPE_INT64',    // REDEEM_THRESHOLD
      11: 'TYPE_INT64',    // RPS_PER_PROFILE
      12: 'TYPE_INT64',    // MISS_SLASHING_AMOUNT
      13: 'TYPE_INT',      // MAX_ALLOWED_MISSES
      14: 'TYPE_INT',      // FREE_PROFILES_NO
      15: 'TYPE_INT',      // RPS_GENERATION_PERCENTAGE
      16: 'TYPE_INT64',    // BASE_MISSED_BLOCK_PUNISHMENT
      17: 'TYPE_INT',      // PUNISHMENT_SCALING_FACTOR
      18: 'TYPE_INT',      // LOTTERY_REWARD_PERCENTAGE
      19: 'TYPE_INT64',    // LOTTERY_MIN_REWARD_AMOUNT
      20: 'TYPE_INT64',    // LOTTERY_THRESHOLD
      21: 'TYPE_SIZE_T',   // MAX_LOTTERY_PROFILES
      22: 'TYPE_INT'       // SUPPORT_EFFICIENCY_WINDOW
    };
    
    return parameterTypes[paramId] || 'TYPE_INT';
  }
  
  /**
   * Encodes a size_t value as a Buffer
   * @param {number} value - The value to encode
   * @returns {Buffer} - The encoded value
   */
  const encodeSizeT = (value) => {
    // Convert to number and ensure it's non-negative
    const numValue = Number(value);
    if (isNaN(numValue) || numValue < 0) {
      throw new Error('size_t value must be a non-negative number');
    }
    
    // For JavaScript, we'll use 8 bytes for size_t (to be safe)
    const buffer = Buffer.alloc(8);
    
    // Write as big-endian 64-bit unsigned integer
    if (numValue <= Number.MAX_SAFE_INTEGER) {
      buffer.writeBigUInt64BE(BigInt(numValue), 0);
    } else {
      // Handle larger numbers using BigInt
      buffer.writeBigUInt64BE(BigInt(value), 0);
    }
    
    return buffer;
  }
  
  /**
   * Encodes an int value as a Buffer
   * @param {number} value - The value to encode
   * @returns {Buffer} - The encoded value
   */
  const encodeInt = (value) => {
    // Convert to number
    const numValue = Number(value);
    if (isNaN(numValue)) {
      throw new Error('int value must be a number');
    }
    
    // Use 4 bytes for int
    const buffer = Buffer.alloc(4);
    buffer.writeInt32BE(numValue, 0);
    
    return buffer;
  }
  
  /**
   * Encodes an int64 value as a Buffer
   * @param {number|string} value - The value to encode (can be a string for large numbers)
   * @returns {Buffer} - The encoded value
   */
  const encodeInt64 = (value) => {
    // Use 8 bytes for int64
    const buffer = Buffer.alloc(8);
    
    // Handle both number and string inputs (for large values)
    try {
      const bigIntValue = BigInt(value);
      buffer.writeBigInt64BE(bigIntValue, 0);
    } catch (e) {
      throw new Error(`Failed to encode int64 value: ${value}. Error: ${e.message}`);
    }
    
    return buffer;
  }
  
  /**
   * Special handling for monetary values (those using COIN units)
   * @param {number|string} value - The value in whole coins (e.g., 1.5 BTC)
   * @returns {Buffer} - The encoded value in satoshis
   */
  const encodeMonetaryValue = (value) => {
    // Convert to satoshis (1 coin = 100,000,000 satoshis)
    const COIN = 100000000;
    
    // Handle decimal values
    let satoshis;
    if (typeof value === 'string' && value.includes('.')) {
      // Parse as decimal
      const parts = value.split('.');
      const whole = parts[0] || '0';
      let fraction = parts[1] || '0';
      
      // Pad with zeros if needed
      if (fraction.length > 8) {
        throw new Error('Too many decimal places for coin value');
      }
      
      fraction = fraction.padEnd(8, '0');
      satoshis = BigInt(whole) * BigInt(COIN) + BigInt(fraction);
    } else {
      // Whole number of coins
      satoshis = BigInt(value) * BigInt(COIN);
    }
    
    // Encode as int64
    const buffer = Buffer.alloc(8);
    buffer.writeBigInt64BE(satoshis, 0);
    
    return buffer;
  }
  
  exports.encodeMonetaryValue = encodeMonetaryValue;