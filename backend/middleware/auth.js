import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import Password from '../models/Password.js';

const authCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.auth.cookieSecure,
  maxAge: config.auth.cookieMaxAgeMs,
  path: '/',
};

const signAuthToken = (sessionVersion = 1) => jwt.sign(
  { sub: 'admin', sv: Number(sessionVersion) || 1 },
  config.auth.jwtSecret,
  { expiresIn: config.auth.jwtExpiresIn }
);

const setAuthCookie = (res, sessionVersion = 1) => {
  const token = signAuthToken(sessionVersion);
  res.cookie(config.auth.cookieName, token, authCookieOptions);
  return token;
};

const clearAuthCookie = (res) => {
  res.clearCookie(config.auth.cookieName, {
    ...authCookieOptions,
    maxAge: undefined,
  });
};

const readAuthToken = (req) => {
  const cookieToken = req.cookies?.[config.auth.cookieName];
  if (cookieToken) return cookieToken;

  const header = req.get('authorization') || '';
  if (header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }

  return null;
};

const authenticateRequest = async (req) => {
  const token = readAuthToken(req);
  if (!token) return null;

  try {
    const payload = jwt.verify(token, config.auth.jwtSecret);
    if (payload?.sub !== 'admin') return null;
    const credentials = await Password.findOne({ where: { type: 'default' } });
    if (!credentials || Number(payload.sv) !== Number(credentials.sessionVersion || 1)) return null;
    return payload;
  } catch {
    return null;
  }
};

const attachAuthState = async (req, res, next) => {
  try {
    const payload = await authenticateRequest(req);
    req.auth = payload ? { isAuthenticated: true, payload } : { isAuthenticated: false };
    next();
  } catch (error) {
    next(error);
  }
};

const requireAuth = async (req, res, next) => {
  const payload = await authenticateRequest(req);
  if (!payload) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required',
    });
  }

  req.auth = { isAuthenticated: true, payload };
  next();
};

export {
  authCookieOptions,
  setAuthCookie,
  clearAuthCookie,
  attachAuthState,
  requireAuth,
};
