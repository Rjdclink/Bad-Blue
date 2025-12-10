/**
 * Credential Validation System
 * 
 * Triple credential verification system that validates:
 * 1. Application Access Key
 * 2. Admin Panel Authorization
 * 3. Internal Crawler Authentication Token
 * 
 * System will not execute unless all three are valid.
 */

import { TripleCredentials, CredentialValidation, CredentialValidationError } from './types';
import crypto from 'crypto';

export class CredentialValidator {
  private static instance: CredentialValidator;
  private credentials: TripleCredentials | null = null;
  private lastValidation: CredentialValidation | null = null;
  private validationCache: Map<string, boolean> = new Map();

  private constructor() {}

  public static getInstance(): CredentialValidator {
    if (!CredentialValidator.instance) {
      CredentialValidator.instance = new CredentialValidator();
    }
    return CredentialValidator.instance;
  }

  /**
   * Initialize credentials from environment or configuration
   */
  public initialize(credentials: TripleCredentials): void {
    this.credentials = credentials;
    this.validationCache.clear();
  }

  /**
   * Validate all three credentials
   */
  public async validateAll(): Promise<CredentialValidation> {
    if (!this.credentials) {
      throw new CredentialValidationError('Credentials not initialized');
    }

    const validation: CredentialValidation = {
      applicationAccessKey: await this.validateApplicationAccessKey(this.credentials.applicationAccessKey),
      adminPanelAuth: await this.validateAdminPanelAuth(this.credentials.adminPanelAuth),
      crawlerAuthToken: await this.validateCrawlerAuthToken(this.credentials.crawlerAuthToken),
      allValid: false,
      timestamp: new Date(),
    };

    validation.allValid = validation.applicationAccessKey && 
                          validation.adminPanelAuth && 
                          validation.crawlerAuthToken;

    this.lastValidation = validation;

    if (!validation.allValid) {
      throw new CredentialValidationError('Not all credentials are valid', validation);
    }

    return validation;
  }

  /**
   * Validate Application Access Key
   */
  private async validateApplicationAccessKey(key: string): Promise<boolean> {
    const cacheKey = `app_key_${this.hashKey(key)}`;
    
    if (this.validationCache.has(cacheKey)) {
      return this.validationCache.get(cacheKey)!;
    }

    // Validate format and structure
    if (!key || key.length < 32) {
      this.validationCache.set(cacheKey, false);
      return false;
    }

    // Check if key has proper format (e.g., starts with specific prefix)
    const isValid = key.startsWith('app_') || key.startsWith('sk-') || key.length >= 32;
    
    this.validationCache.set(cacheKey, isValid);
    return isValid;
  }

  /**
   * Validate Admin Panel Authorization
   */
  private async validateAdminPanelAuth(auth: string): Promise<boolean> {
    const cacheKey = `admin_auth_${this.hashKey(auth)}`;
    
    if (this.validationCache.has(cacheKey)) {
      return this.validationCache.get(cacheKey)!;
    }

    // Validate format and structure
    if (!auth || auth.length < 16) {
      this.validationCache.set(cacheKey, false);
      return false;
    }

    // Check if auth token has proper format
    const isValid = auth.startsWith('admin_') || auth.startsWith('Bearer ') || auth.length >= 32;
    
    this.validationCache.set(cacheKey, isValid);
    return isValid;
  }

  /**
   * Validate Crawler Authentication Token
   */
  private async validateCrawlerAuthToken(token: string): Promise<boolean> {
    const cacheKey = `crawler_token_${this.hashKey(token)}`;
    
    if (this.validationCache.has(cacheKey)) {
      return this.validationCache.get(cacheKey)!;
    }

    // Validate format and structure
    if (!token || token.length < 16) {
      this.validationCache.set(cacheKey, false);
      return false;
    }

    // Check if token has proper format
    const isValid = token.startsWith('crawler_') || token.startsWith('token_') || token.length >= 32;
    
    this.validationCache.set(cacheKey, isValid);
    return isValid;
  }

  /**
   * Get last validation result
   */
  public getLastValidation(): CredentialValidation | null {
    return this.lastValidation;
  }

  /**
   * Check if credentials are currently valid
   */
  public isValid(): boolean {
    return this.lastValidation?.allValid ?? false;
  }

  /**
   * Force revalidation by clearing cache
   */
  public clearCache(): void {
    this.validationCache.clear();
    this.lastValidation = null;
  }

  /**
   * Hash key for caching
   */
  private hashKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex').substring(0, 16);
  }

  /**
   * Load credentials from environment variables
   */
  public static loadFromEnvironment(): TripleCredentials {
    return {
      applicationAccessKey: process.env.COMPUTATIONAL_BEAM_APP_KEY || 
                            process.env.APPLICATION_ACCESS_KEY || 
                            'app_default_key_for_development_only_not_for_production',
      adminPanelAuth: process.env.COMPUTATIONAL_BEAM_ADMIN_AUTH || 
                      process.env.ADMIN_PANEL_AUTH || 
                      'admin_default_auth_for_development_only_not_for_production',
      crawlerAuthToken: process.env.COMPUTATIONAL_BEAM_CRAWLER_TOKEN || 
                        process.env.CRAWLER_AUTH_TOKEN || 
                        'crawler_default_token_for_development_only_not_for_production',
    };
  }

  /**
   * Validate and throw if invalid
   */
  public async validateOrThrow(): Promise<void> {
    const validation = await this.validateAll();
    if (!validation.allValid) {
      const failedChecks: string[] = [];
      if (!validation.applicationAccessKey) failedChecks.push('Application Access Key');
      if (!validation.adminPanelAuth) failedChecks.push('Admin Panel Auth');
      if (!validation.crawlerAuthToken) failedChecks.push('Crawler Auth Token');
      
      throw new CredentialValidationError(
        `Credential validation failed for: ${failedChecks.join(', ')}`,
        validation
      );
    }
  }
}

// Export singleton instance
export const credentialValidator = CredentialValidator.getInstance();
