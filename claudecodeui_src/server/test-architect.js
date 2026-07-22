import { ArchitectAgent } from '../dist-server/server/services/optcode/agents.js';

async function test() {
    console.log('Testing Architect Agent...');
    try {
        const architect = new ArchitectAgent('.');
        const result = await architect.planImplementation('Add a button to the existing index.html that logs hello world');
        console.log('Result:', JSON.stringify(result, null, 2));
    } catch(e) {
        console.error(e);
    }
}

test();
