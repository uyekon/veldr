const requireViewer = (req, res, next) => {
  req.cmsRole = req.auth?.isAuthenticated ? 'editor' : 'viewer';
  next();
};

const requireEditor = (req, res, next) => {
  if (!req.auth?.isAuthenticated) {
    return res.status(401).json({ error: 'Administrator authentication required' });
  }
  req.cmsRole = 'editor';
  return next();
};

const resetCmsAuthForTests = () => {};

export {
  requireViewer,
  requireEditor,
  resetCmsAuthForTests,
};
