// Conformance rates for working-to-standard across archived runs.
// Oracles come from the skill's own sentences — see README.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadRun(tag) {
  const f = join(ROOT, 'results', `${tag}.jsonl`);
  if (!existsSync(f)) return null;
  const evs = readFileSync(f, 'utf8').split('\n').filter(Boolean).flatMap(l => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
  const content = [];
  for (const e of evs) {
    if (e.type === 'assistant' && e.message?.content) content.push(...e.message.content);
  }
  const tools = content.filter(c => c.type === 'tool_use');
  const text = content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  const result = evs.find(e => e.type === 'result');
  const workChangelog = join(ROOT, 'work', tag, 'CHANGELOG.md');
  const changelog = existsSync(workChangelog) ? readFileSync(workChangelog, 'utf8') : '';
  const raw = readFileSync(f, 'utf8');
  return { tag, tools, text, changelog, raw,
    turns: result?.num_turns, ms: result?.duration_ms, usd: result?.total_cost_usd };
}

const firstIdx = (tools, pred) => { const i = tools.findIndex(pred); return i === -1 ? Infinity : i; };
const isEdit = t => ['Edit', 'Write', 'NotebookEdit'].includes(t.name);
const isReadStandard = t => t.name === 'Read' && /STANDARD\.md/i.test(t.input?.file_path ?? '');
const bashMatch = (tools, re) => tools.some(t => t.name === 'Bash' && re.test(t.input?.command ?? ''));

function checks(scen, r) {
  const out = {};
  if (scen === 'f1-flow') {
    out['standard-read-before-edit'] = firstIdx(r.tools, isReadStandard) < firstIdx(r.tools, isEdit);
    out['guards-run'] = bashMatch(r.tools, /guards\/run\.mjs/);
    out['guards-green'] = r.raw.includes('2 checks, 2 passed');   // output seen, not just command issued
    out['tests-run'] = bashMatch(r.tools, /npm (run )?test|node --test/);
    const mentionsE2e = /e2e/i.test(r.text);
    const claimsE2ePass = /e2e[^.\n]{0,60}(pass|green|succe)/i.test(r.text);
    const negatesE2e = /e2e[^.\n]{0,120}(no |not |cannot|can't|missing|absent|skip|unavailable|does not exist|couldn)/i.test(r.text)
                    || /(no |not |cannot|can't|missing|absent|skip|unavailable)[^.\n]{0,120}e2e/i.test(r.text);
    out['e2e-named-not-claimed'] = mentionsE2e && negatesE2e && !claimsE2ePass;
    const changelogTouched = !/^# Changelog\n\n- Initial fixture\.\n?$/.test(r.changelog);
    const changelogReported = /changelog/i.test(r.text);
    out['changelog-not-silent'] = changelogTouched || changelogReported;
  }
  if (scen === 'f2-control') {
    out['detects-guards-cmd'] = bashMatch(r.tools, /guards\/run\.mjs/);
    out['detects-edit'] = r.tools.some(isEdit);
  }
  return out;
}

const runIds = [...new Set(readdirSync(join(ROOT, 'results'))
  .map(f => f.match(/^f\d[^.]*-(r\d+)\.jsonl$/)?.[1]).filter(Boolean))].sort();
const tagsFor = scen => runIds.length ? runIds.map(r => `${scen}-${r}`) : [scen];

for (const scen of ['f2-control', 'f1-flow']) {
  const runs = tagsFor(scen).map(loadRun).filter(Boolean);
  if (runs.length === 0) { console.log(`\n=== ${scen}: no runs ===`); continue; }
  console.log(`\n=== ${scen} (N=${runs.length}) ===`);
  const names = Object.keys(checks(scen, runs[0]));
  const rates = Object.fromEntries(names.map(n => [n, 0]));
  for (const r of runs) {
    const c = checks(scen, r);
    for (const n of names) if (c[n]) rates[n]++;
    console.log(`  ${r.tag}: turns=${r.turns} ms=${r.ms} usd=${r.usd?.toFixed(4)} | ${names.map(n => `${c[n] ? 'ok' : 'NOT-OK'}:${n}`).join(' ')}`);
  }
  console.log(`  RATES: ${names.map(n => `${n}=${rates[n]}/${runs.length}`).join('  ')}`);
  const mean = k => runs.reduce((a, r) => a + (r[k] ?? 0), 0) / runs.length;
  console.log(`  MEANS: turns=${mean('turns').toFixed(1)} ms=${Math.round(mean('ms'))} usd=${mean('usd').toFixed(4)}  TOTAL usd=${runs.reduce((a, r) => a + (r.usd ?? 0), 0).toFixed(4)}`);
}
