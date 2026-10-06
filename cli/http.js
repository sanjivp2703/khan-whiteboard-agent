// cli/http.js — a tiny node:http JSON client. Not fetch/undici: its default headersTimeout
// (300 s) would kill a 540 s `khan wait` long-poll; node:http has no timeout unless asked.
import http from 'node:http';
import { serverDown } from './output.js';

/**
 * @returns {Promise<{status:number, body:any}>} body is parsed JSON when possible, else text
 * @throws CliError(SERVER_DOWN) when the connection fails or times out
 */
export function request(method, url, { body, timeoutMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      method,
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {},
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = text;
        try { parsed = text ? JSON.parse(text) : null; } catch { /* keep text */ }
        resolve({ status: res.statusCode, body: parsed });
      });
      res.on('error', (e) => reject(serverDown(`response error from ${u.host}: ${e.message}`)));
    });
    if (timeoutMs > 0) {
      req.setTimeout(timeoutMs, () => { req.destroy(new Error(`timed out after ${timeoutMs} ms`)); });
    }
    req.on('error', (e) => reject(serverDown(`cannot reach the khan server at ${u.host}: ${e.message}`)));
    if (payload) req.write(payload);
    req.end();
  });
}

export const get = (url, opts) => request('GET', url, opts);
export const post = (url, body, opts) => request('POST', url, { ...opts, body });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
