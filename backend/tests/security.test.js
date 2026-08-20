import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import bcrypt from 'bcryptjs';

let app;
let databases;
let Article;
let Password;
let tempDir;
const username = 'admin';
const legacyPassword = '123456';

beforeAll(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'veldr-security-'));
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DB_STORAGE: path.join(tempDir, 'cms.sqlite'),
    SECURITY_DB_STORAGE: path.join(tempDir, 'security.sqlite'),
    JWT_SECRET: 'test-secret',
    JWT_EXPIRES_IN: '60d',
    AUTH_COOKIE_MAX_AGE_MS: String(60 * 24 * 60 * 60 * 1000),
    DEFAULT_PASSWORD: legacyPassword,
    ADMIN_USERNAME: username,
  });
  ({ app } = await import('../app.js'));
  ({ databases } = await import('../config/databases.js'));
  ({ default: Article } = await import('../models/Article.js'));
  ({ default: Password } = await import('../models/Password.js'));
  await databases.main.sync({ force: true });
  await databases.security.sync({ force: true });
});

beforeEach(async () => {
  await Article.destroy({ where: {}, truncate: true });
  await Password.destroy({ where: {}, truncate: true });
  await Password.create({
    type: 'default', password: await bcrypt.hash(legacyPassword, 12), isDefault: true,
    lastModified: new Date(), sessionVersion: 1,
  });
});

afterAll(async () => {
  await databases?.main?.close();
  await databases?.security?.close();
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

const login = async (agent = request.agent(app), password = legacyPassword) => {
  const response = await agent.post('/api/auth/login').send({ username, password }).expect(200);
  expect(response.headers['set-cookie']?.join(';')).toContain('veldr_auth=');
  expect(response.headers['set-cookie']?.join(';')).toContain('HttpOnly');
  expect(response.headers['set-cookie']?.join(';')).toContain('Max-Age=5184000');
  return agent;
};

describe('administrator authentication', () => {
  it('requires an administrator username and rejects the retired password endpoint', async () => {
    await request(app).post('/api/auth/login').send({ username: 'wrong', password: legacyPassword }).expect(401);
    await request(app).post('/api/auth/login').send({ username, password: 'bad' }).expect(401);
    await request(app).post('/api/password/verify').send({ password: legacyPassword }).expect(404);
  });

  it('blocks protected Veldr writes until the administrator signs in', async () => {
    await request(app).post('/api/articles').send({ title: 'Private', slug: 'private', content: '<p>x</p>' }).expect(401);
    const agent = await login();
    await agent.post('/api/articles').send({ title: 'Private', slug: 'private', content: '<p>x</p>', status: 'private' }).expect(201);
  });

  it('allows legacy six-digit credentials only for transition and requires a strong replacement password', async () => {
    const agent = await login();
    await agent.put('/api/auth/password').send({ currentPassword: legacyPassword, newPassword: 'short' }).expect(400);
    const response = await agent.put('/api/auth/password').send({ currentPassword: legacyPassword, newPassword: 'NewPass!2026' }).expect(200);
    expect(response.body.minimumPasswordLength).toBe(8);
    await request(app).post('/api/auth/login').send({ username, password: legacyPassword }).expect(401);
    await request(app).post('/api/auth/login').send({ username, password: 'NewPass!2026' }).expect(200);
  });

  it('invalidates existing sessions when the password changes', async () => {
    const first = await login();
    const second = await login();
    await first.put('/api/auth/password').send({ currentPassword: legacyPassword, newPassword: 'NewPass!2026' }).expect(200);
    await second.get('/api/auth/me').expect(401);
    await first.get('/api/auth/me').expect(200).expect(({ body }) => expect(body.role).toBe('admin'));
  });

  it('rate limits repeated failed administrator logins', async () => {
    let response;
    for (let index = 0; index < 11; index += 1) {
      response = await request(app).post('/api/auth/login').send({ username, password: 'wrong-password' });
    }
    expect(response.status).toBe(429);
  });
});
