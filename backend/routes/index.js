import express from 'express';
import articleRoutes from './articleRoutes.js';
import uploadRoutes from './uploadRoutes.js';
import authRoutes from './authRoutes.js';
import cmsRoutes from '../modules/cms/cmsRoutes.js';
import cmsV1Routes from '../modules/cms/cmsV1Routes.js';

const router = express.Router();

router.use('/articles', articleRoutes);
router.use('/upload', uploadRoutes);
router.use('/auth', authRoutes);
router.use('/cms', cmsRoutes);
router.use('/v1/cms', cmsV1Routes);

export default router;
