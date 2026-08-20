import bcrypt from 'bcryptjs';
import Password from '../models/Password.js';
import { config } from '../config/index.js';
import { clearAuthCookie, setAuthCookie } from '../middleware/auth.js';

const DEFAULT_PASSWORD = process.env.DEFAULT_PASSWORD || '123456';
const BCRYPT_ROUNDS = 12;
const LEGACY_PASSWORD = /^\d{6}$/;
const STRONG_PASSWORD = /^.{8,128}$/;

const hashPassword = (password) => bcrypt.hash(password, BCRYPT_ROUNDS);
const isBcryptHash = (value) => /^\$2[aby]\$\d{2}\$/.test(String(value || ''));

const findPasswordRecord = () => Password.findOne({ where: { type: 'default' } });

const createPasswordRecord = async (password = DEFAULT_PASSWORD) => Password.create({
  type: 'default',
  password: await hashPassword(password),
  isDefault: password === DEFAULT_PASSWORD,
  lastModified: new Date(),
  sessionVersion: 1,
});

const getOrCreatePasswordRecord = async () => {
  const record = await findPasswordRecord();
  return record || createPasswordRecord();
};

const passwordChangeListeners = new Set();
const onPasswordChange = (listener) => passwordChangeListeners.add(listener);

const updatePasswordInDB = async (newPassword) => {
  const current = await getOrCreatePasswordRecord();
  const passwordRecord = await current.update({
    password: await hashPassword(newPassword),
    isDefault: newPassword === DEFAULT_PASSWORD,
    lastModified: new Date(),
    sessionVersion: Number(current.sessionVersion || 1) + 1,
  });
  passwordChangeListeners.forEach((listener) => listener());
  return passwordRecord;
};

const verifyAgainstStoredPassword = async (password, passwordRecord) => {
  const storedPassword = String(passwordRecord.password || '');
  if (isBcryptHash(storedPassword)) return bcrypt.compare(password, storedPassword);

  const isLegacyMatch = password === storedPassword;
  if (isLegacyMatch) {
    await passwordRecord.update({
      password: await hashPassword(password),
      lastModified: new Date(),
    });
  }
  return isLegacyMatch;
};

const hasValidUsername = (username) => String(username || '').trim() === config.auth.adminUsername;
const hasValidLoginPassword = (password) => STRONG_PASSWORD.test(String(password || '')) || LEGACY_PASSWORD.test(String(password || ''));
const hasStrongPassword = (password) => STRONG_PASSWORD.test(String(password || ''));

const passwordInfoFromRecord = (passwordRecord) => ({
  username: config.auth.adminUsername,
  isSet: Boolean(passwordRecord),
  minimumPasswordLength: 8,
  lastModified: passwordRecord?.lastModified || null,
});

const login = async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (!hasValidUsername(username) || !hasValidLoginPassword(password)) {
      return res.status(401).json({ error: 'Invalid administrator credentials' });
    }

    const passwordRecord = await getOrCreatePasswordRecord();
    if (!await verifyAgainstStoredPassword(password, passwordRecord)) {
      return res.status(401).json({ error: 'Invalid administrator credentials' });
    }

    setAuthCookie(res, passwordRecord.sessionVersion);
    return res.json({ role: 'admin', username: config.auth.adminUsername });
  } catch (error) {
    console.error('Administrator login error:', error);
    return res.status(500).json({ error: 'Unable to sign in' });
  }
};

const logout = (req, res) => {
  clearAuthCookie(res);
  return res.json({ ok: true });
};

const getAdminInfo = async (req, res) => {
  const passwordRecord = await getOrCreatePasswordRecord();
  return res.json({
    role: 'admin',
    ...passwordInfoFromRecord(passwordRecord),
  });
};

const changePassword = async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    const passwordRecord = await getOrCreatePasswordRecord();

    if (!await verifyAgainstStoredPassword(currentPassword, passwordRecord)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    if (!hasStrongPassword(newPassword)) {
      return res.status(400).json({ error: 'New password must contain 8 to 128 characters' });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ error: 'New password must be different' });
    }

    const updated = await updatePasswordInDB(newPassword);
    setAuthCookie(res, updated.sessionVersion);
    return res.json({ ok: true, ...passwordInfoFromRecord(updated) });
  } catch (error) {
    console.error('Administrator password update error:', error);
    return res.status(500).json({ error: 'Unable to update password' });
  }
};

export {
  getOrCreatePasswordRecord,
  updatePasswordInDB,
  verifyAgainstStoredPassword,
  onPasswordChange,
};

export default {
  login,
  logout,
  getAdminInfo,
  changePassword,
};
