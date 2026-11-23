<template>
  <form @submit.prevent="handleSubmit" class="article-form">
    <ArticleBasicInfo
      v-model="formData"
      :errors="errors"
      :is-editing="isEditing"
      @title-change="onTitleChange"
      @slug-change="onSlugChange"
    />

    <ArticleContent
      v-model="formData"
      :errors="errors"
      @content-change="onContentChange"
    />

    <ArticleImageUpload
      v-model="formData"
      :errors="errors"
      @image-change="onImageChange"
    />

    <ArticleActions
      :is-editing="isEditing"
      :is-submitting="isSubmitting"
      :current-status="formData.status"
      :is-form-valid="isFormValid"
      :show-status="showStatus"
      :status-message="statusMessage"
      :is-toggling-status="isTogglingStatus"
      @cancel="handleCancel"
      @save="handleSave"
      @status-change="handleStatusChange"
    />
  </form>
</template>

<script setup>
import { ref, watch, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useToast } from 'vue-toastification';
import { useArticle } from '@/composables/useArticle.js';
import ArticleBasicInfo from './ArticleBasicInfo.vue';
import ArticleContent from './ArticleContent.vue';
import ArticleImageUpload from './ArticleImageUpload.vue';
import ArticleActions from './ArticleActions.vue';

const props = defineProps({
  article: {
    type: Object,
    default: () => ({
      title: '',
      slug: '',
      content: '',
      excerpt: '',
      status: 'private',
      featuredImage: null,
      featuredImageUrl: ''
    })
  },
  isEditing: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['submit']);

const router = useRouter();
const toast = useToast();

const {
  formData,
  isSubmitting,
  isEditing,
  validateForm,
  updateSlug,
  resetForm,
  prepareFormData
} = useArticle();

const errors = ref({});
const showStatus = ref(false);
const statusMessage = ref('');
const isTogglingStatus = ref(false);

const isFormValid = computed(() => {
  const validationErrors = validateForm();
  return Object.keys(validationErrors).length === 0;
});

watch(() => props.article, (newValue) => {
  resetForm(newValue);
}, { deep: true, immediate: true });

watch(() => formData.value.title, () => {
  updateSlug();
});

const onTitleChange = () => {};
const onSlugChange = () => {};
const onContentChange = () => {};
const onImageChange = () => {};

const validateBeforeSave = () => {
  const validationErrors = validateForm();
  errors.value = validationErrors;

  if (Object.keys(validationErrors).length > 0) {
    showStatus.value = true;
    statusMessage.value = 'Please fix the errors below before saving';
    return false;
  }

  return true;
};

const submitFormData = () => {
  const data = prepareFormData();
  emit('submit', data);
};

const handleSubmit = async () => {
  isSubmitting.value = true;
  errors.value = {};
  showStatus.value = false;

  try {
    if (!validateBeforeSave()) {
      isSubmitting.value = false;
      return;
    }

    submitFormData();
  } catch (error) {
    console.error('Error submitting note:', error);
    toast.error('An error occurred while saving the note');
    isSubmitting.value = false;
  }
};

const handleSave = async () => {
  isSubmitting.value = true;
  errors.value = {};
  showStatus.value = false;

  try {
    if (!validateBeforeSave()) {
      isSubmitting.value = false;
      return;
    }

    submitFormData();
  } catch (error) {
    console.error('Error saving note:', error);
    toast.error('An error occurred while saving the note');
    isSubmitting.value = false;
  }
};

const handleStatusChange = (newStatus) => {
  formData.value.status = newStatus;
  showStatus.value = true;

  const statusMessages = {
    draft: 'Draft',
    private: 'Private',
    published: 'Published'
  };

  statusMessage.value = `Status set to ${statusMessages[newStatus]}`;

  setTimeout(() => {
    showStatus.value = false;
  }, 3000);
};

const handleCancel = () => {
  router.back();
};

watch(() => props.isEditing, (newValue) => {
  isEditing.value = newValue;
}, { immediate: true });

const resetSubmittingState = () => {
  isSubmitting.value = false;
};

defineExpose({
  resetSubmittingState
});
</script>

<style lang="scss" scoped>
.article-form {
  display: grid;
}
</style>
