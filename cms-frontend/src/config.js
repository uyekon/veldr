// 运行时配置：config.js（部署时由 deploy-frontends.ps1 写入 dist/config.js）
// 必须以普通 <script> 先于模块加载，这里只读取。
const CMS_CONFIG = window.CMS_CONFIG || {};

export const API_BASE = CMS_CONFIG.apiBase || '/api/cms';
export const AUTH_API_BASE = CMS_CONFIG.authApiBase || '/api/auth';
export const UPLOAD_BASE = CMS_CONFIG.uploadBase || '/uploads/cms';
export const LEGACY_UPLOAD_BASE = '/uploads/';

export const apiPath = (path) => API_BASE + path;

window.CMSNormalizeMarkdownUrl = (url) => String(url || '');
