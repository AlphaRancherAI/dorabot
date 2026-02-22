#!/usr/bin/env tsx
// WhatsApp login via gateway RPC — displays QR code in terminal

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import qrcode from 'qrcode-terminal';

const TOKEN_FILE = join(homedir(), '.dorabot', 'gateway-token');
const token = readFileSync(TOKEN_FILE, 'utf-8').trim();

const ws = new WebSocket('wss://127.0.0.1:18789', {
  rejectUnauthorized: false,
});

let msgId = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  // handle events (QR codes, status updates)
  if (msg.event) {
    if (msg.event === 'whatsapp.qr') {
      console.log('\nScan this QR code with WhatsApp:\n');
      qrcode.generate(msg.data.qr, { small: true });
    } else if (msg.event === 'whatsapp.login_status') {
      console.log(`[whatsapp] status: ${msg.data.status}`);
      if (msg.data.status === 'connected') {
        console.log('\nWhatsApp connected! You can close this script.');
        setTimeout(() => { ws.close(); process.exit(0); }, 1000);
      } else if (msg.data.status === 'failed') {
        console.error('Login failed:', msg.data.error);
        ws.close();
        process.exit(1);
      }
    }
    return;
  }

  if (msg.id !== undefined && pending.has(msg.id)) {
    const p = pending.get(msg.id)!;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg.result);
  }
});

function rpc(method: string, params?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ method, params, id }));
  });
}

async function main() {
  await new Promise((res) => ws.once('open', res));
  await rpc('auth', { token });
  console.log('[ok] authenticated with gateway');

  console.log('Starting WhatsApp login...');
  await rpc('channels.whatsapp.login');

  // keep alive waiting for QR events
  setTimeout(() => {
    console.error('Timed out waiting for WhatsApp connection (3 minutes)');
    ws.close();
    process.exit(1);
  }, 180000);
}

main().catch((err) => {
  console.error('error:', err.message);
  process.exit(1);
});
