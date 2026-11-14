import {test, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {parseArgs, main} from '../../codex_habitat/codex-habitat-diagnostics.mjs';

let previous;
beforeEach(() => {
  previous = {fetch:globalThis.fetch, WebSocket:globalThis.WebSocket, timer:globalThis.setTimeout,
    gate:process.env.CODEX_HABITAT_HOME_ASSISTANT_CONTROL, token:process.env.SUPERVISOR_TOKEN};
  process.env.CODEX_HABITAT_HOME_ASSISTANT_CONTROL = 'true';
  process.env.SUPERVISOR_TOKEN = 'diagnostic-fixture-token';
  globalThis.fetch = async () => { throw new Error('Unexpected network request'); };
  globalThis.WebSocket = class { constructor() { throw new Error('Unexpected socket'); } };
});
afterEach(() => {
  globalThis.fetch = previous.fetch;
  globalThis.WebSocket = previous.WebSocket;
  globalThis.setTimeout = previous.timer;
  for (const [key,value] of [['CODEX_HABITAT_HOME_ASSISTANT_CONTROL',previous.gate],['SUPERVISOR_TOKEN',previous.token]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
const start = '2030-01-01T12:00:00Z', end = '2030-01-01T13:00:00Z';
test('reject unbounded, malformed, impossible dates and injected arguments', () => {
  for (const args of [
    ['history'], ['history',start,end], ['history',start,start,'light.fixture'],
    ['history',end,start,'light.fixture'], ['history',start,'2030-01-03T12:00:00Z','light.fixture'],
    ['history','2030-02-30T12:00:00Z','2030-02-30T13:00:00Z','light.fixture'],
    ['history','2030-01-01T24:00:00Z','2030-01-02T01:00:00Z','light.fixture'],
    ['history','2030-01-01T12:00:00',end,'light.fixture'],
    ['history',start,end,...Array(21).fill('light.fixture')],
    ['diagnostic-state'], ['diagnostic-state','light.fixture?token=x'],
    ['diagnostic-state','person.fixture'], ['diagnostic-state',...Array(21).fill('light.fixture')],
    ['automation-config','script.fixture'], ['automation-config','automation.fixture','extra'],
    ['trace','automation','../config'], ['trace','light','fixture'], ['trace','script','fixture','run','extra'],
  ]) assert.throws(() => parseArgs(args), undefined, args.join(' '));
  assert.deepEqual(parseArgs(['history','2030-01-01T13:00:00+01:00','2030-01-01T14:00:00+01:00','light.fixture']),
    {action:'history',start:'2030-01-01T12:00:00.000Z',end:'2030-01-01T13:00:00.000Z',entities:['light.fixture']});
  assert.equal(parseArgs(['history',start,'2030-01-02T12:00:00Z','light.fixture']).action, 'history');
});
test('gate, missing token and invalid input fail before network', async () => {
  process.env.CODEX_HABITAT_HOME_ASSISTANT_CONTROL = 'false';
  await assert.rejects(main(['diagnostic-state','light.fixture']), /disabled/);
  process.env.CODEX_HABITAT_HOME_ASSISTANT_CONTROL = 'true';
  process.env.SUPERVISOR_TOKEN = '';
  await assert.rejects(main(['trace','automation','fixture']), /unavailable/);
  await assert.rejects(main(['diagnostic-state','person.fixture']), /entity IDs/);
});
test('selected state reads retain diagnostic attributes only', async () => {
  const seen = [];
  globalThis.fetch = async (url, options) => {
    seen.push(url);
    assert.equal(options.headers.Authorization, 'Bearer diagnostic-fixture-token');
    assert.ok(options.signal);
    return {ok:true,json:async()=>({entity_id:url.split('/').at(-1),state:'on',last_changed:start,
      attributes:{brightness:3,rgb_color:[1,2,3],private_field:'excluded'}})};
  };
  const result = await main(['diagnostic-state','light.fixture','sensor.fixture']);
  assert.deepEqual(seen, ['http://supervisor/core/api/states/light.fixture','http://supervisor/core/api/states/sensor.fixture']);
  assert.deepEqual(result[0].attributes, {brightness:3,rgb_color:[1,2,3]});
  assert.equal(result[0].last_changed, start);
});
test('history uses exact bounds, entities and attribute-change query', async () => {
  globalThis.fetch = async (url, options) => {
    const u = new URL(url);
    assert.equal(u.origin, 'http://supervisor');
    assert.equal(decodeURIComponent(u.pathname), '/core/api/history/period/2030-01-01T12:00:00.000Z');
    assert.equal(u.searchParams.get('filter_entity_id'), 'light.fixture,sensor.fixture');
    assert.equal(u.searchParams.get('end_time'), '2030-01-01T13:00:00.000Z');
    assert.equal(u.searchParams.get('significant_changes_only'), '0');
    assert.ok(options.signal);
    return {ok:true,json:async()=>[[{entity_id:'light.fixture',state:'on',attributes:{brightness:3,secret:'excluded'}}]]};
  };
  assert.deepEqual((await main(['history',start,end,'light.fixture','sensor.fixture']))[0][0].attributes, {brightness:3});
});
test('HTTP rejection, invalid JSON and abort failures propagate', async () => {
  globalThis.fetch = async () => ({ok:false,status:403});
  await assert.rejects(main(['diagnostic-state','light.fixture']), /HTTP 403/);
  globalThis.fetch = async () => ({ok:true,json:async()=>{throw new SyntaxError('fixture');}});
  await assert.rejects(main(['history',start,end,'light.fixture']), SyntaxError);
  globalThis.fetch = async () => { throw new DOMException('fixture timeout','TimeoutError'); };
  await assert.rejects(main(['history',start,end,'light.fixture']), /timeout/);
});
function socket(failure) {
  const commands = [];
  globalThis.WebSocket = class extends EventTarget {
    constructor(url) {
      super(); assert.equal(url, 'ws://supervisor/core/websocket');
      queueMicrotask(() => this.reply({type:failure === 'auth' ? 'auth_invalid' : 'auth_required'}));
    }
    reply(message) { this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(message)})); }
    send(raw) {
      const m = JSON.parse(raw);
      queueMicrotask(() => {
        if (m.type === 'auth') { assert.equal(m.access_token, 'diagnostic-fixture-token'); this.reply({type:'auth_ok'}); return; }
        commands.push(m);
        if (failure === 'close') { this.dispatchEvent(new Event('close')); return; }
        if (failure === 'error') { this.dispatchEvent(new Event('error')); return; }
        if (failure === 'json') { this.dispatchEvent(new MessageEvent('message',{data:'not-json'})); return; }
        this.reply({id:m.id,type:'result',success:failure !== 'reject',result:{fixture:true}});
      });
    }
    close() { this.dispatchEvent(new Event('close')); }
  };
  return commands;
}
test('automation configuration and trace transports send only selected reads', async () => {
  for (const [args, expected] of [
    [['automation-config','automation.fixture'],{id:1,type:'automation/config',entity_id:'automation.fixture'}],
    [['trace','automation','fixture','run'],{id:1,type:'trace/get',domain:'automation',item_id:'fixture',run_id:'run'}],
    [['trace','script','fixture'],{id:1,type:'trace/list',domain:'script',item_id:'fixture'}],
  ]) {
    const commands = socket();
    assert.deepEqual(await main(args), {fixture:true});
    assert.deepEqual(commands, [expected]);
  }
});
test('socket authentication, rejection, malformed JSON, close and error terminate', async () => {
  for (const failure of ['auth','reject','json','close','error']) {
    const commands = socket(failure);
    await assert.rejects(main(['trace','automation','fixture']), /Home Assistant/);
    assert.equal(commands.length, failure === 'auth' ? 0 : 1);
  }
});
test('socket timeout rejects and sends no late requests', async () => {
  const commands = socket();
  globalThis.setTimeout = callback => { queueMicrotask(callback); return -1; };
  await assert.rejects(main(['trace','automation','fixture']), /timed out/);
  await Promise.resolve();
  assert.deepEqual(commands, []);
});
test('shell dispatch runs installed sibling module and redacts error tokens', t => {
  const dir = mkdtempSync(join(tmpdir(),'habitat-diagnostic-'));
  t.after(() => rmSync(dir,{recursive:true,force:true}));
  const preload = join(dir,'fixture.mjs');
  writeFileSync(preload, `globalThis.fetch = async () => { throw new Error('failure ' + process.env.SUPERVISOR_TOKEN); };`);
  const result = spawnSync('bash',[fileURLToPath(new URL('../../codex_habitat/codex-habitat-ha',import.meta.url)),
    'diagnostic-state','light.fixture'],{env:{...process.env,NODE_OPTIONS:`--import=${preload}`},encoding:'utf8',timeout:5000});
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /failure \[redacted\]/);
  assert.doesNotMatch(result.stderr, /diagnostic-fixture-token/);
});
