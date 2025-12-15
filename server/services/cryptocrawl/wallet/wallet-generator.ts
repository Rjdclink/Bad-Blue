/**
 * CRYPTOCRAWL Secure Wallet Generator
 * 
 * Generates and securely stores operational wallet for multi-chain operations.
 * 
 * Security Features:
 * - AES-256-GCM encryption for private key storage
 * - Environment variable isolation
 * - Key derivation with PBKDF2
 * 
 * Run: npx tsx server/services/cryptocrawl/wallet/wallet-generator.ts
 */

import { ethers, Wallet } from 'ethers';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const KEY_DERIVATION_ITERATIONS = 100000;

interface WalletData {
  address: string;
  encryptedPrivateKey: string;
  salt: string;
  iv: string;
  authTag: string;
  createdAt: string;
  chains: string[];
}

interface GeneratedWallet {
  address: string;
  privateKey: string;
}

// Generate a new Ethereum-compatible wallet
function generateWallet(): GeneratedWallet {
  const wallet = Wallet.createRandom();
  return {
    address: wallet.address,
    privateKey: wallet.privateKey
  };
}

// Derive encryption key from password
function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(
    password,
    salt,
    KEY_DERIVATION_ITERATIONS,
    32, // 256 bits for AES-256
    'sha512'
  );
}

// Encrypt private key
function encryptPrivateKey(privateKey: string, password: string): {
  encrypted: string;
  salt: string;
  iv: string;
  authTag: string;
} {
  const salt = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);
  const key = deriveKey(password, salt);
  
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  let encrypted = cipher.update(privateKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return {
    encrypted,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex')
  };
}

// Decrypt private key
function decryptPrivateKey(
  encrypted: string,
  password: string,
  salt: string,
  iv: string,
  authTag: string
): string {
  const key = deriveKey(password, Buffer.from(salt, 'hex'));
  const decipher = crypto.createDecipheriv(
    ENCRYPTION_ALGORITHM,
    key,
    Buffer.from(iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

// Load existing wallet from file
function loadWallet(walletPath: string): WalletData | null {
  try {
    if (fs.existsSync(walletPath)) {
      const data = fs.readFileSync(walletPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading wallet:', error);
  }
  return null;
}

// Save wallet to file
function saveWallet(walletPath: string, walletData: WalletData): void {
  const dir = path.dirname(walletPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(walletPath, JSON.stringify(walletData, null, 2), { mode: 0o600 });
}

// Main wallet generation and setup
async function setupOperationalWallet(): Promise<void> {
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║       CRYPTOCRAWL WALLET GENERATION & CONFIGURATION           ║');
  console.log('║       Secure Multi-Chain Operational Wallet Setup             ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  const walletDir = path.join(process.cwd(), 'server', 'services', 'cryptocrawl', 'wallet');
  const walletPath = path.join(walletDir, '.wallet.enc.json');
  const envPath = path.join(process.cwd(), '.env');
  
  // Get or generate encryption password
  let encryptionPassword = process.env.WALLET_ENCRYPTION_PASSWORD;
  if (!encryptionPassword) {
    // Generate a secure random password if not set
    encryptionPassword = crypto.randomBytes(32).toString('hex');
    console.log('⚠️  No WALLET_ENCRYPTION_PASSWORD set. Generated secure password.');
    console.log('    SAVE THIS PASSWORD SECURELY - it\'s needed to decrypt your wallet:\n');
    console.log(`    WALLET_ENCRYPTION_PASSWORD=${encryptionPassword}\n`);
  }

  // Check for existing wallet
  let walletData = loadWallet(walletPath);
  let wallet: GeneratedWallet;
  let isNewWallet = false;

  if (walletData) {
    console.log('📁 Existing wallet found. Loading...\n');
    try {
      const privateKey = decryptPrivateKey(
        walletData.encryptedPrivateKey,
        encryptionPassword,
        walletData.salt,
        walletData.iv,
        walletData.authTag
      );
      wallet = {
        address: walletData.address,
        privateKey
      };
      console.log(`✅ Wallet decrypted successfully`);
      console.log(`   Address: ${wallet.address}\n`);
    } catch (error) {
      console.log('❌ Failed to decrypt wallet. Password may be incorrect.');
      console.log('   Generating new wallet...\n');
      wallet = generateWallet();
      isNewWallet = true;
    }
  } else {
    console.log('🔐 No existing wallet found. Generating new operational wallet...\n');
    wallet = generateWallet();
    isNewWallet = true;
  }

  // Encrypt and save new wallet if needed
  if (isNewWallet) {
    const encryption = encryptPrivateKey(wallet.privateKey, encryptionPassword);
    walletData = {
      address: wallet.address,
      encryptedPrivateKey: encryption.encrypted,
      salt: encryption.salt,
      iv: encryption.iv,
      authTag: encryption.authTag,
      createdAt: new Date().toISOString(),
      chains: ['polygon', 'arbitrum', 'avalanche', 'bsc']
    };
    saveWallet(walletPath, walletData);
    console.log('✅ New wallet generated and encrypted');
    console.log(`   Address: ${wallet.address}`);
    console.log(`   Saved to: ${walletPath}\n`);
  }

  // Generate environment configuration
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                ENVIRONMENT CONFIGURATION');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const envConfig = `
# ═══════════════════════════════════════════════════════════════
# CRYPTOCRAWL OPERATIONAL WALLET CONFIGURATION
# Generated: ${new Date().toISOString()}
# ═══════════════════════════════════════════════════════════════

# Bridge Wallet for Asset Tracking (PUBLIC ADDRESS - safe to share)
BRIDGE_WALLET_ADDRESS=${wallet.address}

# Payout Wallet Configuration
CRYPTO_PAYOUT_WALLET_ADDRESS=${wallet.address}
CRYPTO_BACKUP_WALLET_ADDRESS=${wallet.address}

# Wallet Security (KEEP SECRET!)
WALLET_ENCRYPTION_PASSWORD=${encryptionPassword}
WALLET_ENCRYPTION_SALT=${walletData?.salt || crypto.randomBytes(32).toString('hex')}

# Transaction Signing (KEEP EXTREMELY SECRET!)
# PRIVATE_KEY=${wallet.privateKey}

# ═══════════════════════════════════════════════════════════════
# CRYPTOCRAWL AUTHENTICATION (OPTIONAL - system runs without)
# ═══════════════════════════════════════════════════════════════
CRYPTOCRAWL_EMAIL=
CRYPTOCRAWL_PASSWORD=

# ═══════════════════════════════════════════════════════════════
# CHAIN RPC ENDPOINTS (Using public endpoints - upgrade for production)
# ═══════════════════════════════════════════════════════════════
POLYGON_RPC_URL=https://polygon-rpc.com
ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc
AVALANCHE_RPC_URL=https://api.avax.network/ext/bc/C/rpc
BSC_RPC_URL=https://bsc-dataseed.binance.org
`;

  // Append to .env or create it
  let existingEnv = '';
  if (fs.existsSync(envPath)) {
    existingEnv = fs.readFileSync(envPath, 'utf8');
  }

  // Check if wallet config already exists
  if (existingEnv.includes('BRIDGE_WALLET_ADDRESS=')) {
    console.log('⚠️  .env already contains BRIDGE_WALLET_ADDRESS');
    console.log('   Updating with new configuration...\n');
    
    // Update existing values
    const updates: Record<string, string> = {
      'BRIDGE_WALLET_ADDRESS': wallet.address,
      'CRYPTO_PAYOUT_WALLET_ADDRESS': wallet.address,
      'CRYPTO_BACKUP_WALLET_ADDRESS': wallet.address,
      'WALLET_ENCRYPTION_PASSWORD': encryptionPassword,
    };
    
    for (const [key, value] of Object.entries(updates)) {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (existingEnv.match(regex)) {
        existingEnv = existingEnv.replace(regex, `${key}=${value}`);
      } else {
        existingEnv += `\n${key}=${value}`;
      }
    }
    
    fs.writeFileSync(envPath, existingEnv);
  } else {
    fs.appendFileSync(envPath, envConfig);
    console.log('✅ Environment configuration added to .env\n');
  }

  // Display wallet info
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                    WALLET DETAILS');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  console.log(`   🔑 Wallet Address: ${wallet.address}`);
  console.log('');
  console.log('   📍 Supported Chains:');
  console.log('      • Polygon (POL + USDT + USDC)');
  console.log('      • Arbitrum (ETH + USDT + USDC)');
  console.log('      • Avalanche (AVAX + USDT + USDC)');
  console.log('      • BSC (BNB + USDT + USDC)');
  console.log('');
  console.log('   🔗 Block Explorer Links:');
  console.log(`      • https://polygonscan.com/address/${wallet.address}`);
  console.log(`      • https://arbiscan.io/address/${wallet.address}`);
  console.log(`      • https://snowtrace.io/address/${wallet.address}`);
  console.log(`      • https://bscscan.com/address/${wallet.address}`);
  
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                    FUNDING INSTRUCTIONS');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  console.log('   To make the system fully operational, fund the wallet with:');
  console.log('');
  console.log('   Recommended Initial Funding:');
  console.log('      • 10-50 USDT/USDC on each chain (stablecoin positions)');
  console.log('      • Small amount of native tokens for gas:');
  console.log('        - 0.5-1 POL on Polygon');
  console.log('        - 0.001-0.005 ETH on Arbitrum');
  console.log('        - 0.1-0.5 AVAX on Avalanche');
  console.log('        - 0.01-0.05 BNB on BSC');
  console.log('');
  console.log('   ⚠️  IMPORTANT: This is a HOT WALLET. Only fund with amounts');
  console.log('      you are comfortable having in an automated trading system.');
  
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('   ✅ WALLET CONFIGURATION COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Export wallet address for verification
  console.log(`export BRIDGE_WALLET_ADDRESS=${wallet.address}`);
}

// Run setup
setupOperationalWallet().catch(error => {
  console.error('Wallet setup failed:', error);
  process.exit(1);
});
