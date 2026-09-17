import { expect, it } from 'vitest';
import { MAX_VIDEO_BYTES, videoFileError, videoUploadError } from './app/video-upload.js';

it('rejects videos over the backend limit before uploading', () => {
  expect(videoFileError({ size: MAX_VIDEO_BYTES })).toBeNull();
  expect(videoFileError({ size: MAX_VIDEO_BYTES + 1 })).toContain('500 MB');
});

it('turns an HTML nginx 413 response into a useful message', () => {
  expect(videoUploadError({ status: 413 }, null)).toBe('视频超过服务器上传限制（最大 500 MB）');
  expect(videoUploadError({ status: 400 }, { code: 'FILE_TOO_LARGE' })).toContain('500 MB');
});
