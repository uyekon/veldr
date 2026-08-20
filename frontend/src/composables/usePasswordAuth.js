import { ref } from 'vue';
import { apiFetch, parseApiResponse, clearLocalAuthState } from '@/utils/apiClient.js';

const STORAGE_KEY = 'cms_authenticated';
const isAuthenticated = ref(localStorage.getItem(STORAGE_KEY) === 'true');

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) isAuthenticated.value = event.newValue === 'true';
  });
  window.addEventListener('authStateChanged', () => {
    isAuthenticated.value = localStorage.getItem(STORAGE_KEY) === 'true';
  });
}

export function usePasswordAuth() {
  const markAuthenticated = () => {
    isAuthenticated.value = true;
    localStorage.setItem(STORAGE_KEY, 'true');
    window.dispatchEvent(new CustomEvent('authStateChanged'));
  };

  const login = async (username, password) => {
    const response = await apiFetch('/api/auth/login', {
      method: 'POST',
      skipUnauthorizedRedirect: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await parseApiResponse(response);
    markAuthenticated();
    return data;
  };

  const getAdminInfo = async () => {
    const response = await apiFetch('/api/auth/me');
    return parseApiResponse(response);
  };

  const setPassword = async (currentPassword, newPassword) => {
    if (newPassword.length < 8 || newPassword.length > 128) {
      throw new Error('Password must contain 8 to 128 characters');
    }
    const response = await apiFetch('/api/auth/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    return parseApiResponse(response);
  };

  const clearAuth = () => {
    isAuthenticated.value = false;
    clearLocalAuthState();
  };

  const logout = async () => {
    try { await apiFetch('/api/auth/logout', { method: 'POST', skipUnauthorizedRedirect: true }); }
    finally { clearAuth(); }
  };

  return {
    isAuthenticated,
    login,
    getAdminInfo,
    setPassword,
    clearAuth,
    logout,
  };
}
