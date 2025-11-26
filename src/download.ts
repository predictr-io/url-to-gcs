import * as core from '@actions/core';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { PassThrough } from 'stream';

export interface DownloadOptions {
  url: string;
  method: string;
  headers?: Record<string, string>;
  data?: string;
  timeout?: number;
  enableRetry?: boolean;
  authType?: 'none' | 'basic' | 'bearer';
  authUsername?: string;
  authPassword?: string;
  authToken?: string;
}

/**
 * Custom stream that tracks bytes transferred
 */
export class ByteCountingStream extends PassThrough {
  public bytesTransferred = 0;

  constructor() {
    super();
    this.on('data', (chunk: Buffer) => {
      this.bytesTransferred += chunk.length;
    });
  }

  /**
   * Get the total number of bytes that have passed through the stream
   */
  getBytesTransferred(): number {
    return this.bytesTransferred;
  }
}

export interface DownloadResult {
  statusCode: number;
  contentLengthHeader: number; // From HTTP header (may be 0 for chunked)
  contentType?: string;
  stream: ByteCountingStream;
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
      return JSON.parse(trimmed);
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
 * Parse headers from input string
 * Supports both JSON object and semicolon-separated key=value pairs
 */
export function parseHeaders(headersInput?: string): Record<string, string> | undefined {
  return parseKeyValuePairs(headersInput, 'headers');
}

/**
 * Generate Authorization header based on auth type
 */
function generateAuthHeader(options: DownloadOptions): string | undefined {
  if (!options.authType || options.authType === 'none') {
    return undefined;
  }

  if (options.authType === 'basic') {
    if (!options.authUsername || !options.authPassword) {
      throw new Error('auth-username and auth-password are required for basic authentication');
    }
    const credentials = Buffer.from(`${options.authUsername}:${options.authPassword}`).toString('base64');
    return `Basic ${credentials}`;
  }

  if (options.authType === 'bearer') {
    if (!options.authToken) {
      throw new Error('auth-token is required for bearer authentication');
    }
    return `Bearer ${options.authToken}`;
  }

  return undefined;
}

/**
 * Download content from URL and return as a stream
 * This allows streaming directly to GCS without storing locally
 */
export async function downloadAsStream(
  options: DownloadOptions
): Promise<DownloadResult> {
  core.info(`Downloading from ${options.url}`);
  core.info(`Method: ${options.method}`);

  // Setup authentication
  const authHeader = generateAuthHeader(options);
  const headers = { ...options.headers };
  if (authHeader) {
    headers['Authorization'] = authHeader;
    core.info(`Authentication: ${options.authType}`);
  }

  if (Object.keys(headers).length > 0) {
    core.info(`Headers: ${JSON.stringify(headers, null, 2)}`);
  }

  // Setup timeout
  const timeout = options.timeout || 900000; // Default 15 minutes
  core.info(`Timeout: ${timeout}ms (${(timeout / 1000 / 60).toFixed(1)} minutes)`);

  const config: AxiosRequestConfig = {
    method: options.method,
    url: options.url,
    headers,
    responseType: 'stream',
    maxRedirects: 5,
    timeout,
    validateStatus: (status) => status < 600, // Don't throw on any status code
  };

  // Add request body for POST/PUT/PATCH
  if (options.data && ['POST', 'PUT', 'PATCH'].includes(options.method.toUpperCase())) {
    config.data = options.data;
    core.info(`Request body length: ${options.data.length} bytes`);
  }

  // Retry logic
  const maxRetries = options.enableRetry ? 3 : 0;
  const retryDelay = 1000; // Start with 1 second
  const retryStatusCodes = [408, 429, 500, 502, 503, 504];

  let lastError: Error | undefined;
  let response: AxiosResponse | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = retryDelay * Math.pow(2, attempt - 1);
        core.info(`Retry attempt ${attempt}/${maxRetries} after ${delay}ms delay...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      response = await axios(config);
      lastError = undefined;
      break; // Success!

    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const shouldRetry = options.enableRetry &&
          attempt < maxRetries &&
          (status ? retryStatusCodes.includes(status) : true);

        if (shouldRetry) {
          core.warning(`Request failed (status: ${status || 'unknown'}), will retry...`);
          lastError = new Error(
            `HTTP request failed: ${error.message}${
              error.response ? ` (Status: ${error.response.status})` : ''
            }`
          );
          continue; // Retry
        } else {
          throw new Error(
            `HTTP request failed: ${error.message}${
              error.response ? ` (Status: ${error.response.status})` : ''
            }`
          );
        }
      }
      throw error;
    }
  }

  if (!response) {
    throw lastError || new Error('HTTP request failed after retries');
  }

  const statusCode = response.status;
  core.info(`Response status: ${statusCode}`);

  // Check for error status codes
  if (statusCode >= 400) {
    throw new Error(
      `HTTP request failed with status ${statusCode}: ${response.statusText}`
    );
  }

  const contentType = response.headers['content-type'];
  const contentLengthHeader = parseInt(response.headers['content-length'] || '0', 10);

  core.info(`Content-Type: ${contentType || 'unknown'}`);
  if (contentLengthHeader > 0) {
    core.info(`Content-Length header: ${contentLengthHeader} bytes (${(contentLengthHeader / 1024 / 1024).toFixed(2)} MB)`);
  } else {
    core.info(`Content-Length header: not set (chunked transfer encoding)`);
  }

  // Create a byte-counting stream to track actual bytes transferred
  const byteCounter = new ByteCountingStream();

  // Pipe response through our tracking stream
  response.data.pipe(byteCounter);

  // Handle errors on the source stream
  response.data.on('error', (error: Error) => {
    byteCounter.destroy(error);
  });

  return {
    statusCode,
    contentLengthHeader: contentLengthHeader || 0,
    contentType,
    stream: byteCounter,
  };
}
