// encryption.service.ts
import { HttpStatus, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { AppException } from '../../errors/exception-types';

/** Size in bytes of the AES-256 key. */
const KEY_LENGTH = 32;

/**
 * Service that encrypts and decrypts secrets at rest with AES-256-GCM.
 * The key comes from `ENCRYPTION_KEY`, 64 hex characters (32 bytes).
 */
@Injectable()
export class EncryptionService {
  /** Encryption algorithm. */
  private readonly algorithm = 'aes-256-gcm';

  /** AES-256 key decoded from ENCRYPTION_KEY. */
  private readonly key = Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'hex');

  /**
   * Encrypts a given string.
   * @param text the string to encrypt.
   * @returns the encrypted string.
   */
  encrypt(text: string): string {
    this._assertKey();
    const iv = randomBytes(16);
    const cipher = createCipheriv(this.algorithm, this.key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Format: iv(32) + authTag(32) + encrypted
    return iv.toString('hex') + authTag.toString('hex') + encrypted;
  }

  /**
   * Decrypts a given string.
   * @param encryptedData the encrypted string.
   * @returns the decrypted string.
   */
  decrypt(encryptedData: string): string {
    this._assertKey();
    const iv = Buffer.from(encryptedData.slice(0, 32), 'hex');
    const authTag = Buffer.from(encryptedData.slice(32, 64), 'hex');
    const encrypted = encryptedData.slice(64);
    
    const decipher = createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  /**
   * Validates the key length, so a missing or malformed ENCRYPTION_KEY surfaces
   * with its name instead of a generic crypto error.
   * @throws AppException if the key is not 32 bytes long.
   */
  private _assertKey(): void {
    if (this.key.length !== KEY_LENGTH) {
      throw new AppException(
        `ENCRYPTION_KEY must be ${KEY_LENGTH} bytes (64 hex characters), got ${this.key.length} bytes.`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
