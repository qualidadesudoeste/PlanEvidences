import test from 'node:test';
import assert from 'node:assert/strict';
import {
  correctiveAttachmentPrefix,
  safeAttachmentName,
  validateCorrectiveRequestId,
} from './correctiveAttachmentPaths.js';

test('mantém prints de corretiva em prefixo separado por usuário e publicação', () => {
  assert.equal(
    correctiveAttachmentPrefix('qa/42', 'request-123'),
    'correctives/qa_42/request-123/'
  );
});

test('recusa requestId inseguro e normaliza nome enviado ao SIG', () => {
  assert.equal(validateCorrectiveRequestId('../../segredo'), '');
  assert.equal(validateCorrectiveRequestId('request-123'), 'request-123');
  assert.equal(safeAttachmentName('../erro:data?.png'), 'erro_data_.png');
});
