// Baseline search-race reproduction, run against the real mock API with chaos + latency ON.
//
// It replays exactly what the baseline does: one GET /api/assets per keystroke, no debounce,
// no cancellation, and "apply whatever resolves last" (useAssets.ts calls setState in .then()
// with no ordering guard). We type "studio" one character at a time and log, for each request,
// when it was SENT and when it was RECEIVED, plus its x-request-id, total, and first row ids.
//
// The point it demonstrates: the API is deliberately slower for short prefixes (server/index.mjs
// adds +700ms for q.length<=2, +320ms for q.length<=4), so the earliest keystrokes ("s","st")
// resolve LAST. The baseline applies the last response to arrive, so the grid ends up showing the
// broad "s"/"st" result set after the user has finished typing "studio" -> wrong rows.
//
// Usage: env -u PORT node server/index.mjs   (in one shell)
//        node notes/baseline/reproduce-search-race.mjs   (in another)

// Point this at an ISOLATED api instance for any rate-sensitive or request-count measurement.
// The mock's rate limiter keys on the socket remote address, and every crew member runs on
// localhost, so the shared :8787 dev instance is ONE 80-req/10s bucket for the whole team. A
// 429 there could be someone else's traffic. Run your own: PORT=8801 node server/index.mjs.
const BASE = process.env.API_BASE ?? 'http://localhost:8787';
const PHRASE = 'studio';
const KEYSTROKE_MS = 70; // fast, realistic typing cadence
const SORT = 'name:asc'; // fixed sort, so any row difference comes from the filter, not ordering

const t0 = performance.now();
const now = () => Math.round(performance.now() - t0);

// The exact sequence of q values the baseline sends while typing PHRASE: one per keystroke.
const sequence = Array.from({ length: PHRASE.length }, (_, i) => PHRASE.slice(0, i + 1));

async function fireKeystroke(q) {
  const sent = now();
  const url = `${BASE}/api/assets?q=${encodeURIComponent(q)}&sort=${SORT}&limit=3`;
  try {
    const res = await fetch(url);
    const received = now();
    const reqId = res.headers.get('x-request-id');
    const body = await res.json();
    if (!res.ok) {
      return { q, sent, received, status: res.status, reqId, error: body?.error?.code };
    }
    return {
      q,
      sent,
      received,
      status: res.status,
      reqId,
      total: body.total,
      first3: body.items.map((i) => i.id),
    };
  } catch (err) {
    return { q, sent, received: now(), error: String(err) };
  }
}

const results = [];
for (const q of sequence) {
  // Do NOT await the response before the next keystroke — that is the whole point. Typing does
  // not pause for the network. We schedule each request then wait KEYSTROKE_MS and type the next.
  results.push(fireKeystroke(q));
  await new Promise((r) => setTimeout(r, KEYSTROKE_MS));
}
const settled = await Promise.all(results);

console.log(`\nRequests fired while typing a ${PHRASE.length}-character query: ${sequence.length}`);
console.log(`(one per keystroke; the baseline debounces nothing)\n`);

console.log('SENT ORDER (what the user typed):');
for (const r of settled) {
  console.log(
    `  q=${JSON.stringify(r.q).padEnd(10)} sent@${String(r.sent).padStart(4)}ms ` +
      `recv@${String(r.received).padStart(4)}ms  total=${String(r.total ?? r.error).padEnd(6)} ` +
      `first3=${(r.first3 ?? []).join(',')}  req=${r.reqId ?? '-'}`,
  );
}

const byArrival = [...settled].sort((a, b) => a.received - b.received);
console.log('\nARRIVAL ORDER (what actually came back):');
for (const r of byArrival) {
  console.log(`  recv@${String(r.received).padStart(4)}ms  q=${JSON.stringify(r.q)}  total=${r.total ?? r.error}`);
}

const lastToArrive = byArrival[byArrival.length - 1];
const finalTyped = settled[settled.length - 1];
console.log('\n--- THE RACE ---');
console.log(`User finished typing:      q=${JSON.stringify(finalTyped.q)}  total=${finalTyped.total}  first3=${(finalTyped.first3 ?? []).join(',')}`);
console.log(`Last response to arrive:   q=${JSON.stringify(lastToArrive.q)}  total=${lastToArrive.total}  first3=${(lastToArrive.first3 ?? []).join(',')}`);
const wrong = lastToArrive.q !== finalTyped.q;
console.log(
  wrong
    ? `\nBASELINE RESULT: the grid shows the q=${JSON.stringify(lastToArrive.q)} rows, NOT the q=${JSON.stringify(finalTyped.q)} rows the user asked for. Stale response won.`
    : `\n(This run did not reproduce: the final query happened to arrive last. Re-run; the race is timing-dependent.)`,
);
