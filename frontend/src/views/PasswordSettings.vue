<template>
  <div class="password-settings">
    <div class="container">
      <div class="page-header">
        <h1>Administrator Settings</h1>
        <p>Manage the shared Veldr and NoteFlow administrator password.</p>
      </div>

      <div class="settings-grid">
        <section class="settings-card">
          <h3>Account Status</h3>
          <p><strong>Account:</strong> {{ adminInfo.username || 'admin' }}</p>
          <p>Session stays signed in for up to 60 days.</p>
          <p v-if="adminInfo.lastModified">Password updated {{ formatDate(adminInfo.lastModified) }}</p>
        </section>

        <section class="settings-card">
          <h3>Change Password</h3>
          <form @submit.prevent="updatePassword">
            <label for="current-password">Current password</label>
            <input id="current-password" v-model="currentPassword" type="password" autocomplete="current-password" class="form-control">
            <label for="new-password">New password</label>
            <input id="new-password" v-model="newPassword" type="password" minlength="8" maxlength="128" autocomplete="new-password" class="form-control" placeholder="8 to 128 characters">
            <label for="confirm-password">Confirm new password</label>
            <input id="confirm-password" v-model="confirmPassword" type="password" minlength="8" maxlength="128" autocomplete="new-password" class="form-control">
            <button type="submit" class="btn btn-primary" :disabled="isUpdating">
              <i :class="isUpdating ? 'fas fa-spinner fa-spin' : 'fas fa-save'"></i>
              {{ isUpdating ? 'Updating...' : 'Update Password' }}
            </button>
          </form>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useToast } from 'vue-toastification';
import { usePasswordAuth } from '@/composables/usePasswordAuth.js';

const { getAdminInfo, setPassword } = usePasswordAuth();
const toast = useToast();
const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const isUpdating = ref(false);
const adminInfo = ref({ username: '', lastModified: null });
const formatDate = (value) => new Date(value).toLocaleString();

const load = async () => {
  try { adminInfo.value = await getAdminInfo(); }
  catch (error) { toast.error(error.message || 'Failed to load account settings'); }
};

const updatePassword = async () => {
  if (newPassword.value.length < 8 || newPassword.value.length > 128) {
    toast.error('New password must contain 8 to 128 characters');
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    toast.error('New passwords do not match');
    return;
  }
  try {
    isUpdating.value = true;
    const data = await setPassword(currentPassword.value, newPassword.value);
    adminInfo.value = { ...adminInfo.value, ...data };
    currentPassword.value = '';
    newPassword.value = '';
    confirmPassword.value = '';
    toast.success('Password updated. Other devices need to sign in again.');
  } catch (error) {
    toast.error(error.message || 'Failed to update password');
  } finally { isUpdating.value = false; }
};

onMounted(load);
</script>

<style lang="scss" scoped>
.password-settings{min-height:100vh;padding:4rem 0;background:var(--color-bg)}.container{width:min(100% - 2rem,960px);margin:0 auto}.page-header{margin-bottom:2rem;text-align:center}.page-header h1{margin:0;color:var(--color-heading);font-size:2.5rem}.page-header p{color:var(--color-text-muted)}.settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1.5rem}.settings-card{padding:1.5rem;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--border-radius-lg);box-shadow:var(--shadow-card)}.settings-card h3{margin-top:0}.settings-card p{color:var(--color-text-muted);line-height:1.6}.settings-card label{display:block;margin:1rem 0 .45rem;font-weight:700}.form-control{width:100%;padding:.8rem .9rem;border:1px solid var(--color-border);border-radius:var(--border-radius);background:var(--color-surface);color:var(--color-text)}.form-control:focus{outline:none;border-color:var(--color-accent);box-shadow:0 0 0 3px var(--color-focus-ring)}.btn{display:inline-flex;align-items:center;gap:.5rem;margin-top:1.25rem;min-height:2.5rem;padding:.6rem 1rem;border:0;border-radius:var(--border-radius);cursor:pointer;font-weight:800}.btn:disabled{opacity:.6;cursor:not-allowed}.btn-primary{color:var(--color-text-inverse);background:var(--color-accent)}@media(max-width:768px){.settings-grid{grid-template-columns:1fr}}
</style>
