/**
 * Rate limits for the social routes.
 *
 * The app has no global rate limiting by design; these limits exist only where one person can
 * act on *other people*: asking to be friends, guessing friend codes, cheering, creating
 * challenges. They are in-memory (a restart forgets them, which is acceptable at this scale),
 * and each request is counted against the signed-in user and against the client address.
 */

/** Wait imposed by the first lock of a rule with backoff, in seconds; it doubles on every further attempt. */
const BACKOFF_BASE_SEC = 60;

/**
 * What each limited action allows. `backoff` means attempts made while blocked make the wait longer.
 */
export const RULES = Object.freeze({
  friendRequest: Object.freeze({ limit: 10, windowMs: 3_600_000 }),
  friendCode: Object.freeze({ limit: 20, windowMs: 3_600_000, backoff: true }),
  cheer: Object.freeze({ limit: 60, windowMs: 3_600_000 }),
  challengeCreate: Object.freeze({ limit: 10, windowMs: 86_400_000 })
});

/**
 * The address of the client. Behind the bundled nginx, `X-Real-IP` is overwritten with the real
 * peer address, so it cannot be forged; `X-Forwarded-For` can (clients may prepend to it), so it is ignored.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {string}
 */
export function clientIp(req) {
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

/**
 * @typedef {{limit: number, windowMs: number, backoff?: boolean}} Rule
 * @typedef {{ok: true} | {ok: false, retryAfterSec: number}} Verdict
 */

/**
 * Creates a limiter with its own memory.
 *
 * @param {{now?: () => number}} [options]
 * @returns {{
 *   check: (key: string, rule: Rule) => Verdict,
 *   checkAll: (keys: string[], rule: Rule) => Verdict,
 *   prune: () => void,
 *   size: () => number
 * }}
 */
export function createLimiter({ now = Date.now } = {}) {
  /** @type {Map<string, {times: number[], lockUntil: number, strikes: number, windowMs: number}>} */
  const entries = new Map();

  /** Decides without recording the hit. Escalates a lock when an attempt arrives while blocked. */
  const evaluate = (key, rule, t) => {
    const e = entries.get(key) || { times: [], lockUntil: 0, strikes: 0, windowMs: rule.windowMs };
    e.windowMs = rule.windowMs;
    e.times = e.times.filter(x => x > t - rule.windowMs);
    if (!e.times.length && e.lockUntil <= t) e.strikes = 0;

    const escalate = () => {
      e.strikes++;
      const wait = Math.min(BACKOFF_BASE_SEC * 2 ** (e.strikes - 1), rule.windowMs / 1000);
      e.lockUntil = t + wait * 1000;
      entries.set(key, e);
      return { ok: false, retryAfterSec: wait };
    };
    if (rule.backoff && e.lockUntil > t) return { ...escalate(), entry: e };
    if (e.times.length >= rule.limit) {
      if (rule.backoff) return { ...escalate(), entry: e };
      entries.set(key, e);
      return { ok: false, retryAfterSec: Math.ceil((e.times[0] + rule.windowMs - t) / 1000), entry: e };
    }
    return { ok: true, entry: e };
  };

  const record = (key, e, t) => { e.times.push(t); entries.set(key, e); };

  /**
   * Counts one attempt against a key.
   *
   * @param {string} key
   * @param {Rule} rule
   * @returns {Verdict}
   */
  const check = (key, rule) => checkAll([key], rule);

  /**
   * Counts one attempt against several keys at once (for example the user and their address).
   * The attempt is refused if any key is over its limit, and then counted on none of them.
   *
   * @param {string[]} keys
   * @param {Rule} rule
   * @returns {Verdict}
   */
  const checkAll = (keys, rule) => {
    const t = now();
    if (entries.size > 5000) prune();
    const results = keys.map(key => ({ key, ...evaluate(key, rule, t) }));
    const refused = results.filter(r => !r.ok);
    if (refused.length) return { ok: false, retryAfterSec: Math.max(...refused.map(r => r.retryAfterSec)) };
    results.forEach(r => record(r.key, r.entry, t));
    return { ok: true };
  };

  /** Forgets keys whose window and lock have both passed, so memory does not grow. */
  const prune = () => {
    const t = now();
    for (const [key, e] of entries) {
      if (e.lockUntil <= t && e.times.every(x => x <= t - e.windowMs)) entries.delete(key);
    }
  };

  return { check, checkAll, prune, size: () => entries.size };
}

/**
 * Builds the guard routes call before doing limited work.
 *
 * @param {object} deps
 * @param {ReturnType<typeof createLimiter>} deps.limiter
 * @param {(res: import('node:http').ServerResponse, code: number, body: object, headers?: object) => void} deps.json
 * @returns {(rule: keyof typeof RULES, req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, user: {id: string}) => boolean}
 *   Returns true when the action may go ahead; otherwise it has already answered `429` with a `Retry-After`.
 */
export function createGuard({ limiter, json }) {
  return (rule, req, res, user) => {
    const verdict = limiter.checkAll([`${rule}:u:${user.id}`, `${rule}:ip:${clientIp(req)}`], RULES[rule]);
    if (verdict.ok) return true;
    json(res, 429, { error: 'too many attempts, please try again later' }, { 'Retry-After': String(verdict.retryAfterSec) });
    return false;
  };
}
