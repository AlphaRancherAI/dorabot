import { homedir } from 'os';
import { join } from 'path';

export const JARVIS_DIR = process.env.JARVIS_HOME || join(homedir(), '.jarvis');
export const JARVIS_LOGS_DIR = join(JARVIS_DIR, 'logs');
export const GATEWAY_TOKEN_PATH = join(JARVIS_DIR, 'gateway-token');
export const GATEWAY_SOCKET_PATH = join(JARVIS_DIR, 'gateway.sock');
export const GATEWAY_LOG_PATH = join(JARVIS_LOGS_DIR, 'gateway.log');
