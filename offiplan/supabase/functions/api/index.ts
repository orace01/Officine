import { coverage } from '../../../src/domain/schedule.js';

Deno.serve(() => Response.json({ ok: true, coverage: coverage([{}]) }));
