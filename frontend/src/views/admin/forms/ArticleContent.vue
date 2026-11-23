<template>
  <section class="article-content-form form-section">
    <div class="section-heading">
      <h2>Content</h2>
      <p>Write the body of the note. Formatting stays inside the editor.</p>
    </div>

    <div class="form-group">
      <TinyMCEEditor
        v-model="localContent"
        :api-key="tinymceApiKey"
        :height="500"
        :placeholder="'Start writing your note...'"
        :show-char-count="false"
        @change="onContentChange"
      />
      <div v-if="errors.content" class="invalid-feedback d-block">
        {{ errors.content }}
      </div>
    </div>

    <div class="content-stats">
      <div class="stat-item">
        <span class="stat-label">Words</span>
        <span class="stat-value">{{ wordCount }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">Characters</span>
        <span class="stat-value">{{ charCount }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">Reading Time</span>
        <span class="stat-value">{{ readingTime }} min</span>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, watch } from 'vue';
import TinyMCEEditor from '@/components/ui/TinyMCEEditor.vue';

const props = defineProps({
  modelValue: {
    type: Object,
    required: true
  },
  errors: {
    type: Object,
    default: () => ({})
  }
});

const emit = defineEmits(['update:modelValue', 'content-change']);
const tinymceApiKey = import.meta.env.VITE_TINYMCE_API_KEY || '';

const localContent = computed({
  get: () => String(props.modelValue.content || ''),
  set: (value) => {
    emit('update:modelValue', { ...props.modelValue, content: String(value || '') });
  }
});

watch(() => props.modelValue.content, (newValue) => {
  const stringValue = String(newValue || '');
  if (stringValue !== localContent.value) {
    localContent.value = stringValue;
  }
}, { immediate: true });

const wordCount = computed(() => {
  const text = String(props.modelValue.content || '').replace(/<[^>]*>/g, ' ').trim();
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
});

const charCount = computed(() => {
  return String(props.modelValue.content || '').replace(/<[^>]*>/g, '').length;
});

const readingTime = computed(() => Math.max(1, Math.ceil(wordCount.value / 200)));

const onContentChange = (content) => {
  const stringContent = String(content || '');
  localContent.value = stringContent;
  emit('content-change', stringContent);
};
</script>

<style lang="scss" scoped>
.form-section {
  padding: 1.5rem 0;
  border-bottom: 1px solid var(--color-border);
}

.section-heading {
  margin-bottom: 1rem;

  h2 {
    margin: 0;
    color: var(--color-heading);
    font-size: 1.1rem;
  }

  p {
    margin: 0.35rem 0 0;
    color: var(--color-text-muted);
    font-size: 0.92rem;
  }
}

.form-group {
  margin-bottom: 1rem;
}

.invalid-feedback {
  margin-top: 0.35rem;
  color: var(--color-danger);
  font-size: 0.86rem;
}

.content-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
  padding: 1rem;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
}

.stat-item {
  display: grid;
  gap: 0.25rem;
  text-align: center;
}

.stat-label {
  color: var(--color-text-muted);
  font-size: 0.75rem;
  font-weight: 800;
  text-transform: uppercase;
}

.stat-value {
  color: var(--color-heading);
  font-size: 1.15rem;
  font-weight: 900;
}

@media (max-width: 640px) {
  .content-stats {
    grid-template-columns: 1fr;
  }

  .stat-item {
    display: flex;
    justify-content: space-between;
    text-align: left;
  }
}
</style>
