import { homedir } from 'os';
import { join } from 'path';

export const DORABOT_DIR = join(homedir(), '.dorabot');
export const DORABOT_LOGS_DIR = join(DORABOT_DIR, 'logs');
export const GATEWAY_TOKEN_PATH = join(DORABOT_DIR, 'gateway-token');
export const GATEWAY_SOCKET_PATH = join(DORABOT_DIR, 'gateway.sock');
export const GATEWAY_LOG_PATH = join(DORABOT_LOGS_DIR, 'gateway.log');
