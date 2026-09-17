export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
export const MAX_VIDEO_LABEL = '500 MB';

export function videoFileError(file) {
  if (file?.size > MAX_VIDEO_BYTES) return `视频超过 ${MAX_VIDEO_LABEL}，无法上传`;
  return null;
}

export function videoUploadError(response, data) {
  if (response.status === 413 || data?.code === 'FILE_TOO_LARGE') return `视频超过服务器上传限制（最大 ${MAX_VIDEO_LABEL}）`;
  if (response.status === 401 || response.status === 403) return '编辑登录已失效，请重新登录';
  return data?.error || data?.message || `视频上传失败（HTTP ${response.status}）`;
}
