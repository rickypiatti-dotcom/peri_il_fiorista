// Limite ai tentativi di login (in memoria, si azzera al riavvio del servizio).
// Tre contatori su finestre di 15 minuti:
//   ip    = tutti i tentativi falliti da uno stesso indirizzo (IPv6: uno stesso blocco /64)
//   pair  = tentativi falliti da quell'indirizzo su UN'email: blocca chi prova a indovinare una password
//   mail  = tentativi falliti su un'email da qualsiasi indirizzo: soglia alta, ferma gli attacchi distribuiti
//           senza permettere a uno sconosciuto di chiudere fuori il titolare con pochi tentativi.
// Dopo il terzo errore la risposta viene rallentata (fino a 2 secondi): trovare una password diventa lentissimo.
import net from 'node:net';

export const WINDOW_MS = 15 * 60 * 1000;
export const LIMITS = { ip: 10, pair: 5, mail: 30 };

// IPv4 invariato; IPv4-mapped IPv6 -> IPv4; IPv6 -> primi 64 bit (chi attacca cambia indirizzo dentro il suo /64).
export function normalizeIp(raw) {
  let ip = String(raw || '').trim();
  if (ip.startsWith('[') && ip.includes(']')) ip = ip.slice(1, ip.indexOf(']'));
  ip = ip.replace(/%.*$/, '');
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) ip = mapped[1];
  if (net.isIPv4(ip)) return ip;
  if (!net.isIPv6(ip)) return 'sconosciuto';
  let [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail === undefined ? [] : (tail ? tail.split(':') : []);
  if (tail === undefined) return 'v6:' + h.slice(0, 4).map((x) => x.padStart(4, '0')).join(':').toLowerCase();
  const groups = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return 'v6:' + groups.slice(0, 4).map((x) => x.padStart(4, '0')).join(':').toLowerCase();
}

export function createThrottle(now = () => Date.now()) {
  const map = new Map(); // chiave -> { count, resetAt }
  const get = (k) => {
    const f = map.get(k);
    if (!f) return null;
    if (f.resetAt <= now()) { map.delete(k); return null; }
    return f;
  };
  const count = (k) => (get(k) ? get(k).count : 0);
  const add = (k) => {
    const f = get(k);
    if (f) f.count += 1; else map.set(k, { count: 1, resetAt: now() + WINDOW_MS });
  };
  const keys = (ip, email) => ({ ip: `ip:${ip}`, pair: `pair:${ip}|${email}`, mail: `mail:${email}` });
  return {
    blocked(ip, email) {
      const k = keys(ip, email);
      return count(k.ip) >= LIMITS.ip || count(k.pair) >= LIMITS.pair || count(k.mail) >= LIMITS.mail;
    },
    fail(ip, email) { const k = keys(ip, email); add(k.ip); add(k.pair); add(k.mail); },
    // login riuscito: si perdona solo la coppia indirizzo+email (il contatore dell'indirizzo resta)
    success(ip, email) { map.delete(keys(ip, email).pair); },
    delayMs(ip, email) {
      const k = keys(ip, email);
      const n = Math.max(count(k.ip), count(k.pair));
      return n < 3 ? 0 : Math.min(2000, (n - 2) * 300);
    },
    sweep() { for (const k of [...map.keys()]) get(k); },
    size() { return map.size; },
  };
}
