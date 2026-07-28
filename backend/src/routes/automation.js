import { Router } from 'express';
import {
  createAutomationRun,
  getAutomationRunForUser,
  requestAutomationCancellation,
} from '../services/automationRuns.js';
import { clearAutomationAgentSessions } from '../services/automationAgent.js';

const router = Router();

router.post('/runs', (req, res, next) => {
  try {
    const created = createAutomationRun(req.authSession.user, req.body);
    return res.status(201).json({ ok: true, ...created });
  } catch (error) {
    return next(error);
  }
});

router.get('/runs/:runId', (req, res) => {
  const run = getAutomationRunForUser(req.params.runId, req.authSession.user.userId);
  if (!run) {
    return res.status(404).json({ ok: false, error: 'Execução automatizada não encontrada.' });
  }
  clearAutomationAgentSessions(run.id);
  return res.json({ ok: true, run });
});

router.post('/runs/:runId/cancel', (req, res) => {
  const run = requestAutomationCancellation(
    req.params.runId,
    req.authSession.user.userId
  );
  if (!run) {
    return res.status(404).json({ ok: false, error: 'Execução automatizada não encontrada.' });
  }
  return res.json({ ok: true, run });
});

export default router;
