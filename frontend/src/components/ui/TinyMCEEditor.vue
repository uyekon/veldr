<template>
  <div class="tinymce-editor">
    <div class="editor-container">
      <Editor
        v-model="content"
        :api-key="apiKey"
        :init="editorConfig"
        :disabled="disabled"
        :tinymce-script-src="tinymceCdnSrc"
        @init="onEditorInit"
        @change="onContentChange"
        @blur="onEditorBlur"
        @focus="onEditorFocus"
      />

      <div v-if="loading" class="editor-loading-overlay">
        <div class="spinner-border text-primary" role="status">
          <span class="visually-hidden">Loading editor...</span>
        </div>
        <p>Loading editor...</p>
      </div>
    </div>

    <div v-if="showToolbar" class="editor-toolbar">
      <div class="toolbar-group">
        <button @click="insertImage" class="toolbar-button" :disabled="disabled" type="button" title="Insert image">
          <i class="fas fa-image"></i>
          <span>Image</span>
        </button>
        <button @click="insertLink" class="toolbar-button" :disabled="disabled" type="button" title="Insert link">
          <i class="fas fa-link"></i>
          <span>Link</span>
        </button>
        <button @click="insertTable" class="toolbar-button" :disabled="disabled" type="button" title="Insert table">
          <i class="fas fa-table"></i>
          <span>Table</span>
        </button>
      </div>

      <div class="toolbar-group">
        <button @click="togglePreview" class="toolbar-button" :disabled="disabled" type="button" title="Preview">
          <i class="fas fa-eye"></i>
          <span>{{ isPreviewMode ? 'Edit' : 'Preview' }}</span>
        </button>
        <button @click="toggleFullscreen" class="toolbar-button" :disabled="disabled" type="button" title="Fullscreen">
          <i class="fas fa-expand"></i>
          <span>{{ isFullscreen ? 'Exit' : 'Full' }}</span>
        </button>
      </div>
    </div>

    <div v-if="showCharCount" class="char-count">
      <span>
        {{ characterCount }} characters
        <span v-if="wordCount > 0">({{ wordCount }} words)</span>
      </span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onUnmounted, nextTick } from 'vue';
import Editor from '@tinymce/tinymce-vue';
import { useToast } from 'vue-toastification';

const props = defineProps({
  modelValue: {
    type: String,
    default: ''
  },
  disabled: {
    type: Boolean,
    default: false
  },
  height: {
    type: [Number, String],
    default: 500
  },
  placeholder: {
    type: String,
    default: 'Start writing...'
  },
  showToolbar: {
    type: Boolean,
    default: false
  },
  showCharCount: {
    type: Boolean,
    default: true
  },
  uploadUrl: {
    type: String,
    default: '/api/upload'
  },
  apiKey: {
    type: String,
    default: ''
  }
});

const emit = defineEmits(['update:modelValue', 'init', 'change', 'blur', 'focus']);

const toast = useToast();
const loading = ref(true);
const editorInstance = ref(null);
const isPreviewMode = ref(false);
const isFullscreen = ref(false);
const hasChange = ref(false);
const hasInit = ref(false);

const tinyApiKey = props.apiKey || import.meta.env.VITE_TINYMCE_API_KEY || 'no-api-key';
const tinymceCdnSrc = `https://cdn.tiny.cloud/1/${tinyApiKey}/tinymce/6/tinymce.min.js`;
const content = ref(String(props.modelValue || ''));

const stripHtml = (html) => String(html ?? '').replace(/<[^>]*>/g, ' ');

const characterCount = computed(() => stripHtml(content.value).replace(/\s+/g, '').length);

const wordCount = computed(() => {
  const text = stripHtml(content.value).trim();
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
});

const uploadImage = (file, progress) => new Promise((resolve, reject) => {
  const formData = new FormData();
  formData.append('file', file);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', props.uploadUrl);
  xhr.withCredentials = true;
  xhr.timeout = 30000;

  xhr.upload.addEventListener('progress', (event) => {
    if (event.lengthComputable && typeof progress === 'function') {
      progress((event.loaded / event.total) * 100);
    }
  });

  xhr.addEventListener('load', () => {
    if (xhr.status !== 200) {
      const message = `HTTP error ${xhr.status}`;
      toast.error(`Image upload failed: ${message}`);
      reject(new Error(message));
      return;
    }

    try {
      const response = JSON.parse(xhr.responseText);
      if (response.success && response.url) {
        toast.success('Image uploaded');
        resolve(response.url);
        return;
      }

      const message = response.message || 'Unknown upload error';
      toast.error(`Image upload failed: ${message}`);
      reject(new Error(message));
    } catch (error) {
      toast.error('Image upload failed: invalid server response');
      reject(error);
    }
  });

  xhr.addEventListener('error', () => {
    toast.error('Image upload failed: network error');
    reject(new Error('Network error'));
  });

  xhr.addEventListener('timeout', () => {
    toast.error('Image upload failed: request timed out');
    reject(new Error('Request timed out'));
  });

  xhr.send(formData);
});

const openImagePicker = (callback) => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';

  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;

    if (file.size / 1024 / 1024 >= 16) {
      toast.error('Image must be under 16MB');
      return;
    }

    try {
      const url = await uploadImage(file);
      callback(url, { title: file.name });
    } catch (error) {
      console.error('TinyMCE file picker upload failed:', error);
    }
  };

  input.click();
};

const editorConfig = {
  height: props.height,
  width: '100%',
  menubar: false,
  branding: false,
  statusbar: true,
  readonly: false,
  resize: false,
  contextmenu: 'copy paste cut link',
  draggable_modal: true,
  placeholder: props.placeholder,
  theme: 'silver',
  content_style: `
    body {
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      font-size: 15px;
      line-height: 1.7;
      color: #18201f;
      padding: 12px 16px;
    }
    img { max-width: 100%; height: auto; border-radius: 8px; }
    blockquote { border-left: 3px solid #16a085; margin-left: 0; padding-left: 16px; color: #52605c; }
  `,
  fontsize_formats: '12px 14px 16px 18px 20px 22px 24px 28px 36px 48px',
  font_formats: 'Inter=Inter,Arial,sans-serif; Georgia=georgia,serif; Arial=arial,helvetica,sans-serif; Courier New=courier new,courier,monospace; Times New Roman=times new roman,times,serif; Verdana=verdana,geneva,sans-serif',
  toolbar_sticky: true,
  toolbar_mode: 'sliding',
  plugins: 'advlist autolink lists link image charmap preview anchor searchreplace visualblocks code fullscreen insertdatetime media table help wordcount emoticons',
  toolbar: 'undo redo | fontselect styleselect fontsizeselect | bold italic underline strikethrough | alignleft aligncenter alignright alignjustify | outdent indent | bullist numlist | link image media table | forecolor backcolor | removeformat | customUpload clearContent | code | help | fullscreen',
  automatic_uploads: true,
  file_picker_types: 'image',
  image_advtab: true,
  images_upload_handler: (blobInfo, progress) => uploadImage(blobInfo.blob(), progress),
  paste_data_images: true,
  paste_as_text: false,
  relative_urls: false,
  remove_script_host: false,
  convert_urls: true,
  quickbars_selection_toolbar: 'bold italic underline strikethrough | link h2 h3 h4 blockquote',
  quickbars_insert_toolbar: 'quickimage quicktable',
  textpattern_patterns: [
    { start: '*', end: '*', format: 'italic' },
    { start: '**', end: '**', format: 'bold' },
    { start: '#', format: 'h1' },
    { start: '##', format: 'h2' },
    { start: '###', format: 'h3' },
    { start: '####', format: 'h4' },
    { start: '#####', format: 'h5' },
    { start: '######', format: 'h6' },
    { start: '1. ', cmd: 'InsertOrderedList' },
    { start: '* ', cmd: 'InsertUnorderedList' },
    { start: '- ', cmd: 'InsertUnorderedList' }
  ],
  file_picker_callback: (callback, value, meta) => {
    if (meta.filetype === 'image') {
      openImagePicker(callback);
    }
  },
  init_instance_callback: (editor) => {
    loading.value = false;
    editorInstance.value = editor;
    hasInit.value = true;

    if (props.modelValue) {
      const stringValue = String(props.modelValue || '');
      editor.setContent(stringValue);
      content.value = stringValue;
    }

    editor.on('Input undo redo Change execCommand SetContent', () => {
      hasChange.value = true;
      const editorContent = editor.getContent();
      content.value = String(editorContent || '');
      emit('change', editorContent, editor);

      setTimeout(() => {
        hasChange.value = false;
      }, 100);
    });
  },
  setup: (editor) => {
    editor.ui.registry.addButton('customUpload', {
      text: 'Upload',
      tooltip: 'Upload image',
      onAction: () => openImagePicker((url, meta) => {
        editor.insertContent(`<img src="${url}" alt="${meta.title || ''}" />`);
      })
    });

    editor.ui.registry.addButton('clearContent', {
      text: 'Clear',
      tooltip: 'Clear content',
      onAction: () => {
        editor.setContent('');
        content.value = '';
      }
    });

    editor.on('keydown', (event) => {
      if (event.keyCode === 9) {
        editor.execCommand(event.shiftKey ? 'Outdent' : 'Indent');
        event.preventDefault();
        event.stopPropagation();
      }
    });

    editor.on('FullscreenStateChanged', (event) => {
      isFullscreen.value = event.state;
    });
  }
};

watch(() => props.modelValue, (newValue) => {
  if (!hasChange.value && hasInit.value) {
    const stringValue = String(newValue || '');
    if (stringValue !== content.value) {
      content.value = stringValue;
      nextTick(() => {
        editorInstance.value?.setContent(stringValue);
      });
    }
  }
});

watch(content, (newValue) => {
  emit('update:modelValue', newValue);
});

const onEditorInit = (event, editor) => {
  emit('init', editor);
};

const onContentChange = (value, editor) => {
  const stringValue = String(value ?? '');
  content.value = stringValue;
  emit('change', stringValue, editor);
};

const onEditorBlur = (event, editor) => {
  emit('blur', event, editor);
};

const onEditorFocus = (event, editor) => {
  emit('focus', event, editor);
};

const insertImage = () => {
  editorInstance.value?.execCommand('mceImage');
};

const insertLink = () => {
  editorInstance.value?.execCommand('mceLink');
};

const insertTable = () => {
  editorInstance.value?.execCommand('mceInsertTable');
};

const togglePreview = () => {
  editorInstance.value?.execCommand('mcePreview');
  isPreviewMode.value = !isPreviewMode.value;
};

const toggleFullscreen = () => {
  editorInstance.value?.execCommand('mceFullScreen');
  isFullscreen.value = !isFullscreen.value;
};

defineExpose({
  focus: () => editorInstance.value?.focus(),
  blur: () => editorInstance.value?.blur(),
  getContent: () => editorInstance.value?.getContent(),
  setContent: (value) => editorInstance.value?.setContent(value),
  insertContent: (value) => editorInstance.value?.insertContent(value),
  execCommand: (command) => editorInstance.value?.execCommand(command),
  getEditor: () => editorInstance.value
});

onUnmounted(() => {
  editorInstance.value?.destroy();
});
</script>

<style lang="scss" scoped>
.tinymce-editor {
  width: 100%;
}

.editor-container {
  position: relative;
  width: 100%;

  :deep(.tox-tinymce) {
    border: 1px solid var(--color-border) !important;
    border-radius: 8px !important;
    box-shadow: var(--shadow-soft) !important;
    overflow: hidden;

    &:focus-within {
      border-color: var(--accent) !important;
      box-shadow: 0 0 0 3px var(--accent-soft) !important;
    }
  }

  :deep(.tox-toolbar),
  :deep(.tox-toolbar__primary),
  :deep(.tox-menubar),
  :deep(.tox-statusbar) {
    background: var(--color-surface-muted) !important;
    border-color: var(--color-border) !important;
  }

  :deep(.tox-edit-area__iframe) {
    background: var(--color-surface) !important;
  }
}

.editor-loading-overlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  background: color-mix(in srgb, var(--color-surface) 82%, transparent);
  color: var(--color-text-muted);

  p {
    margin: 0;
    font-size: 0.9rem;
  }
}

.editor-toolbar,
.char-count {
  border: 1px solid var(--color-border);
  background: var(--color-surface-muted);
  color: var(--color-text-muted);
}

.editor-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem;
  border-top: 0;
  border-radius: 0 0 8px 8px;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.toolbar-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  min-height: 36px;
  padding: 0.45rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.18s ease, border-color 0.18s ease, color 0.18s ease;

  &:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent-strong);
    transform: translateY(-1px);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
}

.char-count {
  display: flex;
  justify-content: flex-end;
  margin-top: 0.5rem;
  padding: 0.5rem 0.65rem;
  border-radius: 8px;
  font-size: 0.78rem;
  font-weight: 700;
}

.spinner-border {
  display: inline-block;
  width: 2rem;
  height: 2rem;
  vertical-align: -0.125em;
  border: 0.22em solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spinner-border 0.75s linear infinite;
}

.text-primary {
  color: var(--accent);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@keyframes spinner-border {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 768px) {
  .editor-toolbar {
    flex-direction: column;
  }

  .toolbar-button {
    flex: 1 1 auto;
  }
}
</style>
