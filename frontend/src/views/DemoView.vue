<template>
  <div class="demo-view">
    <section class="hero-section">
      <div class="container hero-grid">
        <div class="hero-content">
          <h1 class="hero-title">Veldr Personal Notes</h1>
          <p class="hero-subtitle">
            A quiet space for your thoughts, ideas, and writing. Private by design. Yours to keep.
          </p>
          <div class="hero-actions">
            <router-link to="/admin/articles/create" class="btn btn-primary btn-lg">
              <i class="fas fa-plus"></i>
              New Note
            </router-link>
            <router-link to="/articles" class="btn btn-outline-primary btn-lg">
              <i class="fas fa-lock"></i>
              Private Notes
            </router-link>
          </div>
        </div>

        <div class="hero-visual" aria-hidden="true">
          <div class="sun-mark"></div>
          <i class="fas fa-seedling plant-mark"></i>
          <div class="line line-one"></div>
          <div class="line line-two"></div>
          <div class="line line-three"></div>
        </div>
      </div>
    </section>

    <section id="articles" class="articles-section">
      <div class="container">
        <div class="section-header section-header--row">
          <div>
            <h2 class="section-title">Recent Notes</h2>
            <p class="section-subtitle">Recent thoughts and records from your private writing space.</p>
          </div>
          <router-link to="/articles" class="section-link">
            View all notes
            <i class="fas fa-arrow-right"></i>
          </router-link>
        </div>

        <div v-if="loading" class="state-panel">
          <div class="spinner-border text-primary" role="status">
            <span class="visually-hidden">Loading...</span>
          </div>
          <p>Loading notes...</p>
        </div>

        <div v-else-if="error" class="state-panel state-panel--error">
          <i class="fas fa-exclamation-triangle"></i>
          {{ error }}
        </div>

        <div v-else-if="articles.length === 0" class="empty-strip">
          <i class="fas fa-pen-nib"></i>
          <div>
            <h3>No notes yet</h3>
            <p>Start with one sentence, one thought, or one fragment.</p>
          </div>
          <router-link to="/admin/articles/create" class="btn btn-primary">
            Create First Note
          </router-link>
        </div>

        <div v-else class="articles-grid">
          <article v-for="article in articles" :key="article.id" class="article-card">
            <div class="article-image" v-if="article.featuredImage">
              <LazyImage :src="`/uploads/${article.featuredImage}`" :alt="article.title" :lazy="true" />
            </div>
            <div class="article-content">
              <div class="article-meta">
                <time :datetime="article.createdAt" class="article-date">
                  {{ formatDate(article.createdAt) }}
                </time>
                <span class="article-status" :class="`status-${article.status}`">
                  {{ article.status }}
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
              <div class="article-footer">
                <router-link :to="articleLink(article)" class="article-link">
                  Read Note
                  <i class="fas fa-arrow-right"></i>
                </router-link>
              </div>
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
    </section>

    <section class="features-section">
      <div class="container">
        <div class="section-header">
          <h2 class="section-title">Built for focus. Designed for your mind.</h2>
        </div>
        <div class="features-grid">
          <div class="feature-item">
            <i class="fas fa-lock"></i>
            <div>
              <h3>Private by default</h3>
              <p>Your notes are visible only to you until you decide otherwise.</p>
            </div>
          </div>
          <div class="feature-item">
            <i class="fas fa-pen"></i>
            <div>
              <h3>Write without distraction</h3>
              <p>A clean space for drafts, daily thoughts, and unfinished ideas.</p>
            </div>
          </div>
          <div class="feature-item">
            <i class="fas fa-tag"></i>
            <div>
              <h3>Organize your way</h3>
              <p>Use titles, status, and images without forcing a rigid system.</p>
            </div>
          </div>
          <div class="feature-item">
            <i class="fas fa-cloud"></i>
            <div>
              <h3>Access anywhere</h3>
              <p>Keep your writing close across the places you work and think.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
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

    const response = await apiFetch(`/api/articles?page=${page}&limit=${pageSize}&status=published`);

    if (!response.ok) {
      throw new Error('Failed to fetch articles');
    }

    const data = await response.json();

    if (data.success) {
      articles.value = append ? [...articles.value, ...data.data] : data.data;
      hasMore.value = data.data.length === pageSize;
      currentPage.value = page;
    } else {
      throw new Error(data.message || 'Failed to load articles');
    }
  } catch (err) {
    console.error('Error fetching articles:', err);
    error.value = 'Failed to load notes. Please try again later.';
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
@use 'sass:color';
@use '@/assets/styles/variables' as *;

.demo-view {
  min-height: 100vh;
  background: var(--color-bg);
}

.container {
  width: min(100% - 2rem, 1280px);
  margin: 0 auto;
}

.hero-section {
  background:
    radial-gradient(circle at 80% 28%, var(--color-accent-soft), transparent 18rem),
    linear-gradient(180deg, var(--color-hero-bg), var(--color-bg));
  border-bottom: 1px solid var(--color-border);
  padding: 5.5rem 0 4.5rem;
}

.hero-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(20rem, 0.95fr);
  align-items: center;
  gap: clamp(2rem, 6vw, 7rem);
}

.hero-title {
  max-width: 52rem;
  margin-bottom: 1.5rem;
  color: var(--color-heading);
  font-family: Georgia, 'Times New Roman', serif;
  font-size: clamp(3rem, 7vw, 5.7rem);
  font-weight: 700;
  line-height: 0.98;
  letter-spacing: 0;
}

.hero-subtitle {
  max-width: 42rem;
  color: var(--color-text);
  font-size: 1.2rem;
  line-height: 1.75;
  margin-bottom: 2.5rem;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.hero-visual {
  position: relative;
  min-height: 21rem;
  color: var(--color-accent);
}

.sun-mark {
  position: absolute;
  top: 1rem;
  right: 21%;
  width: 4rem;
  height: 4rem;
  border-radius: 999px;
  background: var(--color-accent-soft);
}

.plant-mark {
  position: absolute;
  left: 30%;
  top: 8rem;
  font-size: 5.5rem;
}

.line {
  position: absolute;
  right: 10%;
  height: 1px;
  background: var(--color-accent);
  opacity: 0.72;
}

.line-one { top: 12rem; width: 19rem; }
.line-two { top: 13.4rem; width: 24rem; }
.line-three { top: 14.8rem; width: 17rem; }

.articles-section,
.features-section {
  padding: 4.5rem 0;
}

.section-header {
  margin-bottom: 1.75rem;
  text-align: center;
}

.section-header--row {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 1.5rem;
  text-align: left;
}

.section-title {
  margin: 0;
  color: var(--color-heading);
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 1.75rem;
  line-height: 1.2;
}

.section-subtitle {
  margin-top: 0.55rem;
  color: var(--color-text-muted);
  font-size: 1rem;
}

.section-link,
.article-link {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--color-accent);
  font-weight: 700;
  text-decoration: none;
}

.articles-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 1.5rem;
}

.article-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-lg);
  box-shadow: var(--shadow-card);
  overflow: hidden;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;

  &:hover {
    transform: translateY(-3px);
    border-color: var(--color-accent-border);
    box-shadow: var(--shadow-soft);
  }
}

.article-image {
  aspect-ratio: 16 / 9;
  overflow: hidden;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
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
  font-size: 0.78rem;
}

.article-status {
  padding: 0.22rem 0.55rem;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 800;
  text-transform: uppercase;
  background: var(--color-accent-soft);
  color: var(--color-accent);

  &.status-published {
    background-color: rgba(16, 185, 129, 0.1);
    color: var(--color-success);
  }

  &.status-draft {
    background-color: rgba(245, 158, 11, 0.12);
    color: var(--color-warning);
  }
}

.demo-view .article-title {
  margin-bottom: 0.8rem;

  a {
    color: var(--color-heading);
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 1.25rem;
    font-weight: 700;
    line-height: 1.25;
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

.features-section {
  background: var(--color-surface);
  border-top: 1px solid var(--color-border);
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0;
}

.feature-item {
  display: flex;
  gap: 1rem;
  padding: 1.5rem 2rem;
  border-left: 1px solid var(--color-border);

  &:first-child {
    border-left: 0;
  }

  i {
    color: var(--color-accent);
    font-size: 1.75rem;
    margin-top: 0.15rem;
  }

  h3 {
    margin: 0 0 0.45rem;
    color: var(--color-heading);
    font-size: 1rem;
  }

  p {
    margin: 0;
    color: var(--color-text-muted);
    line-height: 1.55;
    font-size: 0.92rem;
  }
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.55rem;
  min-height: 2.75rem;
  padding: 0.75rem 1.25rem;
  font-weight: 800;
  line-height: 1.2;
  text-align: center;
  text-decoration: none;
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: var(--border-radius);
  transition: transform 0.18s ease, background-color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;

  &:hover:not(:disabled) {
    transform: translateY(-1px);
  }

  &:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }
}

.btn-primary {
  background-color: var(--color-accent);
  border-color: var(--color-accent);
  color: var(--color-text-inverse);
  box-shadow: 0 10px 20px var(--color-accent-soft);

  &:hover:not(:disabled) {
    background-color: var(--color-accent-strong);
    border-color: var(--color-accent-strong);
  }
}

.btn-outline-primary {
  background-color: var(--color-surface);
  border-color: var(--color-border);
  color: var(--color-heading);

  &:hover:not(:disabled) {
    border-color: var(--color-accent);
    color: var(--color-accent);
    box-shadow: 0 0 0 3px var(--color-focus-ring);
  }
}

.btn-lg {
  min-width: 11rem;
  min-height: 3.5rem;
  padding: 1rem 1.45rem;
  font-size: 1rem;
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

@media (max-width: 900px) {
  .hero-grid {
    grid-template-columns: 1fr;
  }

  .hero-visual {
    min-height: 12rem;
  }

  .features-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .feature-item:nth-child(odd) {
    border-left: 0;
  }
}

@media (max-width: 640px) {
  .hero-section {
    padding: 3.5rem 0;
  }

  .section-header--row,
  .empty-strip {
    align-items: flex-start;
    flex-direction: column;
  }

  .empty-strip .btn {
    margin-left: 0;
    width: 100%;
  }

  .features-grid {
    grid-template-columns: 1fr;
  }

  .feature-item {
    border-left: 0;
    border-top: 1px solid var(--color-border);
    padding: 1.35rem 0;

    &:first-child {
      border-top: 0;
    }
  }
}
</style>
