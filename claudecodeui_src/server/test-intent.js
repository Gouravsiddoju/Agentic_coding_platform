import { IntentRouter } from '../dist-server/server/services/optcode/intent-router.js';

async function test() {
    console.log('Testing Intent Router...');
    try {
        const result = await IntentRouter.routeIntent('Add a new login component');
        console.log('Result:', result);
    } catch(e) {
        console.error(e);
    }
}

test();
