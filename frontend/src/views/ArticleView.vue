<template>
  <div class="article-view">
    <div v-if="loading" class="loading-container">
      <div class="loading-skeleton">
        <div class="skeleton-line skeleton-title"></div>
        <div class="skeleton-line skeleton-subtitle"></div>
        <div class="skeleton-content">
          <div class="skeleton-line"></div>
          <div class="skeleton-line skeleton-line-5-6"></div>
          <div class="skeleton-line skeleton-line-2-3"></div>
        </div>
      </div>
    </div>

    <div v-else-if="error" class="error-container">
      <div class="error-alert">
        <i class="fas fa-circle-exclamation"></i>
        <p>{{ error }}</p>
      </div>
      <router-link to="/" class="back-link">
        <i class="fas fa-arrow-left"></i>
        Back to notes
      </router-link>
    </div>

    <article v-else class="article-container">
      <header class="article-header">
        <div class="article-meta">
          <time :datetime="article.createdAt">{{ formatDate(article.createdAt) }}</time>
          <span class="meta-separator"></span>
          <span>{{ readingTime }} min read</span>
        </div>
        <h1 class="article-title">{{ article.title }}</h1>

        <p v-if="article.excerpt" class="article-excerpt">
          {{ article.excerpt }}
        </p>

        <figure v-if="article.featuredImage" class="featured-image-container">
          <img :src="article.featuredImage" :alt="article.title" class="featured-image">
        </figure>
      </header>

      <div class="article-content" v-html="article.content"></div>

      <footer class="article-footer">
        <div>
          <p class="publish-date">
            Published on {{ formatFullDate(article.publishedAt || article.createdAt) }}
          </p>
          <p v-if="article.updatedAt !== article.createdAt" class="update-date">
            Updated on {{ formatFullDate(article.updatedAt) }}
          </p>
        </div>
        <router-link to="/" class="back-link">
          <i class="fas fa-arrow-left"></i>
          Back to notes
        </router-link>
      </footer>
    </article>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { apiFetch } from '@/utils/apiClient.js';

const route = useRoute();
const article = ref({});
const loading = ref(true);
const error = ref(null);

const formatDate = (dateString) => {
  return new Date(dateString).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
};

const formatFullDate = (dateString) => {
  return new Date(dateString).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const readingTime = computed(() => {
  if (!article.value.content) return 0;
  const text = article.value.content.replace(/<[^>]*>/g, ' ');
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(wordCount / 200));
});

const fetchArticle = async () => {
  const { id, slug } = route.params;
  const key = id ?? slug;
  if (!key) return;

  try {
    loading.value = true;
    error.value = null;

    let url = `/api/articles/${key}`;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(key))) {
      url = `/api/articles/slug/${key}`;
    }

    const response = await apiFetch(url);

    if (!response.ok) {
      throw new Error(response.status === 404 ? 'Article not found' : 'Failed to fetch article');
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.message || 'Failed to load article');
    }

    if (data.data.status === 'draft') {
      throw new Error('Article not found');
    }

    article.value = {
      ...data.data,
      featuredImage: data.data.featuredImage ? `/uploads/${data.data.featuredImage}` : null
    };

    document.title = `${article.value.title} | Veldr`;

    if (article.value.excerpt) {
      const metaDescription = document.querySelector('meta[name="description"]');
      metaDescription?.setAttribute('content', article.value.excerpt);
    }
  } catch (err) {
    console.error('Error fetching article:', err);
    error.value = 'Failed to load this note. It may have been moved or deleted.';
  } finally {
    loading.value = false;
  }
};

watch(() => route.fullPath, fetchArticle);

onMounted(() => {
  fetchArticle();
});
</script>

<style lang="scss">
.article-view {
  min-height: 100vh;
  background:
    radial-gradient(circle at 82% 5%, var(--color-accent-soft), transparent 18rem),
    var(--color-bg);
}

.loading-container,
.error-container,
.article-container {
  width: min(100% - 2rem, 920px);
  margin: 0 auto;
  padding: 4rem 0;
}

.loading-skeleton .skeleton-line {
  height: 1rem;
  margin-bottom: 1.5rem;
  background: var(--color-light-bg);
  border-radius: var(--border-radius);
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;

  &.skeleton-title {
    height: 3rem;
    width: 75%;
  }

  &.skeleton-subtitle {
    width: 50%;
  }

  &.skeleton-line-5-6 {
    width: 83%;
  }

  &.skeleton-line-2-3 {
    width: 66%;
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

.error-alert {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  padding: 1rem 1.25rem;
  margin-bottom: 1.5rem;
  color: var(--color-danger);
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.24);
  border-radius: var(--border-radius-lg);

  p {
    margin: 0;
  }
}

.article-header {
  margin-bottom: 2.5rem;
}

.article-meta {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  margin-bottom: 1.25rem;
  color: var(--color-text-muted);
  font-size: 0.9rem;
  font-weight: 600;
}

.meta-separator {
  width: 0.25rem;
  height: 0.25rem;
  border-radius: 999px;
  background: var(--color-accent);
}

.article-view .article-title {
  margin: 0;
  color: var(--color-heading);
  font-family: Georgia, 'Times New Roman', serif;
  font-size: clamp(2.4rem, 6vw, 4.4rem);
  font-weight: 700;
  line-height: 1.04;
  letter-spacing: 0;
}

.article-excerpt {
  max-width: 760px;
  margin: 1.35rem 0 0;
  color: var(--color-text-muted);
  font-size: 1.22rem;
  line-height: 1.7;
}

.featured-image-container {
  width: min(100%, 980px);
  margin: 2.25rem auto 0;
  overflow: hidden;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-lg);
  box-shadow: var(--shadow-card);
}

.featured-image {
  display: block;
  width: 100%;
  max-height: min(58vh, 560px);
  aspect-ratio: 16 / 9;
  object-fit: cover;
}

.article-content {
  max-width: 760px;
  margin: 0 auto;
  color: var(--color-text);
  font-size: 1.06rem;
  line-height: 1.78;
}

.article-content :deep(h1),
.article-content :deep(h2),
.article-content :deep(h3),
.article-content :deep(h4) {
  color: var(--color-heading);
  line-height: 1.25;
}

.article-content :deep(h1) {
  margin: 2.5rem 0 1.25rem;
  font-size: 2rem;
}

.article-content :deep(h2) {
  margin: 2.25rem 0 1rem;
  font-size: 1.6rem;
}

.article-content :deep(h3) {
  margin: 1.8rem 0 0.75rem;
  font-size: 1.3rem;
}

.article-content :deep(p),
.article-content :deep(ul),
.article-content :deep(ol) {
  margin-bottom: 1.45rem;
}

.article-content :deep(p),
.article-content :deep(li) {
  color: var(--color-text);
}

.article-content :deep(a) {
  color: var(--color-accent);
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.18em;
}

.article-content :deep(blockquote) {
  margin: 1.75rem 0;
  padding: 1rem 1.25rem;
  color: var(--color-text-muted);
  background: var(--color-accent-soft);
  border-left: 4px solid var(--color-accent);
  border-radius: 0 var(--border-radius) var(--border-radius) 0;
}

.article-content :deep(img) {
  display: block;
  width: 100%;
  height: auto;
  max-height: 58vh;
  margin: 2rem 0;
  object-fit: cover;
  border-radius: var(--border-radius-lg);
  box-shadow: var(--shadow-card);
}

.article-content :deep(table) {
  min-width: 100%;
  margin: 2rem 0;
  border-collapse: separate;
  border-spacing: 0;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
}

.article-content :deep(th),
.article-content :deep(td) {
  padding: 0.8rem 1rem;
  border-top: 1px solid var(--color-border);
}

.article-content :deep(th) {
  color: var(--color-text-muted);
  background: var(--color-light-bg);
  text-align: left;
  font-size: 0.78rem;
  text-transform: uppercase;
}

.article-content :deep(td) {
  color: var(--color-text);
}

.article-content :deep(tr:first-child th),
.article-content :deep(tr:first-child td) {
  border-top: 0;
}

.article-content :deep(code) {
  padding: 0.15rem 0.35rem;
  color: var(--color-accent);
  background: var(--color-accent-soft);
  border-radius: 0.25rem;
  font-family: var(--font-family-mono);
  font-size: 0.9em;
}

.article-content :deep(pre) {
  margin: 1.75rem 0;
  padding: 1rem;
  overflow-x: auto;
  color: #e5edf4;
  background: #0d1622;
  border-radius: var(--border-radius-lg);

  code {
    padding: 0;
    color: inherit;
    background: transparent;
  }
}

.article-content :deep(hr) {
  margin: 2.5rem 0;
  border: 0;
  border-top: 1px solid var(--color-border);
}

.article-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  max-width: 760px;
  margin: 3rem auto 0;
  padding-top: 2rem;
  border-top: 1px solid var(--color-border);
}

.publish-date,
.update-date {
  margin: 0;
  font-size: 0.9rem;
}

.publish-date {
  color: var(--color-heading);
  font-weight: 700;
}

.update-date {
  margin-top: 0.25rem;
  color: var(--color-text-muted);
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  color: var(--color-accent);
  font-size: 0.9rem;
  font-weight: 800;
  text-decoration: none;

  &:hover {
    color: var(--color-accent-strong);
  }
}

@media (max-width: 640px) {
  .loading-container,
  .error-container,
  .article-container {
    padding: 2.5rem 0;
  }

  .article-footer {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
