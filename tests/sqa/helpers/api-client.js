/**
 * Vivid CRM — SQA Test Suite
 * API Client Helper — shared by all agents
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.resolve(__dirname, '../test-state.json');

export const API_BASE = process.env.API_URL || 'http://localhost:3000';

export function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return {}; }
}

export function saveState(data) {
  const merged = { ...loadState(), ...data };
  fs.writeFileSync(STATE_FILE, JSON.stringify(merged, null, 2));
}

export class ApiClient {
  constructor(token = null, tenantSlug = null) {
    this.token = token;
    this.tenantSlug = tenantSlug;
  }
  async request(method, path, body = null, extraHeaders = {}) {
    const url = `${API_BASE}${path}`;
    const headers = { 'Content-Type': 'application/json', ...extraHeaders };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    if (this.tenantSlug) headers['X-Tenant-Slug'] = this.tenantSlug;
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    return { status: res.status, ok: res.ok, data: json };
  }
  get(path, h={})        { return this.request('GET',    path, null, h); }
  post(path, body, h={}) { return this.request('POST',   path, body, h); }
  patch(path, body, h={}){ return this.request('PATCH',  path, body, h); }
  put(path, body, h={})  { return this.request('PUT',    path, body, h); }
  del(path, h={})        { return this.request('DELETE', path, null, h); }
}

export async function login(email, password, tenantSlug) {
  const anon = new ApiClient();
  const res = await anon.post('/auth/login', { email, password, tenantSlug });
  if (!res.ok || !res.data?.data?.token) {
    throw new Error(`Login failed for ${email}@${tenantSlug}: ${JSON.stringify(res.data?.error)}`);
  }
  return res.data.data.token;
}
