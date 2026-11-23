<template>
  <div class="private-articles">
    <div class="container">
      <div class="page-header">
        <h1 class="page-title">Private Notes</h1>
        <p class="page-subtitle">Locked writing, drafts, and records that are yours to keep.</p>
      </div>

      <div v-if="loading" class="state-panel">
        <div class="spinner-border text-primary" role="status">
          <span class="visually-hidden">Loading...</span>
        </div>
        <p>Loading private notes...</p>
      </div>

      <div v-else-if="error" class="state-panel state-panel--error">
        <i class="fas fa-exclamation-triangle"></i>
        {{ error }}
      </div>

      <div v-else-if="articles.length === 0" class="empty-strip">
        <i class="fas fa-lock"></i>
        <div>
          <h3>No private notes yet</h3>
          <p>Private notes will appear here when you create them.</p>
        </div>
        <router-link to="/admin/articles/create" class="btn btn-primary">
          <i class="fas fa-plus"></i>
          Create Private Note
        </router-link>
      </div>

      <div v-else class="articles-grid">
        <article v-for="article in articles" :key="article.id" class="article-card private-card">
          <div class="article-image" v-if="article.featuredImage">
            <LazyImage :src="`/uploads/${article.featuredImage}`" :alt="article.title" :lazy="true" />
            <div class="private-overlay">
              <i class="fas fa-lock"></i>
            </div>
          </div>
          <div class="article-content">
            <div class="article-meta">
              <time :datetime="article.createdAt" class="article-date">
                {{ formatDate(article.createdAt) }}
              </time>
              <span class="article-status status-private">
                <i class="fas fa-lock"></i>
                Private
              </span>
            </div>
            <h3 class="article-title">
              <router-link :to="articleLink(article)">
                {{ article.title }}
              </router-link>
            </h3>
            <p class="article-excerpt" v-if="article.excerpt">
              {{ article.excerpt }}
            </p>
            <router-link :to="articleLink(article)" class="article-link">
              Read Note
              <i class="fas fa-arrow-right"></i>
            </router-link>
          </div>
        </article>
      </div>

      <div v-if="articles.length > 0 && hasMore" class="load-more">
        <button @click="loadMore" :disabled="loadingMore" class="btn btn-outline-primary">
          <span v-if="loadingMore" class="spinner-border spinner-border-sm me-2"></span>
          Load More Notes
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { format } from 'date-fns';
import LazyImage from '@/components/ui/LazyImage.vue';
import { apiFetch } from '@/utils/apiClient.js';

const articles = ref([]);
const loading = ref(true);
const loadingMore = ref(false);
const error = ref(null);
const hasMore = ref(false);
const currentPage = ref(1);
const pageSize = 6;

const articleLink = (article) => `/article/${article.slug || article.id}`;

const formatDate = (dateString) => {
  return format(new Date(dateString), 'MMM d, yyyy');
};

const fetchArticles = async (page = 1, append = false) => {
  try {
    if (page === 1) {
      loading.value = true;
      error.value = null;
    } else {
      loadingMore.value = true;
    }

    const response = await apiFetch(`/api/articles?page=${page}&limit=${pageSize}&status=private`);

    if (!response.ok) {
      throw new Error('Failed to fetch private articles');
    }

    const data = await response.json();

    if (data.success) {
      articles.value = append ? [...articles.value, ...data.data] : data.data;
      hasMore.value = data.data.length === pageSize;
      currentPage.value = page;
    } else {
      throw new Error(data.message || 'Failed to load private articles');
    }
  } catch (err) {
    console.error('Error fetching private articles:', err);
    error.value = 'Failed to load private notes. Please try again later.';
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
};

const loadMore = () => {
  fetchArticles(currentPage.value + 1, true);
};

onMounted(() => {
  fetchArticles();
});
</script>

<style lang="scss" scoped>
@use '@/assets/styles/variables' as *;

.private-articles {
  min-height: 100vh;
  padding: 4rem 0;
  background:
    radial-gradient(circle at 85% 8%, var(--color-accent-soft), transparent 20rem),
    var(--color-bg);
}

.container {
  width: min(100% - 2rem, 1280px);
  margin: 0 auto;
}

.page-header {
  margin-bottom: 2rem;
}

.page-title {
  margin: 0;
  color: var(--color-heading);
  font-family: Georgia, 'Times New Roman', serif;
  font-size: clamp(2.4rem, 6vw, 4.2rem);
  line-height: 1.05;
}

.page-subtitle {
  max-width: 42rem;
  margin: 0.8rem 0 0;
  color: var(--color-text-muted);
  font-size: 1.1rem;
  line-height: 1.7;
}

.articles-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1.5rem;
}

.article-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-lg);
  box-shadow: var(--shadow-card);
  overflow: hidden;
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;

  &:hover {
    transform: translateY(-3px);
    border-color: var(--color-accent-border);
    box-shadow: var(--shadow-soft);
  }

  &.private-card {
    border-top: 3px solid var(--color-warning);
  }
}

.article-image {
  position: relative;
  aspect-ratio: 16 / 9;
  overflow: hidden;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.private-overlay {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  color: white;
  background: rgba(15, 23, 42, 0.72);
  border-radius: 999px;
}

.article-content {
  padding: 1.35rem;
}

.article-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
  color: var(--color-text-muted);
  font-size: 0.8rem;
}

.article-status {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.22rem 0.6rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 800;

  &.status-private {
    background-color: rgba(245, 158, 11, 0.12);
    color: var(--color-warning);
  }
}

.private-articles .article-title {
  margin: 0 0 0.8rem;

  a {
    color: var(--color-heading);
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 1.25rem;
    line-height: 1.3;
    text-decoration: none;

    &:hover {
      color: var(--color-accent);
    }
  }
}

.article-excerpt {
  color: var(--color-text-muted);
  line-height: 1.6;
  margin-bottom: 1.25rem;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.article-link {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--color-accent);
  font-weight: 800;
  text-decoration: none;
}

.empty-strip,
.state-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.25rem;
  padding: 2rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-lg);
  box-shadow: var(--shadow-card);
}

.empty-strip {
  justify-content: flex-start;

  > i {
    color: var(--color-accent);
    font-size: 2rem;
  }

  h3 {
    margin: 0 0 0.25rem;
    color: var(--color-heading);
  }

  p {
    margin: 0;
    color: var(--color-text-muted);
  }

  .btn {
    margin-left: auto;
  }
}

.state-panel--error {
  color: var(--color-danger);
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.24);
}

.load-more {
  text-align: center;
  margin-top: 2rem;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.55rem;
  min-height: 2.75rem;
  padding: 0.75rem 1.25rem;
  color: var(--color-text-inverse);
  font-weight: 800;
  text-decoration: none;
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: var(--border-radius);
}

.btn-primary {
  background-color: var(--color-accent);
  border-color: var(--color-accent);
}

.btn-outline-primary {
  color: var(--color-accent);
  background: transparent;
  border-color: var(--color-accent);
}

.spinner-border {
  display: inline-block;
  width: 2rem;
  height: 2rem;
  vertical-align: -0.125em;
  border: 0.25em solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spinner-border 0.75s linear infinite;

  &-sm {
    width: 1rem;
    height: 1rem;
    border-width: 0.2em;
  }
}

@keyframes spinner-border {
  to { transform: rotate(360deg); }
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

.me-2 {
  margin-right: 0.5rem;
}

@media (max-width: 640px) {
  .private-articles {
    padding: 2.5rem 0;
  }

  .empty-strip {
    align-items: flex-start;
    flex-direction: column;

    .btn {
      width: 100%;
      margin-left: 0;
    }
  }
}
</style>
