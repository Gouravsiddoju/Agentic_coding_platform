/**
 * Environment Flag: Is Platform
 * Indicates if the app is running in Platform mode (hosted) or OSS mode (self-hosted)
 */
export const IS_PLATFORM = process.env.IS_PLATFORM === 'true' || false;

/**
 * OptCode API endpoint (internal LLM service)
 */
export const OPTCODE_API_URL = process.env.OPTCODE_API_URL || 'http://192.168.1.117:8006';

/**
 * OptCode model identifier
 */
export const OPTCODE_MODEL = process.env.OPTCODE_MODEL || 'OptGPT-4:latest';

/**
 * HTTP server port
 */
export const SERVER_PORT = process.env.SERVER_PORT || 3001;

/**
 * JWT signing secret
 */
export const JWT_SECRET = process.env.JWT_SECRET;
