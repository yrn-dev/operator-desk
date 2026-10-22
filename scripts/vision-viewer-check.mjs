import assert from 'node:assert/strict';
import path from 'node:path';
import { describeScreen } from '../electron/bridge/computer.mjs';

const started = Date.now();
// Public application artwork, not the user's desktop or private browser pages.
const description = await describeScreen(path.resolve('build/icon.png'), { provider: 'alem-ai', id: 'qwen3-8' });
assert.ok(description.length > 30, 'Vision response must describe the test image');
assert.ok(!/не удалось разобрать|не вижу изображени|изображение не (предоставлено|прикреплено)/i.test(description));
console.log(`PASS real qwen3-8 vision subprocess in ${Math.round((Date.now() - started) / 1000)}s`);
console.log(description.slice(0, 450));
