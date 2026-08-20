import { createRouter, createWebHistory } from 'vue-router';
import { apiFetch } from '@/utils/apiClient.js';

const routes = [
  {
    path: '/',
    name: 'Home',
    component: () => import('@/views/DemoView.vue'),
    meta: {
      title: 'Veldr',
      requiresAuth: false,
      layout: 'default'
    }
  },
  {
    path: '/admin',
    component: () => import('@/layouts/AdminLayout.vue'),
    meta: {
      title: 'Write | Veldr',
      requiresAuth: true,
      requiresPassword: true,
      layout: 'admin'
    },
    children: [
      {
        path: 'articles',
        name: 'ArticleList',
        component: () => import('@/views/admin/ArticleList.vue'),
        meta: {
          title: 'Notes | Veldr',
          requiresAuth: true,
          requiresPassword: true,
          layout: 'admin'
        }
      },
      {
        path: 'articles/create',
        name: 'ArticleCreate',
        component: () => import('@/views/admin/ArticleCreate.vue'),
        meta: {
          title: 'New Note | Veldr',
          requiresAuth: true,
          requiresPassword: true,
          layout: 'admin'
        }
      },
      {
        path: 'articles/edit/:id',
        name: 'ArticleEdit',
        component: () => import('@/views/admin/ArticleEdit.vue'),
        props: true,
        meta: {
          title: 'Edit Note | Veldr',
          requiresAuth: true,
          requiresPassword: true,
          layout: 'admin'
        }
      }
    ]
  },
  {
    path: '/article/:id',
    name: 'ArticleView',
    component: () => import('@/views/ArticleView.vue'),
    props: true,
    meta: {
      title: 'Note | Veldr',
      requiresAuth: false,
      layout: 'default'
    }
  },
  {
    path: '/articles',
    name: 'PrivateArticles',
    component: () => import('@/views/PrivateArticles.vue'),
    meta: {
      title: 'Private Notes | Veldr',
      requiresAuth: false,
      requiresPassword: true,
      layout: 'default'
    }
  },
  {
    path: '/password-verification',
    name: 'PasswordVerification',
    component: () => import('@/views/PasswordVerification.vue'),
    meta: {
      title: 'Password Verification',
      requiresAuth: false,
      layout: 'minimal'
    }
  },
  {
    path: '/password-settings',
    name: 'PasswordSettings',
    component: () => import('@/views/PasswordSettings.vue'),
    meta: {
      title: 'Password Settings',
      requiresAuth: false,
      requiresPassword: true,
      layout: 'default'
    }
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/views/NotFound.vue'),
    meta: {
      title: 'Page Not Found',
      requiresAuth: false,
      layout: 'default'
    }
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

const clearAuthState = () => {
  localStorage.removeItem('cms_authenticated');
  localStorage.removeItem('cms_token');
  window.dispatchEvent(new CustomEvent('authStateChanged'));
};

const verifyServerAuth = async () => {
  if (localStorage.getItem('cms_authenticated') !== 'true') return false;

  try {
    const response = await apiFetch('/api/auth/me', {
      skipUnauthorizedRedirect: true
    });
    return response.ok;
  } catch {
    return false;
  }
};

// Global navigation guards
router.beforeEach(async (to, from, next) => {
  // Set document title
  document.title = to.meta?.title || 'Veldr';
  
  // Check if route requires password verification
  if (to.meta?.requiresPassword) {
    const isAuthenticated = await verifyServerAuth();
    
    if (!isAuthenticated) {
      clearAuthState();
      // Redirect to password verification
      next({
        name: 'PasswordVerification',
        query: { 
          redirect: to.fullPath
        }
      });
      return;
    }
  }
  
  // Check authentication (placeholder - implement actual auth logic)
  if (to.meta?.requiresAuth) {
    // For now, allow all access
    // In a real app, check if user is authenticated
    next();
  } else {
    next();
  }
});

// Scroll behavior
router.afterEach((to, from) => {
  // Only scroll to top if not navigating to the same route
  if (to.path !== from.path) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

export default router;
