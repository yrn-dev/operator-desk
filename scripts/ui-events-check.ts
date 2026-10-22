import assert from 'node:assert/strict';
import { createUiEventStream, transcriptEvent } from '../electron/ui-events.ts';
import { applyEvent } from '../src/lineReducer.ts';
import type { LineState } from '../src/types.ts';

const delivered: any[] = [];
const stream = createUiEventStream(event => delivered.push(event), 5);
const update = (text: string) => ({ type: 'message_update', assistantMessageEvent: { partial: {
  role: 'assistant', content: [{ type: 'text', text }, { type: 'toolCall', arguments: { huge: 'x'.repeat(10000) } }],
} } });
stream.push({ type: 'message_start', message: { role: 'assistant', content: [] } });
for (let i = 0; i < 100; i++) stream.push(update(`token-${i}`));
assert.equal(delivered.length, 1);
stream.push({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'read', args: { path: 'fixture' } });
assert.deepEqual(delivered.map(event => event.type), ['message_start', 'message_update', 'tool_execution_start']);
assert.equal(delivered[1].message.content[0].text, 'token-99');
assert.equal(delivered[1].message.content.length, 1);
stream.push({ type: 'tool_execution_update', toolCallId: 't1', partialResult: { content: [{ type: 'text', text: 'old' }] } });
stream.push({ type: 'tool_execution_update', toolCallId: 't2', partialResult: { content: [{ type: 'text', text: 'parallel' }] } });
stream.push({ type: 'tool_execution_update', toolCallId: 't1', partialResult: { content: [{ type: 'text', text: 'latest' }] } });
stream.push({ type: 'tool_execution_end', toolCallId: 't1', result: { content: [{ type: 'text', text: 'final' }] } });
assert.equal(delivered[3].partialResult.content[0].text, 'latest');
assert.equal(delivered[4].toolCallId, 't2');
assert.equal(delivered[5].type, 'tool_execution_end');
stream.push(update('visible without boundary'));
await new Promise(ok => setTimeout(ok, 15));
assert.equal(delivered.at(-1).message.content[0].text, 'visible without boundary');
stream.push({ type: 'agent_end', willRetry: true, messages: [{ content: 'large history' }] });
assert.deepEqual(delivered.at(-1), { type: 'agent_end', willRetry: true });
const count = delivered.length;
stream.push(update('discarded on close')); stream.dispose();
await new Promise(ok => setTimeout(ok, 15));
assert.equal(delivered.length, count);
assert.equal(transcriptEvent({ type: 'message_end', message: { role: 'toolResult' } }), null);
assert.equal(transcriptEvent({ type: 'turn_end', messages: [] }), null);
const raw = { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }],
  usage: { totalTokens: 123 }, stopReason: 'length' } };
const state: LineState = { id: 'test', label: 'test', cwd: '/tmp', entries: [], lamp: 'live', model: null,
  contextWindow: 262144, contextUsed: 0, thinkingLevel: 'off', autoCompaction: true, showThinking: true };
assert.deepEqual(applyEvent(state, raw), applyEvent(state, transcriptEvent(raw)!));
console.log('PASS UI snapshot coalescing, event ordering, parallel tool progress, final usage and cancellation');
