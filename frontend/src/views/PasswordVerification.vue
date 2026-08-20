<template>
  <div class="password-verification-page">
    <PasswordAuth
      @success="handleSuccess"
      @cancel="handleCancel"
    />
  </div>
</template>

<script setup>
import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PasswordAuth from '@/components/ui/PasswordAuth.vue';
import { apiFetch } from '@/utils/apiClient.js';

const route = useRoute();
const router = useRouter();
const redirectPath = route.query.redirect || '/';

onMounted(async () => {
  const isAuthenticated = localStorage.getItem('cms_authenticated') === 'true';
  if (!isAuthenticated) return;

  const response = await apiFetch('/api/auth/me', {
    skipUnauthorizedRedirect: true
  }).catch(() => null);

  if (response?.ok) {
    router.replace(redirectPath);
  } else {
    localStorage.removeItem('cms_authenticated');
    window.dispatchEvent(new CustomEvent('authStateChanged'));
  }
});

const handleSuccess = () => {
  router.replace(redirectPath);
};

const handleCancel = () => {
  router.replace('/');
};
</script>

<style lang="scss" scoped>
.password-verification-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background:
    radial-gradient(circle at 76% 18%, var(--color-accent-soft), transparent 20rem),
    var(--color-bg);
}
</style>
