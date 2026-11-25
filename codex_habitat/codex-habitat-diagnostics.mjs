// Bounded, read-only Home Assistant diagnostics. No arbitrary URLs or commands.
import {fileURLToPath} from 'node:url';
export const entityPattern = /^(light|media_player|binary_sensor|sensor|input_boolean|input_datetime|automation|script|switch|zone)\.[a-z0-9_]+$/;
export function parseArgs(args) {
  const [action, ...rest] = args;
  if (action === 'diagnostic-state') {
    if (!rest.length || rest.length > 20 || rest.some(x => !entityPattern.test(x))) throw new Error('Specify 1–20 diagnostic entity IDs.');
    return {action, entities:rest};
  }
  if (action === 'history') {
    const [start, end, ...entities] = rest;
    const iso = /^(\d{4}-\d\d-\d\d)T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
    const valid = value => {
      const match = iso.exec(value || '');
      const date = match && Date.parse(match[1] + 'T00:00:00Z');
      return match && Number.isFinite(date) && new Date(date).toISOString().slice(0,10) === match[1];
    };
    const a = Date.parse(start), b = Date.parse(end);
    if (!valid(start) || !valid(end) || !Number.isFinite(a) || !Number.isFinite(b) || b <= a || b-a > 86400000) throw new Error('Specify an explicit ISO time window of at most 24 hours.');
    if (!entities.length || entities.length > 20 || entities.some(x => !entityPattern.test(x))) throw new Error('Specify 1–20 diagnostic entity IDs.');
    return {action,start:new Date(a).toISOString(),end:new Date(b).toISOString(),entities};
  }
  if (action === 'automation-config') {
    if (rest.length !== 1 || !/^automation\.[a-z0-9_]+$/.test(rest[0])) throw new Error('Specify one automation entity ID.');
    return {action,entity_id:rest[0]};
  }
  if (action === 'trace') {
    const [domain,item_id,run_id,...extra] = rest;
    if (!['automation','script'].includes(domain) || !/^[a-zA-Z0-9_-]{1,150}$/.test(item_id || '') || (run_id !== undefined && !/^[a-zA-Z0-9_-]{1,150}$/.test(run_id)) || extra.length) throw new Error('Specify trace automation|script item_id [run_id].');
    return {action,domain,item_id,run_id};
  }
  throw new Error('Unsupported diagnostic action.');
}
const keys = ['friendly_name','effect','effect_list','volume_level','is_volume_muted','group_members','brightness','color_mode','color_temp_kelvin','hs_color','rgb_color','xy_color','last_triggered','current','mode','id','configuration','manual_control','manual_control_attributes','brightness_pct','color_temp','force_rgb_color','icon','device_class','unit_of_measurement'];
function select(state) {
  return {entity_id:state.entity_id,state:state.state,last_changed:state.last_changed,last_updated:state.last_updated,context:state.context,attributes:Object.fromEntries(keys.filter(k => k in (state.attributes || {})).map(k => [k,state.attributes[k]]))};
}
export async function main(args) {
  if (process.env.CODEX_HABITAT_HOME_ASSISTANT_CONTROL !== 'true') throw new Error('Home Assistant control actions are disabled.');
  const p = parseArgs(args);
  if (!process.env.SUPERVISOR_TOKEN) throw new Error('Home Assistant API access is unavailable.');
  async function get(path) {
    const r = await fetch('http://supervisor/core/api' + path,{headers:{Authorization:'Bearer '+process.env.SUPERVISOR_TOKEN},signal:AbortSignal.timeout(25000)});
    if (!r.ok) throw new Error('Home Assistant diagnostic request failed (HTTP '+r.status+').');
    return r.json();
  }
  if (p.action === 'diagnostic-state') {
    const result = [];
    for (const entity of p.entities) result.push(select(await get('/states/'+encodeURIComponent(entity))));
    return result;
  }
  if (p.action === 'history') {
    const query = new URLSearchParams({filter_entity_id:p.entities.join(','),end_time:p.end,significant_changes_only:'0'});
    const result = await get('/history/period/'+encodeURIComponent(p.start)+'?'+query);
    return result.map(series => series.map(select));
  }
  return new Promise((resolve,reject) => {
    const ws = new WebSocket('ws://supervisor/core/websocket');
    let done = false;
    const finish = (error,result) => { if (done) return; done=true; clearTimeout(timer); ws.close(); if (error) reject(error); else resolve(result); };
    const timer = setTimeout(() => finish(new Error('Home Assistant diagnostic request timed out.')),25000);
    ws.addEventListener('error',() => finish(new Error('Home Assistant diagnostic connection failed.')));
    ws.addEventListener('close',() => { if (!done) finish(new Error('Home Assistant diagnostic connection closed.')); });
    ws.addEventListener('message',({data}) => {
      if (done) return;
      let m; try { m=JSON.parse(data); } catch { finish(new Error('Invalid Home Assistant diagnostic response.')); return; }
      if (m.type === 'auth_required') ws.send(JSON.stringify({type:'auth',access_token:process.env.SUPERVISOR_TOKEN}));
      else if (m.type === 'auth_invalid') finish(new Error('Home Assistant authentication rejected.'));
      else if (m.type === 'auth_ok') ws.send(JSON.stringify(p.action === 'automation-config' ? {id:1,type:'automation/config',entity_id:p.entity_id} : {id:1,type:p.run_id ? 'trace/get':'trace/list',domain:p.domain,item_id:p.item_id,...(p.run_id ? {run_id:p.run_id}:{})}));
      else if (m.type === 'result' && m.id === 1) finish(m.success ? null : new Error('Home Assistant rejected diagnostic request.'),m.result);
    });
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await main(process.argv.slice(2)),null,2)); }
  catch (error) { console.error(error instanceof SyntaxError ? 'Invalid Home Assistant diagnostic JSON response.' : error.message.replaceAll(process.env.SUPERVISOR_TOKEN || '\u0000','[redacted]')); process.exitCode=1; }
}
