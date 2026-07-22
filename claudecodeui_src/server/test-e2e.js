import { queryOptCode } from '../dist-server/server/optcode-sdk.js';

class FakeWebSocket {
    send(data) {
        if (typeof data === 'string') {
            console.log('[WS] ' + data);
        } else {
            console.log('[WS] ', JSON.stringify(data));
        }
    }
}

async function runEndToEnd() {
    console.log('Running End-to-End Pipeline Test...');
    const ws = new FakeWebSocket();
    const options = {
        sessionId: 'test-session-123',
        cwd: process.cwd()
    };
    
    // Test the "TEST" intent
    await queryOptCode('Create unit tests for intent-router.ts', options, ws);
}

runEndToEnd().catch(console.error);
