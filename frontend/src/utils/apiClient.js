const AUTHENTICATED_KEY = 'cms_authenticated';

const clearLocalAuthState = () => {
  localStorage.removeItem(AUTHENTICATED_KEY);
  localStorage.removeItem('cms_token');

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('authStateChanged'));
  }
};

const handleUnauthorized = () => {
  clearLocalAuthState();

  if (typeof window === 'undefined') return;

  const currentPath = window.location.pathname + window.location.search;
  const isPasswordPage = window.location.pathname === '/password-verification';
  if (!isPasswordPage) {
    const redirect = encodeURIComponent(currentPath);
    window.location.assign(`/password-verification?redirect=${redirect}`);
  }
};

const apiFetch = async (input, options = {}) => {
  const { skipUnauthorizedRedirect = false, ...fetchOptions } = options;
  const response = await fetch(input, {
    credentials: 'include',
    ...fetchOptions,
    headers: {
      ...(fetchOptions.headers || {}),
    },
  });

  if (response.status === 401 && !skipUnauthorizedRedirect) {
    handleUnauthorized();
  }

  return response;
};

const parseApiResponse = async (response) => {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Network error' }));
    throw new Error(error.error || error.message || `HTTP ${response.status}`);
  }
  return response.json();
};

export {
  apiFetch,
  parseApiResponse,
  clearLocalAuthState,
};
