import { Router } from 'express';
import { publishCorrectiveCard } from '../services/sigClient.js';

const router = Router();

router.get('/status', (req, res) => {
  res.json({ configured: true, authenticated: Boolean(req.authSession) });
});

router.post('/correctives', async (req, res, next) => {
  try {
    const { card, context, requestId } = req.body || {};
    if (!card || !context) {
      return res.status(400).json({
        ok: false,
        error: 'Os dados da corretiva e do card de origem são obrigatórios.',
      });
    }
    const publication = await publishCorrectiveCard(
      card,
      context,
      requestId,
      req.authSession.accessToken,
      req.authSession.user.userId || req.authSession.id
    );
    return res.status(201).json({ ok: true, publication });
  } catch (error) {
    next(error);
  }
});

export default router;
