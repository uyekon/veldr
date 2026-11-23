<template>
  <div class="article-list">
    <div class="page-header">
      <div>
        <h1>Notes</h1>
        <p>Review, search, and move notes between draft, private, and published states.</p>
      </div>
      <div class="header-actions">
        <div class="stats">
          <span class="stat-item">
            <i class="fas fa-file-alt text-primary"></i>
            <span>{{ articles.length }} notes</span>
          </span>
          <span class="stat-item">
            <i class="fas fa-eye text-success"></i>
            <span>{{ publishedCount }} published</span>
          </span>
        </div>
        <router-link to="/admin/articles/create" class="btn btn-primary">
          <i class="fas fa-plus"></i>
          New Note
        </router-link>
      </div>
    </div>

    <DeleteConfirmModal
      :show="showDeleteModal"
      :article-title="articleToDelete?.title || ''"
      :is-deleting="isDeleting !== null"
      @confirm="confirmDelete"
      @cancel="cancelDelete"
    />

    <div class="panel">
      <div v-if="loading" class="state-panel">
        <div class="spinner-border text-primary" role="status">
          <span class="visually-hidden">Loading...</span>
        </div>
      </div>

      <div v-else-if="articles.length === 0" class="state-panel">
        <p class="text-muted">No notes found.</p>
        <router-link to="/admin/articles/create" class="btn btn-primary">
          Create your first note
        </router-link>
      </div>

      <div v-else>
        <div class="search-filter-bar">
          <div class="search-box">
            <i class="fas fa-search"></i>
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Search title, slug, or excerpt..."
              class="search-input"
            />
          </div>
          <div class="filter-controls">
            <select v-model="statusFilter" class="status-filter">
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="private">Private</option>
              <option value="published">Published</option>
            </select>
            <button @click="refreshArticles" class="btn btn-outline-secondary btn-sm">
              <i class="fas fa-sync-alt"></i>
              Refresh
            </button>
          </div>
        </div>

        <div v-if="filteredArticles.length === 0" class="state-panel">
          <p class="text-muted">No notes match the current search or filter.</p>
        </div>

        <div v-else class="table-responsive">
          <table class="table">
            <thead>
              <tr>
                <th>Note</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="article in filteredArticles" :key="article.id" :data-article-id="article.id">
                <td class="note-cell">
                  <div class="article-info">
                    <div class="article-title">
                      <span class="fw-semibold">{{ article.title }}</span>
                    </div>
                    <div class="article-meta">
                      <span class="text-muted small">/{{ article.slug }}</span>
                      <span v-if="article.excerpt" class="excerpt">{{ article.excerpt }}</span>
                    </div>
                  </div>
                </td>
                <td class="status-cell">
                  <button
                    :class="['badge', 'status-toggle', getStatusClass(article.status)]"
                    :disabled="isTogglingStatus === article.id"
                    :title="`Click to change ${getStatusLabel(article.status)} to ${getNextStatusLabel(article.status)}`"
                    @click="toggleStatus(article)"
                  >
                    <i v-if="isTogglingStatus === article.id" class="fas fa-spinner fa-spin me-1"></i>
                    <i v-else :class="getStatusIcon(article.status)" class="me-1"></i>
                    {{ getStatusLabel(article.status) }}
                  </button>
                </td>
                <td class="date-cell">
                  <div class="date-info">
                    <div class="created-date">{{ formatDate(article.createdAt) }}</div>
                    <div class="text-muted small">
                      <i class="fas fa-clock me-1"></i>
                      Updated {{ formatTimeAgo(article.updatedAt) }}
                    </div>
                  </div>
                </td>
                <td class="actions-cell text-nowrap">
                  <div class="action-buttons">
                    <router-link
                      v-if="article && article.id"
                      :to="{ name: 'ArticleEdit', params: { id: article.id } }"
                      class="btn btn-sm btn-outline-primary"
                      title="Edit note"
                    >
                      <i class="fas fa-edit"></i>
                    </router-link>
                    <button
                      @click="deleteArticle(article.id)"
                      class="btn btn-sm btn-outline-danger"
                      :disabled="isDeleting === article.id"
                      title="Delete note"
                    >
                      <i v-if="isDeleting === article.id" class="fas fa-spinner fa-spin"></i>
                      <i v-else class="fas fa-trash"></i>
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="pagination.totalPages > 1" class="pagination-bar">
          <span class="pagination-info">
            {{ pagination.total }} notes · page {{ pagination.page }} / {{ pagination.totalPages }}
          </span>
          <div class="pagination-controls">
            <button
              class="btn btn-sm btn-outline-secondary"
              :disabled="pagination.page <= 1 || loading"
              @click="goToPage(pagination.page - 1)"
            >
              <i class="fas fa-chevron-left"></i>
              Prev
            </button>
            <button
              class="btn btn-sm btn-outline-secondary"
              :disabled="pagination.page >= pagination.totalPages || loading"
              @click="goToPage(pagination.page + 1)"
            >
              Next
              <i class="fas fa-chevron-right"></i>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useToast } from 'vue-toastification';
import { useArticleStore } from '@/stores/articleStore.js';
import DeleteConfirmModal from '@/components/ui/DeleteConfirmModal.vue';

const toast = useToast();
const articleStore = useArticleStore();

const articles = computed(() => articleStore.articles);
const loading = computed(() => articleStore.loading);
const pagination = computed(() => articleStore.pagination);

const currentPage = ref(1);
const PAGE_SIZE = 20;

const publishedCount = computed(() => {
  return articles.value.filter(article => article.status === 'published').length;
});

const searchQuery = ref('');
const statusFilter = ref('');

const filteredArticles = computed(() => {
  let filtered = articles.value || [];

  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase().trim();
    filtered = filtered.filter(article =>
      article.title?.toLowerCase().includes(query) ||
      article.slug?.toLowerCase().includes(query) ||
      article.excerpt?.toLowerCase().includes(query)
    );
  }

  if (statusFilter.value) {
    filtered = filtered.filter(article => article.status === statusFilter.value);
  }

  return filtered;
});

const isDeleting = ref(null);
const showDeleteModal = ref(false);
const articleToDelete = ref(null);
const isTogglingStatus = ref(null);

const fetchArticles = async () => {
  try {
    await articleStore.fetchArticles({ page: currentPage.value, limit: PAGE_SIZE });
    // 删除后当前页可能为空，自动回退一页
    if (articles.value.length === 0 && currentPage.value > 1) {
      currentPage.value -= 1;
      await articleStore.fetchArticles({ page: currentPage.value, limit: PAGE_SIZE });
    }
  } catch (err) {
    toast.error('Failed to load notes');
  }
};

const goToPage = async (page) => {
  const totalPages = pagination.value.totalPages || 1;
  const target = Math.min(Math.max(1, page), totalPages);
  if (target === currentPage.value) return;
  currentPage.value = target;
  await fetchArticles();
};

const refreshArticles = async () => {
  try {
    await fetchArticles();
    toast.success('Notes refreshed');
  } catch (err) {
    toast.error('Refresh failed');
  }
};

const deleteArticle = (id) => {
  if (!articles.value || !Array.isArray(articles.value)) {
    toast.error('Unable to delete note: data not loaded');
    return;
  }

  const article = articles.value.find(a => a && a.id === id);
  if (!article) {
    toast.error('Note not found');
    return;
  }

  articleToDelete.value = article;
  showDeleteModal.value = true;
};

const confirmDelete = async () => {
  if (!articleToDelete.value) return;

  const { id, title } = articleToDelete.value;

  try {
    isDeleting.value = id;
    await articleStore.deleteArticleData(id);
    await fetchArticles();
    toast.success(`Note "${title}" deleted`);
    showDeleteModal.value = false;
    articleToDelete.value = null;
  } catch (err) {
    toast.error(`Failed to delete note: ${err.message || 'Unknown error'}`);
  } finally {
    isDeleting.value = null;
  }
};

const cancelDelete = () => {
  showDeleteModal.value = false;
  articleToDelete.value = null;
};

const toggleStatus = async (article) => {
  if (isTogglingStatus.value === article.id) return;

  try {
    isTogglingStatus.value = article.id;
    const statusCycle = {
      draft: 'private',
      private: 'published',
      published: 'draft'
    };

    const newStatus = statusCycle[article.status];
    if (!newStatus) {
      toast.error('Invalid note status');
      return;
    }

    await articleStore.updateArticleData(article.id, { status: newStatus });
    await fetchArticles();
    toast.success(`Status changed to ${getStatusLabel(newStatus)}`);
  } catch (err) {
    toast.error(`Failed to update status: ${err.message || 'Unknown error'}`);
  } finally {
    isTogglingStatus.value = null;
  }
};

const getStatusClass = (status) => {
  const classes = {
    draft: 'badge-draft',
    private: 'badge-private',
    published: 'badge-published'
  };
  return classes[status] || 'badge-draft';
};

const getStatusIcon = (status) => {
  const icons = {
    draft: 'fas fa-edit',
    private: 'fas fa-lock',
    published: 'fas fa-eye'
  };
  return icons[status] || 'fas fa-question';
};

const getStatusLabel = (status) => {
  const labels = {
    draft: 'Draft',
    private: 'Private',
    published: 'Published'
  };
  return labels[status] || status;
};

const getNextStatusLabel = (status) => {
  const statusCycle = {
    draft: 'Private',
    private: 'Published',
    published: 'Draft'
  };
  return statusCycle[status] || status;
};

const toValidDate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
};

const formatDate = (dateString) => {
  const d = toValidDate(dateString);
  return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '-';
};

const formatTimeAgo = (dateString) => {
  const date = toValidDate(dateString);
  if (!date) return '';
  const now = new Date();
  const diffInDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffInDays <= 0) return 'today';
  if (diffInDays === 1) return 'yesterday';
  if (diffInDays < 7) return `${diffInDays} days ago`;
  if (diffInDays < 30) return `${Math.floor(diffInDays / 7)} weeks ago`;
  return formatDate(date);
};

onMounted(() => {
  fetchArticles();
});
</script>

<style lang="scss" scoped>
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1.5rem;
  margin-bottom: 1.5rem;

  h1 {
    margin: 0;
    color: var(--color-heading);
    font-size: 2rem;
    line-height: 1.1;
  }

  p {
    margin: 0.45rem 0 0;
    color: var(--color-text-muted);
  }
}

.header-actions,
.stats,
.stat-item,
.filter-controls,
.action-buttons {
  display: flex;
  align-items: center;
}

.header-actions {
  gap: 1rem;
}

.stats {
  gap: 0.75rem;
}

.stat-item {
  gap: 0.45rem;
  color: var(--color-text-muted);
  font-size: 0.875rem;
  font-weight: 700;
}

.panel {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-lg);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

.state-panel {
  display: grid;
  place-items: center;
  gap: 1rem;
  min-height: 14rem;
  padding: 2rem;
}

.search-filter-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem;
  background: var(--color-surface-muted);
  border-bottom: 1px solid var(--color-border);
}

.search-box {
  position: relative;
  flex: 1;
  min-width: 250px;

  i {
    position: absolute;
    left: 0.85rem;
    top: 50%;
    transform: translateY(-50%);
    color: var(--color-text-muted);
  }
}

.search-input,
.status-filter {
  width: 100%;
  padding: 0.65rem 0.85rem;
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  font-size: 0.9rem;

  &:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 3px var(--color-focus-ring);
  }
}

.search-input {
  padding-left: 2.45rem;
}

.status-filter {
  min-width: 10rem;
}

.table-responsive {
  overflow-x: auto;
}

.table {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
  table-layout: fixed;

  th,
  td {
    padding: 0.85rem 1rem;
    border-bottom: 1px solid var(--color-border);
    text-align: left;
    vertical-align: top;
  }

  th {
    color: var(--color-text-muted);
    font-size: 0.75rem;
    font-weight: 800;
    text-transform: uppercase;
  }

  td {
    color: var(--color-text);
    font-size: 0.9rem;
  }

  tr:last-child td {
    border-bottom: 0;
  }

  tbody tr:hover {
    background: var(--color-surface-muted);
  }

  th:nth-child(1),
  td:nth-child(1) {
    width: 56%;
  }

  th:nth-child(2),
  td:nth-child(2) {
    width: 9rem;
  }

  th:nth-child(3),
  td:nth-child(3) {
    width: 13rem;
  }

  th:nth-child(4),
  td:nth-child(4) {
    width: 7rem;
  }
}

.article-info {
  min-width: 0;
}

.article-title {
  margin-bottom: 0.3rem;
  font-family: var(--font-family-sans);
  font-size: 0.95rem;
  line-height: 1.45;

  .fw-semibold {
    display: block;
    color: var(--color-heading);
    font-family: inherit;
    font-size: inherit;
    font-weight: 800;
    line-height: inherit;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.article-meta {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;

  .excerpt {
    max-width: min(48rem, 100%);
    color: var(--color-text-muted);
    font-size: 0.82rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.created-date {
  color: var(--color-heading);
  font-weight: 700;
  margin-bottom: 0.2rem;
}

.action-buttons {
  gap: 0.35rem;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.42rem 0.65rem;
  border: 0;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 800;
  line-height: 1;
  cursor: pointer;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.7;
  }
}

.badge-published {
  color: var(--color-success);
  background: rgba(16, 185, 129, 0.12);
}

.badge-private {
  color: var(--color-warning);
  background: rgba(245, 158, 11, 0.12);
}

.badge-draft {
  color: var(--color-text-muted);
  background: var(--color-light-bg);
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-height: 2.4rem;
  padding: 0.55rem 0.9rem;
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  cursor: pointer;
  font-weight: 800;
  text-decoration: none;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
}

.btn-primary {
  color: var(--color-text-inverse);
  background: var(--color-accent);
  border-color: var(--color-accent);
}

.btn-outline-primary {
  color: var(--color-accent);
  border-color: var(--color-accent-border);
}

.btn-outline-secondary {
  color: var(--color-text);
}

.btn-outline-danger {
  color: var(--color-danger);
  border-color: rgba(239, 68, 68, 0.3);
}

.btn-sm {
  min-height: 2rem;
  padding: 0.35rem 0.55rem;
  font-size: 0.82rem;
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
}

@keyframes spinner-border {
  to { transform: rotate(360deg); }
}

.text-primary { color: var(--color-accent); }
.text-success { color: var(--color-success); }
.text-muted { color: var(--color-text-muted); }
.small { font-size: 0.875rem; }
.fw-semibold { font-weight: 700; }
.text-nowrap { white-space: nowrap; }
.me-1 { margin-right: 0.25rem; }

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

@media (max-width: 860px) {
  .page-header,
  .search-filter-bar {
    align-items: flex-start;
    flex-direction: column;
  }

  .header-actions {
    width: 100%;
    justify-content: space-between;
  }

  .search-box,
  .filter-controls {
    width: 100%;
  }
}

@media (max-width: 767px) {
  .header-actions {
    flex-wrap: wrap;
  }

  .filter-controls {
    gap: 0.65rem;
  }

  .status-filter {
    flex: 1;
    min-width: 0;
  }

  .table-responsive {
    padding: 0.75rem;
    overflow: visible;
    background: var(--color-surface-muted);
  }

  .table {
    display: block;
    min-width: 0;

    thead {
      display: none;
    }

    tbody {
      display: grid;
      gap: 0.75rem;
    }

    tbody tr {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 0.85rem;
      padding: 1rem;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--border-radius-lg);
      box-shadow: var(--shadow-card);
    }

    td {
      width: auto;
      padding: 0;
      border: 0;
    }

    .note-cell,
    .actions-cell {
      grid-column: 1 / -1;
    }

    .date-cell {
      text-align: right;
    }

    .actions-cell {
      padding-top: 0.75rem;
      border-top: 1px solid var(--color-border);
    }
  }

  .article-title .fw-semibold {
    display: -webkit-box;
    overflow: hidden;
    white-space: normal;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .article-meta .excerpt {
    display: -webkit-box;
    overflow: hidden;
    white-space: normal;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .created-date {
    font-size: 0.85rem;
  }

  .date-info .small {
    font-size: 0.75rem;
  }

  .action-buttons {
    justify-content: flex-end;
  }
}

.pagination-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.9rem 1.1rem;
  border-top: 1px solid var(--color-border);
}

.pagination-info {
  font-size: 0.85rem;
  color: var(--color-text-muted);
}

.pagination-controls {
  display: flex;
  gap: 0.5rem;
}
</style>
