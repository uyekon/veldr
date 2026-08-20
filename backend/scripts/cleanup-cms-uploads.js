import { cleanupCmsUploads } from '../modules/cms/cmsMaintenance.js';

cleanupCmsUploads()
  .then(({ count, removed }) => {
    console.log(`CMS upload cleanup complete: removed ${count} file(s).`);
    if (removed.length) console.log(removed.join('\n'));
  })
  .catch((error) => {
    console.error('CMS upload cleanup failed:', error);
    process.exitCode = 1;
  });
