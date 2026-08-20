<template>
  <div ref="modalRef" class="password-auth-overlay" role="dialog" aria-modal="true" aria-label="Administrator sign in">
    <form class="password-auth-modal" @submit.prevent="handleSubmit">
      <div class="password-auth-header">
        <i class="fas fa-user-shield"></i>
        <h2>Administrator Sign In</h2>
        <p class="password-auth-subtitle">Use your administrator account to edit protected notes.</p>
      </div>

      <div class="password-auth-body">
        <label class="field-label" for="admin-username">Administrator account</label>
        <input id="admin-username" ref="usernameInput" v-model.trim="username" class="password-input" autocomplete="username" :disabled="isVerifying">

        <label class="field-label" for="admin-password">Password</label>
        <input id="admin-password" v-model="password" type="password" class="password-input" autocomplete="current-password" :disabled="isVerifying">

        <div v-if="errorMessage" class="error-message">
          <i class="fas fa-exclamation-circle"></i>{{ errorMessage }}
        </div>

        <div class="password-auth-actions">
          <button class="btn btn-primary" :disabled="!username || !password || isVerifying">
            <i v-if="isVerifying" class="fas fa-spinner fa-spin"></i>
            <i v-else class="fas fa-right-to-bracket"></i>
            {{ isVerifying ? 'Signing in...' : 'Sign in' }}
          </button>
          <button type="button" class="btn btn-outline-secondary" :disabled="isVerifying" @click="handleClear">Clear</button>
        </div>

        <div class="password-auth-footer">
          <button type="button" class="btn btn-link" :disabled="isVerifying" @click="handleCancel">Back home</button>
        </div>
      </div>
    </form>
  </div>
</template>

<script setup>
import { nextTick, onMounted, ref } from 'vue';
import { usePasswordAuth } from '@/composables/usePasswordAuth.js';
import { useModalA11y } from '@/composables/useModalA11y.js';

const emit = defineEmits(['success', 'cancel']);
const { login, clearAuth } = usePasswordAuth();
const username = ref('admin');
const password = ref('');
const isVerifying = ref(false);
const errorMessage = ref('');
const usernameInput = ref(null);
const modalRef = ref(null);
useModalA11y(modalRef);

onMounted(() => nextTick(() => usernameInput.value?.focus()));

const handleSubmit = async () => {
  if (!username.value || !password.value) return;
  try {
    isVerifying.value = true;
    errorMessage.value = '';
    await login(username.value, password.value);
    emit('success');
  } catch (error) {
    errorMessage.value = error.message || 'Unable to sign in. Please try again.';
    password.value = '';
  } finally {
    isVerifying.value = false;
  }
};

const handleClear = () => {
  password.value = '';
  errorMessage.value = '';
  nextTick(() => usernameInput.value?.focus());
};

const handleCancel = () => {
  clearAuth();
  emit('cancel');
};
</script>

<style lang="scss" scoped>
.password-auth-overlay { position:fixed; inset:0; z-index:9999; display:flex; align-items:center; justify-content:center; padding:1rem; background:rgba(8,17,28,.72); backdrop-filter:blur(10px); }
.password-auth-modal { width:min(100%,26rem); overflow:hidden; background:var(--color-surface); border:1px solid var(--color-border); border-radius:var(--border-radius-lg); box-shadow:var(--shadow-soft); }
.password-auth-header { padding:2rem; text-align:center; background:var(--color-surface-muted); border-bottom:1px solid var(--color-border); }
.password-auth-header i { display:inline-flex; align-items:center; justify-content:center; width:2.5rem; height:2.5rem; margin-bottom:1rem; color:var(--color-accent); background:var(--color-accent-soft); border-radius:999px; }
.password-auth-header h2 { margin:0; color:var(--color-heading); font-size:1.45rem; }
.password-auth-subtitle { margin:.55rem 0 0; color:var(--color-text-muted); font-size:.92rem; line-height:1.5; }
.password-auth-body { padding:1.5rem; }
.field-label { display:block; margin:0 0 .45rem; color:var(--color-text); font-size:.9rem; font-weight:700; }
.field-label:not(:first-child) { margin-top:1rem; }
.password-input { width:100%; padding:.85rem .9rem; color:var(--color-heading); background:var(--color-surface); border:1px solid var(--color-border); border-radius:var(--border-radius); font-size:1rem; }
.password-input:focus { outline:none; border-color:var(--color-accent); box-shadow:0 0 0 3px var(--color-focus-ring); }
.error-message { display:flex; gap:.5rem; margin-top:1rem; padding:.75rem; color:var(--color-danger); background:rgba(239,68,68,.08); border:1px solid rgba(239,68,68,.24); border-radius:var(--border-radius); font-size:.88rem; }
.password-auth-actions { display:flex; gap:.75rem; margin-top:1.25rem; }
.password-auth-footer { padding-top:1rem; margin-top:1.25rem; text-align:center; border-top:1px solid var(--color-border); }
.btn { display:inline-flex; align-items:center; justify-content:center; gap:.5rem; min-height:2.65rem; padding:.65rem 1rem; border:1px solid transparent; border-radius:var(--border-radius); cursor:pointer; font-weight:800; }.btn:disabled{cursor:not-allowed;opacity:.6}.btn-primary{flex:1;color:var(--color-text-inverse);background:var(--color-accent);border-color:var(--color-accent)}.btn-outline-secondary{color:var(--color-text);background:transparent;border-color:var(--color-border)}.btn-link{min-height:2rem;padding:.4rem;color:var(--color-text-muted);background:transparent;border:0}
@media(max-width:480px){.password-auth-actions{flex-direction:column}}
</style>
