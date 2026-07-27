import { Router } from 'express';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { putObject } from '../storage.js';
import {
  authorizedRunnerRun,
  claimAutomationRun,
  runnerRunPayload,
  updateAutomationRun,
} from '../services/automationRuns.js';
import { safeStorageSegment } from '../services/correctiveAttachmentPaths.js';
import { decideAutomationAction } from '../services/automationAgent.js';

const router = Router();
const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const accepted = /^image\/(png|jpe?g)$/i.test(file.mimetype);
    callback(accepted ? null : new Error('A evidência automatizada deve ser PNG ou JPEG.'), accepted);
  },
});

function bearerToken(req) {
  const header = String(req.get('Authorization') || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function runnerAuth(req, res, next) {
  const run = authorizedRunnerRun(req.params.runId, bearerToken(req));
  if (!run) {
    return res.status(401).json({
      ok: false,
      error: 'Token do Runner Local inválido ou expirado.',
    });
  }
  req.automationRun = run;
  return next();
}

router.get('/runs/:runId', runnerAuth, (req, res) => {
  res.json({ ok: true, run: runnerRunPayload(req.automationRun) });
});

router.post('/runs/:runId/claim', runnerAuth, (req, res) => {
  const run = claimAutomationRun(req.automationRun, req.body);
  res.json({ ok: true, run });
});

router.patch('/runs/:runId', runnerAuth, (req, res) => {
  const run = updateAutomationRun(req.automationRun, req.body);
  res.json({ ok: true, run });
});

router.post('/runs/:runId/decision', runnerAuth, async (req, res, next) => {
  try {
    const scenarioId = String(req.body?.scenarioId || '');
    let selectedScenario = null;
    for (const card of req.automationRun.cards) {
      const scenario = card.scenarios.find((item) => item.id === scenarioId);
      if (scenario) {
        selectedScenario = {
          ...scenario,
          cardCode: card.code,
          cardTitle: card.title,
          hu: card.hu,
          path: scenario.path || card.path,
        };
        break;
      }
    }
    if (!selectedScenario) {
      return res.status(404).json({ ok: false, error: 'Cenário não pertence a esta execução.' });
    }
    const decision = await decideAutomationAction({
      run: req.automationRun,
      scenario: selectedScenario,
      observation: req.body.observation,
      history: req.body.history,
      tools: req.body.tools,
    });
    return res.json({ ok: true, decision });
  } catch (error) {
    return next(error);
  }
});

router.post(
  '/runs/:runId/evidence',
  runnerAuth,
  evidenceUpload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ ok: false, error: 'Arquivo de evidência não enviado.' });
      }
      const requestedScenarioId = String(req.body.scenarioId || '');
      const belongsToRun = req.automationRun.cards.some((card) =>
        card.scenarios.some((scenario) => scenario.id === requestedScenarioId)
      );
      if (!belongsToRun) {
        return res.status(404).json({
          ok: false,
          error: 'Cenário não pertence a esta execução.',
        });
      }
      const scenarioId = safeStorageSegment(requestedScenarioId, 'scenario');
      const extension = req.file.mimetype === 'image/png' ? '.png' : '.jpg';
      const filename = `${nanoid(14)}${extension}`;
      const key = `automation/${safeStorageSegment(
        req.automationRun.ownerUserId
      )}/${req.automationRun.id}/${scenarioId}/${filename}`;
      const url = await putObject(key, req.file.buffer, req.file.mimetype);
      return res.status(201).json({
        ok: true,
        evidence: {
          id: nanoid(12),
          type: 'screenshot',
          originalName: String(req.file.originalname || filename).slice(0, 180),
          filename,
          key,
          url,
          size: req.file.size,
          mimeType: req.file.mimetype,
        },
      });
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
