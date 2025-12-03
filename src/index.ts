import * as core from '@actions/core';
import { Storage } from '@google-cloud/storage';
import { downloadAsStream, parseHeaders } from './download';
import { uploadStreamToGCS, parseMetadata } from './upload';

/**
 * Check if a GCS object exists
 * Returns true if the object exists, false otherwise
 */
async function objectExists(storage: Storage, bucket: string, objectName: string): Promise<boolean> {
  try {
    const [exists] = await storage.bucket(bucket).file(objectName).exists();
    return exists;
  } catch (error: any) {
    // Re-throw errors (permissions, etc.)
    throw error;
  }
}

/**
 * Main action entry point
 * Streams content directly from URL to GCS without storing locally
 */
async function run(): Promise<void> {
  try {
    // Get inputs
    const url = core.getInput('url', { required: true });
    const gcsBucket = core.getInput('gcs-bucket', { required: true });
    const gcsObject = core.getInput('gcs-object', { required: true });

    const method = core.getInput('method') || 'GET';
    const headersInput = core.getInput('headers');
    const postData = core.getInput('post-data');
    const timeout = parseInt(core.getInput('timeout') || '900000', 10);
    const enableRetry = core.getInput('enable-retry') === 'true';

    const authType = core.getInput('auth-type') as 'none' | 'basic' | 'bearer';
    const authUsername = core.getInput('auth-username');
    const authPassword = core.getInput('auth-password');
    const authToken = core.getInput('auth-token');

    const contentTypeOverride = core.getInput('content-type');
    const cacheControl = core.getInput('cache-control');
    const metadataInput = core.getInput('metadata');
    const storageClass = core.getInput('storage-class') || 'STANDARD';
    const predefinedAcl = core.getInput('predefined-acl');
    const ifNotExists = core.getInput('if-not-exists') === 'true';

    // Parse headers and metadata
    const headers = parseHeaders(headersInput);
    const metadata = parseMetadata(metadataInput);

    // Check if object exists BEFORE downloading (if if-not-exists flag is set)
    // This avoids unnecessary bandwidth usage when the object already exists
    if (ifNotExists) {
      core.info('Checking if GCS object already exists...');
      const storage = new Storage();
      const exists = await objectExists(storage, gcsBucket, gcsObject);

      if (exists) {
        core.info(`Object already exists at gs://${gcsBucket}/${gcsObject}`);
        core.info('Skipping download and upload due to if-not-exists flag');

        // Set outputs for skipped operation
        core.setOutput('status-code', '0'); // No HTTP request made
        core.setOutput('content-length', '0'); // No bytes transferred
        core.setOutput('gcs-url', `gs://${gcsBucket}/${gcsObject}`);
        core.setOutput('generation', ''); // Unknown generation
        core.setOutput('object-existed', 'true');

        core.info('✓ Action completed - object already existed, no download or upload needed');
        return; // Exit early
      }

      core.info('Object does not exist, proceeding with download and upload');
    }

    core.info('Starting streaming download from URL...');

    // Download from URL (returns a stream)
    const downloadResult = await downloadAsStream({
      url,
      method: method.toUpperCase(),
      headers,
      data: postData,
      timeout,
      enableRetry,
      authType,
      authUsername,
      authPassword,
      authToken,
    });

    core.info('HTTP request successful, streaming to GCS...');

    // Determine content type (use override if provided, otherwise use detected)
    const contentType = contentTypeOverride || downloadResult.contentType;

    // Upload to GCS (streaming directly from download)
    // Note: We've already checked if-not-exists upfront, so no need to check again
    const uploadResult = await uploadStreamToGCS({
      bucket: gcsBucket,
      objectName: gcsObject,
      stream: downloadResult.stream,
      contentLengthHint: downloadResult.contentLengthHeader,
      contentType,
      cacheControl: cacheControl || undefined,
      metadata,
      storageClass,
      predefinedAcl: predefinedAcl || undefined,
    });

    // Upload completed successfully
    core.info('Stream upload completed successfully');

    // Get actual bytes transferred (now that the stream has been fully consumed)
    const actualBytesTransferred = downloadResult.stream.getBytesTransferred();
    core.info(`Total bytes transferred: ${actualBytesTransferred} bytes (${(actualBytesTransferred / 1024 / 1024).toFixed(2)} MB)`);

    // Verify against header if it was provided
    if (downloadResult.contentLengthHeader > 0 && actualBytesTransferred !== downloadResult.contentLengthHeader) {
      core.warning(
        `Bytes transferred (${actualBytesTransferred}) differs from Content-Length header (${downloadResult.contentLengthHeader})`
      );
    }

    // Set all outputs ONLY after the entire operation succeeds
    core.setOutput('status-code', downloadResult.statusCode.toString());
    core.setOutput('content-length', actualBytesTransferred.toString()); // Use actual bytes, not header
    core.setOutput('gcs-url', uploadResult.gcsUrl);
    core.setOutput('generation', uploadResult.generation);
    core.setOutput('object-existed', 'false');

    core.info('✓ Action completed successfully - content streamed directly to GCS');
  } catch (error) {
    // Provide comprehensive error information for debugging
    core.error('Action failed with error:');

    if (error instanceof Error) {
      core.error(`Error: ${error.message}`);

      // Log stack trace for debugging
      if (error.stack) {
        core.error('Stack trace:');
        core.error(error.stack);
      }

      // Check for GCS specific errors
      if ('code' in error || 'errors' in error) {
        core.error('GCS Error Details:');
        const gcsError = error as any;

        if (gcsError.code) {
          core.error(`  Error Code: ${gcsError.code}`);
        }
        if (gcsError.errors) {
          core.error(`  Errors: ${JSON.stringify(gcsError.errors, null, 2)}`);
        }
        if (gcsError.message) {
          core.error(`  Message: ${gcsError.message}`);
        }
      }

      // Check for axios/HTTP specific errors
      if ('response' in error) {
        const axiosError = error as any;
        core.error('HTTP Error Details:');

        if (axiosError.response) {
          core.error(`  Status: ${axiosError.response.status} ${axiosError.response.statusText}`);
          core.error(`  URL: ${axiosError.config?.url}`);
          core.error(`  Method: ${axiosError.config?.method?.toUpperCase()}`);

          if (axiosError.response.headers) {
            core.error('  Response Headers:');
            core.error(JSON.stringify(axiosError.response.headers, null, 2));
          }

          if (axiosError.response.data) {
            core.error('  Response Body:');
            // Limit response body to first 500 chars to avoid log spam
            const responseData = String(axiosError.response.data);
            core.error(responseData.substring(0, 500) + (responseData.length > 500 ? '...' : ''));
          }
        } else if (axiosError.request) {
          core.error('  No response received from server');
          core.error(`  URL: ${axiosError.config?.url}`);
        }
      }

      // Set the failure with a clear message
      core.setFailed(`Action failed: ${error.message}`);
    } else {
      // Handle non-Error objects
      core.error(`Unknown error type: ${typeof error}`);
      core.error(`Error value: ${JSON.stringify(error, null, 2)}`);
      core.setFailed('An unknown error occurred - check logs for details');
    }
  }
}

// Run the action
run();
