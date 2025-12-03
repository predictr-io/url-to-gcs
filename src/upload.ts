import * as core from '@actions/core';
import { Storage } from '@google-cloud/storage';
import { Readable } from 'stream';

export interface UploadOptions {
  bucket: string;
  objectName: string;
  stream: Readable;
  contentLengthHint?: number; // Hint from HTTP header (may be 0 for chunked)
  contentType?: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
  storageClass?: string;
  predefinedAcl?: string;
}

export interface UploadResult {
  generation: string;
  gcsUrl: string;
  objectExisted?: boolean;
}

/**
 * Parse key=value pairs from input string
 * Supports both JSON object and semicolon-separated key=value pairs
 */
export function parseKeyValuePairs(input?: string, name = 'input'): Record<string, string> | undefined {
  if (!input || input.trim() === '') {
    return undefined;
  }

  const trimmed = input.trim();

  // Try parsing as JSON first
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        core.warning(`${name} must be a JSON object`);
        return undefined;
      }
      return parsed;
    } catch (error) {
      core.warning(`Failed to parse ${name} as JSON: ${error}`);
    }
  }

  // Parse as semicolon-separated key=value format
  const result: Record<string, string> = {};
  const pairs = trimmed.split(';');

  for (const pair of pairs) {
    const trimmedPair = pair.trim();
    if (trimmedPair === '') continue;

    const separatorIndex = trimmedPair.indexOf('=');
    if (separatorIndex === -1) {
      core.warning(`Skipping invalid ${name} pair: ${trimmedPair}`);
      continue;
    }

    const key = trimmedPair.substring(0, separatorIndex).trim();
    const value = trimmedPair.substring(separatorIndex + 1).trim();

    if (key) {
      result[key] = value;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Parse metadata from input string
 * Supports both JSON object and semicolon-separated key=value pairs
 */
export function parseMetadata(metadataInput?: string): Record<string, string> | undefined {
  return parseKeyValuePairs(metadataInput, 'metadata');
}

/**
 * Validate storage class
 */
function validateStorageClass(storageClass?: string): string | undefined {
  if (!storageClass) return undefined;

  const validClasses = [
    'STANDARD',
    'NEARLINE',
    'COLDLINE',
    'ARCHIVE'
  ];

  if (!validClasses.includes(storageClass)) {
    throw new Error(
      `Invalid storage class: ${storageClass}. Must be one of: ${validClasses.join(', ')}`
    );
  }

  return storageClass;
}

/**
 * Validate predefined ACL
 */
function validatePredefinedAcl(acl?: string): string | undefined {
  if (!acl) return undefined;

  const validAcls = [
    'authenticatedRead',
    'bucketOwnerFullControl',
    'bucketOwnerRead',
    'private',
    'projectPrivate',
    'publicRead'
  ];

  if (!validAcls.includes(acl)) {
    throw new Error(
      `Invalid predefined ACL: ${acl}. Must be one of: ${validAcls.join(', ')}`
    );
  }

  return acl;
}

/**
 * Upload stream to GCS
 * Streams data directly to GCS without storing locally
 *
 * Note: The if-not-exists check is now performed in index.ts BEFORE downloading,
 * so this function no longer needs the ifNotExists parameter.
 */
export async function uploadStreamToGCS(options: UploadOptions): Promise<UploadResult> {
  core.info(`Uploading to GCS: gs://${options.bucket}/${options.objectName}`);

  // Validate inputs
  const storageClass = validateStorageClass(options.storageClass);
  const predefinedAcl = validatePredefinedAcl(options.predefinedAcl);

  // Create GCS client
  // Uses Application Default Credentials (ADC) from environment
  // Set via google-github-actions/auth or GOOGLE_APPLICATION_CREDENTIALS
  const storage = new Storage();

  // Log content length hint if known
  if (options.contentLengthHint && options.contentLengthHint > 0) {
    core.info(`Content-Length hint: ${options.contentLengthHint} bytes (${(options.contentLengthHint / 1024 / 1024).toFixed(2)} MB)`);
  } else {
    core.info(`Content-Length: unknown (will be determined during upload)`);
  }

  // Get bucket and file references
  const bucket = storage.bucket(options.bucket);
  const file = bucket.file(options.objectName);

  // Prepare upload options
  const uploadOptions: {
    contentType?: string;
    metadata?: {
      cacheControl?: string;
      metadata?: Record<string, string>;
    };
    predefinedAcl?: 'authenticatedRead' | 'bucketOwnerFullControl' | 'bucketOwnerRead' | 'private' | 'projectPrivate' | 'publicRead';
    resumable?: boolean;
  } = {
    contentType: options.contentType,
    predefinedAcl: predefinedAcl as any,
    // Use resumable upload for reliability (handles network interruptions)
    resumable: true,
  };

  if (options.cacheControl || options.metadata) {
    uploadOptions.metadata = {};
    if (options.cacheControl) {
      uploadOptions.metadata.cacheControl = options.cacheControl;
    }
    if (options.metadata) {
      uploadOptions.metadata.metadata = options.metadata;
    }
  }

  // Log upload parameters
  core.info(`Content-Type: ${uploadOptions.contentType || 'not specified'}`);
  if (predefinedAcl) {
    core.info(`Predefined ACL: ${predefinedAcl}`);
  }
  if (storageClass) {
    core.info(`Storage Class: ${storageClass}`);
  }
  if (options.cacheControl) {
    core.info(`Cache-Control: ${options.cacheControl}`);
  }
  if (options.metadata) {
    core.info(`Metadata: ${JSON.stringify(options.metadata)}`);
  }

  // Upload to GCS
  try {
    core.info('Starting streaming upload to GCS...');

    // Create upload stream
    const writeStream = file.createWriteStream(uploadOptions);

    // Track upload progress
    let uploadedBytes = 0;
    options.stream.on('data', (chunk: Buffer) => {
      uploadedBytes += chunk.length;
      if (uploadedBytes % (1024 * 1024 * 10) === 0 || uploadedBytes < 1024 * 1024 * 10) {
        core.info(`Uploaded: ${(uploadedBytes / 1024 / 1024).toFixed(2)} MB`);
      }
    });

    // Pipe stream to GCS
    const uploadPromise = new Promise<void>((resolve, reject) => {
      writeStream.on('error', reject);
      writeStream.on('finish', resolve);
      options.stream.pipe(writeStream);
    });

    await uploadPromise;

    // Set storage class if specified (done after upload)
    if (storageClass) {
      await file.setStorageClass(storageClass);
    }

    // Get file metadata to retrieve generation
    const [metadata] = await file.getMetadata();
    const generation = String(metadata.generation || '');

    const gcsUrl = `gs://${options.bucket}/${options.objectName}`;

    core.info(`Successfully uploaded to GCS`);
    core.info(`Generation: ${generation}`);

    return {
      generation,
      gcsUrl,
      objectExisted: false,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to upload to GCS: ${error.message}`);
    }
    throw error;
  }
}
