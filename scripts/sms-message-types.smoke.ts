import assert from 'node:assert/strict';

import { smsLogs, smsMessageTypeEnum } from '../src/server/db/schema';
import type { SmsMessageType } from '../src/types/db';

const gameSmsTypes = [
  'joshing_game_received',
  'joshing_game_progress',
  'joshing_game_complete',
] as const satisfies readonly SmsMessageType[];

const enumValues = new Set<string>(smsMessageTypeEnum.enumValues);

for (const messageType of gameSmsTypes) {
  assert.ok(enumValues.has(messageType), `${messageType} is missing from SmsMessageType`);
}

const smokeInsert: typeof smsLogs.$inferInsert = {
  phoneNumber: '+15555550123',
  messageType: 'joshing_game_received',
};

assert.equal(smokeInsert.messageType, 'joshing_game_received');

console.log('sms-message-types.smoke: ok');
